/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `east-node exec <unit.beast2>`: the runner protocol, over this machine's
 * files.
 *
 * A unit (`UnitType` in `@elaraai/east`) runs a program on its inputs, merges
 * the parts of one output that earlier units wrote, or takes a delivered
 * collection in, and names where its output and its result go. east's
 * `executeUnit` does the work — the one TypeScript unit runner, which a browser
 * runs over the files in memory — and this module is its file wrapper: it
 * reads the unit file, resolves the paths the unit names against the unit
 * file's directory, and hands `executeUnit` this machine's files
 * (`nodeUnitIO`, which asks the host for a segment it finds absent through
 * `<segment>.want`), the platform packages the unit lists, imported by name,
 * and the process's memory. The CLI records the result where the unit says.
 * east-c and east-py implement the same protocol, and the conformance corpus
 * holds the three to the same output bytes and outcomes.
 */

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { FETCH_SEGMENTS_ENV, UnitType, decodeBeast2For, executeUnit, type Unit, type UnitResult } from '@elaraai/east';
import { resolveUnitPaths } from '@elaraai/east/internal';
import { loadPlatform, nodeUnitIO, pagedCacheBytes, residentBytes } from './loader.js';
import { peakBytes, unitRunReport } from './runner.js';

/**
 * Reads a unit file, naming every file the unit names by the path it is at: a
 * relative one resolved against the unit file's directory, so a unit and the
 * files it names move together.
 *
 * @param unitPath - the unit file
 * @returns the unit, its paths resolved
 * @throws {Error} When the file cannot be read or does not hold a unit.
 */
export function readUnit(unitPath: string): Unit {
    const unit = decodeBeast2For(UnitType)(readFileSync(unitPath));
    const base = dirname(resolve(unitPath));
    return resolveUnitPaths(unit, (path) => (isAbsolute(path) ? path : resolve(base, path)));
}

/**
 * Executes a unit over this machine's files: does its work, writes its output,
 * and reports how it went.
 *
 * @param unit - the unit, its paths resolved ({@link readUnit})
 * @param verbose - print, on stderr, the account of each input `run -v`
 *   prints — its file and what it weighs, whether it opened lazily or was
 *   decoded whole, and what reading it came to — which is what reaches a
 *   task's log
 * @returns the result — a failure is its outcome, never a throw
 *
 * @remarks
 * The unit's thread grant caps the frame pool for the rest of the process: a
 * grant of one frames every output inline. A unit whose host places its
 * segments as they are read (`fetch`) turns on {@link FETCH_SEGMENTS_ENV} for
 * the process, and has a segment of a staged manifest that is absent asked for
 * as it is first read. A lazy input's pager keeps the segments keyed and index
 * reads decode, up to `EAST_PAGED_CACHE_BYTES` of decoded weight
 * ({@link pagedCacheBytes}).
 */
export async function execUnit(unit: Unit, verbose = false): Promise<UnitResult> {
    if (unit.fetch) process.env[FETCH_SEGMENTS_ENV] = '1';
    else delete process.env[FETCH_SEGMENTS_ENV];
    const cacheBytes = pagedCacheBytes();
    return executeUnit(unit, nodeUnitIO, {
        platforms: loadPlatform,
        resident: residentBytes,
        peakBytes,
        ...(cacheBytes !== undefined && { cacheBytes }),
        ...(verbose && { report: unitRunReport }),
    });
}
