// src/background.ts
import { createClient } from "@supabase/supabase-js"

// --- COPY KEYS FROM YOUR POPUP.TSX ---
const SUPABASE_URL = process.env.PLASMO_PUBLIC_SUPABASE_URL as string
const SUPABASE_KEY = process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY as string
const NYMAI_API_BASE_URL = "https://nymai-image-scraper.onrender.com"
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

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

// 4. This is the scanning logic (moved from popup.tsx)
async function runFullScan(
  contentToScan: { content_type: string; content_data: string },
  scanType: 'credibility' | 'authenticity' = 'credibility'
) {
  const normalizedScanType =
    typeof scanType === "string" && scanType.toLowerCase() === "authenticity"
      ? "authenticity"
      : "credibility"

  console.log("Running full scan on:", contentToScan.content_type, "Type:", normalizedScanType)

  // Get the real session from storage
  const storageData = await chrome.storage.local.get("nymAiSession")
  const session = storageData.nymAiSession
  if (!session || !session.access_token) {
    console.error("NymAI Error: No user session found. Please log in.")
    chrome.storage.local.set({
      lastScanResult: { error: "You must be logged in to scan." }
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
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${realToken}`
      },
      body: JSON.stringify(contentToScan)
    })

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
        chrome.storage.local.set({ 
            lastScanResult: { error: data.detail, error_code: 402 } 
        });
        return; // Stop here
    }
    // --- END NEW LOGIC ---

    if (response.status !== 200) {
      throw new Error(data.detail || "Backend error")
    }
    // 6. Success! Save the result to local storage
    chrome.storage.local.set({ lastScanResult: data })
    console.log("NymAI Scan Complete. Result saved.")
  } catch (e) {
    console.error("NymAI Scan Failed:", e)
    // Save the error to storage so the popup can see it
    chrome.storage.local.set({ lastScanResult: { error: e.message, error_code: 500 } })
  }
}
