import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeHttp400ForRetry } from "../retry.js";

describe("analyzeHttp400ForRetry — thinking errors", () => {
  it("patches 'only type=enabled is allowed' to force thinking.type='enabled'", () => {
    const body = { model: "kimi-k2.5", thinking: { type: "disabled" } };
    const result = analyzeHttp400ForRetry("invalid thinking: only type=enabled is allowed for this model", body);
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result!.body, { model: "kimi-k2.5", thinking: { type: "enabled" } });
    assert.match(result!.reason, /thinking/i);
  });

  it("patches 'only type=disabled is allowed' by removing thinking", () => {
    const body = { model: "some-model", thinking: { type: "enabled" } };
    const result = analyzeHttp400ForRetry("invalid thinking: only type=disabled is allowed", body);
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result!.body, { model: "some-model" });
  });

  it("patches generic 'invalid thinking' by removing thinking field", () => {
    const body = { model: "test", thinking: { type: "disabled" }, temperature: 0.2 };
    const result = analyzeHttp400ForRetry("invalid thinking parameter", body);
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result!.body, { model: "test", temperature: 0.2 });
  });
});

describe("analyzeHttp400ForRetry — temperature errors", () => {
  it("patches 'invalid temperature: only 1 is allowed' by removing temperature", () => {
    const body = { model: "kimi-k2.7-code", temperature: 0.2 };
    const result = analyzeHttp400ForRetry("invalid temperature: only 1 is allowed for this model", body);
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result!.body, { model: "kimi-k2.7-code" });
  });
});

describe("analyzeHttp400ForRetry — enable_thinking errors", () => {
  it("patches 'Extra inputs are not permitted, field: enable_thinking'", () => {
    const body = { model: "kimi-k2.5", enable_thinking: false };
    const result = analyzeHttp400ForRetry("Extra inputs are not permitted, field: 'enable_thinking', value: False", body);
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result!.body, { model: "kimi-k2.5" });
  });
});

describe("analyzeHttp400ForRetry — reasoning_effort errors", () => {
  it("patches reasoning_effort rejection", () => {
    const body = { model: "minimax-m2.7", reasoning_effort: "high" };
    const result = analyzeHttp400ForRetry("MiniMax M2 only accepts string reasoning_effort values ('low', 'medium', 'high')", body);
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result!.body, { model: "minimax-m2.7" });
  });
});

describe("analyzeHttp400ForRetry — non-recoverable errors", () => {
  it("returns undefined for auth errors", () => {
    const body = { model: "test" };
    const result = analyzeHttp400ForRetry("unauthorized", body);
    assert.equal(result, undefined);
  });

  it("returns undefined for unrelated errors", () => {
    const body = { model: "test" };
    const result = analyzeHttp400ForRetry("model not found", body);
    assert.equal(result, undefined);
  });
});
