// src/components/LoginForm.tsx
import React, { useState } from "react"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.PLASMO_PUBLIC_SUPABASE_URL as string
const SUPABASE_ANON_KEY = process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY as string
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const storageArea = chrome.storage.session ?? chrome.storage.local

interface LoginFormProps {
  onLoginSuccess: () => void
  onError: (error: string) => void
}

function LoginForm({ onLoginSuccess, onError }: LoginFormProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLogin, setIsLogin] = useState(true) // Toggle between login and signup
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    onError("") // Clear previous errors
    setMessage(null)
    setLoading(true)

    try {
      if (isLogin) {
        // Login
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        })
        if (error) {
          onError(error.message || "Unable to log in with those credentials.")
        } else if (data.session) {
          await storageArea.set({ nymAiSession: data.session })
          onLoginSuccess()
        }
      } else {
        // Signup
        const { data, error } = await supabase.auth.signUp({
          email,
          password
        })
        if (error) {
          onError(error.message || "We could not create your account. Please try again.")
        } else if (data.session) {
          // Auto-confirm is on, user is logged in
          await storageArea.set({ nymAiSession: data.session })
          onLoginSuccess()
        } else if (data.user) {
          // Auto-confirm is off, email confirmation needed
          setMessage("Please check your email to confirm your sign up.")
        }
      }
    } catch (err: any) {
      onError(err.message || "An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  // Handler function for Google Sign-In button
  // This function now orchestrates the OAuth flow by opening the landing page
  // with query parameters. The landing page will handle the actual OAuth initiation.
  const handleGoogleSignIn = async () => {
    // Set loading state to provide user feedback
    setLoading(true)
    onError("") // Clear previous errors
    setMessage(null)

    try {
      // Get the extension's development ID
      const devExtensionId = chrome.runtime.id
      console.log('NymAI: Opening landing page with extension ID:', devExtensionId)

      // Construct the landing page URL with query parameters
      // The landing page will detect these params and initiate OAuth
      const url = `https://www.nymai.io?auth_provider=google&dev_extension_id=${devExtensionId}`

      // Open the landing page in a new tab
      // The landing page will handle saving the extension ID and initiating OAuth
      await chrome.tabs.create({ url: url })

      console.log('NymAI: Landing page opened with OAuth parameters')
      
      // Don't call onLoginSuccess here - wait for the OAuth callback from landing page
      // The loading state will be reset when the OAuth flow completes
    } catch (err: any) {
      console.error('NymAI: Error opening landing page:', err)
      onError(`Login failed: ${err.message || 'Unknown error occurred'}`)
      setLoading(false)
    }
    // Note: We don't set loading to false here because the OAuth flow is asynchronous
    // The loading state will persist until the user completes or cancels the OAuth flow
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleEmailAuth} className="space-y-3">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal"
          required
          disabled={loading}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal"
          required
          disabled={loading}
        />

        {message && <p className="text-green-400 text-xs">{message}</p>}

        <div className="flex space-x-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2 bg-brand-teal hover:bg-brand-tealLight text-brand-dark font-semibold rounded-lg transition-colors disabled:bg-gray-500 disabled:text-white text-sm">
            {loading ? "Loading..." : isLogin ? "Log In" : "Sign Up"}
          </button>
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            disabled={loading}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors disabled:bg-gray-500">
            {isLogin ? "Sign Up" : "Log In"}
          </button>
        </div>
      </form>

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-600" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="px-2 bg-gray-800 text-gray-400">Or continue with</span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-colors flex items-center justify-center disabled:bg-gray-500 text-sm">
        {loading ? "Loading..." : "Sign in with Google"}
      </button>
    </div>
  )
}

export default LoginForm

