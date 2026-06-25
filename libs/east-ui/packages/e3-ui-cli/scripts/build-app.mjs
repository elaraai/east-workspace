/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Build the prebuilt browser app (`app/`) into `dist/app`. Run after `tsc` as
 * the second half of the package `build` script. Bundles the East→React
 * renderer once so the shipped CLI needs no Vite at runtime.
 */

import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const configFile = resolve(here, '..', 'app', 'vite.config.ts');

await build({ configFile, logLevel: 'warn' });
console.log('[e3-ui-cli] built browser app → dist/app');
