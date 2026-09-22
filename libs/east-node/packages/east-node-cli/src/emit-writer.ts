/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The segment writer behind `run --emit` and `merge` (issue #770).
 *
 * Entries arrive one at a time and go out as segments of a streaming beast2
 * writer on the output file: header at open, terminator and index at the
 * finish, so every finished file is a complete canonical blob. Where the
 * segments fall is `encodeBeast2PagedFor`'s decision, taken here on the same
 * terms, so a file written here segments exactly as that encoder segments the
 * same value: a Set or Dict is cut by the content-defined boundary rule, which
 * depends only on the keys and so agrees with every other writer of the value
 * on every runtime; an Array, which has no key to hash, is batched
 * byte-adaptively toward the segment target from what the writer has actually
 * emitted. Both commands write through this one class, which is what makes a
 * merge's output byte-identical to the sink's for the same entries. Memory is
 * one open batch whatever the output's size.
 */

import { closeSync, openSync, writeSync } from 'fs';
import { Beast2Writer, BEAST2_PAGED_BATCH_DEFAULT, BEAST2_PAGED_PROBE_BATCH, BEAST2_PAGED_TARGET_BYTES_DEFAULT, SegmentCutter, segmentKeyTypeOf } from '@elaraai/east';
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
    /** The content-defined boundary for a Set or Dict output; `null` for an
     *  Array, which is batched by bytes. */
    private readonly cutter: SegmentCutter | null;

    /**
     * Opens `path` for writing and emits the blob's header.
     *
     * @param kind - the collection kind
     * @param outType - the collection's wire type
     * @param path - the output file
     */
    constructor(private readonly kind: EmitKind, private readonly outType: EastTypeValue, path: string) {
        const keyType = segmentKeyTypeOf(outType);
        this.cutter = keyType === null ? null : new SegmentCutter(keyType);
        this.fd = openSync(path, 'w');
        // Frames deflate on worker threads (#763); the refinement below reads
        // the emitted bytes through the writer's bounds.
        this.writer = new Beast2Writer(outType, (bytes) => {
            writeAll(this.fd, bytes);
            if (this.headerBytes < 0) this.headerBytes = bytes.length;
        }, { parallel: true });
    }

    /**
     * Appends `entry` under the flush rule: the open batch goes out only now
     * that an entry which will not fold into it has arrived, so the batch's
     * last entry is always still open for a fold.
     *
     * A keyed output flushes when the arriving key starts a new segment under
     * the content rule; an Array flushes when the open batch reaches the
     * byte-adaptive size. An entry that folds into the last one never reaches
     * here, so the cutter sees each distinct key exactly once — which is what
     * makes this cut the same as the paged encoder's over the same value.
     *
     * @param entry - the element, or the `[key, value]` pair
     */
    push(entry: unknown): void {
        if (this.cutter !== null) {
            const key = this.kind === 'dict' ? (entry as [unknown, unknown])[0] : entry;
            if (this.cutter.startsSegment(key)) this.flush();
            this.batch.push(entry);
            return;
        }
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
        // A keyed output's boundaries come from the keys, so there is nothing
        // to refine — and nothing for the writer's emitted bytes to settle.
        if (this.cutter === null) this.nextBatch = this.refineNext();
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
