# OpenCode for GitHub Copilot Chat

> **Use [OpenCode](https://opencode.ai) models directly in GitHub Copilot Chat — no Copilot Pro/Enterprise subscription needed. Just bring your own API key (BYOK).**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.118%2B-blue)](https://code.visualstudio.com/)
[![OpenCode](https://img.shields.io/badge/OpenCode-Go%20|%20Zen-6c47ff)](https://opencode.ai)

---

## What Is This?

**OpenCode for GitHub Copilot Chat** is a VS Code extension that registers models from [OpenCode](https://opencode.ai) — both **OpenCode Go** (paid) and **OpenCode Zen** (free) — into **GitHub Copilot Chat** via the official VS Code *Language Model Chat Provider API*.

This lets you pick and use OpenCode models directly from the Copilot Chat model picker, just like selecting GPT-4 or Claude — no extra Copilot Pro/Enterprise subscription required. Simply enter your OpenCode API key.

| Provider | Cost | Example Models |
|---|---|---|
| **OpenCode Go** | Paid (top-up) | DeepSeek V4, Kimi K2.6, MiniMax M2.7, GLM-5.1, MiMo V2.5, Qwen3.7 Max |
| **OpenCode Zen** | Free or paid | DeepSeek V4 Flash Free, GPT 5.5, Claude Opus 4.7, Grok Build, Big Pickle |

---

## ✨ Features

### Provider & Configuration

- **Dual BYOK providers** — configure **OpenCode Go** (paid) and **OpenCode Zen** (free/paid) independently with separate API keys. Both providers can be active at the same time and you switch between them from the model picker.
- **Live model registry** — fetches the latest Go and Zen model lists directly from `opencode.ai` on every startup, so new models appear automatically.
- **TTL-cached metadata** — merges live `/models` metadata with a 6-hour **models.dev snapshot** (cached in VS Code `globalState`) to resolve context window, output limits, image support, pricing, and deprecation state for every model.
- **Bundled fallback catalog** — ships an internal fallback table so the model picker stays usable offline when the live registry cannot be reached.
- **Per-provider model limits** — Go and Zen model limits are tracked separately so models shared across providers (e.g. `qwen3.6-plus`, `glm-5.1`) use the correct context/output values for each provider.

### Smart Routing

- **Native endpoint routing** — each model family is sent through the transport it expects:
  - **Zen GPT** → `/responses`
  - **Zen Gemini** → Google-style `streamGenerateContent?alt=sse`
  - **Zen Claude** + **Go MiniMax** → `/messages` (Anthropic-compatible)
  - **All other models** (Qwen, DeepSeek, GLM, Kimi, MiMo, etc.) → `/chat/completions`
- **Tool-calling support** — forwards VS Code tool schemas using the correct format for each endpoint (OpenAI `tool_calls` or Anthropic `tool_use` content blocks), so Copilot Agent can read files, search, edit, and run terminal commands through any OpenCode model.
- **Sticky routing headers** — adds `x-opencode-session`, `x-opencode-request`, and `x-opencode-client` headers to preserve gateway affinity across requests.
- **Request & stream timeouts** — configurable total request timeout (default 600s) and stream idle timeout (default 120s) so hanging requests fail cleanly.

### Pricing & Model Intelligence

- **Cost metadata** — exposes per-model `inputCost`, `outputCost`, `cacheCost`, and `priceCategory` from the live `models.dev` registry, so the VS Code model picker and Language Models view display real pricing (converted from USD to AI Credits at 1 USD = 100 credits).
- **Modality detection** — surfaces **audio**, **video**, and **PDF input** support in model tooltips and detail badges alongside the existing vision indicator, sourced from live `models.dev` metadata.

### Thinking & Reasoning Controls

- **Per-model Thinking configuration** — dedicated settings for each model family, now dynamically enhanced with per-model `reasoning_options` from `models.dev`:
  - **DeepSeek**: `off` / `low` / `medium` / `high` / `max`
  - **GLM**: `on` / `off`
  - **Kimi**: `on` / `off`
  - **MiniMax**: `off` / `on`
  - **Mimo (Xiaomi)**: `off` / `low` / `medium` / `high`
  - **Qwen**: `auto` / `on` / `off` + optional `thinking_budget` (`4096`–`81920`)
  - **Dynamic from models.dev** — when `models.dev` provides explicit `reasoning_options` for a model (e.g. `[{type:"effort",values:["low","medium","high","max"]}]`), the picker renders the exact options the model supports, overriding any hardcoded defaults.
- **Dynamic fallback** — any model with `reasoning: true` in its metadata automatically gets a generic `off`/`on` Thinking Effort control, so future reasoning-capable models work without hardcoded mappings.
- **`opencodego.debugReasoning`** — writes provider `reasoning_content` to the **Output → OpenCode** channel for debugging thinking-mode responses.

### Context Size & Tiered Pricing

- **Context Size selector** — models with tiered pricing (from `models.dev` `cost.tiers[]` and `cost.context_over_200k`) expose a **Context Size** dropdown in the model picker, letting you choose between e.g. `256K` (default pricing) and `1M` (higher pricing). The selected value caps the effective context window for each request.
- **Pricing transparency** — per-model `inputCost`, `outputCost`, `cacheCost`, and `priceCategory` from the live `models.dev` registry are exposed to the VS Code model picker, so you always see the real pricing for your selected tier.

### Usage Tracking

- **Go Usage Tracker** — real-time tracking of OpenCode Go subscription limits as percentages in the status bar:
  - Tracks **5-hour rolling** ($12), **weekly** ($30), and **monthly** ($60) subscription tiers.
  - Calculates client-side cost from token usage × per-model pricing (input, output, cache_read).
  - Status bar indicator (`Go: 27%·62%·75%`) shows all three periods at a glance, with ⚠ warning when any period exceeds 80%.
  - Usage log persisted in VS Code `globalState` so data survives editor restarts.
- **Response usage bar** — shows the latest prompt/output/total/cache summary in the status bar after each OpenCode response.
- **Normalized usage DataPart** — emits a normalized `LanguageModelDataPart` with `usage` MIME for each response, so Copilot Chat's context window widget and future BYOK integrations can consume prompt/output/cache metadata without re-parsing raw transport logs.
- **Context window hook** — bridges real BYOK token usage back to VS Code's internal chat request IDs so the Copilot Chat footer displays accurate context usage for OpenCode models.

### Diagnostics & Debugging

- **OpenCode Go: Diagnostics** — one-click markdown report of all registered Go models, their metadata, and recent Go request summaries (endpoint, tokens, latency, errors).
- **OpenCode Zen: Diagnostics** — same for Zen models and Zen request summaries.
- **OpenCode: Model Picker Diagnostics** — shows all registered models across OpenCode Go, Zen, and Copilot vendors with full metadata side-by-side.
- **Provider transport history** — persists recent request summaries (endpoint, initiator, metadata source, request IDs, token usage, latency, errors) in VS Code `globalState`, viewable in diagnostics reports.

---

## Requirements

- VS Code **1.118.0** or higher with the Language Model Chat Provider API
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
| `OpenCode Go: Diagnostics` | Show a markdown report of registered OpenCode Go models and recent Go request summaries |
| `OpenCode Zen: Diagnostics` | Show a markdown report of registered OpenCode Zen models and recent Zen request summaries |
| `OpenCode: Model Picker Diagnostics` | Show all registered models across OpenCode Go, Zen, and Copilot vendors with full metadata |
| `OpenCode: Set Thinking Effort…` | Configure per-family Thinking mode (DeepSeek, GLM, Kimi, Mimo, Qwen) and Qwen thinking budget |

> **Note:** The native BYOK flow via **Language Models** (gear icon ⚙) is recommended. VS Code will ask for a group name, then the matching API key. Go and Zen are separate provider groups, so both can be active at the same time.

---

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `opencodego.temperature` | `number` | `0.2` | Sampling temperature for chat completions (`0`–`2`) |
| `opencodego.maxTokens` | `number` | `0` | Max output token override — `0` uses the per-model bundled maximum |
| `opencodego.maxInputTokens` | `number` | `0` | Context window override — `0` uses the per-model bundled context size |
| `opencodego.debugReasoning` | `boolean` | `false` | Write provider `reasoning_content` to **Output → OpenCode** for debugging |
| `opencodego.requestTimeoutSeconds` | `number` | `600` | Total request timeout for OpenCode Go and Zen API calls |
| `opencodego.streamIdleTimeoutSeconds` | `number` | `120` | Cancels a request if the response stream stops sending chunks for too long |
| `opencodego.showUsageStatusBar` | `boolean` | `true` | Show the latest OpenCode usage summary in the VS Code status bar |
| `opencodego.freeOnly` | `boolean` | `true` | Limit OpenCode Zen to free models only. Disable to include paid Zen models in the picker |
| `opencodego.thinking.deepseek` | `string` | `"off"` | Thinking mode for DeepSeek models (`off`, `low`, `medium`, `high`, `max`) |
| `opencodego.thinking.glm` | `string` | `"off"` | Thinking mode for GLM models (`on`, `off`) |
| `opencodego.thinking.kimi` | `string` | `"off"` | Thinking mode for Kimi models (`on`, `off`) |
| `opencodego.thinking.mimo` | `string` | `"off"` | Thinking mode for Mimo (Xiaomi) models (`off`, `low`, `medium`, `high`) |
| `opencodego.thinking.qwen` | `string` | `"off"` | Thinking mode for Qwen models (`auto`, `on`, `off`) |
| `opencodego.thinking.qwenBudget` | `string` | `"auto"` | Optional `thinking_budget` for Qwen models (`auto`, `4096`, `16384`, `32768`, `81920`). Ignored when Qwen thinking is `off` |

---

## Models

The extension fetches the live model lists from:

```
https://opencode.ai/zen/go/v1/models   (OpenCode Go — paid)
https://opencode.ai/zen/v1/models       (OpenCode Zen — free)
```

The **Go provider** exposes all OpenCode Go models. The **Zen provider** filters the live Zen list to free models (`*-free` plus `big-pickle`) by default. Set `opencodego.freeOnly` to `false` to include the paid Zen catalog in the picker. The bundled fallback catalog mirrors the current Go catalog and both the free and paid Zen catalogs so offline registration stays closer to the live service.

Model limits and capabilities are resolved in this order:

1. Live metadata returned by OpenCode `/models` when available.
2. A 6-hour models.dev snapshot cached in VS Code global state.
3. The bundled fallback catalog shipped with the extension.

Deprecated or known-unavailable models are filtered before registration, so stale Zen entries do not remain visible just because they still appear in `/models`.

VS Code and Copilot read separate input/output metadata fields for UI display. The extension advertises the resolved context window so the **Language Models** table, model picker tooltip, and chat context indicator stay aligned with the latest metadata it can reach.

### Bundled model limits

Limits are taken from the current [models.dev](https://models.dev) registry when available, with bundled fallback values retained for legacy entries that are no longer published there. Per-provider limits are tracked separately (Go vs Zen) so models shared across providers use the correct values for each.

**OpenCode Go**

| Model | Context window | Max output tokens |
|---|---:|---:|
| `deepseek-v4-pro` / `deepseek-v4-flash` | 1,000,000 | 384,000 |
| `qwen3.7-max` | 1,000,000 | 65,536 |
| `mimo-v2.5-pro` / `mimo-v2-pro` | 1,048,576 | 128,000 |
| `mimo-v2.5` | 1,000,000 | 128,000 |
| `kimi-k2.6` | 262,144 | 65,536 |
| `kimi-k2.5` | 262,144 | 65,536 |
| `qwen3.6-plus` / `qwen3.5-plus` | 262,144 | 65,536 |
| `mimo-v2-omni` | 262,144 | 128,000 |
| `hy3-preview` | 256,000 | 64,000 |
| `minimax-m2.7` | 204,800 | 131,072 |
| `minimax-m2.5` | 204,800 | 65,536 |
| `glm-5.1` | 202,752 | 32,768 |
| `glm-5` | 202,752 | 32,768 |

**OpenCode Zen (selected fallback entries)**

| Model | Context window | Max output tokens |
|---|---:|---:|
| `claude-opus-4-7` / `claude-opus-4-6` | 1,000,000 | 128,000 |
| `claude-sonnet-4-6` / `claude-sonnet-4-5` / `claude-sonnet-4` | 1,000,000 | 64,000 |
| `gpt-5.5` / `gpt-5.5-pro` / `gpt-5.4` / `gpt-5.4-pro` | 1,050,000 | 128,000 |
| `gpt-5.4-mini` / `gpt-5.4-nano` / `gpt-5.3-codex` / `gpt-5.2` / `gpt-5.2-codex` / `gpt-5.1*` / `gpt-5*` | 400,000 | 128,000 |
| `gpt-5.3-codex-spark` | 128,000 | 128,000 |
| `gemini-3.5-flash` / `gemini-3.1-pro` / `gemini-3-flash` | 1,048,576 | 65,536 |
| `grok-build-0.1` | 256,000 | 256,000 |
| `glm-5` / `glm-5.1` | 204,800 | 131,072 |
| `kimi-k2.6` / `kimi-k2.5` | 262,144 | 65,536 |
| `minimax-m2.7` / `minimax-m2.5` / `minimax-m2.5-free` | 204,800 | 131,072 |
| `qwen3.6-plus` / `qwen3.6-plus-free` / `qwen3.5-plus` | 262,144 | 65,536 |
| `deepseek-v4-flash-free` | 200,000 | 128,000 |
| `nemotron-3-super-free` | 204,800 | 128,000 |
| `big-pickle` | 200,000 | 128,000 |

Set `opencodego.maxInputTokens` or `opencodego.maxTokens` to a non-zero value to override the bundled defaults globally.

### Endpoint routing

Most models use the OpenAI-compatible chat completions endpoint:

```
https://opencode.ai/zen/go/v1/chat/completions   (Go)
https://opencode.ai/zen/v1/chat/completions       (Zen)
```

The extension also routes these families automatically:

- OpenCode Go MiniMax M2 models (`minimax-m2.*`) → `/messages`
- OpenCode Zen Claude models (`claude-*`) → `/messages`
- OpenCode Zen GPT models (`gpt-*`) → `/responses`
- OpenCode Zen Gemini models (`gemini-*`) → `/models/{model}:streamGenerateContent?alt=sse`
- All other models (including all Qwen families) → `/chat/completions`

```
https://opencode.ai/zen/go/v1/messages
https://opencode.ai/zen/v1/messages
https://opencode.ai/zen/v1/responses
https://opencode.ai/zen/v1/models/gemini-3.5-flash:streamGenerateContent?alt=sse
```

All Qwen models (`qwen3.5-plus`, `qwen3.6-plus`, `qwen3.6-plus-free`, `qwen3.7-max`) are routed through `/chat/completions` because they use OpenAI-compatible tool calling natively (`choices[].delta.tool_calls`). Routing them to the Anthropic Messages API (`/messages`) caused tool calls to break because Anthropic uses a different `tool_use` content block format.

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
