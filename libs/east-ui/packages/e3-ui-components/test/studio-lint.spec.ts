/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Studio.component(…)` inside an East function passes every East rule, as
 * `Slice.config` does (#991, K8): the call is rooted on an `@elaraai/*` import,
 * which the rules read as East. This package lints its own tests with the
 * host-value rules only, so the spec runs the whole set over a surface written
 * as a solution writes one, with a control the rules must flag.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { Linter, type ESLint } from "eslint";
import * as tsParser from "@typescript-eslint/parser";

// The plugin is built in the job that runs this spec, but not in every job that
// typechecks this package (the showcase shards, the release), so its name is
// not a literal the typecheck resolves.
const plugin: string = "@elaraai/eslint-plugin-east";
const east = ((await import(plugin)) as { default: ESLint.Plugin }).default;

const fixtures = join(import.meta.dirname, "fixtures");
const clean = join(fixtures, "studio-component.ts");
const host = join(fixtures, "studio-component-host.ts");

// One program for both files, resolving the packages as a solution does.
const program = ts.createProgram([clean, host], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
});
const linter = new Linter({ configType: "flat" });

function lint(file: string): string[] {
    return linter.verify(readFileSync(file, "utf-8"), {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsParser as unknown as Linter.Parser,
            parserOptions: { programs: [program] },
        },
        plugins: { east },
        rules: { "east/east-rules": "error" },
    }, file).map((m) => m.message);
}

test("K8: Studio.component inside an East function passes every East rule", () => {
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
    assert.deepEqual(lint(clean), []);
});

test("the control: a TS helper making the component inside the East function is flagged", () => {
    const messages = lint(host);
    assert.ok(messages.length > 0);
    assert.ok(messages.every((m) => m.startsWith("[no-host-in-east-block]")), messages.join("\n"));
});
