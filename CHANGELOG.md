# Changelog

All notable changes to the **OpenCode Go BYOK Provider** extension are documented here.

## Unreleased

### Added

- Added `opencodego.freeOnly` to control whether the OpenCode Zen provider exposes only free models or the full Zen catalog.

### Fixed

- Filter deprecated OpenCode models using the models.dev registry before registering them with VS Code, with a local safety list for free models that now return provider 404s (`ring-2.6-1t-free`, `trinity-large-preview-free`).
- Removed stale unavailable models from bundled fallback lists so offline fallback does not reintroduce models that can no longer serve requests.
- API errors now use the active provider display name instead of always saying `OpenCode Go`.

## [0.1.3] — 2026-05-16

### Fixed

- **Context size now correct in picker and chat bar.** Removed the formula that inflated `advertisedContextWindow` by adding `maxOutputTokens` on top of `contextWindow`, which caused VS Code to round up and display `2M` for models with 262K or 1M actual context.
- **Model limits ported from models.dev (official OpenCode registry).** All context and output limits are now sourced from the authoritative `models.dev/api.json` registry, fixing previously wrong values across most models:
  - `qwen3.6-plus-free` / `qwen3.6-plus` / `qwen3.5-plus`: corrected from 1 M → **262 K** context
  - `glm-5` / `glm-5.1` max output: corrected from 32 K → **131 K**
  - `minimax-m2.5` max output: corrected from 65 K → **131 K**
  - `mimo-v2-omni` max output: corrected from 65 K → **128 K**
  - `hy3-preview`: corrected from 262 K / 128 K → **256 K / 64 K**
  - `ring-2.6-1t-free`: corrected to **262 K / 66 K**
  - `trinity-large-preview-free`: corrected to **131 K / 131 K**
  - `nemotron-3-super-free`: corrected from 262 K → **204 K** context, 65 K → **128 K** output
  - `big-pickle`: corrected from 262 K → **200 K** context, 65 K → **128 K** output
- **Model limits are now per-provider (Zen vs Go).** `MODEL_LIMITS_BY_PROVIDER` prevents Go and Zen limits from contaminating each other when both providers expose a model with the same ID (e.g. `qwen3.6-plus`, `glm-5.1`, `minimax-m2.7`).
- **Hard cache-bust for VS Code picker metadata.** Model `id`, `family`, and `version` fields now encode a per-revision token (`ctxfix-2026-05-16-b`) so VS Code drops stale context-size metadata after this update instead of showing old values.
- **API requests always use the raw upstream model ID**, never the revisioned effective ID, so backend routing is unaffected by the cache-bust strategy.
- **`qwen3.6-plus-free` deprecation label corrected.** Earlier sessions incorrectly labelled the model as deprecated based on a community PR that was ultimately rejected. The model is actively re-enabled by the OpenCode team ("Round 2 — found more GPUs"). Label is now "Limited capacity" with a note to retry on 5xx rather than "Deprecated upstream".

### Changed

- `provideLanguageModelChatResponse` now resolves the raw model ID via `model.rawModelId` before calling `modelLimits()` and forwarding the ID to the backend, so the revisioned effective ID is never sent to the OpenCode API.
- `modelLimits()` now accepts an optional `vendor` parameter; callers inside `OpenCodeProvider` pass `this.definition.vendor` for accurate per-provider lookups.

## [0.1.2] — 2026-05-14

### Added
- Added `opencodego.debugReasoning` to write provider `reasoning_content` to **Output → OpenCode** for opt-in debugging.
- Added a separate native **OpenCode Zen** provider (`opencodezen`) with its own BYOK configuration flow and free-model list from `https://opencode.ai/zen/v1/models`.
- Added `OpenCode Zen: Diagnostics` for inspecting Zen models registered with VS Code.

### Fixed
- Kept advertised context-size metadata consistent across the Language Models table, Copilot model picker tooltip, and chat context indicator while preserving the full OpenCode Go max-output limit for API requests.
- Improved provider token counting for mixed chat/tool content so Copilot receives a more realistic context usage estimate.
- Stopped resolving an extra unconfigured OpenCode Go model group from the legacy command-stored API key.
- Native Language Models entries are now produced only for configured provider groups, preventing duplicate model rows.
- Cached native BYOK API keys per resolved model so Copilot chat requests continue to work when VS Code does not pass provider configuration into `provideLanguageModelChatResponse`.
- Implemented OpenAI-compatible streaming tool-call parsing and conversion to `LanguageModelToolCallPart`, enabling Copilot Agent tool loops for file reads, search, edits, and workspace actions.
- Preserved assistant tool calls and tool results when converting VS Code chat history back into OpenAI-compatible messages.
- Captured and replayed DeepSeek `reasoning_content` on follow-up tool-result requests so thinking-mode models can continue multi-step tool workflows without provider errors.

## [0.1.1] — 2026-05-14

### Fixed
- Switched the Language Models gear flow to VS Code's native provider configuration schema.
- Added `apiKey` as a secret provider configuration field so configure/add prompts proceed from **Group Name** to **OpenCode Go API Key**.
- Provider now reads the configured API key from VS Code's language model configuration, with the command-stored key kept as a fallback.

## [0.1.0] — 2026-05-14

### Added
- Initial public release on VS Code Marketplace
- Live model list fetched from `https://opencode.ai/zen/go/v1/models` on activation
- Bundled fallback model metadata table (context window + max output tokens per model)
- Dual endpoint routing: OpenAI-compatible `/chat/completions` for standard models, Anthropic-compatible `/messages` for MiniMax M2 models
- Tool-calling support forwarded to both endpoint types
- `OpenCode Go: Manage Provider` command — model selection and management dialog
- `OpenCode Go: Set API Key` command — stores API key in VS Code Secret Storage
- `OpenCode Go: Diagnostics` command — renders a markdown report of all registered models
- Settings: `opencodego.temperature`, `opencodego.maxTokens`, `opencodego.maxInputTokens`
- Per-model token limit overrides via `opencodego.maxInputTokens` and `opencodego.maxTokens`
