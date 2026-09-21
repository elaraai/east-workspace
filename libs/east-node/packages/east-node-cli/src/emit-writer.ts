/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The segment writer behind `run --emit` and `merge` (issue #770).
 *
 * Entries arrive one at a time and go out as segments of a streaming beast2
 * writer on the output file: header at open, terminator and index at the
 * finish, so every finished file is a complete canonical blob. Batches are
 * re-sized byte-adaptively toward the paged-encode segment target from what
 * the writer has actually emitted — the refinement `encodeBeast2PagedFor`
 * applies, so a file written here segments exactly as that encoder segments
 * the same value. Both commands write through this one class, which is what
 * makes a merge's output byte-identical to the sink's for the same entries.
 * Memory is one open batch whatever the output's size.
 */

import { closeSync, openSync, writeSync } from 'fs';
import { Beast2Writer, BEAST2_PAGED_BATCH_DEFAULT, BEAST2_PAGED_PROBE_BATCH, BEAST2_PAGED_TARGET_BYTES_DEFAULT } from '@elaraai/east';
import type { EastTypeValue } from '@elaraai/east/internal';

/** Writes all of `bytes` to `fd` — `writeSync` may write fewer bytes than
 *  asked, and a silently short write would corrupt the file. */
function writeAll(fd: number, bytes: Uint8Array): void {
    let written = 0;
    while (written < bytes.length) {
        written += writeSync(fd, bytes, written, bytes.length - written);
    }
}

/** The output collection kind an emit writer batches for. */
export type EmitKind = 'array' | 'set' | 'dict';

/**
 * A streaming, byte-adaptively batched writer of one canonical collection
 * blob. Entries are elements (Array and Set) or `[key, value]` pairs (Dict).
 */
export class EmitFileWriter {
    private readonly fd: number;
    private readonly writer: Beast2Writer;
    private headerBytes = -1;
    private batch: unknown[] = [];
    private written = 0;
    private nextBatch = BEAST2_PAGED_BATCH_DEFAULT;
    private probed = false;

    /**
     * Opens `path` for writing and emits the blob's header.
     *
     * @param kind - the collection kind
     * @param outType - the collection's wire type
     * @param path - the output file
     */
    constructor(private readonly kind: EmitKind, private readonly outType: EastTypeValue, path: string) {
        this.fd = openSync(path, 'w');
        // Frames deflate on worker threads (#763); the refinement below reads
        // the emitted bytes through the writer's bounds.
        this.writer = new Beast2Writer(outType, (bytes) => {
            writeAll(this.fd, bytes);
            if (this.headerBytes < 0) this.headerBytes = bytes.length;
        }, { parallel: true });
    }

    /**
     * Appends `entry` under the flush rule: a full batch goes out only now
     * that an entry which will not fold into it has arrived, so the batch's
     * last entry is always still open for a fold.
     *
     * @param entry - the element, or the `[key, value]` pair
     */
    push(entry: unknown): void {
        if (this.batch.length >= this.nextBatch) this.flush();
        this.batch.push(entry);
        this.probe();
    }

    /**
     * Seeds the batch size from a throwaway encode of the first entries, as
     * `encodeBeast2PagedFor` does — the same probe, over the same count, so
     * one value segments the same whether it was returned or emitted.
     *
     * Opening at the element cap instead made the first segment as many
     * elements as the cap whatever they weighed: for rows above the target's
     * share that is one oversized segment and every later boundary shifted,
     * so the same Dict written both ways hashed differently. The probed
     * entries are then drained through the refined size, exactly as the
     * paged encoder pumps its own probe.
     */
    private probe(): void {
        if (this.probed || this.batch.length < BEAST2_PAGED_PROBE_BATCH) return;
        this.probed = true;
        let scratchBytes = 0;
        const scratch = new Beast2Writer(this.outType, (bytes) => { scratchBytes += bytes.length; });
        const scratchHeader = scratchBytes;
        scratch.write(this.toValue(this.batch) as never);
        const avg = Math.max(1, (scratchBytes - scratchHeader) / this.batch.length);
        this.nextBatch = Math.max(1, Math.min(BEAST2_PAGED_BATCH_DEFAULT, Math.floor(BEAST2_PAGED_TARGET_BYTES_DEFAULT / avg)));
        if (this.nextBatch >= this.batch.length) return;
        // Wider than one probe batch: the entries held so far go out in
        // refined-size segments, which is what the paged encoder writes.
        const buffered = this.batch;
        this.batch = [];
        for (const item of buffered) {
            if (this.batch.length >= this.nextBatch) this.flush();
            this.batch.push(item);
        }
    }

    /**
     * Replaces the open batch's last entry — where an adjacent equal key's
     * fold lands.
     *
     * @param update - maps the last entry to its folded form
     */
    foldLast(update: (last: unknown) => unknown): void {
        const at = this.batch.length - 1;
        this.batch[at] = update(this.batch[at]);
    }

    /** Writes the open batch and finalizes the blob (terminator + index). */
    finishClose(): void {
        this.flush();
        this.writer.finish();
        closeSync(this.fd);
    }

    /** Closes the file without finalizing it — after an error, the partial
     *  output carries no terminator or index. */
    closeAbandoned(): void {
        closeSync(this.fd);
    }

    private flush(): void {
        if (this.batch.length === 0) return;
        this.writer.write(this.toValue(this.batch) as never);
        this.written += this.batch.length;
        this.batch = [];
        this.nextBatch = this.refineNext();
    }

    private toValue(items: unknown[]): unknown {
        return this.kind === 'dict' ? new Map(items as [unknown, unknown][]) : this.kind === 'set' ? new Set(items) : items;
    }

    /** The batch size the paged encoder would choose after `bytes` of body
     *  for `this.written` elements. */
    private refine(bytes: number): number {
        const avg = Math.max(1, Math.max(1, bytes - Math.max(0, this.headerBytes)) / this.written);
        return Math.max(1, Math.min(BEAST2_PAGED_BATCH_DEFAULT, Math.floor(BEAST2_PAGED_TARGET_BYTES_DEFAULT / avg)));
    }

    /** The next batch size. With frames deflating on workers the bytes
     *  written are only known within bounds; the refinement is monotone in
     *  them, so agreeing bounds are the serial decision and disagreeing ones
     *  wait for the frames — the segmentation never depends on timing. */
    private refineNext(): number {
        const { lo, hi } = this.writer.emittedBounds();
        const next = this.refine(lo);
        if (next === this.refine(hi)) return next;
        this.writer.settle();
        return this.refine(this.writer.emittedBounds().lo);
    }
}
