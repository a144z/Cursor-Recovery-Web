# Cursor Recovery Web

A modern Next.js web application for recovering and viewing Cursor IDE chat conversations from `.vscdb` database files. Built with Next.js 15, TypeScript, Shadcn UI, and **100% client-side processing** - your data never leaves your browser!

## Why This Tool Exists

Cursor IDE is a powerful code editor, but users often encounter situations where their conversation history becomes inaccessible:

- **Conversation Loading Failures** - Sometimes conversations simply won't load in Cursor, leaving you unable to access your chat history
- **Version Update Crashes** - Cursor updates can cause crashes or corruption that prevent conversations from displaying
- **Lost Conversations After Updates** - Many users report losing access to their chat history after Cursor version updates
- **System Resource Issues** - When your C drive is full or RAM is exhausted, Cursor may fail to load conversations properly
- **Database Corruption** - The underlying SQLite database can become corrupted, making conversations inaccessible through the normal interface

This web application provides a **convenient, no-installation solution** to recover your conversations. Simply upload your `.vscdb` file through your browser, and you can:
- View all your conversations in a beautiful chat interface
- Search through your entire conversation history
- Export your conversations as JSON for backup or analysis
- Access your chat history even when Cursor itself can't load it
- **Complete privacy** - All processing happens in your browser, your files never leave your device

No need to install Python, run command-line tools, or have technical expertise - just open the web app and upload your database file.

## Features

- **Easy File Upload** - Drag and drop or select `.vscdb` files to extract conversations
- **Live Search** - Real-time search with dropdown results showing context snippets
- **Chat Interface** - Beautiful bubble-style conversation view with user/AI distinction
- **Smart Copy Button** - Fixed copy button in viewport that tracks the visible message
- **Text Highlighting** - Search terms are highlighted in messages with yellow markers
- **Export Options** - Download conversations as JSON or full raw database data
- **Modern UI** - Built with Shadcn UI components and Tailwind CSS
- **Performance Optimized** - Lightweight, fast filtering, and efficient rendering
- **100% Client-Side** - All processing happens in your browser - no server-side dependencies
- **Privacy-First** - Your files are processed locally and never uploaded to any server

## Quick Start (For Users)

**No installation required!** If you're using the hosted version, simply:
1. Open the web application in your browser
2. Upload your `.vscdb` file (usually located at `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` on macOS, or similar location on Windows/Linux)
3. View and search your conversations
4. Download as JSON if needed

That's it! No Python, no command line, no technical knowledge needed. Everything runs in your browser for maximum privacy and security.

## Development Setup

### Prerequisites

- Node.js 18.17 or later
- npm, yarn, or pnpm

## Getting Started (For Developers)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/a144z/Cursor-Recovery-Web
cd cursor-recovery-web
```

2. Install dependencies:
```bash
npm install
# or
yarn install
# or
pnpm install
```

The `postinstall` script will automatically copy the `sql-wasm.wasm` file to the `public` directory for client-side use.

3. Run the development server:
```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
cursor-recovery-web/
├── app/
│   ├── layout.tsx                 # Root layout
│   ├── page.tsx                   # Main UI component
│   └── globals.css                # Global styles
├── components/
│   └── ui/                        # Shadcn UI components
│       ├── button.tsx
│       ├── input.tsx
│       ├── select.tsx
│       ├── badge.tsx
│       ├── scroll-area.tsx
│       └── ...
├── lib/
│   ├── conversation.ts            # Client-side extraction logic (sql.js)
│   └── utils.ts                   # Utility functions
├── public/
│   └── sql-wasm.wasm              # SQLite WASM binary (auto-copied on install)
├── package.json
├── next.config.ts                 # Next.js configuration with WebAssembly support
├── tailwind.config.ts
└── tsconfig.json
```

## How It Works

1. **Upload** - User uploads a `.vscdb` or `.vscdb.backup` file in the browser
2. **Load** - File is read as an ArrayBuffer entirely in the browser
3. **Process** - SQLite database is parsed using **sql.js** (WebAssembly) - **100% client-side**
4. **Extract** - Messages are extracted from `composer.composerData` or `aiService` data structures
5. **Display** - Conversations are rendered in a chat bubble interface
6. **Search** - Real-time search filters and highlights messages
7. **Export** - Users can download conversations or raw data as JSON

**Important**: All processing happens in your browser. Your files are never sent to any server, ensuring complete privacy and security.

## Key Features

### Live Search

- Type to search through all messages instantly
- Dropdown shows up to 10 results with context snippets
- Click any result to scroll to that message
- Search terms are highlighted in yellow

### Smart Copy Button

- Fixed button in viewport top-right corner
- Automatically tracks which message is currently visible
- Always copies the text from the visible bubble
- Shows checkmark feedback after copying

### Performance Optimizations

- Memoized filtering and search operations
- Efficient Intersection Observer with `requestAnimationFrame`
- Optimized text highlighting without regex overhead
- Single-pass filtering for better performance
- Early exit conditions in search algorithms
- Client-side processing means no network latency

## Dependencies

### Core

- **Next.js 15.4.6** - React framework with App Router
- **React 19.1.0** - UI library
- **TypeScript 5** - Type safety

### Database

- **sql.js 1.13.0** - SQLite compiled to WebAssembly for client-side database processing
  - **NOT using better-sqlite3** - This is a pure client-side solution
  - WASM file is automatically copied to `public/` directory on install

### UI

- **Shadcn UI** - Component library
- **Tailwind CSS 4** - Utility-first CSS
- **Lucide React** - Icons
- **Radix UI** - Accessible component primitives (ScrollArea, Select, etc.)

## Technical Architecture

### Client-Side Processing

This application uses **sql.js** (SQLite compiled to WebAssembly) to process SQLite databases entirely in the browser:

- **No server-side dependencies** - Works perfectly on Vercel, Netlify, or any static hosting
- **No file size limits** - Process files as large as your browser memory allows
- **Privacy-first** - Files never leave the user's device
- **Fast processing** - No network round-trip latency
- **Works offline** - After initial load, can process files without internet

### WebAssembly (WASM)

The SQLite WASM binary (`sql-wasm.wasm`) is:
- Automatically copied to `public/` directory during `npm install` via the `postinstall` script
- Loaded dynamically on first use to avoid blocking initial page load
- Cached in memory to avoid re-downloading on subsequent file uploads

## Development

### Using Turbopack

The project is configured for Turbopack for faster development:

```bash
npm run dev
```

Turbopack is enabled by default in the dev script.

### WebAssembly Support

The `next.config.ts` includes Webpack configuration to:
- Enable WebAssembly experiments
- Provide fallbacks for Node.js modules (fs, path, crypto) when building for the browser
- Ensure sql.js works correctly in the client bundle

## Notes

- **Files are processed entirely in the browser** - no server storage or processing
- **No file size limits from server** - only limited by browser memory
- Extraction uses the same logic as the Python desktop tool
- Supports both `composer.composerData` and `aiService.*` data structures
- Messages are sorted chronologically with timestamp inference
- Works on Vercel, Netlify, and any static hosting platform

## Troubleshooting

### Database Parse Errors

- Ensure the file is a valid `.vscdb` SQLite database
- Check that the database contains conversation data
- Try the `.vscdb.backup` file if available
- Check browser console for detailed error messages

### WASM Loading Issues

- Ensure the `postinstall` script ran successfully (check `public/sql-wasm.wasm` exists)
- Check browser console for WASM fetch errors
- Verify the WASM file is accessible at `/sql-wasm.wasm` in the browser

### Performance Issues

- Large databases (>1000 messages) may take a few seconds to parse
- Search results are limited to 10 for performance
- Consider filtering by role if you have many messages
- Processing happens in browser memory, so very large files may cause memory issues

### Browser Compatibility

- Requires a modern browser with WebAssembly support
- Tested on Chrome, Firefox, Safari, and Edge (latest versions)
- WebAssembly is supported in all modern browsers

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.

## Related Projects

- [Cursor Recovery (Python)](../README.md) - Desktop GUI version of this tool
