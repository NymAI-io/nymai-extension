// src/content.tsx
import type { PlasmoCSConfig } from "plasmo"
export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: true
}

// This is a Plasmo-specific feature to get the right-clicked element
export const getRootContainer = (payload) => {
  return document.getElementById(payload.targetElementId)
}

// Listen for the message from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  console.log("CONTENT: Received message:", request); // <--- ADD THIS LINE

  if (request.action === "get-clicked-content") {
    // 'getRootContainer' gives us the element the user clicked on
    const targetElement = getRootContainer(request)
    if (targetElement) {
      // --- This is our new multimodal logic ---
      if (targetElement.tagName === "IMG") {
        // It's an image!
        // TODO: We need a way to get the image data (base64)
        // For now, we'll send the URL
        sendResponse({
          content_type: "image",
          content_data: (targetElement as HTMLImageElement).src
        })
      } else if (targetElement.tagName === "VIDEO") {
        // It's a video!
        sendResponse({
          content_type: "video",
          content_data: (targetElement as HTMLVideoElement).src
        })
      } else {
        // It's text!
        sendResponse({
          content_type: "text",
          content_data: targetElement.innerText || window.getSelection().toString()
        })
      }
      // ---
    } else {
      // Fallback: If no element was found, scan the whole page
      sendResponse({
        content_type: "text",
        content_data: document.body.innerText
      })
    }
  }
  return true // Async
})

export default () => null
