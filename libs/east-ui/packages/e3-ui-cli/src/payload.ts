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

/** Recognised input formats. `ts` covers `.ts` and `.tsx`. */
export type InputFormat = 'ts' | 'beast2' | 'json';

/** A resolved component input. `path: null` reads from stdin. */
export interface ShotInput {
    path: string | null;
    from?: InputFormat | undefined;
    exportName?: string | undefined;
}

/** A standalone component to render: base64 Beast2-encoded function IR
 *  (consumed in-browser by `EncodedEastFunction`). */
export interface ComponentPayload {
    kind: 'component';
    b64: string;
}

/** A live e3 task to render: the browser fetches its already-computed output +
 *  bound datasets from the server (consumed by `TaskPreview`). */
export interface TaskPayload {
    kind: 'task';
    apiUrl: string;
    repo: string;
    workspace: string;
    task: string;
}

/** The render payload injected into the browser app as `window.__E3_UI_SHOT__`. */
export type ShotPayload = ComponentPayload | TaskPayload;

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
 *   failure, or when serialized bytes are not valid component IR
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
            // Validate it really is component IR so a value/wrong file fails clearly.
            try {
                decodeEastIR(bytes);
            } catch (err) {
                throw new Error(
                    `Input is not valid component IR (a Beast2-encoded zero-arg East UI function). ` +
                    `Evaluated-value and live-task inputs are not yet supported. ` +
                    `Cause: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
            break;
        }
        case 'json': {
            const text = input.path
                ? await readFile(input.path, 'utf8')
                : Buffer.from(await readStdin()).toString('utf8');
            const ir = fromJSONFor(IRType)(JSON.parse(text));
            bytes = encodeBeast2For(IRType)(ir);
            break;
        }
    }

    return { kind: 'component', b64: Buffer.from(bytes).toString('base64') };
}
