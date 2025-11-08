// src/background.ts
import { createClient } from "@supabase/supabase-js"

// --- COPY KEYS FROM YOUR POPUP.TSX ---
const SUPABASE_URL = "https://rpnprnyoylifxxstdxzg.supabase.co"
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwbnBybnlveWxpZnh4c3RkeHpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMjkwMTgsImV4cCI6MjA3NzYwNTAxOH0.nk-uMk7TZQWhlrKzwJ2AOobIHeby2FzuGEP92oRxjQc"
const BACKEND_API_URL = "http://127.0.0.1:8000/v1/scan"
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
    console.log("BACKGROUND: Received Precision Path scan request:", request.scanType)
    runFullScan(request.content, request.scanType)
    sendResponse({ success: true })
  }
  return true // Async response
})

// 4. This is the scanning logic (moved from popup.tsx)
async function runFullScan(
  contentToScan: { content_type: string; content_data: string },
  scanType: 'credibility' | 'authenticity' = 'credibility'
) {
  console.log("Running full scan on:", contentToScan.content_type, "Type:", scanType)

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
  const endpoint = scanType === 'authenticity' 
    ? "http://127.0.0.1:8000/v1/scan/authenticity"
    : BACKEND_API_URL

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${realToken}`
      },
      body: JSON.stringify(contentToScan)
    })

    const data = await response.json()
    
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
