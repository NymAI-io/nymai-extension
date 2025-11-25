# NymAI Development Setup Guide

This guide will help you set up your development environment for NymAI on a new machine.

## 🛠️ Prerequisites

Install the following tools on your new laptop:

1.  **Git**: [Download Git](https://git-scm.com/downloads)
2.  **Node.js (LTS)**: [Download Node.js](https://nodejs.org/) (Version 20+ recommended)
3.  **Python**: [Download Python](https://www.python.org/downloads/) (Version 3.10+ recommended)
4.  **VS Code / Cursor**: Your preferred code editor.

## 📂 Repository Setup

Create a folder for your projects (e.g., `~/repos/nymai`) and clone the repositories.
*Note: Replace the URLs below with your actual GitHub repository URLs.*

```bash
mkdir nymai
cd nymai

# Clone the repositories
git clone https://github.com/YOUR_ORG/nymai-backend.git
git clone https://github.com/YOUR_ORG/nymai-extension.git
git clone https://github.com/YOUR_ORG/nymai-landing.git
git clone https://github.com/YOUR_ORG/nymai-image-scraper.git
git clone https://github.com/YOUR_ORG/nymai-ops.git
```

## ⚙️ Project Configuration

### 1. Backend (`nymai-backend`)
*Python FastAPI Service*

```bash
cd nymai-backend

# Create virtual environment
python -m venv .venv

# Activate virtual environment
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Setup Environment Variables
# Create a .env file and populate it with your secrets (Supabase keys, OpenAI keys, etc.)
```

### 2. Extension (`nymai-extension`)
*Chrome Extension (Plasmo)*

```bash
cd ../nymai-extension

# Install dependencies
npm install

# Setup Environment Variables
# Create a .env file with:
# PLASMO_PUBLIC_SUPABASE_URL=...
# PLASMO_PUBLIC_SUPABASE_ANON_KEY=...
# PLASMO_PUBLIC_NYMAI_API_BASE_URL=http://localhost:8000
```

### 3. Landing Page (`nymai-landing`)
*Vite + React Website*

```bash
cd ../nymai-landing

# Install dependencies
npm install

# Run locally
npm run dev
```

### 4. Image Scraper (`nymai-image-scraper`)
*Node.js Express Service*

```bash
cd ../nymai-image-scraper

# Install dependencies
npm install

# Run locally
npm run dev
```

## 🚀 Running the Stack Locally

To work on the full system, you'll typically need to run these services simultaneously:

1.  **Backend:** `uvicorn main:app --reload` (in `nymai-backend`)
2.  **Extension:** `npm run dev` (in `nymai-extension`) - Load the `build/chrome-mv3-dev` folder in `chrome://extensions`
3.  **Landing:** `npm run dev` (in `nymai-landing`)

## 🔑 Important: Environment Variables
Since `.env` files are not committed to GitHub, you will need to manually transfer your secrets.
*   **Option A:** Securely copy your `.env` files from your old machine.
*   **Option B:** Re-create them using the `.env.example` files (if available) and your password manager.

## 📝 Verification
Once everything is running:
1.  Open the Landing Page at `http://localhost:5173`
2.  Check the Backend docs at `http://localhost:8000/docs`
3.  Load the Extension in Chrome and try logging in.
