import React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const VIRTUAL_KEYS = [
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '←', seq: '\x1b[D' },
  { label: '→', seq: '\x1b[C' },
  { label: 'Enter', seq: '\r' },
  { label: 'Tab', seq: '\t' },
  { label: 'Esc', seq: '\x1b' },
  { label: 'Ctrl+C', seq: '\x03' },
];

export class TerminalPanel extends React.Component {
  constructor(props) {
    super(props);
    this.containerRef = React.createRef();
    this.terminal = null;
    this.fitAddon = null;
    this.ws = null;
    this.resizeObserver = null;
    this._writeBuffer = '';
    this._writeTimer = null;
  }

  componentDidMount() {
    this.initTerminal();
    this.connectWebSocket();
    this.setupResizeObserver();
  }

  componentWillUnmount() {
    if (this._writeTimer) {
      cancelAnimationFrame(this._writeTimer);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.terminal) {
      this.terminal.dispose();
    }
  }

  initTerminal() {
    this.terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
      },
      scrollback: 3000,
      allowProposedApi: true,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    this.terminal.open(this.containerRef.current);

    requestAnimationFrame(() => {
      if (this.fitAddon) {
        this.fitAddon.fit();
        this.terminal.focus();
      }
    });

    this.terminal.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port === '5173' ? '5174' : window.location.port;
    const wsUrl = `${protocol}//${host}:${port}/ws/terminal`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[Terminal] Connected to PTY service');
      this.sendResize();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          this._throttledWrite(msg.data);
        } else if (msg.type === 'exit') {
          this._flushWrite();
          if (this.terminal) {
            this.terminal.write(`\r\n[Process exited with code ${msg.exitCode ?? '?'}]\r\n`);
          }
        } else if (msg.type === 'state') {
          if (!msg.running && this.terminal) {
            this._flushWrite();
          }
        }
      } catch (e) {
        console.error('[Terminal] Parse error:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('[Terminal] Disconnected, reconnecting in 3s...');
      setTimeout(() => {
        if (this.containerRef.current) {
          this.connectWebSocket();
        }
      }, 3000);
    };

    this.ws.onerror = (error) => {
      console.error('[Terminal] WebSocket error:', error);
    };
  }

  sendResize() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.terminal) {
      this.ws.send(JSON.stringify({
        type: 'resize',
        cols: this.terminal.cols,
        rows: this.terminal.rows,
      }));
    }
  }

  setupResizeObserver() {
    if (!this.containerRef.current) return;

    this.resizeObserver = new ResizeObserver(() => {
      if (this._resizeTimer) clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        if (this.fitAddon && this.containerRef.current) {
          try {
            this.fitAddon.fit();
            this.sendResize();
          } catch {}
        }
      }, 150);
    });

    this.resizeObserver.observe(this.containerRef.current);
  }

  _throttledWrite(data) {
    this._writeBuffer += data;
    if (!this._writeTimer) {
      this._writeTimer = requestAnimationFrame(() => {
        this._flushWrite();
      });
    }
  }

  _flushWrite() {
    if (this._writeTimer) {
      cancelAnimationFrame(this._writeTimer);
      this._writeTimer = null;
    }
    if (!this._writeBuffer || !this.terminal) return;

    const CHUNK_SIZE = 32768;
    if (this._writeBuffer.length <= CHUNK_SIZE) {
      const buf = this._writeBuffer;
      this._writeBuffer = '';
      this.terminal.write(buf);
    } else {
      const chunk = this._writeBuffer.slice(0, CHUNK_SIZE);
      this._writeBuffer = this._writeBuffer.slice(CHUNK_SIZE);
      this.terminal.write(chunk);
      this._writeTimer = requestAnimationFrame(() => {
        this._flushWrite();
      });
    }
  }

  handleVirtualKey = (seq) => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data: seq }));
    }
    this.terminal?.focus();
  };

  render() {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#0a0a0a',
      }}>
        <div
          ref={this.containerRef}
          style={{
            flex: 1,
            overflow: 'hidden',
            padding: '4px 8px',
          }}
        />
        <div style={{
          display: 'flex',
          gap: '4px',
          padding: '8px',
          background: '#111',
          borderTop: '1px solid #222',
          flexWrap: 'wrap',
        }}>
          {VIRTUAL_KEYS.map((key) => (
            <button
              key={key.label}
              onClick={() => this.handleVirtualKey(key.seq)}
              style={{
                padding: '8px 12px',
                border: '1px solid #333',
                borderRadius: '4px',
                background: '#1a1a1a',
                color: '#ccc',
                fontSize: '13px',
                fontFamily: 'Menlo, Monaco, monospace',
                cursor: 'pointer',
                minWidth: '44px',
                minHeight: '44px',
              }}
            >
              {key.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
}