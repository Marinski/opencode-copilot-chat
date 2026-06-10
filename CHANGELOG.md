# Changelog

All notable changes to the **OpenCode Go BYOK Provider** extension are documented here.

## [Unreleased]

### Fixed

- **Kimi thinking format correction.** The `[0.2.4]` changelog entry incorrectly stated that Kimi models use `enable_thinking: true | false`. Tests confirm the OpenCode Go gateway **rejects** `enable_thinking` (HTTP 400: "Extra inputs are not permitted"). The correct format is `thinking: { type: "enabled" | "disabled" }` — matching GLM's format and what the gateway expects for MoonshotAI models on the OpenAI-compatible endpoint. The extension code has been using `thinking: { type }` all along; this entry corrects the record.

## [0.2.6] — 2026-06-10

### Removed

- **Removed message trimming feature entirely** (`messageTrimmer.ts`). The byte-aware trimming that pruned older conversation turns was too aggressive and disruptive — users reported losing significant context with notifications appearing on every long conversation. Removed all related code: `messageTrimmer.ts` module, trimming logic in `extension.ts`, and payload size safety net in `streaming.ts`.
- **Removed gzip compression** (`node:zlib`). The OpenCode Go/Zen proxy does not support `Content-Encoding: gzip` and returns HTTP 500 Internal Server Error when receiving compressed request bodies. All outgoing requests now send raw JSON payloads.

## [0.2.5] — 2026-06-10

### Fixed

- **Removed gzip compression** — the OpenCode Go/Zen proxy does **not** support `Content-Encoding: gzip` and returns HTTP 500 Internal Server Error when receiving compressed request bodies. All outgoing requests now send raw JSON payloads. Message trimming (`messageTrimmer.ts`) remains the primary mechanism for keeping payloads under the proxy's ~400 KB body limit.

## [0.2.4] — 2026-06-10

### Added

- **Byte-aware message trimming.** New `messageTrimmer.ts` module provides `trimApiMessages()` which prunes older conversation turns when the messages array exceeds a byte budget (~800 KB). Always preserves the system prompt, full conversation turns, and tool-call atomicity. A subtle notification is shown to the user when a significant portion (>30%) of context is trimmed.
- **Context Size selector for tiered-pricing models.** Models with `cost.tiers[]` or `cost.context_over_200k` in their `models.dev` metadata now expose a **Context Size** dropdown in the VS Code model picker (e.g. `256K` ↔ `1M`). The selected value caps the effective `maxInputTokens` for each request, matching the pricing structure declared by the upstream provider. Supported for both OpenCode Go and OpenCode Zen models.
- **Dynamic reasoning options from models.dev.** When a model's `models.dev` entry declares explicit `reasoning_options` (e.g. `[{type:"effort",values:["low","medium","high","max"]}]`), the model picker renders those exact effort levels, overriding the family-based hardcoded defaults. The `reasoningOptions` field is propagated through `ModelMetadataFields` → `ResolvedModelMetadata` → `modelConfigurationSchema()`.
- **Thinking controls for Mimo and MiniMax models.** MiniMax (`minimax-m*`) models now support on/off thinking only (`thinking: { type: "disabled"|"adaptive"|"enabled" }` — the OpenCode gateway does not expose `reasoning_effort` for this family, as verified in the official `transform.ts`). Mimo (`mimo-v2.*`) models support `off`/`low`/`medium`/`high` reasoning effort levels. DeepSeek (`deepseek-v4-*`) models support `off`/`low`/`medium`/`high`/`max` — matching the upstream OpenCode reasoning effort options sourced from the official OpenCode provider `transform.ts`. The `opencodego.thinking.mimo`, `opencodego.thinking.minimax` and `opencodego.thinking.deepseek` settings have been updated with the corrected enum values.
- **Kimi thinking format corrected.** Kimi models (`kimi-k2.5`, `kimi-k2.6`) on the OpenAI-compatible chat-completions endpoint now send `enable_thinking: true | false` (MoonshotAI-native boolean) instead of the Anthropic-style `thinking: { type: "enabled" | "disabled" }` object, which was silently ignored. The `opencodego.thinking.kimi` setting description updated accordingly.
- **Dynamic configuration schema** — any model with `reasoning: true` in its resolved metadata (from `models.dev`, live API, or bundled fallback) automatically gets a generic `off`/`on` Thinking Effort control in the model picker, without requiring a hardcoded family mapping. Future reasoning-capable models will work out of the box.
- New settings `opencodego.thinking.mimo` (`"off"` / `"low"` / `"medium"` / `"high"`, default `"off"`) and expanded `opencodego.thinking.deepseek` (`"off"` / `"low"` / `"medium"` / `"high"` / `"max"`, default `"off"`).
- New setting `opencodego.stripThinkTags` (`"auto"` / `"on"` / `"off"`, default `"auto"`) — strips `<!--<think-->...<!--</think-->` tags from model output. In `"auto"` mode, stripping applies only to known models that inline reasoning in content (MiniMax M3 family). Merged from main (`v0.2.2`).

### Changed

- **Merged `main` into `develop`** — all features from `main` (Mimo thinking, context size selector, dynamic reasoning, strip think tags, icon refresh) are now unified with develop-only features (gzip compression, message trimming) into a single coherent branch.
- Streaming layer cleaned up — removed gzip compression logic that caused proxy 500 errors. SSE parsing and request flow remain unchanged.

### Fixed

- Fixed merge conflict in `modelLimits()` signature — `contextSizeOverride` parameter from main is now correctly combined with develop's message trimming logic.
- Fixed missing `stripThinkTags` property on `ApiSettings` interface after merge.
- Fixed missing closing parenthesis on `stripThinkTags` config getter that caused TypeScript parse error.
- Fixed `Buffer` not found TypeScript error by replacing `Buffer.from(part.data).toString("utf8")` with `new TextDecoder().decode(part.data)` in `estimateDataPartTokenCount`.

## [0.2.3] — 2026-06-09

### Added

- Refreshed extension icon (`opencodego.png` and `opencodego.svg`) with a redesigned visual featuring gradient backgrounds, subtle grid pattern, glow effects, and sparkle accents for a more polished marketplace presence.

### Changed

- Cleaned up the "OpenCode" output channel by removing all verbose debug and informational logs. The output channel was previously flooded with per-model registration logs, per-request summaries, streaming stats, metadata refresh messages, and usage tracking lines. Now the output channel only surfaces error-level messages (e.g. `ERROR model=...`) and critical warnings (empty response, rate limits, HTTP errors), keeping it clean for production use. All removed diagnostic data was already accessible through the extension's diagnostics document and status bar indicators.

### Fixed

- Fixed `Buffer` not found TypeScript error by replacing `Buffer.from(part.data).toString("utf8")` with `new TextDecoder().decode(part.data)` in `estimateDataPartTokenCount`. `TextDecoder` is a Web API available in all JS environments without requiring `@types/node`.

## [0.2.2] — 2026-06-08

### Fixed
- Strip `<think>...</think>` tags from model output when enabled. For streaming responses, the inner thinking content is accumulated into the reasoning pipeline and displayed via the existing reasoning fallback. For non-streaming fallback, the tags are removed and only the surrounding text is kept. Gated by the new `opencodego.stripThinkTags` setting (`"auto"` / `"always"` / `"never"`). In `"auto"` mode (default), stripping applies only to known models that inline reasoning in `<think>` tags within the content field (MiniMax M3 family).

## [0.2.1] — 2026-06-06

### Removed

- Removed the unused `opencodego.showUsage` command, `showGoUsagePanel` WebView panel, and related activation event. The Go Usage Tracker details are still accessible via the status bar indicator (`Go: XX%·XX%·XX%`). The separate Quick Pick panel was removed because the status bar already provides glanceable usage data and the dedicated panel added unnecessary code complexity without proportional user benefit.

## [0.2.0] — 2026-06-05

### Added

- Added **Go Usage Tracker** — real-time tracking of OpenCode Go subscription limits as percentages in the status bar and a Quick Pick panel.
  - Tracks 5-hour rolling ($12), weekly ($30), and monthly ($60) limits per the OpenCode Go subscription tiers.
  - Calculates client-side cost from token usage × per-model pricing (input, output, cache_read) for every Go model.
  - Status bar indicator (`Go: 27%·62%·75%`) shows 5h / weekly / monthly usage at a glance, with ⚠ warning when any period exceeds 80%.
  - Click the status bar to open a detailed Quick Pick panel showing progress bars, today/yesterday breakdown, and actions to open diagnostics console or reset data.
  - Usage log persisted in VS Code `globalState` so data survives editor restarts.
  - New command: `OpenCode Go: Show Usage` (`opencodego.showUsage`).

## [0.1.10] — 2026-06-05

### Fixed

- Fixed Qwen models returning 401 error ("Model qwen3.7-max is not supported for format oa-compat"). Qwen models on the OpenCode Go gateway are only available through the Anthropic Messages API endpoint, not the OpenAI chat-completions endpoint. Reverted the routing while fixing the actual root cause.
- Fixed Anthropic streaming tool call parsing in `AnthropicResponseExtractor`. The extractor now correctly handles Anthropic SSE event types (`content_block_start` with `tool_use` blocks, `content_block_delta` with `input_json_delta`, `message_delta`, `message_stop`) so Qwen tool calls are properly captured and surfaced to VS Code Copilot Chat.
- Fixed Anthropic usage metadata parsing. Added support for Anthropic-native fields (`input_tokens`, `output_tokens`, `cache_read_input_tokens`) in addition to OpenAI fields, so the context window indicator updates correctly for Qwen models routed through the messages endpoint.
- Fixed Qwen thinking payload format when routed through the Anthropic messages endpoint. Qwen thinking settings are now translated to Anthropic-native format (`{ type: "enabled"|"disabled" }`) instead of Qwen-native `enable_thinking` boolean, matching what the OpenCode gateway expects.

## [0.1.9] — 2026-06-04

### Fixed

- Fixed Qwen models (`qwen3.5-plus`, `qwen3.6-plus`, `qwen3.6-plus-free`, `qwen3.7-max`) not being able to call VS Code tools (file reading, terminal, etc.) and responding with short answers without follow-through. The root cause was Qwen being incorrectly routed to the Anthropic Messages API (`/messages`) which uses a different tool calling format (`tool_use` content blocks) than Qwen's native OpenAI-compatible format (`choices[].delta.tool_calls`). All Qwen models now correctly route to the chat-completions endpoint (`/chat/completions`) where tool calls are properly parsed and surfaced to Copilot Chat.
- Fixed context window indicator not updating for Qwen models by ensuring the response streaming path correctly reports usage metadata back to VS Code.

## [0.1.8] — 2026-06-04

### Added

- Added support for VS Code's `languageModelPricing` proposed API, exposing `pricing`, `inputCost`, `outputCost`, `cacheCost`, and `priceCategory` on every registered model so the model picker and management UI can display real cost metadata.
- Parsed per-model cost data from the live `models.dev` registry (`cost.input`, `cost.output`, `cost.cache_read`, `cost.cache_write`) and converted USD values to AI Credits (`1 USD = 100 AI credits`) for native VS Code consumption.
- Added modality detection from `models.dev` metadata, surfacing audio, video, and PDF input support in model tooltips and detail badges alongside the existing vision indicator.

### Changed

- Removed the `opencodego.experimentalContextIndicator` configuration setting and its associated context-window hook bridge; the same capability was already implemented natively in commit `ca8bbb6` and the redundant experimental path is no longer needed.
- Consolidated duplicate local type definitions (`BaseModelLimits`, `ModelMetadataFields`, `CachedModelMetadataSnapshot`, `ResolvedModelMetadata`) that were shadowing the canonical types in `metadata.ts`, ensuring `cost` and modality fields flow correctly through the metadata pipeline.
- Bumped the cached `models.dev` snapshot key from `v3` to `v4` so users automatically re-fetch the registry on next activation and pick up the freshly added `cost` and modality data, instead of consuming stale cached entries that did not carry those fields.
- Aligned the `priceCategory` thresholds with the Copilot extension's 3:1 input:output weighted blend so low/medium/high/very_high buckets line up with what the user sees for the official Copilot models (e.g. Kimi k2.6 is `medium`, GPT-5.4 is `medium`, Claude Opus 4.5 is `high`, GPT-5.4 Pro is `very_high`).

### Fixed

- Corrected the `modelCapabilities` return type to use the official `vscode.LanguageModelChatCapabilities` shape (`imageInput`, `toolCalling`, `supportsImageToText`, `supportsToolCalling`) instead of ad-hoc fields, aligning with how VS Code internally maps provider capabilities to `vision` / `toolCalling` / `agentMode`.

## [0.1.7] — 2026-05-27

### Added

- Added recent OpenCode transport summaries to the Go and Zen diagnostics reports, including endpoint, initiator, metadata source, request IDs, token usage, latency, and error details for the last provider requests.
- Persist recent diagnostics request summaries in VS Code global state so the request history survives extension host reloads and can be reused if VS Code later exposes richer BYOK debug surfaces.
- Added a usage status bar summary with prompt/output/total/cache data after each OpenCode response.
- Added OpenCode usage DataPart emission so later Copilot Chat integrations can consume normalized prompt/output/cache metadata without re-parsing raw transport logs.
- Added an opt-in experimental context-indicator hook that can inject real BYOK usage into the Copilot Chat footer using VS Code internals.

### Changed

- Extracted the OpenCode transport and SSE parsing layer into a dedicated `streaming.ts` module so provider wiring, request building, and stream normalization can evolve independently.
- Keep capturing request usage and finish metadata even when VS Code's native Agent Debug Log does not surface custom BYOK provider telemetry.
- Enriched OpenCode output logging with normalized usage lines, finish reasons, and cache hit ratio when the upstream provider reports cache metadata.
- Route provider progress and usage through a local request-id bridge so the experimental context hook can bind real request usage back to VS Code's internal chat request ids.
- Simplified the Anthropic `/messages` request builder by removing dead branches and consolidating repeated text extraction helpers after the qwen3.7 transport fix.
- Refreshed the bundled fallback catalogs to match the current OpenCode Go catalog and the current free/paid Zen catalogs.

### Fixed

- Fixed OpenCode `/messages` authentication to follow the gateway contract (`x-api-key` for Anthropic-style routes, bearer auth for OpenAI-style routes), which restores OpenCode Go `qwen3.7-max` in Copilot Chat.
- Fixed the OpenCode `/messages` body builder to emit Anthropic-compatible message blocks instead of forwarding OpenAI-shaped payloads to that endpoint.
- Aligned OpenCode Go and Zen Qwen routing with the current official endpoint docs: Go `qwen3.5-plus`, `qwen3.6-plus`, and `qwen3.7-max`, plus Zen `qwen3.5-plus` / `qwen3.6-plus`, now use `/messages`.
- Report provider token usage back to VS Code via `LanguageModelDataPart` MIME `usage` so Copilot Chat's Context Window widget can display used tokens instead of staying at 0%.
- Improved local token counting for chat messages, tool calls, tool results, JSON/data parts, and image attachments.
- Logged raw HTTP error bodies in the OpenCode output channel so provider-specific backend failures can be diagnosed without reproducing requests manually.

## [0.1.6] — 2026-05-21

### Added

- Added configurable OpenCode request and streaming idle timeouts so Copilot Chat requests fail clearly instead of hanging indefinitely.
- Added sticky OpenCode request headers (`x-opencode-session`, `x-opencode-request`, `x-opencode-client`) so Go and Zen requests preserve gateway affinity behavior.
- Added clearer rate-limit and quota handling, including retry/quota details from response headers when available.
- Added a TTL-cached models.dev metadata snapshot, merged with live `/models` metadata and a bundled fallback catalog for offline picker registration.
- Added native Zen GPT routing through `/responses` and Zen Gemini routing through the documented Google-style `/models/{model}:streamGenerateContent?alt=sse` endpoint.

### Changed

- Corrected fallback-advertised model limits to follow `models.dev` whenever the live `/models` payload does not provide limit metadata, fixing earlier Go/Zen cross-provider mix-ups in the bundled table.
- This reduces several previously overstated fallback values, notably `deepseek-v4-flash-free` to `200000 / 128000`, `glm-5` and `glm-5.1` to `202752 / 32768`, and Go `minimax-m2.5` to `204800 / 65536`.

### Fixed

- Updated bundled fallback limits and capability hints so the picker stays usable when neither `/models` nor models.dev can be refreshed.
- Zen Claude, Zen GPT, Zen Gemini, and Go MiniMax families now use the correct transport automatically instead of being forced through a single OpenAI-compatible route.

## [0.1.5] — 2026-05-20

### Fixed

- Fixed vision requests with image attachments failing before upload due to stack overflow while encoding image bytes.
- Avoid forcing Qwen `thinking_budget` on vision requests when Thinking is set to Auto, reducing image request token pressure from Alibaba-backed models.
- Stopped advertising image input support for models that do not support image attachments in OpenCode metadata: `glm-5`, `glm-5.1`, `minimax-m2.5`, `minimax-m2.7`, `minimax-m2.5-free`, `mimo-v2-pro`, and `mimo-v2.5-pro`.

## [0.1.4] — 2026-05-17

### Added

- Added `opencodego.freeOnly` to control whether the OpenCode Zen provider exposes only free models or the full Zen catalog.
- Added native per-model Thinking configuration schema for DeepSeek, GLM, Kimi, and Qwen models.
- Added `reasoningEffort` support for Thinking controls and request logging for selected model configuration and final Thinking payload.

### Fixed

- Preserved numeric model versions in picker labels, so Zen model IDs like `claude-opus-4-5` now display as `Claude Opus 4.5` instead of `Claude Opus 4 5`.
- Bumped model metadata revision to force VS Code to refresh model-picker configuration metadata, including corrected model labels.
- Sanitized Copilot tool schemas before forwarding them to OpenCode providers, avoiding Moonshot/Kimi 400 errors caused by `$ref` schemas with sibling descriptions.
- Sent Qwen chat requests through the OpenCode chat-completions endpoint while preserving hybrid OpenAI/Anthropic stream parsing, avoiding the `/messages` auth path that returned `Missing API key`.
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
