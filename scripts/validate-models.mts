#!/usr/bin/env node
/**
 * validate-models.mts — Comprehensive model parameter validation suite.
 *
 * For EACH model, tests ALL thinking/reasoning parameter combinations against
 * the live OpenCode API to verify what actually works.
 *
 * What it tests per model:
 * - Temperature: with and without (0.2)
 * - Thinking/reasoning: every possible value for that family
 * - Reports: ✅ accepted, ❌ rejected, ⚠️ unexpected behavior
 *
 * Usage:
 *   npx tsx scripts/validate-models.mts --api-key YOUR_KEY
 *   OPENCODE_API_KEY=... npx tsx scripts/validate-models.mts
 *
 * Options:
 *   --api-key <key>       OpenCode API key (or OPENCODE_API_KEY env var)
 *   --go                  Include OpenCode Go models (default: true)
 *   --zen-free            Include Zen free models (default: true)
 *   --zen-paid            Include Zen paid models (default: false)
 *   --families <list>     Filter: gpt,claude,gemini,qwen,deepseek,kimi,glm,minimax,mimo
 *   --models <list>       Specific model IDs (comma-separated)
 *   --skip-models <list>  Exclude model IDs (comma-separated)
 *   --dry-run             Print test plan without sending requests
 *   --json                Output as JSON
 *   --timeout <ms>        Request timeout (default: 30000)
 */

import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// CLI
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

Examples:
  npx tsx scripts/validate-models.mts --api-key YOUR_KEY
  npx tsx scripts/validate-models.mts --api-key YOUR_KEY --families deepseek,kimi
  npx tsx scripts/validate-models.mts --api-key YOUR_KEY --models kimi-k2.7-code,minimax-m2.7
  npx tsx scripts/validate-models.mts --api-key YOUR_KEY --zen-paid
  npx tsx scripts/validate-models.mts --dry-run
`);
  process.exit(0);
}

const API_KEY = args["api-key"] ?? process.env.OPENCODE_API_KEY;
const GO_BASE = process.env.OPENCODE_GO_URL ?? "https://opencode.ai/zen/go/v1";
const ZEN_BASE = process.env.OPENCODE_ZEN_URL ?? "https://opencode.ai/zen/v1";
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
  reasoning: boolean;
  reasoningOptions?: Array<{ type?: string; values?: string[] }>;
  temperature: boolean;
}

interface ParamTest {
  name: string;
  bodyModifier: (body: Record<string, unknown>) => Record<string, unknown>;
}

interface TestResult {
  model: string;
  vendor: string;
  family: string;
  param: string;
  status: "✅" | "❌" | "⏭️";
  httpStatus: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Family detection
// ---------------------------------------------------------------------------

function detectFamily(id: string): string {
  if (/^gpt-/i.test(id)) return "gpt";
  if (/^claude-/i.test(id)) return "claude";
  if (/^gemini-/i.test(id)) return "gemini";
  if (/^qwen/i.test(id)) return "qwen";
  if (/^deepseek-/i.test(id)) return "deepseek";
  if (/^kimi-/i.test(id)) return "kimi";
  if (/^glm-/i.test(id)) return "glm";
  if (/^minimax-/i.test(id)) return "minimax";
  if (/^mimo-/i.test(id)) return "mimo";
  if (/^big-pickle$/i.test(id)) return "mystery";
  if (/^nemotron-/i.test(id)) return "nemotron";
  if (/^north-/i.test(id)) return "north";
  if (/^grok-/i.test(id)) return "grok";
  return "other";
}

// ---------------------------------------------------------------------------
// Endpoint resolution (mirrors routing.ts)
// ---------------------------------------------------------------------------

function resolveEndpoint(model: ModelInfo): { url: string; kind: string } {
  const base = model.vendor === "go" ? GO_BASE : ZEN_BASE;

  if (model.vendor === "zen" && /^gpt-/i.test(model.id)) {
    return { url: `${base.replace("/v1", "")}/responses`, kind: "responses" };
  }
  if (/^claude-/i.test(model.id)) {
    return { url: `${base}/messages`, kind: "messages" };
  }
  if (model.vendor === "go" && /^minimax-m2\./i.test(model.id)) {
    return { url: `${base}/messages`, kind: "messages" };
  }
  if (/^qwen3\.(?:5|6)-plus(?:-free)?$/i.test(model.id) || /^qwen3\.7-max$/i.test(model.id)) {
    return { url: `${base}/messages`, kind: "messages" };
  }
  if (model.vendor === "zen" && /^gemini-/i.test(model.id)) {
    return { url: `${base}/models/${model.id}`, kind: "google" };
  }
  return { url: `${base}/chat/completions`, kind: "chat-completions" };
}

// ---------------------------------------------------------------------------
// Test parameter generators per family
// ---------------------------------------------------------------------------

function buildThinkingTests(model: ModelInfo): ParamTest[] {
  const id = model.id;
  const tests: ParamTest[] = [];

  // --- Temperature tests ---
  if (model.temperature !== false) {
    tests.push({ name: "temp=0.2", bodyModifier: (b) => ({ ...b, temperature: 0.2 }) });
  }
  tests.push({ name: "no-temp", bodyModifier: (b) => { const n = { ...b }; delete n.temperature; return n; } });

  // --- Thinking/reasoning tests per family ---
  if (!model.reasoning) return tests;

  if (/^kimi-k2\.7/i.test(id)) {
    // K2.7: thinking always on
    tests.push({ name: "thinking=enabled,keep=all", bodyModifier: (b) => ({ ...b, thinking: { type: "enabled", keep: "all" } }) });
    tests.push({ name: "thinking=disabled (should-fail)", bodyModifier: (b) => ({ ...b, thinking: { type: "disabled" } }) });
  } else if (/^kimi-/i.test(id)) {
    // K2.6/K2.5: thinking on/off
    tests.push({ name: "thinking=enabled", bodyModifier: (b) => ({ ...b, thinking: { type: "enabled" } }) });
    tests.push({ name: "thinking=disabled", bodyModifier: (b) => ({ ...b, thinking: { type: "disabled" } }) });
  } else if (/^deepseek-/i.test(id)) {
    // DeepSeek: reasoning_effort values
    for (const effort of ["low", "medium", "high", "max"]) {
      tests.push({ name: `reasoning_effort=${effort}`, bodyModifier: (b) => ({ ...b, reasoning_effort: effort }) });
    }
    tests.push({ name: "no-reasoning (off)", bodyModifier: (b) => { const n = { ...b }; delete n.reasoning_effort; return n; } });
  } else if (/^glm-/i.test(id)) {
    // GLM: thinking type
    tests.push({ name: "thinking=enabled", bodyModifier: (b) => ({ ...b, thinking: { type: "enabled" } }) });
    tests.push({ name: "thinking=disabled", bodyModifier: (b) => ({ ...b, thinking: { type: "disabled" } }) });
  } else if (/^qwen/i.test(id)) {
    // Qwen: enable_thinking + thinking_budget
    tests.push({ name: "enable_thinking=true", bodyModifier: (b) => ({ ...b, enable_thinking: true }) });
    tests.push({ name: "enable_thinking=false", bodyModifier: (b) => ({ ...b, enable_thinking: false }) });
    tests.push({ name: "enable_thinking=true,budget=4096", bodyModifier: (b) => ({ ...b, enable_thinking: true, thinking_budget: 4096 }) });
    tests.push({ name: "enable_thinking=true,budget=32768", bodyModifier: (b) => ({ ...b, enable_thinking: true, thinking_budget: 32768 }) });
    // Anthropic format (for messages endpoint)
    if (resolveEndpoint(model).kind === "messages") {
      tests.push({ name: "thinking=enabled (anthropic)", bodyModifier: (b) => ({ ...b, thinking: { type: "enabled" } }) });
      tests.push({ name: "thinking=disabled (anthropic)", bodyModifier: (b) => ({ ...b, thinking: { type: "disabled" } }) });
    }
  } else if (/^mimo-/i.test(id)) {
    // MiMo: reasoning_effort
    for (const effort of ["low", "medium", "high"]) {
      tests.push({ name: `reasoning_effort=${effort}`, bodyModifier: (b) => ({ ...b, reasoning_effort: effort }) });
    }
    tests.push({ name: "no-reasoning (off)", bodyModifier: (b) => { const n = { ...b }; delete n.reasoning_effort; return n; } });
  } else if (/^minimax-m2\./i.test(id)) {
    // MiniMax M2.*: thinking type (Anthropic format)
    tests.push({ name: "thinking=enabled", bodyModifier: (b) => ({ ...b, thinking: { type: "enabled" } }) });
    tests.push({ name: "thinking=disabled", bodyModifier: (b) => ({ ...b, thinking: { type: "disabled" } }) });
  } else if (/^minimax-m3/i.test(id)) {
    // MiniMax M3: thinking adaptive
    tests.push({ name: "thinking=adaptive", bodyModifier: (b) => ({ ...b, thinking: { type: "adaptive" } }) });
    tests.push({ name: "thinking=disabled", bodyModifier: (b) => ({ ...b, thinking: { type: "disabled" } }) });
  }

  // Also test with models.dev reasoning_options if available
  if (model.reasoningOptions) {
    const effortValues = model.reasoningOptions
      .filter(o => o.type === "effort" && Array.isArray(o.values))
      .flatMap(o => o.values!)
      .filter((v, i, a) => a.indexOf(v) === i);

    for (const v of effortValues) {
      const testName = `modelsdev_effort=${v}`;
      if (!tests.some(t => t.name.includes(v))) {
        tests.push({ name: testName, bodyModifier: (b) => ({ ...b, reasoning_effort: v }) });
      }
    }
  }

  return tests;
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

async function testParameter(model: ModelInfo, test: ParamTest, endpoint: { url: string; kind: string }): Promise<TestResult> {
  const baseBody: Record<string, unknown> = {
    model: model.id,
    messages: [{ role: "user", content: "Say OK" }],
    max_tokens: 10,
  };

  const body = test.bodyModifier(baseBody);

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

    const errorBody = response.ok ? undefined : await response.text();

    return {
      model: model.id,
      vendor: model.vendor,
      family: model.family,
      param: test.name,
      status: response.ok ? "✅" : "❌",
      httpStatus: response.status,
      error: errorBody?.slice(0, 150),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { model: model.id, vendor: model.vendor, family: model.family, param: test.name, status: "❌", httpStatus: 0, error: "Timeout" };
    }
    return { model: model.id, vendor: model.vendor, family: model.family, param: test.name, status: "❌", httpStatus: 0, error: err instanceof Error ? err.message : String(err) };
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
    }>;
  };
}

async function fetchModels(): Promise<ModelInfo[]> {
  const response = await fetch(MODELS_DEV_URL);
  if (!response.ok) throw new Error(`models.dev: ${response.status}`);
  const data = await response.json() as ModelsDevResponse;
  const models: ModelInfo[] = [];

  const goProvider = data["opencode-go"] ?? data["opencode"]?.["go"];
  if (goProvider?.models && INCLUDE_GO) {
    for (const [id, info] of Object.entries(goProvider.models)) {
      if (SKIP_MODELS.has(id) || info.status === "deprecated") continue;
      if (MODELS_FILTER && !MODELS_FILTER.includes(id)) continue;
      const family = detectFamily(id);
      if (FAMILIES_FILTER && !FAMILIES_FILTER.includes(family)) continue;
      models.push({ id, vendor: "go", family, reasoning: info.reasoning ?? false, reasoningOptions: info.reasoning_options, temperature: info.temperature !== false });
    }
  }

  const zenProvider = data["opencode"];
  if (zenProvider?.models && (INCLUDE_ZEN_FREE || INCLUDE_ZEN_PAID)) {
    // opencode provider contains ALL models (Go + Zen). Go models are already
    // added from opencode-go above, so we need to deduplicate.
    const goModelIds = new Set(goProvider?.models ? Object.keys(goProvider.models) : []);

    for (const [id, info] of Object.entries(zenProvider.models)) {
      if (SKIP_MODELS.has(id) || info.status === "deprecated") continue;
      if (MODELS_FILTER && !MODELS_FILTER.includes(id)) continue;
      const family = detectFamily(id);
      if (FAMILIES_FILTER && !FAMILIES_FILTER.includes(family)) continue;
      const isFree = id.endsWith("-free") || id === "big-pickle";
      if (!INCLUDE_ZEN_PAID && !isFree) continue;
      if (!INCLUDE_ZEN_FREE && isFree) continue;
      // Skip models already added from opencode-go
      if (goModelIds.has(id)) continue;
      models.push({ id, vendor: "zen", family, reasoning: info.reasoning ?? false, reasoningOptions: info.reasoning_options, temperature: info.temperature !== false });
    }
  }

  return models;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function formatReport(results: TestResult[], models: ModelInfo[]): string {
  const lines: string[] = [];
  const now = new Date().toISOString();
  lines.push("# Model Parameter Validation Report");
  lines.push(`Generated: ${now}`);
  lines.push(`Models: ${models.length} | Tests: ${results.length}`);
  lines.push("");

  // Summary by family
  const byFamily = new Map<string, TestResult[]>();
  for (const r of results) {
    if (!byFamily.has(r.family)) byFamily.set(r.family, []);
    byFamily.get(r.family)!.push(r);
  }

  lines.push("## Summary by Family");
  lines.push("");
  lines.push("| Family | Models | Tests | ✅ Pass | ❌ Fail | Notes |");
  lines.push("|--------|--------|-------|---------|---------|-------|");

  for (const [family, familyResults] of [...byFamily.entries()].sort()) {
    const modelCount = new Set(familyResults.map(r => r.model)).size;
    const pass = familyResults.filter(r => r.status === "✅").length;
    const fail = familyResults.filter(r => r.status === "❌").length;
    const failModels = [...new Set(familyResults.filter(r => r.status === "❌").map(r => r.model))];
    lines.push(`| ${family} | ${modelCount} | ${familyResults.length} | ${pass} | ${fail} | ${failModels.length > 0 ? failModels.join(", ") : "—"} |`);
  }
  lines.push("");

  // Detailed failures
  const failures = results.filter(r => r.status === "❌");
  if (failures.length > 0) {
    lines.push("## ❌ Failures (parameters rejected by API)");
    lines.push("");
    lines.push("| Model | Vendor | Parameter | HTTP | Error |");
    lines.push("|-------|--------|-----------|------|-------|");
    for (const r of failures) {
      lines.push(`| ${r.model} | ${r.vendor} | ${r.param} | ${r.httpStatus} | ${(r.error ?? "").slice(0, 80)} |`);
    }
    lines.push("");
  }

  // Per-model detail
  lines.push("## Per-Model Results");
  lines.push("");

  const byModel = new Map<string, TestResult[]>();
  for (const r of results) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model)!.push(r);
  }

  for (const [modelId, modelResults] of [...byModel.entries()].sort()) {
    const model = models.find(m => m.id === modelId);
    const pass = modelResults.filter(r => r.status === "✅").length;
    const fail = modelResults.filter(r => r.status === "❌").length;
    lines.push(`### ${modelId} (${model?.vendor}/${model?.family}) — ${pass}✅ ${fail}❌`);
    lines.push("");
    for (const r of modelResults) {
      const err = r.error ? ` — ${r.error.slice(0, 60)}` : "";
      lines.push(`- ${r.status} \`${r.param}\` (HTTP ${r.httpStatus})${err}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.error("🔍 Model Parameter Validation Suite\n");

  console.error("📡 Fetching models from models.dev…");
  const models = await fetchModels();
  console.error(`   Found ${models.length} models.\n`);

  if (models.length === 0) {
    console.error("No models to test.");
    process.exit(1);
  }

  if (!API_KEY && !DRY_RUN) {
    console.error("❌ API key required for live testing. Use --api-key or set OPENCODE_API_KEY.");
    console.error("   Use --dry-run to see the test plan without an API key.");
    process.exit(1);
  }

  const results: TestResult[] = [];
  let testCount = 0;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const tests = buildThinkingTests(model);
    const endpoint = resolveEndpoint(model);

    process.stderr.write(`[${i + 1}/${models.length}] ${model.vendor}/${model.id} (${tests.length} params)… `);

    if (DRY_RUN) {
      console.log(`  ${model.id}: ${tests.map(t => t.name).join(", ")}`);
      continue;
    }

    let pass = 0;
    let fail = 0;
    for (const test of tests) {
      const result = await testParameter(model, test, endpoint);
      results.push(result);
      testCount++;
      if (result.status === "✅") pass++;
      else fail++;
      await new Promise(r => setTimeout(r, 300));
    }

    console.error(fail === 0 ? `✅ ${pass}/${pass}` : `❌ ${fail} failed`);
  }

  if (DRY_RUN) process.exit(0);

  if (OUTPUT_JSON) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatReport(results, models));
  }

  const failures = results.filter(r => r.status === "❌");
  console.error(`\n📊 Total: ${testCount} tests, ${testCount - failures.length} passed, ${failures.length} failed`);

  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
