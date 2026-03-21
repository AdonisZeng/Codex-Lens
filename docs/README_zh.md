# Codex-Lens

一个可视化的 Codex 任务管理与代码审查工具。

## 功能特性

### 文件浏览器
- 实时监控项目文件变化，自动更新文件树
- 支持文件夹展开/折叠
- 右键菜单支持复制文件路径、在文件资源管理器中打开

### 代码查看器
- 支持 20+ 种编程语言的语法高亮（JavaScript、Python、Java、C/C++、Go、Rust 等）
- 行号显示
- 代码缩略图（Minimap），支持拖动滑块滚动、点击跳转
- 文件变更 Diff 显示，清晰展示新增/删除/修改的内容

### 终端集成
- 内置终端，直接与 Codex 交互
- 实时显示 Codex 输出
- 支持终端输入

### 标签页管理
- 多文件标签页浏览
- 支持快捷键：`Ctrl+W` 关闭标签、`Ctrl+Tab` 切换标签
- 右键菜单：关闭、关闭其他、关闭所有

### 其他特性
- WebSocket 实时通信，自动重连
- 版本检测与更新提示
- 现代化深色主题 UI

## 前置要求

在使用 Codex-Lens 之前，需要先安装 Codex：

```bash
npm install -g @openai/codex
```

## 安装

### 通过 npm 全局安装

```bash
npm install -g codex-lens
```

### 使用

在项目目录下运行：

```bash
codexlens
```

工具会自动：
1. 检测当前项目根目录
2. 启动 Codex 进程
3. 打开浏览器界面（http://localhost:5174）

## 更新

### 检查更新

工具启动时会自动检查 npm 上的最新版本，如有更新会在界面右上角显示提示。

### 手动更新

```bash
npm update -g codex-lens
```

## 技术栈

- **前端**: React 18、Vite、CodeMirror 6
- **后端**: Node.js、Express、WebSocket
- **终端**: xterm.js、node-pty
- **文件监控**: chokidar
- **Diff 生成**: diff

## 开发

### 克隆项目

```bash
git clone https://github.com/your-username/codex-lens.git
cd codex-lens
```

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
# 构建项目
npm run build

# 启动服务
npm start
```

开发流程：修改代码后，需要重新运行 `npm run build` 构建项目，然后运行 `npm start` 启动服务查看效果。

## 许可证

[MIT](LICENSE)
