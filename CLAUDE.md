# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Codex-Lens is a visualization tool for Codex that monitors API requests and file system changes. It provides a UI with file explorer, code viewer with diff highlighting, integrated terminal, and Git status.

## Tech Stack

- **Frontend**: React 18, Vite, CodeMirror 6
- **Backend**: Node.js (ESM), Express, WebSocket
- **Terminal**: xterm.js, node-pty
- **File Watching**: chokidar
- **Diff Generation**: diff

## Commands

```bash
npm run dev    # Start Vite dev server (port 5173)
npm run build  # Build with esbuild (backend) + Vite (frontend) -> dist/
npm start      # Run the production CLI from dist/
```

## Architecture

### Backend (src/ - built to dist/)

- **aggregator.js** - Central server class. Coordinates HTTP (port 5174), WebSocket, proxy, file watcher, PTY, and Git. Contains embedded fallback HTML UI.
- **cli.js** - Entry point. Finds Codex binary, creates aggregator, opens browser.
- **proxy.js** - Intercepts OpenAI API requests, parses SSE streams, broadcasts events.
- **watcher.js** - chokidar-based file watcher. Tracks code files, generates diffs on change, emits file_tree updates.
- **pty-manager.js** - Spawns/管理 Codex PTY process via node-pty. Handles terminal I/O and buffering.
- **git-manager.js** - Git operations (status --porcelain, stage, unstage, commit). Debounces status broadcasts.

### Frontend (src/components/)

- **App.jsx** - Main component. Manages tabs, WebSocket connection, file tree, Git status panel.
- **CodeViewer.jsx** - CodeMirror 6 wrapper with syntax highlighting (20+ languages) and diff decoration plugin.
- **TerminalPanel.jsx** - xterm.js terminal connected via WebSocket to backend.

### Communication Flow

1. Frontend connects via WebSocket (`/ws`) to aggregator
2. Aggregator broadcasts file_change, file_tree, git_status events
3. File watcher detects changes -> emits via WebSocket -> App updates state
4. PTY forwards terminal I/O via separate WebSocket (`/ws/terminal`)
5. Git status updates are debounced (500ms) after file changes

### Key Files

- `src/index.html` - HTML entry point served by Vite in dev
- `src/global.css` - Global styles
- `src/lib/logger.js` - Logging utility
- `src/lib/sse-parser.js` - SSE stream parser for proxy
- `src/lib/diff-builder.js` - Diff generation utilities

## Build System

- `build.js` - esbuild bundles each backend file individually (no bundling), Vite builds frontend to `dist/public/`
- `vite.config.js` - Vite configured with src as root, proxies `/ws` and `/api` to port 5174
