/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Stepping over a value's v5 encoding without decoding it, and proving on the
 * way that the bytes are the ones the Writer writes for the value they hold.
 *
 * Decoding a value and encoding it again gives its canonical bytes, but builds
 * the value to do it. A reader that needs only where a value ends, and that its
 * bytes are the Writer's, can step over them instead, holding each to what the
 * encoder writes:
 *
 * - varints are minimal, and a length is a safe integer;
 * - an Integer fits 64 bits, and a DateTime is a date a `Date` holds;
 * - a Boolean is 0 or 1, and a NaN is the one NaN the encoder writes;
 * - a String is well-formed UTF-8;
 * - a Variant's case is one its type has;
 * - a container's content is one run, and an alias names an earlier container
 *   of the same type within the root element;
 * - a Set's elements and a Dict's keys strictly ascend.
 *
 * Whatever decodes but would encode otherwise — what decoding and encoding
 * again would change — is refused. Only a Set's elements and a Dict's keys are
 * decoded, to be ordered; they are of immutable types, so each decodes on its
 * own. A function value is refused: its captures' types are known only once
 * its IR is decoded.
 *
 * A lenient skipper holds bytes to what the decoder reads instead, where that
 * is looser than what the Writer writes: a varint need not be minimal, a NaN
 * may be the negative one, a container's content may come in several runs, and
 * an alias may name a container of an earlier root element, when the caller
 * shares one `defs` list across them. Bytes that pass it decode, and encoding
 * what they decode to gives the Writer's bytes; everything else it refuses as
 * the strict one does.
 */

import { type EastTypeValue, isTypeValueEqual } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import type { BufferReader } from "../../binary-utils.js";
import { asTypeValue } from "./type-section.js";
import { TAG_NEW, TAG_REF } from "./codec.js";
import { decodeBeast2FenceFor } from "./boundary.js";

/** Thrown where bytes are not the encoding the Writer writes — or, for a
 *  lenient skipper, not an encoding the decoder reads. */
export class Beast2NotCanonicalError extends Error {
  /** What is wrong with the bytes, as a refusal names it. */
  readonly reason: string;

  /**
   * @param reason - what the Writer would not have written
   */
  constructor(reason: string) {
    super(`beast2 v5: ${reason}`);
    this.name = "Beast2NotCanonicalError";
    this.reason = reason;
  }
}

/**
 * Steps a reader over one value's encoding, holding it to the Writer's.
 *
 * @param reader - positioned at the value
 * @param defs - the types of the containers defined so far in the root element
 *   the value belongs to, in definition order — for a lenient skipper, in
 *   every root element that shares the list; a container the value defines is
 *   added
 * @throws {Beast2NotCanonicalError} When the bytes are not the Writer's.
 */
export type CanonicalSkipper = (reader: BufferReader, defs: EastTypeValue[]) => void;

/** Options accepted by {@link canonicalSkipperFor}. */
export type CanonicalSkipperOptions = {
  /** Hold the bytes to what the decoder reads rather than to what the Writer
   *  writes. Defaults to `false`. */
  lenient?: boolean;
};

/** The largest zigzag form of a date a `Date` holds: 8.64e15 ms either side of
 *  the epoch. */
const DATE_ZIGZAG_MAX = 2n * 8_640_000_000_000_000n;

/** The most elements a container of zero-width elements holds, as every
 *  decoder bounds it: a Null costs no bytes, so the bytes left bound nothing. */
const ZERO_WIDTH_MAX = 2 ** 28;

/** The most elements a container of zero-width elements holds, as every
 *  decoder bounds it. */
export const BEAST2_ZERO_WIDTH_MAX = ZERO_WIDTH_MAX;

/** Whether a value of `type` encodes to no bytes: Null, Never, and structs of
 *  them.
 *  @internal */
export function zeroWidth(type: EastTypeValue): boolean {
  if (type.type === "Null" || type.type === "Never") return true;
  return type.type === "Struct" && type.value.every((field) => zeroWidth(field.type));
}

function refuse(reason: string): never {
  throw new Beast2NotCanonicalError(reason);
}

/**
 * Reads a varint the Writer writes: minimal, and no larger than a safe integer.
 *
 * @param reader - positioned at the varint
 * @param what - what the varint is, for the refusal
 * @param lenient - whether a varint that is not minimal reads
 * @returns its value
 * @throws {Beast2NotCanonicalError} When it is not minimal, too large, or
 *   runs past the bytes.
 */
export function canonicalVarint(reader: BufferReader, what: string, lenient = false): number {
  const buf = reader.buffer;
  let off = reader.offset;
  let value = 0;
  let scale = 1;
  for (let i = 0; ; i++) {
    if (off >= buf.length) refuse(`${what} runs past the end of its bytes`);
    const byte = buf[off++]!;
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) {
      if (byte === 0 && i > 0 && !lenient) refuse(`${what} is not a minimal varint`);
      break;
    }
    if (i === 7) refuse(`${what} is larger than a safe integer`);
    scale *= 128;
  }
  if (value > Number.MAX_SAFE_INTEGER) refuse(`${what} is larger than a safe integer`);
  reader.offset = off;
  return value;
}

/** Steps over `length` bytes. */
function bytes(reader: BufferReader, length: number, what: string): void {
  if (reader.offset + length > reader.buffer.length) refuse(`${what} runs past the end of its bytes`);
  reader.offset += length;
}

/** An Integer: a minimal zigzag varint of 64 bits at most. Ten bytes carry
 *  bits 63 and up in the last, which 64 bits leave 1 — or, lenient, 0 too,
 *  when the varint is padded. */
function integer(reader: BufferReader, lenient: boolean): void {
  const buf = reader.buffer;
  let off = reader.offset;
  for (let i = 0; ; i++) {
    if (off >= buf.length) refuse("an Integer runs past the end of its bytes");
    const byte = buf[off++]!;
    if ((byte & 0x80) === 0) {
      if (byte === 0 && i > 0 && !lenient) refuse("an Integer is not a minimal varint");
      if (i === 9 && byte > 1) refuse("an Integer is larger than 64 bits");
      break;
    }
    if (i === 9) refuse("an Integer is larger than 64 bits");
  }
  reader.offset = off;
}

/** A DateTime: a zigzag varint of the milliseconds of a date a `Date` holds.
 *  Seven bytes or fewer always are one; more are measured. */
function dateTime(reader: BufferReader, lenient: boolean): void {
  const start = reader.offset;
  integer(reader, lenient);
  const length = reader.offset - start;
  if (length < 8) return;
  let zigzag = 0n;
  for (let i = length - 1; i >= 0; i--) zigzag = (zigzag << 7n) | BigInt(reader.buffer[start + i]! & 0x7f);
  if (zigzag > DATE_ZIGZAG_MAX) refuse("a DateTime is outside the dates a Date holds");
}

/** A Float: any 64 bits but a NaN other than the encoder's,
 *  `0x7FF8000000000000` — or, lenient, the negative one the decoder also
 *  reads, `0xFFF8000000000000`. */
function float(reader: BufferReader, lenient: boolean): void {
  const buf = reader.buffer;
  const off = reader.offset;
  if (off + 8 > buf.length) refuse("a Float runs past the end of its bytes");
  const top = buf[off + 7]!;
  const next = buf[off + 6]!;
  if ((top & 0x7f) === 0x7f && (next & 0xf0) === 0xf0) {
    const low = (buf[off]! | buf[off + 1]! | buf[off + 2]! | buf[off + 3]! | buf[off + 4]! | buf[off + 5]!) === 0;
    const infinite = low && (next & 0x0f) === 0;
    const writers = low && next === 0xf8 && (top === 0x7f || (lenient && top === 0xff));
    if (!infinite && !writers) refuse("a Float is a NaN other than the one the Writer writes");
  }
  reader.offset = off + 8;
}

/** A String: a length, then that many bytes of well-formed UTF-8 — no overlong
 *  form, surrogate or code point past U+10FFFF, each of which a decode
 *  replaces and an encode then writes otherwise. */
function string(reader: BufferReader, lenient: boolean): void {
  const length = canonicalVarint(reader, "a String's length", lenient);
  const buf = reader.buffer;
  let off = reader.offset;
  const end = off + length;
  if (end > buf.length) refuse("a String runs past the end of its bytes");
  while (off < end) {
    const lead = buf[off]!;
    if (lead < 0x80) {
      off++;
      continue;
    }
    // The well-formed sequences: the second byte's range turns on the lead.
    let follow: number;
    let low = 0x80;
    let high = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) follow = 1;
    else if (lead === 0xe0) { follow = 2; low = 0xa0; }
    else if ((lead >= 0xe1 && lead <= 0xec) || lead === 0xee || lead === 0xef) follow = 2;
    else if (lead === 0xed) { follow = 2; high = 0x9f; }
    else if (lead === 0xf0) { follow = 3; low = 0x90; }
    else if (lead >= 0xf1 && lead <= 0xf3) follow = 3;
    else if (lead === 0xf4) { follow = 3; high = 0x8f; }
    else refuse("a String is not well-formed UTF-8");
    if (off + follow >= end) refuse("a String is not well-formed UTF-8");
    const second = buf[off + 1]!;
    if (second < low || second > high) refuse("a String is not well-formed UTF-8");
    for (let k = 2; k <= follow; k++) {
      const byte = buf[off + k]!;
      if (byte < 0x80 || byte > 0xbf) refuse("a String is not well-formed UTF-8");
    }
    off += follow + 1;
  }
  reader.offset = end;
}

/**
 * A mutable container's tag: `NEW`, whose content follows, recorded as a
 * definition of `type`; or `REF` to an earlier definition of the same type in
 * `defs`.
 *
 * @returns whether the container's content follows
 */
function container(reader: BufferReader, defs: EastTypeValue[], type: EastTypeValue, lenient: boolean): boolean {
  const buf = reader.buffer;
  if (reader.offset >= buf.length) refuse("a container runs past the end of its bytes");
  const tag = buf[reader.offset++]!;
  if (tag === TAG_NEW) {
    defs.push(type);
    return true;
  }
  if (tag !== TAG_REF) refuse(`a container's tag is 0x${tag.toString(16)}, neither NEW nor REF`);
  const delta = canonicalVarint(reader, "a container alias", lenient);
  if (delta < 1 || delta > defs.length) {
    refuse(lenient ? "a container alias reaches outside its segment" : "a container alias reaches outside its root element");
  }
  const target = defs[defs.length - delta]!;
  if (target !== type && !isTypeValueEqual(target, type)) refuse("a container alias names a container of another type");
  return false;
}

/** A container's content: `varint(0)` when empty, else `varint(n)`, the n
 *  elements, and `varint(0)` — one run, as the encoder writes it; lenient,
 *  any number of runs before the `varint(0)`. Each element is given its index
 *  in the content. `zero` says the elements encode to no bytes, whose count
 *  is bounded as every decoder bounds it. */
function run(reader: BufferReader, what: string, lenient: boolean, zero: boolean, element: (index: number) => void): void {
  let index = 0;
  for (;;) {
    const n = canonicalVarint(reader, index === 0 ? `${what}'s length` : `${what}'s end`, lenient);
    if (n === 0) return;
    if (index > 0 && !lenient) refuse(`${what}'s elements are not written in one run`);
    if (zero && index + n > ZERO_WIDTH_MAX) refuse(`${what} holds more elements than a reader takes`);
    for (let i = 0; i < n; i++) element(index++);
  }
}

/**
 * Builds the {@link CanonicalSkipper} for a type.
 *
 * @param type - the type of the values to step over
 * @param options - whether the skipper is lenient
 * @returns the skipper
 *
 * @example
 * ```ts
 * const bytes = encodeBeast2FenceFor(StringType)("key");
 * const reader = new BufferReader(bytes, 0);
 * canonicalSkipperFor(StringType)(reader, []);
 * // reader.offset === bytes.length
 * ```
 */
export function canonicalSkipperFor(type: EastType | EastTypeValue, options?: CanonicalSkipperOptions): CanonicalSkipper {
  return build(asTypeValue(type), new Map(), options?.lenient ?? false);
}

function build(type: EastTypeValue, recursive: Map<bigint, CanonicalSkipper>, lenient: boolean): CanonicalSkipper {
  switch (type.type) {
    case "Never":
      return () => refuse("a value of type Never");
    case "Null":
      return () => {};
    case "Boolean":
      return (reader) => {
        if (reader.offset >= reader.buffer.length) refuse("a Boolean runs past the end of its bytes");
        if (reader.buffer[reader.offset++]! > 1) refuse("a Boolean is neither 0 nor 1");
      };
    case "Integer":
      return (reader) => integer(reader, lenient);
    case "Float":
      return (reader) => float(reader, lenient);
    case "String":
      return (reader) => string(reader, lenient);
    case "DateTime":
      return (reader) => dateTime(reader, lenient);
    case "Blob":
      return (reader) => bytes(reader, canonicalVarint(reader, "a Blob's length", lenient), "a Blob");
    case "Vector": {
      const width = type.value.type === "Boolean" ? 1 : 8;
      return (reader) => {
        const length = canonicalVarint(reader, "a Vector's length", lenient);
        if (length > (reader.buffer.length - reader.offset) / width) refuse("a Vector runs past the end of its bytes");
        bytes(reader, length * width, "a Vector");
      };
    }
    case "Matrix": {
      const width = type.value.type === "Boolean" ? 1 : 8;
      return (reader) => {
        const rows = canonicalVarint(reader, "a Matrix's rows", lenient);
        const cols = canonicalVarint(reader, "a Matrix's columns", lenient);
        if (rows > 0 && cols > (reader.buffer.length - reader.offset) / width / rows) refuse("a Matrix runs past the end of its bytes");
        bytes(reader, rows * cols * width, "a Matrix");
      };
    }
    case "Array": {
      let element: CanonicalSkipper;
      const zero = zeroWidth(type.value);
      const skip: CanonicalSkipper = (reader, defs) => {
        if (container(reader, defs, type, lenient)) run(reader, "an Array", lenient, zero, () => element(reader, defs));
      };
      element = build(type.value, recursive, lenient);
      return skip;
    }
    case "Set": {
      let element: CanonicalSkipper;
      const decode = decodeBeast2FenceFor(type.value);
      const cmp = compareFor(type.value) as (a: unknown, b: unknown) => number;
      const zero = zeroWidth(type.value);
      const skip: CanonicalSkipper = (reader, defs) => {
        if (!container(reader, defs, type, lenient)) return;
        let previous: unknown;
        run(reader, "a Set", lenient, zero, (index) => {
          const start = reader.offset;
          element(reader, defs);
          const value = decode(reader.buffer.subarray(start, reader.offset));
          if (index > 0 && cmp(previous, value) >= 0) refuse("a Set's elements do not strictly ascend");
          previous = value;
        });
      };
      element = build(type.value, recursive, lenient);
      return skip;
    }
    case "Dict": {
      let key: CanonicalSkipper;
      let value: CanonicalSkipper;
      const decode = decodeBeast2FenceFor(type.value.key);
      const cmp = compareFor(type.value.key) as (a: unknown, b: unknown) => number;
      const zero = zeroWidth(type.value.key) && zeroWidth(type.value.value);
      const skip: CanonicalSkipper = (reader, defs) => {
        if (!container(reader, defs, type, lenient)) return;
        let previous: unknown;
        run(reader, "a Dict", lenient, zero, (index) => {
          const start = reader.offset;
          key(reader, defs);
          const k = decode(reader.buffer.subarray(start, reader.offset));
          if (index > 0 && cmp(previous, k) >= 0) refuse("a Dict's keys do not strictly ascend");
          previous = k;
          value(reader, defs);
        });
      };
      key = build(type.value.key, recursive, lenient);
      value = build(type.value.value, recursive, lenient);
      return skip;
    }
    case "Ref": {
      let inner: CanonicalSkipper;
      const skip: CanonicalSkipper = (reader, defs) => {
        if (container(reader, defs, type, lenient)) inner(reader, defs);
      };
      inner = build(type.value, recursive, lenient);
      return skip;
    }
    case "Struct": {
      const fields = type.value.map((field) => build(field.type, recursive, lenient));
      return (reader, defs) => {
        for (const field of fields) field(reader, defs);
      };
    }
    case "Variant": {
      const cases = type.value.map((c) => build(c.type, recursive, lenient));
      return (reader, defs) => {
        const tag = canonicalVarint(reader, "a Variant's case", lenient);
        if (tag >= cases.length) refuse(`a Variant's case ${tag} is not one of its ${cases.length}`);
        cases[tag]!(reader, defs);
      };
    }
    case "Recursive": {
      const node = type.value as { type: "wrapper"; value: { id: bigint; inner: EastTypeValue } } | { type: "ref"; value: bigint };
      if (node.type === "wrapper") {
        let inner: CanonicalSkipper;
        const skip: CanonicalSkipper = (reader, defs) => inner(reader, defs);
        recursive.set(node.value.id, skip);
        inner = build(node.value.inner, recursive, lenient);
        return skip;
      }
      const target = recursive.get(node.value);
      if (target === undefined) throw new Error("beast2 v5: a recursive type refers to one not being built");
      return target;
    }
    case "Function":
    case "AsyncFunction":
      return () => refuse("a function value, whose captures' types only its decoded IR says");
    default:
      throw new Error(`beast2 v5: unknown type ${(type as { type: string }).type}`);
  }
}
