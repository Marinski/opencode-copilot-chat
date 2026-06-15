#!/usr/bin/env node
/**
 * validate-models.mts — Runtime validation suite for OpenCode model compatibility.
 *
 * Tests that the extension's request parameters are accepted by the upstream API.
 * Fetches live model lists from models.dev, determines correct endpoints and
 * parameters, and sends minimal test requests to detect HTTP 400 errors.
 *
 * Usage:
 *   npx tsx scripts/validate-models.mts [options]
 *
 * Options:
 *   --api-key <key>       OpenCode API key (or OPENCODE_API_KEY env var)
 *   --go                  Include OpenCode Go models (default: yes)
 *   --zen-free            Include Zen free models (default: yes)
 *   --zen-paid            Include Zen paid models (default: no)
 *   --families <list>     Include specific families: gpt,claude,gemini,qwen,deepseek,kimi,glm,minimax,mimo
 *   --models <list>       Include specific model IDs (comma-separated)
 *   --skip-models <list>  Exclude specific model IDs (comma-separated)
 *   --dry-run             Print what would be tested without sending requests
 *   --json                Output results as JSON instead of markdown table
 *   --timeout <ms>        Request timeout in ms (default: 30000)
 *
 * Environment:
 *   OPENCODE_API_KEY      API key (alternative to --api-key)
 *   OPENCODE_GO_URL       Go base URL (default: https://opencode.ai/zen/go/v1)
 *   OPENCODE_ZEN_URL      Zen base URL (default: https://opencode.ai/zen/v1)
 */

import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    "api-key": { type: "string" },
    go: { type: "boolean", default: true },
    "zen-free": { type: "boolean", default: true },
    "zen-paid": { type: "boolean", default: false },
    families: { type: "string" },
    models: { type: "string" },
    "skip-models": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    timeout: { type: "string", default: "30000" },
    help: { type: "boolean", short: "h" },
  },
  strict: false,
});

if (args.help) {
  console.log(`
Usage: npx tsx scripts/validate-models.mts [options]

Options:
  --api-key <key>       OpenCode API key (or OPENCODE_API_KEY env var)
  --go                  Include OpenCode Go models (default: yes)
  --zen-free            Include Zen free models (default: yes)
  --zen-paid            Include Zen paid models (default: no)
  --families <list>     Include specific families (comma-separated):
                        gpt,claude,gemini,qwen,deepseek,kimi,glm,minimax,mimo
  --models <list>       Include specific model IDs (comma-separated)
  --skip-models <list>  Exclude specific model IDs (comma-separated)
  --dry-run             Print what would be tested without sending requests
  --json                Output results as JSON instead of markdown table
  --timeout <ms>        Request timeout in ms (default: 30000)
  -h, --help            Show this help

Environment:
  OPENCODE_API_KEY      API key (alternative to --api-key)
  OPENCODE_GO_URL       Go base URL (default: https://opencode.ai/zen/go/v1)
  OPENCODE_ZEN_URL      Zen base URL (default: https://opencode.ai/zen/v1)

Examples:
  # Test all Go + Zen free models with your API key
  npx tsx scripts/validate-models.mts --api-key YOUR_KEY

  # Test only DeepSeek and Qwen families
  npx tsx scripts/validate-models.mts --api-key YOUR_KEY --families deepseek,qwen

  # Test specific models
  npx tsx scripts/validate-models.mts --api-key YOUR_KEY --models kimi-k2.7-code,minimax-m2.7

  # Include paid Zen models
  npx tsx scripts/validate-models.mts --api-key YOUR_KEY --zen-paid
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_KEY = args["api-key"] ?? process.env.OPENCODE_API_KEY;
const GO_BASE_URL = process.env.OPENCODE_GO_URL ?? "https://opencode.ai/zen/go/v1";
const ZEN_BASE_URL = process.env.OPENCODE_ZEN_URL ?? "https://opencode.ai/zen/v1";
const MODELS_DEV_URL = "https://models.dev/api.json";
const TIMEOUT_MS = Number(args.timeout) || 30000;

const INCLUDE_GO = args.go !== false;
const INCLUDE_ZEN_FREE = args["zen-free"] !== false;
const INCLUDE_ZEN_PAID = args["zen-paid"] === true;
const FAMILIES_FILTER = args.families?.split(",").map(f => f.trim().toLowerCase());
const MODELS_FILTER = args.models?.split(",").map(m => m.trim());
const SKIP_MODELS = new Set(args["skip-models"]?.split(",").map(m => m.trim()) ?? []);
const DRY_RUN = args["dry-run"] === true;
const OUTPUT_JSON = args.json === true;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelInfo {
  id: string;
  vendor: "go" | "zen";
  family: string;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning: boolean;
  reasoningOptions?: Array<{ type?: string; values?: string[] }>;
  temperature: boolean;
  source: "models.dev" | "fallback";
}

interface TestResult {
  model: ModelInfo;
  status: "✅ OK" | "⚠️ WARN" | "❌ FAIL" | "⏭️ SKIP" | "🔒 NO_KEY";
  checks: string[];
  error?: string;
  retryResult?: string;
}

// ---------------------------------------------------------------------------
// Model families
// ---------------------------------------------------------------------------

function detectFamily(modelId: string): string {
  if (/^gpt-/i.test(modelId)) return "gpt";
  if (/^claude-/i.test(modelId)) return "claude";
  if (/^gemini-/i.test(modelId)) return "gemini";
  if (/^qwen/i.test(modelId)) return "qwen";
  if (/^deepseek-/i.test(modelId)) return "deepseek";
  if (/^kimi-/i.test(modelId)) return "kimi";
  if (/^glm-/i.test(modelId)) return "glm";
  if (/^minimax-/i.test(modelId)) return "minimax";
  if (/^mimo-/i.test(modelId)) return "mimo";
  if (/^big-pickle$/i.test(modelId)) return "mystery";
  if (/^nemotron-/i.test(modelId)) return "nemotron";
  if (/^north-/i.test(modelId)) return "north";
  if (/^grok-/i.test(modelId)) return "grok";
  if (/^hy3-/i.test(modelId)) return "hy3";
  if (/^ring-/i.test(modelId)) return "ring";
  return "other";
}

// ---------------------------------------------------------------------------
// Endpoint resolution (mirrors routing.ts)
// ---------------------------------------------------------------------------

function resolveEndpoint(model: ModelInfo): { url: string; kind: string } {
  const base = model.vendor === "go" ? GO_BASE_URL : ZEN_BASE_URL;

  // Zen GPT → responses endpoint
  if (model.vendor === "zen" && /^gpt-/i.test(model.id)) {
    return { url: `${base.replace("/v1", "")}/responses`, kind: "responses" };
  }

  // Claude → messages endpoint
  if (/^claude-/i.test(model.id)) {
    return { url: `${base}/messages`, kind: "messages" };
  }

  // Go MiniMax M2.* → messages endpoint
  if (model.vendor === "go" && /^minimax-m2\./i.test(model.id)) {
    return { url: `${base}/messages`, kind: "messages" };
  }

  // Qwen3.5/3.6-plus, Qwen3.7-max → messages endpoint
  if (/^qwen3\.(?:5|6)-plus(?:-free)?$/i.test(model.id) || /^qwen3\.7-max$/i.test(model.id)) {
    return { url: `${base}/messages`, kind: "messages" };
  }

  // Zen Gemini → Google endpoint
  if (model.vendor === "zen" && /^gemini-/i.test(model.id)) {
    return { url: `${base}/models/${model.id}`, kind: "google" };
  }

  // Default: chat completions
  return { url: `${base}/chat/completions`, kind: "chat-completions" };
}

// ---------------------------------------------------------------------------
// Request body builders
// ---------------------------------------------------------------------------

function buildTestBody(model: ModelInfo, endpointKind: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: model.id,
    messages: [{ role: "user", content: "Say exactly: OK" }],
    max_tokens: 10,
  };

  // Test with default temperature (0.2) — this is what the extension sends
  if (model.temperature !== false) {
    base.temperature = 0.2;
  }

  // Test thinking parameters
  if (model.reasoning) {
    const thinkingParams = buildTestThinkingParams(model);
    Object.assign(base, thinkingParams);
  }

  // Messages endpoint uses different format
  if (endpointKind === "messages") {
    return {
      model: model.id,
      max_tokens: 10,
      messages: [{ role: "user", content: "Say exactly: OK" }],
      ...(base.temperature !== undefined ? { temperature: base.temperature } : {}),
      ...(model.reasoning ? { thinking: { type: "enabled", budget_tokens: 1024 } } : {}),
    };
  }

  return base;
}

function buildTestThinkingParams(model: ModelInfo): Record<string, unknown> {
  const id = model.id;

  // K2.7: always on
  if (/^kimi-k2\.7/i.test(id)) {
    return { thinking: { type: "enabled", keep: "all" } };
  }

  // Kimi K2.6/K2.5: test with disabled (the most common failure case)
  if (/^kimi-k2\.[56]/i.test(id)) {
    return { thinking: { type: "disabled" } };
  }

  // GLM: test with disabled
  if (/^glm-/i.test(id)) {
    return { thinking: { type: "disabled" } };
  }

  // MiniMax M2.*: test with enabled (Anthropic format)
  if (/^minimax-m2\./i.test(id)) {
    return { thinking: { type: "enabled" } };
  }

  // MiniMax M3: test with adaptive
  if (/^minimax-m3/i.test(id)) {
    return { thinking: { type: "adaptive" } };
  }

  // DeepSeek: test with reasoning_effort
  if (/^deepseek-/i.test(id)) {
    return { reasoning_effort: "high" };
  }

  // Qwen: test with enable_thinking false
  if (/^qwen/i.test(id)) {
    return { enable_thinking: false };
  }

  // MiMo: test with reasoning_effort
  if (/^mimo-/i.test(id)) {
    return { reasoning_effort: "medium" };
  }

  return {};
}

// ---------------------------------------------------------------------------
// Retry patch logic (mirrors retry.ts)
// ---------------------------------------------------------------------------

function analyzeRetry(errorBody: string, body: Record<string, unknown>): { patched: Record<string, unknown>; reason: string } | undefined {
  const patterns: Array<{ pattern: RegExp; patch: (b: Record<string, unknown>) => Record<string, unknown>; desc: string }> = [
    { pattern: /invalid thinking[:\s]+only type=enabled/i, patch: (b) => ({ ...b, thinking: { type: "enabled" } }), desc: "forced thinking.type='enabled'" },
    { pattern: /invalid thinking[:\s]+only type=disabled/i, patch: (b) => { const n = { ...b }; delete n.thinking; return n; }, desc: "removed thinking" },
    { pattern: /invalid thinking/i, patch: (b) => { const n = { ...b }; delete n.thinking; return n; }, desc: "removed thinking" },
    { pattern: /extra inputs are not permitted.*enable_thinking/i, patch: (b) => { const n = { ...b }; delete n.enable_thinking; return n; }, desc: "removed enable_thinking" },
    { pattern: /invalid temperature/i, patch: (b) => { const n = { ...b }; delete n.temperature; return n; }, desc: "removed temperature" },
    { pattern: /reasoning_effort/i, patch: (b) => { const n = { ...b }; delete n.reasoning_effort; return n; }, desc: "removed reasoning_effort" },
    { pattern: /extra inputs are not permitted.*field:\s*'([^']+)'/i, patch: (b, m) => { const n = { ...b }; const f = m?.[1]; if (f) delete n[f]; return n; }, desc: "removed extra field" },
  ];

  for (const { pattern, patch, desc } of patterns) {
    if (pattern.test(errorBody)) {
      const patched = patch(body);
      if (JSON.stringify(patched) !== JSON.stringify(body)) {
        return { patched, reason: desc };
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

async function testModel(model: ModelInfo): Promise<TestResult> {
  if (!API_KEY) {
    return { model, status: "🔒 NO_KEY", checks: ["No API key provided"] };
  }

  const endpoint = resolveEndpoint(model);
  const body = buildTestBody(model, endpoint.kind);

  const checks: string[] = [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.ok) {
      checks.push(`HTTP ${response.status} — request accepted`);
      return { model, status: "✅ OK", checks };
    }

    const errorBody = await response.text();
    checks.push(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`);

    // Check if this is a recoverable error
    const patch = analyzeRetry(errorBody, body);
    if (patch) {
      checks.push(`Retry possible: ${patch.reason}`);

      // Actually retry to verify
      try {
        const retryController = new AbortController();
        const retryTimer = setTimeout(() => retryController.abort(), TIMEOUT_MS);

        const retryResponse = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(patch.patched),
          signal: retryController.signal,
        });

        clearTimeout(retryTimer);

        if (retryResponse.ok) {
          checks.push(`Retry HTTP ${retryResponse.status} — patched body accepted`);
          return { model, status: "⚠️ WARN", checks, retryResult: `Would succeed with: ${patch.reason}` };
        }

        const retryError = await retryResponse.text();
        checks.push(`Retry HTTP ${retryResponse.status}: ${retryError.slice(0, 200)}`);
        return { model, status: "❌ FAIL", checks, error: `Original: ${errorBody.slice(0, 100)}; Retry failed: ${retryError.slice(0, 100)}` };
      } catch (retryErr) {
        checks.push(`Retry failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
      }
    }

    return { model, status: "❌ FAIL", checks, error: errorBody.slice(0, 200) };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      checks.push(`Timeout after ${TIMEOUT_MS}ms`);
      return { model, status: "❌ FAIL", checks, error: "Timeout" };
    }
    checks.push(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    return { model, status: "❌ FAIL", checks, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Model fetching from models.dev
// ---------------------------------------------------------------------------

interface ModelsDevResponse {
  [provider: string]: {
    models: Record<string, {
      status?: string;
      reasoning?: boolean;
      reasoning_options?: Array<{ type?: string; values?: string[] }>;
      temperature?: boolean;
      limit?: { context?: number; output?: number };
      image_input?: boolean;
    }>;
  };
}

async function fetchModelsFromDev(): Promise<ModelInfo[]> {
  const response = await fetch(MODELS_DEV_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch models.dev: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as ModelsDevResponse;
  const models: ModelInfo[] = [];

  // OpenCode Go provider
  const goProvider = data["opencode-go"] ?? data["opencode"]?.["go"];
  if (goProvider?.models && INCLUDE_GO) {
    for (const [id, info] of Object.entries(goProvider.models)) {
      if (SKIP_MODELS.has(id)) continue;
      if (info.status === "deprecated") continue;
      if (MODELS_FILTER && !MODELS_FILTER.includes(id)) continue;

      const family = detectFamily(id);
      if (FAMILIES_FILTER && !FAMILIES_FILTER.includes(family)) continue;

      models.push({
        id,
        vendor: "go",
        family,
        contextWindow: info.limit?.context ?? 262144,
        maxOutputTokens: info.limit?.output ?? 65536,
        reasoning: info.reasoning ?? false,
        reasoningOptions: info.reasoning_options,
        temperature: info.temperature !== false,
        source: "models.dev",
      });
    }
  }

  // OpenCode Zen provider
  const zenProvider = data["opencode-zen"] ?? data["opencode"]?.["zen"];
  if (zenProvider?.models && (INCLUDE_ZEN_FREE || INCLUDE_ZEN_PAID)) {
    for (const [id, info] of Object.entries(zenProvider.models)) {
      if (SKIP_MODELS.has(id)) continue;
      if (info.status === "deprecated") continue;
      if (MODELS_FILTER && !MODELS_FILTER.includes(id)) continue;

      const family = detectFamily(id);
      if (FAMILIES_FILTER && !FAMILIES_FILTER.includes(family)) continue;

      // Determine if this is a free model
      const isFree = id.endsWith("-free") || id === "big-pickle";

      if (!INCLUDE_ZEN_PAID && !isFree) continue;
      if (!INCLUDE_ZEN_FREE && isFree) continue;

      models.push({
        id,
        vendor: "zen",
        family,
        contextWindow: info.limit?.context ?? 262144,
        maxOutputTokens: info.limit?.output ?? 65536,
        reasoning: info.reasoning ?? false,
        reasoningOptions: info.reasoning_options,
        temperature: info.temperature !== false,
        source: "models.dev",
      });
    }
  }

  return models;
}

// ---------------------------------------------------------------------------
// Fallback models (when models.dev is unavailable)
// ---------------------------------------------------------------------------

const FALLBACK_GO_MODELS: Array<{ id: string; reasoning: boolean; temperature: boolean }> = [
  { id: "deepseek-v4-pro", reasoning: true, temperature: true },
  { id: "deepseek-v4-flash", reasoning: true, temperature: true },
  { id: "qwen3.7-max", reasoning: true, temperature: true },
  { id: "mimo-v2.5-pro", reasoning: true, temperature: true },
  { id: "mimo-v2.5", reasoning: false, temperature: true },
  { id: "kimi-k2.7-code", reasoning: true, temperature: false },
  { id: "kimi-k2.6", reasoning: true, temperature: true },
  { id: "kimi-k2.5", reasoning: true, temperature: true },
  { id: "minimax-m3", reasoning: true, temperature: true },
  { id: "minimax-m2.7", reasoning: true, temperature: true },
  { id: "minimax-m2.5", reasoning: true, temperature: true },
  { id: "glm-5.1", reasoning: true, temperature: true },
  { id: "glm-5", reasoning: true, temperature: true },
];

const FALLBACK_ZEN_FREE_MODELS: Array<{ id: string; reasoning: boolean; temperature: boolean }> = [
  { id: "deepseek-v4-flash-free", reasoning: true, temperature: true },
  { id: "mimo-v2.5-free", reasoning: true, temperature: true },
  { id: "big-pickle", reasoning: false, temperature: true },
  { id: "nemotron-3-super-free", reasoning: false, temperature: true },
  { id: "north-mini-code-free", reasoning: false, temperature: true },
];

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatMarkdownTable(results: TestResult[]): string {
  const lines: string[] = [];
  lines.push("# Model Validation Report");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Models tested: ${results.length}`);
  lines.push("");

  const ok = results.filter(r => r.status === "✅ OK").length;
  const warn = results.filter(r => r.status === "⚠️ WARN").length;
  const fail = results.filter(r => r.status === "❌ FAIL").length;
  const skip = results.filter(r => r.status === "⏭️ SKIP" || r.status === "🔒 NO_KEY").length;
  lines.push(`- ✅ OK: ${ok}`);
  lines.push(`- ⚠️ WARN (retryable): ${warn}`);
  lines.push(`- ❌ FAIL: ${fail}`);
  lines.push(`- ⏭️ SKIP/🔒 NO_KEY: ${skip}`);
  lines.push("");

  if (fail > 0 || warn > 0) {
    lines.push("## Issues Found");
    lines.push("");
    lines.push("| Model | Vendor | Status | Issue | Retry Fix |");
    lines.push("|-------|--------|--------|-------|-----------|");
    for (const r of results.filter(r => r.status === "❌ FAIL" || r.status === "⚠️ WARN")) {
      lines.push(`| ${r.model.id} | ${r.model.vendor} | ${r.status} | ${(r.error ?? "").slice(0, 60)} | ${r.retryResult ?? "—"} |`);
    }
    lines.push("");
  }

  lines.push("## All Results");
  lines.push("");
  lines.push("| Model | Vendor | Family | Status | Checks |");
  lines.push("|-------|--------|--------|--------|--------|");
  for (const r of results) {
    const checks = r.checks.join("; ").slice(0, 80);
    lines.push(`| ${r.model.id} | ${r.model.vendor} | ${r.model.family} | ${r.status} | ${checks} |`);
  }
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.error("🔍 OpenCode Model Validation Suite\n");

  if (!API_KEY) {
    console.error("⚠️  No API key provided. Use --api-key or set OPENCODE_API_KEY.");
    console.error("   Results will show 🔒 NO_KEY for all models.\n");
  }

  // Fetch models from models.dev
  let models: ModelInfo[];
  try {
    console.error("📡 Fetching models from models.dev…");
    models = await fetchModelsFromDev();
    console.error(`   Found ${models.length} models to test.\n`);
  } catch (err) {
    console.error(`⚠️  Failed to fetch models.dev: ${err instanceof Error ? err.message : String(err)}`);
    console.error("   Using fallback model list.\n");

    models = [
      ...(INCLUDE_GO ? FALLBACK_GO_MODELS.map(m => ({
        ...m,
        vendor: "go" as const,
        family: detectFamily(m.id),
        contextWindow: 262144,
        maxOutputTokens: 65536,
        reasoningOptions: undefined,
        source: "fallback" as const,
      })) : []),
      ...(INCLUDE_ZEN_FREE ? FALLBACK_ZEN_FREE_MODELS.map(m => ({
        ...m,
        vendor: "zen" as const,
        family: detectFamily(m.id),
        contextWindow: 262144,
        maxOutputTokens: 65536,
        reasoningOptions: undefined,
        source: "fallback" as const,
      })) : []),
    ];

    // Apply filters
    if (MODELS_FILTER) {
      models = models.filter(m => MODELS_FILTER.includes(m.id));
    }
    if (SKIP_MODELS.size > 0) {
      models = models.filter(m => !SKIP_MODELS.has(m.id));
    }
    if (FAMILIES_FILTER) {
      models = models.filter(m => FAMILIES_FILTER.includes(m.family));
    }
  }

  if (models.length === 0) {
    console.error("No models to test. Check your filters.");
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("\n📋 Models that would be tested:\n");
    for (const m of models) {
      const endpoint = resolveEndpoint(m);
      console.log(`  ${m.vendor.padEnd(4)} ${m.id.padEnd(30)} endpoint=${endpoint.kind.padEnd(18)} reasoning=${m.reasoning} temp=${m.temperature}`);
    }
    console.log(`\nTotal: ${models.length} models`);
    process.exit(0);
  }

  // Test models sequentially (to avoid rate limiting)
  const results: TestResult[] = [];
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const progress = `[${i + 1}/${models.length}]`;
    process.stderr.write(`${progress} Testing ${model.vendor}/${model.id}… `);

    const result = await testModel(model);
    results.push(result);

    console.error(result.status);

    // Small delay between requests to avoid rate limiting
    if (i < models.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Output results
  if (OUTPUT_JSON) {
    console.log(JSON.stringify(results.map(r => ({
      model: r.model.id,
      vendor: r.model.vendor,
      family: r.model.family,
      status: r.status,
      checks: r.checks,
      error: r.error,
      retryResult: r.retryResult,
    })), null, 2));
  } else {
    console.log(formatMarkdownTable(results));
  }

  // Exit with error if any failures
  const failures = results.filter(r => r.status === "❌ FAIL");
  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} model(s) failed validation.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
