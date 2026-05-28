#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE.md for details.
 *
 * Launcher for the native east-c binary. Resolves the platform-specific
 * package via require.resolve and execs the binary with the original argv.
 * The per-platform package is gated on this host's os/cpu by npm via the
 * package's own `os` / `cpu` fields, so only one ever installs.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const isWin = process.platform === "win32";
const pkg = `@elaraai/east-c-cli-${process.platform}-${process.arch}`;
const exe = `east-c${isWin ? ".exe" : ""}`;

let bin;
try {
  bin = require.resolve(`${pkg}/${exe}`);
} catch {
  console.error(
    `east-c: no prebuilt binary for ${process.platform}-${process.arch} ` +
      `(expected package ${pkg}). Supported targets: ` +
      "linux-x64, linux-arm64, darwin-arm64, darwin-x64, win32-x64.",
  );
  process.exit(1);
}

const result = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(`east-c: failed to spawn ${bin}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
