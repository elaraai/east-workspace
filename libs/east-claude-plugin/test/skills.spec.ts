import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every skill carries the mandatory "Before writing code" section (#654,
// SKILLS_STANDARD.md): the agent must search the example index before
// writing East code, and nothing is injected for it.
const SKILLS = join(process.cwd(), "skills");

test("every skill mandates searching the example index before coding", () => {
  const dirs = readdirSync(SKILLS, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name);
  assert.ok(dirs.length >= 16, `skills present: ${dirs.length}`);
  const missing: string[] = [];
  for (const name of dirs) {
    const file = join(SKILLS, name, "SKILL.md");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf-8");
    if (!/^## Before writing code/m.test(text) || !text.includes("search_east_examples")) missing.push(name);
  }
  assert.deepEqual(missing, [], `skills without the section: ${missing.join(", ")}`);
});
