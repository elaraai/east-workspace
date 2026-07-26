#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Assert the TypeScript and C runtimes agree on which beast2 container they
 * write.
 *
 * The compliance suite pins ONE golden byte string per value and replays it in
 * TypeScript, east-c and east-py, so the two write-version constants must move
 * together or the shared goldens desync — a failure that surfaces as dozens of
 * unrelated-looking byte mismatches rather than as "you changed the wire
 * format in one runtime". This makes it one clear error instead.
 *
 * Hermetic on purpose: no network, no registry lookup. It runs inside
 * `make check-version`, which `version-drift.yml` executes on every PR.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const TS_FILE = join(ROOT, "libs/east/src/serialization/beast2/version.ts");
const C_FILE = join(ROOT, "libs/east-c/packages/east-c/include/east/serialization.h");

/** Read a declared constant, failing loudly rather than defaulting. */
function extract(file, pattern, label) {
    const source = readFileSync(file, "utf-8");
    const match = source.match(pattern);
    if (!match) {
        console.error(`check-wire-compat: could not find ${label} in ${file}`);
        console.error("  (was the constant renamed? this check must be updated with it)");
        process.exit(1);
    }
    return Number(match[1]);
}

const tsWrite = extract(
    TS_FILE,
    /export const BEAST2_WRITE_VERSION\s*=\s*(\d+)/,
    "BEAST2_WRITE_VERSION",
);
const cWrite = extract(
    C_FILE,
    /#define\s+EAST_BEAST2_WRITE_VERSION\s+(\d+)/,
    "EAST_BEAST2_WRITE_VERSION",
);

if (tsWrite !== cWrite) {
    console.error("check-wire-compat: beast2 write version differs between runtimes");
    console.error(`  TypeScript BEAST2_WRITE_VERSION      = ${tsWrite}  (${TS_FILE})`);
    console.error(`  C          EAST_BEAST2_WRITE_VERSION = ${cWrite}  (${C_FILE})`);
    console.error("");
    console.error("  These must move together: the compliance suite pins one golden byte");
    console.error("  string per value and replays it in TS, east-c and east-py alike, so a");
    console.error("  one-sided change desyncs every shared fixture. east-py has no encoder");
    console.error("  of its own and inherits the C constant through the bridge.");
    console.error("  See docs/conventions/BEAST2_WIRE_VERSION.md.");
    process.exit(1);
}

console.log(`check-wire-compat: beast2 write version v${tsWrite} (TypeScript and C agree)`);
