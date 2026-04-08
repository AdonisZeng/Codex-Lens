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
  const [projectName, setProjectName] = useState('');
  const [saving, setSaving] = useState(false);
  const [gitInfo, setGitInfo] = useState({
    isRepo: false,
    branch: null,
    status: null,
    stagedCount: 0,
    unstagedCount: 0
  });
  const [showStagedPanel, setShowStagedPanel] = useState(false);
  const [gitOperationLoading, setGitOperationLoading] = useState(false);
  const [gitOperationType, setGitOperationType] = useState(null);
  const [toast, setToast] = useState(null);
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
        if (data.projectRoot) {
          const parts = data.projectRoot.split(/[/\\]/);
          setProjectName(parts[parts.length - 1] || data.projectRoot);
        }
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
    } else if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab && activeTab.modified) {
        saveFile(activeTabId);
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
      case 'git_status':
        setGitInfo({
          isRepo: msg.data.isRepo,
          branch: msg.data.branch,
          status: msg.data.status,
          stagedCount: msg.data.stagedCount,
          unstagedCount: msg.data.unstagedCount
        });
        break;
      case 'git_operation_result':
        setGitOperationLoading(false);
        setGitOperationType(null);
        setToast({ type: msg.success ? 'success' : 'error', message: msg.message });
        break;
      case 'connected':
        console.log('Server confirmed connection');
        break;
      default:
        console.log('Unknown message type:', msg.type);
    }
  }

  function sendGitCommand(type, payload) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...payload }));
    }
  }

  function handleStage(path) {
    sendGitCommand('git_stage', { filePath: path });
  }

  function handleUnstage(path) {
    sendGitCommand('git_unstage', { filePath: path });
  }

  function handleCommit(message) {
    sendGitCommand('git_commit', { message });
  }

  function handleGitOperation(operationType) {
    setGitOperationLoading(true);
    setGitOperationType(operationType);
    sendGitCommand(`git_${operationType}`, {});
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
          originalContent: data.content,
          diff: data.diff || null,
          isDiff: !!data.diff,
          modified: false
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
        const updatedTab = { 
          ...existingTab, 
          content: data.newContent, 
          originalContent: data.newContent,
          diff: data.diff, 
          isDiff: true,
          modified: false
        };
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
          originalContent: data.newContent,
          diff: data.diff,
          isDiff: true,
          modified: false
        };
        setActiveTabId(newTab.id);
        return [...prevTabs, newTab];
      }
    });
  }

  function handleContentChange(tabId, newContent) {
    setTabs(prevTabs => prevTabs.map(tab => {
      if (tab.id === tabId) {
        const modified = newContent !== tab.originalContent;
        return { ...tab, content: newContent, modified };
      }
      return tab;
    }));
  }

  async function saveFile(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab || !tab.modified) return;

    setSaving(true);
    try {
      const port = window.location.port === '5173' ? '5174' : window.location.port;
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      const response = await fetch(`${protocol}//${window.location.hostname}:${port}/api/save-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tab.path, content: tab.content })
      });

      if (response.ok) {
        setTabs(prevTabs => prevTabs.map(t => {
          if (t.id === tabId) {
            return { ...t, originalContent: t.content, modified: false };
          }
          return t;
        }));
        console.log('File saved:', tab.path);
      } else {
        const error = await response.json();
        console.error('Failed to save file:', error.message);
        alert('保存失败: ' + error.message);
      }
    } catch (error) {
      console.error('Failed to save file:', error);
      alert('保存失败: ' + error.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveAllFiles() {
    const modifiedTabs = tabs.filter(t => t.modified);
    if (modifiedTabs.length === 0) return;

    setSaving(true);
    const port = window.location.port === '5173' ? '5174' : window.location.port;
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

    let savedCount = 0;
    let failedFiles = [];

    for (const tab of modifiedTabs) {
      try {
        const response = await fetch(`${protocol}//${window.location.hostname}:${port}/api/save-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: tab.path, content: tab.content })
        });

        if (response.ok) {
          savedCount++;
        } else {
          const error = await response.json();
          failedFiles.push(tab.name);
          console.error('Failed to save file:', tab.name, error.message);
        }
      } catch (error) {
        failedFiles.push(tab.name);
        console.error('Failed to save file:', tab.name, error);
      }
    }

    if (savedCount > 0) {
      setTabs(prevTabs => prevTabs.map(t => {
        if (t.modified && !failedFiles.includes(t.name)) {
          return { ...t, originalContent: t.content, modified: false };
        }
        return t;
      }));
    }

    if (failedFiles.length > 0) {
      alert(`以下文件保存失败: ${failedFiles.join(', ')}`);
    }

    setSaving(false);
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
    const tab = tabs.find(t => t.id === tabId);
    if (tab?.modified) {
      const confirmed = window.confirm(`文件 "${tab.name}" 已修改，是否保存？`);
      if (confirmed) {
        saveFile(tabId);
      }
    }
    
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
    setTabs(prev => {
      const tabsToClose = prev.filter(t => t.id !== tabId);
      tabsToClose.forEach(t => {
        if (t.modified) {
          const confirmed = window.confirm(`文件 "${t.name}" 已修改，是否保存？`);
          if (confirmed) {
            saveFile(t.id);
          }
        }
      });
      return prev.filter(t => t.id === tabId);
    });
    setActiveTabId(tabId);
  }

  function closeAllTabs() {
    tabs.forEach(t => {
      if (t.modified) {
        const confirmed = window.confirm(`文件 "${t.name}" 已修改，是否保存？`);
        if (confirmed) {
          saveFile(t.id);
        }
      }
    });
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
          <span className="top-bar-title">当前工作区: {projectName}</span>
        </div>
        <div className="top-bar-center">
          {gitInfo.isRepo && (
            <div className="git-status-bar">
              <span className="git-branch">
                <span className="git-branch-icon">⎇</span>
                {gitInfo.branch || 'main'}
              </span>
              <div className="git-stats">
                <span className="git-staged" title="已暂存">
                  <span className="git-staged-count">{gitInfo.stagedCount}</span>
                  <span className="git-staged-label">已暂存</span>
                </span>
                <span className="git-unstaged" title="未暂存">
                  <span className="git-unstaged-count">{gitInfo.unstagedCount}</span>
                  <span className="git-unstaged-label">未暂存</span>
                </span>
              </div>
              <button
                className="git-changes-btn"
                onClick={() => setShowStagedPanel(!showStagedPanel)}
              >
                {showStagedPanel ? '隐藏变更' : '查看变更'}
              </button>
            </div>
          )}
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
          gitInfo={gitInfo}
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
                onChange={(value) => handleContentChange(activeTabId, value)}
              />
            )}
          </div>
        </div>
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            tab={tabs.find(t => t.id === contextMenu.tabId)}
            tabs={tabs}
            saving={saving}
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
            onSave={() => {
              saveFile(contextMenu.tabId);
              setContextMenu(null);
            }}
            onSaveAll={() => {
              saveAllFiles();
              setContextMenu(null);
            }}
          />
        )}
        {showStagedPanel && gitInfo.isRepo && (
          <StagedChangesPanel
            gitInfo={gitInfo}
            onStage={handleStage}
            onUnstage={handleUnstage}
            onCommit={handleCommit}
            onPush={() => handleGitOperation('push')}
            onPull={() => handleGitOperation('pull')}
            onFetch={() => handleGitOperation('fetch')}
            operationLoading={gitOperationLoading}
            operationType={gitOperationType}
            onClose={() => setShowStagedPanel(false)}
          />
        )}
        <Toast toast={toast} onClose={() => setToast(null)} />
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
          className={`tab ${activeTabId === tab.id ? 'active' : ''} ${tab.modified ? 'modified' : ''}`}
          onClick={() => onTabClick(tab.id)}
          onContextMenu={(e) => onContextMenu(e, tab.id)}
        >
          <span className="tab-name">
            {tab.modified && <span className="tab-modified-mark">●</span>}
            {tab.name}
          </span>
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

function ContextMenu({ x, y, tab, tabs, saving, onClose, onCloseTab, onCloseOtherTabs, onCloseAllTabs, onSave, onSaveAll }) {
  const hasModified = tabs?.some(t => t.modified);
  
  return (
    <div className="context-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {tab?.modified && (
        <div className="context-menu-item" onClick={onSave} style={{ color: '#4ade80' }}>
          {saving ? '保存中...' : '保存'}
        </div>
      )}
      {hasModified && (
        <div className="context-menu-item" onClick={onSaveAll} style={{ color: '#4ade80' }}>
          {saving ? '保存中...' : '全部保存'}
        </div>
      )}
      <div className="context-menu-item" onClick={onCloseTab}>关闭</div>
      <div className="context-menu-item" onClick={onCloseOtherTabs}>关闭其他</div>
      <div className="context-menu-item" onClick={onCloseAllTabs}>关闭所有</div>
    </div>
  );
}

function Toast({ toast, onClose }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (toast) {
      timerRef.current = setTimeout(onClose, 4000);
    }
    return () => clearTimeout(timerRef.current);
  }, [toast, onClose]);

  if (!toast) return null;

  return (
    <div className={`toast toast-${toast.type}`}>
      <span className="toast-icon">{toast.type === 'success' ? '✓' : '✗'}</span>
      <span className="toast-message">{toast.message}</span>
      <button className="toast-close" onClick={onClose}>×</button>
    </div>
  );
}

function StagedChangesPanel({ gitInfo, onStage, onUnstage, onCommit, onPush, onPull, onFetch, operationLoading, operationType, onClose }) {
  if (!gitInfo.isRepo || !gitInfo.status) return null;

  const { staged, unstaged, untracked } = gitInfo.status;

  return (
    <div className="staged-changes-panel">
      <div className="staged-panel-header">
        <span>Git 变更</span>
        <div className="staged-panel-actions">
          <button onClick={onFetch} className="git-action-btn" disabled={operationLoading} title="Fetch from remote">
            {operationLoading && operationType === 'fetch' ? '...' : 'Fetch'}
          </button>
          <button onClick={onPull} className="git-action-btn" disabled={operationLoading} title="Pull from remote">
            {operationLoading && operationType === 'pull' ? '...' : 'Pull'}
          </button>
          <button onClick={onPush} className="git-action-btn git-push-btn" disabled={operationLoading} title="Push to remote">
            {operationLoading && operationType === 'push' ? '...' : 'Push'}
          </button>
          <span className="panel-divider"></span>
          <button onClick={() => onStage(null)} className="stage-btn">Stage All</button>
          <button onClick={() => onUnstage(null)} className="unstage-btn">Unstage All</button>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
      </div>

      {staged?.length > 0 && (
        <div className="changes-section">
          <div className="changes-section-header">
            <span className="changes-section-title">已暂存 ({staged.length})</span>
          </div>
          <div className="changes-list">
            {staged.map((file, i) => (
              <div key={i} className="change-item staged" onClick={() => onUnstage(file.path)}>
                <span className="change-icon">✓</span>
                <span className={`change-status ${file.indexStatus}`}>{file.indexStatus}</span>
                <span className="change-path">{file.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {unstaged?.length > 0 && (
        <div className="changes-section">
          <div className="changes-section-header">
            <span className="changes-section-title">未暂存修改 ({unstaged.length})</span>
          </div>
          <div className="changes-list">
            {unstaged.map((file, i) => (
              <div key={i} className="change-item" onClick={() => onStage(file.path)}>
                <span className="change-icon">○</span>
                <span className={`change-status ${file.workTreeStatus}`}>{file.workTreeStatus}</span>
                <span className="change-path">{file.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {untracked?.length > 0 && (
        <div className="changes-section">
          <div className="changes-section-header">
            <span className="changes-section-title">未跟踪 ({untracked.length})</span>
          </div>
          <div className="changes-list">
            {untracked.map((file, i) => (
              <div key={i} className="change-item untracked" onClick={() => onStage(file.path)}>
                <span className="change-icon">?</span>
                <span className="change-status">?</span>
                <span className="change-path">{file.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {((!staged?.length) && (!unstaged?.length) && (!untracked?.length)) && (
        <div className="no-changes">无变更</div>
      )}

      {staged?.length > 0 && (
        <div className="commit-section">
          <input type="text" className="commit-input" placeholder="提交信息..." id="commit-message" />
          <button className="commit-btn" onClick={() => {
            const msg = document.getElementById('commit-message')?.value;
            if (msg) onCommit(msg);
          }}>
            Commit
          </button>
        </div>
      )}
    </div>
  );
}

function LeftPanel({ files, activeFile, onFileClick, gitInfo }) {
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

      // Get file git status
      let fileGitStatus = null;
      if (!isDir && gitInfo.status) {
        fileGitStatus = gitInfo.status.staged?.find(f => f.path === item.path) ||
                       gitInfo.status.unstaged?.find(f => f.path === item.path) ||
                       gitInfo.status.untracked?.find(f => f.path === item.path);
      }

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
            {fileGitStatus && (
              <span className={`file-git-badge ${getGitBadgeClass(fileGitStatus)}`}>
                {getGitBadgeText(fileGitStatus)}
              </span>
            )}
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

function getGitBadgeClass(fileGitStatus) {
  // indexStatus === '?' means untracked
  if (fileGitStatus.indexStatus === '?' && fileGitStatus.workTreeStatus === '?') {
    return 'untracked';
  }
  // Staged: indexStatus is not ' ' and not '?'
  if (fileGitStatus.indexStatus !== ' ' && fileGitStatus.indexStatus !== '?') {
    return 'staged';
  }
  // Otherwise (working tree changes)
  return 'wt';
}

function getGitBadgeText(fileGitStatus) {
  // For untracked, show 'U'
  if (fileGitStatus.indexStatus === '?' && fileGitStatus.workTreeStatus === '?') {
    return 'U';
  }
  // Show index status for staged, workTree status for unstaged
  if (fileGitStatus.indexStatus !== ' ' && fileGitStatus.indexStatus !== '?') {
    return fileGitStatus.indexStatus;
  }
  return fileGitStatus.workTreeStatus;
}
