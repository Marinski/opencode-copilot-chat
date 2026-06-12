# 📝 OpenCode Copilot Chat — Devlog

**Branch:** `main` | **Updated:** 2026-06-12 | **Current Phase:** Active Development — v0.2.7 Released ✅

---

## ⚡ Session Handoff

| Field | Value |
|-------|-------|
| **Last Session** | 2026-06-12 |
| **Worked On** | v0.2.7 release — temperature support fix, Kimi thinking format correction |
| **Stopped At** | `CHANGELOG.md`, `extension.ts` |
| **Next Action** | Continue development on next feature or address open issues |
| **Open Issues** | None currently tracked |

---

## 📦 Project Overview

**OpenCode Copilot Chat** is a VS Code extension that registers models from [OpenCode](https://opencode.ai) (Go & Zen providers) into GitHub Copilot Chat via the VS Code Language Model Chat Provider API.

**Repository:** `ltmoerdani/opencode-copilot-chat`
**License:** MIT
**Current Version:** 0.2.7
**Minimum VS Code:** 1.118.0

### Key Architecture

| Component | Description |
|-----------|-------------|
| `extension.ts` | Main activation, provider registration, model discovery |
| `routing.ts` | Per-model endpoint routing (chat-completions, messages, responses, Gemini) |
| `streaming.ts` | SSE streaming, response extraction, tool-call parsing |
| `goUsageTracker.ts` | OpenCode Go subscription usage tracking (5h/weekly/monthly) |
| `contextWindowHook.ts` | Bridges BYOK token usage back to VS Code context window |
| `metadata.ts` | Model metadata resolution from live registry + models.dev cache |
| `providerTypes.ts` | TypeScript types for providers, models, and settings |
| `chatParts.ts` | Chat message part handling (text, tool calls, reasoning) |
| `openCodeAuth.ts` | API key management for Go and Zen providers |
| `usage.ts` | Token usage tracking and reporting |

### Supported Model Families

| Family | Provider(s) | Endpoint | Thinking Support |
|--------|-------------|----------|-----------------|
| DeepSeek | Go | `/chat/completions` | off/low/medium/high/max |
| GLM | Go | `/chat/completions` | on/off |
| Kimi | Go | `/chat/completions` | on/off |
| MiMo | Go | `/chat/completions` | off/low/medium/high |
| MiniMax | Go | `/messages` (Anthropic) | off/on |
| Qwen | Go | `/chat/completions` | auto/on/off + thinking_budget |
| GPT-5.x | Zen | `/responses` | Dynamic from models.dev |
| Claude | Zen | `/messages` (Anthropic) | Dynamic from models.dev |
| Gemini | Zen | `streamGenerateContent?alt=sse` | Dynamic from models.dev |

---

## ✅ Recent Releases

### v0.2.7 — 2026-06-12
- Fixed Kimi thinking format documentation (correct format is `thinking: { type }`, not `enable_thinking`)
- Respect model `temperature` support from models.dev — omit parameter when unsupported

### v0.2.6 — 2026-06-10
- Removed message trimming feature entirely (`messageTrimmer.ts`)
- Removed gzip compression (OpenCode proxy doesn't support it)

### v0.2.5 — 2026-06-10
- Removed gzip compression (HTTP 500 fix)

### v0.2.4 — 2026-06-10
- Byte-aware message trimming
- Context size selector for tiered-pricing models
- Dynamic reasoning options from models.dev
- Thinking controls for Mimo, MiniMax, DeepSeek, Kimi
- Dynamic configuration schema for reasoning models
- `stripThinkTags` setting for MiniMax M3 family

### v0.2.3 — 2026-06-09
- Refreshed extension icon
- Cleaned up output channel (error-level only)
- Fixed `Buffer` → `TextDecoder` for Web API compatibility

### v0.2.2 — 2026-06-08
- Strip `<think...>` tags from model output

### v0.2.1 — 2026-06-06
- Removed unused `opencodego.showUsage` command

### v0.2.0 — 2026-06-05
- Go Usage Tracker — real-time subscription limits in status bar

### v0.1.10 — 2026-06-05
- Fixed Qwen models routing (Anthropic → chat-completions)
- Fixed Anthropic streaming tool call parsing
- Fixed Qwen thinking payload format

---

## 🔧 Technical Context

### Build & Development
- **Build:** `npm run compile` (TypeScript → `out/`)
- **Test:** `npm test` (if configured)
- **Debug:** F5 in VS Code to launch Extension Development Host

### Settings Schema
- Provider settings: `opencodego.*` (Go) and `opencodezen.*` (Zen)
- Thinking controls: `opencodego.thinking.*` per model family
- Streaming: `opencodego.requestTimeout`, `opencodego.streamIdleTimeout`
- Debug: `opencodego.debugReasoning`, `opencodego.stripThinkTags`

### Key Dependencies
- VS Code Extension API (proposed: `chatProvider`)
- `models.dev` metadata (live + cached)
- OpenCode API (`https://api.opencode.ai`)

---

## 🔥 Active Tasks

_No active tasks currently. See Session Handoff for next action._

---

## 📋 Completed History

| Date | Version | Summary |
|------|---------|---------|
| 2026-06-12 | v0.2.7 | Temperature support fix, Kimi thinking format correction |
| 2026-06-10 | v0.2.6 | Removed message trimming + gzip |
| 2026-06-10 | v0.2.5 | Removed gzip (HTTP 500 fix) |
| 2026-06-10 | v0.2.4 | Message trimming, context size, dynamic reasoning, strip think tags |
| 2026-06-09 | v0.2.3 | Icon refresh, output channel cleanup, TextDecoder fix |
| 2026-06-08 | v0.2.2 | Strip think tags |
| 2026-06-06 | v0.2.1 | Remove unused showUsage command |
| 2026-06-05 | v0.2.0 | Go Usage Tracker |
| 2026-06-05 | v0.1.10 | Qwen routing + Anthropic tool call fixes |

---

_Updated automatically during development sessions._
_Paired with: `docs/devlog-guide.md`_
