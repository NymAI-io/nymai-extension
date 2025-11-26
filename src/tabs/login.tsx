// src/tabs/login.tsx
import "../style.css"
import React, { useState } from "react"
import { createClient } from "@supabase/supabase-js"
// Define the explicit providers we support
type Provider = "google" | "github";

// --- SUPABASE CONFIGURATION ---
// SECURITY NOTE: These environment variables are intentionally public
// PLASMO_PUBLIC_* variables are bundled into the extension and visible to users
// - SUPABASE_ANON_KEY: Designed to be public, protected by Row Level Security (RLS)
// - SUPABASE_URL: Public endpoint, no sensitive data exposed
const SUPABASE_URL = process.env.PLASMO_PUBLIC_SUPABASE_URL as string
const SUPABASE_ANON_KEY = process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY as string
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// SECURITY FIX: Use session storage only (no local storage fallback)
let storageArea: chrome.storage.StorageArea
if (chrome.storage.session) {
  storageArea = chrome.storage.session
} else {
  console.error('NymAI: chrome.storage.session not available. Session storage is required for security.')
  // Use a no-op storage area that throws errors to prevent accidental use
  storageArea = {
    get: (keys?: any) => Promise.reject(new Error('Session storage is required but not available. Please update Chrome.')),
    set: (items: any) => Promise.reject(new Error('Session storage is required but not available. Please update Chrome.')),
    remove: (keys?: any) => Promise.reject(new Error('Session storage is required but not available. Please update Chrome.')),
    clear: () => Promise.reject(new Error('Session storage is required but not available. Please update Chrome.')),
    getBytesInUse: (keys?: any) => Promise.reject(new Error('Session storage is required but not available. Please update Chrome.')),
    setAccessLevel: (accessOptions: any) => Promise.reject(new Error('Session storage is required but not available. Please update Chrome.')),
    onChanged: {
      addListener: () => { },
      removeListener: () => { },
      hasListener: () => false,
      addRules: () => { },
      getRules: () => { },
      removeRules: () => { }
    } as any
  } as chrome.storage.StorageArea
}

function Login() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })
      if (error) {
        setError("Unable to log in with those credentials.")
      } else if (data.session) {
        await storageArea.set({ nymAiSession: data.session })
        window.close()
      }
    } catch (e) {
      setError("An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password
      })
      if (error) {
        setError("We could not create your account. Please try again.")
      } else if (data.session) {
        // Auto-confirm is on, user is logged in
        await storageArea.set({ nymAiSession: data.session })
        window.close()
      } else if (data.user) {
        // Auto-confirm is off, email confirmation needed
        setMessage("Please check your email to confirm your sign up.")
      }
    } catch (e) {
      setError("An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  const handleOAuthLogin = async (provider: Provider) => {
    setError(null)
    setMessage(null)
    setLoading(true)
    // This will redirect the user to the OAuth provider and then back to this page.
    // The onAuthStateChange listener in the *background script* will handle the session.
    // For now, this just initiates the flow.
    await supabase.auth.signInWithOAuth({ provider })
    // We don't close the window here; the redirect will handle it.
  }

  return (
    <div className="w-full h-screen p-8 bg-white flex justify-center items-start font-sans">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center space-x-2 mb-8">
          <img
            src={chrome.runtime.getURL('NymAI_full_logo.svg')}
            alt="NymAI Logo"
            className="h-12"
            onError={(e) => {
              console.error('Failed to load logo. Attempted URL:', chrome.runtime.getURL('NymAI_full_logo.svg'));
              // Try alternative path
              const altUrl = chrome.runtime.getURL('assets/NymAI_full_logo.svg');
              console.error('Trying alternative URL:', altUrl);
              (e.target as HTMLImageElement).src = altUrl;
            }}
          />
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-teal"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-teal"
            required
          />

          {error && <p className="text-red-600 text-sm">{error}</p>}
          {message && <p className="text-green-600 text-sm">{message}</p>}

          <div className="flex space-x-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-brand-teal hover:bg-brand-tealLight text-brand-dark font-semibold rounded-lg transition-colors disabled:bg-gray-400 disabled:text-white shadow-lg shadow-brand-teal/20">
              {loading ? "Loading..." : "Log In"}
            </button>
            <button
              type="button"
              onClick={handleSignUp}
              disabled={loading}
              className="flex-1 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-lg transition-colors disabled:bg-gray-400">
              {loading ? "Loading..." : "Sign Up"}
            </button>
          </div>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">Or continue with</span>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => handleOAuthLogin("google")}
            disabled={loading}
            className="w-full py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-lg transition-colors flex items-center justify-center disabled:bg-gray-400">
            Sign in with Google
          </button>
        </div>
      </div>
    </div>
  )
}

export default Login
