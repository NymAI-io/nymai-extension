// This is your main frontend file: popup.tsx
// It imports the CSS file that Plasmo just created
import "style.css" 

import React, { useState } from "react"
import { createClient } from "@supabase/supabase-js"

// ---
// 1. CONFIGURE YOUR KEYS
// ---
// TODO: Replace with your actual Supabase URL and Public Anon Key
const SUPABASE_URL = "https://rpnprnyoylifxxstdxzg.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwbnBybnlveWxpZnh4c3RkeHpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMjkwMTgsImV4cCI6MjA3NzYwNTAxOH0.nk-uMk7TZQWhlrKzwJ2AOobIHeby2FzuGEP92oRxjQc"
// ---

// Create the Supabase client one time
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// This is the address of your local Python server (in WSL)
const BACKEND_API_URL = "http://127.0.0.1:8000/v1/scan"

function IndexPopup() {
  const [user, setUser] = useState<any>(null)
  const [scanResult, setScanResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // ---
  // AUTHENTICATION
  // ---
  const handleLogin = async () => {
    setLoading(true)
    setError("")
    
    // --- THIS IS A DUMMY USER FOR UI TESTING ---
    // You MUST replace this with a real user and token to test the backend
    const dummyUser = {
      id: "bc446d86-e521-4a2e-aeae-dae35cb60d73",
      email: "test@nymai.io",
      token: "eyJhbGciOiJIUzI1NiIsImtpZCI6ImxLaXhPZUpFemI2c1VSQ2giLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3JwbnBybnlveWxpZnh4c3RkeHpnLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJiYzQ0NmQ4Ni1lNTIxLTRhMmUtYWVhZS1kYWUzNWNiNjBkNzMiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzYyMTI0Nzg1LCJpYXQiOjE3NjIxMjExODUsImVtYWlsIjoidGVzdEBueW1haS5pbyIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWxfdmVyaWZpZWQiOnRydWV9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6InBhc3N3b3JkIiwidGltZXN0YW1wIjoxNzYyMTIxMTg1fV0sInNlc3Npb25faWQiOiJjNjUyYjY4MC03NmM1LTQyMmUtYWRhMi1lZWE3NDU5MzgxNTgiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.qIAQ9Bo9V0goH0M7pxwOuXikHshSR77q67VlMdK9efw" 
    }
    
    if (!dummyUser.token || dummyUser.token.length < 50) {
        setLoading(false)
        return
    }

    setUser(dummyUser)
    setLoading(false)
  }

  // ---
  // CORE SCAN LOGIC
  // ---
  const handleScan = async () => {
    if (!user) {
      setError("Please log in first.")
      return
    }

    setLoading(true)
    setScanResult(null)
    setError("")

    // ---
    // TODO: This is our next big task.
    // We will replace this placeholder with a "content script"
    // that gets the *actual* content from the user's active tab.
    // ---
    const contentToScan = {
      content_type: "text",
      content_data: "The stock market will crash...", // <-- This is the fix
    }
    // ---

    try {
      const response = await fetch(BACKEND_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${user.token}`, // Send the Supabase JWT
        },
        body: JSON.stringify(contentToScan),
      })

      const data = await response.json()

      if (response.status !== 200) {
        // This is the NEW, better error line:
        setError(`Error (${response.status}): ${JSON.stringify(data.detail)}`)
      } else {
        // Success!
        setScanResult(data)
      }
    } catch (e) {
      setError("Could not connect to backend API. Is your FastAPI server (in WSL) running?")
    } finally {
      setLoading(false)
    }
  }

  // ---
  // Helper functions to render the UI
  // ---
  const renderScore = (score: number) => {
    if (score > 80) return <span className="text-red-500 font-bold">🔴 High Risk</span>
    if (score > 50) return <span className="text-yellow-500 font-bold">🟡 Moderate</span>
    return <span className="text-green-500 font-bold">🟢 Low Risk</span>
  }

  const renderResult = () => {
    if (!scanResult) return null

    // Use default values if the structure is not what we expect
    const authScore = scanResult?.authenticity?.score ?? 0
    const credScore = scanResult?.credibility?.score ?? 0

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
            <span className="text-2xl">{credScore}% True</span>
            {renderScore(100 - credScore)} {/* Invert logic: High Credibility = Low Risk */}
          </div>
          <p className="text-sm text-gray-400 italic mt-1">
            "{scanResult?.credibility?.analysis || "No analysis provided."}"
          </p>
        </div>

        {scanResult?.credibility?.claims && (
          <div className="mt-3">
            <p className="text-gray-300 font-medium">Claims Found:</p>
            {scanResult.credibility.claims.map((claim: any, index: number) => (
              <div key={index} className="border-l-2 border-yellow-500 pl-2 mt-2">
                <p className="text-sm text-white">{claim.claim}</p>
                <p
                  className={`text-xs ${
                    claim.is_true === true ? "text-green-400" : "text-red-400"
                  }`}>
                  Verdict: {String(claim.is_true).toUpperCase()} - {claim.evidence}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="w-[350px] h-auto p-4 bg-gray-800 font-sans text-gray-100">
      <h1 className="text-2xl font-black text-center mb-4 text-purple-400">NymAI</h1>

      {!user ? (
        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50">
          {loading ? "Logging In..." : "1. Log In (Simulated)"}
        </button>
      ) : (
        <p className="text-sm text-center text-green-400 mb-4">
          Status: Logged in
        </p>
      )}

      <button
        onClick={handleScan}
        disabled={!user || loading}
        className={`w-full py-3 mt-2 font-black rounded-lg transition-all ${
          !user || loading
            ? "bg-gray-600 cursor-not-allowed text-gray-400"
            : "bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/50"
        }`}>
        {loading ? "Scanning Content..." : "2. Run NymAI Scan"}
      </button>

      {error && (
        <div className="mt-4 p-3 bg-red-800 text-red-200 rounded-lg text-sm">
          {error}
        </div>
      )}

      {renderResult()}
    </div>
  )
}

export default IndexPopup