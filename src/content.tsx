// src/content.tsx
import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: false // Only run in the main frame to avoid conflicts
}

// This is a Plasmo-specific feature to get the right-clicked element (for Fast Path)
export const getRootContainer = (payload) => {
  return document.getElementById(payload.targetElementId)
}

// State for Interactive Selection Mode
let isSelectionModeActive = false
let currentScanType: 'credibility' | 'authenticity' | null = null
let overlay: HTMLDivElement | null = null
let highlightedElement: HTMLElement | null = null
let highlightBox: HTMLDivElement | null = null

// Create the overlay that covers the entire page
function createOverlay() {
  if (overlay) return overlay

  overlay = document.createElement('div')
  overlay.id = 'nymai-selection-overlay'
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 999999;
    cursor: crosshair;
    background: rgba(0, 0, 0, 0.1);
    pointer-events: auto;
  `
  document.body.appendChild(overlay)
  return overlay
}

// Create a highlight box that follows the mouse
function createHighlightBox() {
  if (highlightBox) return highlightBox

  highlightBox = document.createElement('div')
  highlightBox.id = 'nymai-highlight-box'
  highlightBox.style.cssText = `
    position: fixed;
    border: 2px solid #8b5cf6;
    background: rgba(139, 92, 246, 0.2);
    pointer-events: none;
    z-index: 1000000;
    display: none;
    transition: all 0.1s ease;
  `
  document.body.appendChild(highlightBox)
  return highlightBox
}

// Update highlight box position and size based on element bounds
function updateHighlightBox(element: HTMLElement) {
  if (!highlightBox) return

  const rect = element.getBoundingClientRect()
  highlightBox.style.display = 'block'
  highlightBox.style.left = `${rect.left + window.scrollX}px`
  highlightBox.style.top = `${rect.top + window.scrollY}px`
  highlightBox.style.width = `${rect.width}px`
  highlightBox.style.height = `${rect.height}px`
}

// Hide the highlight box
function hideHighlightBox() {
  if (highlightBox) {
    highlightBox.style.display = 'none'
  }
}

// Get the element at a given point
function getElementAtPoint(x: number, y: number): HTMLElement | null {
  // Temporarily hide the overlay to get the actual element underneath
  if (overlay) overlay.style.pointerEvents = 'none'
  const element = document.elementFromPoint(x, y) as HTMLElement
  if (overlay) overlay.style.pointerEvents = 'auto'
  return element
}

// Handle mouse movement to highlight elements
function handleMouseMove(event: MouseEvent) {
  if (!isSelectionModeActive || !overlay || !highlightBox) return

  const element = getElementAtPoint(event.clientX, event.clientY)
  
  if (!element || element === overlay || element === highlightBox) {
    hideHighlightBox()
    highlightedElement = null
    return
  }

  // Don't highlight the overlay itself or any of our UI elements
  if (element.id === 'nymai-selection-overlay' || 
      element.id === 'nymai-highlight-box' ||
      element.closest('#nymai-selection-overlay') ||
      element.closest('#nymai-highlight-box')) {
    hideHighlightBox()
    highlightedElement = null
    return
  }

  highlightedElement = element
  updateHighlightBox(element)
}

// Handle element click - this is where we detect content type and send to background
function handleElementClick(event: MouseEvent) {
  if (!isSelectionModeActive || !currentScanType) return

  event.preventDefault()
  event.stopPropagation()

  const element = getElementAtPoint(event.clientX, event.clientY)
  
  if (!element || element === overlay || element === highlightBox) {
    deactivateSelectionMode()
    return
  }

  // Don't process clicks on our UI elements
  if (element.id === 'nymai-selection-overlay' || 
      element.id === 'nymai-highlight-box' ||
      element.closest('#nymai-selection-overlay') ||
      element.closest('#nymai-highlight-box')) {
    return
  }

  // Determine content type and extract data
  let contentType = 'text'
  let contentData = ''

  if (element.tagName === 'IMG') {
    // It's an image
    contentType = 'image'
    contentData = (element as HTMLImageElement).src
  } else if (element.tagName === 'VIDEO') {
    // It's a video
    contentType = 'video'
    contentData = (element as HTMLVideoElement).src || (element as HTMLVideoElement).currentSrc
  } else if (element.tagName === 'AUDIO') {
    // It's audio
    contentType = 'audio'
    contentData = (element as HTMLAudioElement).src || (element as HTMLAudioElement).currentSrc
  } else {
    // It's text - get the element's text content
    contentType = 'text'
    contentData = element.innerText || element.textContent || ''
    
    // If no text in the element, try to get selected text
    if (!contentData.trim()) {
      const selection = window.getSelection()
      contentData = selection ? selection.toString() : ''
    }
  }

  // Deactivate selection mode
  deactivateSelectionMode()

  // Send the selected content to the background script
  chrome.runtime.sendMessage({
    action: 'precision-path-scan',
    scanType: currentScanType,
    content: {
      content_type: contentType,
      content_data: contentData
    }
  })
}

// Handle Escape key to cancel selection mode
function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isSelectionModeActive) {
    deactivateSelectionMode()
  }
}

// Activate Interactive Selection Mode
function activateSelectionMode(scanType: 'credibility' | 'authenticity') {
  if (isSelectionModeActive) return

  isSelectionModeActive = true
  currentScanType = scanType

  // Create overlay and highlight box
  createOverlay()
  createHighlightBox()

  // Add event listeners
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('click', handleElementClick, true) // Use capture phase
  document.addEventListener('keydown', handleKeyDown)

  // Prevent body scroll
  document.body.style.overflow = 'hidden'
}

// Deactivate Interactive Selection Mode
function deactivateSelectionMode() {
  if (!isSelectionModeActive) return

  isSelectionModeActive = false
  currentScanType = null

  // Remove event listeners
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('click', handleElementClick, true)
  document.removeEventListener('keydown', handleKeyDown)

  // Remove overlay and highlight box
  if (overlay && overlay.parentNode) {
    overlay.parentNode.removeChild(overlay)
    overlay = null
  }
  if (highlightBox && highlightBox.parentNode) {
    highlightBox.parentNode.removeChild(highlightBox)
    highlightBox = null
  }

  // Restore body scroll
  document.body.style.overflow = ''
  highlightedElement = null
}

// Listen for messages from the popup (Interactive Selection Mode) and background (Fast Path)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("CONTENT: Received message:", request)

  // Handle activation of Interactive Selection Mode from popup
  if (request.action === 'activate-selection-mode') {
    activateSelectionMode(request.scanType)
    sendResponse({ success: true })
    return true // Async response
  }

  // Handle Fast Path context menu requests (legacy support)
  if (request.action === "get-clicked-content") {
    const targetElement = getRootContainer(request)
    if (targetElement) {
      // --- Multimodal logic for Fast Path ---
      if (targetElement.tagName === "IMG") {
        sendResponse({
          content_type: "image",
          content_data: (targetElement as HTMLImageElement).src
        })
      } else if (targetElement.tagName === "VIDEO") {
        sendResponse({
          content_type: "video",
          content_data: (targetElement as HTMLVideoElement).src
        })
      } else {
        sendResponse({
          content_type: "text",
          content_data: targetElement.innerText || window.getSelection().toString()
        })
      }
    } else {
      sendResponse({
        content_type: "text",
        content_data: document.body.innerText
      })
    }
    return true // Async
  }

  return false
})

export default () => null
