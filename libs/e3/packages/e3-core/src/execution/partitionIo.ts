/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Bounded-memory blob IO for partitioned execution (issue #506).
 *
 * The byte-geometry layer is IO-agnostic — extents need only a blob's head
 * and tail, a carve copies segment-frame ranges, a splice concatenates them
 * under one header and a rebuilt index. This module supplies the IO to match:
 * a {@link PartitionBlob} addresses a stored blob through ranged reads
 * (extents from head + tail, boundary probes as single-segment decodes), and
 * slices/spliced outputs stream to the object store chunk by chunk through
 * {@link spliceChunks} — the orchestrator holds one chunk, one decoded
 * boundary segment, or one edge rebuild at a time, never a whole blob.
 *
 * Backends without `objects.readRange` degrade to one whole read per blob
 * behind the same interface, so the executor has a single code path.
 */

import {
  openBeast2PagesFor,
  readBeast2Extents,
  readBeast2ExtentsRanged,
  carveBeast2Ranged,
  spliceBeast2Tail,
  type Beast2Pages,
  type Beast2RangedExtents,
} from '@elaraai/east';
import type { StorageBackend } from '../storage/interfaces.js';

/** Bytes per range-read → write-stream copy chunk. */
export const PARTITION_COPY_CHUNK_BYTES = 8 * 1024 * 1024;

/** The decoded segments open {@link PartitionBlob}s hold now, and the most
 *  they have held at once since the peak was last reset. */
const decodedSegments = { held: 0, peak: 0 };

/**
 * The most decoded segments open {@link PartitionBlob}s have held at once
 * since {@link resetDecodedSegmentPeak} — the orchestrator's memory claim for
 * partitioned execution, counted for specs.
 *
 * @returns The peak number of decoded segments held at once
 * @internal
 */
export function decodedSegmentPeak(): number {
  return decodedSegments.peak;
}

/**
 * Starts a new peak of {@link decodedSegmentPeak} from the segments held now.
 *
 * @internal
 */
export function resetDecodedSegmentPeak(): void {
  decodedSegments.peak = decodedSegments.held;
}

/** The end offset of segment `i`'s frame. */
function segmentEnd(extents: Beast2RangedExtents, i: number): number {
  return i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd;
}

/**
 * A stored, segmented blob opened for bounded-memory partitioned access.
 *
 * Construction reads only the blob's head and tail (or, on a backend without
 * ranged reads, the blob once); every subsequent operation is O(segment) or
 * O(chunk).
 */
export class PartitionBlob {
  /** One-segment probe cache: boundary alignment reads a segment's fence and
   *  then often its keys — decode it once. */
  private probe: { segment: number; pages: Beast2Pages } | null = null;

  private constructor(
    private readonly read: (offset: number, length: number) => Promise<Uint8Array>,
    /** The blob's byte geometry plus header bytes. */
    readonly extents: Beast2RangedExtents,
  ) {}

  /**
   * Opens a stored blob for partitioned access.
   *
   * @param storage - Storage backend
   * @param repo - Repository identifier
   * @param hash - The blob's content hash
   * @returns The opened blob
   * @throws {Error} When the blob is not a segmented, indexed v5 collection.
   */
  static async open(storage: StorageBackend, repo: string, hash: string): Promise<PartitionBlob> {
    const readRange = storage.objects.readRange?.bind(storage.objects);
    if (readRange) {
      const { size } = await storage.objects.stat(repo, hash);
      const read = (offset: number, length: number): Promise<Uint8Array> => readRange(repo, hash, offset, length);
      return new PartitionBlob(read, await readBeast2ExtentsRanged({ size, read }));
    }
    const data = await storage.objects.read(repo, hash);
    const read = (offset: number, length: number): Promise<Uint8Array> => Promise.resolve(data.subarray(offset, offset + length));
    return new PartitionBlob(read, await readBeast2ExtentsRanged({ size: data.length, read }));
  }

  /** A pager over the single-segment carve of segment `i`, cached for the
   *  fence-then-keys probe pattern of boundary alignment. */
  private async pagesAt(segment: number): Promise<Beast2Pages> {
    if (this.probe?.segment === segment) return this.probe.pages;
    const start = this.extents.offsets[segment]!;
    const frames = await this.read(start, segmentEnd(this.extents, segment) - start);
    const mini = carveBeast2Ranged(this.extents, frames, segment, segment + 1);
    const pages = openBeast2PagesFor(this.extents.typeValue)(mini);
    if (this.probe === null) {
      decodedSegments.held++;
      decodedSegments.peak = Math.max(decodedSegments.peak, decodedSegments.held);
    }
    this.probe = { segment, pages };
    return pages;
  }

  /**
   * Drops the decoded segment this blob holds, if any. A blob stays usable —
   * a later probe decodes again — so a caller releases a blob when it is done
   * with it.
   */
  release(): void {
    if (this.probe !== null) {
      decodedSegments.held--;
      this.probe = null;
    }
    this.lastKeyMemo = null;
  }

  /**
   * Segment `segment`'s fence — its first element (Array/Set) or key (Dict).
   *
   * @param segment - zero-based segment index
   * @returns the decoded fence value
   */
  async fence(segment: number): Promise<unknown> {
    return (await this.pagesAt(segment)).fence(0);
  }

  /**
   * The decoded collection of segment `segment` (bounded: one segment).
   *
   * @param segment - zero-based segment index
   * @returns the decoded segment collection
   */
  async segmentValue(segment: number): Promise<unknown> {
    return (await this.pagesAt(segment)).segment(0);
  }

  /** Memo for {@link lastKey}: decoding the last segment once is the cost. */
  private lastKeyMemo: { value: unknown } | null = null;

  /**
   * The blob's greatest element (Array/Set) or key (Dict) — the last element
   * of its last segment.
   *
   * @remarks
   * The one bound the index does not carry: a segment's keys are bounded above
   * by the NEXT segment's fence, which the last segment does not have. Costs
   * one decode, once per blob.
   *
   * @returns the last element or key, or `undefined` for an empty blob
   */
  async lastKey(): Promise<unknown> {
    if (this.lastKeyMemo) return this.lastKeyMemo.value;
    const count = this.extents.offsets.length;
    let last: unknown;
    if (count > 0) {
      const segment = await this.segmentValue(count - 1);
      if (segment instanceof Map) {
        for (const key of segment.keys()) last = key;
      } else {
        for (const element of segment as Iterable<unknown>) last = element;
      }
    }
    this.lastKeyMemo = { value: last };
    return last;
  }

  /**
   * A splice part covering segments `[fromSegment, toSegment)` of this blob,
   * streamed as ranged chunks.
   *
   * @param fromSegment - zero-based index of the first segment
   * @param toSegment - zero-based index after the last segment
   * @returns the part, for {@link spliceChunks}
   */
  spanPart(fromSegment: number, toSegment: number): SplicePart {
    const extents = this.extents;
    const read = this.read;
    const start = toSegment > fromSegment ? extents.offsets[fromSegment]! : 0;
    const end = toSegment > fromSegment ? segmentEnd(extents, toSegment - 1) : 0;
    return {
      kind: 'span',
      head: extents.head,
      selfContained: extents.selfContained,
      offsets: extents.offsets.slice(fromSegment, toSegment).map((o) => o - start),
      counts: extents.counts.slice(fromSegment, toSegment),
      frameBytes: end - start,
      async *chunks(): AsyncIterable<Uint8Array> {
        for (let pos = start; pos < end; pos += PARTITION_COPY_CHUNK_BYTES) {
          yield await read(pos, Math.min(PARTITION_COPY_CHUNK_BYTES, end - pos));
        }
      },
    };
  }
}

/**
 * One spliceable run of segments: its source's header bytes, the segments'
 * frame offsets *relative to the run's first frame byte*, and the frame
 * bytes as a chunk stream.
 */
export interface SplicePart {
  /** How the part's frame bytes were obtained: `span` copies them from a
   *  stored blob's frames untouched, `rebuilt` re-encoded a decoded batch.
   *  The segment merge's whole claim is how FEW parts are rebuilt, so the
   *  distinction is part of the contract, not an implementation detail. */
  readonly kind: 'span' | 'rebuilt';
  /** The source blob's `[0, prefixEnd)` bytes — every part of a splice must
   *  carry byte-identical header sections. */
  readonly head: Uint8Array;
  /** Whether the source blob's segments are independently decodable. A
   *  non-self-contained part's cross-segment REFs would resolve into a
   *  NEIGHBOURING part's container table after the splice — in range, so
   *  nothing throws, silently wrong — so {@link spliceChunks} refuses it,
   *  exactly as `spliceBeast2` does. */
  readonly selfContained: boolean;
  /** Frame offsets relative to the part's first frame byte. */
  readonly offsets: readonly number[];
  /** Element (pair) counts per segment. */
  readonly counts: readonly number[];
  /** Total frame bytes the chunk stream yields. */
  readonly frameBytes: number;
  /** The `[prefixEnd, segmentsEnd)` frame bytes, in order. */
  chunks(): AsyncIterable<Uint8Array>;
}

/**
 * A splice part holding an in-memory standalone blob (an edge rebuild).
 *
 * @param blob - a standalone segmented v5 blob
 * @returns the part, for {@link spliceChunks}
 */
export function bufferPart(blob: Uint8Array): SplicePart {
  const extents = readBeast2Extents(blob);
  return {
    kind: 'rebuilt',
    head: blob.subarray(0, extents.prefixEnd),
    selfContained: extents.selfContained,
    offsets: extents.offsets.map((o) => o - extents.prefixEnd),
    counts: [...extents.counts],
    frameBytes: extents.segmentsEnd - extents.prefixEnd,
    // eslint-disable-next-line @typescript-eslint/require-await
    async *chunks(): AsyncIterable<Uint8Array> {
      yield blob.subarray(extents.prefixEnd, extents.segmentsEnd);
    },
  };
}

/** Whether the first `length` bytes of `a` and `b` are identical. */
function bytesEqual(a: Uint8Array, b: Uint8Array, length: number): boolean {
  if (a.length < length || b.length < length) return false;
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Streams the splice of `parts` under `head` — byte-identical to
 * {@link spliceBeast2} over the same content, but never holding more than
 * one chunk: the header, then every part's frame bytes in order, then the
 * terminator + rebuilt index + footer.
 *
 * @param head - the header bytes the result carries (`[0, prefixEnd)` of the
 *   source; used directly when `parts` is empty)
 * @param parts - the runs to splice, in order
 * @returns the spliced blob's bytes, chunk by chunk
 * @throws {Error} When a part's header sections differ from `head`, or a
 *   part is not self-contained (its cross-segment REFs would resolve into a
 *   neighbouring part's containers after the splice) — the same refusals as
 *   {@link spliceBeast2}.
 */
export async function* spliceChunks(head: Uint8Array, parts: readonly SplicePart[] | AsyncIterable<SplicePart>): AsyncIterable<Uint8Array> {
  const check = (part: SplicePart, index: number): void => {
    if (part.head.length !== head.length || !bytesEqual(part.head, head, head.length)) {
      throw new Error(`beast2 v5: splice part ${index} has differing header sections — parts must share one wire type and source map`);
    }
    if (!part.selfContained) {
      throw new Error(`beast2 v5: splice part ${index} has cross-segment aliasing — splice needs self-contained segments`);
    }
  };
  // An array of parts is validated up front, so a bad part is reported before
  // a byte is written. A LAZY source — the segment merge, which produces its
  // rebuilt parts as it walks so they are never all resident — is validated
  // part by part instead; the consumer is `objects.writeStream`, which stages
  // and only names an object once the stream completes, so an abort mid-way
  // still writes nothing.
  const eager = Array.isArray(parts) ? (parts as readonly SplicePart[]) : null;
  if (eager) eager.forEach(check);

  yield head;
  let pos = head.length;
  let index = 0;
  const segments: { offset: number; count: number }[] = [];
  for await (const part of eager ?? (parts as AsyncIterable<SplicePart>)) {
    if (!eager) check(part, index);
    index++;
    for (let i = 0; i < part.offsets.length; i++) {
      segments.push({ offset: part.offsets[i]! + pos, count: part.counts[i]! });
    }
    yield* part.chunks();
    pos += part.frameBytes;
  }
  yield spliceBeast2Tail(segments, pos);
}
