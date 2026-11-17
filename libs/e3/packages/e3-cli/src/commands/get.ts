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
 *
 * `-f beast2` writes the value as it is stored, decoding nothing: a
 * collection's segments spliced under their header as they are read, and any
 * other value's stored bytes, a range at a time. A dataset of any size is
 * written without being held, from a local repository and from a server alike.
 */

import { datasetRead, readDatasetChunks, workspaceGetDatasetHash, LocalStorage } from '@elaraai/e3-core';
import { datasetGet as datasetGetRemote, datasetGetStream } from '@elaraai/e3-api-client';
import { printFor, toJSONFor, decodeBeast2, toEastTypeValue, isVariant, type EastTypeValue } from '@elaraai/east';
import { parseRepoLocation, formatError, exitError } from '../utils.js';
import { resolveDatasetPath } from '../path-resolver.js';

/** Writes a value's bytes to the standard output as they come — redirect it to
 *  a file (`> out.beast2`), which `e3 dataset set` takes back unchanged. */
async function writeOut(chunks: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const chunk of chunks) {
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(chunk, (err) => (err ? reject(err) : resolve()));
    });
  }
}

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

      if (format === 'beast2') {
        await writeOut(readDatasetChunks(storage, location.path, hash));
        return;
      }
      const dataset = await datasetRead(storage, location.path, hash);
      type = isVariant(dataset.type) ? dataset.type as EastTypeValue : toEastTypeValue(dataset.type);
      value = dataset.value;
    } else {
      if (format === 'beast2') {
        const { chunks } = await datasetGetStream(location.baseUrl, location.repo, ws, path, { token: location.token });
        await writeOut(chunks);
        return;
      }
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
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
