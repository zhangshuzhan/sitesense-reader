<div align="right">
  <strong>English</strong> |
  <a href="README_zh.md">简体中文</a> |
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
  <strong>A local-first desktop RSS reader with optional AI tools.</strong>
</p>

<p align="center">
  <a href="https://github.com/JinxinWonderWorld/RSS-Reader/releases"><img src="https://img.shields.io/github/v/release/JinxinWonderWorld/RSS-Reader?color=blue&label=Download" alt="Releases"></a>
  <img src="https://img.shields.io/badge/Version-0.2.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/Platform-macOS-lightgrey" alt="Platform">
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Built_with-Tauri_2-24C8DB?logo=tauri&logoColor=white" alt="Tauri"></a>
</p>

<p align="center">
  <a href="#overview">Overview</a> •
  <a href="#features">Features</a> •
  <a href="#whats-new-in-020">What's New</a> •
  <a href="#download">Download</a> •
  <a href="#development">Development</a> •
  <a href="#architecture">Architecture</a>
</p>

---

<p align="center">
  <img src="imgs/screenshot.png" alt="RSS Reader screenshot" width="800">
</p>

## Overview

RSS Reader is a Tauri 2 desktop app for reading RSS, Atom, and JSON feeds. It stores data locally in SQLite, keeps feed updates efficient with conditional requests, and adds optional AI workflows for summaries, translation, and article scoring.

This build (the **SiteSense** fork) extends the reader with two capabilities on top of the upstream project:

- **WordPress dual-mode sources** — subscribe to any WordPress site either **publicly** (the core REST API, no login, no plugin) or through the **SiteSense plugin** when present (token-authenticated `/sitesense/v1` endpoints).
- **Financial Insight** — a built-in "Finance" button that asks your configured cloud LLM for a market takeaway (summary, bullish/bearish/neutral sentiment, a −100..100 score, and keywords). With no API key configured, it falls back to a local heuristic so the feature always works.

The app is designed for a native macOS workflow: `Command+W` closes the window while keeping the app alive in the Dock, and `Command+Q` exits the app.

## Features

### Reading and Feed Management
- Subscribe to RSS, Atom, and JSON feeds.
- Import and export subscriptions with OPML.
- Browse all, unread, starred, and favorite articles.
- Organize articles with feeds, tags, and groups.
- Search articles with local full-text search.
- Handle large article lists with virtualized rendering.

### Performance and Background Work
- Store articles, feeds, rules, and settings locally.
- Use `ETag` and `Last-Modified` to skip unchanged feed downloads.
- Run feed refresh work in Rust with bounded concurrency.
- Keep a lightweight background scheduler when the main window is closed.
- Pause UI-heavy and AI-heavy work when no window is open.
- Load article rendering, sanitizing, markdown parsing, and code highlighting only when needed.
- Use a bounded `rss-media://` proxy for media that needs caching or range requests.
- Load video embeds only after user action.

### Optional AI Tools
- Configure OpenAI or Anthropic-compatible AI profiles.
- Generate single-article summaries.
- Translate article content.
- Generate batch digests for multiple articles.
- Use automation rules and AI scoring to classify or highlight articles.
- Keep API keys in local app settings.
- **Financial Insight** (SiteSense): summarize an article's market angle, label sentiment as bullish/bearish/neutral, score it from −100 to 100, and extract finance keywords. Falls back to a local heuristic when no API key is set.

### Desktop Experience
- Native macOS menu behavior for close, reopen, hide, and quit.
- Keyboard shortcuts with a settings switch to enable or disable them.
- Light, dark, and system themes.
- Context menus and batch actions for common article operations.
- Interface translations for English, Chinese, Russian, Spanish, French, and Arabic.

### WordPress Sources (SiteSense)

Add a WordPress site the same way you add an RSS feed — pick the **WordPress** tab in the add-feed dialog and enter the site URL.

- **Public mode** — the core WordPress REST API (`/wp-json/wp/v2/posts`) is used with no login and no plugin. Works for any WordPress site that exposes the public REST API.
- **SiteSense plugin mode** — if the site runs the SiteSense plugin, paste the access token to read from the authenticated `/wp-json/sitesense/v1/posts` (or `/ranking`) endpoints. Use this for members-only or ranked feeds.
- The add dialog includes a **Detect connection** button that probes the site and reports whether it is reachable publicly, reachable only with a token, or unreachable.
- WordPress sources refresh through the same Rust background scheduler as RSS feeds.

## What's New in 0.2.0

- Standard macOS lifecycle: `Command+W` closes the window, `Command+Q` quits the app.
- Lower hidden-state resource use by destroying the WebView when the window is closed.
- Rust-backed background refresh and cleanup scheduling.
- Conditional feed fetching with `ETag` and `Last-Modified`.
- Lazy article rendering and lighter media loading.
- Shortcut enable switch in settings.
- Fixes for route restore, settings navigation, feed count refresh, and article read state sync.

### SiteSense Extensions (this fork)

- **WordPress dual-mode sources** — subscribe publicly via the core REST API, or via the SiteSense plugin with a token. Detect-connection probing reports reachability before subscribing.
- **Financial Insight** — a per-article cloud-LLM market reading (summary, sentiment, score, keywords) with a local heuristic fallback when no API key is configured.
- `source_type` (`rss` / `wordpress`) and per-feed `auth_token` columns added to the feeds table; existing databases are migrated automatically.

## Download

Ready-to-use builds are published on the [GitHub Releases](https://github.com/JinxinWonderWorld/RSS-Reader/releases) page.

The current release target is macOS. Windows and Linux support are kept in the Tauri configuration, but release testing currently focuses on macOS.

## Development

### Requirements
- [Node.js](https://nodejs.org/) 18 or newer
- [Rust](https://www.rust-lang.org/tools/install) 1.70 or newer

On Linux, Tauri 2 also needs the WebKit and GTK development libraries:

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev libgtk-3-dev build-essential patchelf librsvg2-dev pkg-config
```

### Quick Start

```bash
git clone https://github.com/JinxinWonderWorld/RSS-Reader.git
cd RSS-Reader
npm install
npm run tauri:dev
```

### Useful Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run the Vite frontend only |
| `npm run build` | Type-check and build the frontend |
| `npm run tauri:dev` | Run the full Tauri app in development |
| `npm run tauri:build` | Build the release app bundle |
| `npm test -- --run` | Run frontend tests |
| `npm run lint` | Run ESLint |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Run Rust tests |

## Architecture

- `src-tauri/src/app_runtime.rs`: runtime state, background scheduling, and cleanup gates.
- `src-tauri/src/window_lifecycle.rs`: macOS window close, reopen, and state restore behavior.
- `src-tauri/src/feed/`: feed fetching, conditional requests, and parsing.
- `src-tauri/src/db/`: SQLite schema and data access.
- `src-tauri/src/media_protocol.rs`: bounded media proxy and range responses.
- `src-tauri/src/ai.rs`: AI summary, translation, batch digest, queue processing, and the SiteSense financial-insight command (cloud + local fallback).
- `src-tauri/src/wordpress.rs`: SiteSense WordPress dual-mode fetcher (`detect_wordpress`, public REST + plugin token modes).
- `src/services/runtime.ts`: frontend bridge for Rust runtime commands.
- `src/stores/`: Zustand stores for feeds, settings, rules, UI state, and search history.
- `src/components/`: React UI components and lazy-loaded article rendering.
