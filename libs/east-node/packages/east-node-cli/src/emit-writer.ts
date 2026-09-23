/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The segment writer behind `run --emit` and `merge` (issue #770).
 *
 * Entries arrive one at a time and go out through the library's canonical
 * writer (`Beast2ElementWriter`) onto the output file: header at open,
 * terminator and index at the finish, so every finished file is a complete
 * canonical blob, cut where the content-defined rule cuts it — which is where
 * every writer of the same value cuts it, on every runtime. Both commands
 * write through this one class, which is what makes a merge's output
 * byte-identical to the sink's for the same entries. Memory is one open
 * segment whatever the output's size.
 */

import { closeSync, openSync, writeSync } from 'fs';
import { Beast2ElementWriter } from '@elaraai/east';
import type { EastTypeValue } from '@elaraai/east/internal';

/** Writes all of `bytes` to `fd` — `writeSync` may write fewer bytes than
 *  asked, and a silently short write would corrupt the file. */
function writeAll(fd: number, bytes: Uint8Array): void {
    let written = 0;
    while (written < bytes.length) {
        written += writeSync(fd, bytes, written, bytes.length - written);
    }
}

/** The output collection kind an emit sink writes. */
export type EmitKind = 'array' | 'set' | 'dict';

/**
 * A streaming writer of one canonical collection blob to a file. Entries are
 * elements (Array and Set) or `[key, value]` pairs (Dict), in canonical order.
 */
export class EmitFileWriter {
    private readonly fd: number;
    private readonly writer: Beast2ElementWriter;
    /** The last entry, held back until the next one arrives, so an equal
     *  key's fold can still land in it. */
    private last: unknown;
    private hasLast = false;

    /**
     * Opens `path` for writing and emits the blob's header.
     *
     * @param outType - the collection's wire type
     * @param path - the output file
     */
    constructor(outType: EastTypeValue, path: string) {
        this.fd = openSync(path, 'w');
        // Frames deflate on worker threads (#763).
        this.writer = new Beast2ElementWriter(outType, (bytes) => writeAll(this.fd, bytes), { parallel: true });
    }

    /**
     * Appends `entry`, writing out the entry before it.
     *
     * @param entry - the element, or the `[key, value]` pair
     */
    push(entry: unknown): void {
        if (this.hasLast) this.writer.add(this.last);
        this.last = entry;
        this.hasLast = true;
    }

    /**
     * Replaces the last entry — where an adjacent equal key's fold lands.
     *
     * @param update - maps the last entry to its folded form
     */
    foldLast(update: (last: unknown) => unknown): void {
        this.last = update(this.last);
    }

    /** Writes the last entry and finalizes the blob (terminator + index). */
    finishClose(): void {
        if (this.hasLast) this.writer.add(this.last);
        this.hasLast = false;
        this.writer.finish();
        closeSync(this.fd);
    }

    /** Closes the file without finalizing it — after an error, the partial
     *  output carries no terminator or index. */
    closeAbandoned(): void {
        closeSync(this.fd);
    }
}
