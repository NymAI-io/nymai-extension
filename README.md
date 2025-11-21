# NymAI Chrome Extension

![Plasmo](https://img.shields.io/badge/Plasmo-181717?style=for-the-badge&logo=github&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)

**Clarity in every click.** NymAI is an AI-powered Chrome extension that instantly verifies the authenticity and credibility of any text, image, or video.

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Start development server
pnpm dev
```

Load the extension from `build/chrome-mv3-dev` in Chrome's extension manager.

## Documentation

- **[Setup Guide](docs/setup.md)** - Detailed installation and configuration instructions
- **[State Logic](docs/state_logic.md)** - How the extension handles scanning and displays results

## Features

- 🔍 **Interactive Selection Mode** - Highlight text/images on any webpage
- 📋 **Context Menu Integration** - Right-click to scan selected text
- 🎥 **YouTube Video Analysis** - Analyze video transcripts directly
- 🔐 **Secure Authentication** - Supabase-based auth with session storage
- ⚡ **Real-time Results** - Instant credibility and authenticity scores

## Tech Stack

- **Plasmo Framework** - Modern extension development
- **React 18** - UI library
- **TypeScript** - Type safety
- **Supabase** - Authentication
- **Tailwind CSS** - Styling

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

See [LICENSE](LICENSE) file for details.
