/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The blob merge behind `east-node merge` (issue #770).
 *
 * Canonical Set or Dict blobs of one type in — sorted, indexed beast2 v5
 * collections, as every runner writes them — and one canonical blob out, in
 * a single pass: every input is read segment by segment through positioned
 * reads on its descriptor, a heap over the inputs' current entries yields
 * keys in East order, and the output is written through the same segment
 * writer as `run --emit`, so the file is byte-identical to what that sink
 * writes for the same entries emitted ascending. Memory is one decoded
 * segment per input plus one open batch; no temporary file is ever written.
 *
 * Equal keys across inputs fold in input order: with a merge function (Dict
 * inputs) `acc = merge(key, acc, value)`; in union mode (Set inputs) the
 * first element stands. Without a fold, an equal key is the duplicate error
 * the emit sink raises. An input whose keys do not ascend, an input whose
 * type is not input 0's, and an Array input are refused.
 *
 * This is the fan-in of a partitioned task's keyed partials: e3 runs it as an
 * ordinary execution on the task's runner, one unit per group of partials,
 * and never decodes a partial itself. east-c and east-py merge through the
 * same contract, so the three runners write the same bytes.
 */

import { closeSync, fstatSync, openSync, readSync } from 'fs';
import {
    compareFor,
    isTypeValueEqual,
    openBeast2LazyFor,
    printFor,
    readBeast2Extents,
    type Beast2SyncRangeReader,
} from '@elaraai/east';
import type { EastTypeValue, PlatformFunction } from '@elaraai/east/internal';
import { printTypeValue } from '@elaraai/east/internal';
import { EmitFileWriter } from './emit-writer.js';
import { duplicateMessage, formatFileSize, loadMergeFunction, type MergeFunction } from './runner.js';

/** Options accepted by {@link mergeBlobs}. */
export interface MergeBlobsOptions {
    /** Dict inputs: an IR file (any format the IR positional accepts) holding
     *  a `(K, V, V) -> V` East function over the inputs' key and value types,
     *  compiled with `platformFns`. Equal keys fold with it in input order. */
    mergePath?: string;
    /** Set inputs: the first of equal elements stands. */
    union?: boolean;
    /** The platforms the merge function compiles with. */
    platformFns?: PlatformFunction[];
    /** Print the account and timing on stderr. */
    verbose?: boolean;
}

/** What a merge came to. */
export interface MergeBlobsStats {
    /** Inputs merged. */
    inputs: number;
    /** Entries written to the output. */
    entries: number;
    /** Equal keys folded (merge) or collapsed (union). */
    folds: number;
}

/** One input: its current entry (`null` once exhausted) and how to advance. */
interface MergeInput {
    head: { key: unknown; value: unknown } | null;
    advance: () => void;
    close: () => void;
}

/**
 * Opens input `index` at `path`: reads its geometry and type, and prepares a
 * segment-by-segment iteration of its entries.
 *
 * @param path - the blob
 * @param index - the input's position, for messages
 * @param expected - input 0's type, or `null` for input 0 itself
 * @returns the input, positioned before its first entry, and its type
 * @throws {Error} When the file cannot be opened or read as a canonical
 *   collection blob, or its type is not `expected`.
 */
function openInput(path: string, index: number, expected: EastTypeValue | null): { input: MergeInput; type: EastTypeValue } {
    let fd: number;
    try {
        fd = openSync(path, 'r');
    } catch {
        throw new Error(`merge: input ${index} (${path}): cannot open the file`);
    }
    const reader: Beast2SyncRangeReader = {
        size: fstatSync(fd).size,
        read(offset, length) {
            const out = new Uint8Array(length);
            let done = 0;
            while (done < length) {
                const n = readSync(fd, out, done, length - done, offset + done);
                if (n === 0) throw new Error(`beast2: short read at offset ${offset + done}`);
                done += n;
            }
            return out;
        },
    };
    const prefixed = (err: unknown): Error =>
        new Error(`merge: input ${index} (${path}): ${(err as Error).message ?? String(err)}`);
    let type: EastTypeValue;
    let iterator: Iterator<unknown>;
    try {
        const extents = readBeast2Extents(reader);
        type = extents.typeValue;
        if (expected !== null && !isTypeValueEqual(type, expected)) {
            closeSync(fd);
            throw new Error(`merge: input ${index} (${path}) has type ${printTypeValue(type)}, expected ${printTypeValue(expected)} (input 0)`);
        }
        if (type.type !== 'Set' && type.type !== 'Dict') {
            closeSync(fd);
            throw new Error(`merge: inputs must be Set or Dict blobs, got ${type.type}`);
        }
        if (!extents.selfContained) throw new Error('the blob is not self-contained');
        const lazy = openBeast2LazyFor(type, { frozen: true })(reader) as Map<unknown, unknown> | Set<unknown>;
        // The lazy value streams one decoded segment at a time, checking the
        // ascent within and across segments as the eager decoder does.
        iterator = type.type === 'Dict' ? (lazy as Map<unknown, unknown>).entries() : (lazy as Set<unknown>).keys();
    } catch (err) {
        const message = (err as Error).message ?? '';
        if (message.startsWith('merge: ')) throw err;
        closeSync(fd);
        throw prefixed(err);
    }
    const dict = type.type === 'Dict';
    const input: MergeInput = {
        head: null,
        advance: () => {
            let next: IteratorResult<unknown>;
            try {
                next = iterator.next();
            } catch (err) {
                throw prefixed(err);
            }
            if (next.done) {
                input.head = null;
            } else if (dict) {
                const [key, value] = next.value as [unknown, unknown];
                input.head = { key, value };
            } else {
                input.head = { key: next.value, value: undefined };
            }
        },
        close: () => closeSync(fd),
    };
    return { input, type };
}

/**
 * Merges sorted Set or Dict blobs of one type into one canonical blob — the
 * `merge` command.
 *
 * @param inputPaths - the inputs, in the order equal keys fold; at least one
 * @param outputPath - the output blob
 * @param options - the fold, its platforms, verbosity
 * @returns the account: inputs merged, entries written, keys folded
 * @throws {Error} With the merge's message — an input of another type than
 *   input 0's, an Array input, keys that do not ascend, a fold whose
 *   signature does not match the inputs, a file that cannot be opened, a
 *   shared key without a fold — leaving the output unfinalised (no
 *   terminator or index).
 */
export function mergeBlobs(inputPaths: readonly string[], outputPath: string, options: MergeBlobsOptions = {}): MergeBlobsStats {
    const started = performance.now();
    if (inputPaths.length === 0) throw new Error('merge: at least one input is needed');
    if (options.mergePath !== undefined && options.union) {
        throw new Error('merge: --merge and --union are two folds — give one');
    }
    const inputs: MergeInput[] = [];
    let out: EmitFileWriter | null = null;
    let finished = false;
    try {
        const first = openInput(inputPaths[0]!, 0, null);
        inputs.push(first.input);
        const type = first.type;
        const kind = type.type === 'Dict' ? 'dict' : 'set';
        if (options.mergePath !== undefined && kind !== 'dict') throw new Error('--merge applies to Dict inputs only');
        if (options.union && kind !== 'set') throw new Error('--union applies to Set inputs only');
        const keyType = (kind === 'dict' ? (type as any).value.key : (type as any).value) as EastTypeValue;
        const valueType = (kind === 'dict' ? (type as any).value.value : null) as EastTypeValue | null;
        const merge: MergeFunction | null = options.mergePath !== undefined
            ? loadMergeFunction(options.mergePath, keyType, valueType!, options.platformFns ?? [], 'the inputs')
            : null;
        const union = options.union ?? false;
        for (let i = 1; i < inputPaths.length; i++) inputs.push(openInput(inputPaths[i]!, i, type).input);

        const cmp = compareFor(keyType as any) as (a: unknown, b: unknown) => number;
        const printKey = printFor(keyType as any) as (v: unknown) => string;
        for (const input of inputs) input.advance();

        // A binary min-heap over the inputs' current keys, ordered by (key,
        // input index), so equal keys leave in input order.
        const heap: number[] = [];
        for (let i = 0; i < inputs.length; i++) if (inputs[i]!.head !== null) heap.push(i);
        const before = (a: number, b: number): boolean => {
            const order = cmp(inputs[a]!.head!.key, inputs[b]!.head!.key);
            return order < 0 || (order === 0 && a < b);
        };
        const siftDown = (at: number): void => {
            for (;;) {
                const l = 2 * at + 1;
                const r = l + 1;
                let least = at;
                if (l < heap.length && before(heap[l]!, heap[least]!)) least = l;
                if (r < heap.length && before(heap[r]!, heap[least]!)) least = r;
                if (least === at) return;
                [heap[at], heap[least]] = [heap[least]!, heap[at]!];
                at = least;
            }
        };
        for (let i = (heap.length >> 1) - 1; i >= 0; i--) siftDown(i);

        out = new EmitFileWriter(kind, type, outputPath);
        let entries = 0;
        let folds = 0;
        // The current key's entry is held until a greater key arrives, so
        // every equal key folds into it before it is written.
        let held: { key: unknown; value: unknown } | null = null;
        const put = (entry: { key: unknown; value: unknown }): void => {
            out!.push(kind === 'dict' ? [entry.key, entry.value] : entry.key);
            entries++;
        };
        while (heap.length > 0) {
            const input = inputs[heap[0]!]!;
            const { key, value } = input.head!;
            if (held !== null && cmp(held.key, key) === 0) {
                if (merge !== null) {
                    held.value = merge(key, held.value, value);
                } else if (!union) {
                    throw new Error(duplicateMessage(kind, printKey, key));
                }
                folds++;
            } else {
                if (held !== null) put(held);
                held = { key, value };
            }
            input.advance();
            if (input.head === null) {
                heap[0] = heap[heap.length - 1]!;
                heap.pop();
            }
            if (heap.length > 0) siftDown(0);
        }
        if (held !== null) put(held);
        out.finishClose();
        finished = true;

        const stats = { inputs: inputs.length, entries, folds };
        if (options.verbose) {
            console.error(`merge: ${stats.inputs} input(s), ${stats.entries} entries, ${stats.folds} fold(s)`);
            console.error(`Output: ${outputPath}  (${formatFileSize(outputPath)})`);
            console.error('\nTiming:');
            console.error(`  Total:    ${(performance.now() - started).toFixed(1).padStart(8)} ms`);
        }
        return stats;
    } finally {
        for (const input of inputs) input.close();
        if (out !== null && !finished) out.closeAbandoned();
    }
}
