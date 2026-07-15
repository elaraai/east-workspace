/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./harness.js";

const RULE = "no-inline-credentials";
// The rule applies to any file that imports `@elaraai/*` — io configs are often
// standalone object literals, so no program-declaration requirement.
const EAST = `import { East, variant, some } from "@elaraai/east";\nexport const _e = East;\n`;

function rule(source: string) {
  return analyze(source).filter((d) => d.ruleName === RULE);
}

test("flags a literal password", () => {
  const src = `${EAST}export const cfg = { host: "db.customer.com", password: "hunter2" };\n`;
  assert.equal(rule(src).length, 1);
});

test("flags a template-literal password", () => {
  const src = `${EAST}export const cfg = { host: "db.customer.com", password: \`hunter2\` };\n`;
  assert.equal(rule(src).length, 1);
});

test("flags an option-wrapped secret — some(...)", () => {
  const src = `${EAST}export const cfg = { endpoint: "https://s3.eu-west-1.amazonaws.com", secretAccessKey: some("AKIA-secret") };\n`;
  assert.equal(rule(src).length, 1);
});

test("flags a variant-wrapped secret — variant('some', ...)", () => {
  const src = `${EAST}export const cfg = { endpoint: "https://s3.eu-west-1.amazonaws.com", accessKeyId: variant("some", "AKIAIOSFODNN7") };\n`;
  assert.equal(rule(src).length, 1);
});

test("flags token-like fields", () => {
  const src = `${EAST}export const cfg = { url: "https://api.example.com", apiKey: "sk-live-123", accessToken: "ya29.x" };\n`;
  assert.equal(rule(src).length, 2);
});

test("does not flag Env.get usage", () => {
  const src = `${EAST}declare const Env: { get(n: string): string };\nexport const cfg = { host: "db.customer.com", password: Env.get("DB_PASSWORD") };\n`;
  assert.equal(rule(src).length, 0);
});

test("does not flag an empty-string credential", () => {
  const src = `${EAST}export const cfg = { host: "db.customer.com", password: "" };\n`;
  assert.equal(rule(src).length, 0);
});

test("does not flag `variant('none', null)` credentials", () => {
  const src = `${EAST}export const cfg = { host: "db.customer.com", accessKeyId: variant("none", null) };\n`;
  assert.equal(rule(src).length, 0);
});

test("does not flag credentials for a localhost sibling host (test containers)", () => {
  const src = `${EAST}export const cfg = { host: "localhost", password: "testpass" };\n`;
  assert.equal(rule(src).length, 0);
});

test("does not flag credentials for a localhost endpoint wrapped in variant (MinIO)", () => {
  const src =
    `${EAST}export const cfg = { endpoint: variant("some", "http://localhost:9000"), ` +
    `accessKeyId: variant("some", "minioadmin"), secretAccessKey: variant("some", "minioadmin") };\n`;
  assert.equal(rule(src).length, 0);
});

test("does not fire outside East/e3 source (no @elaraai import)", () => {
  const src = `export const cfg = { host: "db.customer.com", password: "hunter2" };\n`;
  assert.equal(rule(src).length, 0);
});

test("does not flag non-credential fields", () => {
  const src = `${EAST}export const cfg = { host: "db.customer.com", database: "erp", user: "reader" };\n`;
  assert.equal(rule(src).length, 0);
});
