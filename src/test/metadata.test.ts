import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fallbackModelMetadata } from "../metadata.js";
import { GO_VENDOR, ZEN_VENDOR } from "../providerTypes.js";

/**
 * Unit tests for the kimi-k2.7-code fallback metadata fix (issue #25).
 *
 * CONTEXT:
 * kimi-k2.7-code is a new Moonshot model with breaking changes:
 * 1. `thinking.type` only accepts "enabled" (not "disabled")
 * 2. The `temperature` request parameter is rejected (only 1 is allowed)
 *
 * These tests verify the bundled fallback metadata is correct even when the
 * live models.dev fetch is unavailable.
 */
describe("fallbackModelMetadata — kimi-k2.7-code (issue #25)", () => {
  it("returns metadata for kimi-k2.7-code on GO_VENDOR", () => {
    const meta = fallbackModelMetadata("kimi-k2.7-code", GO_VENDOR);
    assert.ok(meta, "expected fallback metadata to be defined");
  });

  it("reports temperature: false (Moonshot rejects non-default temperature)", () => {
    const meta = fallbackModelMetadata("kimi-k2.7-code", GO_VENDOR);
    assert.equal(meta?.temperature, false);
  });

  it("reports correct context/output limits (models.dev: 256000 / 262144)", () => {
    const meta = fallbackModelMetadata("kimi-k2.7-code", GO_VENDOR);
    assert.equal(meta?.contextWindow, 256000);
    assert.equal(meta?.maxOutputTokens, 262144);
  });

  it("reports vision capability (models.dev attachment: true)", () => {
    const meta = fallbackModelMetadata("kimi-k2.7-code", GO_VENDOR);
    assert.equal(meta?.supportsVision, true);
  });

  it("reports reasoning capability (supportsReasoning matches /^kimi-/i)", () => {
    const meta = fallbackModelMetadata("kimi-k2.7-code", GO_VENDOR);
    assert.equal(meta?.reasoning, true);
  });
});

describe("fallbackModelMetadata — regression safety for other kimi models", () => {
  it("kimi-k2.6 does NOT report temperature: false (still accepts temperature)", () => {
    const meta = fallbackModelMetadata("kimi-k2.6", GO_VENDOR);
    // temperature should be undefined (not false) so the request body still
    // includes the configured temperature for k2.6.
    assert.notEqual(meta?.temperature, false);
  });

  it("kimi-k2.5 does NOT report temperature: false", () => {
    const meta = fallbackModelMetadata("kimi-k2.5", GO_VENDOR);
    assert.notEqual(meta?.temperature, false);
  });
});

describe("fallbackModelMetadata — non-kimi models unaffected", () => {
  it("glm-5 does not report temperature: false", () => {
    const meta = fallbackModelMetadata("glm-5", GO_VENDOR);
    assert.notEqual(meta?.temperature, false);
  });

  it("deepseek-v4-pro does not report temperature: false", () => {
    const meta = fallbackModelMetadata("deepseek-v4-pro", GO_VENDOR);
    assert.notEqual(meta?.temperature, false);
  });

  it("claude-opus-4-7 on ZEN does not report temperature: false", () => {
    const meta = fallbackModelMetadata("claude-opus-4-7", ZEN_VENDOR);
    assert.notEqual(meta?.temperature, false);
  });
});
