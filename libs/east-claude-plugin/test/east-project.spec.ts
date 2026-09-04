import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEastProjectInfo, detectPythonSkills } from "../lib/east-project.js";
import { EAST_RULES_CONTEXT, EAST_RULES_CONTEXT_PY, eastRulesContextFor } from "../lib/east-rules-context.js";

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "east-project-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

const PYPROJECT = `[project]
name = "demo"
dependencies = ["elaraai-east-py>=1.0", "elaraai-east-py-datascience>=1.0"]
`;

test("a uv/pyproject-only project is an East project", async () => {
  const dir = project({ "pyproject.toml": PYPROJECT });
  try {
    const info = await getEastProjectInfo(dir);
    assert.equal(info.isEast, true, "a python East project must not report isEast:false");
    assert.deepEqual(info.languages, ["python"]);
    assert.ok(info.skills.includes("east-py"));
    assert.ok(info.skills.includes("east-py-datascience"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a package.json-only project still reports typescript", async () => {
  const dir = project({ "package.json": JSON.stringify({ dependencies: { "@elaraai/east": "1.0.0" } }) });
  try {
    const info = await getEastProjectInfo(dir);
    assert.equal(info.isEast, true);
    assert.deepEqual(info.languages, ["typescript"]);
    assert.deepEqual(info.skills, ["east"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a mixed project reports both languages, with no duplicate skills", async () => {
  const dir = project({
    "package.json": JSON.stringify({ dependencies: { "@elaraai/east": "1.0.0", "@elaraai/east-py-datascience": "1.0.0" } }),
    "pyproject.toml": PYPROJECT,
  });
  try {
    const info = await getEastProjectInfo(dir);
    assert.deepEqual(info.languages, ["typescript", "python"]);
    assert.equal(new Set(info.skills).size, info.skills.length, "skills must not repeat across ecosystems");
    assert.ok(info.skills.includes("east-py-datascience"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a project with neither is not an East project", async () => {
  const dir = project({ "package.json": JSON.stringify({ dependencies: { lodash: "4" } }) });
  try {
    const info = await getEastProjectInfo(dir);
    assert.equal(info.isEast, false);
    assert.deepEqual(info.languages, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the longest python distribution name wins, so -std is never also bare east-py", () => {
  assert.deepEqual(detectPythonSkills('dependencies = ["elaraai-east-py-std"]'), ["east-py-std"]);
  assert.deepEqual(detectPythonSkills('dependencies = ["elaraai-east-py-io"]'), ["east-py-io"]);
  assert.deepEqual(detectPythonSkills('dependencies = ["elaraai-east-py"]'), ["east-py"]);
  assert.deepEqual(detectPythonSkills(null), []);
});

test("the rules cheat-sheet follows the detected language", () => {
  const py = eastRulesContextFor(["python"]);
  assert.equal(py, EAST_RULES_CONTEXT_PY, "a python project gets the python rules, not the TypeScript ones");
  assert.ok(!py.includes("$.let"), "the python sheet must not be spelled in TypeScript");
  assert.ok(py.includes("b.let"));

  const ts = eastRulesContextFor(["typescript"]);
  assert.equal(ts, EAST_RULES_CONTEXT);

  const both = eastRulesContextFor(["typescript", "python"]);
  assert.ok(both.includes("$.let") && both.includes("b.let"));

  assert.equal(eastRulesContextFor([]), EAST_RULES_CONTEXT, "an unknown language falls back to TypeScript");
});
