import { test } from "node:test";
import assert from "node:assert/strict";
import { writtenPaths } from "../lib/bash-writes.js";
import { reviewable } from "../lib/review.js";

test("a heredoc write is seen", () => {
  assert.deepEqual(writtenPaths("cat > model.py <<'EOF'\nimport east\nEOF"), ["model.py"]);
});

test("plain and appending redirects are seen", () => {
  assert.deepEqual(writtenPaths("echo x > a.py"), ["a.py"]);
  assert.deepEqual(writtenPaths("echo x >> b.py"), ["b.py"]);
  assert.deepEqual(writtenPaths('printf x > "quoted name.py"'.replace(" name", "_name")), ["quoted_name.py"]);
});

test("tee, sed -i, cp and mv destinations are seen", () => {
  assert.deepEqual(writtenPaths("echo x | tee out.py"), ["out.py"]);
  assert.deepEqual(writtenPaths("echo x | tee -a out.py"), ["out.py"]);
  assert.deepEqual(writtenPaths("sed -i 's/a/b/' target.py"), ["target.py"]);
  assert.deepEqual(writtenPaths("cp src.py dest.py"), ["dest.py"]);
  assert.deepEqual(writtenPaths("mv src.py dest.py"), ["dest.py"]);
});

test("fd redirects and /dev targets are not files", () => {
  assert.deepEqual(writtenPaths("run 2>&1"), []);
  assert.deepEqual(writtenPaths("run > /dev/null 2>&1"), []);
  assert.deepEqual(writtenPaths("run >&2"), []);
});

test("a command that writes nothing yields nothing", () => {
  assert.deepEqual(writtenPaths("pytest -q"), []);
  assert.deepEqual(writtenPaths("git status"), []);
  assert.deepEqual(writtenPaths(""), []);
});

test("each segment of a compound command is read separately", () => {
  const found = writtenPaths("cp a.py b.py && cat > c.py <<'EOF'\nx\nEOF");
  assert.deepEqual(found.sort(), ["b.py", "c.py"]);
});

test("only reviewable extensions outside vendored trees reach a review", () => {
  assert.equal(reviewable("model.py"), true);
  assert.equal(reviewable("a.ts"), true);
  assert.equal(reviewable("a.tsx"), true);
  assert.equal(reviewable("notes.txt"), false);
  assert.equal(reviewable("out.json"), false);
  assert.equal(reviewable("node_modules/@elaraai/east/dist/index.js"), false);
  assert.equal(reviewable("/proj/.venv/lib/site-packages/east/x.py"), false);
});
