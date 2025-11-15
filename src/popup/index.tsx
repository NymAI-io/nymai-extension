// src/popup/index.tsx
import "../style.css"
import React, { useState, useEffect } from "react"
import { createClient } from "@supabase/supabase-js"
import Spinner from "../components/Spinner"

// --- CONFIGURE YOUR KEYS (from your .env file) ---
const SUPABASE_URL = process.env.PLASMO_PUBLIC_SUPABASE_URL as string
const SUPABASE_ANON_KEY = process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY as string
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const NYMAI_API_BASE_URL = process.env.PLASMO_PUBLIC_NYMAI_API_BASE_URL as string
const storageArea = chrome.storage.session ?? chrome.storage.local
const REQUEST_TIMEOUT_MS = 30000

function IndexPopup() {
  // State management for the hybrid UI
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<any>(null)
  const [loading, setLoading] = useState(true) // Start in loading state
  const [isScanning, setIsScanning] = useState(false) // Track active scan operations
  const [error, setError] = useState<string>("")
  const [errorCode, setErrorCode] = useState<number | null>(null)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [isYouTubeVideo, setIsYouTubeVideo] = useState(false)

  // This function opens our login.tsx tab
  const openLoginPage = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("tabs/login.html") })
  }

  // --- Sign out function ---
  const signOut = async () => {
    await supabase.auth.signOut()
    await storageArea.remove("nymAiSession")
    setUserEmail(null)
    setScanResult(null)
    setError("")
    setErrorCode(null)
  }

  // --- Upgrade to Pro function ---
  const handleUpgrade = async () => {
    try {
      const storageData = await storageArea.get("nymAiSession")
      const session = storageData.nymAiSession

      if (!session || !session.access_token) {
        setError("You must be logged in to upgrade.")
        return
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      const response = await fetch(`${NYMAI_API_BASE_URL}/v1/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        signal: controller.signal
      })
      clearTimeout(timeout)

      const data = await response.json()

      if (response.status !== 200) {
        throw new Error(data.detail || "Failed to create checkout session.")
      }

      if (data.url) {
        chrome.tabs.create({ url: data.url })
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setError("Upgrade failed: request timed out.")
      } else {
        setError("Upgrade failed: please try again.")
      }
    }
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

      // If still failed after retry, the content script needs to be injected
      if (!messageSent && chrome.scripting) {
        try {
          // Plasmo content scripts are auto-injected, but we can ensure they're ready
          // by reloading the tab's content script context
          // Note: In production, Plasmo handles this automatically
          // This is a fallback for edge cases
          
          // Try one more time after a brief delay
          await new Promise(resolve => setTimeout(resolve, 200))
          messageSent = await sendActivationMessage()
          
          if (!messageSent) {
            setError("Unable to connect to the page. Please reload the page and try again.")
            return
          }
        } catch (error) {
          console.error("Error ensuring content script:", error)
          setError("Please reload the page to enable selection mode on this page.")
          return
        }
      } else if (!messageSent) {
        setError("Please reload the page to enable selection mode on this page.")
        return
      }

      // Success! Close the popup so user can interact with the page
      window.close()
    } catch (e: any) {
      console.error("Error activating selection mode:", e)
      setError(`Failed to activate selection mode: ${e.message || "Unknown error"}`)
    }
  }

  // --- New function to scan YouTube video from the popup ---
  const handleScanYouTubeVideo = async () => {
    if (!currentUrl) {
      setError("Could not get the current tab's URL.")
      return
    }

    setIsScanning(true)
    setError("")
    setScanResult(null)
    setErrorCode(null)

    try {
      // This logic is similar to runFullScan in background.ts
      const storageData = await storageArea.get("nymAiSession")
      const session = storageData.nymAiSession
      if (!session || !session.access_token) {
        throw new Error("You must be logged in to scan.")
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      const response = await fetch(`${NYMAI_API_BASE_URL}/v1/scan/credibility`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          content_type: "video",
          content_data: currentUrl
        }),
        signal: controller.signal
      })
      clearTimeout(timeout)

      const data = await response.json()

      if (!response.ok) {
        // The storage listener will pick up the error, but we can throw here too
        throw new Error(data.detail || `Request failed with status ${response.status}`)
      }

      // The storage listener will update the UI, but we can set it here for immediate feedback
      setScanResult(data)
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setError("Scan failed: request timed out.")
      } else {
        setError("Scan failed: please try again.")
      }
    } finally {
      setIsScanning(false)
    }
  }

  // --- Function to clear scan results and return to Mission Control ---
  const handleStartNewScan = async () => {
    // Clear component state
    setScanResult(null)
    setError("")
    setErrorCode(null)
    
    // Clear persisted state in chrome.storage.local
    await storageArea.remove("lastScanResult")
  }

  // --- Data Fetching: Load scan results from chrome.storage.local ---
  useEffect(() => {
    async function loadPopupData() {
      try {
        // Load user authentication state
        const {
          data: { user },
          error: userError
        } = await supabase.auth.getUser()

        if (userError || !user) {
          setUserEmail(null)
          await storageArea.remove("nymAiSession")
        } else {
          const {
            data: { session }
          } = await supabase.auth.getSession()

          if (session) {
            setUserEmail(session.user.email)
            await storageArea.set({ nymAiSession: session })
          } else {
            setUserEmail(null)
            await storageArea.remove("nymAiSession")
          }
        }

        // Load the last scan result from storage
        const resultData = await storageArea.get("lastScanResult")
        if (resultData.lastScanResult) {
          if (resultData.lastScanResult.error) {
            // It's an error result
            if (resultData.lastScanResult.error_code === 402) {
              setError(resultData.lastScanResult.error)
            } else {
              setError("Scan failed: please try again.")
            }
            setErrorCode(resultData.lastScanResult.error_code || null)
            setScanResult(null)
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

    // Set up the storage listener for real-time updates
    const storageListener = (changes: any) => {
      if (changes.lastScanResult) {
        const newData = changes.lastScanResult.newValue
        setIsScanning(false) // Stop loading indicator when result arrives
        if (newData) {
          if (newData.error) {
            // It's an error result
            if (newData.error_code === 402) {
              setError(newData.error)
            } else {
              setError("Scan failed: please try again.")
            }
            setErrorCode(newData.error_code || null)
            setScanResult(null)
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
      }
    }
    chrome.storage.onChanged.addListener(storageListener)

    // Cleanup: Remove listener when component unmounts
    return () => {
      chrome.storage.onChanged.removeListener(storageListener)
    }
  }, []) // Empty dependency array ensures this runs only once on mount

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
          <p className="text-gray-400 text-sm">Loading NymAI...</p>
        </div>
      )
    }

    // Priority 1.5: Active scan in progress
    if (isScanning) {
      return (
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <Spinner size="lg" />
          <p className="text-gray-300 font-medium">Analyzing content...</p>
          <p className="text-gray-400 text-xs">This may take a few moments</p>
        </div>
      )
    }

    // Priority 2: Error states (with special handling for 402 upgrade prompt)
    if (error) {
      // Check if this is an activation error (not a scan error)
      const isActivationError = error.includes("activate selection mode") || 
                                 error.includes("not available on this page") ||
                                 error.includes("reload the page")

      // Special case: 402 error code shows upgrade prompt
      if (errorCode === 402) {
        return (
          <div className="mt-4 p-5 bg-yellow-900/50 border border-yellow-700 text-yellow-200 rounded-lg text-center space-y-3">
            <p className="font-semibold text-base">{error}</p>
            <p className="text-sm text-yellow-300">Upgrade to Pro for more scans.</p>
            <div className="space-y-2 pt-2">
              <button
                onClick={handleUpgrade}
                className="w-full py-2.5 bg-brand-primary hover:bg-brand-primaryDark text-white font-semibold rounded-lg transition-colors shadow-lg">
                Upgrade to Pro
              </button>
              <button
                onClick={handleStartNewScan}
                className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors">
                Start New Scan
              </button>
            </div>
          </div>
        )
      }

      // Generic error display
      return (
        <div className="mt-4 p-4 bg-red-900/30 border border-red-700/50 text-red-200 rounded-lg space-y-3">
          <div className="text-sm font-medium">{isActivationError ? error : `Last scan failed: ${error}`}</div>
          <button
            onClick={handleStartNewScan}
            className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors">
            Start New Scan
          </button>
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
          <div className="mt-4 p-3 bg-gray-700 rounded-lg">
            <p className="text-gray-300">Scan completed, but no analysis data was returned.</p>
            <div className="mt-4 pt-3 border-t border-gray-600">
              <button
                onClick={handleStartNewScan}
                className="w-full py-2 bg-gray-600 hover:bg-gray-500 text-white font-semibold rounded-lg transition-colors">
                Start New Scan
              </button>
            </div>
          </div>
        )
      }

      const authScore = scanResult?.authenticity?.score ?? 0
      const credRiskScore = scanResult?.credibility?.risk_score ?? 0

      return (
        <div className="mt-4 bg-gray-700/50 rounded-xl border border-gray-600/50 overflow-hidden animate-fade-in shadow-lg">
          {/* Header */}
          <div className="bg-gradient-to-r from-brand-primary/20 to-brand-accent/20 px-5 py-3 border-b border-gray-600/50">
            <h3 className="text-lg font-bold text-white">Analysis Results</h3>
            {scanResult?.model_used && (
              <p className="text-xs text-gray-400 mt-1">Model: {scanResult.model_used}</p>
            )}
          </div>

          <div className="p-5 space-y-6">
            {/* Authenticity Section - Only show if data exists */}
            {hasAuthenticity && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Authenticity</p>
                  {renderScore(authScore, true)}
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
                  <div className="flex items-baseline space-x-2 mb-2">
                    <span className={`text-4xl font-bold ${getScoreColor(authScore, true)}`}>
                      {authScore}
                    </span>
                    <span className="text-xl text-gray-400 font-medium">% AI</span>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed mt-2">
                    {scanResult?.authenticity?.analysis || "No analysis provided."}
                  </p>
                </div>
              </div>
            )}
            
            {/* Credibility Section - Only show if data exists */}
            {hasCredibility && (
              <div className={`space-y-3 ${hasAuthenticity ? "border-t border-gray-600/50 pt-6" : ""}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Credibility</p>
                  {renderScore(credRiskScore, false)}
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
                  <div className="flex items-baseline space-x-2 mb-2">
                    <span className={`text-4xl font-bold ${getScoreColor(credRiskScore, false)}`}>
                      {credRiskScore}
                    </span>
                    <span className="text-xl text-gray-400 font-medium">% Risk</span>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed mt-2">
                    {scanResult?.credibility?.analysis || "No analysis provided."}
                  </p>
                  
                  {/* Claims Section */}
                  {scanResult?.credibility?.claims?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-700/50 space-y-3">
                      <p className="text-sm font-semibold text-gray-300">Claims Found</p>
                      {scanResult.credibility.claims.map((claim: any, index: number) => (
                        <div key={index} className="bg-gray-900/50 rounded-lg p-3 border-l-4 border-yellow-500/50">
                          <p className="text-sm text-white font-medium mb-1">{claim.claim}</p>
                          <div className="flex items-start space-x-2">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                              claim.is_true === true ? "bg-green-500/20 text-green-400" :
                              claim.is_true === false ? "bg-red-500/20 text-red-400" :
                              "bg-yellow-500/20 text-yellow-400"
                            }`}>
                              {claim.is_true === true ? "TRUE" : claim.is_true === false ? "FALSE" : "MISLEADING"}
                            </span>
                            <p className="text-xs text-gray-400 flex-1">{claim.evidence}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          
          {/* Footer with Start New Scan Button */}
          <div className="px-5 py-4 bg-gray-800/30 border-t border-gray-600/50">
            <button
              onClick={handleStartNewScan}
              className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors">
              Start New Scan
            </button>
          </div>
        </div>
      )
    }

    // Priority 4: Default state - Mission Control UI (only shown when no results/errors)
    // Special case: YouTube video page shows a scan button
    if (isYouTubeVideo) {
      return (
        <div className="mt-4 p-5 bg-gray-700/50 rounded-lg border border-gray-600/50 text-center">
          <button
            onClick={handleScanYouTubeVideo}
            className="w-full py-3 bg-brand-primary hover:bg-brand-primaryDark text-white font-semibold rounded-lg transition-colors shadow-lg">
            Scan this YouTube Video
          </button>
        </div>
      )
    }

    // Default: Mission Control buttons
    return (
      <div className="mt-4 space-y-3">
        <button
          onClick={() => activateSelectionMode('credibility')}
          className="w-full py-3 bg-brand-accent hover:bg-brand-accentDark text-white font-semibold rounded-lg transition-colors shadow-lg">
          Check Credibility
        </button>
        <button
          onClick={() => activateSelectionMode('authenticity')}
          className="w-full py-3 bg-brand-primary hover:bg-brand-primaryDark text-white font-semibold rounded-lg transition-colors shadow-lg">
          Check Authenticity
        </button>
        <p className="text-xs text-gray-400 text-center mt-3 px-2">
          Or right-click on text/images for quick scans
        </p>
      </div>
    )
  }

  // --- Main Render ---
  return (
    <div className="w-[380px] min-h-[400px] bg-gradient-to-b from-gray-900 to-gray-800 font-sans text-gray-100">
      {/* Header with Branding */}
      <div className="bg-gray-800/50 border-b border-gray-700/50 px-5 py-4">
        <div className="flex items-center justify-center space-x-2 mb-3">
          <div className="w-8 h-8 bg-gradient-to-br from-brand-primary to-brand-accent rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">N</span>
          </div>
          <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-brand-primary to-brand-accent">
            NymAI
          </h1>
        </div>
        
        {/* User authentication section */}
        {!userEmail ? (
          <button
            onClick={openLoginPage}
            className="w-full py-2.5 bg-brand-primary hover:bg-brand-primaryDark text-white font-semibold rounded-lg transition-colors shadow-lg">
            Log In / Sign Up
          </button>
        ) : (
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <p className="text-sm text-gray-300">
                Logged in as <span className="text-green-400 font-medium">{userEmail}</span>
              </p>
            </div>
            <button
              onClick={signOut}
              className="text-xs text-gray-400 hover:text-gray-300 underline transition-colors">
              Sign Out
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="p-5">
        {/* Hybrid body: Results > Errors > Mission Control */}
        {userEmail && renderBody()}
      </div>
    </div>
  )
}

export default IndexPopup
