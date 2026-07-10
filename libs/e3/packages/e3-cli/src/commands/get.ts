/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 get command - Get dataset value
 *
 * Usage:
 *   e3 dataset get . ws.name
 *   e3 dataset get . ws.name -f json
 *   e3 dataset get https://server/repos/myrepo ws.name
 *
 * Paths use the flat form `<ws>.<name>`. The resolver maps `<name>` to
 * its storage location (input or task output) automatically.
 */

import { datasetRead, workspaceGetDatasetHash, LocalStorage } from '@elaraai/e3-core';
import { datasetGet as datasetGetRemote } from '@elaraai/e3-api-client';
import { printFor, toJSONFor, decodeBeast2, encodeBeast2For, toEastTypeValue, isVariant, type EastTypeValue } from '@elaraai/east';
import { parseRepoLocation, formatError, exitError } from '../utils.js';
import { resolveDatasetPath } from '../path-resolver.js';

/** Supported output formats for `e3 dataset get`. */
export type GetFormat = 'east' | 'json' | 'beast2';

const GET_FORMATS: readonly GetFormat[] = ['east', 'json', 'beast2'];

export function parseGetFormat(value: string | undefined): GetFormat {
  if (value === undefined) return 'east';
  if ((GET_FORMATS as readonly string[]).includes(value)) {
    return value as GetFormat;
  }
  throw new Error(`Unknown format: '${value}'. Use one of: ${GET_FORMATS.join(', ')}`);
}

/**
 * Get dataset value at a path.
 */
export async function getCommand(
  repoArg: string,
  pathSpec: string,
  options: { format?: string }
): Promise<void> {
  try {
    const location = await parseRepoLocation(repoArg);
    const { ws, path } = await resolveDatasetPath(location, pathSpec);
    const format = parseGetFormat(options.format);

    let type: EastTypeValue;
    let value: unknown;
    // the remote API hands us the wire beast2 verbatim — reuse it for `-f beast2`
    // instead of a decode → re-encode round-trip (matters on multi-GB datasets)
    let rawBeast2: Uint8Array | null = null;

    if (location.type === 'local') {
      const storage = new LocalStorage();
      const { refType, hash } = await workspaceGetDatasetHash(storage, location.path, ws, path);

      if (refType === 'unassigned') {
        exitError(`'${pathSpec}' is unassigned (no value has been set or produced yet)`);
      }

      if (refType === 'null' || hash === null) {
        console.log('null');
        return;
      }

      const dataset = await datasetRead(storage, location.path, hash);
      type = isVariant(dataset.type) ? dataset.type as EastTypeValue : toEastTypeValue(dataset.type);
      value = dataset.value;
    } else {
      const { data: beast2Data } = await datasetGetRemote(
        location.baseUrl,
        location.repo,
        ws,
        path,
        { token: location.token }
      );

      const decoded = decodeBeast2(beast2Data);
      type = decoded.type;
      value = decoded.value;
      rawBeast2 = beast2Data;
    }

    switch (format) {
      case 'east': {
        const printer = printFor(type);
        console.log(printer(value));
        break;
      }
      case 'json': {
        const toJSON = toJSONFor(type);
        const jsonValue = toJSON(value);
        console.log(JSON.stringify(jsonValue, null, 2));
        break;
      }
      case 'beast2': {
        // binary to stdout — redirect to a file (`> out.beast2`); round-trips
        // through `e3 dataset set` unchanged
        const bytes = rawBeast2 ?? encodeBeast2For(type)(value as never);
        await new Promise<void>((resolve, reject) => {
          process.stdout.write(bytes, (err) => (err ? reject(err) : resolve()));
        });
        break;
      }
      default:
        exitError(`Unknown format: ${format}. Use: east, json, beast2`);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
