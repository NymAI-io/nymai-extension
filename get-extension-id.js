/**
 * Quick script to get your current extension ID
 * 
 * Run this in the extension's popup console (F12) or background script console
 * 
 * Or use: chrome://extensions/ → Find your extension → Copy the ID
 */

// Method 1: From runtime (works in popup/background)
console.log('Extension ID:', chrome.runtime.id)

// Method 2: Full CORS origin format
console.log('CORS Origin:', `chrome-extension://${chrome.runtime.id}`)

// Method 3: Copy to clipboard (if available)
if (navigator.clipboard) {
  navigator.clipboard.writeText(`chrome-extension://${chrome.runtime.id}`).then(() => {
    console.log('✅ CORS origin copied to clipboard!')
  })
}

