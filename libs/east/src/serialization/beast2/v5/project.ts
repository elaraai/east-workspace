/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * BEAST2 v5 projected decoding: the TypeScript port of east-c's
 * `v5/project.c` (#599, #1112).
 *
 * A projection maps the WIRE type — what the bytes hold — to a PROJECTED type
 * that keeps a subset of it: struct fields by name, and within variant
 * payloads, array elements, ref contents and dict values. Decoding walks the
 * wire byte-exactly: a dropped field is parsed past without being built. The
 * same bytes decode whole or projected; nothing on the wire changes.
 *
 * Two rules keep a projection sound, as they do east-c's:
 * - Dict keys and Set elements never project: they order the container, and
 *   dropping a field would change how they compare.
 * - A container met in a dropped field still takes a definition, so the
 *   back-references after it stay aligned with the encoder's numbering. Each
 *   definition records the shape it was decoded to, and a back-reference to a
 *   container decoded to another shape throws
 *   {@link Beast2ProjectionAliasError}: the caller decodes whole instead.
 *
 * A compiled `$.for` over a lazy input infers its projection from the loop's
 * body ({@link loopProjectionType}): the struct fields it reads of the loop
 * variable, through chains of field accesses. Each segment it walks is then
 * decoded to those fields alone, and counted ({@link beast2PagedLoopStats}).
 *
 * @packageDocumentation
 */

import type { EastTypeValue } from "../../../type_of_type.js";
import { isTypeValueEqual } from "../../../type_value_equal.js";
import { variant } from "../../../containers/variant.js";
import { ref } from "../../../containers/ref.js";
import { SortedMap } from "../../../containers/sortedmap.js";
import { compareFor } from "../../../comparison.js";
import type { BufferReader } from "../../binary-utils.js";
import type { IR } from "../../../ir.js";
import { TAG_NEW, TAG_REF, buildV5Decoder, readContainerTag, type V5DecodeContext, type V5Decoder } from "./codec.js";
import type { SegmentDecoder } from "./stream.js";

/** Parses past one value of a type without building it. */
type Skipper = (reader: BufferReader, ctx: V5DecodeContext) => void;

/** What a container met in a dropped field is defined as. */
const SKIPPED: object = Object.freeze({});
/** The shape {@link SKIPPED} was decoded to: no reference may name it. */
const SKIPPED_SHAPE: object = Object.freeze({});

/** The deepest a type may nest for a projection, as a decode may. */
const MAX_DEPTH = 256;

/** Prints a type value for an error, without the cost of the printer. */
function kindOf(type: EastTypeValue): string {
  return type.type;
}

/** Whether a type holds a function anywhere: a dropped field of one cannot be
 *  parsed past without decoding its IR, so a projection refuses it. */
function holdsFunction(type: EastTypeValue, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  switch (type.type) {
    case "Function":
    case "AsyncFunction":
      return true;
    case "Array":
    case "Set":
    case "Ref":
    case "Vector":
    case "Matrix":
      return holdsFunction(type.value as EastTypeValue, depth + 1);
    case "Dict": {
      const dict = type.value as { key: EastTypeValue; value: EastTypeValue };
      return holdsFunction(dict.key, depth + 1) || holdsFunction(dict.value, depth + 1);
    }
    case "Struct":
    case "Variant":
      return (type.value as { type: EastTypeValue }[]).some((part) => holdsFunction(part.type, depth + 1));
    case "Recursive": {
      const node = type.value as { type: string; value: unknown };
      return node.type === "wrapper" && holdsFunction((node.value as { inner: EastTypeValue }).inner, depth + 1);
    }
    default:
      return false;
  }
}

/**
 * Builds the parser that steps past one value of `type`. A container it
 * meets takes a definition, as a decode's does, recorded as skipped; a
 * back-reference it meets is checked to be in range and followed no further.
 */
function buildSkipper(type: EastTypeValue, typeCtx: Map<bigint, Skipper>): Skipper {
  switch (type.type) {
    case "Never":
    case "Null":
      return () => {};
    case "Boolean":
      return (reader) => { reader.readUint8(); };
    case "Integer":
    case "DateTime":
      return (reader) => { reader.readZigzag(); };
    case "Float":
      return (reader) => { reader.skip(8); };
    case "String":
    case "Blob":
      return (reader) => { reader.skip(reader.readVarint()); };
    case "Vector": {
      const width = (type.value as EastTypeValue).type === "Boolean" ? 1 : 8;
      return (reader) => { reader.skip(reader.readVarint() * width); };
    }
    case "Matrix": {
      const width = (type.value as EastTypeValue).type === "Boolean" ? 1 : 8;
      return (reader) => {
        const rows = reader.readVarint();
        const cols = reader.readVarint();
        reader.skip(rows * cols * width);
      };
    }
    case "Struct": {
      const fields = (type.value as { type: EastTypeValue }[]).map((field) => buildSkipper(field.type, typeCtx));
      return (reader, ctx) => {
        for (const skip of fields) skip(reader, ctx);
      };
    }
    case "Variant": {
      const cases = (type.value as { type: EastTypeValue }[]).map((part) => buildSkipper(part.type, typeCtx));
      return (reader, ctx) => {
        const tag = reader.readVarint();
        const skip = cases[tag];
        if (skip === undefined) throw new Error(`Invalid variant tag ${tag}`);
        skip(reader, ctx);
      };
    }
    case "Array":
    case "Set":
    case "Dict":
    case "Ref": {
      let skipElement: Skipper;
      const skipContainer: Skipper = (reader, ctx) => {
        const tag = reader.readUint8();
        if (tag === TAG_REF) {
          const delta = reader.readVarint();
          if (delta < 1 || delta > ctx.containers.length) {
            throw new Error(`beast2 v5: container backref delta ${delta} out of range (${ctx.containers.length} definitions visible)`);
          }
          return;
        }
        if (tag !== TAG_NEW) throw new Error(`beast2 v5: invalid container tag 0x${tag.toString(16)}`);
        ctx.containers.push(SKIPPED);
        if (type.type === "Ref") {
          skipElement(reader, ctx);
          return;
        }
        for (;;) {
          const n = reader.readVarint();
          if (n === 0) break;
          for (let i = 0; i < n; i++) skipElement(reader, ctx);
        }
      };
      if (type.type === "Dict") {
        const dict = type.value as { key: EastTypeValue; value: EastTypeValue };
        const key = buildSkipper(dict.key, typeCtx);
        const value = buildSkipper(dict.value, typeCtx);
        skipElement = (reader, ctx) => { key(reader, ctx); value(reader, ctx); };
      } else {
        skipElement = buildSkipper(type.value as EastTypeValue, typeCtx);
      }
      return skipContainer;
    }
    case "Recursive": {
      const node = type.value as { type: string; value: unknown };
      if (node.type === "wrapper") {
        const wrapper = node.value as { id: bigint; inner: EastTypeValue };
        let inner: Skipper;
        const skip: Skipper = (reader, ctx) => inner(reader, ctx);
        typeCtx.set(wrapper.id, skip);
        inner = buildSkipper(wrapper.inner, typeCtx);
        return skip;
      }
      const target = typeCtx.get(node.value as bigint);
      if (target === undefined) throw new Error("beast2 v5 projection: recursive type context not found");
      return target;
    }
    default:
      // A function: refused when the plan is built, so never parsed past.
      throw new TypeError(`beast2 v5 projection: cannot parse past a value of type ${kindOf(type)}`);
  }
}

/**
 * Builds the decoder of a wire value as its projection. A subtree whose
 * projected type is its wire type decodes whole; anything else must narrow
 * the wire type as {@link buildV5ProjectedDecoder} describes.
 */
function buildProjected(wire: EastTypeValue, proj: EastTypeValue, depth: number): V5Decoder {
  if (depth > MAX_DEPTH) throw new TypeError("beast2 v5 projection: type nesting too deep");
  if (isTypeValueEqual(wire, proj)) {
    // Decoded wire-shaped: its containers record no shape.
    const whole = buildV5Decoder(wire);
    return (reader, ctx) => {
      const saved = ctx.curShape ?? null;
      ctx.curShape = null;
      const value = whole(reader, ctx);
      ctx.curShape = saved;
      return value;
    };
  }
  if (wire.type !== proj.type) {
    throw new TypeError(`beast2 v5 projection: the projected type is ${kindOf(proj)} where the wire type is ${kindOf(wire)}`);
  }
  switch (wire.type) {
    case "Struct": {
      const wireFields = wire.value as { name: string; type: EastTypeValue }[];
      const projFields = (proj.value as { name: string; type: EastTypeValue }[]);
      const kept = new Map<string, EastTypeValue>();
      for (const field of projFields) {
        if (kept.has(field.name) || !wireFields.some((w) => w.name === field.name)) {
          throw new TypeError(`beast2 v5 projection: the wire type has no field '${field.name}' to keep`);
        }
        kept.set(field.name, field.type);
      }
      const steps = wireFields.map(({ name, type }) => {
        const projected = kept.get(name);
        if (projected !== undefined) return { name, decode: buildProjected(type, projected, depth + 1), skip: null };
        if (holdsFunction(type)) {
          throw new TypeError(`beast2 v5 projection: cannot project away function-typed field '${name}' — function values must decode whole`);
        }
        return { name, decode: null, skip: buildSkipper(type, new Map()) };
      });
      return (reader, ctx) => {
        const result: Record<string, unknown> = {};
        for (const step of steps) {
          if (step.decode !== null) result[step.name] = step.decode(reader, ctx);
          else step.skip!(reader, ctx);
        }
        if (ctx.frozen) Object.freeze(result);
        return result;
      };
    }
    case "Variant": {
      const wireCases = wire.value as { name: string; type: EastTypeValue }[];
      const projCases = proj.value as { name: string; type: EastTypeValue }[];
      if (wireCases.length !== projCases.length || wireCases.some((c, i) => c.name !== projCases[i]!.name)) {
        throw new TypeError("beast2 v5 projection: variant case lists must match exactly (the wire encodes case indices); case payloads may project");
      }
      const cases = wireCases.map((c, i) => ({ name: c.name, decode: buildProjected(c.type, projCases[i]!.type, depth + 1) }));
      return (reader, ctx) => {
        const tag = reader.readVarint();
        const projected = cases[tag];
        if (projected === undefined) throw new Error(`Invalid variant tag ${tag}`);
        const value = variant(projected.name, projected.decode(reader, ctx));
        if (ctx.frozen) Object.freeze(value);
        return value;
      };
    }
    case "Array": {
      // This closure's shape object is what its containers are decoded to.
      const shape = {};
      const element = buildProjected(wire.value as EastTypeValue, proj.value as EastTypeValue, depth + 1);
      return (reader, ctx) => {
        ctx.curShape = shape;
        const aliased = readContainerTag(reader, ctx);
        if (aliased !== undefined) return aliased;
        const array: unknown[] = [];
        ctx.containers.push(array);
        ctx.projShapes!.set(array, shape);
        for (;;) {
          const n = reader.readVarint();
          if (n === 0) break;
          for (let i = 0; i < n; i++) array.push(element(reader, ctx));
        }
        if (ctx.frozen) Object.freeze(array);
        return array;
      };
    }
    case "Ref": {
      const shape = {};
      const inner = buildProjected(wire.value as EastTypeValue, proj.value as EastTypeValue, depth + 1);
      return (reader, ctx) => {
        ctx.curShape = shape;
        const aliased = readContainerTag(reader, ctx);
        if (aliased !== undefined) return aliased;
        const cell = ref(undefined as unknown);
        ctx.containers.push(cell);
        ctx.projShapes!.set(cell, shape);
        cell.value = inner(reader, ctx);
        if (ctx.frozen) Object.freeze(cell);
        return cell;
      };
    }
    case "Set":
      throw new TypeError("beast2 v5 projection: Set elements cannot project — they are the container's keys (element order and identity would change)");
    case "Dict": {
      const wireDict = wire.value as { key: EastTypeValue; value: EastTypeValue };
      const projDict = proj.value as { key: EastTypeValue; value: EastTypeValue };
      if (!isTypeValueEqual(wireDict.key, projDict.key)) {
        throw new TypeError("beast2 v5 projection: Dict keys cannot project — they order the container; the projected key type must equal the wire key type");
      }
      const shape = {};
      const key = buildProjected(wireDict.key, wireDict.key, depth + 1);
      const value = buildProjected(wireDict.value, projDict.value, depth + 1);
      const cmp = compareFor(wireDict.key);
      return (reader, ctx) => {
        ctx.curShape = shape;
        const aliased = readContainerTag(reader, ctx);
        if (aliased !== undefined) return aliased;
        const map = new SortedMap<unknown, unknown>(undefined, cmp);
        ctx.containers.push(map);
        ctx.projShapes!.set(map, shape);
        let has = false;
        let prev: unknown;
        for (;;) {
          const n = reader.readVarint();
          if (n === 0) break;
          for (let i = 0; i < n; i++) {
            const k = key(reader, ctx);
            if (has && cmp(prev, k) >= 0) {
              throw new Error(`beast2 v5: Dict keys are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)`);
            }
            prev = k;
            has = true;
            map.set(k, value(reader, ctx));
          }
        }
        if (ctx.frozen) Object.freeze(map);
        return map;
      };
    }
    default:
      throw new TypeError(`beast2 v5 projection: a ${kindOf(wire)} must be identical to the wire type to decode (only struct fields subset; variant payloads, array elements, ref contents and dict values may project within)`);
  }
}

/**
 * Builds a decoder that reads a value of the wire type `wire` as its
 * projection `projected`: the struct fields `projected` keeps, by name, and
 * within variant payloads, array elements, ref contents and dict values, each
 * projected in turn. Any other part of `projected` must equal the wire's.
 *
 * The bytes are read as a whole decode reads them, so a value decodes to the
 * kept fields of its whole decode. A dropped field is parsed past without
 * being built; a container in it still takes a definition, and a
 * back-reference that names a container decoded to another shape than its own
 * throws {@link Beast2ProjectionAliasError}, after which the caller decodes
 * whole.
 *
 * @param wire - the type the bytes hold
 * @param projected - the type to decode them as
 * @returns the decoder, which sets up the projection's state on the context
 *   it is given
 * @throws {TypeError} When `projected` does not narrow `wire` so: a field it
 *   keeps that the wire lacks, a variant whose cases differ, a Set or a Dict's
 *   key narrowed, a function-typed field dropped, or a part of another kind
 *   that differs.
 *
 * @example
 * ```ts
 * const Row = StructType({ id: IntegerType, lines: ArrayType(StringType) });
 * const decode = buildV5ProjectedDecoder(asTypeValue(Row), asTypeValue(StructType({ id: IntegerType })));
 * // At a row's bytes in a segment: `lines` is parsed past, never built.
 * decode(reader, ctx);  // { id: 1n }
 * ```
 * @internal
 */
export function buildV5ProjectedDecoder(wire: EastTypeValue, projected: EastTypeValue): V5Decoder {
  const decode = buildProjected(wire, projected, 0);
  return (reader, ctx) => {
    ctx.projShapes ??= new WeakMap([[SKIPPED, SKIPPED_SHAPE]]);
    return decode(reader, ctx);
  };
}

/**
 * A segment decoder that decodes each element of an Array root, or each value
 * of a Dict root, as `projected` narrows it: what `Beast2Pages` decodes a
 * projected segment with. A Dict's keys decode whole and are checked to
 * ascend, as a whole segment's are.
 *
 * @param wire - the root type the bytes hold: an Array or a Dict
 * @param projected - the root type to decode them as
 * @returns the decoder of a segment's `n` elements
 * @throws {TypeError} When `projected` does not narrow `wire` (see
 *   {@link buildV5ProjectedDecoder}), or the root is a Set.
 * @internal
 */
export function buildProjectedSegmentDecoder(wire: EastTypeValue, projected: EastTypeValue): SegmentDecoder {
  if (wire.type === "Array" && projected.type === "Array") {
    const element = buildV5ProjectedDecoder(wire.value as EastTypeValue, projected.value as EastTypeValue);
    return (reader, ctx, n) => {
      const array: unknown[] = new Array(n);
      for (let i = 0; i < n; i++) array[i] = element(reader, ctx);
      if (ctx.frozen) Object.freeze(array);
      return array;
    };
  }
  if (wire.type === "Dict" && projected.type === "Dict") {
    const wireDict = wire.value as { key: EastTypeValue; value: EastTypeValue };
    const projDict = projected.value as { key: EastTypeValue; value: EastTypeValue };
    if (!isTypeValueEqual(wireDict.key, projDict.key)) {
      throw new TypeError("beast2 v5 projection: Dict keys cannot project — they order the container; the projected key type must equal the wire key type");
    }
    const key = buildV5ProjectedDecoder(wireDict.key, wireDict.key);
    const value = buildV5ProjectedDecoder(wireDict.value, projDict.value);
    const cmp = compareFor(wireDict.key);
    return (reader, ctx, n, order) => {
      const map = new SortedMap<unknown, unknown>(undefined, cmp);
      for (let i = 0; i < n; i++) {
        const k = key(reader, ctx);
        if (order) {
          if (order.has && cmp(order.prev, k) >= 0) {
            throw new Error(`beast2 v5: Dict keys are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)`);
          }
          order.prev = k;
          order.has = true;
        }
        map.set(k, value(reader, ctx));
      }
      if (ctx.frozen) Object.freeze(map);
      return map;
    };
  }
  throw new TypeError(`beast2 v5 projection: a projected segment holds an Array's elements or a Dict's values, not a ${kindOf(wire)}'s`);
}

// =============================================================================
// A loop's projection, inferred from its body
// =============================================================================

/** A mask over a struct row: the fields read, each with its own mask; `whole`
 *  for a subtree needed in full; and `elem`, for a field iterated or sized
 *  rather than read whole, the mask over an Array's element or a Dict's
 *  value. */
interface Mask {
  whole: boolean;
  readonly fields: Map<string, Mask>;
  elem: Mask | null;
}

/** The longest chain of field accesses recorded, as east-c's. */
const MAX_PATH = 64;
/** The most arguments an inline call binds, as east-c's. */
const MAX_ARGS = 16;

function newMask(): Mask {
  return { whole: false, fields: new Map(), elem: null };
}

function maskChild(mask: Mask, name: string): Mask {
  let child = mask.fields.get(name);
  if (child === undefined) {
    child = newMask();
    mask.fields.set(name, child);
  }
  return child;
}

/** Records a read of the whole of `path` below `mask`. */
function insertPath(mask: Mask, path: readonly string[]): void {
  let m = mask;
  for (const name of path) {
    if (m.whole) return;
    m = maskChild(m, name);
  }
  m.whole = true;
}

/** The node at `path`, made on the way down without marking anything whole;
 *  `null` when it, or a node above it, is already whole. */
function maskNodeAt(mask: Mask, path: readonly string[]): Mask | null {
  let m = mask;
  for (const name of path) {
    if (m.whole) return null;
    m = maskChild(m, name);
  }
  return m.whole ? null : m;
}

function maskElem(mask: Mask): Mask {
  mask.elem ??= newMask();
  return mask.elem;
}

/** The variables whose reads the walk records: the loop variable at the
 *  root, and each inner loop variable or inline call's parameter bound to the
 *  mask of what it stands for. The root escaping declines the projection; an
 *  inner one escaping marks its own subtree whole. */
interface Target {
  readonly name: string;
  readonly mask: Mask;
  readonly root: boolean;
  readonly next: Target | null;
}

function findTarget(targets: Target | null, name: string): Target | null {
  for (let t = targets; t !== null; t = t.next) if (t.name === name) return t;
  return null;
}

/** The name an IR Variable node binds or reads. */
function nameOf(node: IR): string {
  return (node as { value: { name: string } }).value.name;
}

/** `node` without the casts around it: east-c drops an `As` as it reads the
 *  IR, so the walk sees through one. */
function uncast(node: IR): IR {
  let n = node;
  while (n.type === "As") n = n.value.value as IR;
  return n;
}

type ChainRoot =
  | { readonly kind: "target"; readonly target: Target; readonly path: readonly string[] }
  | { readonly kind: "other"; readonly inner: IR }
  | { readonly kind: "decline" };

/** A chain of field accesses: rooted at a target, with its path, outermost
 *  access first; rooted elsewhere, with the expression at its root; or too
 *  deep to record. */
function chainRoot(node: IR, targets: Target | null): ChainRoot {
  const reversed: string[] = [];
  let cur = uncast(node);
  while (cur.type === "GetField") {
    if (reversed.length === MAX_PATH) return { kind: "decline" };
    reversed.push(cur.value.field);
    cur = uncast(cur.value.struct as IR);
  }
  if (cur.type !== "Variable") return { kind: "other", inner: cur };
  const target = findTarget(targets, cur.value.name);
  if (target === null) return { kind: "other", inner: cur };
  return { kind: "target", target, path: reversed.reverse() };
}

type ChainElem =
  | { readonly kind: "elem"; readonly elem: Mask }
  | { readonly kind: "none"; readonly walkExpr: boolean }
  | { readonly kind: "decline" };

/** An iteration (or a size) of `expr`: a target-rooted chain's element mask,
 *  made on the way; or nothing to narrow — `walkExpr` saying whether the
 *  caller must still walk `expr`, which it need not when the chain is already
 *  whole. */
function chainElem(expr: IR, targets: Target | null): ChainElem {
  const e = uncast(expr);
  if (e.type !== "GetField" && e.type !== "Variable") return { kind: "none", walkExpr: true };
  const root = chainRoot(e, targets);
  if (root.kind === "decline") return root;
  if (root.kind === "other") return { kind: "none", walkExpr: true };
  const node = maskNodeAt(root.target.mask, root.path);
  if (node === null) return { kind: "none", walkExpr: false };
  return { kind: "elem", elem: maskElem(node) };
}

function walkAll(nodes: readonly IR[], targets: Target | null): boolean {
  for (const node of nodes) if (!walk(node, targets)) return false;
  return true;
}

/** A call of an inline Function node: an argument that is a target-rooted
 *  chain binds the parameter it lands in to that chain's mask, so the callee's
 *  reads of the parameter are the caller's reads of the chain; any other
 *  argument is walked where it is, and its parameter shadowing a live target
 *  declines, as any binder does. */
function walkInlineCall(args: readonly IR[], parameters: readonly IR[], body: IR, targets: Target | null): boolean {
  // A chain already whole: what the parameter reads narrows nothing there.
  const whole: Mask = { whole: true, fields: new Map(), elem: null };
  let inner = targets;
  for (let i = 0; i < args.length; i++) {
    const arg = uncast(args[i]!);
    const parameter = nameOf(parameters[i]!);
    const root = arg.type === "Variable" || arg.type === "GetField" ? chainRoot(arg, targets) : { kind: "other" as const, inner: arg };
    if (root.kind === "decline") return false;
    if (root.kind === "other") {
      if (findTarget(targets, parameter) !== null) return false;
      if (!walk(args[i]!, targets)) return false;
      continue;
    }
    const node = maskNodeAt(root.target.mask, root.path);
    inner = { name: parameter, mask: node ?? whole, root: false, next: inner };
  }
  return walk(body, inner);
}

/** Walks `node`, recording the masks of `targets`: false when the root
 *  variable escapes whole, a binder shadows a target, or anything is not
 *  positively recognized — the loop then decodes whole. east-c's
 *  `paged_mask_walk`, case for case. */
function walk(node: IR, targets: Target | null): boolean {
  switch (node.type) {
    case "Value":
    case "Break":
    case "Continue":
      return true;

    case "Variable": {
      const target = findTarget(targets, node.value.name);
      if (target === null) return true;
      if (target.root) return false; // the row escapes whole
      target.mask.whole = true; // an inner element escapes: that subtree, whole
      return true;
    }

    case "GetField": {
      const root = chainRoot(node, targets);
      if (root.kind === "decline") return false;
      if (root.kind === "target") {
        insertPath(root.target.mask, root.path);
        return true;
      }
      return walk(root.inner, targets);
    }

    case "As":
      return walk(node.value.value as IR, targets);

    case "Let":
    case "Assign":
      if (findTarget(targets, nameOf(node.value.variable as IR)) !== null) return false;
      return walk(node.value.value as IR, targets);

    case "Block":
      return walkAll(node.value.statements as IR[], targets);

    case "IfElse":
      for (const branch of node.value.ifs as { predicate: IR; body: IR }[]) {
        if (!walk(branch.predicate, targets) || !walk(branch.body, targets)) return false;
      }
      return walk(node.value.else_body as IR, targets);

    case "Match":
      if (!walk(node.value.variant as IR, targets)) return false;
      for (const c of node.value.cases as { variable: IR; body: IR }[]) {
        if (findTarget(targets, nameOf(c.variable)) !== null) return false;
        if (!walk(c.body, targets)) return false;
      }
      return true;

    case "While":
      return walk(node.value.predicate as IR, targets) && walk(node.value.body as IR, targets);

    case "ForArray":
    case "ForDict": {
      const collection = (node.type === "ForArray" ? node.value.array : node.value.dict) as IR;
      if (findTarget(targets, nameOf(node.value.value as IR)) !== null) return false;
      if (findTarget(targets, nameOf(node.value.key as IR)) !== null) return false;
      // Iterating a target-rooted array narrows its items, or a dict its
      // values, to what the body reads of the loop's value variable.
      const elem = chainElem(collection, targets);
      if (elem.kind === "decline") return false;
      const walkExpr = elem.kind === "none" ? elem.walkExpr : false;
      if (walkExpr && !walk(collection, targets)) return false;
      if (elem.kind === "elem") {
        return walk(node.value.body as IR, { name: nameOf(node.value.value as IR), mask: elem.elem, root: false, next: targets });
      }
      return walk(node.value.body as IR, targets);
    }

    case "ForSet":
      // Set elements never narrow: the set is read whole.
      if (findTarget(targets, nameOf(node.value.key as IR)) !== null) return false;
      return walk(node.value.set as IR, targets) && walk(node.value.body as IR, targets);

    case "Function":
    case "AsyncFunction":
      // A parameter shadowing a target hides it; captures are declarations,
      // and the body's uses are what count.
      for (const parameter of node.value.parameters as IR[]) {
        if (findTarget(targets, nameOf(parameter)) !== null) return false;
      }
      return walk(node.value.body as IR, targets);

    case "Call":
    case "CallAsync": {
      const callee = uncast(node.value.function as IR);
      const args = node.value.arguments as IR[];
      if ((callee.type === "Function" || callee.type === "AsyncFunction") &&
        args.length === (callee.value.parameters as IR[]).length && args.length <= MAX_ARGS) {
        return walkInlineCall(args, callee.value.parameters as IR[], callee.value.body as IR, targets);
      }
      return walk(node.value.function as IR, targets) && walkAll(args, targets);
    }

    case "Platform":
      return walkAll(node.value.arguments as IR[], targets);

    case "Builtin": {
      // The size of a target-rooted array or dict reads no element field:
      // its elements narrow to nothing unless something else reads them.
      const args = node.value.arguments as IR[];
      if (args.length === 1 && (node.value.builtin === "ArraySize" || node.value.builtin === "DictSize")) {
        const elem = chainElem(args[0]!, targets);
        if (elem.kind === "decline") return false;
        if (elem.kind === "elem" || !elem.walkExpr) return true;
      }
      return walkAll(args, targets);
    }

    case "Return":
      return walk(node.value.value as IR, targets);

    case "Error":
      return walk(node.value.message as IR, targets);

    case "TryCatch":
      if (findTarget(targets, nameOf(node.value.message as IR)) !== null) return false;
      if (findTarget(targets, nameOf(node.value.stack as IR)) !== null) return false;
      return walk(node.value.try_body as IR, targets) && walk(node.value.catch_body as IR, targets) &&
        walk(node.value.finally_body as IR, targets);

    case "NewArray":
    case "NewSet":
    case "NewVector":
    case "NewMatrix":
      return walkAll(node.value.values as IR[], targets);

    case "NewDict":
      for (const entry of node.value.values as { key: IR; value: IR }[]) {
        if (!walk(entry.key, targets) || !walk(entry.value, targets)) return false;
      }
      return true;

    case "NewRef":
    case "Variant":
    case "WrapRecursive":
    case "UnwrapRecursive":
      return walk(node.value.value as IR, targets);

    case "Struct":
      for (const field of node.value.fields as { value: IR }[]) {
        if (!walk(field.value, targets)) return false;
      }
      return true;

    default:
      return false; // a kind the walk has not been taught: decline
  }
}

/** The type `mask` keeps of `wire`, in the wire's field order: struct fields
 *  by name, and through an iterated Array's element or Dict's value by its
 *  element mask. `wire` itself when nothing narrows. */
function maskToType(wire: EastTypeValue, mask: Mask): EastTypeValue {
  if (mask.whole) return wire;
  switch (wire.type) {
    case "Struct": {
      const fields = (wire.value as { name: string; type: EastTypeValue }[])
        .filter((field) => mask.fields.has(field.name))
        .map((field) => ({ name: field.name, type: maskToType(field.type, mask.fields.get(field.name)!) }));
      return variant("Struct", fields) as EastTypeValue;
    }
    case "Array": {
      if (mask.elem === null) return wire;
      const element = maskToType(wire.value as EastTypeValue, mask.elem);
      return isTypeValueEqual(element, wire.value as EastTypeValue) ? wire : variant("Array", element) as EastTypeValue;
    }
    case "Dict": {
      if (mask.elem === null) return wire;
      const dict = wire.value as { key: EastTypeValue; value: EastTypeValue };
      const value = maskToType(dict.value, mask.elem);
      return isTypeValueEqual(value, dict.value) ? wire : variant("Dict", { key: dict.key, value }) as EastTypeValue;
    }
    default:
      return wire;
  }
}

/** The projection a loop's body admits over `root`, with its segment decoder:
 *  what {@link loopProjectionType} says, built. */
function loopProjection(body: IR, target: string, root: EastTypeValue): { type: EastTypeValue; decoder: SegmentDecoder } | null {
  let row: EastTypeValue;
  if (root.type === "Array") row = root.value as EastTypeValue;
  else if (root.type === "Dict") row = (root.value as { value: EastTypeValue }).value;
  else return null; // Set elements are keys: they never narrow
  if (row.type !== "Struct") return null;

  const mask = newMask();
  if (!walk(body, { name: target, mask, root: true, next: null }) || mask.whole) return null;
  const narrow = maskToType(row, mask);
  if (isTypeValueEqual(narrow, row)) return null; // every field read
  const type = root.type === "Array"
    ? variant("Array", narrow) as EastTypeValue
    : variant("Dict", { key: (root.value as { key: EastTypeValue }).key, value: narrow }) as EastTypeValue;
  try {
    return { type, decoder: buildProjectedSegmentDecoder(root, type) };
  } catch (err) {
    // A plan the builder refuses — a dropped function-typed field: decode
    // whole.
    if (err instanceof TypeError) return null;
    throw err;
  }
}

/**
 * The projection a `$.for` over a lazy collection decodes its segments to:
 * the struct fields its body reads of the loop's value variable — an Array's
 * element, a Dict's value — through chains of field accesses, following inner
 * loops into nested Arrays and Dicts and inline calls into their bodies. Any
 * other use of the variable, a binder that shadows it, or an IR node the walk
 * has not been taught declines, and the loop decodes whole. Dict keys and Set
 * elements never narrow.
 *
 * This is east-c's `east_beast2_projection_for_loop`, rule for rule, so every
 * runtime decodes a loop's segments to the same fields.
 *
 * @param body - the loop's body
 * @param target - the name of the loop's value variable
 * @param root - the type of the collection the loop walks
 * @returns the root type narrowed to what the body reads, or `null` when the
 *   loop decodes whole: it declined, it reads every field, the row is not a
 *   struct, or the narrowing would drop a function-typed field
 * @internal
 */
export function loopProjectionType(body: IR, target: string, root: EastTypeValue): EastTypeValue | null {
  return loopProjection(body, target, root)?.type ?? null;
}

/**
 * What a compiled loop decodes a lazy collection's segments with, given the
 * type its bytes hold: the decoder of its projection, or `null` to decode
 * whole.
 *
 * @internal
 */
export type LoopProjector = (wire: EastTypeValue) => SegmentDecoder | null;

/**
 * The projector of a compiled `$.for`: for each type the collections it walks
 * hold, the projection {@link loopProjectionType} infers from its body, built
 * the first time the loop meets that type. As east-c's, the projection follows
 * the type the bytes hold, not the type the program declared.
 *
 * @param body - the loop's body
 * @param target - the name of the loop's value variable
 * @returns the loop's projector
 * @internal
 */
export function loopProjectorFor(body: IR, target: string): LoopProjector {
  const built = new WeakMap<EastTypeValue, SegmentDecoder | null>();
  return (wire) => {
    let decoder = built.get(wire);
    if (decoder === undefined) {
      decoder = loopProjection(body, target, wire)?.decoder ?? null;
      built.set(wire, decoder);
    }
    return decoder;
  };
}

// =============================================================================
// What paged loops came to
// =============================================================================

/**
 * What the compiled loops over lazy collections have decoded: the account
 * {@link beast2PagedLoopStats} gives.
 */
export type Beast2PagedLoopStats = {
  /** The segments decoded to the fields their loops' bodies read. */
  segmentsProjected: number;
  /** The segments decoded whole: by a loop that infers no projection, a
   *  Set's, or one whose projected decode fell back. */
  segmentsWhole: number;
};

let segmentsProjected = 0;
let segmentsWhole = 0;

/**
 * Counts one segment a compiled loop over a lazy collection decoded:
 * projected, or whole — a loop that infers no projection, a Set's, or a
 * segment whose projected decode fell back.
 *
 * @param projected - whether the segment was decoded projected
 * @internal
 */
export function countPagedLoopSegment(projected: boolean): void {
  if (projected) segmentsProjected++;
  else segmentsWhole++;
}

/**
 * What the compiled loops over lazy collections have decoded in this process:
 * how many segments to the fields their bodies read, and how many whole. A
 * runner's `-v` reports it beside its account of each lazy input, as east-c's
 * runners report theirs, so a unit's log says whether projection applied.
 *
 * @returns the segments decoded projected and whole, since the process began
 *
 * @example
 * ```ts
 * const { segmentsProjected, segmentsWhole } = beast2PagedLoopStats();
 * ```
 */
export function beast2PagedLoopStats(): Beast2PagedLoopStats {
  return { segmentsProjected, segmentsWhole };
}
