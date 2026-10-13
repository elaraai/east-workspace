#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Assert no native build downloads anything: every third-party source a CMake
 * file builds from is a copy in the tree.
 *
 * A build that fetches its sources fails whenever the host serving them does —
 * a GitHub HTTP 500 while CMake fetched miniz failed a release. The sources are
 * checked in as their upstream release archives under `third_party/`, each
 * named with its SHA-256 (libs/east-c/packages/east-c/third_party/README.md),
 * and this keeps a download from coming back: outside comments, no CMake file
 * may name a repository to clone, a network URL, or `file(DOWNLOAD`.
 *
 * Hermetic on purpose: no network, no registry lookup. It runs inside
 * `make check-version`, which `version-drift.yml` executes on every PR.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** What a CMake file may not do, each with the words the error names it by. */
const DOWNLOADS = [
    { pattern: /\b(GIT|SVN|HG|CVS)_REPOSITORY\b/, what: "clones a repository" },
    { pattern: /\b(?!file:)[a-z][a-z0-9+.-]*:\/\//i, what: "names a network URL" },
    { pattern: /\bfile\s*\(\s*DOWNLOAD\b/i, what: "downloads a file" },
];

const files = execFileSync("git", ["ls-files", "-z", "--", "*CMakeLists.txt", "*.cmake"], {
    cwd: ROOT,
    encoding: "utf-8",
})
    .split("\0")
    .filter((file) => file !== "");

const found = [];
for (const file of files) {
    const lines = readFileSync(join(ROOT, file), "utf-8").split("\n");
    lines.forEach((line, index) => {
        // A comment may name where a source came from; only what CMake runs counts.
        const code = line.replace(/#.*$/, "");
        const download = DOWNLOADS.find(({ pattern }) => pattern.test(code));
        if (download) found.push(`  ${file}:${index + 1} ${download.what}: ${line.trim()}`);
    });
}

if (found.length > 0) {
    console.error("check-native-sources: a native build downloads its sources");
    for (const line of found) console.error(line);
    console.error("");
    console.error("  A build that downloads fails whenever the host serving it does. Check the");
    console.error("  upstream release archive into third_party/ and name it with its SHA-256");
    console.error("  (URL_HASH), as libs/east-c/packages/east-c/third_party/README.md describes.");
    process.exit(1);
}

console.log(`check-native-sources: the ${files.length} CMake files build from sources in the tree`);
