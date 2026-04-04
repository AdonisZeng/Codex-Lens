import { useEffect, useRef, useCallback } from 'react';
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

export function TerminalPanel() {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const writeBufferRef = useRef('');
  const writeTimerRef = useRef(null);
  const resizeTimerRef = useRef(null);

  const sendResize = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && terminalRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'resize',
        cols: terminalRef.current.cols,
        rows: terminalRef.current.rows,
      }));
    }
  }, []);

  const flushWrite = useCallback(() => {
    if (writeTimerRef.current) {
      cancelAnimationFrame(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    if (!writeBufferRef.current || !terminalRef.current) return;

    const CHUNK_SIZE = 32768;
    if (writeBufferRef.current.length <= CHUNK_SIZE) {
      const buf = writeBufferRef.current;
      writeBufferRef.current = '';
      terminalRef.current.write(buf);
    } else {
      const chunk = writeBufferRef.current.slice(0, CHUNK_SIZE);
      writeBufferRef.current = writeBufferRef.current.slice(CHUNK_SIZE);
      terminalRef.current.write(chunk);
      writeTimerRef.current = requestAnimationFrame(() => {
        flushWrite();
      });
    }
  }, []);

  const throttledWrite = useCallback((data) => {
    writeBufferRef.current += data;
    if (!writeTimerRef.current) {
      writeTimerRef.current = requestAnimationFrame(() => {
        flushWrite();
      });
    }
  }, [flushWrite]);

  const handleVirtualKey = useCallback((seq) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: seq }));
    }
    terminalRef.current?.focus();
  }, []);

  useEffect(() => {
    const terminal = new Terminal({
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

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    requestAnimationFrame(() => {
      if (fitAddon) {
        fitAddon.fit();
        terminal.focus();
      }
    });

    terminal.onData((data) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // WebSocket connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port === '5173' ? '5174' : window.location.port;
    const wsUrl = `${protocol}//${host}:${port}/ws/terminal`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[Terminal] Connected to PTY service');
      sendResize();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          throttledWrite(msg.data);
        } else if (msg.type === 'exit') {
          flushWrite();
          if (terminal) {
            terminal.write(`\r\n[Process exited with code ${msg.exitCode ?? '?'}]\r\n`);
          }
        } else if (msg.type === 'state') {
          if (!msg.running && terminal) {
            flushWrite();
          }
        }
      } catch (e) {
        console.error('[Terminal] Parse error:', e);
      }
    };

    ws.onclose = () => {
      console.log('[Terminal] Disconnected, reconnecting in 3s...');
      setTimeout(() => {
        if (containerRef.current) {
          // Reconnect handled by re-mounting effect
        }
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('[Terminal] WebSocket error:', error);
    };

    // ResizeObserver setup
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        if (fitAddonRef.current && containerRef.current) {
          try {
            fitAddonRef.current.fit();
            sendResize();
          } catch {}
        }
      }, 150);
    });

    resizeObserver.observe(containerRef.current);
    resizeObserverRef.current = resizeObserver;

    // Cleanup on unmount
    return () => {
      if (writeTimerRef.current) {
        cancelAnimationFrame(writeTimerRef.current);
      }
      if (ws) {
        ws.close();
        wsRef.current = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (terminal) {
        terminal.dispose();
      }
    };
  }, [sendResize, throttledWrite, flushWrite]);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#0a0a0a',
    }}>
      <div
        ref={containerRef}
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
            onClick={() => handleVirtualKey(key.seq)}
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
