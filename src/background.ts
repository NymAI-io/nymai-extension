// src/background.ts
import { createClient } from "@supabase/supabase-js"

// --- SUPABASE CONFIGURATION ---
// SECURITY NOTE: These environment variables are intentionally public
// PLASMO_PUBLIC_* variables are bundled into the extension and visible to users
// - SUPABASE_ANON_KEY: Designed to be public, protected by Row Level Security (RLS)
// - SUPABASE_URL: Public endpoint, no sensitive data exposed
// - NYMAI_API_BASE_URL: Public API endpoint (protected by authentication)
const SUPABASE_URL = process.env.PLASMO_PUBLIC_SUPABASE_URL as string
const SUPABASE_KEY = process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY as string
const NYMAI_API_BASE_URL = process.env.PLASMO_PUBLIC_NYMAI_API_BASE_URL as string
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// SECURITY FIX: Use session storage only (no local storage fallback)
// Session storage is cleared when browser closes, reducing token exposure risk
// If session storage is not available, we'll check and fail gracefully at runtime
let storageArea: chrome.storage.StorageArea

// Constants
const MAX_TEXT_LENGTH = 5000
const RATE_LIMIT_WINDOW_MS = 5000
let lastScanTimestamp = 0

if (chrome.storage.session) {
  storageArea = chrome.storage.session
} else {
  console.error('NymAI: chrome.storage.session not available. Session storage is required for security.')
  // Use a no-op storage area that throws errors to prevent accidental use
  storageArea = {
    get: (keys?: any) => Promise.reject(new Error('Session storage is required but not available. Please update Chrome.')),
    set: (items: any) => Promise.reject(new Error('Session storage is required but not available. Please update Chrome.')),
    remove: (keys?: any) => Promise.reject(new Error('Session storage is required but not available. Please update Chrome.')),
    clear: () => Promise.reject(new Error('Session storage is required but not available. Please update Chrome.')),
    getBytesInUse: (keys?: any) => Promise.reject(new Error('Session storage is required but not available. Please update Chrome.')),
    setAccessLevel: (accessOptions: any) => Promise.reject(new Error('Session storage is required but not available. Please update Chrome.')),
    onChanged: {
      addListener: () => { },
      removeListener: () => { },
      hasListener: () => false,
      addRules: () => { },
      getRules: () => { },
      removeRules: () => { }
    } as any
  } as chrome.storage.StorageArea
}

// Store abort controllers for active scans so they can be cancelled
let currentAbortController: AbortController | null = null

// Track the login tab ID for proactive tab management
let loginTabId: number | null = null

// Keep service worker alive during scans by maintaining active connections
// MV3 service workers can be suspended, which aborts fetch requests
let activeConnections: Set<chrome.runtime.Port> = new Set()
let keepAliveIntervals: Map<chrome.runtime.Port, NodeJS.Timeout> = new Map()

// Listen for connections to keep service worker alive
chrome.runtime.onConnect.addListener((port) => {
  const portName = port.name || 'unknown'
  console.log(`NymAI: Connection opened (${portName}) to keep service worker alive`)
  activeConnections.add(port)

  // Send periodic pings to keep the connection active
  // This prevents Chrome from suspending the service worker during long requests
  const pingInterval = setInterval(() => {
    try {
      if (port.name === 'keep-alive') {
        // Send a ping message to keep the connection alive
        port.postMessage({ type: 'ping', timestamp: Date.now() })
        console.log('NymAI: Keep-alive ping sent on port')
      }
    } catch (e) {
      // Port may be disconnected, clear the interval
      console.warn('NymAI: Failed to send keep-alive ping:', e)
      clearInterval(pingInterval)
      keepAliveIntervals.delete(port)
    }
  }, 20000) // Every 20 seconds to reset Chrome's service worker timer

  keepAliveIntervals.set(port, pingInterval)

  port.onDisconnect.addListener(() => {
    console.log(`NymAI: Connection closed (${portName})`)
    activeConnections.delete(port)
    const interval = keepAliveIntervals.get(port)
    if (interval) {
      clearInterval(interval)
      keepAliveIntervals.delete(port)
    }
  })
})

type SanitizedPayload = {
  content_type: string
  content_data: string
}

function sanitizeText(text: string): string {
  if (!text) return ""
  const cleaned = text.replace(/\s+/g, " ").replace(/<script.*?>.*?<\/script>/gi, "")
  return cleaned.trim().slice(0, MAX_TEXT_LENGTH)
}

function sanitizeUrl(raw: string): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw, location.href)
    if (url.protocol !== "https:") {
      return null
    }
    return url.href
  } catch {
    return null
  }
}

function sanitizePayload(payload: SanitizedPayload): SanitizedPayload | null {
  switch (payload.content_type) {
    case "text": {
      const content = sanitizeText(payload.content_data)
      if (!content) return null
      return { content_type: "text", content_data: content }
    }
    case "image":
    case "video":
    case "audio": {
      const url = sanitizeUrl(payload.content_data)
      if (!url) return null
      return { content_type: payload.content_type, content_data: url }
    }
    default:
      return null
  }
}

// 1. Create the right-click context menu when the extension is installed
chrome.runtime.onInstalled.addListener(() => {
  // Replace the old .create() call with these three:
  chrome.contextMenus.create({
    id: "scanText",
    title: "Scan selected text with NymAI",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "scanImage",
    title: "Scan image with NymAI",
    contexts: ["image"]
  });

  chrome.contextMenus.create({
    id: "scanVideo",
    title: "Scan video with NymAI",
    contexts: ["video"]
  })
})

// 2. Listen for a click on that context menu
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "scanText" && info.selectionText) {
    console.log("BACKGROUND: Detected selected text.");
    runFullScan({
      content_type: "text",
      content_data: info.selectionText
    });
  } else if (info.menuItemId === "scanImage" && info.srcUrl) {
    console.log("BACKGROUND: Detected image click.");
    runFullScan({
      content_type: "image",
      content_data: info.srcUrl
    });
  } else if (info.menuItemId === "scanVideo" && info.srcUrl) {
    console.log("BACKGROUND: Detected video click.");
    runFullScan({
      content_type: "video",
      content_data: info.srcUrl
    });
  }
  // Note: We no longer need the other cases (audio, link) for the MVP,
  // and we have intentionally removed the fallback error case.
});

// 3. Listen for Precision Path messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'precision-path-scan') {
    const requestedScanType = (request.scanType || request.mode || "credibility") as 'credibility' | 'authenticity'
    console.log("BACKGROUND: Received Precision Path scan request:", requestedScanType, "Payload type:", request.content?.content_type)

    // We need to know the tab ID to send the result back
    const tabId = sender.tab?.id

    if (!tabId) {
      console.error("BACKGROUND: No tab ID found for precision path scan")
      return true
    }

    // Process scan request directly in background
    // We wrap this in an async function to handle the promise
    const handleScan = async () => {
      try {
        // Reuse the existing runFullScan logic which handles API calls and storage
        // But we also need to explicitly send the result back to the content script
        // because runFullScan broadcasts to the *active* tab, which might be different
        // (though in this case it's likely the same)

        // We'll modify runFullScan slightly or just call it and let it do its thing,
        // but runFullScan relies on storage updates to update the popup.
        // The content script listens for NYMAI_SCAN_COMPLETE.

        // Let's call runFullScan. It already broadcasts NYMAI_SCAN_COMPLETE to the active tab.
        // If we need to be more specific (e.g. if the user switched tabs), we might need to pass tabId to runFullScan.
        // For now, let's assume the user stays on the tab.

        await runFullScan(request.content, requestedScanType)

        // runFullScan saves to storage and broadcasts NYMAI_SCAN_COMPLETE.
        // If runFullScan fails, it sets an error in storage.
        // We should check storage to see if it succeeded or failed, and send an error if needed.

        const result = await storageArea.get("lastScanResult")
        if (result.lastScanResult?.error) {
          chrome.tabs.sendMessage(tabId, {
            action: "NYMAI_SCAN_ERROR",
            error: result.lastScanResult.error
          })
        }

      } catch (error: any) {
        console.error("BACKGROUND: Error processing scan request:", error)
        chrome.tabs.sendMessage(tabId, {
          action: "NYMAI_SCAN_ERROR",
          error: error.message || "Scan failed"
        })
      }
    }

    handleScan()

    // Send immediate acknowledgement
    sendResponse({ success: true })
    return true // Indicate we will send response asynchronously
  }

  // Handle YouTube URL scan requests from popup
  if (request.type === 'SCAN_YOUTUBE_URL' && request.url) {
    console.log("BACKGROUND: Received YouTube URL scan request:", request.url)
    handleYouTubeUrlScan(request.url)
    sendResponse({ success: true })
  }

  // Handle cancel scan requests
  if (request.action === 'cancel-scan') {
    console.log("BACKGROUND: Received cancel scan request")
    if (currentAbortController) {
      // Set cancellation flag before aborting to prevent error from being set
      storageArea.set({ scanCancelled: true })
      currentAbortController.abort()
      currentAbortController = null
      console.log("BACKGROUND: Scan cancelled")
      // Reset UI state - clear result instead of setting error
      chrome.action.setBadgeText({ text: '' })
      storageArea.set({
        isScanning: false
      })
      // Remove lastScanResult to prevent error from showing
      storageArea.remove("lastScanResult")
      // Clear cancellation flag after a short delay to allow catch blocks to check it
      setTimeout(() => {
        storageArea.remove("scanCancelled")
      }, 1000)
      sendResponse({ success: true, cancelled: true })
    } else {
      sendResponse({ success: false, error: "No active scan to cancel" })
    }
    return true
  }

  return true // Async response
})

// Track login tab when OAuth is initiated
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TRACK_LOGIN_TAB' && request.tabId) {
    loginTabId = request.tabId
    console.log('NymAI: Tracking login tab:', loginTabId)
    sendResponse({ success: true })
    return true
  }

  // Handle extension ID requests from content script
  if (request.type === 'GET_EXTENSION_ID') {
    const extensionId = chrome.runtime.id
    console.log('NymAI: Extension ID requested, returning:', extensionId)
    sendResponse({ extensionId })
    return true
  }

  return false
})

// 5. Listen for external messages from the landing page (OAuth flow)
chrome.runtime.onMessageExternal.addListener(
  async (message, sender, sendResponse) => {
    // ENTRY LOG: This proves the listener is firing at all
    console.log('NymAI: External message received from sender:', sender.url)
    console.log('NymAI: Message type:', message?.type)
    console.log('NymAI: Full message object:', message)
    console.log('NymAI: Sender tab ID:', sender.tab?.id)

    // Verify the sender is from our trusted domain
    if (!sender.url || (!sender.url.startsWith('https://www.nymai.io') && !sender.url.startsWith('https://nymai.io') && !sender.url.startsWith('http://localhost'))) {
      console.warn('NymAI: Rejected message from untrusted source:', sender.url)
      sendResponse({ success: false, error: 'Untrusted source' })
      return false
    }

    // Handle PING messages (for extension detection)
    if (message.type === 'PING') {
      sendResponse({ success: true, pong: true })
      return true
    }

    // Handle authentication success messages
    if (message.type === 'NYMAI_AUTH_SUCCESS' && message.session) {
      console.log('NymAI: NYMAI_AUTH_SUCCESS message handler entered')
      console.log('NymAI: Session object received:', message.session)
      console.log('NymAI: Session access_token present:', !!message.session?.access_token)
      console.log('NymAI: Session refresh_token present:', !!message.session?.refresh_token)

      try {
        console.log('NymAI: Attempting to set session in Supabase...')

        // Set the session in Supabase client
        const { data, error } = await supabase.auth.setSession(message.session)

        if (error) {
          console.error('NymAI: Failed to set session:', error)
          console.error('NymAI: Error code:', error.status)
          console.error('NymAI: Error message:', error.message)
          sendResponse({ success: false, error: error.message })
          return false
        }

        console.log('NymAI: Session set successfully in Supabase')
        console.log('NymAI: Supabase user:', data?.user?.email)

        // Save session to storage (same as popup does)
        console.log('NymAI: Saving session to storage...')
        await storageArea.set({ nymAiSession: message.session })

        console.log('NymAI: Session saved successfully from landing page')
        console.log('NymAI: Current loginTabId:', loginTabId)
        console.log('NymAI: Sender tab ID:', sender.tab?.id)

        // Broadcast login completion to any open popups so they can refresh their UI
        console.log('NymAI: Broadcasting NYMAI_LOGIN_COMPLETE to popups...')
        chrome.runtime.sendMessage({ type: 'NYMAI_LOGIN_COMPLETE' }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('NymAI: Error broadcasting login complete:', chrome.runtime.lastError)
          } else {
            console.log('NymAI: Login complete message broadcasted successfully')
          }
        })

        // Close the login tab immediately and reliably
        // Use tracked loginTabId if available, otherwise fall back to sender tab ID
        const tabIdToClose = loginTabId !== null ? loginTabId : sender.tab?.id

        if (tabIdToClose) {
          console.log('NymAI: Closing tab with ID:', tabIdToClose)
          chrome.tabs.remove(tabIdToClose, (error) => {
            if (error) {
              console.error('NymAI: Error closing tab:', error)
            } else {
              console.log('NymAI: Login tab closed after successful authentication')
            }
          })
          loginTabId = null // Reset tracking
        } else {
          console.warn('NymAI: No tab ID available to close. loginTabId:', loginTabId, 'sender.tab.id:', sender.tab?.id)
        }

        console.log('NymAI: Sending success response to landing page')
        sendResponse({ success: true })
        return true
      } catch (error: any) {
        console.error('NymAI: Error processing auth session:', error)
        console.error('NymAI: Error name:', error?.name)
        console.error('NymAI: Error message:', error?.message)
        console.error('NymAI: Error stack:', error?.stack)
        sendResponse({ success: false, error: error?.message || 'Unknown error' })
        return false
      }
    }

    // Log if message type doesn't match
    if (message.type !== 'PING' && message.type !== 'NYMAI_AUTH_SUCCESS') {
      console.warn('NymAI: Unknown message type received:', message.type)
    }

    // Unknown message type
    sendResponse({ success: false, error: 'Unknown message type' })
    return false
  }
)

// 4. This is the scanning logic (moved from popup.tsx)
async function runFullScan(
  contentToScan: { content_type: string; content_data: string },
  scanType: 'credibility' | 'authenticity' = 'credibility'
) {
  const now = Date.now()
  if (now - lastScanTimestamp < RATE_LIMIT_WINDOW_MS) {
    await storageArea.set({
      lastScanResult: { error: "Please wait a moment before starting another scan.", error_code: 429 }
    })
    return
  }

  const sanitizedPayload = sanitizePayload({
    content_type: contentToScan.content_type,
    content_data: contentToScan.content_data
  })

  if (!sanitizedPayload) {
    await storageArea.set({
      lastScanResult: { error: "Unable to process the selected content. Try a different selection.", error_code: 400 }
    })
    return
  }

  // Set badge and scanning state early to provide immediate feedback
  chrome.action.setBadgeText({ text: '...' })
  chrome.action.setBadgeBackgroundColor({ color: '#4fd1c5' })
  await storageArea.set({ isScanning: true })

  lastScanTimestamp = now

  const normalizedScanType =
    typeof scanType === "string" && scanType.toLowerCase() === "authenticity"
      ? "authenticity"
      : "credibility"

  console.log("Running full scan on:", contentToScan.content_type, "Type:", normalizedScanType)

  // Get the real session from storage
  const storageData = await storageArea.get("nymAiSession")
  const session = storageData.nymAiSession
  if (!session || !session.access_token) {
    console.error("NymAI Error: No user session found. Please log in.")
    // Clear badge and scanning state before returning
    chrome.action.setBadgeText({ text: '' })
    await storageArea.set({
      lastScanResult: { error: "You must be logged in to scan." },
      isScanning: false
    })
    return // Stop the scan
  }
  const realToken = session.access_token

  // Determine the correct endpoint based on scan type
  const endpointPath =
    normalizedScanType === "authenticity"
      ? "/v1/scan/authenticity"
      : "/v1/scan/credibility"

  const endpointUrl = `${NYMAI_API_BASE_URL}${endpointPath}`

  // Keep service worker alive by writing to storage periodically
  const keepAliveInterval = setInterval(async () => {
    try {
      await storageArea.set({ _keepAlive: Date.now() })
      await new Promise(resolve => setTimeout(resolve, 0))
      console.log('NymAI: Keep-alive storage ping sent')
    } catch (e) {
      console.warn('NymAI: Failed to keep service worker alive via storage:', e)
    }
  }, 2000)

  try {
    const controller = new AbortController()
    currentAbortController = controller

    const timeout = setTimeout(() => {
      console.warn('NymAI: Request timeout after 120 seconds, aborting')
      controller.abort()
    }, 120000)

    console.log('NymAI: Starting fetch request to', endpointUrl)
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${realToken}`
      },
      body: JSON.stringify(sanitizedPayload),
      signal: controller.signal,
      keepalive: true
    })
    clearTimeout(timeout)
    currentAbortController = null

    const rawBody = await response.text()
    const contentType = response.headers.get("content-type") ?? ""

    let data: any
    if (contentType.includes("application/json")) {
      try {
        data = JSON.parse(rawBody)
      } catch (parseError) {
        throw new Error(
          `Backend returned invalid JSON (status ${response.status}): ${String(parseError)}`
        )
      }
    } else {
      const snippet = rawBody ? rawBody.slice(0, 200) : "(empty response)"
      throw new Error(
        `Backend returned non-JSON response (status ${response.status}): ${snippet}`
      )
    }

    if (response.status === 429 || response.status === 402) {
      await storageArea.set({
        lastScanResult: { error: data.detail, error_code: response.status }
      });
      return;
    }

    if (response.status !== 200) {
      throw new Error(data?.detail || "Backend error")
    }

    await storageArea.set({ lastScanResult: data })
    console.log("NymAI Scan Complete. Result saved.")

    // Broadcast result to active tab
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (activeTab?.id) {
        chrome.tabs.sendMessage(activeTab.id, {
          action: "NYMAI_SCAN_COMPLETE",
          data: data
        }).catch(err => console.log("NymAI: Could not send message to tab (content script might not be loaded):", err))
      }
    } catch (err) {
      console.warn("NymAI: Error broadcasting to tab:", err)
    }

    chrome.action.setBadgeText({ text: '✓' })
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' })
  } catch (e: any) {
    console.error("NymAI Scan Failed:", e)
    const cancellationCheck = await storageArea.get("scanCancelled")
    if (cancellationCheck.scanCancelled || (e instanceof DOMException && e.name === "AbortError" && currentAbortController?.signal.aborted)) {
      console.log("NymAI: Scan cancelled by user")
      currentAbortController = null
      return
    }

    let errorMessage = "Scan failed due to an unexpected error. Please try again."
    let errorCode = 500

    if (e instanceof DOMException && e.name === "AbortError") {
      if (currentAbortController?.signal.aborted) {
        errorMessage = "The request timed out. Please try again."
        errorCode = 408
      } else {
        errorMessage = "The connection was interrupted. This may happen during long scans. Please try again."
        errorCode = 499
      }
    } else if (e instanceof Error) {
      if (e.message.includes("Failed to fetch") || e.message.includes("NetworkError") || e.message.includes("Client disconnected")) {
        errorMessage = "The connection was interrupted. This may happen during long scans. Please try again."
        errorCode = 499
      } else {
        errorMessage = e.message
      }
    }

    await storageArea.set({ lastScanResult: { error: errorMessage, error_code: errorCode } })
  } finally {
    clearInterval(keepAliveInterval)
    currentAbortController = null
    const lastResult = await storageArea.get("lastScanResult")
    if (lastResult.lastScanResult?.error) {
      chrome.action.setBadgeText({ text: '' })
    }
    await storageArea.set({ isScanning: false })
  }
}

// Handle YouTube URL scans initiated from the popup
async function handleYouTubeUrlScan(url: string) {
  const keepAliveInterval = setInterval(async () => {
    try {
      await storageArea.set({ _keepAlive: Date.now() })
      console.log('NymAI: Keep-alive storage ping sent (YouTube scan)')
    } catch (e) {
      console.warn('NymAI: Failed to keep service worker alive via storage:', e)
    }
  }, 3000)

  try {
    const now = Date.now()
    if (now - lastScanTimestamp < RATE_LIMIT_WINDOW_MS) {
      clearInterval(keepAliveInterval)
      await storageArea.set({
        lastScanResult: { error: "Please wait a moment before starting another scan.", error_code: 429 }
      })
      return
    }

    chrome.action.setBadgeText({ text: '...' })
    chrome.action.setBadgeBackgroundColor({ color: '#4fd1c5' })
    await storageArea.set({ isScanning: true })

    lastScanTimestamp = now

    if (!url || !url.includes('youtube.com/watch')) {
      clearInterval(keepAliveInterval)
      chrome.action.setBadgeText({ text: '' })
      await storageArea.set({
        lastScanResult: { error: "Invalid YouTube URL.", error_code: 400 },
        isScanning: false
      })
      return
    }

    const sanitizedUrl = sanitizeUrl(url)
    if (!sanitizedUrl) {
      clearInterval(keepAliveInterval)
      chrome.action.setBadgeText({ text: '' })
      await storageArea.set({
        lastScanResult: { error: "Unable to process the YouTube URL. Please ensure it's a valid HTTPS URL.", error_code: 400 },
        isScanning: false
      })
      return
    }

    const storageData = await storageArea.get("nymAiSession")
    const session = storageData.nymAiSession
    if (!session || !session.access_token) {
      clearInterval(keepAliveInterval)
      console.error("NymAI Error: No user session found. Please log in.")
      chrome.action.setBadgeText({ text: '' })
      await storageArea.set({
        lastScanResult: { error: "You must be logged in to scan.", error_code: 401 },
        isScanning: false
      })
      return
    }
    const realToken = session.access_token

    const controller = new AbortController()
    currentAbortController = controller

    const timeout = setTimeout(() => {
      console.warn('NymAI: YouTube scan timeout after 120 seconds, aborting')
      controller.abort()
    }, 120000)

    console.log('NymAI: Starting YouTube scan fetch request')
    const response = await fetch(`${NYMAI_API_BASE_URL}/v1/scan/credibility`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${realToken}`
      },
      body: JSON.stringify({
        content_type: "video",
        content_data: sanitizedUrl
      }),
      signal: controller.signal,
      keepalive: true
    })
    clearTimeout(timeout)
    currentAbortController = null

    const rawBody = await response.text()
    const contentType = response.headers.get("content-type") ?? ""

    let data: any
    if (contentType.includes("application/json")) {
      try {
        data = JSON.parse(rawBody)
      } catch (parseError) {
        throw new Error(
          `Backend returned invalid JSON (status ${response.status}): ${String(parseError)}`
        )
      }
    } else {
      const snippet = rawBody ? rawBody.slice(0, 200) : "(empty response)"
      throw new Error(
        `Backend returned non-JSON response (status ${response.status}): ${snippet}`
      )
    }

    if (response.status === 429 || response.status === 402) {
      await storageArea.set({
        lastScanResult: { error: data.detail || "Daily analysis limit reached. You have used all 10 free analyses for today.", error_code: response.status }
      })
      return
    }

    if (response.status !== 200) {
      throw new Error(data?.detail || `Request failed with status ${response.status}`)
    }

    await storageArea.set({ lastScanResult: data })
    console.log("NymAI YouTube Scan Complete. Result saved.")

    chrome.action.setBadgeText({ text: '✓' })
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' })

  } catch (e: any) {
    console.error("NymAI YouTube Scan Failed:", e)

    const cancellationCheck = await storageArea.get("scanCancelled")
    if (cancellationCheck.scanCancelled || (e instanceof DOMException && e.name === "AbortError" && currentAbortController?.signal.aborted)) {
      console.log("NymAI: YouTube scan cancelled by user")
      currentAbortController = null
      return
    }

    let errorMessage = "Scan failed due to an unexpected error. Please try again."
    let errorCode = 500

    if (e instanceof DOMException && e.name === "AbortError") {
      if (currentAbortController?.signal.aborted) {
        errorMessage = "The request timed out. Please try again."
        errorCode = 408
      } else {
        errorMessage = "The connection was interrupted. This may happen during long scans. Please try again."
        errorCode = 499
      }
    } else if (e instanceof Error) {
      if (e.message.includes("Failed to fetch") || e.message.includes("NetworkError") || e.message.includes("Client disconnected")) {
        errorMessage = "The connection was interrupted. This may happen during long scans. Please try again."
        errorCode = 499
      } else {
        errorMessage = e.message
      }
    }

    await storageArea.set({ lastScanResult: { error: errorMessage, error_code: errorCode } })
  } finally {
    clearInterval(keepAliveInterval)
    currentAbortController = null
    const lastResult = await storageArea.get("lastScanResult")
    if (lastResult.lastScanResult?.error) {
      chrome.action.setBadgeText({ text: '' })
    }
    await storageArea.set({ isScanning: false })
  }
}
