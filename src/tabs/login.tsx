// src/tabs/login.tsx
import "../style.css"
import React, { useState } from "react"
import { createClient } from "@supabase/supabase-js"
// Define the explicit providers we support
type Provider = "google" | "github";

// --- CONFIGURE YOUR KEYS (from your .env file) ---
const SUPABASE_URL = "https://rpnprnyoylifxxstdxzg.supabase.co"
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwbnBybnlveWxpZnh4c3RkeHpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMjkwMTgsImV4cCI6MjA3NzYwNTAxOH0.nk-uMk7TZQWhlrKzwJ2AOobIHeby2FzuGEP92oRxjQc"
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

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
        setError(error.message)
      } else if (data.session) {
        await chrome.storage.local.set({ nymAiSession: data.session })
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
        setError(error.message)
      } else if (data.session) {
        // Auto-confirm is on, user is logged in
        await chrome.storage.local.set({ nymAiSession: data.session })
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
    <div className="w-full h-screen p-8 bg-gray-900 flex justify-center items-start font-sans">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-black text-center mb-6 text-purple-400">
          NymAI
        </h1>

        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            required
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {message && <p className="text-green-400 text-sm">{message}</p>}

          <div className="flex space-x-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors disabled:bg-gray-500">
              {loading ? "Loading..." : "Log In"}
            </button>
            <button
              type="button"
              onClick={handleSignUp}
              disabled={loading}
              className="flex-1 py-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition-colors disabled:bg-gray-500">
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
