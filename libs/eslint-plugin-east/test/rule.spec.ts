/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { Linter, type Rule } from "eslint";
import * as tsParser from "@typescript-eslint/parser";
import { eastRules } from "../src/rule.js";

const projDir = join(process.cwd(), "test-fixtures", "proj");
const rule = eastRules as unknown as Rule.RuleModule;
const linter = new Linter({ configType: "flat" });

// Build one TS program for both fixtures up front — avoids parser global-cache
// issues where getSourceFile() returns undefined after linting a different file.
const tsconfigPath = join(projDir, "tsconfig.json");
const parsedConfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
const { fileNames, options: compilerOptions } = ts.parseJsonConfigFileContent(
  parsedConfig.config,
  ts.sys,
  projDir,
);
const tsProgram = ts.createProgram(fileNames, compilerOptions);

function lint(fixture: string, ruleConfig: unknown = "warn") {
  const file = join(projDir, fixture);
  const code = readFileSync(file, "utf-8");
  return linter.verify(
    code,
    {
      files: ["**/*.ts"],
      languageOptions: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parser: tsParser as any,
        parserOptions: { programs: [tsProgram] },
      },
      plugins: { east: { rules: { "east-rules": rule } } },
      rules: { "east/east-rules": ruleConfig as never },
    },
    file,
  );
}

test("eslint-plugin-east: flags East idioms in bad.ts", () => {
  const messages = lint("bad.ts");
  const text = messages.map((m) => m.message).join("\n");
  assert.match(text, /no-redundant-east-cast/);
  assert.match(text, /no-unexecuted-east-expression/);
  assert.match(text, /prefer-some-none/);
  // reported as warnings (severity 1)
  assert.ok(messages.every((m) => m.severity === 1));
});

test("eslint-plugin-east: silent on good.ts", () => {
  assert.equal(lint("good.ts").length, 0);
});

test("eslint-plugin-east: `disabled` option suppresses a rule", () => {
  const messages = lint("bad.ts", ["warn", { disabled: ["prefer-some-none"] }]);
  const text = messages.map((m) => m.message).join("\n");
  assert.doesNotMatch(text, /prefer-some-none/);
  assert.match(text, /no-redundant-east-cast/);
});