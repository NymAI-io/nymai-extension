# Setup Guide

Complete guide to setting up the NymAI Chrome Extension for development.

## Prerequisites

- **Node.js** 18.0.0 or higher
- **pnpm** (recommended) or npm
- **Google Chrome** browser
- **Git**

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/NymAI-io/nymai-extension.git
cd nymai-extension
```

### 2. Install Dependencies

```bash
pnpm install
# or
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
PLASMO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PLASMO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
PLASMO_PUBLIC_NYMAI_API_BASE_URL=https://your-backend-url.com
```

**Note:** `PLASMO_PUBLIC_*` variables are bundled into the extension and visible to users. This is intentional and safe for Supabase anon keys (protected by RLS).

### 4. Build Development Version

```bash
pnpm dev
# or
npm run dev
```

This creates a development build in `build/chrome-mv3-dev`.

### 5. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `build/chrome-mv3-dev` folder
5. The extension should now appear in your extensions list

### 6. Verify Installation

- Click the NymAI icon in your Chrome toolbar
- The popup should open
- Try logging in or scanning content

## Production Build

```bash
pnpm build
pnpm package
```

This creates a production-ready ZIP file for Chrome Web Store submission.

## Troubleshooting

### Extension Won't Load

- Ensure you're selecting the `build/chrome-mv3-dev` folder (not root)
- Check that `pnpm dev` completed successfully
- Verify all dependencies are installed

### Environment Variables Not Working

- Ensure `.env` file is in the root directory
- Variables must start with `PLASMO_PUBLIC_`
- Restart the dev server after changing `.env`

### Build Errors

```bash
# Clear cache and rebuild
rm -rf build node_modules/.plasmo
pnpm install
pnpm dev
```

