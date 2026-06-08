<div align="right">
  <a href="README.md">English</a> |
  <strong>简体中文</strong> |
  <a href="README_ru.md">Русский</a> |
  <a href="README_es.md">Español</a> |
  <a href="README_fr.md">Français</a> |
  <a href="README_ar.md">العربية</a>
</div>

<p align="center">
  <img src="icon.svg" width="128" height="128" alt="RSS Reader Logo">
</p>

<h1 align="center">RSS Reader</h1>

<p align="center">
  <strong>本地优先的桌面 RSS 阅读器，并提供可选的 AI 工具。</strong>
</p>

<p align="center">
  <a href="https://github.com/JinxinWonderWorld/RSS-Reader/releases"><img src="https://img.shields.io/github/v/release/JinxinWonderWorld/RSS-Reader?color=blue&label=%E4%B8%8B%E8%BD%BD" alt="Releases"></a>
  <img src="https://img.shields.io/badge/Version-0.2.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/Platform-macOS-lightgrey" alt="Platform">
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Built_with-Tauri_2-24C8DB?logo=tauri&logoColor=white" alt="Tauri"></a>
</p>

<p align="center">
  <a href="#概览">概览</a> •
  <a href="#功能">功能</a> •
  <a href="#020-更新">0.2.0 更新</a> •
  <a href="#下载">下载</a> •
  <a href="#开发">开发</a> •
  <a href="#架构">架构</a>
</p>

---

<p align="center">
  <img src="imgs/screenshot.png" alt="RSS Reader screenshot" width="800">
</p>

## 概览

RSS Reader 是一款 Tauri 2 桌面应用，用于阅读 RSS、Atom 和 JSON 订阅源。它使用 SQLite 在本地保存数据，通过条件请求降低订阅更新成本，并提供可选的 AI 摘要、翻译和文章评分流程。

应用按原生 macOS 习惯设计：`Command+W` 关闭窗口但应用仍保留在 Dock 中，`Command+Q` 才真正退出应用。

## 功能

### 阅读和订阅管理
- 订阅 RSS、Atom 和 JSON 源。
- 使用 OPML 导入和导出订阅。
- 浏览所有文章、未读文章、星标文章和收藏文章。
- 使用订阅、标签和分组组织文章。
- 使用本地全文搜索查找文章。
- 使用虚拟列表处理大量文章。

### 性能和后台任务
- 在本地保存文章、订阅、规则和设置。
- 使用 `ETag` 和 `Last-Modified` 跳过未变化的订阅下载。
- 在 Rust 中以有界并发执行订阅刷新。
- 主窗口关闭后只保留轻量后台调度器。
- 无窗口时暂停 UI 重任务和 AI 重任务。
- 仅在需要时加载正文渲染、清洗、Markdown 解析和代码高亮。
- 使用有界 `rss-media://` 代理处理需要缓存或 Range 请求的媒体。
- 视频嵌入只有在用户点击后才加载。

### 可选 AI 工具
- 配置 OpenAI 或 Anthropic 兼容的 AI profile。
- 生成单篇文章摘要。
- 翻译文章内容。
- 为多篇文章生成批量摘要。
- 使用自动化规则和 AI 评分分类或突出显示文章。
- API key 保存在本地应用设置中。

### 桌面体验
- 原生 macOS 菜单行为，支持关闭、重开、隐藏和退出。
- 键盘快捷键可在设置中开关。
- 支持浅色、深色和跟随系统主题。
- 支持上下文菜单和文章批量操作。
- 界面支持英语、中文、俄语、西班牙语、法语和阿拉伯语。

## 0.2.0 更新

- 标准 macOS 生命周期：`Command+W` 关闭窗口，`Command+Q` 退出应用。
- 关闭窗口时销毁 WebView，降低隐藏态资源占用。
- 后台刷新和清理调度下沉到 Rust。
- 使用 `ETag` 和 `Last-Modified` 做条件订阅抓取。
- 延迟加载正文渲染和更轻量的媒体加载。
- 设置中新增快捷键开关。
- 修复路由恢复、设置页导航、订阅计数刷新和文章已读状态同步问题。

## 下载

可在 [GitHub Releases](https://github.com/JinxinWonderWorld/RSS-Reader/releases) 页面下载可直接使用的版本。

当前发布目标是 macOS。Tauri 配置中仍保留 Windows 和 Linux 支持，但当前发布测试以 macOS 为主。

## 开发

### 环境要求
- [Node.js](https://nodejs.org/) 18 或更新版本
- [Rust](https://www.rust-lang.org/tools/install) 1.70 或更新版本

### 快速开始

```bash
git clone https://github.com/JinxinWonderWorld/RSS-Reader.git
cd RSS-Reader
npm install
npm run tauri:dev
```

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 只运行 Vite 前端 |
| `npm run build` | 类型检查并构建前端 |
| `npm run tauri:dev` | 运行完整 Tauri 开发应用 |
| `npm run tauri:build` | 构建发布应用包 |
| `npm test -- --run` | 运行前端测试 |
| `npm run lint` | 运行 ESLint |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 运行 Rust 测试 |

## 架构

- `src-tauri/src/app_runtime.rs`: 运行态、后台调度和清理门控。
- `src-tauri/src/window_lifecycle.rs`: macOS 窗口关闭、重开和状态恢复。
- `src-tauri/src/feed/`: 订阅抓取、条件请求和解析。
- `src-tauri/src/db/`: SQLite schema 和数据访问。
- `src-tauri/src/media_protocol.rs`: 有界媒体代理和 Range 响应。
- `src-tauri/src/ai.rs`: AI 摘要、翻译、批量摘要和队列处理。
- `src/services/runtime.ts`: 前端调用 Rust runtime command 的桥接层。
- `src/stores/`: 用于订阅、设置、规则、UI 状态和搜索历史的 Zustand store。
- `src/components/`: React UI 组件和懒加载正文渲染。
