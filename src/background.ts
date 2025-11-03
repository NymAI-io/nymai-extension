// src/background.ts
import { createClient } from "@supabase/supabase-js"

// --- COPY KEYS FROM YOUR POPUP.TSX ---
const SUPABASE_URL = "https://rpnprnyoylifxxstdxzg.supabase.co"
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwbnBybnlveWxpZnh4c3RkeHpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMjkwMTgsImV4cCI6MjA3NzYwNTAxOH0.nk-uMk7TZQWhlrKzwJ2AOobIHeby2FzuGEP92oRxjQc"
const BACKEND_API_URL = "http://127.0.0.1:8000/v1/scan"
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// 1. Create the right-click context menu when the extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "nym-ai-scan",
    title: "Scan with NymAI",
    contexts: ["page", "selection", "image", "video", "audio"]
  })
})

// 2. Listen for a click on that context menu
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "nym-ai-scan") {
    
    // --- THIS IS THE NEW, CORRECT LOGIC ---

    // Case 1: The user highlighted text
    if (info.selectionText) {
      console.log("BACKGROUND: Detected selected text.");
      runFullScan({
        content_type: "text",
        content_data: info.selectionText
      });
      return; // Stop here
    }

    // Case 2: The user clicked an image
    if (info.mediaType === "image" && info.srcUrl) {
      console.log("BACKGROUND: Detected image click.");
      runFullScan({
        content_type: "image",
        content_data: info.srcUrl
      });
      return; // Stop here
    }

    // Case 3: The user clicked a video
    if (info.mediaType === "video" && info.srcUrl) {
      console.log("BACKGROUND: Detected video click.");
      runFullScan({
        content_type: "video",
        content_data: info.srcUrl
      });
      return; // Stop here
    }
    
    // Case 4: The user clicked audio
    if (info.mediaType === "audio" && info.srcUrl) {
      console.log("BACKGROUND: Detected audio click.");
      runFullScan({
        content_type: "audio",
        content_data: info.srcUrl
      });
      return; // Stop here
    }

    // Fallback: If we don't know what was clicked, save an error.
    console.error("NymAI Error: No scannable content found.");
    chrome.storage.local.set({ 
      lastScanResult: { error: "No text, image, or video was selected." } 
    });
  }
});

// 5. This is the scanning logic (moved from popup.tsx)
async function runFullScan(contentToScan: { content_type: string; content_data: string }) {
  console.log("Running full scan on:", contentToScan.content_type)

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

  try {
    const response = await fetch(BACKEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${realToken}`
      },
      body: JSON.stringify(contentToScan)
    })

    const data = await response.json()
    if (response.status !== 200) {
      throw new Error(data.detail || "Backend error")
    }
    // 6. Success! Save the result to local storage
    chrome.storage.local.set({ lastScanResult: data })
    console.log("NymAI Scan Complete. Result saved.")
  } catch (e) {
    console.error("NymAI Scan Failed:", e)
    // Save the error to storage so the popup can see it
    chrome.storage.local.set({ lastScanResult: { error: e.message } })
  }
}