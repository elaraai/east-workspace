/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { changedPaths, classifyChanges, selectTests, shardCount } from "../../scripts/responsive-impact.js";
import { listTests, selectShard, testIdentity } from "../../scripts/responsive-shards.js";

const showcase = "libs/east-ui/packages/east-ui-showcase/";
let discovered: string[];
const suite = () => discovered ??= listTests();

test("docs, unit specs and non-browser packages skip browsers; shared and unknown changes run all", () => {
    assert.equal(classifyChanges([
        "libs/east-ui/packages/e3-ui/CLAUDE.md",
        "libs/east-ui/packages/e3-ui-components/src/plan/plan-paged-seek.dom.test.tsx",
        "libs/e3/packages/e3-cli/src/index.ts",
        "libs/east-ui/packages/e3-ui-cli/src/main.ts",
        "libs/east-c/packages/east-c/src/compiler.c",
    ]).mode, "none");
    for (const path of [
        "libs/east-ui/packages/east-ui-components/src/layout/builder-frame/index.tsx",
        "libs/east-ui/packages/east-ui-components/src/theme/index.ts",
        "libs/east-ui/packages/e3-ui-components/src/platform/record-cache.ts",
        "libs/east-ui/packages/e3-ui/test/sheet/sheet-records.examples.tsx",
        "libs/east-ui/packages/e3-ui/src/plan/types.ts",
        "libs/east-ui/packages/e3-ui-components/src/new-component/index.tsx",
        "libs/e3/packages/e3-web/src/index.ts",
        "libs/e3/packages/e3-api-server/src/portable.ts",
        "libs/east/src/compiler.ts",
        "pnpm-lock.yaml",
        ".github/workflows/test-east-ui.yml",
        `${showcase}tests/responsive/settle.ts`,
        `${showcase}scripts/responsive-impact.ts`,
    ]) assert.equal(classifyChanges([path]).mode, "all", path);
    assert.equal(classifyChanges(null).mode, "all");
    assert.deepEqual(selectTests(suite(), classifyChanges(["README.md"])), []);
    assert.deepEqual(selectTests(suite(), classifyChanges(null)), suite());
});

test("a browser-spec change selects every applicable project of exactly that spec", () => {
    const specs = ["flowchart-records.spec.ts", "plan-delete.spec.ts"];
    const impact = classifyChanges(specs.map(spec => `${showcase}tests/responsive/${spec}`));
    const selected = selectTests(suite(), impact);
    assert.deepEqual(selected, suite().filter(t => specs.some(spec => t.includes(` › ${spec}:`))));
    assert.ok(selected.some(t => t.startsWith("[desktop]")));
    assert.ok(selected.some(t => t.startsWith("[mobile]")));
    assert.ok(selected.some(t => t.startsWith("[mobile-narrow]")));
    assert.equal(shardCount(selected.length), 1);
    // A removed/renamed spec or an unrecognised list format cannot erase coverage.
    assert.deepEqual(selectTests(suite(), classifyChanges([`${showcase}tests/responsive/deleted.spec.ts`])), suite());
    assert.deepEqual(selectTests(["unknown list format"], impact), ["unknown list format"]);
});

test("component renderer changes retain shared and new checks and union explicitly changed specs", () => {
    const future = "[desktop] › tests/responsive/new-shared-check.spec.ts:1:1 › new cross-component check";
    const tests = [...suite(), future];
    const impact = classifyChanges([
        "libs/east-ui/packages/e3-ui-components/src/flowchart/index.tsx",
        `${showcase}tests/responsive/plan-delete.spec.ts`,
        "README.md",
    ]);
    const selected = selectTests(tests, impact);
    assert.ok(selected.length > 0 && selected.length < tests.length);
    assert.ok(selected.includes(future));
    for (const spec of ["flowchart-records", "flowchart-builder", "builder-panes", "catalog", "fa-icons", "inspector-form", "record-hosts", "plan-delete"]) {
        const original = suite().filter(t => t.includes(` › ${spec}.spec.ts:`));
        assert.ok(original.length > 0, spec);
        assert.ok(original.every(t => selected.includes(t)), spec);
    }
    assert.ok(!selected.some(t => t.includes(" › roster.spec.ts:") || t.includes(" › plan-geometry.spec.ts:")));
});

test("the Schematic's renderer narrows to its own suites and the shared checks, which hold its hosts, and none of another component's own (#1384, #1387–#1394)", () => {
    const impact = classifyChanges(["libs/east-ui/packages/e3-ui-components/src/schematic/canvas/paint.ts"]);
    assert.deepEqual({ mode: impact.mode, components: impact.components }, { mode: "focused", components: ["schematic"] });
    const selected = selectTests(suite(), impact);
    for (const spec of [
        "schematic-frame", "schematic-editing", "schematic-library", "schematic-drop", "schematic-narrowing", "schematic-perf", "schematic-phone", "schematic-window",
        "schematic-links", "foundations", "visual-invariants", "toolbar-touch", "builder-loading",
    ]) {
        const original = suite().filter(t => t.includes(` › ${spec}.spec.ts:`));
        assert.ok(original.length > 0 && original.every(t => selected.includes(t)), spec);
    }
    assert.ok(!selected.some(t => t.includes(" › roster.spec.ts:") || t.includes(" › flowchart-records.spec.ts:")));
    // Another component's change runs none of the Schematic's own suites.
    const flowchart = selectTests(suite(), classifyChanges(["libs/east-ui/packages/e3-ui-components/src/flowchart/index.tsx"]));
    assert.ok(!flowchart.some(t => /› schematic-(?:drop|editing|frame|library|narrowing|perf|phone|window)\.spec\.ts:/.test(t)));
});

test("Playwright resolves focused lists and all their smaller shards exactly once", () => {
    const selected = selectTests(suite(), classifyChanges([
        "libs/east-ui/packages/e3-ui-components/src/flowchart/index.tsx",
    ]));
    const directory = mkdtempSync(join(tmpdir(), "east-ui-focused-"));
    try {
        const file = join(directory, "selected.txt");
        writeFileSync(file, selected.join("\n") + "\n");
        assert.deepEqual(listTests([`--test-list=${file}`]).map(testIdentity), selected.map(testIdentity));
        const count = shardCount(selected.length);
        assert.ok(count < 16 && count > 0);
        const executed: string[] = [];
        for (let n = 1; n <= count; n++) {
            const shard = selectShard(selected, `${n}/${count}`);
            assert.ok(shard.length > 0);
            writeFileSync(file, shard.join("\n") + "\n");
            const actual = listTests([`--test-list=${file}`]).map(testIdentity);
            assert.deepEqual(actual, shard.map(testIdentity));
            executed.push(...actual);
        }
        assert.deepEqual(executed.sort(), selected.map(testIdentity).sort());
        assert.equal(new Set(executed).size, selected.length);
        assert.equal(shardCount(0), 1); // valid placeholder matrix; the job is skipped
        assert.equal(shardCount(100_000), 16);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("PR merge-parent comparison keeps earlier commits, excludes base-only changes and includes both sides of a rename", () => {
    const directory = mkdtempSync(join(tmpdir(), "east-ui-impact-git-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const commit = (message: string) => {
        git("add", ".");
        git("-c", "commit.gpgsign=false", "commit", "-m", message);
        return git("rev-parse", "HEAD");
    };
    try {
        git("init", "-b", "main");
        git("config", "user.name", "Responsive CI test");
        git("config", "user.email", "test@example.invalid");
        writeFileSync(join(directory, "README.md"), "base\n");
        const base = commit("base");
        git("checkout", "-b", "feature");
        writeFileSync(join(directory, "component.ts"), "export const value = 1;\n");
        commit("component change");
        writeFileSync(join(directory, "README.md"), "documentation follow-up\n");
        commit("docs follow-up");
        assert.deepEqual(changedPaths(base, "HEAD", directory), ["README.md", "component.ts"]);
        git("checkout", "main");
        writeFileSync(join(directory, "base-only.ts"), "export const base = 1;\n");
        commit("base advances");
        git("-c", "commit.gpgsign=false", "merge", "--no-ff", "feature", "-m", "PR merge result");
        assert.deepEqual(changedPaths("HEAD^", "HEAD", directory), ["README.md", "component.ts"]);
        git("mv", "component.ts", "renamed.ts");
        commit("rename");
        assert.deepEqual(changedPaths("HEAD^", "HEAD", directory), ["component.ts", "renamed.ts"]);
        assert.equal(changedPaths("missing-base", "HEAD", directory), null);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
