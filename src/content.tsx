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
let highlighter: HTMLDivElement | null = null

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
    z-index: 999998;
    cursor: crosshair;
    background: rgba(0, 0, 0, 0.1);
    pointer-events: auto;
    margin: 0;
    padding: 0;
  `
  document.body.appendChild(overlay)
  return overlay
}

// Create the highlighter element (created once, reused throughout selection mode)
function createHighlighter() {
  if (highlighter) return highlighter

  highlighter = document.createElement('div')
  highlighter.id = 'nymai-highlighter'
  // Apply inline styles to ensure visibility (CSS might not load in content script context)
  // The highlighter uses position: absolute for document-relative positioning
  highlighter.style.cssText = `
    position: absolute;
    border: 2px solid #8b5cf6;
    background: rgba(139, 92, 246, 0.2);
    pointer-events: none;
    z-index: 999999;
    display: none;
    transition: all 0.1s ease;
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  `
  document.body.appendChild(highlighter)
  return highlighter
}

// Core function: Update highlighter position using the critical architectural formula
// This translates viewport coordinates to document-absolute coordinates
function updateHighlighterPosition(element: HTMLElement) {
  if (!highlighter) {
    console.warn('NymAI: Highlighter element not found')
    return
  }

  // Get viewport-relative position and dimensions
  const rect = element.getBoundingClientRect()

  // Critical formula: absolute_position = viewport_position + scroll_offset
  // This ensures the highlighter is positioned correctly regardless of scroll position
  const top = rect.top + window.scrollY
  const left = rect.left + window.scrollX
  
  highlighter.style.top = `${top}px`
  highlighter.style.left = `${left}px`
  highlighter.style.width = `${rect.width}px`
  highlighter.style.height = `${rect.height}px`
  highlighter.style.display = 'block'
  
  console.log('NymAI: Highlighter updated', {
    element: element.tagName,
    top,
    left,
    width: rect.width,
    height: rect.height
  })
}

// Hide the highlighter
function hideHighlighter() {
  if (highlighter) {
    highlighter.style.display = 'none'
  }
}

// Get the element at a given point (viewport coordinates)
function getElementAtPoint(x: number, y: number): HTMLElement | null {
  // Temporarily disable pointer events on overlay to detect elements underneath
  if (overlay) overlay.style.pointerEvents = 'none'
  const element = document.elementFromPoint(x, y) as HTMLElement
  if (overlay) overlay.style.pointerEvents = 'auto'
  return element
}

// Handle mouse movement to highlight elements
// This is the engine that drives updateHighlighterPosition
function handleMouseMove(event: MouseEvent) {
  if (!isSelectionModeActive || !overlay || !highlighter) {
    console.log('NymAI: Selection mode not active or elements not ready', {
      isSelectionModeActive,
      hasOverlay: !!overlay,
      hasHighlighter: !!highlighter
    })
    return
  }

  const element = getElementAtPoint(event.clientX, event.clientY)
  
  // If no valid element, hide the highlighter
  if (!element || element === overlay || element === highlighter) {
    hideHighlighter()
    highlightedElement = null
    return
  }

  // Don't highlight our UI elements
  if (element.id === 'nymai-selection-overlay' || 
      element.id === 'nymai-highlighter' ||
      element.closest('#nymai-selection-overlay') ||
      element.closest('#nymai-highlighter')) {
    hideHighlighter()
    highlightedElement = null
    return
  }

  // Update the highlighted element and position the highlighter
  highlightedElement = element
  updateHighlighterPosition(element)
}

// Handle scroll events to update highlighter position when page scrolls
function handleScroll() {
  if (!isSelectionModeActive || !highlightedElement || !highlighter) return
  
  // Recalculate position when scrolling to maintain accuracy
  updateHighlighterPosition(highlightedElement)
}

// Handle element click - capture the selected element and initiate scan
function handleElementClick(event: MouseEvent) {
  if (!isSelectionModeActive || !currentScanType) return

  event.preventDefault()
  event.stopPropagation()

  // Use the currently highlighted element, or try to get element at click point
  const element = highlightedElement || getElementAtPoint(event.clientX, event.clientY)
  
  if (!element || element === overlay || element === highlighter) {
    deactivateSelectionMode()
    return
  }

  // Don't process clicks on our UI elements
  if (element.id === 'nymai-selection-overlay' || 
      element.id === 'nymai-highlighter' ||
      element.closest('#nymai-selection-overlay') ||
      element.closest('#nymai-highlighter')) {
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

  // Deactivate selection mode before sending the scan request
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
  if (isSelectionModeActive) {
    console.log('NymAI: Selection mode already active')
    return
  }

  console.log('NymAI: Activating selection mode', { scanType })

  isSelectionModeActive = true
  currentScanType = scanType

  // Create overlay and highlighter (highlighter is created once and reused)
  createOverlay()
  createHighlighter()

  console.log('NymAI: Created overlay and highlighter', {
    hasOverlay: !!overlay,
    hasHighlighter: !!highlighter
  })

  // Add event listeners
  // mousemove drives the highlighter position updates
  document.addEventListener('mousemove', handleMouseMove, { passive: true })
  document.addEventListener('click', handleElementClick, true) // Use capture phase
  document.addEventListener('keydown', handleKeyDown)
  // Handle scroll events to maintain highlighter accuracy during scroll
  window.addEventListener('scroll', handleScroll, { passive: true })

  // Prevent body scroll during selection mode
  document.body.style.overflow = 'hidden'
  
  console.log('NymAI: Selection mode activated successfully')
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
  window.removeEventListener('scroll', handleScroll)

  // Remove overlay and highlighter from DOM
  if (overlay && overlay.parentNode) {
    overlay.parentNode.removeChild(overlay)
    overlay = null
  }
  if (highlighter && highlighter.parentNode) {
    highlighter.parentNode.removeChild(highlighter)
    highlighter = null
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
    activateSelectionMode(request.scanType || request.mode)
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
