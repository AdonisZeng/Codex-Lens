# Codex-Lens

[简体中文](./docs/README_zh.md)

A visualization tool for Codex task management and code review.

## Features

### File Explorer
- Real-time monitoring of project file changes with automatic file tree updates
- Folder expand/collapse support
- Right-click context menu: copy file path, open in file explorer

### Code Viewer
- Syntax highlighting for 20+ programming languages (JavaScript, Python, Java, C/C++, Go, Rust, etc.)
- Line numbers
- Code minimap with draggable slider for scrolling and click-to-jump navigation
- File change diff display showing additions/deletions/modifications

### Terminal Integration
- Built-in terminal for direct interaction with Codex
- Real-time Codex output display
- Terminal input support

### Tab Management
- Multi-file tabbed browsing
- Keyboard shortcuts: `Ctrl+W` close tab, `Ctrl+Tab` switch tabs
- Right-click menu: close, close others, close all

### Other Features
- WebSocket real-time communication with auto-reconnect
- Version detection and update notifications
- Modern dark theme UI

## Prerequisites

Before using Codex-Lens, you need to install Codex:

```bash
npm install -g @openai/codex
```

## Installation

### Install globally via npm

```bash
npm install -g codex-lens
```

### Usage

Run in your project directory:

```bash
codexlens
```

The tool will automatically:
1. Detect the current project root directory
2. Start the Codex process
3. Open the browser interface (http://localhost:5174)

## Updates

### Check for Updates

The tool automatically checks for the latest version on npm when starting. If an update is available, a notification will appear in the top-right corner.

### Manual Update

```bash
npm update -g codex-lens
```

## Tech Stack

- **Frontend**: React 18, Vite, CodeMirror 6
- **Backend**: Node.js, Express, WebSocket
- **Terminal**: xterm.js, node-pty
- **File Watching**: chokidar
- **Diff Generation**: diff

## Development

### Clone the project

```bash
git clone https://github.com/your-username/codex-lens.git
cd codex-lens
```

### Install dependencies

```bash
npm install
```

### Development mode

```bash
# Build the project
npm run build

# Start the service
npm start
```

Development workflow: After modifying code, run `npm run build` to rebuild the project, then run `npm start` to start the service and see the changes.

## License

[MIT](LICENSE)
