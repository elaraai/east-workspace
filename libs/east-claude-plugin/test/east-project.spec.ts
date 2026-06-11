import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isElaraaiPackageSrc } from "../lib/east-project.js";

function makePackage(name: string): string {
  const root = mkdtempSync(join(tmpdir(), "eps-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name }));
  return root;
}

function touch(dir: string, ...segments: string[]): string {
  const file = join(dir, ...segments);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, "");
  return file;
}

test("isElaraaiPackageSrc: true for a file under an @elaraai/* package src/", async () => {
  const root = makePackage("@elaraai/east-ui");
  assert.equal(await isElaraaiPackageSrc(touch(root, "src", "buttons", "index.ts")), true);
});

test("isElaraaiPackageSrc: false for an @elaraai/* example under test/ (not src/)", async () => {
  const root = makePackage("@elaraai/east-ui");
  assert.equal(await isElaraaiPackageSrc(touch(root, "test", "slice", "x.examples.tsx")), false);
});

test("isElaraaiPackageSrc: false for a non-@elaraai package src (an end-user solution)", async () => {
  const root = makePackage("my-forecast");
  assert.equal(await isElaraaiPackageSrc(touch(root, "src", "index.ts")), false);
});

test("isElaraaiPackageSrc: false when there is no package.json above the file", async () => {
  const root = mkdtempSync(join(tmpdir(), "eps-"));
  assert.equal(await isElaraaiPackageSrc(touch(root, "lib", "thing.ts")), false);
});
