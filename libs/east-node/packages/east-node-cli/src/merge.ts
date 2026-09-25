/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The blob merge behind `east-node merge` (issue #770).
 *
 * Canonical Set or Dict collections of one type in — sorted, indexed beast2 v5
 * blobs, as every runner writes them, or manifest directories, as e3 stages a
 * stored collection — and one canonical blob out, merged by the library's
 * `mergeBeast2For`: every input is read segment by segment through positioned
 * reads, and the output is written through the canonical element writer, so
 * the file is byte-identical to what `run --emit` writes for the same entries
 * emitted ascending. Memory is one decoded segment per input plus one open
 * output segment; no temporary file is ever written. This module is the
 * command around the merge: it opens and checks the inputs, reads the key
 * range and loads the fold, refusing each in the words east-c and east-py use.
 *
 * Equal keys across inputs fold in input order: with a merge function (Dict
 * inputs) `acc = merge(key, acc, value)`; in union mode (Set inputs) the
 * first element stands. Without a fold, an equal key is the duplicate error
 * the emit sink raises. An input whose keys do not ascend, an input whose
 * type is not input 0's, and an Array input are refused.
 *
 * With a key range (`--range`, a blob of `Struct{from: Option<K>, to:
 * Option<K>}` over the inputs' key type) only the keys in `[from, to)`
 * merge: every input is sought to the segment owning `from` through its
 * fences and read up to the first key at or past `to`, so a unit over a
 * range of a large output reads that range's share of each input, plus at
 * most one segment. An absent bound is open; both absent is the whole merge.
 *
 * This is the fan-in of a partitioned task's keyed partials: e3 runs it as an
 * ordinary execution on the task's runner, one unit per key range of a group
 * of partials, and never decodes a partial itself. east-c and east-py merge
 * through the same contract, so the three runners write the same bytes.
 */

import { closeSync, fstatSync, openSync, readFileSync, readSync, statSync } from 'fs';
import {
    OptionType,
    StructType,
    decodeBeast2For,
    fromEastTypeValue,
    isTypeValueEqual,
    mergeBeast2For,
    readBeast2Extents,
    readBeast2HeaderType,
    readBeast2Manifest,
    readBeast2Type,
    toEastTypeValue,
    type Beast2ManifestSink,
    type Beast2ManifestSource,
    type Beast2SyncRangeReader,
    type CollectionManifest,
} from '@elaraai/east';
import type { EastTypeValue, PlatformFunction } from '@elaraai/east/internal';
import { printTypeValue } from '@elaraai/east/internal';
import { writeAll } from './emit-writer.js';
import { segmentDirFor } from './loader.js';
import { formatFileSize, loadMergeFunction } from './runner.js';

/** Options accepted by {@link mergeBlobs}. */
export interface MergeBlobsOptions {
    /** Dict inputs: an IR file (any format the IR positional accepts) holding
     *  a `(K, V, V) -> V` East function over the inputs' key and value types,
     *  compiled with `platformFns`. Equal keys fold with it in input order. */
    mergePath?: string;
    /** Set inputs: the first of equal elements stands. */
    union?: boolean;
    /** A beast2 blob of `Struct{from: Option<K>, to: Option<K>}` over the
     *  inputs' key type: only the keys in `[from, to)` merge; an absent
     *  bound is open. */
    rangePath?: string;
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

/** The keys a merge covers: `[from, to)`, a bound `undefined` when open —
 *  East values are never `undefined`. */
interface KeyRange {
    from: unknown;
    to: unknown;
}

/** An input opened and checked: its type, and what the merge reads it
 *  through — positioned reads on its descriptor, which `close` releases, or
 *  the segments of a manifest directory. */
interface OpenedInput {
    type: EastTypeValue;
    source: Beast2SyncRangeReader | Beast2ManifestSource;
    close: () => void;
}

/** Exactly `length` bytes of the file open as `fd`, from `offset`. */
function readExactly(fd: number, offset: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    let done = 0;
    while (done < length) {
        const n = readSync(fd, out, done, length - done, offset + done);
        if (n === 0) throw new Error(`beast2: short read at offset ${offset + done}`);
        done += n;
    }
    return out;
}

/**
 * The segments of the manifest directory at `path`, each read through
 * positioned reads on its file in `<path>.segments/`, the convention e3 stages
 * inputs in. A segment's file is opened for each read and closed after it, so
 * a merge of a large manifest holds no descriptor per segment.
 *
 * @param path - the manifest's file
 * @param manifest - its decoded manifest
 * @returns the source the merge reads the input through
 */
function manifestSource(path: string, manifest: CollectionManifest): Beast2ManifestSource {
    const dir = segmentDirFor(path);
    return {
        manifest,
        segment(i) {
            const file = `${dir}/${manifest.entries[i]!.hash}.beast2`;
            let size: number;
            try {
                size = statSync(file).size;
            } catch {
                throw new Error(`beast2 v5: manifest segment ${file} cannot be read`);
            }
            return {
                size,
                read(offset, length) {
                    const fd = openSync(file, 'r');
                    try {
                        return readExactly(fd, offset, length);
                    } finally {
                        closeSync(fd);
                    }
                },
            };
        },
    };
}

/**
 * Opens input `index` at `path` and checks it is a canonical Set or Dict
 * collection of `expected`'s type: a blob, read through positioned reads on
 * its descriptor, or a manifest directory, read through its segment files.
 *
 * @param path - the blob, or the manifest's file
 * @param index - the input's position, for messages
 * @param expected - input 0's type, or `null` for input 0 itself
 * @returns the opened input and its type
 * @throws {Error} When the file cannot be opened (missing, unreadable, not
 *   a regular file), is not a blob (too short, or without the magic — the
 *   reader's own words), cannot be read as a canonical collection blob or a
 *   manifest, or its type is not `expected`.
 */
function openInput(path: string, index: number, expected: EastTypeValue | null): OpenedInput {
    let fd: number;
    let size: number;
    try {
        fd = openSync(path, 'r');
    } catch {
        throw new Error(`merge: input ${index} (${path}): cannot open the file`);
    }
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile()) throw new Error('not a regular file');
        size = stat.size;
    } catch {
        closeSync(fd);
        throw new Error(`merge: input ${index} (${path}): cannot open the file`);
    }
    const reader: Beast2SyncRangeReader = { size, read: (offset, length) => readExactly(fd, offset, length) };
    let manifest: CollectionManifest | null;
    let type: EastTypeValue;
    let selfContained: boolean;
    try {
        // The header first: a file too short for a blob, or one without the
        // magic, is refused in the reader's words — the sentence east-c and
        // east-py give for the same bytes — before the index is looked for.
        readBeast2HeaderType(reader);
        // A manifest directory is the collection its manifest names, its
        // segments standalone blobs, each self-contained.
        manifest = readBeast2Manifest(reader);
        if (manifest !== null) {
            type = manifest.type;
            selfContained = true;
        } else {
            const extents = readBeast2Extents(reader);
            type = extents.typeValue;
            selfContained = extents.selfContained;
        }
    } catch (err) {
        closeSync(fd);
        throw new Error(`merge: input ${index} (${path}): ${(err as Error).message ?? String(err)}`);
    }
    let refusal: string | null = null;
    if (expected !== null && !isTypeValueEqual(type, expected)) {
        refusal = `merge: input ${index} (${path}) has type ${printTypeValue(type)}, expected ${printTypeValue(expected)} (input 0)`;
    } else if (type.type !== 'Set' && type.type !== 'Dict') {
        refusal = `merge: inputs must be Set or Dict blobs, got ${type.type}`;
    } else if (!selfContained) {
        refusal = `merge: input ${index} (${path}): the blob is not self-contained`;
    }
    if (refusal !== null) {
        closeSync(fd);
        throw new Error(refusal);
    }
    if (manifest === null) return { type, source: reader, close: () => closeSync(fd) };
    // The manifest is read; the segments are read from their own files.
    closeSync(fd);
    return { type, source: manifestSource(path, manifest), close: () => {} };
}

/**
 * Reads a `--range` blob: `Struct{from: Option<K>, to: Option<K>}` over the
 * inputs' key type, self-describing, checked against that type.
 *
 * @param path - the blob
 * @param keyType - the inputs' key (Dict) or element (Set) type
 * @returns the bounds, an absent one `undefined`
 * @throws {Error} When the file cannot be opened or read as a beast2 blob,
 *   or its type is not the bounds struct over the inputs' key type.
 */
function readRange(path: string, keyType: EastTypeValue): KeyRange {
    let bytes: Uint8Array;
    try {
        bytes = new Uint8Array(readFileSync(path));
    } catch {
        throw new Error(`merge: --range (${path}): cannot open the file`);
    }
    // The same shape east-c builds (merge.c) and e3-core writes
    // (execution/steps.ts): the bounds struct over the key type.
    const key = fromEastTypeValue(keyType);
    const rangeType = toEastTypeValue(StructType({ from: OptionType(key), to: OptionType(key) }));
    let type: EastTypeValue;
    try {
        type = readBeast2Type(bytes);
    } catch (err) {
        throw new Error(`merge: --range (${path}): ${(err as Error).message ?? String(err)}`);
    }
    if (!isTypeValueEqual(type, rangeType)) {
        throw new Error(`merge: --range (${path}) has type ${printTypeValue(type)}, expected ${printTypeValue(rangeType)} (bounds over the inputs' key type)`);
    }
    let bounds: { from: { type: string; value: unknown }; to: { type: string; value: unknown } };
    try {
        bounds = decodeBeast2For(rangeType)(bytes) as typeof bounds;
    } catch (err) {
        throw new Error(`merge: --range (${path}): ${(err as Error).message ?? String(err)}`);
    }
    return {
        from: bounds.from.type === 'some' ? bounds.from.value : undefined,
        to: bounds.to.type === 'some' ? bounds.to.value : undefined,
    };
}

/**
 * Merges sorted Set or Dict blobs of one type into one canonical collection —
 * the `merge` command, and an `exec` merge unit's set or dict parts.
 *
 * @param inputPaths - the inputs, in the order equal keys fold; at least one
 * @param output - the output blob's path, or the sink a manifest directory is
 *   written through
 * @param options - the fold, its platforms, the key range, verbosity
 * @returns the account: inputs merged, entries written, keys folded
 * @throws {Error} With the merge's message — an input of another type than
 *   input 0's, an Array input, keys that do not ascend, a fold whose
 *   signature does not match the inputs, a range blob of another shape than
 *   the bounds over the inputs' key type, a file that cannot be opened, a
 *   shared key without a fold — leaving the output unfinalised (no
 *   terminator or index, or no manifest).
 */
export function mergeBlobs(inputPaths: readonly string[], output: string | Beast2ManifestSink, options: MergeBlobsOptions = {}): MergeBlobsStats {
    const started = performance.now();
    if (inputPaths.length === 0) throw new Error('merge: at least one input is needed');
    if (options.mergePath !== undefined && options.union) {
        throw new Error('merge: --merge and --union are two folds — give one');
    }
    const opened: OpenedInput[] = [];
    let fd = -1;
    let stats: MergeBlobsStats;
    try {
        const first = openInput(inputPaths[0]!, 0, null);
        opened.push(first);
        const type = first.type;
        const dict = type.type === 'Dict';
        if (options.mergePath !== undefined && !dict) throw new Error('--merge applies to Dict inputs only');
        if (options.union && dict) throw new Error('--union applies to Set inputs only');
        const keyType = (dict ? (type as any).value.key : (type as any).value) as EastTypeValue;
        const merge = options.mergePath !== undefined
            ? loadMergeFunction(options.mergePath, keyType, (type as any).value.value as EastTypeValue, options.platformFns ?? [], 'the inputs')
            : undefined;
        const range = options.rangePath !== undefined ? readRange(options.rangePath, keyType) : { from: undefined, to: undefined };
        for (let i = 1; i < inputPaths.length; i++) opened.push(openInput(inputPaths[i]!, i, type));

        stats = mergeBeast2For(type, {
            ...(merge !== undefined && { merge }),
            union: options.union ?? false,
            from: range.from,
            to: range.to,
            labels: inputPaths,
            // Frames deflate on worker threads (#763).
            parallel: true,
        })(opened.map((input) => input.source), typeof output !== 'string' ? output : (bytes) => {
            // The output is created with its first bytes, which the merge
            // writes once every input has opened, so a refused input leaves
            // no file behind.
            if (fd < 0) fd = openSync(output, 'w');
            writeAll(fd, bytes);
        });
    } finally {
        for (const input of opened) input.close();
        if (fd >= 0) closeSync(fd);
    }
    if (options.verbose) {
        console.error(`merge: ${stats.inputs} input(s), ${stats.entries} entries, ${stats.folds} fold(s)`);
        if (typeof output === 'string') console.error(`Output: ${output}  (${formatFileSize(output)})`);
        console.error('\nTiming:');
        console.error(`  Total:    ${(performance.now() - started).toFixed(1).padStart(8)} ms`);
    }
    return stats;
}
