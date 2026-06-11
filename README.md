<br />
<h1>
<p align="center">
  <img src="./icon.png" alt="PaddleOCR" width="128">
  <br>PaddleOCR for Bob
</p>
</h1>

<p align="center">
  <a href="https://bobtranslate.com/"><img src="https://img.shields.io/badge/Bob-Website-brightgreen?logo=Safari" alt="Bob Website" /></a>
  <a href="https://github.com/Fan-chou/bob-plugin-paddleocr/releases"><img src="https://img.shields.io/badge/Release-bobplugin-blue" alt="Release" /></a>
  <a href="https://github.com/PaddlePaddle/PaddleOCR"><img src="https://img.shields.io/badge/PaddleOCR-Repo-orange" alt="PaddleOCR Repo" /></a>
  <a href="https://github.com/Fan-chou/bob-plugin-paddleocr/actions/workflows/release.yml"><img src="https://github.com/Fan-chou/bob-plugin-paddleocr/actions/workflows/release.yml/badge.svg" alt="CI" /></a>
</p>

<p align="center">
  Bob OCR plugin for PaddleOCR-VL — local OCR with position-aware text spotting.
  <br />
  Powered by <a href="https://github.com/PaddlePaddle/PaddleOCR">PaddleOCR-VL</a>, served locally via Ollama.
</p>

<p align="center">
  <a href="#about">English</a> |
  <a href="#中文">中文</a>
</p>

<p align="center">
  <a href="#about">About</a> •
  <a href="#installation">Installation</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#build">Build</a>
</p>

---

## About

Bob is a macOS translation and OCR app. This plugin connects Bob to a locally running [PaddleOCR-VL](https://github.com/PaddlePaddle/PaddleOCR) model served through an OpenAI-compatible API (Ollama / llama.cpp / vLLM), enabling offline document OCR with precise text position information — directly from Bob.

### Features

- **Two-phase recognition**: Spotting mode first detects text positions, then OCR extracts content — providing per-word bounding boxes
- **Auto-fallback**: gracefully degrades to plain text mode if spotting fails or bounding box is disabled
- **Structured output**: returns `regionInfos` with paragraph grouping for better layout preservation
- **Plain text mode**: clean text-only output without position data
- **Zero configuration for local**: no API key required when running locally
- **Bob 1.20.0+ compatible**: supports the latest OCR plugin API including bounding boxes

### Supported Languages

`auto`, `zh-Hans`, `zh-Hant`, `en`, `ja`, `ko`, `fr`, `de`, `es`, `it`, `pt`, `ru`, `ar`, `nl`, `pl`, `th`, `vi`, `tr`

---

## Installation

1. Install [Bob](https://bobtranslate.com/) (v1.20.0 or later)
2. Download the latest `.bobplugin` from [Releases](https://github.com/Fan-chou/bob-plugin-paddleocr/releases)
3. Double-click the `.bobplugin` file to install
4. Configure your local OCR endpoint in Bob's plugin settings

---

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| API URL | `http://localhost:11434` | OpenAI-compatible endpoint for your PaddleOCR model |
| API Key | *(empty)* | Leave blank for local services |
| Model | `paddleocr-vl` | Model name as configured in Ollama |
| Bounding Box | On | Enable two-phase spotting for position data |
| Output Mode | Structured | `regionInfos` (structured) or `texts` (flat) |
| Timeout | 60s | Max wait time per OCR request |

### Prerequisites

Serve PaddleOCR-VL locally via Ollama:

```bash
ollama pull paddleocr-vl
ollama serve
# API available at http://localhost:11434
```

Or via llama.cpp / vLLM — any OpenAI-compatible endpoint works.

---

## How It Works

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Screenshot  │────▶│  Phase 1         │────▶│  Phase 2     │
│  (Bob)       │     │  "Spotting"      │     │  "OCR:"      │
│              │     │  → LOC tokens    │     │  → Plain text│
└──────────────┘     └────────┬────────┘     └──────┬───────┘
                              │                     │
                              ▼                     ▼
                     <|LOC_x|><|LOC_y|>...    Hello World
                              │                     │
                              └─────────┬───────────┘
                                        ▼
                              ┌─────────────────┐
                              │  Merge + Group   │
                              │  → regionInfos   │
                              └─────────────────┘
```

PaddleOCR-VL supports six task modes via prompts. This plugin uses two:

| Prompt | Mode | Output |
|--------|------|--------|
| `Spotting` | Text Spotting | Text + `<\|LOC_N\|>` coordinate tokens |
| `OCR:` | Text Recognition | Plain Markdown text |

**Critical**: `Spotting` has no trailing colon. `Spotting:` (with colon) returns empty output from GGUF-quantized models.

---

## Build

Requires no build tools — the plugin is plain JavaScript:

```bash
# Package as .bobplugin (which is just a zip file)
zip -r bob-plugin-paddleocr@1.0.0.bobplugin info.json main.js icon.png
```

---

<a id="中文"></a>

# PaddleOCR for Bob

## 关于

Bob 是一款 macOS 平台的翻译与 OCR 软件。本插件将 Bob 接入本地运行的 PaddleOCR-VL 模型（通过 Ollama 等 OpenAI 兼容 API 服务），支持离线文档识别并返回精确的文字位置信息。

### 特性

- **两阶段识别**：先通过 Spotting 模式获取文字坐标，再进行 OCR 提取文本
- **自动降级**：位置检测失败时自动回退为纯文本模式
- **结构化输出**：返回 `regionInfos`，自动按段落分组
- **零配置本地使用**：本地服务无需 API 密钥

## 安装

1. 安装 [Bob](https://bobtranslate.com/)（v1.20.0 及以上）
2. 从 [Releases](https://github.com/Fan-chou/bob-plugin-paddleocr/releases) 下载最新的 `.bobplugin`
3. 双击安装
4. 在 Bob 插件设置中配置本地 OCR 端点

## 配置说明

| 选项 | 默认值 | 说明 |
|------|--------|------|
| 接口地址 | `http://localhost:11434` | PaddleOCR 模型的 OpenAI 兼容 API 端点 |
| API 密钥 | *(留空)* | 本地服务无需密钥 |
| 模型 | `paddleocr-vl` | Ollama 中配置的模型名称 |
| 位置信息 | 开启 | 使用 Spotting 获取精确位置 |
| 输出模式 | 结构化 | 结构化 (regionInfos) / 扁平 (texts) |
| 请求超时 | 60 秒 | 单次请求最长等待时间 |

### 前置条件

```bash
ollama pull paddleocr-vl
ollama serve
# API 地址：http://localhost:11434
```

## 编译打包

插件为纯 JavaScript，无需构建工具：

```bash
zip -r bob-plugin-paddleocr@1.0.0.bobplugin info.json main.js icon.png
```
