# NymAI Chrome Extension

<div align="center">
<img width="1200" height="475" alt="NymAI Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

**Clarity in every click.** NymAI is an AI-powered Chrome extension that instantly verifies the authenticity and credibility of any text, image, or video.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Development](#development)
- [Loading the Extension](#loading-the-extension)
- [Building for Production](#building-for-production)
- [Publishing to Chrome Web Store](#publishing-to-chrome-web-store)
- [Project Structure](#project-structure)
- [Technologies Used](#technologies-used)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have the following installed on your system:

1. **Node.js** (version 18.0.0 or higher)
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify installation: `node --version`
   
2. **npm** (comes with Node.js) or **yarn** or **pnpm**
   - Verify installation: `npm --version`
   - This project uses npm by default
   
3. **Git** (for cloning the repository)
   - Download from [git-scm.com](https://git-scm.com/)
   - Verify installation: `git --version`

4. **Google Chrome Browser** (for testing the extension)
   - Download from [google.com/chrome](https://www.google.com/chrome/)

## Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/your-username/nymai-extension.git
cd nymai-extension
```

### Step 2: Install Dependencies

Install all required npm packages:

```bash
npm install
```

**What this does:**
- Installs Plasmo framework and React dependencies
- Installs Supabase client libraries
- Installs TypeScript and development tools
- Creates a `node_modules` folder with all packages

**Expected output:**
```
added 1234 packages, and audited 1235 packages in 45s
```

**Note:** If you encounter errors, try:
```bash
# Clear npm cache
npm cache clean --force

# Remove node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Step 3: Set Up Environment Variables

**IMPORTANT:** Environment variables are **REQUIRED** for this extension to work.

1. Create a `.env` file in the root directory:

```bash
# On Linux/Mac
touch .env

# On Windows (PowerShell)
New-Item -Path .env -ItemType File
```

2. Add the following variables to your `.env` file:

```env
# Supabase Configuration
# SECURITY NOTE: These values are SAFE TO BE PUBLIC
# PLASMO_PUBLIC_* variables are bundled into the extension and visible to users
# - SUPABASE_ANON_KEY: Designed to be public, protected by Row Level Security (RLS)
# - SUPABASE_URL: Public endpoint, no sensitive data exposed
# - NYMAI_API_BASE_URL: Public API endpoint (protected by authentication)
PLASMO_PUBLIC_SUPABASE_URL=https://rpnprnyoylifxxstdxzg.supabase.co
PLASMO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_BB5Hs1o7Za_hR00TC23GxA__bFgMKqO
PLASMO_PUBLIC_NYMAI_API_BASE_URL=https://nymai-backend.onrender.com
```

**Important Notes:**
- The `.env` file is gitignored and will NOT be committed to the repository
- These values will be bundled into the extension (this is intentional and safe)
- Supabase anon keys are designed to be public - security is provided by RLS policies
- Never commit your `.env` file to version control
- Never put private keys or secrets in `PLASMO_PUBLIC_*` variables

**Getting Your Values:**
- **Supabase URL & Anon Key**: Get from your Supabase project dashboard → Settings → API
- **Backend API URL**: Your NymAI backend API endpoint (e.g., `https://nymai-backend.onrender.com`)

## Development

### Step 1: Start the Development Server

Run the Plasmo development server:

```bash
npm run dev
```

**What happens:**
- Plasmo compiles your extension
- Watches for file changes
- Creates a development build in `build/chrome-mv3-dev`

**Expected output:**
```
Plasmo v0.90.5
✓ Built in 2.3s

  ➜  Extension ID: abcdefghijklmnopqrstuvwxyz123456
  ➜  Build: build/chrome-mv3-dev
  ➜  Watching for changes...
```

**Important:** Note the Extension ID shown in the output - you'll need this for testing.

### Step 2: Load the Extension in Chrome

1. **Open Chrome Extensions Page:**
   - Navigate to `chrome://extensions/`
   - Or: Menu (⋮) → Extensions → Manage Extensions

2. **Enable Developer Mode:**
   - Toggle "Developer mode" switch in the top-right corner

3. **Load the Extension:**
   - Click "Load unpacked" button
   - Navigate to your project folder
   - Select the `build/chrome-mv3-dev` folder
   - Click "Select Folder"

4. **Verify Installation:**
   - You should see the NymAI extension in your extensions list
   - The extension icon should appear in your Chrome toolbar

### Step 3: Test the Extension

1. **Open the Extension Popup:**
   - Click the NymAI icon in your Chrome toolbar
   - The popup should open

2. **Test Features:**
   - Try logging in with email/password
   - Try Google OAuth login
   - Test scanning text/images on web pages
   - Test the context menu (right-click → "Scan selected text with NymAI")

### Development Features

- **Hot Reload**: Changes to files automatically reload the extension
- **TypeScript Support**: Full type checking and IntelliSense
- **React Fast Refresh**: React components update without losing state
- **Source Maps**: Debug with original source code

### Common Development Tasks

**Start development server:**
```bash
npm run dev
```

**Check for TypeScript errors:**
```bash
npx tsc --noEmit
```

**Format code:**
```bash
npx prettier --write .
```

**Reload extension in Chrome:**
- After making changes, click the reload icon (↻) on the extension card in `chrome://extensions/`
- Or use the keyboard shortcut shown in the extension card

## Loading the Extension

### Finding Your Extension ID

When you load the extension, Chrome assigns it a unique Extension ID. You can find it:

1. **In Chrome Extensions Page:**
   - Go to `chrome://extensions/`
   - Find your extension
   - The ID is shown below the extension name

2. **In Development:**
   - The Extension ID is shown in the terminal when you run `npm run dev`

3. **In Extension Code:**
   - Use `chrome.runtime.id` in your code

### Extension ID Usage

The Extension ID is used for:
- OAuth flow with the landing page
- External messaging between web pages and extension
- Identifying the extension in Chrome

**Note:** The Extension ID changes when you load an unpacked extension. For production, you'll get a permanent ID from the Chrome Web Store.

## Building for Production

### Step 1: Create Production Build

Build the extension for production:

```bash
npm run build
```

**What this does:**
- Compiles TypeScript to JavaScript
- Bundles and minifies code
- Optimizes assets
- Runs security manifest script
- Creates production-ready extension in `build/chrome-mv3-prod`

**Expected output:**
```
Plasmo v0.90.5
✓ Built in 5.2s

  ➜  Build: build/chrome-mv3-prod
  ➜  Ready for packaging
```

### Step 2: Package the Extension

Package the extension into a ZIP file:

```bash
npm run package
```

**What this does:**
- Creates a ZIP file ready for Chrome Web Store submission
- Includes all necessary files
- Excludes development files

**Expected output:**
```
✓ Packaged extension: nymai-0.0.1.zip
```

The ZIP file will be in the project root directory.

### Step 3: Test Production Build

Before submitting, test the production build:

1. **Load Production Build:**
   - Go to `chrome://extensions/`
   - Remove the development version
   - Click "Load unpacked"
   - Select `build/chrome-mv3-prod` folder

2. **Test All Features:**
   - Verify all functionality works
   - Test on different websites
   - Test OAuth flow
   - Test all scanning features

## Publishing to Chrome Web Store

### Step 1: Create Chrome Web Store Developer Account

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Pay the one-time $5 registration fee
3. Complete your developer account setup

### Step 2: Prepare Your Extension

1. **Create Production Build:**
   ```bash
   npm run build
   npm run package
   ```

2. **Prepare Store Assets:**
   - Extension icon (128x128 PNG)
   - Screenshots (1280x800 or 640x400 PNG)
   - Promotional images (if applicable)
   - Store description
   - Privacy policy URL

3. **Update Manifest:**
   - Ensure version number is correct in `package.json`
   - Review permissions in `package.json` → `manifest`
   - Ensure all required fields are present

### Step 3: Upload to Chrome Web Store

1. **Go to Developer Dashboard:**
   - Navigate to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - Click "New Item"

2. **Upload ZIP File:**
   - Upload the ZIP file created by `npm run package`
   - Fill in store listing information
   - Add screenshots and description

3. **Submit for Review:**
   - Review all information
   - Submit for review
   - Wait for approval (usually 1-3 days)

### Step 4: Automated Updates (Optional)

This project includes GitHub Actions for automated submission. After your first manual upload:

1. **Set Up GitHub Secrets:**
   - Go to your GitHub repository → Settings → Secrets
   - Add `BPP_TOKEN` (get from [bpp.browser.market](https://bpp.browser.market))

2. **Push to Trigger:**
   - Push changes to your repository
   - GitHub Actions will automatically build and submit updates

See [Plasmo Documentation](https://docs.plasmo.com/framework/workflows/submit) for detailed setup.

## Project Structure

```
nymai-extension/
├── src/
│   ├── background.ts        # Background service worker
│   ├── content.tsx          # Content script (injected into web pages)
│   ├── popup/
│   │   └── index.tsx       # Extension popup UI
│   ├── tabs/
│   │   └── login.tsx       # Login page tab
│   ├── components/
│   │   ├── LoginForm.tsx   # Login form component
│   │   └── Spinner.tsx     # Loading spinner
│   └── style.css           # Global styles
├── assets/                  # Static assets (logos, icons)
│   ├── NymAI_full_logo.svg
│   └── NymAI_icon.svg
├── scripts/
│   └── secure-manifest.js  # Security manifest script
├── build/                  # Build output (gitignored)
│   ├── chrome-mv3-dev/     # Development build
│   └── chrome-mv3-prod/    # Production build
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── .env.example           # Environment variables template
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

## Technologies Used

- **Plasmo Framework** - Extension development framework
- **React 18** - UI library
- **TypeScript** - Type safety
- **Supabase** - Authentication and database
- **Tailwind CSS** - Styling
- **Chrome Extensions API** - Browser extension APIs

## Troubleshooting

### Extension Won't Load

**Error: "Manifest file is missing or unreadable"**
- Ensure you're selecting the `build/chrome-mv3-dev` folder (not the root folder)
- Run `npm run dev` first to create the build folder

**Error: "Could not load extension"**
- Check the browser console for errors: `chrome://extensions/` → Details → "Errors"
- Ensure all dependencies are installed: `npm install`
- Try rebuilding: `rm -rf build node_modules/.plasmo && npm run dev`

### Environment Variables Not Working

**Variables not found:**
- Ensure `.env` file is in the root directory
- Ensure variables start with `PLASMO_PUBLIC_`
- Restart the dev server after changing `.env` file
- Check that `.env` file is not in `.gitignore` (it should be, but verify it exists)

### Extension ID Issues

**Extension ID changes on reload:**
- This is normal for unpacked extensions
- Production extensions get a permanent ID from Chrome Web Store
- Update your backend `CORS_ORIGINS` with the production Extension ID

### Build Errors

**TypeScript errors:**
```bash
npx tsc --noEmit
```

**Module not found:**
```bash
rm -rf node_modules package-lock.json
npm install
```

**Plasmo cache issues:**
```bash
rm -rf node_modules/.plasmo build
npm run dev
```

### OAuth Flow Not Working

1. **Check Extension ID:**
   - Ensure Extension ID matches between extension and landing page
   - For development, use the ID shown in `npm run dev` output

2. **Check Permissions:**
   - Ensure `externally_connectable` matches your landing page URL in `package.json`
   - Check that `host_permissions` includes your Supabase URL

3. **Check Console:**
   - Open Chrome DevTools (F12)
   - Check Console and Network tabs for errors

### Session Storage Issues

**Tokens not persisting:**
- This is intentional - tokens are stored in `chrome.storage.session`
- Tokens clear when browser closes (security feature)
- Check Chrome storage: DevTools → Application → Storage → Chrome Storage

## Security Notes

- **Environment Variables**: Never commit `.env` files
- **Public Variables**: `PLASMO_PUBLIC_*` variables are bundled and visible (this is safe)
- **Session Storage**: Uses `chrome.storage.session` (clears on browser close)
- **Extension ID**: Only injected on trusted domains (nymai.io)
- **Content Script**: Runs on all URLs but only activates on user action

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Test thoroughly in development mode
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

## License

See [LICENSE](LICENSE) file for details.

## Support

For issues and questions:
- Open an issue on GitHub
- Check existing issues and discussions
- Review the [Plasmo Documentation](https://docs.plasmo.com/)

---

**Built with ❤️ for NymAI**
