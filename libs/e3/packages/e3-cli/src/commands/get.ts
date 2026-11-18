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
 *   e3 dataset get . ws.name -f beast2 -o name.beast2
 *   e3 dataset get https://server/repos/myrepo ws.name
 *
 * Paths use the flat form `<ws>.<name>`. The resolver maps `<name>` to
 * its storage location (input or task output) automatically.
 *
 * `-f beast2` writes the value as it is stored, decoding nothing: a
 * collection's segments spliced under their header as they are read, and any
 * other value's stored bytes, a range at a time. A dataset of any size is
 * written without being held, from a local repository and from a server alike.
 *
 * The standard output is a stream: bytes written to it cannot be taken back,
 * so a read that fails part way — a dataset that moves while a server's is
 * read, say — leaves part of a value there, and the command says so as it
 * exits 1. `-o <path>` writes a file whole or not at all: to a file beside the
 * path, which takes the path's name once every byte is written, the read
 * starting over when the dataset moves.
 */

import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { datasetRead, readDatasetChunks, workspaceGetDatasetHash, LocalStorage } from '@elaraai/e3-core';
import { datasetGet as datasetGetRemote, datasetGetInto, datasetGetStream, type DatasetSink } from '@elaraai/e3-api-client';
import { printFor, toJSONFor, decodeBeast2, toEastTypeValue, isVariant, type EastTypeValue } from '@elaraai/east';
import { parseRepoLocation, formatError, exitError } from '../utils.js';
import { resolveDatasetPath } from '../path-resolver.js';

/** What a read that failed once bytes had gone to the standard output adds to its error. */
export const INCOMPLETE = 'What was written to the standard output is part of the value: use -o <path> for a file written whole or not at all.';

/**
 * A read stopped once some of the value had been written to the standard
 * output, which holds part of it.
 */
class IncompleteOutputError extends Error {
  constructor(cause: unknown) {
    super(`${formatError(cause)}\n${INCOMPLETE}`);
    this.name = 'IncompleteOutputError';
  }
}

/** Writes a value's bytes to the standard output as they come — redirect it to
 *  a file (`> out.beast2`), which `e3 dataset set` takes back unchanged. A
 *  read that fails once bytes are out says that what was written is part of
 *  the value. */
async function writeOut(chunks: AsyncIterable<Uint8Array>): Promise<void> {
  let written = false;
  try {
    for await (const chunk of chunks) {
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(chunk, (err) => (err ? reject(err) : resolve()));
      });
      written = true;
    }
  } catch (err) {
    throw written ? new IncompleteOutputError(err) : err;
  }
}

/**
 * Writes a file whole or not at all: its bytes go to a file beside `path`,
 * which takes the path's name once `fill` has written every one, and is
 * removed when `fill` fails. A reader of `path` sees the file it held before,
 * or the whole new one.
 *
 * @param path - The file to write
 * @param fill - Writes the bytes to the sink it is given, which starts over
 *   when told to
 */
export async function fileWrittenWhole(path: string, fill: (sink: DatasetSink) => Promise<void>): Promise<void> {
  // Beside the path, so on its filesystem: the rename replaces the path in one step
  const partial = `${path}.${randomUUID().slice(0, 8)}.partial`;
  // Appending, so a write after a truncation starts the file again
  const file = await open(partial, 'a');
  try {
    try {
      await fill({
        write: async (chunk) => { await file.appendFile(chunk); },
        restart: async () => { await file.truncate(0); },
      });
    } finally {
      await file.close();
    }
    await rename(partial, path);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
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
  options: { format?: string; output?: string }
): Promise<void> {
  try {
    const location = await parseRepoLocation(repoArg);
    const { ws, path } = await resolveDatasetPath(location, pathSpec);
    const format = parseGetFormat(options.format);
    const { output } = options;
    /** Prints the value as text: a line of the standard output, or the file. */
    const print = async (text: string): Promise<void> => {
      if (output === undefined) console.log(text);
      else await fileWrittenWhole(output, (sink) => Promise.resolve(sink.write(new TextEncoder().encode(`${text}\n`))));
    };

    let type: EastTypeValue;
    let value: unknown;

    if (location.type === 'local') {
      const storage = new LocalStorage();
      const { refType, hash } = await workspaceGetDatasetHash(storage, location.path, ws, path);

      if (refType === 'unassigned') {
        exitError(`'${pathSpec}' is unassigned (no value has been set or produced yet)`);
      }

      if (refType === 'null' || hash === null) {
        await print('null');
        return;
      }

      if (format === 'beast2') {
        const stored = (): AsyncIterable<Uint8Array> => readDatasetChunks(storage, location.path, hash);
        if (output === undefined) await writeOut(stored());
        else {
          await fileWrittenWhole(output, async (sink) => {
            for await (const chunk of stored()) await sink.write(chunk);
          });
        }
        return;
      }
      const dataset = await datasetRead(storage, location.path, hash);
      type = isVariant(dataset.type) ? dataset.type as EastTypeValue : toEastTypeValue(dataset.type);
      value = dataset.value;
    } else {
      if (format === 'beast2') {
        if (output === undefined) {
          const { chunks } = await datasetGetStream(location.baseUrl, location.repo, ws, path, { token: location.token });
          await writeOut(chunks);
        } else {
          // The file starts over when the dataset moves while it is read
          await fileWrittenWhole(output, async (sink) => {
            await datasetGetInto(location.baseUrl, location.repo, ws, path, { token: location.token }, sink);
          });
        }
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
        await print(printer(value));
        break;
      }
      case 'json': {
        const toJSON = toJSONFor(type);
        const jsonValue = toJSON(value);
        await print(JSON.stringify(jsonValue, null, 2));
        break;
      }
    }
  } catch (err) {
    exitError(err instanceof IncompleteOutputError ? err.message : formatError(err));
  }
}
