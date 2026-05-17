# OpenCode for GitHub Copilot Chat

> **Use [OpenCode](https://opencode.ai) models directly in GitHub Copilot Chat — no Copilot Pro/Enterprise subscription needed. Just bring your own API key (BYOK).**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.120%2B-blue)](https://code.visualstudio.com/)
[![OpenCode](https://img.shields.io/badge/OpenCode-Go%20|%20Zen-6c47ff)](https://opencode.ai)

---

## What Is This?

**OpenCode for GitHub Copilot Chat** is a VS Code extension that registers models from [OpenCode](https://opencode.ai) — both **OpenCode Go** (paid) and **OpenCode Zen** (free) — into **GitHub Copilot Chat** via the official VS Code *Language Model Chat Provider API*.

This lets you pick and use OpenCode models directly from the Copilot Chat model picker, just like selecting GPT-4 or Claude — no extra Copilot Pro/Enterprise subscription required. Simply enter your OpenCode API key.

| Provider | Cost | Example Models |
|---|---|---|
| **OpenCode Go** | Paid (top-up) | DeepSeek V4, Kimi K2.6, MiniMax M2.7, GLM-5.1, MiMo V2.5, Qwen3.6 |
| **OpenCode Zen** | Free | DeepSeek V4 Flash Free, MiniMax M2.5 Free, Nemotron 3 Super Free, Big Pickle |

---

## ✨ Features

- **BYOK** — configure OpenCode Go and OpenCode Zen independently with separate API keys, both active at the same time
- **Live model list** — fetches available Go models and Zen models directly from OpenCode on every startup
- **Bundled fallback** — works offline or if the API is unreachable, using a curated model table with accurate token limits
- **Per-model token limits** — precise context window and max output token values per model, not a single global cap
- **Tool-calling support** — forwards tool schemas using OpenAI-compatible or Anthropic-compatible request shapes automatically based on the model endpoint
- **Dual endpoint routing** — routes standard models to `/chat/completions` and MiniMax M2 models to `/messages` transparently
- **Diagnostics command** — one-click markdown report showing exactly which models VS Code has registered

---

## Requirements

- VS Code **1.120.0** or higher with the Language Model Chat Provider API
- **GitHub Copilot Chat** extension — [install from marketplace](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) (required — this extension only adds models *into* Copilot Chat)
- Sign in to GitHub Copilot Chat (a personal GitHub account is sufficient — **no** Copilot Pro/Enterprise needed for BYOK)
- An **OpenCode Go API key** for Go models, or an **OpenCode Zen API key** for Zen free models — get one at [opencode.ai](https://opencode.ai)

---

## ⚡ Quick Start

1. Install **GitHub Copilot Chat** from the marketplace if you haven't already.
2. Install this extension (or press `F5` in the repo to launch an Extension Development Host).
3. Open **GitHub Copilot Chat** (click the Copilot icon in the sidebar or press `Cmd+Shift+I` / `Ctrl+Shift+I`).
4. Click the **model picker** (current model name) → **Manage Models…**
5. Select **OpenCode Go** or **OpenCode Zen**.
6. Press `Enter` to accept the default **Group Name**.
7. Enter your OpenCode **API Key** when prompted — VS Code stores it securely as a secret.
8. Choose the models you want available.
9. Select any OpenCode model from the picker and start chatting.

> **💡 Tips:**
> - Registered models are automatically available in the Copilot Chat model picker — no extra setup needed.
> - If a model appears in the **Language Models** view but not in the chat picker, hover its row and click the eye icon (👁) to enable visibility.
> - **Go** and **Zen** are separate provider groups, so both can be active at the same time. Switch between them anytime from the model picker.

---

## Commands

Once installed, OpenCode models appear directly in the **GitHub Copilot Chat model picker** — no special commands needed. The easiest way to manage your API key is via **Settings → Language Models** (gear icon ⚙).

For advanced usage, you can also run these commands via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Description |
|---|---|
| `OpenCode Go: Manage Provider` | Manage legacy fallback API key, refresh models, or test connection |
| `OpenCode Go: Set API Key` | Store or update a legacy fallback OpenCode Go API key |
| `OpenCode Go: Diagnostics` | Show a markdown report of all registered OpenCode Go models |
| `OpenCode Zen: Diagnostics` | Show a markdown report of all registered OpenCode Zen models |

> **Note:** The native BYOK flow via **Language Models** (gear icon ⚙) is recommended. VS Code will ask for a group name, then the matching API key. Go and Zen are separate provider groups, so both can be active at the same time.

---

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `opencodego.temperature` | `number` | `0.2` | Sampling temperature for chat completions (`0`–`2`) |
| `opencodego.maxTokens` | `number` | `0` | Max output token override — `0` uses the per-model bundled maximum |
| `opencodego.maxInputTokens` | `number` | `0` | Context window override — `0` uses the per-model bundled context size |
| `opencodego.debugReasoning` | `boolean` | `false` | Write provider `reasoning_content` to **Output → OpenCode** for debugging |
| `opencodego.freeOnly`      | `boolean` | `true`  | Limit OpenCode Zen to free models only. Disable to include paid Zen models in the picker |

---

## Models

The extension fetches the live model lists from:

```
https://opencode.ai/zen/go/v1/models   (OpenCode Go — paid)
https://opencode.ai/zen/v1/models       (OpenCode Zen — free)
```

The **Go provider** exposes all OpenCode Go models. The **Zen provider** filters the live Zen list to free chat-completions-compatible models (`*-free` plus `big-pickle`) by default. Set `opencodego.freeOnly` to `false` to include paid Zen models in the picker.

Because the endpoints return model IDs only, a bundled metadata table provides context window and max output tokens per model. Deprecated or known-unavailable models are filtered using the models.dev registry plus a small local safety list, so stale free models do not remain visible just because OpenCode still returns them from `/models`. If the live fetch fails, the bundled list is used as a fallback.

VS Code and Copilot read separate input/output metadata fields for UI display. The extension advertises the exact context window from the official [models.dev](https://models.dev) registry so the **Language Models** table, model picker tooltip, and chat context indicator all show accurate values. All limits are sourced from the models.dev registry (the same registry used by OpenCode itself).

### Bundled model limits

All limits are sourced from the [models.dev](https://models.dev) registry. Per-provider limits are tracked separately (Go vs Zen) so models shared across providers use the correct values for each.

**OpenCode Go**

| Model | Context window | Max output tokens |
|---|---:|---:|
| `deepseek-v4-pro` / `deepseek-v4-flash` | 1,000,000 | 384,000 |
| `mimo-v2.5-pro` / `mimo-v2-pro` | 1,048,576 | 128,000 |
| `mimo-v2.5` | 1,000,000 | 128,000 |
| `kimi-k2.6` / `kimi-k2.5` | 262,144 | 65,536 |
| `qwen3.6-plus` / `qwen3.5-plus` | 262,144 | 65,536 |
| `mimo-v2-omni` | 262,144 | 128,000 |
| `hy3-preview` | 256,000 | 64,000 |
| `minimax-m2.7` / `minimax-m2.5` | 204,800 | 131,072 |
| `glm-5.1` / `glm-5` | 204,800 | 131,072 |

**OpenCode Zen (free models)**

| Model | Context window | Max output tokens |
|---|---:|---:|
| `deepseek-v4-flash-free` | 1,000,000 | 384,000 |
| `qwen3.6-plus-free` | 262,144 | 65,536 |
| `minimax-m2.5-free` | 204,800 | 131,072 |
| `nemotron-3-super-free` | 204,800 | 128,000 |
| `big-pickle` | 200,000 | 128,000 |

Set `opencodego.maxInputTokens` or `opencodego.maxTokens` to a non-zero value to override the bundled defaults globally.

### Endpoint routing

Most models use the OpenAI-compatible chat completions endpoint:

```
https://opencode.ai/zen/go/v1/chat/completions   (Go)
https://opencode.ai/zen/v1/chat/completions       (Zen)
```

OpenCode Go MiniMax M2 models (`minimax-m2.*`) are automatically routed to the Anthropic-compatible messages endpoint:

```
https://opencode.ai/zen/go/v1/messages
```

---

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode
npm run watch
```

Press `F5` in VS Code to launch an **Extension Development Host** with the extension loaded.

To package a `.vsix` for local install:

```bash
npm run package
```

---

## Contributing

Issues and pull requests are welcome. Please open an issue first for significant changes so we can discuss the approach.

---

## License

MIT — see [LICENSE](./LICENSE) for details.
