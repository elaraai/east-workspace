/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The function manifests `--functions` names (#628): files `east-py
 * export-functions` / `east-node export-functions` wrote, for packages that
 * are not members of the workspace being exported.
 */
import * as fs from 'node:fs';
import { decodeFunctionManifest, type FunctionManifest } from '@elaraai/east';

/**
 * Reads the function manifests `--functions` names.
 *
 * @param paths - The manifests' files
 * @returns Each manifest, decoded, in order
 */
export function readFunctionManifests(paths: readonly string[]): FunctionManifest[] {
  return paths.map((file) => decodeFunctionManifest(new Uint8Array(fs.readFileSync(file))));
}
