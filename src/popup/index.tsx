// src/popup.tsx
import "style.css"
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

  // This function opens our login.tsx tab
  const openLoginPage = () => {
    // This command dynamically finds the correct URL for our login page
    // and is the correct way to do this.
    chrome.tabs.create({ url: chrome.runtime.getURL("tabs/login.html") });
  }

  // --- NEW: Sign out function ---
  const signOut = async () => {
    // 1. Sign out from Supabase
    await supabase.auth.signOut()
    // 2. Clear the local storage
    await chrome.storage.local.remove("nymAiSession")
    // 3. Update the UI state
    setUserEmail(null)
    setScanResult(null) // Also clear scan results on logout
    setError("No scan result found. Right-click on a page to start a scan.")
  }

  // --- NEW: Upgrade to Pro function ---
  const handleUpgrade = async () => {
    try {
      // 1. Get the user's session from storage to get the auth token
      const storageData = await chrome.storage.local.get("nymAiSession");
      const session = storageData.nymAiSession;

      if (!session || !session.access_token) {
        setError("You must be logged in to upgrade.");
        return;
      }

      // 2. Call our *new* backend endpoint to create a checkout session
      const response = await fetch("http://127.0.0.1:8000/v1/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Send the user's auth token
          "Authorization": `Bearer ${session.access_token}`
        }
      });

      const data = await response.json();

      if (response.status !== 200) {
        throw new Error(data.detail || "Failed to create checkout session.");
      }

      // 3. Open the real Stripe checkout URL in a new tab
      if (data.url) {
        chrome.tabs.create({ url: data.url });
      }

    } catch (e) {
      setError(`Upgrade failed: ${e.message}`);
    }
  }

  // ---
  // REPAIRED useEffect HOOK FOR REAL-TIME VALIDATION
  // ---
  useEffect(() => {
    // 1. Create an async function inside useEffect
    async function loadPopupData() {
      try {
        // 1. Use getUser() to FORCE a server-side check.
        // This will fail if the user was deleted in the dashboard.
        const {
          data: { user },
          error: userError
        } = await supabase.auth.getUser()

        if (userError || !user) {
          // This is the new "logged out" state.
          setUserEmail(null)
          await chrome.storage.local.remove("nymAiSession") // Clean up our stale session
        } else {
          // User is 100% valid. NOW we can get the session for our background script.
          const {
            data: { session }
          } = await supabase.auth.getSession()

          if (session) {
            // User is logged in and session is valid
            setUserEmail(session.user.email)
            await chrome.storage.local.set({ nymAiSession: session }) // Refresh local storage
          } else {
            // This should be impossible if getUser() succeeded, but it's a safe fallback.
            setUserEmail(null)
            await chrome.storage.local.remove("nymAiSession")
          }
        }

        // 3. Load the last scan result (this part remains the same)
        const resultData = await chrome.storage.local.get("lastScanResult")
        if (resultData.lastScanResult) {
          if (resultData.lastScanResult.error) {
            setError(`Last scan failed: ${resultData.lastScanResult.error}`)
          } else {
            setScanResult(resultData.lastScanResult)
          }
        } else {
          setError(
            "No scan result found. Right-click on a page to start a scan."
          )
        }
      } catch (e) {
        // --- THIS IS THE REPAIRED CATCH BLOCK ---
        console.error("Error loading popup data:", e)
        setError("Failed to load data. Please reload the extension.")
      } finally {
        // 4. THIS IS KEY: Set loading to false *after* all async work is done
        setLoading(false)
      }
    }
    // 5. Call the async function
    loadPopupData()

    // 6. Set up the storage listener
    const storageListener = (changes: any) => {
      if (changes.lastScanResult) {
        const newData = changes.lastScanResult.newValue
        if (newData.error) {
          setError(`Last scan failed: ${newData.error}`)
        } else {
          setScanResult(newData)
          setError(null) // Clear old errors
        }
      }
    }
    chrome.storage.onChanged.addListener(storageListener)

    // Cleanup
    return () => chrome.storage.onChanged.removeListener(storageListener)
  }, []) // The empty array still ensures this runs only once

  // ---
  // Helper functions to render the UI
  // ---
  const renderScore = (score: number) => {
    if (score > 80) return <span>🔴 High Risk</span>
    if (score > 50) return <span>🟡 Moderate</span>
    return <span>🟢 Low Risk</span>
  }

  const renderResult = () => {
    if (loading) {
      return <div className="text-center p-4">Loading result...</div>
    }
    if (error && !scanResult) {
      // --- NEW: Check for 402 Payment Required error ---
      if (error.includes("402")) {
        return (
          <div className="mt-4 p-4 bg-yellow-900/50 border border-yellow-700 text-yellow-200 rounded-lg text-center">
            <p className="font-semibold">
              You're out of Video Scan credits.
            </p>
            <p className="text-sm mt-1 mb-3">Upgrade to Pro for more.</p>
            <button
              onClick={handleUpgrade}
              className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors">
              Upgrade to Pro
            </button>
          </div>
        )
      }
      // --- Fallback to the generic error display ---
      return (
        <div className="mt-4 p-3 bg-red-800 text-red-200 rounded-lg text-sm">
          {error}
        </div>
      )
    }
    if (!scanResult) return null

    const authScore = scanResult?.authenticity?.score ?? 0
    const credRiskScore = scanResult?.credibility?.risk_score ?? 0

    return (
      <div className="mt-4 p-3 bg-gray-700 rounded-lg animate-fade-in">
        <h3 className="text-lg font-bold text-white mb-2">NymAI Analysis</h3>

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

        {scanResult?.credibility?.claims && (
          <div className="mt-3">
            <p className="text-gray-300 font-medium">Claims Found:</p>
            {scanResult.credibility.claims.map((claim: any, index: number) => (
              <div
                key={index}
                className="border-l-2 border-yellow-500 pl-2 mt-2">
                <p className="text-sm text-white">{claim.claim}</p>
                <p
                  className={`text-xs ${
                    claim.is_true === true ? "text-green-400" : "text-red-400"
                  }`}>
                  Verdict: {String(claim.is_true).toUpperCase()} -
                  {claim.evidence}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    )
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
