import React, { useState, useEffect, useRef } from 'react';
import { TerminalPanel } from './TerminalPanel';
import { CodeViewer } from './CodeViewer';

export function App() {
  const [files, setFiles] = useState([]);
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [contextMenu, setContextMenu] = useState(null);
  const [version, setVersion] = useState(null);
  const [latestVersion, setLatestVersion] = useState(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    fetchStatus();
    connectWebSocket();
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleKeyDown);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  async function fetchStatus() {
    try {
      const port = window.location.port === '5173' ? '5174' : window.location.port;
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      const response = await fetch(`${protocol}//${window.location.hostname}:${port}/api/status`);
      if (response.ok) {
        const data = await response.json();
        setVersion(data.version);
        setLatestVersion(data.latestVersion);
        setHasUpdate(data.hasUpdate);
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  }

  function handleDocumentClick() {
    setContextMenu(null);
  }

  function handleKeyDown(e) {
    if (!activeTabId) return;

    if (e.ctrlKey && e.key === 'w') {
      e.preventDefault();
      closeTab(activeTabId);
    } else if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        switchToPrevTab();
      } else {
        switchToNextTab();
      }
    }
  }

  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port === '5173' ? '5174' : window.location.port;
    const wsUrl = `${protocol}//${host}:${port}/ws`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Connected to Codex Lens');
      setWsStatus('connected');
    };

    ws.onclose = () => {
      console.log('Disconnected from Codex Lens');
      setWsStatus('disconnected');
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    wsRef.current = ws;
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'file_change':
        handleFileChange(msg.data);
        break;
      case 'file_tree':
        setFiles(msg.data);
        break;
      case 'file_content':
        openFileInTab(msg.data);
        break;
      case 'connected':
        console.log('Server confirmed connection');
        break;
      default:
        console.log('Unknown message type:', msg.type);
    }
  }

  function openFileInTab(data) {
    const fileName = data.path.split(/[/\\]/).pop();
    
    setTabs(prevTabs => {
      const existingTab = prevTabs.find(t => t.path === data.path);
      
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return prevTabs;
      } else {
        const newTab = {
          id: Date.now().toString(),
          path: data.path,
          name: fileName,
          content: data.content,
          diff: data.diff || null,
          isDiff: !!data.diff
        };
        setActiveTabId(newTab.id);
        return [...prevTabs, newTab];
      }
    });
  }

  function handleFileChange(data) {
    const fileName = data.path.split(/[/\\]/).pop();
    
    setTabs(prevTabs => {
      const existingTab = prevTabs.find(t => t.path === data.path);
      
      if (existingTab) {
        const updatedTab = { ...existingTab, content: data.newContent, diff: data.diff, isDiff: true };
        setActiveTabId(existingTab.id);
        return prevTabs.map(t =>
          t.path === data.path ? updatedTab : t
        );
      } else {
        const newTab = {
          id: Date.now().toString(),
          path: data.path,
          name: fileName,
          content: data.newContent,
          diff: data.diff,
          isDiff: true
        };
        setActiveTabId(newTab.id);
        return [...prevTabs, newTab];
      }
    });
  }

  function handleFileClick(path) {
    const existingTab = tabs.find(t => t.path === path);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'open_file', data: path }));
    }
  }

  function closeTab(tabId) {
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId) {
        const newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
        setActiveTabId(newActiveId);
      }
      return newTabs;
    });
  }

  function closeOtherTabs(tabId) {
    setTabs(prev => prev.filter(t => t.id === tabId));
    setActiveTabId(tabId);
  }

  function closeAllTabs() {
    setTabs([]);
    setActiveTabId(null);
  }

  function clearAllDiff() {
    setTabs(prevTabs => prevTabs.map(tab => ({ ...tab, diff: null, isDiff: false })));
  }

  function switchToNextTab() {
    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    if (currentIndex < tabs.length - 1) {
      setActiveTabId(tabs[currentIndex + 1].id);
    } else if (tabs.length > 0) {
      setActiveTabId(tabs[0].id);
    }
  }

  function switchToPrevTab() {
    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    if (currentIndex > 0) {
      setActiveTabId(tabs[currentIndex - 1].id);
    } else if (tabs.length > 0) {
      setActiveTabId(tabs[tabs.length - 1].id);
    }
  }

  function handleContextMenu(e, tabId) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }

  const activeTab = tabs.find(t => t.id === activeTabId);

  return (
    <div className="app-container">
      <div className="top-bar">
        <div className="top-bar-left">
          <span className="top-bar-title">文件浏览器</span>
        </div>
        <div className="top-bar-center">
          <button className="task-btn task-btn-clear" onClick={clearAllDiff} title="清空所有 diff 显示">
            清空 diff
          </button>
        </div>
        <div className="top-bar-right">
          <span className="top-bar-title">Codex 终端</span>
          <span className={`ws-status ${wsStatus}`}></span>
          <span className="version-info">
            {version && <span className="version-number">v{version}</span>}
            {hasUpdate && latestVersion && (
              <span className="update-badge" title={`可用版本: ${latestVersion}`}>
                更新可用
              </span>
            )}
          </span>
        </div>
      </div>
      <div className="main-content">
        <LeftPanel
          files={files}
          activeFile={activeTab?.path || null}
          onFileClick={handleFileClick}
        />
        <div className="panel middle-panel">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabClick={setActiveTabId}
            onTabClose={closeTab}
            onContextMenu={handleContextMenu}
          />
          <div className="panel-content code-panel">
            {!activeTab ? (
              <div className="empty-state">双击左侧文件查看内容...</div>
            ) : (
              <CodeViewer
                content={activeTab.content}
                diff={activeTab.diff}
                isDiff={activeTab.isDiff}
                filePath={activeTab.path}
              />
            )}
          </div>
        </div>
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onCloseTab={() => {
              closeTab(contextMenu.tabId);
              setContextMenu(null);
            }}
            onCloseOtherTabs={() => {
              closeOtherTabs(contextMenu.tabId);
              setContextMenu(null);
            }}
            onCloseAllTabs={() => {
              closeAllTabs();
              setContextMenu(null);
            }}
          />
        )}
        <div className="panel right-panel">
          <div className="terminal-wrapper">
            <TerminalPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onContextMenu }) {
  return (
    <div className="tab-bar">
      {tabs.map(tab => (
        <div
          key={tab.id}
          className={`tab ${activeTabId === tab.id ? 'active' : ''}`}
          onClick={() => onTabClick(tab.id)}
          onContextMenu={(e) => onContextMenu(e, tab.id)}
        >
          <span className="tab-name">{tab.name}</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function ContextMenu({ x, y, onClose, onCloseTab, onCloseOtherTabs, onCloseAllTabs }) {
  return (
    <div className="context-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <div className="context-menu-item" onClick={onCloseTab}>关闭</div>
      <div className="context-menu-item" onClick={onCloseOtherTabs}>关闭其他</div>
      <div className="context-menu-item" onClick={onCloseAllTabs}>关闭所有</div>
    </div>
  );
}

function LeftPanel({ files, activeFile, onFileClick }) {
  const [expandedDirs, setExpandedDirs] = useState({});
  const [contextMenu, setContextMenu] = useState(null);

  function toggleDir(path) {
    setExpandedDirs(prev => ({
      ...prev,
      [path]: !prev[path]
    }));
  }

  function handleContextMenu(e, item) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      item
    });
  }

  function handleCopyPath() {
    if (contextMenu?.item?.path) {
      navigator.clipboard.writeText(contextMenu.item.path).then(() => {
        console.log('Path copied:', contextMenu.item.path);
      }).catch(err => {
        console.error('Failed to copy path:', err);
      });
    }
    setContextMenu(null);
  }

  function handleOpenInExplorer() {
    if (contextMenu?.item?.path) {
      fetch('/api/open-in-explorer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: contextMenu.item.path })
      }).catch(err => {
        console.error('Failed to open in explorer:', err);
      });
    }
    setContextMenu(null);
  }

  function renderFileTree(items, depth = 0) {
    return items.map((item, i) => {
      const isDir = item.type === 'directory';
      const isExpanded = expandedDirs[item.path];
      const indent = 8 + depth * 16;

      return (
        <React.Fragment key={item.path}>
          <div
            className={`file-item ${activeFile === item.path ? 'active' : ''}`}
            onClick={() => isDir ? toggleDir(item.path) : null}
            onDoubleClick={() => !isDir && onFileClick(item.path)}
            onContextMenu={(e) => handleContextMenu(e, item)}
            style={{ paddingLeft: `${indent}px` }}
          >
            <span className="file-icon">
              {isDir ? (isExpanded ? '📂' : '📁') : getFileIcon(item.type)}
            </span>
            <span className="file-name">{item.name}</span>
          </div>
          {isDir && isExpanded && item.children && renderFileTree(item.children, depth + 1)}
        </React.Fragment>
      );
    });
  }

  return (
    <div className="panel left-panel" onClick={() => setContextMenu(null)}>
      <div className="panel-content">
        <div className="section">
          {files.length === 0 ? (
            <div className="empty-state">等待文件变化...</div>
          ) : (
            renderFileTree(files)
          )}
        </div>
      </div>
      {contextMenu && (
        <div
          className="file-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-item" onClick={handleCopyPath}>
            复制文件路径
          </div>
          <div className="context-menu-item" onClick={handleOpenInExplorer}>
            在文件资源管理器中打开
          </div>
        </div>
      )}
    </div>
  );
}

function getFileIcon(type) {
  const icons = {
    '.js': '📜',
    '.jsx': '⚛️',
    '.ts': '📘',
    '.tsx': '⚛️',
    '.py': '🐍',
    '.json': '📋',
    '.css': '🎨',
    '.html': '🌐',
    '.md': '📝',
    '.txt': '📄',
    '.yml': '⚙️',
    '.yaml': '⚙️',
    '.toml': '⚙️',
    '.ini': '⚙️',
    '.env': '🔐',
    '.gitignore': '🙈',
    '.dockerignore': '🐳',
    'default': '📄'
  };
  return icons[type] || icons['default'];
}
