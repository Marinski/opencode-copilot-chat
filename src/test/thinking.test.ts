import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildThinkingPayload,
  buildFamilyThinkingSchema,
  applyRequestThinkingOverride,
  thinkingFamily,
  type ThinkingSettings,
} from "../thinking.js";

/** Baseline settings used across tests — mirrors the default workspace config. */
const defaultSettings: ThinkingSettings = {
  deepseek: "off",
  glm: "off",
  kimi: "off",
  minimax: "off",
  qwen: "off",
  qwenBudget: "auto",
  mimo: "off",
};

/**
 * Unit tests for the Kimi K2.7-code thinking fix (issue #25).
 *
 * ROOT CAUSE:
 * The extension sent `thinking: { type: "disabled" }` when the user kept the
 * default `kimi: "off"` setting. K2.7-code rejects "disabled" with HTTP 400:
 *   "invalid thinking: only type=enabled is allowed for this model"
 *
 * FIX: buildThinkingPayload special-cases /^kimi-k2\.7/i to always emit
 * { type: "enabled", keep: "all" } regardless of the user's thinking setting.
 */
describe("buildThinkingPayload — kimi-k2.7-code (issue #25)", () => {
  it("always emits { type: 'enabled', keep: 'all' } even when thinking.kimi is 'off'", () => {
    const payload = buildThinkingPayload("kimi-k2.7-code", { ...defaultSettings, kimi: "off" });
    assert.deepEqual(payload, { thinking: { type: "enabled", keep: "all" } });
  });

  it("emits { type: 'enabled', keep: 'all' } when thinking.kimi is 'on'", () => {
    const payload = buildThinkingPayload("kimi-k2.7-code", { ...defaultSettings, kimi: "on" });
    assert.deepEqual(payload, { thinking: { type: "enabled", keep: "all" } });
  });

  it("matches kimi-k2.7-code-highspeed variant too (same model, faster output)", () => {
    const payload = buildThinkingPayload("kimi-k2.7-code-highspeed", defaultSettings);
    assert.deepEqual(payload, { thinking: { type: "enabled", keep: "all" } });
  });
});

describe("buildThinkingPayload — regression safety for other kimi models", () => {
  it("kimi-k2.6 with kimi='off' emits { type: 'disabled' } (still accepts disabled)", () => {
    const payload = buildThinkingPayload("kimi-k2.6", { ...defaultSettings, kimi: "off" });
    assert.deepEqual(payload, { thinking: { type: "disabled" } });
  });

  it("kimi-k2.6 with kimi='on' emits { type: 'enabled' }", () => {
    const payload = buildThinkingPayload("kimi-k2.6", { ...defaultSettings, kimi: "on" });
    assert.deepEqual(payload, { thinking: { type: "enabled" } });
  });

  it("kimi-k2.5 with kimi='off' emits { type: 'disabled' }", () => {
    const payload = buildThinkingPayload("kimi-k2.5", { ...defaultSettings, kimi: "off" });
    assert.deepEqual(payload, { thinking: { type: "disabled" } });
  });
});

describe("buildThinkingPayload — other families unchanged", () => {
  it("deepseek with 'off' emits empty object (no reasoning_effort)", () => {
    const payload = buildThinkingPayload("deepseek-v4-pro", { ...defaultSettings, deepseek: "off" });
    assert.deepEqual(payload, {});
  });

  it("deepseek with 'high' emits reasoning_effort", () => {
    const payload = buildThinkingPayload("deepseek-v4-pro", { ...defaultSettings, deepseek: "high" });
    assert.deepEqual(payload, { reasoning_effort: "high" });
  });

  it("glm with 'off' emits { type: 'disabled' }", () => {
    const payload = buildThinkingPayload("glm-5", { ...defaultSettings, glm: "off" });
    assert.deepEqual(payload, { thinking: { type: "disabled" } });
  });

  it("qwen with 'off' emits enable_thinking: false", () => {
    const payload = buildThinkingPayload("qwen3.6-plus", { ...defaultSettings, qwen: "off" });
    assert.deepEqual(payload, { enable_thinking: false });
  });
});

/**
 * Schema tests: the picker must show a single "Always On (K2.7)" option so
 * users understand thinking cannot be disabled, rather than hiding the picker
 * or silently forcing "on".
 */
describe("buildFamilyThinkingSchema — kimi-k2.7-code picker", () => {
  it("exposes a single 'on' option with 'Always On (K2.7)' label", () => {
    const schema = buildFamilyThinkingSchema("kimi-k2.7-code");
    assert.ok(schema, "expected schema to be defined");
    const reasoningEffort = schema!.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["on"]);
    assert.deepEqual(reasoningEffort.enumItemLabels, ["Always On (K2.7)"]);
    assert.equal(reasoningEffort.default, "on");
  });

  it("mentions the Moonshot API constraint in the description", () => {
    const schema = buildFamilyThinkingSchema("kimi-k2.7-code");
    const reasoningEffort = schema!.properties.reasoningEffort as Record<string, unknown>;
    const descriptions = reasoningEffort.enumDescriptions as string[];
    assert.ok(
      descriptions.some((d) => d.includes("Moonshot API constraint")),
      "expected description to mention the Moonshot API constraint"
    );
  });
});

describe("buildFamilyThinkingSchema — other kimi models keep off/on", () => {
  it("kimi-k2.6 exposes both 'off' and 'on'", () => {
    const schema = buildFamilyThinkingSchema("kimi-k2.6");
    assert.ok(schema);
    const reasoningEffort = schema!.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["off", "on"]);
  });

  it("kimi-k2.5 exposes both 'off' and 'on'", () => {
    const schema = buildFamilyThinkingSchema("kimi-k2.5");
    assert.ok(schema);
    const reasoningEffort = schema!.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["off", "on"]);
  });
});

/**
 * Override tests: even if VS Code caches a stale picker value (e.g. "off"),
 * applyRequestThinkingOverride must force kimi="on" for K2.7-code.
 */
describe("applyRequestThinkingOverride — kimi-k2.7-code defensive force-on", () => {
  it("forces kimi='on' even when override requests 'off'", () => {
    const result = applyRequestThinkingOverride("kimi-k2.7-code", defaultSettings, {
      reasoningEffort: "off",
    });
    assert.equal(result.kimi, "on");
  });

  it("forces kimi='on' even when override requests 'on' (no-op but explicit)", () => {
    const result = applyRequestThinkingOverride("kimi-k2.7-code", defaultSettings, {
      reasoningEffort: "on",
    });
    assert.equal(result.kimi, "on");
  });

  it("forces kimi='on' when override is empty (defensive against stale cache)", () => {
    const result = applyRequestThinkingOverride("kimi-k2.7-code", defaultSettings, {});
    assert.equal(result.kimi, "on");
  });
});

describe("applyRequestThinkingOverride — other kimi models respect override", () => {
  it("kimi-k2.6 respects 'off' override", () => {
    const result = applyRequestThinkingOverride("kimi-k2.6", defaultSettings, {
      reasoningEffort: "off",
    });
    assert.equal(result.kimi, "off");
  });

  it("kimi-k2.6 respects 'on' override", () => {
    const result = applyRequestThinkingOverride("kimi-k2.6", defaultSettings, {
      reasoningEffort: "on",
    });
    assert.equal(result.kimi, "on");
  });
});

describe("thinkingFamily — detection", () => {
  it("classifies kimi-k2.7-code as 'kimi'", () => {
    assert.equal(thinkingFamily("kimi-k2.7-code"), "kimi");
  });

  it("classifies kimi-k2.6 as 'kimi'", () => {
    assert.equal(thinkingFamily("kimi-k2.6"), "kimi");
  });

  it("returns null for unknown prefixes", () => {
    assert.equal(thinkingFamily("unknown-model"), null);
  });
});
