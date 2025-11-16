// src/content.tsx
import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: false // Only run in the main frame to avoid conflicts
}

// Create a hidden container element for Plasmo to mount React components
// This prevents the createRoot error when Plasmo tries to mount the default export
let hiddenContainer: HTMLElement | null = null

function getOrCreateHiddenContainer(): HTMLElement {
  if (!hiddenContainer) {
    hiddenContainer = document.createElement('div')
    hiddenContainer.id = 'nymai-plasmo-root'
    // Use multiple CSS properties to ensure it's completely hidden
    hiddenContainer.style.cssText = `
      display: none !important;
      visibility: hidden !important;
      position: absolute !important;
      left: -9999px !important;
      top: -9999px !important;
      width: 0 !important;
      height: 0 !important;
      overflow: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
      z-index: -9999 !important;
    `
    
    // Ensure document.body exists before appending
    if (document.body) {
      document.body.appendChild(hiddenContainer)
    } else {
      // If body doesn't exist yet, wait for DOMContentLoaded
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          if (hiddenContainer && !hiddenContainer.parentNode) {
            document.body.appendChild(hiddenContainer)
          }
        })
      }
    }
    
    // Use MutationObserver to ensure the container and its children stay hidden
    // This prevents Plasmo's shadow container from becoming visible
    const observer = new MutationObserver(() => {
      if (hiddenContainer) {
        // Force hide the container itself
        hiddenContainer.style.cssText = `
          display: none !important;
          visibility: hidden !important;
          position: absolute !important;
          left: -9999px !important;
          top: -9999px !important;
          width: 0 !important;
          height: 0 !important;
          overflow: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
          z-index: -9999 !important;
        `
        
        // Force hide all children (including Plasmo's shadow container)
        const children = hiddenContainer.querySelectorAll('*')
        children.forEach((child: HTMLElement) => {
          child.style.cssText = `
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
          `
        })
      }
    })
    
    observer.observe(hiddenContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    })
  }
  return hiddenContainer
}

// Initialize hidden container immediately if body is available
if (document.body) {
  getOrCreateHiddenContainer()
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    getOrCreateHiddenContainer()
  })
}

// Inject extension ID into pages that match nymai.io (for OAuth flow)
// This must run immediately, before the page's React code loads
// Use chrome.runtime.id directly (available in content scripts) for synchronous injection
function injectExtensionId() {
  if (window.location.hostname === 'www.nymai.io' || window.location.hostname === 'nymai.io' || window.location.hostname === 'localhost') {
    try {
      // chrome.runtime.id is available synchronously in content scripts
      const extensionId = chrome.runtime.id
      if (extensionId) {
        // Inject the extension ID into the page's window object immediately
        // Use Object.defineProperty to ensure it's set before any page scripts run
        Object.defineProperty(window, 'NYMAI_EXTENSION_ID', {
          value: extensionId,
          writable: true,
          configurable: true
        })
        console.log('NymAI: Extension ID injected into page:', extensionId)
      }
    } catch (error) {
      console.warn('NymAI: Could not inject extension ID:', error)
    }
  }
}

// Inject immediately if possible, otherwise wait for DOM
if (document.readyState === 'loading') {
  // Inject as early as possible
  injectExtensionId()
  document.addEventListener('DOMContentLoaded', injectExtensionId)
} else {
  injectExtensionId()
}

// This is a Plasmo-specific feature to get the right-clicked element (for Fast Path)
// Plasmo uses this to determine where to mount React components for context menu features
export const getRootContainer = (payload) => {
  // If no payload or targetElementId, return null to prevent mounting
  // Plasmo should handle null gracefully, but if it doesn't, we'll use hidden container as fallback
  if (!payload || !payload.targetElementId) {
    // Try returning null first - if Plasmo errors, we'll catch it and use hidden container
    return null
  }
  
  // Try to find the target element
  const element = document.getElementById(payload.targetElementId)
  
  // If element exists, return it for context menu mounting
  if (element) {
    return element
  }
  
  // If element doesn't exist, return null to prevent mounting
  console.warn('NymAI: getRootContainer - target element not found:', payload.targetElementId)
  return null
}

// State for Interactive Selection Mode
let isSelectionModeActive = false
let currentScanType: 'credibility' | 'authenticity' | null = null
let overlay: HTMLDivElement | null = null
let highlightedElement: HTMLElement | null = null
let highlighter: HTMLDivElement | null = null
const MAX_TEXT_LENGTH = 5000

function sanitizeText(text: string): string {
  if (!text) return ""
  const cleaned = text.replace(/\s+/g, " ").replace(/<script.*?>.*?<\/script>/gi, "")
  return cleaned.trim().slice(0, MAX_TEXT_LENGTH)
}

function sanitizeUrl(raw: string): string | null {
  if (!raw) return null
  try {
    const resolved = new URL(raw, document.location.href)
    if (resolved.protocol !== "https:") {
      console.warn("NymAI: Blocking non-HTTPS media resource", resolved.href)
      return null
    }
    return resolved.href
  } catch (error) {
    console.warn("NymAI: Invalid URL encountered", raw, error)
    return null
  }
}

function sendSanitizedPayload(
  scanTypeForRequest: 'credibility' | 'authenticity',
  contentType: string,
  contentData: string
) {
  chrome.runtime.sendMessage({
    action: 'precision-path-scan',
    scanType: scanTypeForRequest,
    content: {
      content_type: contentType,
      content_data: contentData
    }
  })
}

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
    border: 2px solid #4fd1c5;
    background: rgba(79, 209, 197, 0.2);
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

// Validate selection for mixed content (images + text)
function validateSelection(element: HTMLElement): { isValid: boolean; error?: string } {
  // Check if there's a text selection
  const selection = window.getSelection()
  const selectedText = selection ? selection.toString().trim() : ''
  const hasSignificantText = selectedText.length > 10

  // Check if the selection contains any images
  let imageCount = 0
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer
    
    // Create a temporary container to check for images in the selection
    const tempDiv = document.createElement('div')
    tempDiv.appendChild(range.cloneContents())
    imageCount = tempDiv.querySelectorAll('img').length
  }

  // Also check if the clicked element itself is an image
  if (element.tagName === 'IMG') {
    imageCount++
  }

  // Check if the element contains images
  const elementImages = element.querySelectorAll('img')
  if (elementImages.length > 0) {
    imageCount += elementImages.length
  }

  // Block if both images and significant text are present
  if (imageCount > 0 && hasSignificantText) {
    return {
      isValid: false,
      error: "Mixed content is not supported. Please select only text or a single image."
    }
  }

  return { isValid: true }
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

  // Pre-flight check: Validate selection for mixed content
  const validation = validateSelection(element)
  if (!validation.isValid) {
    deactivateSelectionMode()
    // Save error to storage so popup can display it
    chrome.storage.local.set({
      lastScanResult: {
        error: validation.error || "Mixed content is not supported. Please select only text or a single image.",
        error_code: 400
      }
    })
    return
  }

  // Determine content type and extract data
  let contentType = 'text'
  let contentData = ''
  const scanTypeForRequest = currentScanType

  if (element.tagName === 'IMG') {
    // It's an image
    contentType = 'image'
    const sanitized = sanitizeUrl((element as HTMLImageElement).src)
    if (!sanitized) {
      deactivateSelectionMode()
      alert("NymAI could not process this image because it is not served over HTTPS.")
      return
    }
    contentData = sanitized
  } else if (element.tagName === 'VIDEO') {
    // It's a video
    contentType = 'video'
    const candidate = (element as HTMLVideoElement).src || (element as HTMLVideoElement).currentSrc
    const sanitized = sanitizeUrl(candidate)
    if (!sanitized) {
      deactivateSelectionMode()
      alert("NymAI could not process this video because it is not served over HTTPS.")
      return
    }
    contentData = sanitized
  } else if (element.tagName === 'AUDIO') {
    // It's audio
    contentType = 'audio'
    const candidate = (element as HTMLAudioElement).src || (element as HTMLAudioElement).currentSrc
    const sanitized = sanitizeUrl(candidate)
    if (!sanitized) {
      deactivateSelectionMode()
      alert("NymAI could not process this audio source because it is not served over HTTPS.")
      return
    }
    contentData = sanitized
  } else {
    // It's text - get the element's text content
    contentType = 'text'
    contentData = sanitizeText(element.innerText || element.textContent || '')
    
    // If no text in the element, try to get selected text
    if (!contentData.trim()) {
      const selection = window.getSelection()
      contentData = sanitizeText(selection ? selection.toString() : '')
    }
  }

  if (!contentData) {
    deactivateSelectionMode()
    alert("NymAI could not capture meaningful content from this selection.")
    return
  }

  // Deactivate selection mode before sending the scan request
  deactivateSelectionMode()

  // Send the selected content to the background script
  sendSanitizedPayload(scanTypeForRequest, contentType, contentData)
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
        const sanitized = sanitizeUrl((targetElement as HTMLImageElement).src)
        if (!sanitized) {
          sendResponse(null)
          return true
        }
        sendResponse({
          content_type: "image",
          content_data: sanitized
        })
      } else if (targetElement.tagName === "VIDEO") {
        const candidate = (targetElement as HTMLVideoElement).src || (targetElement as HTMLVideoElement).currentSrc
        const sanitized = sanitizeUrl(candidate)
        if (!sanitized) {
          sendResponse(null)
          return true
        }
        sendResponse({
          content_type: "video",
          content_data: sanitized
        })
      } else {
        sendResponse({
          content_type: "text",
          content_data: sanitizeText(targetElement.innerText || window.getSelection().toString())
        })
      }
    } else {
      sendResponse({
        content_type: "text",
        content_data: sanitizeText(document.body.innerText)
      })
    }
    return true // Async
  }

  return false
})

// Export null component - Plasmo will try to mount this but getRootContainer handles missing elements
// If getRootContainer returns null, Plasmo should skip mounting, but we add extra safety here
export default () => {
  // This component should never actually render since getRootContainer returns null
  // when there's no valid target element
  // Return an empty fragment that's guaranteed to be hidden
  return null
}

// Additional safety: Hide any Plasmo containers that might appear in the DOM
// This catches containers that Plasmo might create outside of our hidden container
if (typeof window !== 'undefined' && document.body) {
  const hidePlasmoContainers = () => {
    // Find any Plasmo shadow containers anywhere in the document
    const plasmoContainers = document.querySelectorAll('#nymai-plasmo-root, #plasmo-shadow-container, [id^="plasmo-shadow"], [id*="plasmo"]')
    plasmoContainers.forEach((container: HTMLElement) => {
      // Check if container is visible (has dimensions or is in viewport)
      const rect = container.getBoundingClientRect()
      const computedStyle = window.getComputedStyle(container)
      const isVisible = rect.width > 0 || rect.height > 0 || 
                       computedStyle.display !== 'none' || 
                       computedStyle.visibility !== 'hidden' ||
                       parseFloat(computedStyle.opacity) > 0
      
      if (isVisible) {
        // Force hide the container
        container.style.cssText = `
          display: none !important;
          visibility: hidden !important;
          position: absolute !important;
          left: -9999px !important;
          top: -9999px !important;
          width: 0 !important;
          height: 0 !important;
          opacity: 0 !important;
          pointer-events: none !important;
          z-index: -9999 !important;
        `
        
        // Also hide all children
        const children = container.querySelectorAll('*')
        children.forEach((child: HTMLElement) => {
          child.style.cssText = `
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
          `
        })
      }
    })
  }
  
  // Run immediately
  hidePlasmoContainers()
  
  // Watch for new containers being added
  const observer = new MutationObserver(() => {
    hidePlasmoContainers()
  })
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  })
  
  // Also check periodically as a fallback (less frequent to avoid performance issues)
  setInterval(hidePlasmoContainers, 500)
}
