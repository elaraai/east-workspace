/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Playwright's contiguous shards put neighboring expensive builder cases in
 * the same job. Interleave its discovered tests instead, preserving project
 * filters and using the public --test-list format for execution. Tests remain
 * independent (fullyParallel); read-only fixture batches stay inside one test.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const cli = join(dirname(createRequire(import.meta.url).resolve("playwright/package.json")), "cli.js");

/** Read the documented Playwright list format, refusing incomplete discovery. */
export function readTestList(output: string): string[] {
    const plain = stripVTControlCharacters(output);
    const tests = plain.split("\n").map(line => line.trim()).filter(line => /^\[[^\]]+\] › /.test(line));
    const total = /^Total: (\d+) tests? in \d+ files?$/m.exec(plain);
    if (!total || Number(total[1]) !== tests.length || new Set(tests).size !== tests.length) {
        throw new Error("Responsive test discovery was incomplete or contained duplicate tests");
    }
    return tests;
}

/** Discover the actual project-filtered suite without launching a browser. */
export function listTests(args: string[] = []): string[] {
    return readTestList(execFileSync(process.execPath, [cli, "test", ...args, "--list", "--reporter=list"], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, FORCE_COLOR: "0", PLAYWRIGHT_FORCE_TTY: "0" },
    }));
}

/** Spread every adjacent file/project's tests across the jobs, exactly once. */
export function selectShard(tests: readonly string[], shard: string): string[] {
    const parts = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shard);
    const current = Number(parts?.[1]);
    const total = Number(parts?.[2]);
    if (!Number.isSafeInteger(current) || !Number.isSafeInteger(total) || current > total) {
        throw new Error(`Invalid responsive shard '${shard}'; expected n/total with 1 <= n <= total`);
    }
    return tests.filter((_, index) => index % total === current - 1);
}

function main(args: string[]): number {
    const shardArgs = args.filter(arg => arg.startsWith("--shard="));
    if (args.includes("--shard") || shardArgs.length > 1) {
        throw new Error("Specify one responsive shard as --shard=n/total");
    }
    if (!shardArgs.length) return spawnSync(process.execPath, [cli, "test", ...args], { stdio: "inherit" }).status ?? 1;
    const shard = shardArgs[0].slice("--shard=".length);
    // Validate before importing any test files.
    selectShard([], shard);
    const forwarded = args.filter(arg => !arg.startsWith("--shard="));
    const tests = listTests(forwarded);
    const selected = selectShard(tests, shard);
    if (!selected.length) throw new Error(`Responsive shard ${shard} selected no tests`);
    console.log(`Responsive shard ${shard}: ${selected.length} of ${tests.length} tests (interleaved)`);
    const temporary = mkdtempSync(join(tmpdir(), "east-ui-responsive-"));
    try {
        const file = join(temporary, "tests.txt");
        writeFileSync(file, selected.join("\n") + "\n");
        return spawnSync(process.execPath, [cli, "test", ...forwarded, `--test-list=${file}`], { stdio: "inherit" }).status ?? 1;
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
}
