import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration } from "./duration.mjs";

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

test("single units", () => {
  assert.equal(parseDuration("45s"), 45 * S);
  assert.equal(parseDuration("2d"), 2 * D);
  assert.equal(parseDuration("500ms"), 500);
  assert.equal(parseDuration("30m"), 30 * M);
});

test("combined units", () => {
  assert.equal(parseDuration("1h30m"), H + 30 * M);
  assert.equal(parseDuration("2d4h"), 2 * D + 4 * H);
});

test("whitespace tolerated", () => {
  assert.equal(parseDuration("1h 30m"), H + 30 * M);
});

test("invalid input throws TypeError", () => {
  for (const bad of ["", "10x", "-5s", "abc", "1.5h", "h", "10"]) {
    assert.throws(() => parseDuration(bad), TypeError, `expected throw for ${JSON.stringify(bad)}`);
  }
});
