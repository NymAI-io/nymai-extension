// src/popup/index.tsx
import "../style.css"
import React, { useState, useEffect } from "react"
import { createClient } from "@supabase/supabase-js"

// --- CONFIGURE YOUR KEYS (from your .env file) ---
const SUPABASE_URL = "https://rpnprnyoylifxxstdxzg.supabase.co"
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwbnBybnlveWxpZnh4c3RkeHpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMjkwMTgsImV4cCI6MjA3NzYwNTAxOH0.nk-uMk7TZQWhlrKzwJ2AOobIHeby2FzuGEP92oRxjQc"
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

function IndexPopup() {
  // State management for the hybrid UI
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<any>(null)
  const [loading, setLoading] = useState(true) // Start in loading state
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
    await chrome.storage.local.remove("nymAiSession")
    setUserEmail(null)
    setScanResult(null)
    setError("")
    setErrorCode(null)
  }

  // --- Upgrade to Pro function ---
  const handleUpgrade = async () => {
    try {
      const storageData = await chrome.storage.local.get("nymAiSession")
      const session = storageData.nymAiSession

      if (!session || !session.access_token) {
        setError("You must be logged in to upgrade.")
        return
      }

      const response = await fetch(
        "https://nymai-backend.onrender.com/v1/create-checkout-session",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          }
        }
      )

      const data = await response.json()

      if (response.status !== 200) {
        throw new Error(data.detail || "Failed to create checkout session.")
      }

      if (data.url) {
        chrome.tabs.create({ url: data.url })
      }
    } catch (e: any) {
      setError(`Upgrade failed: ${e.message}`)
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

    setLoading(true)
    setError("")
    setScanResult(null)
    setErrorCode(null)

    try {
      // This logic is similar to runFullScan in background.ts
      const storageData = await chrome.storage.local.get("nymAiSession")
      const session = storageData.nymAiSession
      if (!session || !session.access_token) {
        throw new Error("You must be logged in to scan.")
      }

      const response = await fetch("https://nymai-backend.onrender.com/v1/scan/credibility", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          content_type: "video",
          content_data: currentUrl
        })
      })

      const data = await response.json()

      if (!response.ok) {
        // The storage listener will pick up the error, but we can throw here too
        throw new Error(data.detail || `Request failed with status ${response.status}`)
      }

      // The storage listener will update the UI, but we can set it here for immediate feedback
      setScanResult(data)
    } catch (e: any) {
      setError(`Scan failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // --- Function to clear scan results and return to Mission Control ---
  const handleStartNewScan = async () => {
    // Clear component state
    setScanResult(null)
    setError("")
    setErrorCode(null)
    
    // Clear persisted state in chrome.storage.local
    await chrome.storage.local.remove("lastScanResult")
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
          await chrome.storage.local.remove("nymAiSession")
        } else {
          const {
            data: { session }
          } = await supabase.auth.getSession()

          if (session) {
            setUserEmail(session.user.email)
            await chrome.storage.local.set({ nymAiSession: session })
          } else {
            setUserEmail(null)
            await chrome.storage.local.remove("nymAiSession")
          }
        }

        // Load the last scan result from chrome.storage.local
        const resultData = await chrome.storage.local.get("lastScanResult")
        if (resultData.lastScanResult) {
          if (resultData.lastScanResult.error) {
            // It's an error result
            setError(resultData.lastScanResult.error)
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
        if (newData) {
          if (newData.error) {
            // It's an error result
            setError(newData.error)
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
  const renderScore = (score: number) => {
    if (score > 80) return <span>🔴 High Risk</span>
    if (score > 50) return <span>🟡 Moderate</span>
    return <span>🟢 Low Risk</span>
  }

  // --- Hybrid Render Function: Prioritized UI Logic ---
  const renderBody = () => {
    // Priority 1: Loading state
    if (loading) {
      return <div className="text-center p-4">Loading...</div>
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
          <div className="mt-4 p-4 bg-yellow-900/50 border border-yellow-700 text-yellow-200 rounded-lg text-center">
            <p className="font-semibold">{error}</p>
            <p className="text-sm mt-1 mb-3">Upgrade to Pro for more scans.</p>
            <button
              onClick={handleUpgrade}
              className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors">
              Upgrade to Pro
            </button>
            <button
              onClick={handleStartNewScan}
              className="mt-3 w-full py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-colors">
              Start New Scan
            </button>
          </div>
        )
      }

      // Generic error display
      return (
        <div className="mt-4 p-3 bg-red-800 text-red-200 rounded-lg text-sm space-y-3">
          <div>{isActivationError ? error : `Last scan failed: ${error}`}</div>
          <button
            onClick={handleStartNewScan}
            className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-colors">
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
        <div className="mt-4 p-3 bg-gray-700 rounded-lg animate-fade-in">
          <h3 className="text-lg font-bold text-white mb-2">NymAI Analysis</h3>
          
          {/* Authenticity Section - Only show if data exists */}
          {hasAuthenticity && (
            <div className={hasCredibility ? "mb-3" : ""}>
              <p className="text-gray-300">Authenticity (AI Detection):</p>
              <div className="flex justify-between items-center">
                <span className="text-2xl">{authScore}% AI</span>
                {renderScore(authScore)}
              </div>
              <p className="text-sm text-gray-400 italic mt-1">
                "{scanResult?.authenticity?.analysis || "No analysis provided."}"
              </p>
            </div>
          )}
          
          {/* Credibility Section - Only show if data exists */}
          {hasCredibility && (
            <div className={hasAuthenticity ? "border-t border-gray-600 pt-3" : ""}>
              <p className="text-gray-300">Credibility (Factual Truth):</p>
              <div className="flex justify-between items-center">
                <span className="text-2xl">{credRiskScore}% Risk</span>
                {renderScore(credRiskScore)}
              </div>
              <p className="text-sm text-gray-400 italic mt-1">
                "{scanResult?.credibility?.analysis || "No analysis provided."}"
              </p>
              {/* Claims Section */}
              {scanResult?.credibility?.claims?.length > 0 && (
                <div className="mt-3">
                  <p className="text-gray-300 font-medium">Claims Found:</p>
                  {scanResult.credibility.claims.map((claim: any, index: number) => (
                    <div key={index} className="border-l-2 border-yellow-500 pl-2 mt-2">
                      <p className="text-sm text-white">{claim.claim}</p>
                      <p className={`text-xs ${claim.is_true ? "text-green-400" : "text-red-400"}`}>
                        Verdict: {String(claim.is_true).toUpperCase()} - {claim.evidence}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Start New Scan Button */}
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

    // Priority 4: Default state - Mission Control UI (only shown when no results/errors)
    // Special case: YouTube video page shows a scan button
    if (isYouTubeVideo) {
      return (
        <div className="mt-4 p-4 bg-gray-700 rounded-lg text-center">
          <button
            onClick={handleScanYouTubeVideo}
            className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors">
            Scan this YouTube Video
          </button>
        </div>
      )
    }

    // Default: Mission Control buttons
    return (
      <div className="mt-4 space-y-2">
        <button
          onClick={() => activateSelectionMode('credibility')}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors">
          Check Credibility
        </button>
        <button
          onClick={() => activateSelectionMode('authenticity')}
          className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors">
          Check Authenticity
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">
          Or right-click on text/images for quick scans
        </p>
      </div>
    )
  }

  // --- Main Render ---
  return (
    <div className="w-[350px] h-auto p-4 bg-gray-800 font-sans text-gray-100">
      <h1 className="text-2xl font-black text-center mb-4 text-purple-400">
        NymAI
      </h1>
      
      {/* User authentication section */}
      {!userEmail ? (
        <button
          onClick={openLoginPage}
          className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors">
          Log In / Sign Up
        </button>
      ) : (
        <div className="text-center mb-4">
          <p className="text-sm text-green-400">
            Logged in as {userEmail}
          </p>
          <button
            onClick={signOut}
            className="mt-2 text-xs text-purple-400 hover:text-purple-300 underline">
            Sign Out
          </button>
        </div>
      )}

      {/* Hybrid body: Results > Errors > Mission Control */}
      {userEmail && renderBody()}
    </div>
  )
}

export default IndexPopup
