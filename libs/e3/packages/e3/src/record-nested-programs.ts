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
 * A write is maintained by its patch where the patch can say what it touched
 * ({@link nestedEntries}' `byPatch`). The patch is walked along the
 * declaration — each collection's Dict patch, and each child-rows
 * collection's, down through the child rows it updates — to the row before
 * and after holding only the items it names, and the child rows it inserts or
 * deletes whole. Their entries are compared, with the totals of only the
 * summary tiles they touch and the subtotals of only the tiles they touch at
 * each level. A replace on the way — which a recursive type's patch always is
 * — leaves the row to be compared whole.
 *
 * The functions here are typed East over fixed shapes, or factories of one
 * from a declaration's types, which a row's entries chain together. A node is
 * read and rebuilt, and an item placed in its place's variants, by the names
 * a declaration gives, through East's own builders for names held as values
 * (`East.field`, `East.withField`, `East.inCase`), which check each name
 * against its type as the program is built.
 *
 * @packageDocumentation
 */
import {
  ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SetType, StringType, StructType,
  VariantType, none, printType, some, variant,
  type EastType, type FunctionExpr,
} from '@elaraai/east';
import {
  NestedEntryKeyType, NestedEntryType, RecordLevelType, RecordNestedPathType, RecordNestedTotalsType, RecordRollupType,
  type RecordLevel,
} from '@elaraai/e3-types';
import { checkNested, type NestedCollection, type NestedDeclaration, type NestedGroup, type NestedItems, type NestedValues } from './record-nested.js';
import {
  INDEX_PURITY, checkEntryParams, checkPure, functionAt, indexRunner, indexedEntry, onlyOptions, sameEastType, signatureOf, type IndexConstructor,
} from './record-guards.js';
import { fieldReader } from './record-keys.js';
import { patchTypeOf } from './record-patches.js';
import { RECORD_TILES, TileShareType, checkTile, placedFilings, placedShares, tileNext, tileStart, type RecordTile } from './record-tiles.js';
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

/** `(Dict<DateTime, Integer>) → Dict<DateTime, Float>`: Integer values as their totals and subtotals take them. */
const integersAsFloats = East.function([DictType(DateTimeType, IntegerType)], DictType(DateTimeType, FloatType), (_$, values) =>
  values.map((_$, value) => value.toFloat()));

/** `(Dict<DateTime, Float>) → Dict<DateTime, Float>`: Float values as their totals and subtotals take them. */
const floatsAsFloats = East.function([DictType(DateTimeType, FloatType)], DictType(DateTimeType, FloatType), (_$, values) => values);

/** `(keys) → Option<keys>`: the keys of the node above, within a walk of a Dict's rows; none for one of its own. */
const keysAbove = East.function([KeysType], OptionType(KeysType), (_$, keys) =>
  East.greater(keys.size(), 1n).ifElse(() => some(keys.slice(0n, keys.size().subtract(1n))), () => none));

// ── The tiles totals are worked out at ────────────────────────────────────────

/** A write's summary tiles, and their span: from the first's start to the last's end. */
const SpanType = StructType({ tiles: SetType(DateTimeType), from: DateTimeType, to: DateTimeType });

/**
 * The summary tiles totals are worked out at: `all`, as a row's entries are;
 * `only` a write's — those the items its patch names touch — outside whose
 * span an item touches none of them.
 */
const WithinType = VariantType({ all: NullType, only: SpanType });

/** The epoch: either end of no tiles' span. */
const EPOCH = new Date(0);

/** `(tiles, level) → Within`: a write's tiles of a level, and their span. */
const tilesWithin = East.function([SetType(DateTimeType), RecordLevelType], WithinType, ($, tiles, level) => {
  const after = $.const(tileNext);
  const starts = $.let(tiles.toArray((_$, start) => start));
  $.if(East.equal(starts.size(), 0n), ($) => {
    $.return(variant('only', { tiles, from: EPOCH, to: EPOCH }));
  });
  return variant('only', { tiles, from: starts.get(0n), to: after(level, starts.get(starts.size().subtract(1n))) });
});

/**
 * `(within, start, end) → Boolean`: whether an item may touch the tiles — any
 * item with a start may touch some tile; of a write's tiles, one that starts
 * before their span ends, and ends, or starts, at or after it begins. An item
 * with no start touches none.
 */
const reaches = East.function([WithinType, OptionType(DateTimeType), OptionType(DateTimeType)], BooleanType, (_$, within, start, end) =>
  start.match({
    none: () => false,
    some: (_$, from) => within.match({
      all: () => true,
      only: (_$, span) => East.less(from, span.to).and(() => East.greaterEqual(East.max(from, end.unwrap('some', () => from)), span.from)),
    }),
  }));

/** `(shares, within) → shares`: an item's shares of the tiles totals are worked out at. */
const sharesWithin = East.function([ArrayType(TileShareType), WithinType], ArrayType(TileShareType), (_$, shares, within) =>
  within.match({
    all: () => shares,
    only: (_$, span) => shares.filter((_$, share) => span.tiles.has(share.tile)),
  }));

/** `(span, level, at) → Boolean`: whether a value's instant is in one of a write's tiles. */
const inSpan = East.function([SpanType, RecordLevelType, DateTimeType], BooleanType, ($, span, level, at) => {
  const startOf = $.const(tileStart);
  return East.greaterEqual(at, span.from).and(() => East.less(at, span.to)).and(() => span.tiles.has(startOf(level, at)));
});

// ── The tiles subtotals are worked out at ─────────────────────────────────────

/**
 * The tiles a parent's subtotals are worked out at: `all`, as a row's entries
 * are; `only` a write's, by level — the tiles of each level the values its
 * patch names fall in, and their span. A value in none of them moves none of
 * the subtotals the write compares.
 */
const SubtotalTilesType = VariantType({ all: NullType, only: DictType(RecordLevelType, SpanType) });

/** `(instants, levels) → SubtotalTiles`: the tiles of each level some values' instants fall in. */
const subtotalTiles = East.function([SetType(DateTimeType), ArrayType(RecordLevelType)], SubtotalTilesType, ($, instants, levels) => {
  const startOf = $.const(tileStart);
  const within = $.const(tilesWithin);
  return variant('only', levels.toDict(
    (_$, level) => level,
    (_$, level) => within(instants.toSet((_$, at) => startOf(level, at)), level).unwrap('only'),
  ));
});

/** `(own, level, tiles) → own`: a node's own values in the tiles of a level its subtotals are worked out at. */
const valuesAt = East.function([DictType(DateTimeType, FloatType), RecordLevelType, SubtotalTilesType], DictType(DateTimeType, FloatType),
  ($, own, level, tiles) => {
    const kept = $.const(inSpan);
    return tiles.match({
      all: () => own,
      only: (_$, spans) => own.filter((_$, _value, at) => kept(spans.get(level), level, at)),
    });
  });

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

/**
 * `(own, rollups, levels, tiles) → Dict<DrawKey, Float>`: what a node holding
 * values draws, by each rollup, at each level, in each tile its values touch
 * of those asked for.
 */
const ownDraws = East.function(
  [DictType(DateTimeType, FloatType), ArrayType(RecordRollupType), ArrayType(RecordLevelType), SubtotalTilesType], DictType(DrawKeyType, FloatType),
  ($, own, rollups, levels, at) => {
    const tiles = $.const(foldedTiles);
    const within = $.const(valuesAt);
    const draw = $.const(ownDraw);
    return levels.flattenToDict((_$, level) => tiles(within(own, level, at), level).flattenToDict((_$, folded, tile) =>
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
 * `(node, children, rollups, levels, tiles) → Composed`: a node's result, at
 * the tiles asked for. One holding values of its own draws them, and keeps no
 * subtotal; one holding none draws its children's, and keeps what it draws,
 * where it draws, as its subtotals. Either way, it carries every subtotal
 * beneath it on to its parent.
 */
const composed = East.function(
  [SubtotalNodeType, ArrayType(ComposedType), ArrayType(RecordRollupType), ArrayType(RecordLevelType), SubtotalTilesType], ComposedType,
  ($, node, children, rollups, levels, tiles) => {
    const own = $.const(ownDraws);
    const gathered = $.const(childDraws);
    const path = $.const(pathOf);
    const beneath = $.let(children.flatMap((_$, child) => child.subtotals.toArray((_$, value, key) => ({ key, value })))
      .toDict((_$, subtotal) => subtotal.key, (_$, subtotal) => subtotal.value));
    $.if(East.greater(node.own.size(), 0n), ($) => {
      $.return({ draws: own(node.own, rollups, levels, tiles), subtotals: beneath });
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
 * `(nodes, rollups, levels, tiles) → Dict<SubtotalKey, Float>`: every
 * parent's subtotals of a collection of values at the tiles asked for,
 * composed bottom-up by `toTree` over the nodes from the row down to the
 * collection, each node's result carried to its parent. A tile no
 * descendant's value touches has none.
 */
const subtotalsOf = East.function(
  [ArrayType(SubtotalNodeType), ArrayType(RecordRollupType), ArrayType(RecordLevelType), SubtotalTilesType], DictType(SubtotalKeyType, FloatType),
  ($, nodes, rollups, levels, tiles) => {
    const compose = $.const(composed);
    const roots = $.let(nodes.toTree(ComposedType, (_$, node) => node.key, (_$, node) => node.parent,
      (_$, node, _i, children) => compose(node, children, rollups, levels, tiles)));
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
  /** A row's entries before a write and after it. */
  readonly changed: ChangedType;
  /** The index's finest level, as a level. */
  readonly tile: RecordLevel;
  /** The summary tile, as a level; none where no totals are kept. */
  readonly summary: RecordLevel | undefined;
  /** The levels a parent's subtotals are kept at: from the index's tile up to the year. */
  readonly levels: readonly RecordLevel[];
}

/** A row's entries before a write and after it. */
type ChangedType = StructType<{ before: EntriesType; after: EntriesType }>;

/** A row's entries of one part of the index: `(K, V) → Dict<IK, P>`. */
type RowEntries = FunctionExpr<[EastType, EastType], EntriesType>;

/** A row's totals of one part of the index, at the tiles they are worked out at: `(K, V, Within) → Dict<IK, P>`. */
type TiledEntries = FunctionExpr<[EastType, EastType, typeof WithinType], EntriesType>;

/** The summary tiles a row's items touch: `(K, V) → Set<DateTime>`. */
type RowTiles = FunctionExpr<[EastType, EastType], SetType<DateTimeType>>;

/**
 * A part of a write's entries: `(K, V, V, V, V) → { before, after }`, given
 * the row before and after, and the row before and after holding only what
 * the write's patch touched.
 */
type WriteEntries = FunctionExpr<[EastType, EastType, EastType, EastType, EastType], ChangedType>;

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

/**
 * A collection's values as Floats: `(Dict<DateTime, V>) → Dict<DateTime,
 * Float>`, an Integer's converted — the declaration checked they are numbers.
 *
 * @param valueType - The values' type
 * @param numeric - Their kind
 * @returns The conversion, at the values' own type
 */
function floatsOf(valueType: EastType, numeric: 'Float' | 'Integer'): FunctionExpr<[EastType], DictType<DateTimeType, FloatType>> {
  return functionAt<[EastType], DictType<DateTimeType, FloatType>>(
    numeric === 'Integer' ? integersAsFloats : floatsAsFloats, [DictType(DateTimeType, valueType)], DictType(DateTimeType, FloatType));
}

/**
 * A node's field: `(N) → T`, the field named, which the declaration checked
 * is of the type given — read through a recursive node.
 *
 * @param nodeType - The node's type: a Struct, or a RecursiveType of one
 * @param field - The field
 * @param type - Its type
 * @returns The reader
 */
function fieldOf<T extends EastType>(nodeType: EastType, field: string, type: T): FunctionExpr<[EastType], T> {
  const read: EastType = type;
  return functionAt<[EastType], T>(East.function([nodeType], read, (_$, node) => East.field(node, field, read)), [nodeType], type);
}

/**
 * A node rebuilt: `(N) → N`, each field named given what its function makes
 * of the node, every other field as it is — a field at a time, each step
 * calling the one before it.
 *
 * @param nodeType - The node's type: a Struct, or a RecursiveType of one
 * @param fields - The fields rebuilt, each by a function of the node
 * @returns The rebuild
 */
function rebuiltNode(nodeType: EastType, fields: Readonly<Record<string, FunctionExpr<[EastType], EastType>>>): FunctionExpr<[EastType], EastType> {
  return Object.entries(fields).reduce<FunctionExpr<[EastType], EastType>>(
    (before, [field, make]) => East.function([nodeType], nodeType, ($, node) => {
      const earlier = $.const(before);
      const value = $.const(make);
      const held = $.let(earlier(node));
      return East.withField(held, field, value(node));
    }),
    East.function([nodeType], nodeType, (_$, node) => node),
  );
}

/**
 * A node with one field replaced: `(N, F) → N`.
 *
 * @param nodeType - The node's type: a Struct, or a RecursiveType of one
 * @param field - The field
 * @param type - Its type, `F`
 * @returns The rebuild
 */
function withField(nodeType: EastType, field: string, type: EastType): FunctionExpr<[EastType, EastType], EastType> {
  return East.function([nodeType, type], nodeType, (_$, node, value) => East.withField(node, field, value));
}

/**
 * An item of a collection as its entry carries it: `(I) → P`, the item placed
 * in the variants of the collection's place, nesting as the declaration
 * nests (`.item .members .load 0.82`) — a case at a time, from the item out,
 * each step calling the one before it.
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
  const placed = cases.reduce<FunctionExpr<[EastType], EastType>>(
    (inner, at) => East.function([itemType], at.type, ($, item) => {
      const within = $.const(inner);
      return East.inCase(at.type, at.name, within(item));
    }),
    East.function([itemType], itemType, (_$, item) => item),
  );
  return functionAt<[EastType], EntryValueType>(placed, [itemType], entryValue);
}

/** The empty collection a lean node holds in place of a listed one: `(N) → Dict<…>`, empty. */
function emptied(nodeType: EastType, type: EastType): FunctionExpr<[EastType], EastType> {
  return East.function([nodeType], type, () => new Map());
}

/**
 * A node of a collection's own group, its values as Floats: `(N) → Dict<DateTime, Float>`.
 *
 * @param nodeType - The group's node type
 * @param collection - The collection, whose group it is
 * @param numeric - Its values' kind
 * @returns The node's values
 */
function valuesAsFloats(nodeType: EastType, collection: NestedValues, numeric: 'Float' | 'Integer'): FunctionExpr<[EastType], DictType<DateTimeType, FloatType>> {
  const holding = fieldOf(nodeType, collection.field, DictType(DateTimeType, collection.valueType));
  const asFloats = floatsOf(collection.valueType, numeric);
  return East.function([nodeType], DictType(DateTimeType, FloatType), ($, node) => {
    const held = $.const(holding);
    const floats = $.const(asFloats);
    return floats(held(node));
  });
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

// ── What a write's patch touches ──────────────────────────────────────────────

/**
 * What a write's patch touched of a node: `replaced` — a replace on the way,
 * so the row is compared whole — `unchanged`, or the node before and after,
 * holding of its collections and child rows only what the patch names.
 *
 * @param node - The node's type
 * @returns The variant type
 */
function TouchedType(node: EastType) {
  return VariantType({ replaced: NullType, unchanged: NullType, touched: StructType({ held: node, next: node }) });
}

/** A node's walk: `(N, N, Patch) → Touched`, given the node before and after a write and the patch between them. */
type NodeWalk = FunctionExpr<[EastType, EastType, EastType], ReturnType<typeof TouchedType>>;

/**
 * A Dict's walk: `(D, D, Patch) → Option<{ held, next }>`, given the Dict
 * before and after a write and the patch between them, what the patch names
 * of each; none where it was replaced.
 */
type DictWalk = FunctionExpr<[EastType, EastType, EastType], OptionType<StructType<{ held: EastType; next: EastType }>>>;

/**
 * A Dict's patch, as East types it: `unchanged`, a `replace`, or an op a key —
 * an `insert` or a `delete` of a value, or an `update` by the value's patch.
 *
 * @param keyType - The Dict's key type
 * @param valueType - Its value type
 * @returns The patch type
 * @throws {Error} When it is not East's own
 */
function dictPatchType<K extends EastType, V extends EastType>(keyType: K, valueType: V) {
  const dictType = DictType(keyType, valueType);
  const patchType = VariantType({
    unchanged: NullType,
    replace: StructType({ before: dictType, after: dictType }),
    patch: DictType(keyType, VariantType({ insert: valueType, delete: valueType, update: patchTypeOf(valueType) })),
  });
  if (!sameEastType(patchType, patchTypeOf(dictType))) {
    throw new Error(`a nested series index's patch of ${printType(dictType)} is not East's ${printType(patchTypeOf(dictType))}`);
  }
  return patchType;
}

/**
 * A collection's walk ({@link DictWalk}): the items its patch names, before
 * and after — one inserted after, one deleted before, one updated both.
 *
 * @param keyType - The collection's key type
 * @param itemType - Its items' type
 * @returns The walk
 */
function touchedItems(keyType: EastType, itemType: EastType): DictWalk {
  const dictType = DictType(keyType, itemType);
  const patchType = dictPatchType(keyType, itemType);
  const pairType = StructType<{ held: EastType; next: EastType }>({ held: dictType, next: dictType });
  return East.function([dictType, dictType, patchType], OptionType(pairType), ($, held, next, patch) => {
    $.match(patch, {
      unchanged: ($) => {
        $.return(some({ held: new Map(), next: new Map() }));
      },
      replace: ($) => {
        $.return(none);
      },
      patch: ($, ops) => {
        $.return(some({
          held: ops.filterMap((_$, _op, key) => held.tryGet(key)),
          next: ops.filterMap((_$, _op, key) => next.tryGet(key)),
        }));
      },
    });
    return none;
  });
}

/**
 * Child rows' walk ({@link DictWalk}): the rows their patch names, before and
 * after — one inserted or deleted whole, with everything beneath it, one
 * updated as its own walk leaves it — and none where one on the way was
 * replaced.
 *
 * @param nodeType - The child rows' type
 * @param walk - Their walk
 * @returns The walk
 */
function touchedRows(nodeType: EastType, walk: NodeWalk): DictWalk {
  const rowsType = DictType(StringType, nodeType);
  const patchType = dictPatchType(StringType, nodeType);
  const pairType = StructType<{ held: EastType; next: EastType }>({ held: rowsType, next: rowsType });
  return East.function([rowsType, rowsType, patchType], OptionType(pairType), ($, held, next, patch) => {
    const child = $.const(walk);
    $.match(patch, {
      unchanged: ($) => {
        $.return(some({ held: new Map(), next: new Map() }));
      },
      replace: ($) => {
        $.return(none);
      },
      patch: ($, ops) => {
        const before = $.let(new Map(), rowsType);
        const after = $.let(new Map(), rowsType);
        $.for(ops, ($, op, key) => {
          $.match(op, {
            insert: ($) => {
              $(after.insert(key, next.get(key)));
            },
            delete: ($) => {
              $(before.insert(key, held.get(key)));
            },
            update: ($, rowPatch) => {
              $.match(child(held.get(key), next.get(key), rowPatch), {
                replaced: ($) => {
                  $.return(none);
                },
                unchanged: () => {},
                touched: ($, both) => {
                  $(before.insert(key, both.held));
                  $(after.insert(key, both.next));
                },
              });
            },
          });
        });
        $.return(some({ held: before, next: after }));
      },
    });
    return none;
  });
}

/**
 * A recursive node's walk ({@link NodeWalk}): East patches a recursive type
 * only whole, so a change of one is a replace.
 *
 * @param nodeType - The node's type
 * @returns The walk
 * @throws {Error} When its patch is not East's own
 */
function touchedRecursive(nodeType: EastType): NodeWalk {
  const patchType = VariantType({ unchanged: NullType, replace: StructType({ before: nodeType, after: nodeType }) });
  if (!sameEastType(patchType, patchTypeOf(nodeType))) {
    throw new Error(`a nested series index's patch of ${printType(nodeType)} is not East's ${printType(patchTypeOf(nodeType))}`);
  }
  const touchedType = TouchedType(nodeType);
  return East.function([nodeType, nodeType, patchType], touchedType, ($, _held, _next, patch) => {
    $.match(patch, {
      unchanged: ($) => {
        $.return(variant('unchanged', null));
      },
      replace: ($) => {
        $.return(variant('replaced', null));
      },
    });
    return variant('replaced', null);
  });
}

/** A field of a node a write's patch may name — a collection's or child rows' — with its Dict's type and walk. */
interface FieldWalk {
  readonly field: string;
  readonly type: EastType;
  readonly walk: DictWalk;
}

/**
 * A struct node's walk ({@link NodeWalk}): each field holding a collection or
 * child rows walked by its patch in turn, and the node rebuilt holding what
 * each walk leaves; every other field as it is.
 *
 * @param nodeType - The node's type, a Struct
 * @param fields - Its fields' walks
 * @returns The walk
 * @throws {Error} When its patch is not East's own
 */
function touchedStruct(nodeType: EastType, fields: readonly FieldWalk[]): NodeWalk {
  if (nodeType.type !== 'Struct') throw new Error(`a nested series index's node is a Struct, not ${nodeType.type}`);
  const patchesType = StructType(Object.fromEntries(Object.entries(nodeType.fields).map(([name, type]) => [name, patchTypeOf(type)])));
  const patchType = VariantType({ unchanged: NullType, replace: StructType({ before: nodeType, after: nodeType }), patch: patchesType });
  if (!sameEastType(patchType, patchTypeOf(nodeType))) {
    throw new Error(`a nested series index's patch of ${printType(nodeType)} is not East's ${printType(patchTypeOf(nodeType))}`);
  }
  const pairType = StructType({ held: nodeType, next: nodeType });
  // Each field in turn, the node before and after holding what the walks before it left; none once one was replaced.
  const walked = fields.reduce(
    (before, at) => {
      const read = fieldOf(nodeType, at.field, at.type);
      const patchOf = fieldOf(patchesType, at.field, patchTypeOf(at.type));
      const put = withField(nodeType, at.field, at.type);
      return East.function([pairType, patchesType], OptionType(pairType), ($, pair, patches) => {
        const earlier = $.const(before);
        const readFn = $.const(read);
        const patchFn = $.const(patchOf);
        const walkFn = $.const(at.walk);
        const putFn = $.const(put);
        $.match(earlier(pair, patches), {
          some: ($, so) => {
            $.match(walkFn(readFn(so.held), readFn(so.next), patchFn(patches)), {
              some: ($, both) => {
                $.return(some({ held: putFn(so.held, both.held), next: putFn(so.next, both.next) }));
              },
              none: () => {},
            });
          },
          none: () => {},
        });
        return none;
      });
    },
    East.function([pairType, patchesType], OptionType(pairType), (_$, pair) => some(pair)),
  );
  const touchedType = TouchedType(nodeType);
  return East.function([nodeType, nodeType, patchType], touchedType, ($, held, next, patch) => {
    const walk = $.const(walked);
    $.match(patch, {
      unchanged: ($) => {
        $.return(variant('unchanged', null));
      },
      replace: ($) => {
        $.return(variant('replaced', null));
      },
      patch: ($, patches) => {
        $.match(walk({ held, next }, patches), {
          some: ($, both) => {
            $.return(variant('touched', both));
          },
          none: () => {},
        });
      },
    });
    return variant('replaced', null);
  });
}

/**
 * The row's walk ({@link NodeWalk}): each group's from its child groups' — a
 * recursive group's, whole.
 *
 * @param decl - The checked declaration
 * @returns The row's walk
 */
function rowWalk(decl: NestedDeclaration): NodeWalk {
  const walks: NodeWalk[] = [];
  for (const group of [...decl.groups].reverse()) {
    if (group.type.type !== 'Struct') {
      walks[group.index] = touchedRecursive(group.type);
      continue;
    }
    walks[group.index] = touchedStruct(group.type, [
      ...group.collections.map((collection): FieldWalk => {
        const type = collection.kind === 'items' ? DictType(StringType, collection.itemType) : DictType(DateTimeType, collection.valueType);
        return { field: collection.field, type, walk: touchedItems(type.key, type.value) };
      }),
      ...group.rows.map((child): FieldWalk => {
        const childType = decl.groups[child.group]!.type;
        return { field: child.field, type: DictType(StringType, childType), walk: touchedRows(childType, walks[child.group]!) };
      }),
    ]);
  }
  return walks[0]!;
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
  const readStart = fieldReader(StringType, collection.itemType, { option: collection.start });
  const readEnd = fieldReader(StringType, collection.itemType, { option: collection.end });
  const place = placedItem(decl, collection, collection.itemType, types.entryValue);
  const words = whatWords(collection);
  return East.function([keyType, rowType], entries, ($, key, row) => {
    const nodes = $.const(nodesOf);
    const held = $.const(holding);
    const startOf = $.const(readStart);
    const endOf = $.const(readEnd);
    const file = $.const(placedFilings);
    const into = $.const(place);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return nodes(row).flattenToDict(($, node) => {
      const here = $.let(path(node.path));
      return held(node.node).flattenToDict(($, item, id) => {
        const value = $.let(into(item));
        return file(tile, startOf(id, item), endOf(id, item), East.str`${East.print(key)} ${words} ${East.print(id)}`).toDict(
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
  const readStart = fieldReader(StringType, collection.itemType, { option: collection.start });
  const readEnd = fieldReader(StringType, collection.itemType, { option: collection.end });
  const place = placedItem(decl, collection, collection.itemType, types.entryValue);
  const words = whatWords(collection);
  return East.function([keyType, rowType], entries, ($, key, row) => {
    const nodes = $.const(nodesOf);
    const held = $.const(holding);
    const startOf = $.const(readStart);
    const endOf = $.const(readEnd);
    const file = $.const(placedFilings);
    const into = $.const(place);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return nodes(row).flattenToDict(($, node) => held(node.node).flattenToDict(($, item, id) => {
      const value = $.let(into(item));
      const filings = $.let(file(tile, startOf(id, item), endOf(id, item), East.str`${East.print(key)} ${words} ${East.print(id)}`));
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

/** A node's items' shares of the summary tiles they touch. */
const NodeSharesType = StructType({ path: KeysType, shares: ArrayType(TileShareType) });

/**
 * Each node's items' shares of the summary tiles they touch: `(K, V, Within)
 * → Array<{ path, shares }>`, of the tiles asked for — an item that cannot
 * touch them not shared out at all — an item with no start touching none.
 */
function itemShares(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, summary: RecordLevel, nodesOf: NodesOf) {
  const group = decl.groups[collection.group]!;
  const holding = fieldOf(group.type, collection.field, DictType(StringType, collection.itemType));
  const readStart = fieldReader(StringType, collection.itemType, { option: collection.start });
  const readEnd = fieldReader(StringType, collection.itemType, { option: collection.end });
  const words = whatWords(collection);
  return East.function([types.keyType, types.rowType, WithinType], ArrayType(NodeSharesType), ($, key, row, within) => {
    const nodes = $.const(nodesOf);
    const held = $.const(holding);
    const startOf = $.const(readStart);
    const endOf = $.const(readEnd);
    const share = $.const(placedShares);
    const may = $.const(reaches);
    const kept = $.const(sharesWithin);
    return nodes(row).map((_$, node) => ({
      path: node.path,
      shares: held(node.node).flattenToArray(($, item, id) => {
        const start = $.let(startOf(id, item));
        const end = $.let(endOf(id, item));
        const shares = $.let([], ArrayType(TileShareType));
        $.if(may(within, start, end), ($) => {
          $.assign(shares, kept(share(summary, start, end, East.str`${East.print(key)} ${words} ${East.print(id)}`), within));
        });
        return shares;
      }),
    }));
  });
}

/** The summary tiles a row's things people drag touch: `(K, V) → Set<DateTime>`. */
function itemTiles(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, summary: RecordLevel, nodesOf: NodesOf): RowTiles {
  const sharesOf = itemShares(decl, types, collection, summary, nodesOf);
  return East.function([types.keyType, types.rowType], SetType(DateTimeType), ($, key, row) => {
    const shared = $.const(sharesOf);
    return shared(key, row, variant('all', null)).flattenToSet((_$, node) => node.shares.toSet((_$, share) => share.tile));
  });
}

/**
 * Things people drag, totalled: `(K, V, Within) → Dict<IK, P>`, each node's
 * items' count and milliseconds in each summary tile they touch, of the tiles
 * asked for.
 */
function itemTotals(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, summary: RecordLevel, nodesOf: NodesOf): TiledEntries {
  const { keyType, rowType, entryKey, entryValue, entries } = types;
  const sharesOf = itemShares(decl, types, collection, summary, nodesOf);
  return East.function([keyType, rowType, WithinType], entries, ($, key, row, within) => {
    const shared = $.const(sharesOf);
    const totalled = $.const(sharedTotals);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return shared(key, row, within).flattenToDict(($, node) => {
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

/**
 * Things people drag rolled up, each ancestor's totals of its subtree's items:
 * `(K, V, Within) → Dict<IK, P>`, in the run `subtreeTotals`, of the tiles
 * asked for.
 */
function itemSubtreeTotals(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, summary: RecordLevel, nodesOf: NodesOf): TiledEntries {
  const { keyType, rowType, entryKey, entryValue, entries } = types;
  const sharesOf = itemShares(decl, types, collection, summary, nodesOf);
  return East.function([keyType, rowType, WithinType], entries, ($, key, row, within) => {
    const shared = $.const(sharesOf);
    const totalled = $.const(sharedTotals);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    // Every node's shares, under each of its ancestors: the row, and each node on the way.
    const beneath = $.let(shared(key, row, within).flatMap((_$, node) => East.Array.range(0n, node.path.size()).flatMap((_$, depth) =>
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
 * A collection of values, totalled: `(K, V, Within) → Dict<IK, P>`, each
 * node's values in each summary tile, of the tiles asked for: how many, and,
 * for numbers, their sum, the least, the greatest and the latest.
 */
function valueTotalsOf(decl: NestedDeclaration, types: NestedTypes, collection: NestedValues, summary: RecordLevel, nodesOf: NodesOf): TiledEntries {
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
  return East.function([keyType, rowType, WithinType], entries, ($, key, row, within) => {
    const nodes = $.const(nodesOf);
    const held = $.const(holding);
    const totalled = $.const(totalsOf);
    const kept = $.const(inSpan);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return nodes(row).flattenToDict(($, node) => {
      const here = $.let(path(node.path));
      const values = $.let(held(node.node));
      const counted = $.let(within.match({
        all: () => values,
        only: (_$, span) => values.filter((_$, _value, at) => kept(span, summary, at)),
      }));
      return totalled(counted, summary).toDict(
        (_$, _totals, tile) => East.value({
          collection: collectionPath, row: key, path: here, run: variant('totals', null), level: summary, tile, item: variant('none', null),
        }, entryKey),
        (_$, totals) => East.value(variant('totals', totals), entryValue),
      );
    });
  });
}

/** The summary tiles a row's values are in: `(K, V) → Set<DateTime>`. */
function valueTiles(decl: NestedDeclaration, types: NestedTypes, collection: NestedValues, summary: RecordLevel, nodesOf: NodesOf): RowTiles {
  const group = decl.groups[collection.group]!;
  const holding = fieldOf(group.type, collection.field, DictType(DateTimeType, collection.valueType));
  return East.function([types.keyType, types.rowType], SetType(DateTimeType), ($, _key, row) => {
    const nodes = $.const(nodesOf);
    const held = $.const(holding);
    const startOf = $.const(tileStart);
    return nodes(row).flattenToSet((_$, node) => held(node.node).toSet((_$, _value, at) => startOf(summary, at)));
  });
}

/**
 * A collection of values rolled up: its parents' subtotals, at the tiles they
 * are worked out at; the instants a row's values are at; and whether a write
 * moves only the subtotals of the tiles its values are at.
 */
interface SubtotalParts {
  /** `(K, V, SubtotalTiles) → Dict<IK, P>`: every parent's subtotals, at the tiles asked for. */
  readonly entries: FunctionExpr<[EastType, EastType, typeof SubtotalTilesType], EntriesType>;
  /** `(K, V) → Set<DateTime>`: the instants a row's values are at. */
  readonly instants: RowTiles;
  /**
   * Whether a write moves only the subtotals of the tiles its values are at:
   * where no node holding the collection's values is a parent of another —
   * every node but a recursive tree's. In a tree, a node given its first
   * value keeps subtotals at no tile, and one losing its last begins to at
   * every tile.
   */
  readonly local: boolean;
}

/**
 * A collection of values rolled up, its parents' subtotals ({@link
 * SubtotalParts}): every node from the row down to the collection's group
 * gathered — the collection's own values, as Floats, on its group's nodes —
 * and composed bottom-up ({@link subtotalsOf}) at the tiles asked for.
 */
function valueSubtotals(decl: NestedDeclaration, types: NestedTypes, collection: NestedValues, nodesOf: readonly NodesOf[]): SubtotalParts {
  const { keyType, rowType, entryKey, entryValue, entries, levels } = types;
  const numeric = collection.numeric!;
  // The nodes of each group from the row down, the collection's group's holding its values.
  const gathered = chainTo(decl, collection.group).reduce<FunctionExpr<[EastType], ArrayType<typeof SubtotalNodeType>>>((before, group) => {
    const nodes = nodesOf[group.index]!;
    const ownGroup = BigInt(group.index);
    const own = group.index === collection.group ? valuesAsFloats(group.type, collection, numeric) : noValues(group.type);
    return East.function([rowType], ArrayType(SubtotalNodeType), ($, row) => {
      const earlier = $.const(before);
      const these = $.const(nodes);
      const values = $.const(own);
      return earlier(row).concat(these(row).map((_$, node) => ({
        key: { path: node.path, group: ownGroup }, parent: node.parent, own: values(node.node),
      })));
    });
  }, East.function([rowType], ArrayType(SubtotalNodeType), () => []));
  const subtotals = East.function([keyType, rowType, SubtotalTilesType], entries, ($, key, row, tiles) => {
    const nodes = $.const(gathered);
    const compose = $.const(subtotalsOf);
    const path = $.const(pathOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    const rollups = $.let([...collection.rollups], ArrayType(RecordRollupType));
    const tiers = $.let([...levels], ArrayType(RecordLevelType));
    return compose(nodes(row), rollups, tiers, tiles).toDict(
      (_$, _value, subtotal) => East.value({
        collection: collectionPath, row: key, path: subtotal.path, run: variant('subtotals', subtotal.rollup),
        level: subtotal.level, tile: subtotal.tile, item: variant('none', null),
      }, entryKey),
      (_$, value) => East.value(variant('subtotal', value), entryValue),
    );
  });
  const instants = East.function([keyType, rowType], SetType(DateTimeType), ($, _key, row) => {
    const nodes = $.const(gathered);
    return nodes(row).flattenToSet((_$, node) => node.own.keys());
  });
  return { entries: subtotals, instants, local: decl.groups[collection.group]!.through === undefined };
}

// ── A collection's parts, chained ─────────────────────────────────────────────

/** One collection's parts of a row's entries. */
interface CollectionParts {
  /** Its items or values filed, and, rolled up, its items under every ancestor too. */
  readonly items: RowEntries;
  /** Where a summary is declared: its totals, and the summary tiles a row's items touch. */
  readonly totals: { readonly entries: TiledEntries; readonly tiles: RowTiles } | undefined;
  /** Where its values roll up: every parent's subtotals. */
  readonly subtotals: SubtotalParts | undefined;
}

/** `(K, V) → Dict<IK, P>`: parts' entries, one after another, each a function calling the parts before it. */
function rowUnion(types: NestedTypes, parts: readonly RowEntries[]): FunctionExpr<[EastType, EastType], EntriesType> {
  const [first, ...rest] = parts;
  if (first === undefined) return East.function([types.keyType, types.rowType], types.entries, () => new Map());
  return rest.reduce<FunctionExpr<[EastType, EastType], EntriesType>>((before, part) => East.function([types.keyType, types.rowType], types.entries, ($, key, row) => {
    const earlier = $.const(before);
    const own = $.const(part);
    const all = $.let(earlier(key, row));
    $(all.unionInPlace(own(key, row)));
    return all;
  }), first);
}

/** `(K, V, Within) → Dict<IK, P>`: parts' totals, one after another. */
function tiledUnion(types: NestedTypes, parts: readonly TiledEntries[]): FunctionExpr<[EastType, EastType, typeof WithinType], EntriesType> {
  const [first, ...rest] = parts;
  if (first === undefined) return East.function([types.keyType, types.rowType, WithinType], types.entries, () => new Map());
  return rest.reduce<FunctionExpr<[EastType, EastType, typeof WithinType], EntriesType>>((before, part) => East.function([types.keyType, types.rowType, WithinType], types.entries, ($, key, row, within) => {
    const earlier = $.const(before);
    const own = $.const(part);
    const all = $.let(earlier(key, row, within));
    $(all.unionInPlace(own(key, row, within)));
    return all;
  }), first);
}

/** `(K, V, V, V, V) → { before, after }`: parts of a write's entries, one after another. */
function writeUnion(types: NestedTypes, parts: readonly WriteEntries[]): FunctionExpr<[EastType, EastType, EastType, EastType, EastType], ChangedType> {
  const { keyType, rowType, changed } = types;
  const [first, ...rest] = parts;
  if (first === undefined) {
    return East.function([keyType, rowType, rowType, rowType, rowType], changed, () => ({ before: new Map(), after: new Map() }));
  }
  return rest.reduce<FunctionExpr<[EastType, EastType, EastType, EastType, EastType], ChangedType>>((before, part) => East.function(
    [keyType, rowType, rowType, rowType, rowType], changed, ($, key, held, next, heldTouched, nextTouched) => {
      const earlier = $.const(before);
      const own = $.const(part);
      const all = $.let(earlier(key, held, next, heldTouched, nextTouched));
      const these = $.let(own(key, held, next, heldTouched, nextTouched));
      $(all.before.unionInPlace(these.before));
      $(all.after.unionInPlace(these.after));
      return all;
    },
  ), first);
}

/**
 * A collection's parts of a row's entries: its items or values filed — rolled
 * up, under every ancestor too — and, where a summary is declared, its totals;
 * where its values roll up, every parent's subtotals.
 *
 * @param decl - The checked declaration
 * @param types - The index's types
 * @param collection - The collection
 * @param nodesOf - Each group's nodes from a row
 * @returns Its parts
 */
function collectionParts(decl: NestedDeclaration, types: NestedTypes, collection: NestedCollection, nodesOf: readonly NodesOf[]): CollectionParts {
  const nodes = nodesOf[collection.group]!;
  const { summary } = types;
  if (collection.kind === 'items') {
    return {
      items: rowUnion(types, [
        itemEntries(decl, types, collection, nodes),
        ...(collection.rollup ? [itemSubtreeEntries(decl, types, collection, nodes)] : []),
      ]),
      totals: summary === undefined ? undefined : {
        entries: tiledUnion(types, [
          itemTotals(decl, types, collection, summary, nodes),
          ...(collection.rollup ? [itemSubtreeTotals(decl, types, collection, summary, nodes)] : []),
        ]),
        tiles: itemTiles(decl, types, collection, summary, nodes),
      },
      subtotals: undefined,
    };
  }
  return {
    items: valueEntries(decl, types, collection, nodes),
    totals: summary === undefined ? undefined : {
      entries: valueTotalsOf(decl, types, collection, summary, nodes),
      tiles: valueTiles(decl, types, collection, summary, nodes),
    },
    subtotals: collection.rollups.length === 0 ? undefined : valueSubtotals(decl, types, collection, nodesOf),
  };
}

/** A collection's entries of a row, its totals at every tile: `(K, V) → Dict<IK, P>`. */
function wholeEntries(types: NestedTypes, parts: CollectionParts): FunctionExpr<[EastType, EastType], EntriesType> {
  const { totals, subtotals } = parts;
  return rowUnion(types, [
    parts.items,
    ...(totals === undefined ? [] : [East.function([types.keyType, types.rowType], types.entries, ($, key, row) => {
      const totalled = $.const(totals.entries);
      return totalled(key, row, variant('all', null));
    })]),
    ...(subtotals === undefined ? [] : [East.function([types.keyType, types.rowType], types.entries, ($, key, row) => {
      const composed = $.const(subtotals.entries);
      return composed(key, row, variant('all', null));
    })]),
  ]);
}

/**
 * A collection's entries a write changes, by its patch ({@link WriteEntries}):
 * the entries of the items it touched, before and after, and, where it touched
 * any, the totals of the summary tiles they touch and every parent's subtotals
 * of the tiles at each level they touch — every subtotal, in a recursive tree
 * ({@link SubtotalParts}' `local`) — of the row before and after.
 *
 * @param types - The index's types
 * @param parts - The collection's parts
 * @returns Its part of a write's entries
 */
function patchedParts(types: NestedTypes, parts: CollectionParts): WriteEntries {
  const { keyType, rowType, changed, summary } = types;
  const { totals, subtotals } = parts;
  const moved = writeUnion(types, [
    ...(totals === undefined || summary === undefined ? [] : [East.function(
      [keyType, rowType, rowType, rowType, rowType], changed, ($, key, held, next, heldTouched, nextTouched) => {
        const tilesOf = $.const(totals.tiles);
        const totalled = $.const(totals.entries);
        const within = $.const(tilesWithin);
        const at = $.let(within(tilesOf(key, heldTouched).union(tilesOf(key, nextTouched)), summary));
        return { before: totalled(key, held, at), after: totalled(key, next, at) };
      },
    )]),
    ...(subtotals === undefined ? [] : [subtotals.local
      ? East.function([keyType, rowType, rowType, rowType, rowType], changed, ($, key, held, next, heldTouched, nextTouched) => {
        const composed = $.const(subtotals.entries);
        const instantsOf = $.const(subtotals.instants);
        const tilesOf = $.const(subtotalTiles);
        const levels = $.let([...types.levels], ArrayType(RecordLevelType));
        const at = $.let(tilesOf(instantsOf(key, heldTouched).union(instantsOf(key, nextTouched)), levels));
        return { before: composed(key, held, at), after: composed(key, next, at) };
      })
      : East.function([keyType, rowType, rowType, rowType, rowType], changed, ($, key, held, next) => {
        const composed = $.const(subtotals.entries);
        return { before: composed(key, held, variant('all', null)), after: composed(key, next, variant('all', null)) };
      })]),
  ]);
  return East.function([keyType, rowType, rowType, rowType, rowType], changed, ($, key, held, next, heldTouched, nextTouched) => {
    const filed = $.const(parts.items);
    const others = $.const(moved);
    const before = $.let(filed(key, heldTouched));
    const after = $.let(filed(key, nextTouched));
    // Nothing of the collection touched: none of its totals or subtotals moves.
    $.if(East.greater(before.size(), 0n).or(() => East.greater(after.size(), 0n)), ($) => {
      const more = $.let(others(key, held, next, heldTouched, nextTouched));
      $(before.unionInPlace(more.before));
      $(after.unionInPlace(more.after));
    });
    return { before, after };
  });
}

// ── The row's entries, a write's by its patch, and the row's lean form ───────

/**
 * What a write's patch makes of a row's entries: `whole` where it cannot say
 * — a replace on the way — or the entries it changes, before and after.
 *
 * @param entries - The row's entries, `Dict<IK, P>`
 * @returns The variant type
 */
export function NestedPatchedType<E extends EastType>(entries: E) {
  return VariantType({ whole: NullType, changed: StructType({ before: entries, after: entries }) });
}

/**
 * A write's entries of a row, by its patch: `(K, V, V, Patch) → Patched`,
 * given the row before and after and the patch between them — the row walked
 * by the patch ({@link rowWalk}), and each collection's entries what it
 * touched moves, before and after ({@link patchedParts}); `whole` where a
 * replace on the way leaves the row to be compared whole.
 *
 * @param decl - The checked declaration
 * @param types - The index's types
 * @param parts - Each collection's parts
 * @returns The function
 */
function nestedByPatch(decl: NestedDeclaration, types: NestedTypes, parts: readonly CollectionParts[]) {
  const { keyType, rowType, entries } = types;
  const walk = rowWalk(decl);
  const collections = writeUnion(types, parts.map((part) => patchedParts(types, part)));
  const patchType = patchTypeOf(rowType);
  const patchedType = NestedPatchedType(entries);
  return East.function([keyType, rowType, rowType, patchType], patchedType, ($, key, held, next, patch) => {
    const touched = $.const(walk);
    const changes = $.const(collections);
    $.match(touched(held, next, patch), {
      replaced: ($) => {
        $.return(variant('whole', null));
      },
      unchanged: ($) => {
        $.return(variant('changed', { before: new Map(), after: new Map() }));
      },
      touched: ($, rows) => {
        $.return(variant('changed', changes(key, held, next, rows.held, rows.next)));
      },
    });
    return variant('whole', null);
  });
}

/**
 * A row's entries: `(K, V) → Dict<IK, P>`, each part's — every collection's
 * items or values filed, its totals where a summary is declared, its subtree
 * filing where it rolls items up, and its parents' subtotals where it rolls
 * values up — one after another, each a function calling the parts before it.
 * And a write's, by its patch ({@link nestedByPatch}), from the same parts.
 *
 * @param decl - The checked declaration
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param tile - The index's tile
 * @param summary - Its summary tile; none where no totals are kept
 * @returns The entries, a write's by its patch, and their key and value types
 */
export function nestedEntries(
  decl: NestedDeclaration, keyType: EastType, rowType: EastType, tile: RecordTile, summary: RecordTile | undefined,
): {
  readonly entries: RowEntries;
  readonly byPatch: FunctionExpr<[EastType, EastType, EastType, EastType], ReturnType<typeof NestedPatchedType>>;
  readonly entryKey: EastType;
  readonly entryValue: EastType;
} {
  const entryKey = NestedEntryKeyType(keyType);
  const entryValue = NestedEntryType(decl.places);
  const entries = DictType(entryKey, entryValue);
  const types: NestedTypes = {
    keyType, rowType, entryKey, entryValue, entries,
    changed: StructType({ before: entries, after: entries }),
    tile: levelOf(tile),
    summary: summary === undefined ? undefined : levelOf(summary),
    levels: RECORD_TILES.slice(RECORD_TILES.indexOf(tile)).map(levelOf),
  };
  const nodesOf = groupNodes(decl, rowType);
  const parts = decl.collections.map((collection) => collectionParts(decl, types, collection, nodesOf));
  return {
    entries: rowUnion(types, parts.map((part) => wholeEntries(types, part))),
    byPatch: nestedByPatch(decl, types, parts),
    entryKey,
    entryValue,
  };
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
    const holding = withField(group.type, group.through, rowsType);
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
 * The nested series index's definition (`index.nested`, #1434): its key function a row's entries, `(K, V) →
 * Dict<IK, P>` — every declared collection's items filed by #1433's levels,
 * each node's totals where a summary is declared, each item rolled up filed
 * under every ancestor too, and every parent's subtotals of each collection of
 * values rolled up — a write's entries by its patch, which a write maintains
 * it by where the patch can say what it touched, and, for the record's other
 * indexes, its lean row.
 *
 * @param constructor - The declaration, as a refusal names it
 * @param name - The index
 * @param rec - Its record
 * @param spec - `collections`, `tile` and `summary`, as written
 * @param config - Its runner selection
 * @returns The definition: its key e3-types' `NestedEntryKeyType`, its value `NestedEntryType`
 * @throws {Error} Beside `collections`, the key form's fields, `on` or a `value`; a tile of none of the five; a second
 *   nested series index on the record; or what {@link checkNested} refuses, each in its words
 */
export function nestedDefinition(
  constructor: IndexConstructor, name: string, rec: RecordDef, spec: object, config: { runner?: FunctionRunner } | undefined,
): RecordIndexDef {
  const { keyType, valueType } = indexedEntry(constructor, name, rec);
  if ('key' in spec || 'from' in spec || 'to' in spec) {
    throw new Error(`${constructor} '${name}' takes collections, tile and summary — key, from and to file the record's own events: index.series({ key, from, to, tile })`);
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
  const decl = checkNested(constructor, name, valueType, written.collections);
  const { entries, byPatch, entryKey, entryValue } = nestedEntries(decl, keyType, valueType, tile, summary);
  const runner = indexRunner(config);
  checkPure(`${constructor} '${name}' entries`, entries, INDEX_PURITY);
  checkPure(`${constructor} '${name}' entries by a patch`, byPatch, INDEX_PURITY);
  checkEntryParams(constructor, name, 'entries', keyType, valueType, signatureOf(entries).inputs);
  const def: RecordIndexDef = {
    kind: 'recordIndex',
    name,
    record: rec,
    // No field leads it: a nested collection is read by its row's key.
    on: Object.freeze([]),
    nested: Object.freeze({
      collections: written.collections, tile, summary, declaration: decl.declaration, lean: nestedLean(decl, keyType, valueType), byPatch,
    }),
    keyFn: entries,
    // A row gives many entries, each with its own value.
    multi: true,
    keyType: entryKey,
    valueType: entryValue,
    runner,
  };
  return def;
}
