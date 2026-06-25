/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Normalise a component input into the render payload the browser app consumes.
 *
 * Every accepted input is reduced to Beast2-encoded **function IR** (base64) —
 * the exact form `EncodedEastFunction` (`@elaraai/east-ui-components`) decodes
 * via `decodeBeast2For(IRType)` and compiles in-browser. The Node→browser
 * serialization boundary decouples the two `@elaraai/east` instances.
 *
 * Format is auto-detected from the file extension (mirroring `e3 convert` /
 * `e3 dataset set`), with an explicit `--from` override.
 *
 * @packageDocumentation
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { encodeEastIR, fromJSONFor, decodeEastIR, encodeBeast2For, type EastIR } from '@elaraai/east';
import { IRType } from '@elaraai/east/internal';
import { loadComponentFromSource } from './load-source.js';

export type { ComponentPayload, TaskPayload, ShotPayload } from './shot-payload.js';
import type { ComponentPayload } from './shot-payload.js';

/** Recognised input formats. `ts` covers `.ts` and `.tsx`. */
export type InputFormat = 'ts' | 'beast2' | 'json';

/** A resolved component input. `path: null` reads from stdin. */
export interface ShotInput {
    path: string | null;
    from?: InputFormat | undefined;
    exportName?: string | undefined;
}

/** Detect the input format from a file extension. */
export function detectFormat(filePath: string): InputFormat {
    const ext = extname(filePath).toLowerCase();
    if (ext === '.ts' || ext === '.tsx') return 'ts';
    if (ext === '.beast2') return 'beast2';
    if (ext === '.json') return 'json';
    throw new Error(
        `Cannot detect format from extension "${ext}" (expected .ts/.tsx, .beast2, or .json) — pass --from`,
    );
}

/** Read all of stdin as bytes. */
async function readStdin(): Promise<Uint8Array> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Build the render payload from a component input.
 *
 * @param input - The resolved input (path/format/export)
 * @returns The base64 IR payload for the browser app
 * @throws If a `.ts`/`.tsx` source is read from stdin, on JSON/IR decode
 *   failure, or when the input is not a renderable East UI function
 */
export async function buildPayload(input: ShotInput): Promise<ComponentPayload> {
    const format = input.from ?? (input.path ? detectFormat(input.path) : 'beast2');
    let bytes: Uint8Array;

    switch (format) {
        case 'ts': {
            if (!input.path) {
                throw new Error('A TypeScript source cannot be read from stdin — pass a file path.');
            }
            const fn = await loadComponentFromSource(input.path, input.exportName);
            bytes = encodeEastIR(fn.toIR() as EastIR<unknown[], unknown>);
            break;
        }
        case 'beast2': {
            bytes = input.path ? new Uint8Array(await readFile(input.path)) : await readStdin();
            break;
        }
        case 'json': {
            const text = input.path
                ? await readFile(input.path, 'utf8')
                : Buffer.from(await readStdin()).toString('utf8');
            bytes = encodeBeast2For(IRType)(fromJSONFor(IRType)(JSON.parse(text)));
            break;
        }
    }

    // Uniform validation across all three formats: decodeEastIR throws unless the
    // root IR is a (sync) Function — catching an async function, non-function IR
    // JSON, and an evaluated-value / corrupt .beast2 alike, with one clear Node-side
    // message instead of a confusing in-browser compile failure.
    try {
        decodeEastIR(bytes);
    } catch (err) {
        throw new Error(
            `Input is not a renderable component — expected a Beast2/JSON-encoded zero-argument East UI function. ` +
            `(Async functions, non-function IR, and evaluated values are not supported.) ` +
            `Cause: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    return { kind: 'component', b64: Buffer.from(bytes).toString('base64') };
}
