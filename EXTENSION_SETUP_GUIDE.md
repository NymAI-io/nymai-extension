# Extension Setup Guide - Complete Environment Variables & CORS Configuration

## Important: Extension IDs and Unpacked Extensions

**You DON'T need to publish to Chrome Web Store to test!** Unpacked extensions work perfectly fine.

**However:** Unpacked extensions get a **NEW extension ID every time you reload them** (unless you use a persistent key). This is why CORS might fail.

## Step 1: Get Your Current Extension ID

1. **Load your extension** (dev or prod build):
   - Dev: Load `build/chrome-mv3-dev`
   - Prod: Load `build/chrome-mv3-prod`

2. **Get the Extension ID:**
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Find your extension
   - Copy the **Extension ID** (32-character string like `abcdefghijklmnopqrstuvwxyz123456`)

3. **Check the ID in code:**
   - Open extension popup
   - Press F12 to open DevTools
   - In console, type: `chrome.runtime.id`
   - This shows the current extension ID

## Step 2: Make Extension ID Persistent (Optional but Recommended)

To prevent the ID from changing on reload, add a `key` to your manifest:

1. Generate a key (one-time):
   ```bash
   # Install the tool
   npm install -g chrome-extension-key-generator
   
   # Generate key
   chrome-extension-key-generator
   ```

2. Or use Plasmo's built-in key generation (if available)

3. Add the key to `package.json` under `plasmo`:
   ```json
   {
     "plasmo": {
       "key": "YOUR_GENERATED_KEY_HERE"
     }
   }
   ```

**Note:** This is optional. You can also just update CORS_ORIGINS whenever the ID changes.

## Step 3: Extension Environment Variables

Create a `.env` file in `nymai-extension/`:

```env
# Supabase Configuration (Public - Safe to expose)
PLASMO_PUBLIC_SUPABASE_URL=https://rpnprnyoylifxxstdxzg.supabase.co
PLASMO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_BB5Hs1o7Za_hR00TC23GxA__bFgMKqO

# Backend API URL
PLASMO_PUBLIC_NYMAI_API_BASE_URL=https://nymai-backend.onrender.com
```

**Important:** 
- `PLASMO_PUBLIC_*` variables are bundled into the extension (visible to users)
- This is **intentional and safe** for Supabase anon keys (protected by RLS)
- The API URL is public (protected by authentication)

## Step 4: Backend Environment Variables (Render)

Go to Render Dashboard → `nymai-backend` → Environment:

### Required Variables:

```env
# Environment
ENVIRONMENT=production

# CORS Configuration
# Format: chrome-extension://EXT_ID_1,chrome-extension://EXT_ID_2
# Get extension IDs from chrome://extensions/ after loading unpacked extension
CORS_ORIGINS=chrome-extension://YOUR_EXTENSION_ID_HERE

# Supabase
SUPABASE_URL=https://rpnprnyoylifxxstdxzg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# AI APIs
GEMINI_API_KEY=your_gemini_key
HELICONE_API_KEY=your_helicone_key (optional)
XAI_API_KEY=your_xai_key (optional, for fallback)
OPENAI_API_KEY=your_openai_key (optional, for fallback)

# Other Services
SERPAPI_API_KEY=your_serpapi_key
PROXY_URL=your_proxy_url (optional, for Decodo)
IMAGE_SCRAPER_URL=https://nymai-image-scraper.onrender.com
SUPABASE_STORAGE_BUCKET=your_bucket_name

# Limits (optional, defaults provided)
MAX_IMAGE_SIZE_MB=10
MAX_TEXT_LENGTH=50000
MAX_VIDEO_TRANSCRIPT_LENGTH=100000
```

## Step 5: How to Find Extension ID for CORS

### Method 1: From Chrome Extensions Page
1. Load extension from `build/chrome-mv3-prod` or `build/chrome-mv3-dev`
2. Go to `chrome://extensions/`
3. Copy the Extension ID shown under the extension name

### Method 2: From Extension Console
1. Open extension popup
2. Press F12 (DevTools)
3. In console: `chrome.runtime.id`
4. Copy the ID

### Method 3: From Extension Details
1. Go to `chrome://extensions/`
2. Click "Details" on your extension
3. Extension ID is in the URL: `chrome://extensions/?id=YOUR_EXTENSION_ID`

## Step 6: Update CORS_ORIGINS in Render

1. **Get your extension ID** (from Step 5)
2. **Go to Render Dashboard** → `nymai-backend` → Environment
3. **Edit `CORS_ORIGINS`:**
   ```
   chrome-extension://YOUR_EXTENSION_ID_HERE
   ```
   
   **If you have multiple IDs** (dev + prod), separate with commas:
   ```
   chrome-extension://DEV_ID,chrome-extension://PROD_ID
   ```

4. **Save** - Render will auto-redeploy

## Step 7: Verify It Works

1. **Check backend logs** in Render:
   - Should see: `"CORS configured with 1 allowed origin(s)"` (or more)

2. **Test the extension:**
   - Open extension popup
   - Try scanning something
   - Check browser console (F12) for errors
   - Check Render logs for HTTP 499 errors (should be gone)

## Troubleshooting

### Extension ID Keeps Changing
- **Solution:** Add a `key` to your manifest (see Step 2)
- **Or:** Update CORS_ORIGINS each time you reload

### Still Getting HTTP 499
- **Check:** Extension ID in CORS_ORIGINS matches current ID
- **Check:** Backend logs show CORS is configured
- **Check:** Service worker keep-alive is working (we added this)

### CORS Errors in Browser Console
- **Check:** Extension ID format: `chrome-extension://` (not `chrome-extension:`)
- **Check:** No trailing slashes
- **Check:** Backend has `ENVIRONMENT=production` and `CORS_ORIGINS` set

## Quick Reference: All Environment Variables

### Extension (`.env` file):
- `PLASMO_PUBLIC_SUPABASE_URL`
- `PLASMO_PUBLIC_SUPABASE_ANON_KEY`
- `PLASMO_PUBLIC_NYMAI_API_BASE_URL`

### Backend (Render Dashboard):
- `ENVIRONMENT` (set to `production`)
- `CORS_ORIGINS` (set to `chrome-extension://YOUR_ID`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `SERPAPI_API_KEY`
- `HELICONE_API_KEY` (optional)
- `XAI_API_KEY` (optional)
- `OPENAI_API_KEY` (optional)
- `PROXY_URL` (optional)
- `IMAGE_SCRAPER_URL`
- `SUPABASE_STORAGE_BUCKET`
- `MAX_IMAGE_SIZE_MB` (optional)
- `MAX_TEXT_LENGTH` (optional)
- `MAX_VIDEO_TRANSCRIPT_LENGTH` (optional)

