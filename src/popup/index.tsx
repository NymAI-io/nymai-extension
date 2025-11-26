// src/popup/index.tsx
import "../style.css"
import React, { useState, useEffect } from "react"
import { createClient } from "@supabase/supabase-js"
import Spinner from "../components/Spinner"
import LoginForm from "../components/LoginForm"

// --- SUPABASE CONFIGURATION ---
const SUPABASE_URL = process.env.PLASMO_PUBLIC_SUPABASE_URL as string
const SUPABASE_ANON_KEY = process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY as string
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const NYMAI_API_BASE_URL = process.env.PLASMO_PUBLIC_NYMAI_API_BASE_URL as string

// Lazy getter for storage area
let _storageArea: chrome.storage.StorageArea | null = null

function getStorageArea(): chrome.storage.StorageArea | null {
  if (_storageArea !== null) return _storageArea
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id || !chrome.storage) {
      _storageArea = null
      return null
    }
    if (chrome.storage.session) {
      _storageArea = chrome.storage.session
      return _storageArea
    }
    _storageArea = null
    return null
  } catch (e) {
    _storageArea = null
    return null
  }
}

function IndexPopup() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  const [scanResult, setScanResult] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string>("")
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)

  // --- Open Login Page ---
  const openLoginPage = () => {
    chrome.tabs.create({ url: 'https://www.nymai.io/login?dev_extension_id=' + chrome.runtime.id })
  }

  // --- Helper to clear badge ---
  const clearBadge = () => {
    try {
      chrome.action.setBadgeText({ text: '' })
    } catch (e) {
      console.warn('NymAI: Failed to clear badge:', e)
    }
  }

  // --- Activate Selection Mode (Single "Analyze" Action) ---
  const handleAnalyze = async () => {
    try {
      setError("")
      // Default to credibility scan which returns unified verdict
      const scanType = 'credibility'

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab.id || !tab.url) {
        setError("Could not get the current tab.")
        return
      }

      const url = new URL(tab.url)
      if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
        setError("Analysis is not available on this page.")
        return
      }

      if (!url.protocol.startsWith('http')) {
        setError("Analysis is only available on web pages.")
        return
      }

      const sendActivationMessage = async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'activate-selection-mode',
            scanType: scanType
          })
          return true
        } catch (error) {
          return false
        }
      }

      let messageSent = await sendActivationMessage()
      if (!messageSent) {
        await new Promise(resolve => setTimeout(resolve, 100))
        messageSent = await sendActivationMessage()
      }

      if (!messageSent) {
        await new Promise(resolve => setTimeout(resolve, 300))
        messageSent = await sendActivationMessage()
        if (!messageSent) {
          setError("Unable to connect to the page. Please reload and try again.")
          return
        }
      }

      window.close()
    } catch (e: any) {
      console.error("Error activating selection mode:", e)
      setError(`Failed to activate analysis: ${e.message || "Unknown error"}`)
    }
  }

  // --- Data Loading ---
  useEffect(() => {
    async function loadPopupData() {
      try {
        const storageAreaInstance = getStorageArea()
        if (!storageAreaInstance) {
          setLoading(false)
          return
        }

        // 1. Restore Session
        const storage = await storageAreaInstance.get("nymAiSession")
        if (storage?.nymAiSession) {
          const { data: sessionData } = await supabase.auth.setSession(storage.nymAiSession)
          if (sessionData?.session) {
            setUserEmail(sessionData.session.user.email)
          } else {
            await storageAreaInstance.remove("nymAiSession")
          }
        }

        // 2. Get User
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setUserEmail(null)
          await storageAreaInstance.remove("nymAiSession")
        } else {
          setUserEmail(user.email)
        }

        // 3. Check Scan Status
        const scanningData = await storageAreaInstance.get("isScanning")
        if (scanningData.isScanning === true) setIsScanning(true)

        // 4. Load Last Result
        const resultData = await storageAreaInstance.get("lastScanResult")
        if (resultData.lastScanResult && !resultData.lastScanResult.error) {
          setScanResult(resultData.lastScanResult)
        }

        // 5. Get Current URL
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.url) setCurrentUrl(tab.url)

      } catch (e) {
        console.error("Error loading popup data:", e)
      } finally {
        setLoading(false)
      }
    }
    loadPopupData()
  }, [])

  // --- Fetch Credits ---
  useEffect(() => {
    async function fetchCredits() {
      if (!userEmail) {
        setCredits(null)
        return
      }
      try {
        const storageAreaInstance = getStorageArea()
        if (!storageAreaInstance) return
        const storage = await storageAreaInstance.get("nymAiSession")
        const session = storage?.nymAiSession
        if (!session?.access_token) return

        const response = await fetch(`${NYMAI_API_BASE_URL}/v1/user/profile`, {
          headers: { Authorization: `Bearer ${session.access_token}` }
        })
        if (response.ok) {
          const data = await response.json()
          setCredits(data.daily_credits_remaining || 0)
        }
      } catch (e) {
        console.error("Error fetching credits:", e)
      }
    }
    fetchCredits()
  }, [userEmail])

  // --- Storage Listener ---
  useEffect(() => {
    if (chrome?.storage?.onChanged) {
      const storageListener = (changes: any) => {
        if (changes.isScanning) setIsScanning(changes.isScanning.newValue === true)
        if (changes.lastScanResult) {
          const newData = changes.lastScanResult.newValue
          setIsScanning(false)
          if (newData && !newData.error) {
            setScanResult(newData)
          }
        }
      }
      chrome.storage.onChanged.addListener(storageListener)
      return () => chrome.storage.onChanged.removeListener(storageListener)
    }
  }, [])

  if (loading) {
    return (
      <div className="w-[350px] h-[450px] bg-zinc-950 flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!userEmail) {
    return (
      <div className="w-[350px] min-h-[450px] bg-zinc-950 text-white p-6 flex flex-col">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-teal-400 to-blue-500 flex items-center justify-center font-bold text-black">N</div>
          <span className="text-xl font-bold tracking-tight">NymAI</span>
        </div>
        <div className="flex-1 flex flex-col justify-center">
          <h2 className="text-2xl font-bold mb-2">Welcome Back</h2>
          <p className="text-zinc-400 mb-6">Sign in to start analyzing content.</p>
          <LoginForm
            onLoginSuccess={() => window.location.reload()}
            onError={(err) => setError(err)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="w-[350px] min-h-[500px] bg-zinc-950 text-white font-sans overflow-hidden flex flex-col relative">
      {/* Background Gradients */}
      <div className="absolute top-[-20%] left-[-20%] w-[300px] h-[300px] bg-teal-500/10 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[300px] h-[300px] bg-purple-500/10 rounded-full blur-[80px] pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 z-10">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-teal-400 to-blue-500 flex items-center justify-center text-xs font-bold text-black shadow-lg shadow-teal-500/20">N</div>
          <span className="text-lg font-bold tracking-tight">NymAI</span>
        </div>
        <button
          onClick={openLoginPage}
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 px-6 flex flex-col gap-6 z-10">

        {/* Analyze Button */}
        <div className="mt-2">
          <button
            onClick={handleAnalyze}
            disabled={isScanning}
            className="group relative w-full h-32 rounded-2xl overflow-hidden transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-teal-900/20"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-teal-500 to-blue-600 opacity-90 group-hover:opacity-100 transition-opacity" />
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20" />

            <div className="relative h-full flex flex-col items-center justify-center gap-3 text-white">
              {isScanning ? (
                <>
                  <Spinner className="text-white" />
                  <span className="font-medium">Analyzing...</span>
                </>
              ) : (
                <>
                  <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm border border-white/20">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold">Analyze Page</div>
                    <div className="text-xs text-teal-100 opacity-80">Select content to verify</div>
                  </div>
                </>
              )}
            </div>
          </button>
        </div>

        {/* Recent Activity */}
        <div className="flex-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3 ml-1">Recent Activity</h3>

          {scanResult ? (
            <div className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-xl p-4 transition-all hover:bg-zinc-900/70">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${scanResult.verdict?.credibility?.status === 'credible' ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-sm font-medium text-zinc-200">Analysis Complete</span>
                </div>
                <span className="text-xs text-zinc-500">Just now</span>
              </div>
              <p className="text-sm text-zinc-400 line-clamp-2 leading-relaxed">
                {scanResult.verdict?.summary || "No summary available."}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs px-2 py-1 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {scanResult.verdict?.credibility?.confidence}% Credible
                </span>
                <span className="text-xs px-2 py-1 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {scanResult.verdict?.authenticity?.confidence}% Authentic
                </span>
              </div>
            </div>
          ) : (
            <div className="h-24 rounded-xl border border-dashed border-zinc-800 flex items-center justify-center text-zinc-600 text-sm">
              No recent analysis
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 flex flex-col items-center gap-2 z-10">
        {credits !== null && (
          <div className="text-xs text-zinc-500">
            {credits} daily credits remaining
          </div>
        )}
        <div className="w-full h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
        <div className="text-[10px] text-zinc-600 pt-2">
          Powered by NymAI
        </div>
      </div>
    </div>
  )
}

export default IndexPopup
