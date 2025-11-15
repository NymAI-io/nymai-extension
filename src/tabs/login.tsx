// src/tabs/login.tsx
import "../style.css"
import React, { useState } from "react"
import { createClient } from "@supabase/supabase-js"
// Define the explicit providers we support
type Provider = "google" | "github";

// --- CONFIGURE YOUR KEYS (from your .env file) ---
const SUPABASE_URL = process.env.PLASMO_PUBLIC_SUPABASE_URL as string
const SUPABASE_ANON_KEY = process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY as string
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const storageArea = chrome.storage.session ?? chrome.storage.local

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
    <div className="w-full h-screen p-8 bg-gradient-to-b from-gray-900 to-gray-800 flex justify-center items-start font-sans">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center space-x-2 mb-8">
          <div className="w-10 h-10 bg-gradient-to-br from-brand-teal to-brand-tealLight rounded-lg flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="6" fill="url(#gradient)"/>
              <defs>
                <linearGradient id="gradient" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#4fd1c5"/>
                  <stop offset="100%" stopColor="#81e6d9"/>
                </linearGradient>
              </defs>
              <path d="M8 10 L8 22 M8 10 L20 22 M20 10 L20 22" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          </div>
          <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-brand-teal to-brand-tealLight">
            NymAI
          </h1>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-brand-teal"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-brand-teal"
            required
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {message && <p className="text-green-400 text-sm">{message}</p>}

          <div className="flex space-x-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-brand-teal hover:bg-brand-tealLight text-brand-dark font-semibold rounded-lg transition-colors disabled:bg-gray-500 disabled:text-white shadow-lg shadow-brand-teal/20">
              {loading ? "Loading..." : "Log In"}
            </button>
            <button
              type="button"
              onClick={handleSignUp}
              disabled={loading}
              className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-colors disabled:bg-gray-500">
              {loading ? "Loading..." : "Sign Up"}
            </button>
          </div>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-600" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-gray-900 text-gray-400">Or continue with</span>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => handleOAuthLogin("google")}
            disabled={loading}
            className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-colors flex items-center justify-center disabled:bg-gray-500">
            Sign in with Google
          </button>
        </div>
      </div>
    </div>
  )
}

export default Login
