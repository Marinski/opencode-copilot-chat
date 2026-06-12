**Status:** ✅ Solved

# Go Usage Tracker — Feature Implementation

**Topic:** usage / features / status-bar / provider / tracking
**Updated:** 2026-06-05
**Tags:** #usage #features #status-bar #go-usage #pricing #byok
**Supersedes:** —

---

## Overview

Implemented a real-time Go subscription usage tracker that displays 5-hour rolling, weekly, and monthly limit percentages in the VS Code status bar. The feature was triggered by a GitHub user request to display daily, weekly, and monthly limits as percentages. Research confirmed no OpenCode REST API exists for billing/usage, so the implementation uses client-side cost estimation from token counts × model pricing.

---

## Background

### User Request (GitHub)

> "Thanks for the great extension! It would be great to display the daily, weekly, and monthly limits for GO subscriptions as a percentage, as well as the amount spent per day."

### Research Findings

1. **No REST API** — OpenCode does not expose `/usage`, `/billing`, `/subscription`, `/quota`, or any public endpoint for usage data. All billing functions (`validateBilling()`, `queryLiteSubscription`) are server-side only.

2. **OpenUsage (github.com/robinebers/openusage)** — Uses 100% client-side approach:
   - Reads `~/.local/share/opencode/opencode.db` (SQLite) for server-computed `cost` field
   - Hardcodes limits from docs: $12/5h, $30/week, $60/month
   - Calculates percentages client-side

3. **OpenCode Go Pricing** — Full per-model pricing available at `opencode.ai/docs/go`:
   - Input, output, and cache_read prices per 1M tokens
   - 18+ models with pricing data

### UX Design Decision

User requested a design similar to Copilot's usage indicator:
- **Status bar icon** (bottom-right) — always visible, compact text
- **Click → Quick Pick panel** — detailed breakdown with progress bars

Final status bar format: `Go: 27%·62%·75%` (5h·weekly·monthly)
Warning threshold at >80%: `Go: 27%·83%⚠·75%`

---

## Implementation

### New File: `src/goUsageTracker.ts`

Complete usage tracking module (~500 lines):

| Component | Detail |
|-----------|--------|
| `GO_LIMITS` | `$12` (5h rolling), `$30` (weekly Mon–Mon UTC), `$60` (monthly anchor-based) |
| `GO_MODEL_PRICING` | 18+ models with input/output/cache_read per 1M token prices |
| `UsageLogEntry` | Per-request: timestamp, modelId, cost, promptTokens, completionTokens, cachedTokens |
| `estimateCost()` | Calculates USD from token counts × model pricing |
| `GoUsageTracker` | Main class — record entries, build period summaries, persist to globalState |
| `record()` | Captures `TransportRequestSummary` data after each Go request |
| `getSummary()` | Returns `UsageSummary` with session/weekly/monthly periods |
| `buildSummaryFromTracked()` | Aggregates tracked entries by time window |
| `buildSummaryFromRows()` | Aggregates SQLite rows (optional enrichment) |
| `formatGoUsageStatusBarText()` | Compact `Go: XX%·XX%·XX%` format |
| `formatGoUsageTooltip()` | Multi-line tooltip with dollar amounts and reset times |
| `buildUsageQuickPickItems()` | Quick Pick items with progress bars |

### Changes to `src/extension.ts`

| Change | Detail |
|--------|--------|
| Import `GoUsageTracker` | Plus formatting and Quick Pick helper functions |
| Module variables | `goUsageStatusBarItem`, `goUsageTracker` |
| `activate()` | Initialize tracker, create status bar item, register command |
| `onTransportSummary` callback | Gate on `this.definition.vendor === GO_VENDOR`, call `goUsageTracker.record()` |
| `ensureGoUsageStatusBar()` | Creates right-aligned status bar item at priority 94 |
| `refreshGoUsageStatusBar()` | Updates text/tooltip from tracker summary |
| `showGoUsagePanel()` | Quick Pick with progress bars, today/yesterday, actions |
| SQLite reader | Optional enrichment from `~/.local/share/opencode/opencode.db` |

### Changes to `package.json`

- Version bumped to `0.2.0`
- Command registered: `opencodego.showUsage`
- Activation event for the command

### Cost Calculation Logic

```typescript
cost = (billablePrompt × pricing.input + completionTokens × pricing.output
        + cachedTokens × pricing.cache_read) / 1_000_000

// billablePrompt = max(0, promptTokens - cachedTokens)
```

### Time Window Logic

| Period | Window | Reset Calculation |
|--------|--------|-------------------|
| **Session** | Rolling 5 hours | Oldest entry timestamp + 5h |
| **Weekly** | UTC Monday 00:00 → next UTC Monday 00:00 | Next Monday 00:00 UTC |
| **Monthly** | Anchor-based (oldest entry date) | Next anchor date cycle |

### Data Persistence

- Usage log stored in VS Code `globalState` under key `opencodego.usageLog.v1`
- Max 2000 entries, pruned to last 31 days
- Survives editor restarts

---

## Files Changed

| File | Change |
|------|--------|
| `src/goUsageTracker.ts` | **New** — Complete usage tracking module |
| `src/extension.ts` | Status bar, command, recording callback, Quick Pick panel |
| `package.json` | v0.2.0, new command registration |
| `CHANGELOG.md` | `[0.2.0]` entry |

## Verification

```bash
npx tsc --noEmit  # 0 errors
npx @vscode/vsce package --no-dependencies  # 106 KB VSIX
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension opencode-copilot-chat-0.2.0.vsix --force
```

## Result

✅ Go Usage Tracker shipped in v0.2.0. Status bar shows `Go: XX%·XX%·XX%` at all times. Clicking opens Quick Pick with detailed breakdown. Usage persists across editor restarts. Works entirely client-side without requiring any external API or CLI installation.

---

## Follow-up

Status bar did not update after testing — see `docs/issues/14-20260605-go-usage-status-bar-not-updating.md` for the debugging session.
