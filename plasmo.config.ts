import type { PlasmoManifest } from "plasmo"

/**
 * Plasmo Configuration
 * 
 * This file provides dynamic manifest configuration based on the build environment.
 * Production builds exclude localhost from externally_connectable for security.
 */

// Check if we're in development mode (not production)
// This ensures localhost is only included when NOT building for production
const isDevelopment = process.env.NODE_ENV !== "production"

const manifest: PlasmoManifest = {
  host_permissions: [
    "https://rpnprnyoylifxxstdxzg.supabase.co/*",
    "https://nymai-backend.onrender.com/*",
    "https://nymai-image-scraper.onrender.com/*"
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self';"
  },
  permissions: [
    "storage",
    "contextMenus",
    "activeTab",
    "scripting",
    "tabs"
  ],
  externally_connectable: {
    matches: [
      "https://www.nymai.io/*",
      "https://nymai.io/*",
      // Only include localhost in development builds
      ...(isDevelopment ? ["http://localhost:*/*"] : [])
    ]
  },
  web_accessible_resources: [
    {
      resources: [
        "NymAI_full_logo.svg",
        "NymAI_icon.svg",
        "assets/NymAI_full_logo.svg",
        "assets/NymAI_icon.svg"
      ],
      matches: ["<all_urls>"]
    }
  ]
}

export default manifest

