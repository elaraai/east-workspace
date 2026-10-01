/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The packages e3-web's specs of the whole e3 import, authored with the e3
 * SDK and exported as `e3.export` writes them: Node only.
 *
 * - `e3-web-platform`: a task that calls e3's own platform functions from its
 *   unit, listing the workspaces of the e3 it runs in.
 * - `e3-web-held`: a task split over the pieces of its input, whose last
 *   piece holds its unit worker in a page that holds (`test_hold`), so the
 *   page closes with the task's other pieces finished and that one running.
 *
 * The specs import each zip through e3's API, as an app imports the zip its
 * build exported.
 *
 * @packageDocumentation
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArrayType, DictType, East, IntegerType, SortedMap, StringType, compareFor } from '@elaraai/east';
import e3, { type Runner } from '@elaraai/e3';
import { Platform } from '@elaraai/e3-api-client';
import { WEB_E3_ORIGIN } from '../bridge/protocol.js';
import { E3_PLATFORM } from '../execution/e3-platform.js';
import { ADMIN_TOKEN } from './callers.js';
import { HOLD_PLATFORM, test_hold } from './hold-platform.js';

/** The package whose task lists the e3's workspaces. */
export const PLATFORM_PACKAGE = 'e3-web-platform';
/** The package whose split task holds its last piece. */
export const HELD_PACKAGE = 'e3-web-held';
/** Both packages' version. */
export const FIXTURE_VERSION = '1.0.0';

/** The held task's input: amounts by key. */
export const RowsType = DictType(IntegerType, IntegerType);

/** How many rows the held task's input has: enough for the store to cut it
 *  into several segments, and so the task into several pieces. */
export const HELD_ROWS = 8_000;

/**
 * The held task's input: each key `i`, from 0, with amount `i % 97`.
 *
 * @returns The rows
 */
export function heldRows(): SortedMap<bigint, bigint> {
  return new SortedMap(Array.from({ length: HELD_ROWS }, (_, i) => [BigInt(i), BigInt(i % 97)] as const), compareFor(IntegerType));
}

/**
 * The held task's output for {@link heldRows}: each amount doubled.
 *
 * @returns The output
 */
export function heldOutput(): SortedMap<bigint, bigint> {
  return new SortedMap(Array.from({ length: HELD_ROWS }, (_, i) => [BigInt(i), BigInt(2 * (i % 97))] as const), compareFor(IntegerType));
}

/** east-node, with e3's own platform functions beside east-node-std's. */
const WITH_E3: Runner = { runtime: 'east-node', platforms: ['@elaraai/east-node-std', { custom: E3_PLATFORM }] };

/** east-node, with the hold beside east-node-std's. */
const WITH_HOLD: Runner = { runtime: 'east-node', platforms: ['@elaraai/east-node-std', { custom: HOLD_PLATFORM }] };

/**
 * The package whose task lists the e3's workspaces: `workspaces`, over the
 * repository its input names, calls `Platform.workspaceList` from its unit
 * with the in-page e3's URL and the admin's token, and answers their names.
 *
 * @returns The package
 */
function platformPackage(): ReturnType<typeof e3.package> {
  const repo = e3.input('repo', StringType);
  const workspaces = e3.task('workspaces', [repo], East.asyncFunction([StringType], ArrayType(StringType), ($, name) => {
    const found = $.let(Platform.workspaceList(WEB_E3_ORIGIN, name, ADMIN_TOKEN));
    return found.map(($, workspace) => workspace.name);
  }), { runner: WITH_E3 });
  return e3.package(PLATFORM_PACKAGE, FIXTURE_VERSION, workspaces);
}

/**
 * The package whose split task holds its last piece: `held` doubles each
 * amount of its input, split over its pieces, and the piece holding the
 * input's last key calls `test_hold()` first.
 *
 * @returns The package
 */
function heldPackage(): ReturnType<typeof e3.package> {
  const rows = e3.input('rows', RowsType);
  const held = e3.streamTask('held', {
    inputs: [e3.partition(rows)],
    output: e3.output.dict(IntegerType, IntegerType),
    runner: WITH_HOLD,
  }, ($, rows, emit) => {
    $.for(rows, ($, amount, key) => {
      $.if(East.equal(key, BigInt(HELD_ROWS - 1)), ($) => {
        $(test_hold());
      });
      $(emit(key, amount.multiply(2n)));
    });
  });
  return e3.package(HELD_PACKAGE, FIXTURE_VERSION, held);
}

/**
 * Exports a package as `e3.export` writes it.
 *
 * @returns The zip's bytes
 */
async function exported(pkg: ReturnType<typeof e3.package>, name: string): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'e3-web-fixtures-'));
  try {
    const zip = join(dir, `${name}.zip`);
    await e3.export(pkg, zip);
    return new Uint8Array(readFileSync(zip));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The packages' zips.
 *
 * @returns Each package's zip, by its name
 */
export async function buildE3Fixtures(): Promise<{ readonly platform: Uint8Array; readonly held: Uint8Array }> {
  return {
    platform: await exported(platformPackage(), PLATFORM_PACKAGE),
    held: await exported(heldPackage(), HELD_PACKAGE),
  };
}
