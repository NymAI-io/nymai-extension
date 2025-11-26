// src/popup/index.tsx
import "../style.css"
import React, { useState, useEffect } from "react"
import { createClient } from "@supabase/supabase-js"
import Spinner from "../components/Spinner"

// --- SUPABASE CONFIGURATION ---
// SECURITY NOTE: These environment variables are intentionally public
// PLASMO_PUBLIC_* variables are bundled into the extension and visible to users
// - SUPABASE_ANON_KEY: Designed to be public, protected by Row Level Security (RLS)
// - SUPABASE_URL: Public endpoint, no sensitive data exposed
// - NYMAI_API_BASE_URL: Public API endpoint (protected by authentication)
const SUPABASE_URL = process.env.PLASMO_PUBLIC_SUPABASE_URL as string
const SUPABASE_ANON_KEY = process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY as string
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const NYMAI_API_BASE_URL = process.env.PLASMO_PUBLIC_NYMAI_API_BASE_URL as string
// Lazy getter for storage area - initialized when first accessed
// This ensures chrome API is available when we try to use it
let _storageArea: chrome.storage.StorageArea | null = null

function getStorageArea(): chrome.storage.StorageArea | null {
  if (_storageArea !== null) {
    return _storageArea
  }

  try {
    // Check if we're in a Chrome extension context
    if (typeof chrome === 'undefined') {
      console.error('NymAI: chrome is undefined - not in extension context')
      _storageArea = null
      return null
    }

    // Check if chrome.runtime is available (indicates extension context is ready)
    if (!chrome.runtime || !chrome.runtime.id) {
      console.error('NymAI: chrome.runtime is not available - extension not loaded')
      _storageArea = null
      return null
    }

    // Check if chrome.storage exists
    if (!chrome.storage) {
      console.error('NymAI: chrome.storage is not available - check manifest permissions')
      _storageArea = null
      return null
    }

    // SECURITY FIX: Use session storage only (no local storage fallback)
    // Session storage is cleared when browser closes, reducing token exposure risk
    if (chrome.storage.session) {
      _storageArea = chrome.storage.session
      console.log('NymAI: Using chrome.storage.session')
      return _storageArea
    }

    // Fail gracefully if session storage is not available
    // Do not fall back to local storage for security reasons
    console.error('NymAI: chrome.storage.session is required but not available')
    console.error('NymAI: Session storage is required for security. Please update Chrome or check extension permissions.')
    console.error('NymAI: chrome.storage keys:', Object.keys(chrome.storage || {}))
    _storageArea = null
    return null
  } catch (e) {
    console.error('NymAI: Error initializing storage:', e)
    _storageArea = null
    return null
  }
}

// For backward compatibility, create a proxy object that safely handles unavailable storage
const storageArea = new Proxy({} as chrome.storage.StorageArea, {
  get(target, prop) {
    const area = getStorageArea()
    if (!area) {
      // Return a no-op function for methods, or undefined for properties
      if (typeof prop === 'string' && ['get', 'set', 'remove', 'clear'].includes(prop)) {
        return async () => ({})
      }
      return undefined
    }
    const value = area[prop as keyof chrome.storage.StorageArea]
    // Bind methods to the storage area
    if (typeof value === 'function') {
      return value.bind(area)
    }
    return value
  }
})
const REQUEST_TIMEOUT_MS = 30000

function IndexPopup() {
  // State management for the hybrid UI
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [credits, setCredits] = useState<number | null>(null) // User's credit balance
  const [scanResult, setScanResult] = useState<any>(null)
  const [loading, setLoading] = useState(true) // Start in loading state
  const [isScanning, setIsScanning] = useState(false) // Track active scan operations
  const [error, setError] = useState<string>("")
  const [errorCode, setErrorCode] = useState<number | null>(null)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [isYouTubeVideo, setIsYouTubeVideo] = useState(false)
  const [isCancelled, setIsCancelled] = useState(false) // Track if scan was cancelled

  // Open the dedicated login page on nymai.io
  const openLoginPage = () => {
    chrome.tabs.create({ url: 'https://www.nymai.io/login?dev_extension_id=' + chrome.runtime.id })
  }


  // --- Sign out function ---
  const signOut = async () => {
    await supabase.auth.signOut()
    const storageAreaInstance = getStorageArea()
    if (storageAreaInstance) {
      try {
        await storageAreaInstance.remove("nymAiSession")
      } catch (e) {
        console.warn('NymAI: Failed to remove session from storage:', e)
      }
    }
    setUserEmail(null)
    setScanResult(null)
    setError("")
    setErrorCode(null)
  }

  // --- Join Pro Waitlist function ---
  const handleJoinWaitlist = () => {
    chrome.tabs.create({ url: 'https://tally.so/r/444K1d' })
  }

  // --- Function to activate Interactive Selection Mode ---
  const activateSelectionMode = async (scanType: 'credibility' | 'authenticity') => {
    try {
      setError("") // Clear any previous errors
      setErrorCode(null) // Clear any previous error codes (e.g., 402 upgrade prompts)

      // Get the current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab.id || !tab.url) {
        setError("Could not get the current tab.")
        return
      }

      // Check if the page is a valid web page (not Chrome internal pages)
      const url = new URL(tab.url)
      if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
        setError("Selection mode is not available on this page. Please navigate to a regular web page.")
        return
      }

      // Check if the page supports content scripts (must be http/https)
      if (!url.protocol.startsWith('http')) {
        setError("Selection mode is only available on web pages (http:// or https://).")
        return
      }

      // Function to send the activation message
      const sendActivationMessage = async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'activate-selection-mode',
            scanType: scanType
          })
          return true
        } catch (error) {
          console.error("Failed to send message:", error)
          return false
        }
      }

      // Try to send message (content script might already be loaded)
      let messageSent = await sendActivationMessage()

      // If message failed, the content script might not be loaded yet
      // Wait a short moment for Plasmo to inject it, then retry
      if (!messageSent) {
        // Wait 100ms for content script to initialize
        await new Promise(resolve => setTimeout(resolve, 100))
        messageSent = await sendActivationMessage()
      }

      // Note: Content script is already loaded (matches: <all_urls>)
      // The script is designed to be minimal and only activates when receiving
      // the 'activate-selection-mode' message, so security risk is mitigated
      // If message fails, content script might not be ready yet
      if (!messageSent) {
        // Wait a bit longer and try once more
        await new Promise(resolve => setTimeout(resolve, 300))
        messageSent = await sendActivationMessage()

        if (!messageSent) {
          setError("Unable to connect to the page. Please reload the page and try again.")
          return
        }
      }

      // Success! Close the popup so user can interact with the page
      window.close()
    } catch (e: any) {
      console.error("Error activating selection mode:", e)
      setError(`Failed to activate selection mode: ${e.message || "Unknown error"}`)
    }
  }

  // --- Function to cancel an active scan ---
  const handleCancelScan = async () => {
    try {
      // Clear badge when cancelling scan
      clearBadge()

      // Set cancellation flag immediately to prevent any errors from showing
      setIsCancelled(true)

      // Immediately reset UI state for instant feedback
      setIsScanning(false)
      setError("")
      setErrorCode(null)
      setScanResult(null)

      // Set cancellation flag and clear storage to prevent error from showing
      const storageAreaInstance = getStorageArea()
      if (storageAreaInstance) {
        try {
          // Set flag first, then clear results
          await storageAreaInstance.set({ scanCancelled: true })
          await storageAreaInstance.remove("lastScanResult")
          // Also clear isScanning to prevent any race conditions
          await storageAreaInstance.set({ isScanning: false })
        } catch (storageError) {
          console.error('NymAI: Error updating storage during cancel:', storageError)
        }
      }

      // Send cancel message to background with error handling
      try {
        const response = await chrome.runtime.sendMessage({ action: 'cancel-scan' })
        if (response?.cancelled) {
          console.log('NymAI: Scan cancelled successfully')
        } else if (chrome.runtime.lastError) {
          console.warn('NymAI: Error sending cancel message:', chrome.runtime.lastError.message)
        }
      } catch (messageError) {
        console.error('NymAI: Error sending cancel message:', messageError)
        // Continue anyway - UI is already reset
      }

      // Keep cancellation flag for a bit longer to catch any late errors
      setTimeout(async () => {
        setIsCancelled(false)
        if (storageAreaInstance) {
          try {
            await storageAreaInstance.remove("scanCancelled")
          } catch (e) {
            console.warn('NymAI: Error removing cancellation flag:', e)
          }
        }
      }, 2000)
    } catch (e) {
      console.error('NymAI: Unexpected error cancelling scan:', e)
      // Even if message fails, UI is already reset
      setIsCancelled(false)
    }
  }

  // --- Function to scan YouTube video from the popup ---
  // This now delegates to the background script for consistent behavior
  const handleScanYouTubeVideo = async () => {
    if (!currentUrl) {
      setError("Could not get the current tab's URL.")
      return
    }

    // Set local state to show spinner immediately
    // The popup will automatically update when the result is saved to storage
    // Note: Badge will be set to "..." by background script when scan starts
    setIsScanning(true)
    setError("")
    setScanResult(null)
    setErrorCode(null)

    try {
      // Send message to background script to handle the scan
      chrome.runtime.sendMessage(
        {
          type: 'SCAN_YOUTUBE_URL',
          url: currentUrl
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error sending scan message:', chrome.runtime.lastError)
            setError("Failed to initiate scan. Please try again.")
            setIsScanning(false)
          }
          // Note: We don't wait for a response here because the background script
          // will save the result to storage, and our storage listener will update the UI
        }
      )
    } catch (e: any) {
      console.error('Error initiating YouTube scan:', e)
      setError("Failed to initiate scan. Please try again.")
      setIsScanning(false)
    }
  }

  // --- Helper function to clear badge ---
  const clearBadge = () => {
    try {
      chrome.action.setBadgeText({ text: '' })
    } catch (e) {
      console.warn('NymAI: Failed to clear badge:', e)
    }
  }

  // --- Function to clear scan results and return to Mission Control ---
  const handleStartNewScan = async () => {
    // Clear component state
    setScanResult(null)
    setError("")
    setErrorCode(null)
    setIsScanning(false)

    // Clear badge when returning to main screen
    clearBadge()

    // Clear persisted state in chrome.storage.local (if available)
    const storageAreaInstance = getStorageArea()
    if (storageAreaInstance) {
      try {
        await storageAreaInstance.remove("lastScanResult")
        await storageAreaInstance.set({ isScanning: false })
      } catch (e) {
        console.warn('NymAI: Failed to clear storage:', e)
      }
    }
  }

  // --- Keep service worker alive while popup is open ---
  useEffect(() => {
    // Open a persistent connection to keep the service worker alive
    // This prevents the service worker from being suspended during long-running scans
    const port = chrome.runtime.connect({ name: 'popup-keepalive' })
    console.log('NymAI: Popup opened connection to keep service worker alive')

    port.onDisconnect.addListener(() => {
      console.log('NymAI: Popup connection closed')
    })

    // Cleanup: close connection when popup closes
    return () => {
      port.disconnect()
    }
  }, [])

  // --- Data Fetching: Load scan results from chrome.storage.local ---
  useEffect(() => {
    async function loadPopupData() {
      try {
        // SESSION RE-HYDRATION: Check storage for saved session and restore it
        console.log('NymAI: Checking storage for saved session...')

        const storageAreaInstance = getStorageArea()
        if (!storageAreaInstance) {
          console.error('NymAI: Storage area is not available')
          setLoading(false)
          return
        }

        const storage = await storageAreaInstance.get("nymAiSession")

        if (storage?.nymAiSession) {
          console.log('NymAI: Found saved session in storage, re-hydrating...')
          try {
            // Restore the session in Supabase client
            const { data: sessionData, error: sessionError } = await supabase.auth.setSession(storage.nymAiSession)

            if (sessionError) {
              console.error('NymAI: Failed to restore session:', sessionError)
              // If session is invalid, remove it from storage
              if (storageAreaInstance) {
                await storageAreaInstance.remove("nymAiSession")
              }
            } else if (sessionData?.session) {
              console.log('NymAI: Session restored successfully')
              // Immediately update UI to reflect logged-in state
              const email = sessionData.session?.user?.email || sessionData.user?.email || null
              setUserEmail(email)
              // Ensure session is saved (in case it was updated)
              if (storageAreaInstance) {
                await storageAreaInstance.set({ nymAiSession: sessionData.session })
              }
            } else {
              console.warn('NymAI: setSession returned no session data:', sessionData)
              // Clear invalid session from storage
              if (storageAreaInstance) {
                await storageAreaInstance.remove("nymAiSession")
              }
            }
          } catch (rehydrateError: any) {
            console.error('NymAI: Error during session re-hydration:', rehydrateError)
            // If re-hydration fails, clear the invalid session
            if (storageAreaInstance) {
              await storageAreaInstance.remove("nymAiSession")
            }
          }
        } else {
          console.log('NymAI: No saved session found in storage')
        }

        // Load user authentication state (will use re-hydrated session if available)
        const {
          data: { user },
          error: userError
        } = await supabase.auth.getUser()

        if (userError || !user) {
          setUserEmail(null)
          if (storageAreaInstance) {
            await storageAreaInstance.remove("nymAiSession")
          }
        } else {
          const {
            data: { session },
            error: sessionError
          } = await supabase.auth.getSession()

          if (sessionError) {
            console.error('NymAI: Error getting session:', sessionError)
            setUserEmail(null)
            if (storageAreaInstance) {
              await storageAreaInstance.remove("nymAiSession")
            }
          } else if (session) {
            setUserEmail(session.user?.email || null)
            if (storageAreaInstance) {
              await storageAreaInstance.set({ nymAiSession: session })
            }
          } else {
            setUserEmail(null)
            if (storageAreaInstance) {
              await storageAreaInstance.remove("nymAiSession")
            }
          }
        }

        // Check if a scan is in progress
        if (storageAreaInstance) {
          const scanningData = await storageAreaInstance.get("isScanning")
          if (scanningData.isScanning === true) {
            setIsScanning(true)
          }

          // Check if scan was cancelled - if so, ignore any stored errors
          const cancellationData = await storageAreaInstance.get("scanCancelled")
          if (cancellationData.scanCancelled) {
            // Scan was cancelled - reset UI to ready state
            setScanResult(null)
            setError("")
            setErrorCode(null)
            // Clear the cancellation flag and any stored error
            await storageAreaInstance.remove("scanCancelled")
            await storageAreaInstance.remove("lastScanResult")
          } else {
            // Load the last scan result from storage
            const resultData = await storageAreaInstance.get("lastScanResult")
            if (resultData.lastScanResult) {
              if (resultData.lastScanResult.error) {
                // Skip error display for cancelled scans (499)
                if (resultData.lastScanResult.error_code === 499) {
                  // Scan was cancelled - reset UI to ready state
                  setScanResult(null)
                  setError("")
                  setErrorCode(null)
                } else if (resultData.lastScanResult.error_code === 429 || resultData.lastScanResult.error_code === 402) {
                  // Credit limit reached (429) or payment required (402)
                  setError(resultData.lastScanResult.error)
                  setErrorCode(resultData.lastScanResult.error_code || null)
                  setScanResult(null)
                } else {
                  setError("Scan failed: please try again.")
                  setErrorCode(resultData.lastScanResult.error_code || null)
                  setScanResult(null)
                }
              } else {
                // It's a successful scan result
                setScanResult(resultData.lastScanResult)
                setError("")
                setErrorCode(null)
              }
            } else {
              // No scan result found - clear state for Mission Control UI
              setScanResult(null)
              setError("")
              setErrorCode(null)
              // Clear badge when showing main screen (no scan result)
              clearBadge()
            }
          }
        }

        // Get current tab URL
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].url) {
            const url = tabs[0].url
            setCurrentUrl(url)
            if (url.includes("youtube.com/watch")) {
              setIsYouTubeVideo(true)
            }
          }
        })
      } catch (e: any) {
        console.error("Error loading popup data:", e)
        setError("Failed to load data. Please reload the extension.")
      } finally {
        setLoading(false)
      }
    }

    loadPopupData()
  }, [])

  // --- Fetch user credits on load and when user logs in ---
  useEffect(() => {
    async function fetchCredits() {
      if (!userEmail) {
        // User not logged in, clear credits
        setCredits(null)
        return
      }

      try {
        // Get session token from storage
        const storageAreaInstance = getStorageArea()
        if (!storageAreaInstance) {
          return
        }

        const storage = await storageAreaInstance.get("nymAiSession")
        const session = storage?.nymAiSession

        if (!session || !session.access_token) {
          return
        }

        // Fetch user profile with credits
        const response = await fetch(`${NYMAI_API_BASE_URL}/v1/user/profile`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          }
        })

        if (response.ok) {
          const data = await response.json()
          setCredits(data.daily_credits_remaining || 0)
        } else {
          console.error("Failed to fetch credits:", response.status)
        }
      } catch (e: any) {
        console.error("Error fetching credits:", e)
      }
    }

    fetchCredits()
  }, [userEmail]) // Re-fetch credits when userEmail changes

  // --- Set up storage listener for real-time updates ---
  useEffect(() => {
    // Set up the storage listener for real-time updates
    // Only set up listener if chrome.storage is available
    if (chrome?.storage?.onChanged) {
      const storageListener = (changes: any) => {
        // Listen for isScanning changes
        if (changes.isScanning) {
          setIsScanning(changes.isScanning.newValue === true)
        }

        // Listen for scan result changes
        if (changes.lastScanResult) {
          const newData = changes.lastScanResult.newValue
          setIsScanning(false) // Stop loading indicator when result arrives

          // Refresh credits after scan completes (success or error)
          if (userEmail) {
            // Fetch updated credits
            const storageAreaInstance = getStorageArea()
            if (storageAreaInstance) {
              storageAreaInstance.get("nymAiSession").then((storage: any) => {
                const session = storage?.nymAiSession
                if (session?.access_token) {
                  fetch(`${NYMAI_API_BASE_URL}/v1/user/profile`, {
                    method: "GET",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${session.access_token}`
                    }
                  })
                    .then(res => res.ok ? res.json() : null)
                    .then(data => {
                      if (data) {
                        setCredits(data.daily_credits_remaining || 0)
                      }
                    })
                    .catch(err => console.error("Error refreshing credits:", err))
                }
              })
            }
          }

          // If scan was cancelled, ignore any errors
          if (isCancelled) {
            setScanResult(null)
            setError("")
            setErrorCode(null)
            return
          }

          // Check if scan was cancelled in storage - if so, ignore any errors
          const storageAreaInstance = getStorageArea()
          if (storageAreaInstance) {
            storageAreaInstance.get("scanCancelled").then((result: any) => {
              if (result.scanCancelled || isCancelled) {
                // Scan was cancelled - reset UI to ready state and ignore errors
                setScanResult(null)
                setError("")
                setErrorCode(null)
                return
              }

              if (newData) {
                if (newData.error) {
                  // Skip error display for cancelled scans (499)
                  if (newData.error_code === 499) {
                    // Scan was cancelled - reset UI to ready state
                    setScanResult(null)
                    setError("")
                    setErrorCode(null)
                  } else if (newData.error_code === 429 || newData.error_code === 402) {
                    setError(newData.error)
                    setErrorCode(newData.error_code || null)
                    setScanResult(null)
                  } else {
                    setError("Scan failed: please try again.")
                    setErrorCode(newData.error_code || null)
                    setScanResult(null)
                  }
                } else {
                  // It's a successful scan result
                  setScanResult(newData)
                  setError("")
                  setErrorCode(null)
                }
              } else {
                // lastScanResult was cleared
                setScanResult(null)
                setError("")
                setErrorCode(null)
              }
            })
          }
        }
      }

      chrome.storage.onChanged.addListener(storageListener)

      // Cleanup: Remove listener when component unmounts
      return () => {
        if (chrome?.storage?.onChanged) {
          chrome.storage.onChanged.removeListener(storageListener)
        }
      }
    } else {
      // No storage available - return empty cleanup function
      return () => { }
    }
  }, []) // Empty dependency array ensures this runs only once on mount

  // Listen for login completion messages from background script
  useEffect(() => {
    const messageListener = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      if (message.type === 'NYMAI_LOGIN_COMPLETE') {
        console.log('NymAI: Received login complete message, refreshing popup state')
        // Re-run the data loading function to refresh the UI with new login state
        async function refreshPopupData() {
          try {
            // Load user authentication state
            const {
              data: { user },
              error: userError
            } = await supabase.auth.getUser()

            const storageAreaInstance = getStorageArea()
            if (userError || !user) {
              setUserEmail(null)
              if (storageAreaInstance) {
                await storageAreaInstance.remove("nymAiSession")
              }
            } else {
              const {
                data: { session },
                error: sessionError
              } = await supabase.auth.getSession()

              if (sessionError) {
                console.error('NymAI: Error getting session:', sessionError)
                setUserEmail(null)
                if (storageAreaInstance) {
                  await storageAreaInstance.remove("nymAiSession")
                }
              } else if (session) {
                setUserEmail(session.user?.email || null)
                if (storageAreaInstance) {
                  await storageAreaInstance.set({ nymAiSession: session })
                }
              } else {
                setUserEmail(null)
                if (storageAreaInstance) {
                  await storageAreaInstance.remove("nymAiSession")
                }
              }
            }
          } catch (e: any) {
            console.error("Error refreshing popup data after login:", e)
          }
        }
        refreshPopupData()
      }
      return true // Indicates we will send a response asynchronously
    }

    chrome.runtime.onMessage.addListener(messageListener)

    // Cleanup: remove listener when popup closes
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener)
    }
  }, [])

  // --- Helper function to render score indicators ---
  const renderScore = (score: number, isAuthenticity: boolean = false) => {
    if (isAuthenticity) {
      // For authenticity, higher score = more AI-like
      if (score > 80) return <span className="text-red-400 font-semibold">🔴 High AI Likelihood</span>
      if (score > 50) return <span className="text-yellow-400 font-semibold">🟡 Moderate AI Likelihood</span>
      return <span className="text-green-400 font-semibold">🟢 Low AI Likelihood</span>
    } else {
      // For credibility, higher score = higher risk
      if (score > 80) return <span className="text-red-400 font-semibold">🔴 High Risk</span>
      if (score > 50) return <span className="text-yellow-400 font-semibold">🟡 Moderate Risk</span>
      return <span className="text-green-400 font-semibold">🟢 Low Risk</span>
    }
  }

  // --- Helper function to get score color ---
  const getScoreColor = (score: number, isAuthenticity: boolean = false) => {
    if (isAuthenticity) {
      if (score > 80) return "text-red-400"
      if (score > 50) return "text-yellow-400"
      return "text-green-400"
    } else {
      if (score > 80) return "text-red-400"
      if (score > 50) return "text-yellow-400"
      return "text-green-400"
    }
  }

  // --- Hybrid Render Function: Prioritized UI Logic ---
  const renderBody = () => {
    // Priority 1: Initial loading state
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <Spinner size="lg" />
          <p className="text-gray-600 text-sm">Loading NymAI...</p>
        </div>
      )
    }

    // Priority 1.5: Active scan in progress
    if (isScanning) {
      return (
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <Spinner size="lg" />
          <div className="text-gray-800 font-medium">Analyzing content...</div>
          <div className="text-gray-600 text-xs">This may take a few moments</div>
          <button
            onClick={handleCancelScan}
            className="mt-4 px-4 py-2 bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 hover:border-red-300 font-medium rounded-lg transition-colors shadow-sm">
            Cancel Request
          </button>
        </div>
      )
    }

    // Priority 2: Error states (with special handling for 402 upgrade prompt)
    if (error) {
      // Check if this is an activation error (not a scan error)
      const isActivationError = error.includes("activate selection mode") ||
        error.includes("not available on this page") ||
        error.includes("reload the page")

      // Special case: 402 error code shows upgrade prompt with distinct styling
      if (errorCode === 402) {
        return (
          <div className="mt-4 p-5 bg-yellow-50 border-2 border-yellow-400 text-yellow-900 rounded-lg space-y-4">
            <div className="text-center">
              <div className="font-bold text-lg text-yellow-800 mb-2">Insufficient Credits</div>
              <div className="text-sm text-yellow-700 leading-relaxed">{error}</div>
            </div>
            <div className="space-y-2 pt-2">
              <button
                onClick={handleJoinWaitlist}
                className="w-full py-2.5 bg-brand-primary hover:bg-brand-primaryDark text-white font-semibold rounded-lg transition-colors shadow-lg">
                Join the Pro Waitlist
              </button>
              <button
                onClick={handleStartNewScan}
                className="w-full py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-lg transition-colors">
                Start New Scan
              </button>
            </div>
            <div className="mt-3 text-center">
              <a
                href="https://tally.so/r/GxxgYL"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Report Issue / Feedback
              </a>
            </div>
          </div>
        )
      }

      // Special case: 429 error code (Daily limit reached) shows upsell prompt
      if (errorCode === 429) {
        return (
          <div className="mt-4 p-5 bg-yellow-50 border-2 border-yellow-400 text-yellow-900 rounded-lg space-y-4">
            <div className="text-center">
              <p className="font-bold text-lg text-yellow-800 mb-2">Daily Limit Reached</p>
              <p className="text-sm text-yellow-700 leading-relaxed">You've used your 10 free daily scans. Join the Pro Waitlist for unlimited access.</p>
            </div>
            <div className="space-y-2 pt-2">
              <button
                onClick={handleJoinWaitlist}
                className="w-full py-2.5 bg-brand-primary hover:bg-brand-primaryDark text-white font-semibold rounded-lg transition-colors shadow-lg">
                Join the Pro Waitlist
              </button>
              <button
                onClick={handleStartNewScan}
                className="w-full py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-lg transition-colors">
                Start New Scan
              </button>
            </div>
            <div className="mt-3 text-center">
              <a
                href="https://tally.so/r/GxxgYL"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Report Issue / Feedback
              </a>
            </div>
          </div>
        )
      }

      // Generic error display
      return (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 text-red-800 rounded-lg space-y-3">
          <div className="text-sm font-medium">{isActivationError ? error : `Last scan failed: ${error}`}</div>
          <button
            onClick={handleStartNewScan}
            className="w-full py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-lg transition-colors">
            Start New Scan
          </button>
          <div className="text-center">
            <a
              href="https://tally.so/r/GxxgYL"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Report Issue / Feedback
            </a>
          </div>
        </div>
      )
    }

    // Priority 3: Scan results display
    if (scanResult) {
      const hasAuthenticity = scanResult?.authenticity && typeof scanResult.authenticity.score === 'number'
      const hasCredibility = scanResult?.credibility && typeof scanResult.credibility.risk_score === 'number'

      // If neither exists, show a generic message
      if (!hasAuthenticity && !hasCredibility) {
        return (
          <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-gray-700">Scan completed, but no analysis data was returned.</p>
            <div className="mt-4 pt-3 border-t border-gray-300">
              <button
                onClick={handleStartNewScan}
                className="w-full py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-lg transition-colors">
                Start New Scan
              </button>
              <div className="mt-3 text-center">
                <a
                  href="https://tally.so/r/GxxgYL"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                  Report Issue / Feedback
                </a>
              </div>
            </div>
          </div>
        )
      }

      const authScore = scanResult?.authenticity?.score ?? 0
      const credRiskScore = scanResult?.credibility?.risk_score ?? 0

      return (
        <div className="mt-4 bg-white rounded-xl border border-gray-200 overflow-hidden animate-fade-in shadow-lg">
          {/* Header */}
          <div className="bg-gradient-to-r from-brand-teal/10 to-brand-tealLight/10 px-5 py-3 border-b border-gray-200">
            <h3 className="text-lg font-bold text-gray-900">Analysis Results</h3>
            {scanResult?.model_used && (
              <p className="text-xs text-gray-600 mt-1">Model: {scanResult.model_used}</p>
            )}
          </div>

          <div className="p-5 space-y-6">
            {/* Authenticity Section - Only show if data exists */}
            {hasAuthenticity && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-600 uppercase tracking-wide">Authenticity</p>
                  {renderScore(authScore, true)}
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-baseline space-x-2 mb-2">
                    <span className={`text-4xl font-bold ${getScoreColor(authScore, true)}`}>
                      {authScore}
                    </span>
                    <span className="text-xl text-gray-600 font-medium">% AI</span>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed mt-2">
                    {scanResult?.authenticity?.analysis || "No analysis provided."}
                  </p>
                </div>
              </div>
            )}

            {/* Credibility Section - Only show if data exists */}
            {hasCredibility && (
              <div className={`space-y-3 ${hasAuthenticity ? "border-t border-gray-200 pt-6" : ""}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-600 uppercase tracking-wide">Credibility</p>
                  {renderScore(credRiskScore, false)}
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-baseline space-x-2 mb-2">
                    <span className={`text-4xl font-bold ${getScoreColor(credRiskScore, false)}`}>
                      {credRiskScore}
                    </span>
                    <span className="text-xl text-gray-600 font-medium">% Risk</span>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed mt-2">
                    {scanResult?.credibility?.analysis || "No analysis provided."}
                  </p>

                  {/* Claims Section */}
                  {scanResult?.credibility?.claims?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                      <p className="text-sm font-semibold text-gray-800">Claims Found</p>
                      {scanResult.credibility.claims.map((claim: any, index: number) => {
                        // Normalize claim status to lowercase string for case-insensitive comparison
                        // Handles both boolean (legacy) and string (new) formats
                        const status = typeof claim.is_true === 'string'
                          ? claim.is_true.toLowerCase()
                          : claim.is_true === true ? 'true' : claim.is_true === false ? 'false' : 'misleading'

                        const isTrue = status === 'true'
                        const isFalse = status === 'false'
                        const isMisleading = status === 'misleading'

                        return (
                          <div key={index} className="bg-white rounded-lg p-3 border-l-4 border-yellow-400 border border-gray-200">
                            <p className="text-sm text-gray-900 font-medium mb-1">{claim.claim}</p>
                            <div className="flex items-start space-x-2">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${isTrue ? "bg-green-100 text-green-700" :
                                  isFalse ? "bg-red-100 text-red-700" :
                                    "bg-yellow-100 text-yellow-700"
                                }`}>
                                {isTrue ? "TRUE" : isFalse ? "FALSE" : "MISLEADING"}
                              </span>
                              <p className="text-xs text-gray-600 flex-1">{claim.evidence}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer with Start New Scan Button */}
          <div className="px-5 py-4 bg-gray-50 border-t border-gray-200">
            <button
              onClick={handleStartNewScan}
              className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-lg transition-colors">
              Start New Scan
            </button>

            {/* Liability Disclaimer */}
            <div className="py-2 text-center">
              <p className="text-[10px] text-gray-400">
                <em>NymAI isn't perfect. Please use this as a guide, not the final verdict.</em>
              </p>
            </div>

            <div className="mt-3 text-center">
              <a
                href="https://tally.so/r/GxxgYL"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Report Issue / Feedback
              </a>
            </div>
          </div>
        </div>
      )
    }

    // Priority 4: Default state - Mission Control UI (only shown when no results/errors)
    return (
      <div className="mt-4 space-y-3">
        {/* Show YouTube video scan button if on YouTube video page */}
        {isYouTubeVideo && (
          <div className="mb-4 p-5 bg-gray-50 rounded-xl border-2 border-gray-200 shadow-md">
            <button
              onClick={handleScanYouTubeVideo}
              className="w-full py-3 bg-brand-primary hover:bg-brand-primaryDark text-white font-semibold rounded-lg transition-colors shadow-lg">
              Scan Video (5 ⚡)
            </button>
            <div className="text-xs text-gray-600 text-center mt-3">
              Or use the buttons below to scan other elements
            </div>
          </div>
        )}

        {/* Always show the standard scan buttons */}
        <div className="p-5 bg-gray-50 rounded-xl border-2 border-gray-200 shadow-md space-y-3">
          <button
            onClick={() => activateSelectionMode('credibility')}
            className="w-full py-3 bg-brand-accent hover:bg-brand-accentDark text-white font-semibold rounded-lg transition-colors shadow-lg">
            Check Credibility (1 ⚡)
          </button>
          <button
            onClick={() => activateSelectionMode('authenticity')}
            className="w-full py-3 bg-brand-primary hover:bg-brand-primaryDark text-white font-semibold rounded-lg transition-colors shadow-lg">
            Check Authenticity (1 ⚡)
          </button>
          <div className="text-xs text-gray-600 text-center mt-2">
            Or right-click on text/images for quick scans
          </div>
        </div>
      </div>
    )
  }

  // --- Main Render ---
  // Show error if storage is not available (check lazily)
  const storageAreaInstance = getStorageArea()
  if (!storageAreaInstance) {
    return (
      <div className="w-[380px] min-h-[400px] bg-gray-50 font-sans text-gray-900 p-5">
        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 text-center">
          <div className="text-red-800 font-semibold mb-2">Extension Error</div>
          <div className="text-red-700 text-sm">
            Storage API is not available. Please reload the extension or restart your browser.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-[380px] min-h-[400px] bg-gray-50 font-sans text-gray-900">
      {/* Header with Branding */}
      <div className="bg-white border-b border-gray-200 px-5 py-4">
        <div className="flex items-center justify-center mb-3 pt-2">
          <img
            src={chrome.runtime.getURL('NymAI_full_logo.svg')}
            alt="NymAI Logo"
            className="h-10"
            onError={(e) => {
              console.error('Failed to load logo. Attempted URL:', chrome.runtime.getURL('NymAI_full_logo.svg'));
              console.error('Extension ID:', chrome.runtime.id);
              // Try alternative path
              const altUrl = chrome.runtime.getURL('assets/NymAI_full_logo.svg');
              console.error('Trying alternative URL:', altUrl);
              (e.target as HTMLImageElement).src = altUrl;
            }}
          />
        </div>

        {/* User authentication section */}
        {!userEmail ? (
          <div className="space-y-2">
            {error && (
              <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                {error}
              </div>
            )}
            <button
              onClick={openLoginPage}
              className="w-full py-2.5 bg-brand-primary hover:bg-brand-primaryDark text-white font-semibold rounded-lg transition-colors shadow-lg">
              Log In / Sign Up
            </button>
          </div>
        ) : (
          <div className="text-center space-y-2">
            <div className="space-y-2">
              <div className="flex items-center justify-center space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <div className="text-sm text-gray-700">
                  Logged in as <span className="text-green-600 font-medium">{userEmail}</span>
                </div>
              </div>
              {credits !== null && (
                <div className="flex items-center justify-center">
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${credits >= 2 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                    ⚡ {credits} Credits
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={signOut}
              className="text-xs text-gray-500 hover:text-gray-700 underline transition-colors">
              Sign Out
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="p-5">
        {userEmail ? (
          /* Hybrid body: Results > Errors > Mission Control */
          renderBody()
        ) : (
          /* Show message when not logged in */
          <div className="text-center py-8">
            <div className="text-gray-500 text-sm">Please log in to use NymAI</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default IndexPopup
