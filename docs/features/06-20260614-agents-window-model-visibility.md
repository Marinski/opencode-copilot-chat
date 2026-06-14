**Status:** ✅ Solved

# Agents Window Model Visibility — OpenCode Models in Copilot CLI Picker

**Topic:** models / vscode / agents-window
**Updated:** 2026-06-14
**Tags:** #models #vscode #agents-window #targetChatSessionType #marketplace #copilotcli
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#11](https://github.com/ltmoerdani/opencode-copilot-chat/issues/11)
**GitHub PR:** [#39](https://github.com/ltmoerdani/opencode-copilot-chat/pull/39) (by [@Marinski](https://github.com/Marinski))
**Related Research:** [`docs/references/01-20260611-agents-window-model-visibility.md`](../references/01-20260611-agents-window-model-visibility.md)

---

## Overview

OpenCode Go and OpenCode Zen models now appear in the VS Code **Agents window** model picker when starting a Copilot CLI / Background agent session. Previously they were only visible in the regular Chat view.

GitHub Issue #11 requested this feature. The full research investigation (3 options evaluated, VS Code source code analysis) is documented in [`docs/references/01-20260611-agents-window-model-visibility.md`](../references/01-20260611-agents-window-model-visibility.md). This document covers the implementation shipped in PR #39.

---

## Problem

VS Code has two chat surfaces with **separate** model pickers:

| Surface | Session Type | Picker Filter |
|---------|-------------|---------------|
| **Chat View** | `local` | Shows models WITHOUT `targetChatSessionType` |
| **Agents Window** (Copilot CLI tab) | `copilotcli` | Shows ONLY models WITH `targetChatSessionType: "copilotcli"` |

Models registered via `vscode.lm.registerLanguageModelChatProvider()` without `targetChatSessionType` were completely absent from the Agents window. The root cause: VS Code's `filterModelsForSession()` excludes models without a matching `targetChatSessionType` whenever **any** model targets that session type (Copilot's built-in models do).

---

## Solution

Register each model **twice** from `provideLanguageModelChatInformation()` in `src/extension.ts`, using `flatMap` instead of `map`:

| Variant | `id` | `targetChatSessionType` | Visible in |
|---------|------|--------------------------|------------|
| General | `opencodego:deepseek-v4-flash` | _(none)_ | Chat view |
| Agents-window | `opencodego:deepseek-v4-flash::agent-host` | `"copilotcli"` | Agents window > Copilot CLI session |

### Why No Picker Duplication

VS Code's `filterModelsForSession()` partitions the two variants — each surface sees only the entries meant for it:

| Surface | Filter applied | What it sees |
|----------|----------------|--------------|
| **Chat view** | Models with NO `targetChatSessionType` | Only the general variant |
| **Agents window** | Models with `targetChatSessionType === "copilotcli"` | Only the agents-window variant |

This is confirmed by [microsoft/vscode#298862](https://github.com/microsoft/vscode/pull/298862), which makes `getDefaultLanguageModel()` also exclude session-targeted models. Neither picker shows both variants.

### Why Routing is Unchanged

The `::agent-host` suffix in the agents-window model ID is stripped by the existing `resolveRawModelId()` helper:

```typescript
function resolveRawModelId(modelId: string): string {
  const [base] = modelId.split("::");  // strips "::agent-host"
  // ... then strips vendor prefix
}
```

All backend routing, API key lookup, and metadata resolution continue to use the real model ID. The API key map is also seeded with the `::agent-host` variant:

```typescript
this.apiKeysByModelId.set(modelId, apiKey);
this.apiKeysByModelId.set(effectiveModelId, apiKey);
this.apiKeysByModelId.set(agentHostModelId, apiKey);  // ← added
```

### `targetChatSessionType` Value

The correct value is `"copilotcli"` — the `type` field from the Copilot extension's `chatSessions` contribution in its `package.json`:

```json
{ "type": "copilotcli", "requiresCustomModels": true, ... }
```

> **Note:** Earlier research (Issue #11) tested `"agent-host-copilotcli"` (the VS Code internal resource URI scheme), which is different and does not work. The working value is the bare `"copilotcli"`.

---

## Required User Setting

The Agents window does **not** activate third-party extensions by default. Users must opt in via VS Code `settings.json`:

```json
"extensions.supportAgentsWindow": {
    "ltmoerdani.opencode-copilot-chat": true
}
```

Without this setting, the extension will not load in the Agents window process and no OpenCode models will appear in the picker, regardless of the `targetChatSessionType` registration.

---

## Files Changed

| File | Change |
|------|--------|
| `src/extension.ts` | `provideLanguageModelChatInformation()` changed from `map` to `flatMap`; returns `[generalVariant, agentsWindowVariant]` per model. Added `agentHostModelId` to `apiKeysByModelId` map. |

No `package.json` changes. No `enabledApiProposals` needed — `targetChatSessionType` is **stable API** (not proposed), so this is fully marketplace-compatible.

---

## Implementation Detail

```typescript
return models.flatMap((modelId) => {
  // ... metadata, routing, limits resolution ...
  const effectiveModelId = toEffectiveModelId(modelId, this.definition.vendor);
  const agentHostModelId = `${effectiveModelId}::agent-host`;
  // ...
  this.apiKeysByModelId.set(modelId, apiKey);
  this.apiKeysByModelId.set(effectiveModelId, apiKey);
  this.apiKeysByModelId.set(agentHostModelId, apiKey);

  const sharedFields: Omit<OpenCodeModel, "id" | "targetChatSessionType"> = {
    rawModelId: modelId,
    name: `${this.definition.modelNamePrefix} / ${formatModelName(modelId)}`,
    // ... all shared fields (family, version, maxInputTokens, capabilities, etc.)
  };

  // General variant — no targetChatSessionType → visible in Chat view
  const info: OpenCodeModel = { ...sharedFields, id: effectiveModelId };

  // Agents-window variant — targetChatSessionType matches Copilot CLI session
  const agentHostInfo: OpenCodeModel = {
    ...sharedFields,
    id: agentHostModelId,
    targetChatSessionType: "copilotcli"
  };

  return [info, agentHostInfo];
});
```

---

## Verification (PR #39, 2026-06-14)

| Check | Result |
|-------|--------|
| `tsc` compile | ✅ 0 errors |
| VSIX build + install | ✅ Models appear in Agents window (Copilot CLI session) model picker |
| Chat view picker | ✅ Each model shows exactly once (no `::agent-host` entries) |
| Routing chain | ✅ `::agent-host` suffix stripped by `resolveRawModelId()`; API key + model resolution correct |
| Marketplace safety | ✅ No `enabledApiProposals` needed |
| `vsce ls` | ✅ Manifest valid, publishable |

### Known Minor Issue (non-blocking)

`showDiagnostics()` calls `vscode.lm.selectChatModels({ vendor })`, which now returns both variants. Since `resolveRawModelId()` strips `::agent-host`, both resolve to the same `rawModelId` → diagnostics output lists each model twice. This is purely cosmetic in the diagnostics view and can be addressed separately by filtering out `model.id.includes("::agent-host")` in `showDiagnostics()`.

---

## Timeline

| # | Date | Event |
|---|------|-------|
| 1 | 2026-06-11 | Research session — 3 options evaluated, Option A recommended ([reference doc](../references/01-20260611-agents-window-model-visibility.md)) |
| 2 | 2026-06-11 | Issue #11 opened with detailed VS Code source code analysis |
| 3 | 2026-06-13 | Reference doc completed; Option A documented for implementation |
| 4 | 2026-06-14 | PR #39 opened by @Marinski — implemented Option A with `flatMap` + `targetChatSessionType: "copilotcli"` |
| 5 | 2026-06-14 | Local verification: compile + VSIX install + Agents window test — all PASS |
| 6 | 2026-06-14 | PR #39 merged (merge commit) to main |

---

## Lessons Learned

1. **`targetChatSessionType` is stable API** — no `enabledApiProposals` needed, fully marketplace-compatible. This is the only hook into the Agents window model picker without proposed APIs.
2. **Model duplication is the standard pattern** — Copilot's own built-in models do the same (registered with `targetChatSessionType: "copilotcli"`, invisible in Chat view). VS Code's filter logic cleanly partitions variants per surface.
3. **`extensions.supportAgentsWindow` is a prerequisite** — the Agents window runs extensions in a separate process that must be explicitly enabled per-extension. Easy to miss during testing.
4. **The bare session type value works, not the resource scheme** — `"copilotcli"` (from `SessionType.CopilotCLI`) is correct; `"agent-host-copilotcli"` (the resource URI scheme) is not.

---

_Implemented by @Marinski in PR [#39](https://github.com/ltmoerdani/opencode-copilot-chat/pull/39). Resolves Issue [#11](https://github.com/ltmoerdani/opencode-copilot-chat/issues/11)._
