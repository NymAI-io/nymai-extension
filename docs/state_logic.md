# State Logic

How the extension handles the "Scan" button and displays results.

## Overview

The extension uses a hybrid state management approach combining React component state with Chrome storage for persistence and cross-component communication.

## State Management

### Component State (`popup/index.tsx`)

**Primary State Variables:**
- `userEmail`: Current authenticated user email (or null)
- `scanResult`: Last scan result object (or null)
- `loading`: Initial loading state
- `isScanning`: Active scan operation flag
- `error`: Error message string
- `errorCode`: HTTP error code (e.g., 429, 402)
- `currentUrl`: Current tab URL
- `isYouTubeVideo`: Boolean flag for YouTube pages
- `isCancelled`: Cancellation flag to prevent error display

### Storage State (`chrome.storage.session`)

**Persisted Values:**
- `nymAiSession`: Supabase session object (for auth persistence)
- `isScanning`: Scan in-progress flag (for cross-popup persistence)
- `lastScanResult`: Complete scan result object
- `scanCancelled`: Cancellation flag (prevents error display)

## Scan Flow

### 1. User Initiates Scan

**Interactive Selection Mode:**
```typescript
activateSelectionMode(scanType: 'credibility' | 'authenticity')
```

1. Sets `isScanning = true`
2. Clears previous errors/results
3. Sends message to content script to activate selection UI
4. User highlights text/image on page
5. Content script sends selected content to background
6. Background script calls API endpoint

**Context Menu:**
- Right-click → "Scan selected text with NymAI"
- Background script receives selected text directly
- No content script injection needed

**YouTube Video:**
```typescript
handleScanYouTubeVideo()
```

1. Detects YouTube URL
2. Sends video URL to background script
3. Background script extracts transcript and calls API

### 2. Background Script Processing

**Background Script (`background.ts`):**
1. Receives scan request
2. Gets user session from storage
3. Calls backend API (`/v1/scan/credibility` or `/v1/scan/authenticity`)
4. Handles API response or errors
5. Saves result to `chrome.storage.session`:
   ```typescript
   {
     lastScanResult: {
       credibility: {...},
       authenticity: {...},
       model_used: "...",
       error: null
     },
     isScanning: false
   }
   ```

### 3. Result Display

**Storage Listener:**
The popup listens for storage changes:

```typescript
chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastScanResult) {
    const result = changes.lastScanResult.newValue
    setIsScanning(false)
    
    if (result.error) {
      // Handle errors (429, 402, etc.)
      setError(result.error)
      setErrorCode(result.error_code)
    } else {
      // Display successful result
      setScanResult(result)
      setError("")
    }
  }
})
```

**UI States:**

1. **Mission Control** (No scan, logged in):
   - Shows "Scan Credibility" and "Scan Authenticity" buttons
   - Shows user email
   - Shows "Join Pro Waitlist" button

2. **Scanning** (`isScanning = true`):
   - Shows loading spinner
   - Shows "Cancel" button
   - Disables scan buttons

3. **Result Display** (`scanResult` exists):
   - Shows credibility score and analysis
   - Shows authenticity score and analysis
   - Shows "Start New Scan" button
   - Shows model used

4. **Error State** (`error` exists):
   - Shows error message
   - Shows appropriate action (e.g., "Join Waitlist" for 402)
   - Allows retry or new scan

## Cancellation Flow

**User clicks "Cancel":**
1. Sets `isCancelled = true` immediately
2. Resets UI state (`isScanning = false`, clears errors)
3. Saves `scanCancelled: true` to storage
4. Sends cancel message to background script
5. Background script aborts request if possible
6. Clears cancellation flag after 2 seconds

**Prevents Error Display:**
- Storage listener checks `scanCancelled` flag
- Errors from cancelled scans are ignored
- UI returns to Mission Control state

## Session Management

**Session Re-hydration:**
On popup open, the extension:
1. Checks storage for saved session
2. Restores session in Supabase client
3. Updates `userEmail` state
4. Validates session is still active

**Session Storage:**
- Uses `chrome.storage.session` (clears on browser close)
- Stores full Supabase session object
- Automatically syncs across popup instances

## Error Handling

**Error Codes:**
- `429`: Daily credit limit reached
- `402`: Payment required (upgrade prompt)
- `499`: Scan cancelled (not shown to user)
- `401`: Authentication required
- `500`: Server error

**Error Display Logic:**
- Cancelled scans (499): No error shown
- Credit limit (429): Shows error with "Join Waitlist" option
- Payment required (402): Shows upgrade prompt
- Other errors: Generic "Scan failed" message

## State Synchronization

**Cross-Popup Sync:**
- Multiple popup windows share storage
- Storage listener updates all open popups
- Ensures consistent state across instances

**Background Script Sync:**
- Background script updates storage
- Popup listens for changes
- Real-time result updates without polling

