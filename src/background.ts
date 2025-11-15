// src/background.ts
import { createClient } from "@supabase/supabase-js"

// --- COPY KEYS FROM YOUR POPUP.TSX ---
const SUPABASE_URL = process.env.PLASMO_PUBLIC_SUPABASE_URL as string
const SUPABASE_KEY = process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY as string
const NYMAI_API_BASE_URL = process.env.PLASMO_PUBLIC_NYMAI_API_BASE_URL as string
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const storageArea = chrome.storage.session ?? chrome.storage.local
const RATE_LIMIT_WINDOW_MS = 2500
let lastScanTimestamp = 0
const MAX_TEXT_LENGTH = 5000

// Track the login tab ID for proactive tab management
let loginTabId: number | null = null

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
      try {
        console.log('NymAI: Received auth session from landing page')
        
        // Set the session in Supabase client
        const { data, error } = await supabase.auth.setSession(message.session)
        
        if (error) {
          console.error('NymAI: Failed to set session:', error)
          sendResponse({ success: false, error: error.message })
          return false
        }

        // Save session to storage (same as popup does)
        await storageArea.set({ nymAiSession: message.session })
        
        console.log('NymAI: Session saved successfully from landing page')
        console.log('NymAI: Current loginTabId:', loginTabId)
        console.log('NymAI: Sender tab ID:', sender.tab?.id)
        
        // Broadcast login completion to any open popups so they can refresh their UI
        chrome.runtime.sendMessage({ type: 'NYMAI_LOGIN_COMPLETE' })
        
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
        
        sendResponse({ success: true })
        return true
      } catch (error: any) {
        console.error('NymAI: Error processing auth session:', error)
        sendResponse({ success: false, error: error?.message || 'Unknown error' })
        return false
      }
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

  try {
    const controller = new AbortController()
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
    
    // --- THIS IS THE NEW LOGIC ---
    if (response.status === 402) {
        // Specifically catch the 402 error
        // We save *only* the error detail, not the generic "fetch failed"
        storageArea.set({ 
            lastScanResult: { error: data.detail, error_code: 402 } 
        });
        // Badge will be cleared in finally block
        return; // Stop here
    }
    // --- END NEW LOGIC ---

    if (response.status !== 200) {
      throw new Error(data?.detail || "Backend error")
    }
    // 6. Success! Save the result to local storage
    storageArea.set({ lastScanResult: data })
    console.log("NymAI Scan Complete. Result saved.")
  } catch (e) {
    console.error("NymAI Scan Failed:", e)
    // Save the error to storage so the popup can see it
    const message =
      e instanceof DOMException && e.name === "AbortError"
        ? "The request timed out. Please try again."
        : "Scan failed due to an unexpected error. Please try again."
    storageArea.set({ lastScanResult: { error: message, error_code: 500 } })
  } finally {
    // Clear badge and scanning state in all cases (success or failure)
    chrome.action.setBadgeText({ text: '' })
    await storageArea.set({ isScanning: false })
  }
}
