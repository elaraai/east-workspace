/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The blob merge behind an `exec` merge unit (issue #770), over this
 * machine's files.
 *
 * The merge is east's `mergeUnitParts`, which `executeUnit` runs for a merge
 * unit's set and dict parts: canonical Set or Dict collections of one type in —
 * sorted, indexed beast2 v5 blobs, or manifest directories, as a unit's parts
 * are staged — and one canonical collection out, byte-identical to what the
 * canonical element writer writes for the merged value, read segment by
 * segment and refused in the words east-c and east-py use. This is its file
 * wrapper: the parts are files, and the output a blob file or a manifest
 * directory's sink.
 */

import { closeSync, openSync, writeSync } from 'fs';
import type { Beast2ManifestSink } from '@elaraai/east';
import type { PlatformFunction } from '@elaraai/east/internal';
import { mergeUnitParts } from '@elaraai/east/internal';
import { fetchingSegments, nodeUnitIO } from './loader.js';

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

/** Writes all of `bytes` to `fd` — `writeSync` may write fewer bytes than
 *  asked, and a silently short write would corrupt the file. */
function writeAll(fd: number, bytes: Uint8Array): void {
    let written = 0;
    while (written < bytes.length) {
        written += writeSync(fd, bytes, written, bytes.length - written);
    }
}

/**
 * Merges sorted Set or Dict blobs of one type into one canonical collection —
 * an `exec` merge unit's set or dict parts.
 *
 * @remarks
 * A manifest input's segment the process's host places as it is read
 * ({@link fetchingSegments}) is asked for when the merge first reads it.
 *
 * @param inputPaths - the inputs, in the order equal keys fold; at least one
 * @param output - the output blob's path, or the sink a manifest directory is
 *   written through
 * @param options - the fold, its platforms, the key range
 * @returns the account: inputs merged, entries written, keys folded
 * @throws {Error} With the merge's message — an input of another type than
 *   input 0's, an Array input, keys that do not ascend, a fold whose
 *   signature does not match the inputs, a range blob of another shape than
 *   the bounds over the inputs' key type, a file that cannot be opened, a
 *   shared key without a fold — leaving the output unfinalised (no
 *   terminator or index, or no manifest).
 */
export function mergeBlobs(inputPaths: readonly string[], output: string | Beast2ManifestSink, options: MergeBlobsOptions = {}): MergeBlobsStats {
    let fd = -1;
    try {
        return mergeUnitParts(nodeUnitIO, inputPaths, typeof output !== 'string' ? output : (bytes) => {
            // The output is created with its first bytes, which the merge
            // writes once every input has opened, so a refused input leaves
            // no file behind.
            if (fd < 0) fd = openSync(output, 'w');
            writeAll(fd, bytes);
        }, {
            ...(options.mergePath !== undefined && { merge: options.mergePath }),
            ...(options.union !== undefined && { union: options.union }),
            ...(options.rangePath !== undefined && { range: options.rangePath }),
            ...(options.platformFns !== undefined && { platforms: options.platformFns }),
            fetch: fetchingSegments(),
        });
    } finally {
        if (fd >= 0) closeSync(fd);
    }
}
