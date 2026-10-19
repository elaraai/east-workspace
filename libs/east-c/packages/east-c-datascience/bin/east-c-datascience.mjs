#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE.md for details.
 */

/**
 * The east-c-datascience package's command.
 *
 *   east-c-datascience fetch-libtorch [--variant cpu|cu128] [--force] [--archive <zip>]
 *       Fetches the pinned libtorch build into the installed platform package,
 *       beside its libraries, where the neural-network family finds it. The
 *       libraries of the other families (OR-Tools, XGBoost) need no fetch.
 *   east-c-datascience path
 *       Prints the directory holding the package's libraries — what
 *       EAST_C_PACKAGE_PATH is set to where the east-c launcher is bypassed.
 *
 * The libraries themselves come with the per-platform package
 * (@elaraai/east-c-datascience-<os>-<cpu>, an optionalDependency gated on
 * os/cpu, as @elaraai/east-c-cli's binary does), and the east-c launcher
 * points the binary at them; nothing here runs at execution time.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGETS = new Set(['linux-x64']);
const key = `${process.platform}-${process.arch}`;
const pkg = `@elaraai/east-c-datascience-${key}`;

function platformPackageDir() {
    if (!TARGETS.has(key)) {
        console.error(
            `east-c-datascience: no prebuilt package for ${key}. Published for: ${[...TARGETS].join(', ')}.`,
        );
        process.exit(1);
    }
    // From this package first, then from the project (a layout that keeps
    // the platform package out of this one's reach, as pnpm's can).
    for (const from of [import.meta.url, pathToFileURL(join(process.cwd(), 'package.json')).href]) {
        try {
            return dirname(createRequire(from).resolve(`${pkg}/package.json`));
        } catch {
            /* try the next */
        }
    }
    console.error(
        `east-c-datascience: the platform package ${pkg} is not installed.\n` +
        `It should install automatically as an optionalDependency of @elaraai/east-c-datascience.\n` +
        `Reinstall it with:  npm install ${pkg}`,
    );
    process.exit(1);
}

function usage(code) {
    const out = code === 0 ? console.log : console.error;
    out(
        'usage: east-c-datascience fetch-libtorch [--variant cpu|cu128] [--force] [--archive <zip>]\n' +
        '       east-c-datascience path',
    );
    process.exit(code);
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
    case 'path': {
        console.log(join(platformPackageDir(), 'lib'));
        break;
    }
    case 'fetch-libtorch': {
        const dir = platformPackageDir();
        const { fetchLibtorch, parseArgs } = await import(pathToFileURL(join(dir, 'fetch-libtorch.mjs')).href);
        const options = parseArgs(rest);
        if (!options) usage(2);
        try {
            console.error(`east-c-datascience: ${await fetchLibtorch({ ...options, dir })}`);
        } catch (e) {
            console.error(`east-c-datascience: ${e.message}`);
            process.exit(1);
        }
        break;
    }
    case 'help':
    case '--help':
    case '-h':
        usage(0);
        break;
    default:
        usage(2);
}
