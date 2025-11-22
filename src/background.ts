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
if (chrome.storage.session) {
  storageArea = chrome.storage.session
} else {
  // This should not happen in Chrome 102+, but fail gracefully if it does
  console.error('NymAI: chrome.storage.session not available. Session storage is required for security.')
  // Use a no-op storage area that throws errors to prevent accidental use
  storageArea = {
    get: async () => { throw new Error('Session storage is required but not available. Please update Chrome.') },
    set: async () => { throw new Error('Session storage is required but not available. Please update Chrome.') },
    remove: async () => { throw new Error('Session storage is required but not available. Please update Chrome.') },
    clear: async () => { throw new Error('Session storage is required but not available. Please update Chrome.') },
    getBytesInUse: async () => { throw new Error('Session storage is required but not available. Please update Chrome.') }
  } as chrome.storage.StorageArea
}
const RATE_LIMIT_WINDOW_MS = 2500
let lastScanTimestamp = 0
const MAX_TEXT_LENGTH = 5000

// Store abort controllers for active scans so they can be cancelled
let currentAbortController: AbortController | null = null

// Track the login tab ID for proactive tab management
let loginTabId: number | null = null

// Keep service worker alive during scans by maintaining active connections
// MV3 service workers can be suspended, which aborts fetch requests
let activeConnections: Set<chrome.runtime.Port> = new Set()

// Listen for connections to keep service worker alive
chrome.runtime.onConnect.addListener((port) => {
  console.log('NymAI: Connection opened to keep service worker alive')
  activeConnections.add(port)
  
  port.onDisconnect.addListener(() => {
    console.log('NymAI: Connection closed')
    activeConnections.delete(port)
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
    runFullScan(request.content, requestedScanType)
    sendResponse({ success: true })
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

  // Keep service worker alive during scan by writing to storage periodically
  // MV3 service workers can be suspended after ~5 seconds of inactivity
  // Writing to storage every 3 seconds prevents suspension during long requests
  const keepAliveInterval = setInterval(async () => {
    try {
      await storageArea.set({ _keepAlive: Date.now() })
      console.log('NymAI: Keep-alive ping sent')
    } catch (e) {
      console.warn('NymAI: Failed to keep service worker alive:', e)
    }
  }, 3000) // Every 3 seconds (before 5s suspension threshold)

  try {
    const controller = new AbortController()
    currentAbortController = controller // Store globally so it can be cancelled
    const timeout = setTimeout(() => controller.abort(), 30000)
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${realToken}`
      },
      body: JSON.stringify(sanitizedPayload),
      signal: controller.signal
    })
    clearTimeout(timeout)
    currentAbortController = null // Clear after successful fetch

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
      // Surface the first part of the response body to help debugging (Render returns HTML error pages)
      const snippet = rawBody ? rawBody.slice(0, 200) : "(empty response)"
      throw new Error(
        `Backend returned non-JSON response (status ${response.status}): ${snippet}`
      )
    }
    
    // --- Handle credit limit errors (429 = Too Many Requests / Daily limit reached) ---
    if (response.status === 429 || response.status === 402) {
        // Backend returns 429 for daily credit limit, but we also handle 402 for compatibility
        // We save *only* the error detail, not the generic "fetch failed"
        storageArea.set({ 
            lastScanResult: { error: data.detail, error_code: response.status } 
        });
        // Badge will be cleared in finally block
        return; // Stop here
    }

    if (response.status !== 200) {
      throw new Error(data?.detail || "Backend error")
    }
    // 6. Success! Save the result to local storage
    storageArea.set({ lastScanResult: data })
    console.log("NymAI Scan Complete. Result saved.")
  } catch (e) {
    console.error("NymAI Scan Failed:", e)
    // Check if this was a user cancellation
    const cancellationCheck = await storageArea.get("scanCancelled")
    if (cancellationCheck.scanCancelled || (e instanceof DOMException && e.name === "AbortError" && currentAbortController?.signal.aborted)) {
      // Check if it was aborted by user (not timeout) - timeout would have been cleared
      console.log("NymAI: Scan cancelled by user")
      // Don't set error - cancellation is handled in the cancel handler
      currentAbortController = null
      return // Exit early, state already reset by cancel handler
    }
    // Save the error to storage so the popup can see it
    const message =
      e instanceof DOMException && e.name === "AbortError"
        ? "The request timed out. Please try again."
        : "Scan failed due to an unexpected error. Please try again."
    storageArea.set({ lastScanResult: { error: message, error_code: 500 } })
  } finally {
    // Clear keep-alive interval
    clearInterval(keepAliveInterval)
    // Clear badge and scanning state in all cases (success or failure)
    currentAbortController = null // Ensure it's cleared
    chrome.action.setBadgeText({ text: '' })
    await storageArea.set({ isScanning: false })
  }
}

// Handle YouTube URL scans initiated from the popup
async function handleYouTubeUrlScan(url: string) {
  // Keep service worker alive during scan by writing to storage periodically
  // MV3 service workers can be suspended after ~5 seconds of inactivity
  // Writing to storage every 3 seconds prevents suspension during long requests
  const keepAliveInterval = setInterval(async () => {
    try {
      await storageArea.set({ _keepAlive: Date.now() })
      console.log('NymAI: Keep-alive ping sent (YouTube scan)')
    } catch (e) {
      console.warn('NymAI: Failed to keep service worker alive:', e)
    }
  }, 3000) // Every 3 seconds (before 5s suspension threshold)
  
  try {
    const now = Date.now()
    if (now - lastScanTimestamp < RATE_LIMIT_WINDOW_MS) {
      clearInterval(keepAliveInterval)
      await storageArea.set({
        lastScanResult: { error: "Please wait a moment before starting another scan.", error_code: 429 }
      })
      return
    }

    // Set badge and scanning state early to provide immediate feedback
    chrome.action.setBadgeText({ text: '...' })
    chrome.action.setBadgeBackgroundColor({ color: '#4fd1c5' })
    await storageArea.set({ isScanning: true })

    lastScanTimestamp = now

    // Validate URL
    if (!url || !url.includes('youtube.com/watch')) {
      clearInterval(keepAliveInterval)
      chrome.action.setBadgeText({ text: '' })
      await storageArea.set({
        lastScanResult: { error: "Invalid YouTube URL.", error_code: 400 },
        isScanning: false
      })
      return
    }

    // Sanitize the URL
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

    // Get the session from storage
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

    // Perform the actual scan
    const controller = new AbortController()
    currentAbortController = controller // Store globally so it can be cancelled
    const timeout = setTimeout(() => controller.abort(), 30000)
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
      signal: controller.signal
    })
    clearTimeout(timeout)
    currentAbortController = null // Clear after successful fetch

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
    
    // Handle credit limit errors (429 = Too Many Requests / Daily limit reached)
    if (response.status === 429 || response.status === 402) {
      // Backend returns 429 for daily credit limit, but we also handle 402 for compatibility
      await storageArea.set({ 
        lastScanResult: { error: data.detail || "Daily analysis limit reached. You have used all 10 free analyses for today.", error_code: response.status } 
      })
      return // Badge will be cleared in finally block
    }

    if (response.status !== 200) {
      throw new Error(data?.detail || `Request failed with status ${response.status}`)
    }
    
    // Success! Save the result to storage
    await storageArea.set({ lastScanResult: data })
    console.log("NymAI YouTube Scan Complete. Result saved.")
  } catch (e) {
    console.error("NymAI YouTube Scan Failed:", e)
    // Check if this was a user cancellation
    const cancellationCheck = await storageArea.get("scanCancelled")
    if (cancellationCheck.scanCancelled || (e instanceof DOMException && e.name === "AbortError" && currentAbortController?.signal.aborted)) {
      console.log("NymAI: YouTube scan cancelled by user")
      // Don't set error - cancellation is handled in the cancel handler
      currentAbortController = null
      return // Exit early, state already reset by cancel handler
    }
    // Save the error to storage so the popup can see it
    const message =
      e instanceof DOMException && e.name === "AbortError"
        ? "The request timed out. Please try again."
        : e instanceof Error
        ? e.message
        : "Scan failed due to an unexpected error. Please try again."
    await storageArea.set({ lastScanResult: { error: message, error_code: 500 } })
  } finally {
    // Clear keep-alive interval
    clearInterval(keepAliveInterval)
    // Clear badge and scanning state in all cases (success or failure)
    currentAbortController = null // Ensure it's cleared
    chrome.action.setBadgeText({ text: '' })
    await storageArea.set({ isScanning: false })
  }
}
