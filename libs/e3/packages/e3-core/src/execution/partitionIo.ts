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
 * (extents from head + tail, fences as bounded prefix probes, boundary
 * probes as single-segment decodes), and slices/spliced outputs stream to
 * the object store chunk by chunk through {@link spliceChunks} — the
 * orchestrator holds one chunk, one decoded boundary segment, or one edge
 * rebuild at a time, never a whole blob.
 *
 * Backends without `objects.readRange` degrade to one whole read per blob
 * behind the same interface, so the executor has a single code path.
 */

import {
  isEastDict,
  openBeast2PagesFor,
  readBeast2Extents,
  readBeast2ExtentsRanged,
  carveBeast2Ranged,
  spliceBeast2Tail,
  type Beast2Pages,
  type Beast2RangedExtents,
  type Beast2SyncRangeReader,
} from '@elaraai/east';
import type { CollectionManifest } from '@elaraai/e3-types';
import { openDatasetObject } from '../dataset-open.js';
import type { StorageBackend } from '../storage/interfaces.js';

/** Bytes per range-read → write-stream copy chunk. */
export const PARTITION_COPY_CHUNK_BYTES = 8 * 1024 * 1024;

/** The decoded segments open {@link PartitionBlob}s hold now, and the most
 *  they have held at once since the peak was last reset. */
const decodedSegments = { held: 0, peak: 0 };

/** The most frame prefixes one blob's fence prober has held at once since
 *  {@link resetPrefetchedRangePeak}. */
const prefetchedRanges = { peak: 0 };

/**
 * The most frame prefixes a single {@link PartitionBlob}'s fence prober has
 * held at once since {@link resetPrefetchedRangePeak} — bounded by
 * construction, counted for specs.
 *
 * @returns The peak number of prefetched ranges held by one prober
 * @internal
 */
export function prefetchedRangePeak(): number {
  return prefetchedRanges.peak;
}

/**
 * Starts a new peak of {@link prefetchedRangePeak}.
 *
 * @internal
 */
export function resetPrefetchedRangePeak(): void {
  prefetchedRanges.peak = 0;
}

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

/** A read the prefix pager asked for that no prefetched range covers: the
 *  async caller fetches it and retries. */
class PrefetchNeeded extends Error {
  constructor(readonly offset: number, readonly length: number) {
    super(`prefetch [${offset}, ${offset + length})`);
  }
}

/** The most rounds a fence probe fetches before giving up on a blob whose
 *  pager keeps asking for more — a frame is read whole well within it. */
const FENCE_PROBE_ROUNDS = 16;

/** Frame prefixes a blob's fence prober keeps, beyond the blob's head.
 *
 *  Probing walks segments in order, so the recent prefixes are the ones a
 *  retry needs; a dropped range is fetched again, which costs one read and
 *  never correctness. Unbounded — as this was — a pass over every fence of a
 *  blob retained a prefix per segment and scanned them all on every read, so
 *  a large co-partitioned secondary cost O(segments) memory and O(segments²)
 *  comparisons in the module whose whole claim is one segment at a time. */
const FENCE_PREFIX_RANGES = 8;

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
  /** The fence prober: a pager over this blob's whole geometry whose
   *  synchronous reads are served from `prefetched` — the head, the tail and
   *  the frame prefixes fetched so far — so a fence costs a few kilobytes of
   *  its segment, never the frame. Built on the first fence probe. */
  private prefix: { pages: Beast2Pages | undefined; prefetched: { offset: number; bytes: Uint8Array }[] } | null = null;

  private constructor(
    private readonly read: (offset: number, length: number) => Promise<Uint8Array>,
    /** The blob's byte geometry plus header bytes. */
    readonly extents: Beast2RangedExtents,
  ) {}

  /**
   * Opens a stored blob for partitioned access.
   *
   * @remarks
   * A dataset stored as a segment manifest is addressed as the one blob its
   * segments splice to, without that blob ever being built: the header comes
   * from the header object, each segment's frames from its own object, and
   * the index tail is computed from their geometry. Those are exactly the
   * bytes a splice writes, so a slice carved here is the slice carved from
   * the spliced value, hash for hash, and every cached execution over one
   * still hits.
   *
   * @param storage - Storage backend
   * @param repo - Repository identifier
   * @param hash - The blob's content hash — a manifest, a record state naming
   *   one, or a bare blob
   * @returns The opened blob
   * @throws {Error} When the blob is not a segmented, indexed v5 collection.
   */
  static async open(storage: StorageBackend, repo: string, hash: string): Promise<PartitionBlob> {
    const opened = await openDatasetObject(storage, repo, hash);
    if (opened.manifest !== null) {
      const layout = await manifestLayout(storage, repo, opened.hash, opened.manifest);
      return new PartitionBlob(layout.read, await readBeast2ExtentsRanged(layout));
    }
    const readRange = storage.objects.readRange?.bind(storage.objects);
    if (readRange) {
      const { size } = await storage.objects.stat(repo, opened.hash);
      const read = (offset: number, length: number): Promise<Uint8Array> => readRange(repo, opened.hash, offset, length);
      return new PartitionBlob(read, await readBeast2ExtentsRanged({ size, read }));
    }
    const data = await storage.objects.read(repo, opened.hash);
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
   * Drops the decoded segment this blob holds, if any, and the frame prefixes
   * its fence prober fetched. A blob stays usable — a later probe decodes or
   * fetches again — so a caller releases a blob when it is done with it.
   */
  release(): void {
    if (this.probe !== null) {
      decodedSegments.held--;
      this.probe = null;
    }
    this.prefix = null;
    this.lastKeyMemo = null;
  }

  /** The fence prober's state, built on first use: the ranges prefetched so
   *  far — the head from the extents, then whatever the pager asks for — and
   *  the pager, constructed once the open's reads have been served. */
  private prober(): { pages: Beast2Pages | undefined; prefetched: { offset: number; bytes: Uint8Array }[] } {
    this.prefix ??= { pages: undefined, prefetched: [{ offset: 0, bytes: this.extents.head }] };
    return this.prefix;
  }

  /**
   * Segment `segment`'s fence — its first element (Array/Set) or key (Dict),
   * decoded from a bounded prefix of its frame (a few kilobytes, grown
   * fourfold while the first key does not fit), never the frame unless the
   * key is that wide. A segment already decoded whole answers from it.
   *
   * @param segment - zero-based segment index
   * @returns the decoded fence value
   */
  async fence(segment: number): Promise<unknown> {
    if (this.probe?.segment === segment) return this.probe.pages.fence(0);
    const prober = this.prober();
    for (let round = 0; round < FENCE_PROBE_ROUNDS; round++) {
      try {
        if (prober.pages === undefined) {
          prober.pages = openBeast2PagesFor(this.extents.typeValue)(this.prefixReader());
        }
        return prober.pages.fence(segment);
      } catch (err) {
        if (!(err instanceof PrefetchNeeded)) throw err;
        prober.prefetched.push({ offset: err.offset, bytes: await this.read(err.offset, err.length) });
        // The head at index 0 always stays — every probe reads the header
        // sections through it; the frame prefixes behind it are a small FIFO.
        while (prober.prefetched.length > FENCE_PREFIX_RANGES + 1) prober.prefetched.splice(1, 1);
        prefetchedRanges.peak = Math.max(prefetchedRanges.peak, prober.prefetched.length);
      }
    }
    // The prober kept asking: decode the segment whole instead.
    return (await this.pagesAt(segment)).fence(0);
  }

  /** The synchronous reader behind the fence prober — see {@link prober}. */
  private prefixReader(): Beast2SyncRangeReader {
    const prefetched = this.prober().prefetched;
    return {
      size: this.extents.size,
      read: (offset, length) => {
        for (const range of prefetched) {
          if (range.offset <= offset && offset + length <= range.offset + range.bytes.length) {
            return range.bytes.subarray(offset - range.offset, offset - range.offset + length);
          }
        }
        throw new PrefetchNeeded(offset, length);
      },
    };
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
      if (isEastDict(segment)) {
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

/** A manifest-stored collection addressed as the one blob its segments
 *  splice to: that blob's size, and ranged reads of it. */
interface ManifestLayout {
  /** The spliced blob's size in bytes. */
  readonly size: number;
  /** Reads `[offset, offset + length)` of the spliced blob. */
  readonly read: (offset: number, length: number) => Promise<Uint8Array>;
}

/** Layouts kept per backend, keyed by repository and manifest hash. A plan
 *  opens its input once and every carve opens it again, and the geometry
 *  costs a read per segment object — while a manifest names the same objects
 *  forever, so its layout never goes stale. */
const manifestLayouts = new WeakMap<object, Map<string, ManifestLayout>>();

/** Layouts one backend keeps at once. */
const MANIFEST_LAYOUTS_PER_BACKEND = 8;

/**
 * Where each byte of the blob a manifest's segments splice to lives.
 *
 * @remarks
 * Every segment object is the manifest's header, its own frames, and a
 * one-segment index tail, so the only thing a segment object has to say is
 * where its frames end — one tail read, with the head served from the header
 * already in hand. The splice is then the header, each object's frames in
 * turn, and an index tail computed over their offsets: the same bytes
 * `DatasetSegments.splice` streams, which is what keeps a carve over one
 * byte-identical to a carve over the other.
 *
 * The object store is resolved on every read rather than captured here, for
 * the reason `DatasetSegments` gives: a layout outlives the call that built
 * it.
 */
async function manifestLayout(
  storage: StorageBackend,
  repo: string,
  manifestHash: string,
  manifest: CollectionManifest,
): Promise<ManifestLayout> {
  let byBackend = manifestLayouts.get(storage);
  if (byBackend === undefined) {
    byBackend = new Map();
    manifestLayouts.set(storage, byBackend);
  }
  const key = `${repo}\u0000${manifestHash}`;
  const cached = byBackend.get(key);
  if (cached !== undefined) {
    byBackend.delete(key);
    byBackend.set(key, cached); // refresh recency
    return cached;
  }

  // A backend with no ranged reads serves a segment object whole. A carve
  // reads a segment's frames front to back, so the last object is kept.
  let held: { hash: string; bytes: Uint8Array } | null = null;
  const objectRange = async (hash: string, offset: number, length: number): Promise<Uint8Array> => {
    const readRange = storage.objects.readRange;
    if (readRange) return readRange.call(storage.objects, repo, hash, offset, length);
    if (held?.hash !== hash) held = { hash, bytes: await storage.objects.read(repo, hash) };
    return held.bytes.subarray(offset, offset + length);
  };

  const header = await storage.objects.read(repo, manifest.header);
  // Each segment object's frames, as a run of the spliced blob; empty runs
  // hold no bytes and are left out, so every run a read lands in advances it.
  const runs: { start: number; end: number; hash: string; objectStart: number }[] = [];
  const segments: { offset: number; count: number }[] = [];
  let pos = header.length;
  for (const entry of manifest.entries) {
    const extents = await readBeast2ExtentsRanged({
      size: Number(entry.bytes),
      read: (offset, length) => offset + length <= header.length
        ? Promise.resolve(header.subarray(offset, offset + length))
        : objectRange(entry.hash, offset, length),
    });
    if (extents.prefixEnd !== header.length) {
      throw new Error(`collection manifest: segment ${entry.hash} is not written under the manifest's header`);
    }
    for (let s = 0; s < extents.offsets.length; s++) {
      segments.push({ offset: extents.offsets[s]! - extents.prefixEnd + pos, count: extents.counts[s]! });
    }
    const length = extents.segmentsEnd - extents.prefixEnd;
    if (length > 0) runs.push({ start: pos, end: pos + length, hash: entry.hash, objectStart: extents.prefixEnd });
    pos += length;
  }
  const segmentsEnd = pos;
  const tail = spliceBeast2Tail(segments, segmentsEnd);
  const size = segmentsEnd + tail.length;

  const read = async (offset: number, length: number): Promise<Uint8Array> => {
    const end = offset + length;
    if (offset < 0 || length < 0 || end > size) {
      throw new RangeError(`collection manifest: read [${offset}, ${end}) outside the ${size}-byte spliced blob`);
    }
    const out = new Uint8Array(length);
    let at = offset;
    while (at < end) {
      if (at < header.length) {
        const upto = Math.min(end, header.length);
        out.set(header.subarray(at, upto), at - offset);
        at = upto;
      } else if (at >= segmentsEnd) {
        out.set(tail.subarray(at - segmentsEnd, end - segmentsEnd), at - offset);
        at = end;
      } else {
        // The run holding `at`: the last one starting at or before it.
        let lo = 0;
        let hi = runs.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (runs[mid]!.start <= at) lo = mid;
          else hi = mid - 1;
        }
        const run = runs[lo]!;
        const upto = Math.min(end, run.end);
        out.set(await objectRange(run.hash, run.objectStart + (at - run.start), upto - at), at - offset);
        at = upto;
      }
    }
    return out;
  };

  const layout: ManifestLayout = { size, read };
  byBackend.set(key, layout);
  while (byBackend.size > MANIFEST_LAYOUTS_PER_BACKEND) byBackend.delete(byBackend.keys().next().value!);
  return layout;
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
