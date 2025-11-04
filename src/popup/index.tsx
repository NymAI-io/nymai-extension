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
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState(null)
  const [loading, setLoading] = useState(true) // Start in loading state
  const [error, setError] = useState("")
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [isYouTubeVideo, setIsYouTubeVideo] = useState(false)
  const [errorCode, setErrorCode] = useState<number | null>(null)

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
    setError("No scan result found. Right-click on a page to start a scan.")
    setErrorCode(null) // Clear error code
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
        "http://127.0.0.1:8000/v1/create-checkout-session",
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
    } catch (e) {
      setError(`Upgrade failed: ${e.message}`)
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

    try {
      // This logic is similar to runFullScan in background.ts
      const storageData = await chrome.storage.local.get("nymAiSession")
      const session = storageData.nymAiSession
      if (!session || !session.access_token) {
        throw new Error("You must be logged in to scan.")
      }

      const response = await fetch("http://127.0.0.1:8000/v1/scan", {
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
    } catch (e) {
      setError(`Scan failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // --- useEffect HOOK FOR REAL-TIME VALIDATION ---
  useEffect(() => {
    async function loadPopupData() {
      try {
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

        // Load the last scan result
        const resultData = await chrome.storage.local.get("lastScanResult")
        if (resultData.lastScanResult) {
          if (resultData.lastScanResult.error) {
            setError(`Last scan failed: ${resultData.lastScanResult.error}`)
            setErrorCode(resultData.lastScanResult.error_code || null)
            setScanResult(null) // <-- THIS IS THE FIX
          } else {
            setScanResult(resultData.lastScanResult)
          }
        } else {
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
      } catch (e) {
        console.error("Error loading popup data:", e)
        setError("Failed to load data. Please reload the extension.")
      } finally {
        setLoading(false)
      }
    }
    loadPopupData()

    // Set up the storage listener
    const storageListener = (changes: any) => {
      if (changes.lastScanResult) {
        const newData = changes.lastScanResult.newValue
        if (newData.error) {
          setError(`Last scan failed: ${newData.error}`)
          setErrorCode(newData.error_code || null)
          setScanResult(null) // <-- THIS IS THE FIX
        } else {
          setScanResult(newData)
          setError(null)
          setErrorCode(null)
        }
      }
    }
    chrome.storage.onChanged.addListener(storageListener)

    // Cleanup
    return () => chrome.storage.onChanged.removeListener(storageListener)
  }, []) // The empty array ensures this runs only once

  // ---
  // Helper functions to render the UI
  // ---
  const renderScore = (score: number) => {
    if (score > 80) return <span>🔴 High Risk</span>
    if (score > 50) return <span>🟡 Moderate</span>
    return <span>🟢 Low Risk</span>
  }

  const renderResult = () => {
    // Priority 1: Loading state
    if (loading) {
      return <div className="text-center p-4">Loading...</div>;
    }

    // Priority 2: Special UI for YouTube pages (if no result or error yet)
    if (isYouTubeVideo && !scanResult && !error) {
      return (
        <div className="mt-4 p-4 bg-gray-700 rounded-lg text-center">
          <button
            onClick={handleScanYouTubeVideo}
            className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors">
            Scan this YouTube Video
          </button>
        </div>
      );
    }

    // Priority 3: Handle specific, actionable errors (like needing to upgrade)
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
        </div>
      );
    }

    // Priority 4: Handle any other generic error
    if (error) {
      return (
        <div className="mt-4 p-3 bg-red-800 text-red-200 rounded-lg text-sm">
          Last scan failed: {error}
        </div>
      );
    }
    
    // Priority 5: Display the successful scan result
    if (scanResult) {
      const authScore = scanResult?.authenticity?.score ?? 0;
      const credRiskScore = scanResult?.credibility?.risk_score ?? 0;

      return (
        <div className="mt-4 p-3 bg-gray-700 rounded-lg animate-fade-in">
          <h3 className="text-lg font-bold text-white mb-2">NymAI Analysis</h3>
          {/* Authenticity Section */}
          <div className="mb-3">
            <p className="text-gray-300">Authenticity (AI Detection):</p>
            <div className="flex justify-between items-center">
              <span className="text-2xl">{authScore}% AI</span>
              {renderScore(authScore)}
            </div>
            <p className="text-sm text-gray-400 italic mt-1">
              "{scanResult?.authenticity?.analysis || "No analysis provided."}"
            </p>
          </div>
          {/* Credibility Section */}
          <div className="border-t border-gray-600 pt-3">
            <p className="text-gray-300">Credibility (Factual Truth):</p>
            <div className="flex justify-between items-center">
              <span className="text-2xl">{credRiskScore}% Risk</span>
              {renderScore(credRiskScore)}
            </div>
            <p className="text-sm text-gray-400 italic mt-1">
              "{scanResult?.credibility?.analysis || "No analysis provided."}"
            </p>
          </div>
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
      );
    }

    // Priority 6: Default empty/informational state
    return (
      <div className="mt-4 p-4 bg-gray-700/50 rounded-lg text-center text-gray-400">
        <p>Right-click on text or an image to start a scan with NymAI.</p>
      </div>
    );
  }

  // ---
  // RECONSTRUCTED JSX RETURN BLOCK
  // ---
  return (
    <div className="w-[350px] h-auto p-4 bg-gray-800 font-sans text-gray-100">
      <h1 className="text-2xl font-black text-center mb-4 text-purple-400">
        NymAI
      </h1>
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
      {renderResult()}
    </div>
  )
}

export default IndexPopup