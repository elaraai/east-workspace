/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The East programs a nested series index's declaration builds (#1434): a
 * row's entries, `(K, V) → Dict<IK, P>`, and its lean form, `(K, V) → V`.
 *
 * A row's nodes are walked a group at a time ({@link NestedGroup}): the row
 * itself, then each group's nodes from its parent group's — a node's child
 * rows under its field, and beside `recursive()` every row beneath them
 * through it, by East's `flattenTree`. Each node carries its path, the Dict
 * keys from the row down, and the node above it. Of a collection's group:
 *
 * - each item is filed by #1433's levels (`eventFilings`), carrying the item;
 * - each node's totals are kept a summary tile at a time;
 * - an item rolled up is filed under every ancestor too, and each ancestor
 *   keeps its subtree's totals;
 * - a collection of values rolled up keeps every parent's subtotals, composed
 *   bottom-up by East's `toTree` over the nodes from the row down to it, each
 *   node's result carrying its subtree's subtotals to its parent.
 *
 * The functions here are typed East over fixed shapes, or factories of one
 * from a declaration's types, which a row's entries chain together. The one
 * place a node is read or rebuilt by the names a declaration gives, and an
 * item placed in its place's variants, is marked so: East names a struct's
 * fields, and a variant's cases, where its code is written.
 *
 * @packageDocumentation
 */
import {
  ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, SetType, StringType, StructType, none, some, variant,
  type EastType, type ExprType, type FunctionExpr,
} from '@elaraai/east';
import {
  NestedEntryKeyType, NestedEntryType, RecordLevelType, RecordNestedPathType, RecordNestedTotalsType, RecordRollupType,
  type RecordLevel,
} from '@elaraai/e3-types';
import { checkNested, type NestedCollection, type NestedDeclaration, type NestedGroup, type NestedItems, type NestedValues } from './record-nested.js';
import { INDEX_PURITY, checkEntryParams, checkPure, indexRunner, indexedEntry, onlyOptions, signatureOf } from './record-guards.js';
import { readerOf } from './record-keys.js';
import { RECORD_TILES, TileShareType, checkTile, placedFilings, placedShares, tileStart, type RecordTile } from './record-tiles.js';
import type { RecordDef, RecordIndexDef } from './types.js';
import type { FunctionRunner } from './runner.js';

// ── Fixed shapes ──────────────────────────────────────────────────────────────

/** A node's keys, from the row down to it, as a row's tree is walked: an Array, which a key may not hold. */
const KeysType = ArrayType(StringType);

/** A node of a row's tree: its keys, and its group, which tells nodes of two groups at one path apart. */
const NodeKeyType = StructType({ path: KeysType, group: IntegerType });

/**
 * A node of a group, as the walk gives it: its keys, the node above it — none
 * for the row — and the node itself.
 *
 * @param node - The group's node type
 * @returns The struct type
 */
function NodeAtType(node: EastType) {
  return StructType({ path: KeysType, parent: OptionType(NodeKeyType), node });
}

/**
 * A node of a group: `(keys, parent, node) → NodeAt`.
 *
 * @param node - The group's node type
 * @returns The constructor
 */
function nodeAtOf(node: EastType) {
  const type = NodeAtType(node);
  return East.function([KeysType, OptionType(NodeKeyType), node], type, (_$, path, parent, at) => ({ path, parent, node: at }));
}

/** `(keys) → Path`: a node's keys as a key holds them (e3-types' `RecordNestedPathType`), folded from the last. */
const pathOf = East.function([KeysType], RecordNestedPathType, ($, keys) => {
  const end = $.const(variant('end', null), RecordNestedPathType);
  return keys.reverse().reduce((_$, rest, key) => variant('step', { key, rest }), end);
});

/** No totals: a tile's before any item touches it. */
const NO_TOTALS = { count: 0n, ms: 0n, values: none };

/** `(shares) → Dict<tile, Totals>`: items' totals in each summary tile they touch — how many, and the milliseconds they cover. */
const sharedTotals = East.function([ArrayType(TileShareType)], DictType(DateTimeType, RecordNestedTotalsType), (_$, shares) =>
  shares.groupReduce(
    (_$, share) => share.tile,
    ($) => $.const(NO_TOTALS, RecordNestedTotalsType),
    (_$, totals, share) => ({ count: totals.count.add(1n), ms: totals.ms.add(share.ms), values: totals.values }),
  ));

/** `(instants, level) → Dict<tile, Totals>`: values' totals in each summary tile, an instant covering none of it: how many. */
const instantTotals = East.function([SetType(DateTimeType), RecordLevelType], DictType(DateTimeType, RecordNestedTotalsType), ($, instants, level) => {
  const startOf = $.const(tileStart);
  return instants.groupReduce(
    (_$, at) => startOf(level, at),
    ($) => $.const(NO_TOTALS, RecordNestedTotalsType),
    (_$, totals) => ({ count: totals.count.add(1n), ms: totals.ms, values: totals.values }),
  );
});

/**
 * `(values, level) → Dict<tile, Totals>`: Float values' totals in each summary
 * tile — how many, and their sum, the least, the greatest and the value at the
 * latest instant, taken in key order, so every runtime adds them alike.
 */
const valueTotals = East.function([DictType(DateTimeType, FloatType), RecordLevelType], DictType(DateTimeType, RecordNestedTotalsType), ($, values, level) => {
  const startOf = $.const(tileStart);
  return values.groupReduce(
    (_$, _value, at) => startOf(level, at),
    ($) => $.const(NO_TOTALS, RecordNestedTotalsType),
    (_$, totals, value) => ({
      count: totals.count.add(1n),
      ms: totals.ms,
      values: some(totals.values.match({
        none: () => ({ sum: value, min: value, max: value, last: value }),
        some: (_$, was) => ({ sum: was.sum.add(value), min: East.min(was.min, value), max: East.max(was.max, value), last: value }),
      })),
    }),
  );
});

/** `(Integer) → Float`: an Integer value as its totals and subtotals take it. */
const integerAsFloat = East.function([IntegerType], FloatType, (_$, value) => value.toFloat());

/** `(Float) → Float`: a Float value as its totals and subtotals take it. */
const floatAsFloat = East.function([FloatType], FloatType, (_$, value) => value);

/** `(keys) → Option<keys>`: the keys of the node above, within a walk of a Dict's rows; none for one of its own. */
const keysAbove = East.function([KeysType], OptionType(KeysType), (_$, keys) =>
  East.greater(keys.size(), 1n).ifElse(() => some(keys.slice(0n, keys.size().subtract(1n))), () => none));

// ── Parents' subtotals: composed bottom-up ────────────────────────────────────

/** A node of the tree from a row down to a collection of values rolled up: where it is, the node above it, and its own values as Floats. */
const SubtotalNodeType = StructType({ key: NodeKeyType, parent: OptionType(NodeKeyType), own: DictType(DateTimeType, FloatType) });

/** What a node draws by one rollup, at one level, in one tile. */
const DrawKeyType = StructType({ rollup: RecordRollupType, level: RecordLevelType, tile: DateTimeType });

/** A parent's subtotal: its path, the rollup, the level and the tile. */
const SubtotalKeyType = StructType({ path: RecordNestedPathType, rollup: RecordRollupType, level: RecordLevelType, tile: DateTimeType });

/** A node's result, carried to its parent: what it draws, and the subtotals of every parent at or beneath it. */
const ComposedType = StructType({ draws: DictType(DrawKeyType, FloatType), subtotals: DictType(SubtotalKeyType, FloatType) });

/** What a node's own values in a tile come to, before a rollup's fold picks one: their sum and how many, the least, the greatest and the latest. */
const FoldedType = StructType({ sum: FloatType, n: IntegerType, min: FloatType, max: FloatType, last: FloatType });

/** What a parent's children draw in a tile come to, before a rollup's aggregate picks one. */
const GatheredType = StructType({ sum: FloatType, n: IntegerType, min: FloatType, max: FloatType });

/** `(own, level) → Dict<tile, Folded>`: a node's own values a tile of a level at a time, in key order. */
const foldedTiles = East.function([DictType(DateTimeType, FloatType), RecordLevelType], DictType(DateTimeType, FoldedType), ($, own, level) => {
  const startOf = $.const(tileStart);
  return own.groupReduce(
    (_$, _value, at) => startOf(level, at),
    ($) => $.const({ sum: 0.0, n: 0n, min: 0.0, max: 0.0, last: 0.0 }, FoldedType),
    (_$, folded, value) => ({
      sum: folded.sum.add(value),
      n: folded.n.add(1n),
      min: East.equal(folded.n, 0n).ifElse(() => value, () => East.min(folded.min, value)),
      max: East.equal(folded.n, 0n).ifElse(() => value, () => East.max(folded.max, value)),
      last: value,
    }),
  );
});

/** `(folded, rollup) → Float`: a node's own values in a tile, folded by a rollup's fold. */
const foldedBy = East.function([FoldedType, RecordRollupType], FloatType, (_$, folded, rollup) =>
  rollup.fold.match({
    sum: () => folded.sum,
    mean: () => folded.sum.divide(folded.n.toFloat()),
    min: () => folded.min,
    max: () => folded.max,
    last: () => folded.last,
    count: () => folded.n.toFloat(),
  }));

/**
 * `(folded, rollup) → Float`: what a node holding values draws in a tile by a
 * rollup: its values folded; under a count, one — a leaf row with a value,
 * whatever the value.
 */
const ownDraw = East.function([FoldedType, RecordRollupType], FloatType, ($, folded, rollup) => {
  const fold = $.const(foldedBy);
  return rollup.aggregate.match({ count: () => 1.0 }, () => fold(folded, rollup));
});

/** `(own, rollups, levels) → Dict<DrawKey, Float>`: what a node holding values draws, by each rollup, at each level, in each tile its values touch. */
const ownDraws = East.function(
  [DictType(DateTimeType, FloatType), ArrayType(RecordRollupType), ArrayType(RecordLevelType)], DictType(DrawKeyType, FloatType),
  ($, own, rollups, levels) => {
    const tiles = $.const(foldedTiles);
    const draw = $.const(ownDraw);
    return levels.flattenToDict((_$, level) => tiles(own, level).flattenToDict((_$, folded, tile) =>
      rollups.toDict((_$, rollup) => ({ rollup, level, tile }), (_$, rollup) => draw(folded, rollup))));
  },
);

/**
 * `(children) → Dict<DrawKey, Float>`: what a parent draws, by each rollup, at
 * each level, in each tile one of its children draws in: what they draw there,
 * in key order, by the rollup's aggregate — their sum, mean, least or
 * greatest; under a count, their counts' sum.
 */
const childDraws = East.function([ArrayType(ComposedType)], DictType(DrawKeyType, FloatType), ($, children) => {
  const drawn = $.let(children.flatMap((_$, child) => child.draws.toArray((_$, value, key) => ({ key, value }))));
  const gathered = $.let(drawn.groupReduce(
    (_$, draw) => draw.key,
    ($) => $.const({ sum: 0.0, n: 0n, min: 0.0, max: 0.0 }, GatheredType),
    (_$, all, draw) => ({
      sum: all.sum.add(draw.value),
      n: all.n.add(1n),
      min: East.equal(all.n, 0n).ifElse(() => draw.value, () => East.min(all.min, draw.value)),
      max: East.equal(all.n, 0n).ifElse(() => draw.value, () => East.max(all.max, draw.value)),
    }),
  ));
  return gathered.map((_$, all, key) => key.rollup.aggregate.match({
    sum: () => all.sum,
    mean: () => all.sum.divide(all.n.toFloat()),
    min: () => all.min,
    max: () => all.max,
    count: () => all.sum,
  }));
});

/**
 * `(node, children, rollups, levels) → Composed`: a node's result. One holding
 * values of its own draws them, and keeps no subtotal; one holding none draws
 * its children's, and keeps what it draws, where it draws, as its subtotals.
 * Either way, it carries every subtotal beneath it on to its parent.
 */
const composed = East.function(
  [SubtotalNodeType, ArrayType(ComposedType), ArrayType(RecordRollupType), ArrayType(RecordLevelType)], ComposedType,
  ($, node, children, rollups, levels) => {
    const own = $.const(ownDraws);
    const gathered = $.const(childDraws);
    const path = $.const(pathOf);
    const beneath = $.let(children.flatMap((_$, child) => child.subtotals.toArray((_$, value, key) => ({ key, value })))
      .toDict((_$, subtotal) => subtotal.key, (_$, subtotal) => subtotal.value));
    $.if(East.greater(node.own.size(), 0n), ($) => {
      $.return({ draws: own(node.own, rollups, levels), subtotals: beneath });
    });
    const draws = $.let(gathered(children));
    const here = $.let(path(node.key.path));
    $(beneath.unionInPlace(draws.toDict(
      (_$, _value, key) => ({ path: here, rollup: key.rollup, level: key.level, tile: key.tile }),
      (_$, value) => value,
    )));
    return { draws, subtotals: beneath };
  },
);

/**
 * `(nodes, rollups, levels) → Dict<SubtotalKey, Float>`: every parent's
 * subtotals of a collection of values, composed bottom-up by `toTree` over the
 * nodes from the row down to the collection, each node's result carried to
 * its parent. A tile no descendant's value touches has none.
 */
const subtotalsOf = East.function(
  [ArrayType(SubtotalNodeType), ArrayType(RecordRollupType), ArrayType(RecordLevelType)], DictType(SubtotalKeyType, FloatType),
  ($, nodes, rollups, levels) => {
    const compose = $.const(composed);
    const roots = $.let(nodes.toTree(ComposedType, (_$, node) => node.key, (_$, node) => node.parent,
      (_$, node, _i, children) => compose(node, children, rollups, levels)));
    return roots.flatMap((_$, root) => root.subtotals.toArray((_$, value, key) => ({ key, value })))
      .toDict((_$, subtotal) => subtotal.key, (_$, subtotal) => subtotal.value);
  },
);

// ── What a declaration's types make ───────────────────────────────────────────

/** An entry's key, `IK` (e3-types' `NestedEntryKeyType`), at some row key. */
type EntryKeyType = ReturnType<typeof NestedEntryKeyType<EastType>>;

/** An entry's value, `P` (e3-types' `NestedEntryType`), at some places. */
type EntryValueType = ReturnType<typeof NestedEntryType<EastType>>;

/** A row's entries, `Dict<IK, P>`. */
type EntriesType = DictType<EntryKeyType, EntryValueType>;

/** The types a nested series index's programs are built over. */
interface NestedTypes {
  /** The record's key type, `K`. */
  readonly keyType: EastType;
  /** The record's row type, `V`. */
  readonly rowType: EastType;
  /** The entry key, `IK`. */
  readonly entryKey: EntryKeyType;
  /** The entry value, `P`. */
  readonly entryValue: EntryValueType;
  /** A row's entries, `Dict<IK, P>`. */
  readonly entries: EntriesType;
  /** The index's finest level, as a level. */
  readonly tile: RecordLevel;
  /** The summary tile, as a level; none where no totals are kept. */
  readonly summary: RecordLevel | undefined;
  /** The levels a parent's subtotals are kept at: from the index's tile up to the year. */
  readonly levels: readonly RecordLevel[];
}

/** A row's entries of one part of the index: `(K, V) → Dict<IK, P>`. */
type RowEntries = FunctionExpr<[EastType, EastType], EntriesType>;

/** A group's nodes from a row: `(V) → Array<NodeAt>`. */
type NodesOf = FunctionExpr<[EastType], ArrayType<ReturnType<typeof NodeAtType>>>;

/** A level, as an index keeps it. */
function levelOf(tile: RecordTile): RecordLevel {
  return variant(tile, null);
}

/** The groups from the row down to one, the row's first. */
function chainTo(decl: NestedDeclaration, group: number): readonly NestedGroup[] {
  const chain: NestedGroup[] = [];
  for (let at: NestedGroup | undefined = decl.groups[group]; at !== undefined; at = at.parent === undefined ? undefined : decl.groups[at.parent.group]) {
    chain.unshift(at);
  }
  return chain;
}

/* eslint-disable east/east-rules -- a node read and rebuilt by the field names a declaration gives, an item placed in its place's variants by the case names it gives, and a collection's numbers as Floats, of a type it gives: East names a struct's fields, a variant's cases and a value's type where its code is written */

/** A node's fields by name: the one cast the readers make, of names every caller checked against the node's type. */
function byName(fields: unknown): Readonly<Record<string, ExprType<EastType>>> {
  return fields as Readonly<Record<string, ExprType<EastType>>>;
}

/** A node's fields: a recursive node's, unwrapped. */
function fieldsOf(nodeType: EastType, node: ExprType<EastType>): Readonly<Record<string, ExprType<EastType>>> {
  return byName(nodeType.type === 'Recursive' ? (node as unknown as { unwrap(): unknown }).unwrap() : node);
}

/**
 * A collection's values as Floats: `(Dict<DateTime, V>) → Dict<DateTime,
 * Float>`, an Integer's converted — the declaration checked they are numbers.
 *
 * @param valueType - The values' type
 * @param numeric - Their kind
 * @returns The conversion
 */
function floatsOf(valueType: EastType, numeric: 'Float' | 'Integer'): FunctionExpr<[EastType], DictType<DateTimeType, FloatType>> {
  const asFloat = (numeric === 'Integer' ? integerAsFloat : floatAsFloat) as FunctionExpr<[EastType], FloatType>;
  return East.function([DictType(DateTimeType, valueType)], DictType(DateTimeType, FloatType), ($, values) => {
    const float = $.const(asFloat);
    return values.map((_$, value) => float(value));
  });
}

/**
 * A node's field: `(N) → T`, the field named, which the declaration checked
 * is of the type given.
 *
 * @param nodeType - The node's type: a Struct, or a RecursiveType of one
 * @param field - The field
 * @param type - Its type
 * @returns The reader
 */
function fieldOf<T extends EastType>(nodeType: EastType, field: string, type: T): FunctionExpr<[EastType], T> {
  return East.function([nodeType], type, (_$, node) => fieldsOf(nodeType, node)[field]! as never);
}

/**
 * A node rebuilt: `(N, …) → N`, each field named given what its function makes
 * of the node, every other field as it is.
 *
 * @param nodeType - The node's type: a Struct, or a RecursiveType of one
 * @param fields - The fields rebuilt, each by a function of the node
 * @returns The rebuild
 */
function rebuiltNode(nodeType: EastType, fields: Readonly<Record<string, FunctionExpr<[EastType], EastType>>>): FunctionExpr<[EastType], EastType> {
  const struct = nodeType.type === 'Recursive' ? nodeType.node : nodeType;
  if (struct.type !== 'Struct') throw new Error(`a nested series index's node is a Struct, not ${struct.type}`);
  return East.function([nodeType], nodeType, ($, node) => {
    const held = fieldsOf(nodeType, node);
    return Object.fromEntries(Object.keys(struct.fields).map((name) => {
      const make = fields[name];
      return [name, make === undefined ? held[name]! : $.const(make)(node)];
    })) as never;
  });
}

/**
 * A node with its rows under one field replaced: `(N, Dict<String, N>) → N`.
 *
 * @param nodeType - The node's type: a RecursiveType of a Struct
 * @param field - The field holding the rows
 * @returns The rebuild
 */
function withRows(nodeType: EastType, field: string): FunctionExpr<[EastType, EastType], EastType> {
  const struct = nodeType.type === 'Recursive' ? nodeType.node : nodeType;
  if (struct.type !== 'Struct') throw new Error(`a nested series index's node is a Struct, not ${struct.type}`);
  return East.function([nodeType, DictType(StringType, nodeType)], nodeType, (_$, node, rows) => {
    const held = fieldsOf(nodeType, node);
    return Object.fromEntries(Object.keys(struct.fields).map((name) => [name, name === field ? rows : held[name]!])) as never;
  });
}

/**
 * An item of a collection as its entry carries it: `(I) → P`, the item placed
 * in the variants of the collection's place, nesting as the declaration
 * nests (`.item .members .load 0.82`).
 *
 * @param decl - The declaration
 * @param collection - The collection
 * @param itemType - Its items' type
 * @param entryValue - The entry value, `P`
 * @returns The placing
 */
function placedItem(decl: NestedDeclaration, collection: NestedCollection, itemType: EastType, entryValue: EntryValueType): FunctionExpr<[EastType], EntryValueType> {
  // The cases from the item out: its field in its group's places, then each rows field in its parent's.
  const cases: { readonly name: string; readonly type: EastType }[] = [];
  for (let group = decl.groups[collection.group]!, name = collection.field; ;) {
    cases.push({ name, type: group.places });
    if (group.parent === undefined) break;
    name = group.parent.field;
    group = decl.groups[group.parent.group]!;
  }
  cases.push({ name: 'item', type: entryValue });
  return East.function([itemType], entryValue, (_$, item) =>
    cases.reduce<ExprType<EastType>>((inner, at) => East.value(variant(at.name, inner) as never, at.type), item) as never);
}

/* eslint-enable east/east-rules */

/** The empty collection a lean node holds in place of a listed one: `(N) → Dict<…>`, empty. */
function emptied(nodeType: EastType, type: EastType): FunctionExpr<[EastType], EastType> {
  return East.function([nodeType], type, () => new Map());
}

/** A node above a collection's group, which holds none of its values: `(N) → Dict<DateTime, Float>`, empty. */
function noValues(nodeType: EastType): FunctionExpr<[EastType], DictType<DateTimeType, FloatType>> {
  return East.function([nodeType], DictType(DateTimeType, FloatType), () => new Map());
}

// ── A row's nodes ─────────────────────────────────────────────────────────────

/**
 * Each group's nodes from the row: `(V) → Array<NodeAt>`, the row's own the
 * row, and each other group's its parent group's nodes' child rows under its
 * field — beside `recursive()`, with every row beneath them through it, by
 * `flattenTree` — each with its keys and the node above it.
 */
function groupNodes(decl: NestedDeclaration, rowType: EastType): readonly NodesOf[] {
  const nodes: NodesOf[] = [];
  for (const group of decl.groups) {
    const nodeAt = ArrayType(NodeAtType(group.type));
    const make = nodeAtOf(group.type);
    if (group.parent === undefined) {
      nodes.push(East.function([rowType], nodeAt, ($, row) => {
        const at = $.const(make);
        return [at([], none, row)];
      }));
      continue;
    }
    const parent = decl.groups[group.parent.group]!;
    const above = nodes[parent.index]!;
    const rowsOf = fieldOf(parent.type, group.parent.field, DictType(StringType, group.type));
    const parentGroup = BigInt(parent.index);
    const ownGroup = BigInt(group.index);
    if (group.through === undefined) {
      nodes.push(East.function([rowType], nodeAt, ($, row) => {
        const up = $.const(above);
        const rows = $.const(rowsOf);
        const nodeAt = $.const(make);
        return up(row).flatMap((_$, at) => rows(at.node).toArray((_$, node, key) =>
          nodeAt(at.path.concat([key]), some({ path: at.path, group: parentGroup }), node)));
      }));
      continue;
    }
    const deeper = fieldOf(group.type, group.through, DictType(StringType, group.type));
    nodes.push(East.function([rowType], nodeAt, ($, row) => {
      const up = $.const(above);
      const rows = $.const(rowsOf);
      const beneath = $.const(deeper);
      const keysOver = $.const(keysAbove);
      const nodeAt = $.const(make);
      return up(row).flatMap((_$, at) => rows(at.node).flattenTree((_$, node) => beneath(node)).map((_$, entry) => nodeAt(
        at.path.concat(entry.path),
        // A node's parent: the row above it in this walk, or the parent group's node holding the walk's root.
        some(keysOver(entry.path).match({
          some: (_$, keys) => ({ path: at.path.concat(keys), group: ownGroup }),
          none: () => ({ path: at.path, group: parentGroup }),
        })),
        entry.node,
      )));
    }));
  }
  return nodes;
}

// ── A collection's entries ────────────────────────────────────────────────────

/** A collection's words in a refusal: the row's key, its place, and the item's key, printed. */
function whatWords(collection: NestedCollection): string {
  return collection.place.join(' ');
}

/** Things people drag, filed: `(K, V) → Dict<IK, P>`, each item once (or once a year past a year), at the level its length fits, under its node. */
function itemEntries(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, nodesOf: NodesOf): RowEntries {
  const group = decl.groups[collection.group]!;
  const { keyType, rowType, entryKey, entries, tile } = types;
  const holding = fieldOf(group.type, collection.field, DictType(StringType, collection.itemType));
  const times = readerOf(StringType, collection.itemType, { start: { option: collection.start }, end: { option: collection.end } }).fn;
  const place = placedItem(decl, collection, collection.itemType, types.entryValue);
  const words = whatWords(collection);
  return East.function([keyType, rowType], entries, ($, key, row) => {
    const nodes = $.const(nodesOf);
    const held = $.const(holding);
    const read = $.const(times);
    const file = $.const(placedFilings);
    const into = $.const(place);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return nodes(row).flattenToDict(($, node) => {
      const here = $.let(path(node.path));
      return held(node.node).flattenToDict(($, item, id) => {
        const at = $.let(read(id, item));
        const value = $.let(into(item));
        return file(tile, at.start, at.end, East.str`${East.print(key)} ${words} ${East.print(id)}`).toDict(
          (_$, filing) => East.value({
            collection: collectionPath, row: key, path: here, run: variant('items', null), level: filing.level, tile: filing.tile,
            item: variant('id', id),
          }, entryKey),
          () => value,
        );
      });
    });
  });
}

/**
 * Things people drag rolled up, filed under every ancestor too: `(K, V) →
 * Dict<IK, P>`, in the run `subtree` of the row and of each node on the way,
 * at the level and tile of the item's own filing, the keys from the ancestor
 * down naming the item.
 */
function itemSubtreeEntries(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, nodesOf: NodesOf): RowEntries {
  const group = decl.groups[collection.group]!;
  const { keyType, rowType, entryKey, entries, tile } = types;
  const holding = fieldOf(group.type, collection.field, DictType(StringType, collection.itemType));
  const times = readerOf(StringType, collection.itemType, { start: { option: collection.start }, end: { option: collection.end } }).fn;
  const place = placedItem(decl, collection, collection.itemType, types.entryValue);
  const words = whatWords(collection);
  return East.function([keyType, rowType], entries, ($, key, row) => {
    const nodes = $.const(nodesOf);
    const held = $.const(holding);
    const read = $.const(times);
    const file = $.const(placedFilings);
    const into = $.const(place);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return nodes(row).flattenToDict(($, node) => held(node.node).flattenToDict(($, item, id) => {
      const at = $.let(read(id, item));
      const value = $.let(into(item));
      const filings = $.let(file(tile, at.start, at.end, East.str`${East.print(key)} ${words} ${East.print(id)}`));
      return East.Array.range(0n, node.path.size()).flattenToDict(($, depth) => {
        const ancestor = $.let(path(node.path.slice(0n, depth)));
        const under = $.let(variant('under', { path: path(node.path.slice(depth, node.path.size())), id }));
        return filings.toDict(
          (_$, filing) => East.value({
            collection: collectionPath, row: key, path: ancestor, run: variant('subtree', null), level: filing.level, tile: filing.tile,
            item: under,
          }, entryKey),
          () => value,
        );
      });
    }));
  });
}

/**
 * Each node's items' shares of the summary tiles they touch: `(K, V) →
 * Array<{ path, shares }>`, an item with no start touching none.
 */
function itemShares(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, summary: RecordLevel, nodesOf: NodesOf) {
  const group = decl.groups[collection.group]!;
  const holding = fieldOf(group.type, collection.field, DictType(StringType, collection.itemType));
  const times = readerOf(StringType, collection.itemType, { start: { option: collection.start }, end: { option: collection.end } }).fn;
  const words = whatWords(collection);
  return East.function([types.keyType, types.rowType], ArrayType(StructType({ path: KeysType, shares: ArrayType(TileShareType) })), ($, key, row) => {
    const nodes = $.const(nodesOf);
    const held = $.const(holding);
    const read = $.const(times);
    const share = $.const(placedShares);
    return nodes(row).map((_$, node) => ({
      path: node.path,
      shares: held(node.node).flattenToArray(($, item, id) => {
        const at = $.let(read(id, item));
        return share(summary, at.start, at.end, East.str`${East.print(key)} ${words} ${East.print(id)}`);
      }),
    }));
  });
}

/** Things people drag, totalled: `(K, V) → Dict<IK, P>`, each node's items' count and milliseconds in each summary tile they touch. */
function itemTotals(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, summary: RecordLevel, nodesOf: NodesOf): RowEntries {
  const { keyType, rowType, entryKey, entryValue, entries } = types;
  const sharesOf = itemShares(decl, types, collection, summary, nodesOf);
  return East.function([keyType, rowType], entries, ($, key, row) => {
    const shared = $.const(sharesOf);
    const totalled = $.const(sharedTotals);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return shared(key, row).flattenToDict(($, node) => {
      const here = $.let(path(node.path));
      return totalled(node.shares).toDict(
        (_$, _totals, tile) => East.value({
          collection: collectionPath, row: key, path: here, run: variant('totals', null), level: summary, tile, item: variant('none', null),
        }, entryKey),
        (_$, totals) => East.value(variant('totals', totals), entryValue),
      );
    });
  });
}

/** Things people drag rolled up, each ancestor's totals of its subtree's items: `(K, V) → Dict<IK, P>`, in the run `subtreeTotals`. */
function itemSubtreeTotals(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, summary: RecordLevel, nodesOf: NodesOf): RowEntries {
  const { keyType, rowType, entryKey, entryValue, entries } = types;
  const sharesOf = itemShares(decl, types, collection, summary, nodesOf);
  return East.function([keyType, rowType], entries, ($, key, row) => {
    const shared = $.const(sharesOf);
    const totalled = $.const(sharedTotals);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    // Every node's shares, under each of its ancestors: the row, and each node on the way.
    const beneath = $.let(shared(key, row).flatMap((_$, node) => East.Array.range(0n, node.path.size()).flatMap((_$, depth) =>
      node.shares.map((_$, share) => ({ ancestor: path(node.path.slice(0n, depth)), share })))));
    return beneath.groupToArrays((_$, at) => at.ancestor, (_$, at) => at.share).flattenToDict((_$, shares, ancestor) =>
      totalled(shares).toDict(
        (_$, _totals, tile) => East.value({
          collection: collectionPath, row: key, path: ancestor, run: variant('subtreeTotals', null), level: summary, tile,
          item: variant('none', null),
        }, entryKey),
        (_$, totals) => East.value(variant('totals', totals), entryValue),
      ));
  });
}

/** A collection of values, filed: `(K, V) → Dict<IK, P>`, each value at its instant, at the index's tile. */
function valueEntries(decl: NestedDeclaration, types: NestedTypes, collection: NestedValues, nodesOf: NodesOf): RowEntries {
  const group = decl.groups[collection.group]!;
  const { keyType, rowType, entryKey, entries, tile } = types;
  const holding = fieldOf(group.type, collection.field, DictType(DateTimeType, collection.valueType));
  const place = placedItem(decl, collection, collection.valueType, types.entryValue);
  const words = whatWords(collection);
  return East.function([keyType, rowType], entries, ($, key, row) => {
    const nodes = $.const(nodesOf);
    const held = $.const(holding);
    const file = $.const(placedFilings);
    const into = $.const(place);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return nodes(row).flattenToDict(($, node) => {
      const here = $.let(path(node.path));
      return held(node.node).flattenToDict(($, value, at) => {
        const instant = $.let(some(at), OptionType(DateTimeType));
        const placed = $.let(into(value));
        return file(tile, instant, instant, East.str`${East.print(key)} ${words} ${East.print(at)}`).toDict(
          (_$, filing) => East.value({
            collection: collectionPath, row: key, path: here, run: variant('items', null), level: filing.level, tile: filing.tile,
            item: variant('at', at),
          }, entryKey),
          () => placed,
        );
      });
    });
  });
}

/**
 * A collection of values, totalled: `(K, V) → Dict<IK, P>`, each node's values
 * in each summary tile: how many, and, for numbers, their sum, the least, the
 * greatest and the latest.
 */
function valueTotalsOf(decl: NestedDeclaration, types: NestedTypes, collection: NestedValues, summary: RecordLevel, nodesOf: NodesOf): RowEntries {
  const group = decl.groups[collection.group]!;
  const { keyType, rowType, entryKey, entryValue, entries } = types;
  const holding = fieldOf(group.type, collection.field, DictType(DateTimeType, collection.valueType));
  const valuesType = DictType(DateTimeType, collection.valueType);
  const totalsType = DictType(DateTimeType, RecordNestedTotalsType);
  // Numbers' totals carry their values; any other's count them.
  const asFloats = collection.numeric === undefined ? undefined : floatsOf(collection.valueType, collection.numeric);
  const totalsOf = asFloats === undefined
    ? East.function([valuesType, RecordLevelType], totalsType, ($, values, level) => {
      const counted = $.const(instantTotals);
      return counted(values.keys(), level);
    })
    : East.function([valuesType, RecordLevelType], totalsType, ($, values, level) => {
      const floats = $.const(asFloats);
      const summed = $.const(valueTotals);
      return summed(floats(values), level);
    });
  return East.function([keyType, rowType], entries, ($, key, row) => {
    const nodes = $.const(nodesOf);
    const held = $.const(holding);
    const totalled = $.const(totalsOf);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return nodes(row).flattenToDict(($, node) => {
      const here = $.let(path(node.path));
      return totalled(held(node.node), summary).toDict(
        (_$, _totals, tile) => East.value({
          collection: collectionPath, row: key, path: here, run: variant('totals', null), level: summary, tile, item: variant('none', null),
        }, entryKey),
        (_$, totals) => East.value(variant('totals', totals), entryValue),
      );
    });
  });
}

/**
 * A collection of values rolled up, its parents' subtotals: `(K, V) → Dict<IK,
 * P>`, every node from the row down to the collection's group gathered — the
 * collection's own values, as Floats, on its group's nodes — and composed
 * bottom-up ({@link subtotalsOf}).
 */
function valueSubtotals(decl: NestedDeclaration, types: NestedTypes, collection: NestedValues, nodesOf: readonly NodesOf[]): RowEntries {
  const { keyType, rowType, entryKey, entryValue, entries, levels } = types;
  const numeric = collection.numeric!;
  // The nodes of each group from the row down, the collection's group's holding its values.
  const gathered = chainTo(decl, collection.group).reduce<FunctionExpr<[EastType], ArrayType<typeof SubtotalNodeType>>>((before, group) => {
    const nodes = nodesOf[group.index]!;
    const ownGroup = BigInt(group.index);
    const holding = fieldOf(group.type, collection.field, DictType(DateTimeType, collection.valueType));
    const asFloats = floatsOf(collection.valueType, numeric);
    const own = group.index === collection.group
      ? East.function([group.type], DictType(DateTimeType, FloatType), ($, node) => {
        const held = $.const(holding);
        const floats = $.const(asFloats);
        return floats(held(node));
      })
      : noValues(group.type);
    return East.function([rowType], ArrayType(SubtotalNodeType), ($, row) => {
      const earlier = $.const(before);
      const these = $.const(nodes);
      const values = $.const(own);
      return earlier(row).concat(these(row).map((_$, node) => ({
        key: { path: node.path, group: ownGroup }, parent: node.parent, own: values(node.node),
      })));
    });
  }, East.function([rowType], ArrayType(SubtotalNodeType), () => []));
  return East.function([keyType, rowType], entries, ($, key, row) => {
    const nodes = $.const(gathered);
    const compose = $.const(subtotalsOf);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    const rollups = $.let([...collection.rollups], ArrayType(RecordRollupType));
    const tiers = $.let([...levels], ArrayType(RecordLevelType));
    return compose(nodes(row), rollups, tiers).toDict(
      (_$, _value, subtotal) => East.value({
        collection: collectionPath, row: key, path: subtotal.path, run: variant('subtotals', subtotal.rollup),
        level: subtotal.level, tile: subtotal.tile, item: variant('none', null),
      }, entryKey),
      (_$, value) => East.value(variant('subtotal', value), entryValue),
    );
  });
}

// ── The row's entries, and its lean form ──────────────────────────────────────

/**
 * A row's entries: `(K, V) → Dict<IK, P>`, each part's — every collection's
 * items or values filed, its totals where a summary is declared, its subtree
 * filing where it rolls items up, and its parents' subtotals where it rolls
 * values up — one after another, each a function calling the parts before it.
 *
 * @param decl - The checked declaration
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param tile - The index's tile
 * @param summary - Its summary tile; none where no totals are kept
 * @returns The entries, and their key and value types
 */
export function nestedEntries(
  decl: NestedDeclaration, keyType: EastType, rowType: EastType, tile: RecordTile, summary: RecordTile | undefined,
): { readonly entries: RowEntries; readonly entryKey: EastType; readonly entryValue: EastType } {
  const entryKey = NestedEntryKeyType(keyType);
  const entryValue = NestedEntryType(decl.places);
  const types: NestedTypes = {
    keyType, rowType, entryKey, entryValue, entries: DictType(entryKey, entryValue),
    tile: levelOf(tile),
    summary: summary === undefined ? undefined : levelOf(summary),
    levels: RECORD_TILES.slice(RECORD_TILES.indexOf(tile)).map(levelOf),
  };
  const nodesOf = groupNodes(decl, rowType);
  const parts: RowEntries[] = decl.collections.flatMap((collection): RowEntries[] => {
    const nodes = nodesOf[collection.group]!;
    if (collection.kind === 'items') {
      return [
        itemEntries(decl, types, collection, nodes),
        ...(collection.rollup ? [itemSubtreeEntries(decl, types, collection, nodes)] : []),
        ...(types.summary === undefined ? [] : [itemTotals(decl, types, collection, types.summary, nodes)]),
        ...(types.summary === undefined || !collection.rollup ? [] : [itemSubtreeTotals(decl, types, collection, types.summary, nodes)]),
      ];
    }
    return [
      valueEntries(decl, types, collection, nodes),
      ...(types.summary === undefined ? [] : [valueTotalsOf(decl, types, collection, types.summary, nodes)]),
      ...(collection.rollups.length === 0 ? [] : [valueSubtotals(decl, types, collection, nodesOf)]),
    ];
  });
  const entries = parts.reduce<RowEntries>(
    (before, part) => East.function([keyType, rowType], types.entries, ($, key, row) => {
      const earlier = $.const(before);
      const own = $.const(part);
      const all = $.let(earlier(key, row));
      $(all.unionInPlace(own(key, row)));
      return all;
    }),
    East.function([keyType, rowType], types.entries, () => new Map()),
  );
  return { entries, entryKey, entryValue };
}

/**
 * A row's lean form: `(K, V) → V`, every listed collection empty, each child
 * row kept with its own listed collections empty — a recursive group's rows
 * rebuilt bottom-up by `toTree` over `flattenTree`'s nodes. What the record's
 * other indexes carry beside a nested series index.
 *
 * @param decl - The checked declaration
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @returns The lean form
 */
export function nestedLean(decl: NestedDeclaration, keyType: EastType, rowType: EastType): FunctionExpr<[EastType, EastType], EastType> {
  // Each group's own lean form, its child groups' first: their collections emptied, their child rows' lean.
  const leanOf: FunctionExpr<[EastType], EastType>[] = [];
  const rowsLeanOf: FunctionExpr<[EastType], EastType>[] = [];
  for (const group of [...decl.groups].reverse()) {
    const fields: Record<string, FunctionExpr<[EastType], EastType>> = {};
    const struct = group.type.type === 'Recursive' ? group.type.node : group.type;
    if (struct.type !== 'Struct') throw new Error(`a nested series index's node is a Struct, not ${struct.type}`);
    for (const collection of group.collections) fields[collection.field] = emptied(group.type, struct.fields[collection.field]!);
    for (const child of group.rows) {
      const rowsType = DictType(StringType, decl.groups[child.group]!.type);
      const rowsOf = fieldOf(group.type, child.field, rowsType);
      const leanRows = rowsLeanOf[child.group]!;
      fields[child.field] = East.function([group.type], rowsType, ($, node) => {
        const rows = $.const(rowsOf);
        const lean = $.const(leanRows);
        return lean(rows(node));
      });
    }
    const own = rebuiltNode(group.type, fields);
    leanOf[group.index] = own;
    const rowsType = DictType(StringType, group.type);
    if (group.through === undefined) {
      rowsLeanOf[group.index] = East.function([rowsType], rowsType, ($, rows) => {
        const lean = $.const(own);
        return rows.map((_$, node) => lean(node));
      });
      continue;
    }
    // Beside recursive(): every row beneath, flattened, then rebuilt bottom-up, each lean and holding its own rebuilt rows.
    const keyed = StructType({ key: StringType, node: group.type });
    const deeper = fieldOf(group.type, group.through, rowsType);
    const holding = withRows(group.type, group.through);
    rowsLeanOf[group.index] = East.function([rowsType], rowsType, ($, rows) => {
      const beneath = $.const(deeper);
      const lean = $.const(own);
      const hold = $.const(holding);
      const above = $.const(keysAbove);
      const roots = $.let(rows.flattenTree((_$, node) => beneath(node)).toTree(
        keyed,
        (_$, entry) => entry.path,
        (_$, entry) => above(entry.path),
        (_$, entry, _i, children) => ({
          key: entry.path.get(entry.path.size().subtract(1n)),
          node: hold(lean(entry.node), children.toDict((_$, child) => child.key, (_$, child) => child.node)),
        }),
      ));
      return roots.toDict((_$, root) => root.key, (_$, root) => root.node);
    });
  }
  const rowLean = leanOf[0]!;
  return East.function([keyType, rowType], rowType, ($, _key, row) => {
    const lean = $.const(rowLean);
    return lean(row);
  });
}

// ── The definition ────────────────────────────────────────────────────────────

/**
 * The nested form of a series index's definition (`e3.recordIndex.series`
 * with `collections`, #1434): its key function a row's entries, `(K, V) →
 * Dict<IK, P>` — every declared collection's items filed by #1433's levels,
 * each node's totals where a summary is declared, each item rolled up filed
 * under every ancestor too, and every parent's subtotals of each collection of
 * values rolled up — and, for the record's other indexes, its lean row.
 *
 * @param name - The index
 * @param rec - Its record
 * @param spec - `collections`, `tile` and `summary`, as written
 * @param config - Its runner selection
 * @returns The definition: its key e3-types' `NestedEntryKeyType`, its value `NestedEntryType`
 * @throws {Error} Beside `collections`, the key form's fields, `on` or a `value`; a tile of none of the five; a second
 *   nested series index on the record; or what {@link checkNested} refuses, each in its words
 */
export function nestedDefinition(name: string, rec: RecordDef, spec: object, config: { runner?: FunctionRunner } | undefined): RecordIndexDef {
  const constructor = 'e3.recordIndex.series';
  const { keyType, valueType } = indexedEntry(constructor, name, rec);
  if ('key' in spec || 'from' in spec || 'to' in spec) {
    throw new Error(`${constructor} '${name}' takes collections, or key, from and to — not both: collections files what a row nests, key the record's own events`);
  }
  if ('on' in spec) {
    throw new Error(`${constructor} '${name}' takes no on with collections — a nested collection is read by its row's key, which the rail's indexes page`);
  }
  if ('value' in spec) throw new Error(`${constructor} '${name}' takes no value — each entry carries its own item, totals or subtotal`);
  onlyOptions(constructor, name, spec, ['collections', 'tile', 'summary']);
  const written = spec as { readonly collections?: unknown; readonly tile?: unknown; readonly summary?: unknown };
  const tile = checkTile(constructor, name, written.tile);
  const summary = written.summary === undefined ? undefined : checkTile(constructor, name, written.summary);
  const already = Object.values(rec.indexes).find((index) => index.nested !== undefined);
  if (already !== undefined) {
    throw new Error(`${constructor} '${name}': record '${rec.name}' has a nested series index already, '${already.name}' — one declares every collection a record nests`);
  }
  const decl = checkNested(name, valueType, written.collections);
  const { entries, entryKey, entryValue } = nestedEntries(decl, keyType, valueType, tile, summary);
  const runner = indexRunner(config);
  checkPure(`${constructor} '${name}' entries`, entries, INDEX_PURITY);
  checkEntryParams(name, 'entries', keyType, valueType, signatureOf(entries).inputs);
  return {
    kind: 'recordIndex',
    name,
    record: rec,
    // No field leads it: a nested collection is read by its row's key.
    on: Object.freeze([]),
    nested: Object.freeze({
      collections: written.collections, tile, summary, declaration: decl.declaration, lean: nestedLean(decl, keyType, valueType),
    }),
    keyFn: entries,
    // A row gives many entries, each with its own value.
    multi: true,
    keyType: entryKey,
    valueType: entryValue,
    runner,
  };
}
