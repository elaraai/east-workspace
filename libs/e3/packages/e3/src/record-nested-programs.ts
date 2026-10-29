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
 * from a declaration's types. A program holds once each function its parts
 * share, however many collections call it: it binds the tiles' steps, filing
 * and sharing an item out, and the totals' and subtotals' functions in its kit
 * ({@link programKit}), which every part is given, and each group's part binds
 * the group's walk once for its collections ({@link groupEntries}). A node is
 * read and rebuilt, and an item placed in its place's variants, by the names a
 * declaration gives, through East's own builders for names held as values
 * (`East.field`, `East.withField`, `East.inCase`), which check each name
 * against its type as the program is built.
 *
 * @packageDocumentation
 */
import {
  ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, SetType, StringType,
  StructType, VariantType, none, printType, some, variant,
  type CallableFunctionExpr, type EastType, type Expr, type FunctionExpr, type VariantExpr,
} from '@elaraai/east';
import {
  NestedEntryKeyType, NestedEntryType, NestedSpanKeyType, RecordLevelType, RecordNestedItemType, RecordNestedPathType, RecordNestedRunType,
  RecordNestedTotalsType, RecordRollupType, RecordSummaryTotalsType, nestedSpanName,
  type RecordLevel,
} from '@elaraai/e3-types';
import { checkNested, type NestedCollection, type NestedDeclaration, type NestedGroup, type NestedItems, type NestedValues } from './record-nested.js';
import {
  INDEX_PURITY, checkEntryParams, checkPure, functionAt, indexRunner, indexedEntry, onlyOptions, sameEastType, signatureOf, type IndexConstructor,
} from './record-guards.js';
import { fieldReader } from './record-keys.js';
import { patchTypeOf } from './record-patches.js';
import {
  RECORD_TILES, TileFilingType, TileShareType, TileStepFnType, checkTile, placedFilingsOver, placedSharesOver, tileNext, tileStart,
  type RecordTile,
} from './record-tiles.js';
import { summaryMerge } from './record-series.js';
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

/** `(path) → keys`: a node's keys out of a key's path, from the row down — the inverse of {@link pathOf}. */
const keysOf = East.function([RecordNestedPathType], KeysType, ($, path) => {
  const keys = $.let([], KeysType);
  const at = $.let(path);
  $.while(true, ($2, label) => {
    $2.match(at.unwrap(), {
      step: ($3, step) => {
        $3(keys.pushLast(step.key));
        $3.assign(at, step.rest);
      },
      end: ($3) => {
        $3.break(label);
      },
    });
  });
  return keys;
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

/**
 * `(instants, level, startOf) → Dict<tile, Totals>`: values' totals in each
 * summary tile, an instant covering none of it: how many.
 */
const instantTotals = East.function(
  [SetType(DateTimeType), RecordLevelType, TileStepFnType], DictType(DateTimeType, RecordNestedTotalsType),
  (_$, instants, level, startOf) => instants.groupReduce(
    (_$, at) => startOf(level, at),
    ($) => $.const(NO_TOTALS, RecordNestedTotalsType),
    (_$, totals) => ({ count: totals.count.add(1n), ms: totals.ms, values: totals.values }),
  ),
);

/**
 * `(values, level, startOf) → Dict<tile, Totals>`: Float values' totals in
 * each summary tile — how many, and their sum, the least, the greatest and the
 * value at the latest instant, taken in key order, so every runtime adds them
 * alike.
 */
const valueTotals = East.function(
  [DictType(DateTimeType, FloatType), RecordLevelType, TileStepFnType], DictType(DateTimeType, RecordNestedTotalsType),
  (_$, values, level, startOf) => values.groupReduce(
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
  ),
);

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

/** `(tiles, level, nextOf) → Within`: a write's tiles of a level, and their span. */
const tilesWithin = East.function([SetType(DateTimeType), RecordLevelType, TileStepFnType], WithinType, ($, tiles, level, after) => {
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

/** `(span, level, at, startOf) → Boolean`: whether a value's instant is in one of a write's tiles. */
const inSpan = East.function([SpanType, RecordLevelType, DateTimeType, TileStepFnType], BooleanType, (_$, span, level, at, startOf) =>
  East.greaterEqual(at, span.from).and(() => East.less(at, span.to)).and(() => span.tiles.has(startOf(level, at))));

// ── The tiles subtotals are worked out at ─────────────────────────────────────

/**
 * The tiles a parent's subtotals are worked out at: `all`, as a row's entries
 * are; `only` a write's, by level — the tiles of each level the values its
 * patch names fall in, and their span. A value in none of them moves none of
 * the subtotals the write compares.
 */
const SubtotalTilesType = VariantType({ all: NullType, only: DictType(RecordLevelType, SpanType) });

/** `(instants, levels, startOf, nextOf) → SubtotalTiles`: the tiles of each level some values' instants fall in. */
const subtotalTiles = East.function(
  [SetType(DateTimeType), ArrayType(RecordLevelType), TileStepFnType, TileStepFnType], SubtotalTilesType,
  ($, instants, levels, startOf, nextOf) => {
    const within = $.const(tilesWithin);
    return variant('only', levels.toDict(
      (_$, level) => level,
      (_$, level) => within(instants.toSet((_$, at) => startOf(level, at)), level, nextOf).unwrap('only'),
    ));
  },
);

/** `(own, level, tiles, startOf) → own`: a node's own values in the tiles of a level its subtotals are worked out at. */
const valuesAt = East.function(
  [DictType(DateTimeType, FloatType), RecordLevelType, SubtotalTilesType, TileStepFnType], DictType(DateTimeType, FloatType),
  ($, own, level, tiles, startOf) => {
    const kept = $.const(inSpan);
    return tiles.match({
      all: () => own,
      only: (_$, spans) => own.filter((_$, _value, at) => kept(spans.get(level), level, at, startOf)),
    });
  },
);

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

/** `(own, level, startOf) → Dict<tile, Folded>`: a node's own values a tile of a level at a time, in key order. */
const foldedTiles = East.function(
  [DictType(DateTimeType, FloatType), RecordLevelType, TileStepFnType], DictType(DateTimeType, FoldedType),
  (_$, own, level, startOf) => own.groupReduce(
    (_$, _value, at) => startOf(level, at),
    ($) => $.const({ sum: 0.0, n: 0n, min: 0.0, max: 0.0, last: 0.0 }, FoldedType),
    (_$, folded, value) => ({
      sum: folded.sum.add(value),
      n: folded.n.add(1n),
      min: East.equal(folded.n, 0n).ifElse(() => value, () => East.min(folded.min, value)),
      max: East.equal(folded.n, 0n).ifElse(() => value, () => East.max(folded.max, value)),
      last: value,
    }),
  ),
);

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
 * `(own, rollups, levels, tiles, startOf) → Dict<DrawKey, Float>`: what a
 * node holding values draws, by each rollup, at each level, in each tile its
 * values touch of those asked for.
 */
const ownDraws = East.function(
  [DictType(DateTimeType, FloatType), ArrayType(RecordRollupType), ArrayType(RecordLevelType), SubtotalTilesType, TileStepFnType],
  DictType(DrawKeyType, FloatType),
  ($, own, rollups, levels, at, startOf) => {
    const tiles = $.const(foldedTiles);
    const within = $.const(valuesAt);
    const draw = $.const(ownDraw);
    return levels.flattenToDict((_$, level) => tiles(within(own, level, at, startOf), level, startOf).flattenToDict((_$, folded, tile) =>
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
 * `(node, children, rollups, levels, tiles, startOf) → Composed`: a node's
 * result, at the tiles asked for. One holding values of its own draws them,
 * and keeps no subtotal; one holding none draws its children's, and keeps what
 * it draws, where it draws, as its subtotals. Either way, it carries every
 * subtotal beneath it on to its parent.
 */
const composed = East.function(
  [SubtotalNodeType, ArrayType(ComposedType), ArrayType(RecordRollupType), ArrayType(RecordLevelType), SubtotalTilesType, TileStepFnType],
  ComposedType,
  ($, node, children, rollups, levels, tiles, startOf) => {
    const own = $.const(ownDraws);
    const gathered = $.const(childDraws);
    const path = $.const(pathOf);
    const beneath = $.let(children.flatMap((_$, child) => child.subtotals.toArray((_$, value, key) => ({ key, value })))
      .toDict((_$, subtotal) => subtotal.key, (_$, subtotal) => subtotal.value));
    $.if(East.greater(node.own.size(), 0n), ($) => {
      $.return({ draws: own(node.own, rollups, levels, tiles, startOf), subtotals: beneath });
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
 * `(nodes, rollups, levels, tiles, startOf) → Dict<SubtotalKey, Float>`:
 * every parent's subtotals of a collection of values at the tiles asked for,
 * composed bottom-up by `toTree` over the nodes from the row down to the
 * collection, each node's result carried to its parent. A tile no
 * descendant's value touches has none.
 */
const subtotalsOf = East.function(
  [ArrayType(SubtotalNodeType), ArrayType(RecordRollupType), ArrayType(RecordLevelType), SubtotalTilesType, TileStepFnType],
  DictType(SubtotalKeyType, FloatType),
  ($, nodes, rollups, levels, tiles, startOf) => {
    const compose = $.const(composed);
    const roots = $.let(nodes.toTree(ComposedType, (_$, node) => node.key, (_$, node) => node.parent,
      (_$, node, _i, children) => compose(node, children, rollups, levels, tiles, startOf)));
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

/** A row's entries: `(K, V) → Dict<IK, P>`. */
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

/** A group's nodes from a row, as a function a part is given: `(V) → Array<NodeAt>`. */
function WalkType(rowType: EastType, group: NestedGroup) {
  return FunctionType([rowType], ArrayType(NodeAtType(group.type)));
}

// ── A program's kit ───────────────────────────────────────────────────────────

/** `(keys) → Path`: {@link pathOf}'s type. */
const PathFnType = FunctionType([KeysType], RecordNestedPathType);

/** `(tile, start, end, what, startOf, nextOf) → Array<TileFiling>`: {@link placedFilingsOver}'s type. */
const FileFnType = FunctionType(
  [RecordLevelType, OptionType(DateTimeType), OptionType(DateTimeType), StringType, TileStepFnType, TileStepFnType], ArrayType(TileFilingType));

/** `(tile, start, end, what, startOf, nextOf) → Array<TileShare>`: {@link placedSharesOver}'s type. */
const ShareFnType = FunctionType(
  [RecordLevelType, OptionType(DateTimeType), OptionType(DateTimeType), StringType, TileStepFnType, TileStepFnType], ArrayType(TileShareType));

/** `(shares) → Dict<tile, Totals>`: {@link sharedTotals}' type. */
const TotalledFnType = FunctionType([ArrayType(TileShareType)], DictType(DateTimeType, RecordNestedTotalsType));

/** `(instants, level, startOf) → Dict<tile, Totals>`: {@link instantTotals}' type. */
const CountedFnType = FunctionType([SetType(DateTimeType), RecordLevelType, TileStepFnType], DictType(DateTimeType, RecordNestedTotalsType));

/** `(values, level, startOf) → Dict<tile, Totals>`: {@link valueTotals}' type. */
const SummedFnType = FunctionType(
  [DictType(DateTimeType, FloatType), RecordLevelType, TileStepFnType], DictType(DateTimeType, RecordNestedTotalsType));

/** `(span, level, at, startOf) → Boolean`: {@link inSpan}'s type. */
const KeptFnType = FunctionType([SpanType, RecordLevelType, DateTimeType, TileStepFnType], BooleanType);

/** `(tiles, level, nextOf) → Within`: {@link tilesWithin}'s type. */
const WithinFnType = FunctionType([SetType(DateTimeType), RecordLevelType, TileStepFnType], WithinType);

/** `(instants, levels, startOf, nextOf) → SubtotalTiles`: {@link subtotalTiles}' type. */
const LevelsWithinFnType = FunctionType([SetType(DateTimeType), ArrayType(RecordLevelType), TileStepFnType, TileStepFnType], SubtotalTilesType);

/** `(nodes, rollups, levels, tiles, startOf) → Dict<SubtotalKey, Float>`: {@link subtotalsOf}' type. */
const SubtotalsFnType = FunctionType(
  [ArrayType(SubtotalNodeType), ArrayType(RecordRollupType), ArrayType(RecordLevelType), SubtotalTilesType, TileStepFnType],
  DictType(SubtotalKeyType, FloatType));

/**
 * A program's kit: the functions its parts call, bound once in the program's
 * body and handed to every part ({@link programKit}), so a program holds each
 * once, however many of its parts call it. A function stepping through the
 * tiles is given the kit's `startOf` and `nextOf` by its caller.
 */
const KitType = StructType({
  /** {@link tileStart} */
  startOf: TileStepFnType,
  /** {@link tileNext} */
  nextOf: TileStepFnType,
  /** {@link pathOf} */
  path: PathFnType,
  /** Where an item is filed: {@link placedFilingsOver} */
  file: FileFnType,
  /** An item's shares of the tiles it touches: {@link placedSharesOver} */
  share: ShareFnType,
  /** {@link sharedTotals} */
  totalled: TotalledFnType,
  /** {@link instantTotals} */
  counted: CountedFnType,
  /** {@link valueTotals} */
  summed: SummedFnType,
  /** {@link inSpan} */
  kept: KeptFnType,
  /** {@link tilesWithin} */
  within: WithinFnType,
  /** {@link subtotalTiles} */
  levelsWithin: LevelsWithinFnType,
  /** {@link subtotalsOf} */
  subtotals: SubtotalsFnType,
});
type KitType = typeof KitType;

/** A function of a program's kit only some parts call, by its name: every part calls the tiles' steps and a path's. */
type KitName = 'file' | 'share' | 'totalled' | 'counted' | 'summed' | 'kept' | 'within' | 'levelsWithin' | 'subtotals';

/** Each function of a kit only some parts call, as they call it. */
const KIT_CALLED = {
  file: placedFilingsOver, share: placedSharesOver, totalled: sharedTotals, counted: instantTotals, summed: valueTotals, kept: inSpan,
  within: tilesWithin, levelsWithin: subtotalTiles, subtotals: subtotalsOf,
};

/**
 * Each function of a kit only some parts call, as a kit holds it where none of
 * its program's parts calls it: one of its type making nothing, so a program
 * holds only the functions its parts call.
 */
const KIT_UNCALLED = {
  file: East.function(FileFnType.inputs, FileFnType.output, () => []),
  share: East.function(ShareFnType.inputs, ShareFnType.output, () => []),
  totalled: East.function(TotalledFnType.inputs, TotalledFnType.output, () => new Map()),
  counted: East.function(CountedFnType.inputs, CountedFnType.output, () => new Map()),
  summed: East.function(SummedFnType.inputs, SummedFnType.output, () => new Map()),
  kept: East.function(KeptFnType.inputs, KeptFnType.output, () => false),
  within: East.function(WithinFnType.inputs, WithinFnType.output, () => variant('all', null)),
  levelsWithin: East.function(LevelsWithinFnType.inputs, LevelsWithinFnType.output, () => variant('all', null)),
  subtotals: East.function(SubtotalsFnType.inputs, SubtotalsFnType.output, () => new Map()),
};

/**
 * A program's kit ({@link KitType}): `() → Kit`, each function its parts call
 * bound once — the tiles' steps and a path's always, each other the parts
 * name, and in place of each they do not, one making nothing.
 *
 * @param calls - What the program's parts call of the kit, beside the tiles' steps and a path's
 * @returns The kit
 */
function programKit(calls: ReadonlySet<KitName>): CallableFunctionExpr<[], KitType> {
  const kit = {
    startOf: tileStart,
    nextOf: tileNext,
    path: pathOf,
    file: calls.has('file') ? KIT_CALLED.file : KIT_UNCALLED.file,
    share: calls.has('share') ? KIT_CALLED.share : KIT_UNCALLED.share,
    totalled: calls.has('totalled') ? KIT_CALLED.totalled : KIT_UNCALLED.totalled,
    counted: calls.has('counted') ? KIT_CALLED.counted : KIT_UNCALLED.counted,
    summed: calls.has('summed') ? KIT_CALLED.summed : KIT_UNCALLED.summed,
    kept: calls.has('kept') ? KIT_CALLED.kept : KIT_UNCALLED.kept,
    within: calls.has('within') ? KIT_CALLED.within : KIT_UNCALLED.within,
    levelsWithin: calls.has('levelsWithin') ? KIT_CALLED.levelsWithin : KIT_UNCALLED.levelsWithin,
    subtotals: calls.has('subtotals') ? KIT_CALLED.subtotals : KIT_UNCALLED.subtotals,
  };
  return East.function([], KitType, () => kit);
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

// ── A collection's parts ──────────────────────────────────────────────────────

/** A collection's words in a refusal: the row's key, its place, and the item's key, printed. */
function whatWords(collection: NestedCollection): string {
  return collection.place.join(' ');
}

/** A node's items' shares of the summary tiles they touch. */
const NodeSharesType = StructType({ path: KeysType, shares: ArrayType(TileShareType) });

/** No items or values: a tile's totals before any is counted. */
const NO_SPAN_TOTALS = { count: 0n, ms: 0n };

/** The tile a nested series index's span counts by: a Plan's horizon spans whole months. */
const SPAN_TILE: RecordTile = 'month';

/** A row's months, by collection: `Dict<{ collection, tile }, Totals>`. */
const SpanTotalsType = DictType(NestedSpanKeyType, RecordSummaryTotalsType);
type SpanTotalsType = typeof SpanTotalsType;

/** A group's nodes from a row, as a part is given them: `(V) → Array<NodeAt>`. */
type WalkFnType = ReturnType<typeof WalkType>;

/** A group's collections' entries of a row, a program's part of them: `(K, V, Kit) → Dict<IK, P>`. */
type EntriesPart = CallableFunctionExpr<[EastType, EastType, KitType], EntriesType>;

/**
 * What a write changes of a group's collections' entries, by its patch, a
 * program's part of it: `(K, V, V, V, V, Kit) → { before, after }`, given the
 * row before and after, and the row before and after holding only what the
 * write's patch touched.
 */
type PatchedPart = CallableFunctionExpr<[EastType, EastType, EastType, EastType, EastType, KitType], ChangedType>;

/** A group's collections' months of a row, a program's part of the index's span: `(K, V, Kit) → Dict<{ collection, tile }, Totals>`. */
type SpanPart = CallableFunctionExpr<[EastType, EastType, KitType], SpanTotalsType>;

/** A collection's entries of a row, given its group's nodes: `(K, V, Nodes, Kit) → Dict<IK, P>`. */
type NodesEntries = CallableFunctionExpr<[EastType, EastType, WalkFnType, KitType], EntriesType>;

/** Things people drag's entries from their shares: `(K, Array<{ path, shares }>, Kit) → Dict<IK, P>`. */
type SharedEntries = CallableFunctionExpr<[EastType, ArrayType<typeof NodeSharesType>, KitType], EntriesType>;

/** Each node's items' shares of the tiles asked for: `(K, V, Within, Nodes, Kit) → Array<{ path, shares }>`. */
type NodesShares = CallableFunctionExpr<[EastType, EastType, typeof WithinType, WalkFnType, KitType], ArrayType<typeof NodeSharesType>>;

/** A collection of values' totals at the tiles asked for: `(K, V, Within, Nodes, Kit) → Dict<IK, P>`. */
type WithinEntries = CallableFunctionExpr<[EastType, EastType, typeof WithinType, WalkFnType, KitType], EntriesType>;

/**
 * What a write changes of a collection's entries, by its patch — or moves of
 * its totals and subtotals — given its group's nodes: `(K, V, V, V, V, Nodes,
 * Kit) → { before, after }`, given what a {@link PatchedPart} is.
 */
type NodesChanged = CallableFunctionExpr<[EastType, EastType, EastType, EastType, EastType, WalkFnType, KitType], ChangedType>;

/** A collection's months of a row, for the index's span, given its group's nodes: `(K, V, Nodes, Kit) → Dict<{ collection, tile }, Totals>`. */
type NodesSpan = CallableFunctionExpr<[EastType, EastType, WalkFnType, KitType], SpanTotalsType>;

/** Every node from the row down to a collection of values' group: `(V, Nodes) → Array<SubtotalNode>`. */
type Gathered = CallableFunctionExpr<[EastType, WalkFnType], ArrayType<typeof SubtotalNodeType>>;

/** Every parent's subtotals of a collection of values: `(K, Array<SubtotalNode>, SubtotalTiles, Kit) → Dict<IK, P>`. */
type SubtotalEntries = CallableFunctionExpr<[EastType, ArrayType<typeof SubtotalNodeType>, typeof SubtotalTilesType, KitType], EntriesType>;

/** `(K, V, Nodes, Kit) → Dict<IK, P>`: parts' entries, one after another, each a function calling the parts before it. */
function nodesUnion(types: NestedTypes, nodesType: WalkFnType, parts: readonly NodesEntries[]): NodesEntries {
  const [first, ...rest] = parts;
  if (first === undefined) return East.function([types.keyType, types.rowType, nodesType, KitType], types.entries, () => new Map());
  return rest.reduce<NodesEntries>((before, part) => East.function([types.keyType, types.rowType, nodesType, KitType], types.entries,
    ($, key, row, nodes, kit) => {
      const all = $.let(before(key, row, nodes, kit));
      $(all.unionInPlace(part(key, row, nodes, kit)));
      return all;
    }), first);
}

/** `(K, shares, Kit) → Dict<IK, P>`: two parts' entries from the same shares, one's then the other's. */
function sharedBoth(types: NestedTypes, first: SharedEntries, second: SharedEntries): SharedEntries {
  return East.function([types.keyType, ArrayType(NodeSharesType), KitType], types.entries, ($, key, shared, kit) => {
    const all = $.let(first(key, shared, kit));
    $(all.unionInPlace(second(key, shared, kit)));
    return all;
  });
}

/** `(K, V, V, V, V, Nodes, Kit) → { before, after }`: what parts change, one after another, each a function calling the parts before it. */
function changedUnion(types: NestedTypes, nodesType: WalkFnType, parts: readonly NodesChanged[]): NodesChanged {
  const { keyType, rowType, changed } = types;
  const [first, ...rest] = parts;
  if (first === undefined) {
    return East.function([keyType, rowType, rowType, rowType, rowType, nodesType, KitType], changed, () => ({ before: new Map(), after: new Map() }));
  }
  return rest.reduce<NodesChanged>((before, part) => East.function([keyType, rowType, rowType, rowType, rowType, nodesType, KitType], changed,
    ($, key, held, next, heldTouched, nextTouched, nodes, kit) => {
      const all = $.let(before(key, held, next, heldTouched, nextTouched, nodes, kit));
      const more = $.let(part(key, held, next, heldTouched, nextTouched, nodes, kit));
      $(all.before.unionInPlace(more.before));
      $(all.after.unionInPlace(more.after));
      return all;
    }), first);
}

/** `(K, V, Nodes, Kit) → Dict<{ collection, tile }, Totals>`: parts' months, one after another, each a function calling the parts before it. */
function spanNodesUnion(types: NestedTypes, nodesType: WalkFnType, parts: readonly NodesSpan[]): NodesSpan {
  const [first, ...rest] = parts;
  if (first === undefined) return East.function([types.keyType, types.rowType, nodesType, KitType], SpanTotalsType, () => new Map());
  return rest.reduce<NodesSpan>((before, part) => East.function([types.keyType, types.rowType, nodesType, KitType], SpanTotalsType,
    ($, key, row, nodes, kit) => {
      const all = $.let(before(key, row, nodes, kit));
      $(all.unionInPlace(part(key, row, nodes, kit)));
      return all;
    }), first);
}

/**
 * A group's collections' entries of a row ({@link EntriesPart}): the group's
 * walk bound once, and given to each collection's.
 *
 * @param types - The index's types
 * @param nodes - The group's walk
 * @param entries - Its collections' entries, given the walk
 * @returns The part
 */
function groupEntries(types: NestedTypes, nodes: NodesOf, entries: NodesEntries): EntriesPart {
  return East.function([types.keyType, types.rowType, KitType], types.entries, ($, key, row, kit) => {
    const walk = $.const(nodes);
    return entries(key, row, walk, kit);
  });
}

/**
 * A group's collections' part of a write's entries, by its patch ({@link
 * PatchedPart}): the group's walk bound once, and given to each collection's.
 *
 * @param types - The index's types
 * @param nodes - The group's walk
 * @param changed - Its collections' parts, given the walk
 * @returns The part
 */
function groupPatched(types: NestedTypes, nodes: NodesOf, changed: NodesChanged): PatchedPart {
  const { keyType, rowType } = types;
  return East.function([keyType, rowType, rowType, rowType, rowType, KitType], types.changed, ($, key, held, next, heldTouched, nextTouched, kit) => {
    const walk = $.const(nodes);
    return changed(key, held, next, heldTouched, nextTouched, walk, kit);
  });
}

/**
 * A group's collections' months of a row, for the index's span ({@link
 * SpanPart}): the group's walk bound once, and given to each collection's.
 *
 * @param types - The index's types
 * @param nodes - The group's walk
 * @param span - Its collections' months, given the walk
 * @returns The part
 */
function groupSpan(types: NestedTypes, nodes: NodesOf, span: NodesSpan): SpanPart {
  return East.function([types.keyType, types.rowType, KitType], SpanTotalsType, ($, key, row, kit) => {
    const walk = $.const(nodes);
    return span(key, row, walk, kit);
  });
}

/**
 * What a write changes of a collection's entries, by its patch, given its
 * group's nodes ({@link NodesChanged}): the entries of the items or values it
 * touched, before and after, and, where it touched any, what it moves of the
 * collection's totals and subtotals.
 *
 * @param types - The index's types
 * @param nodesType - The group's walk's type
 * @param filed - The collection's items or values filed, given the walk
 * @param moved - What a write moves of its totals and subtotals; none where it keeps neither
 * @returns The collection's part
 */
function patchedWith(types: NestedTypes, nodesType: WalkFnType, filed: NodesEntries, moved: NodesChanged | undefined): NodesChanged {
  const { keyType, rowType, changed } = types;
  if (moved === undefined) {
    return East.function([keyType, rowType, rowType, rowType, rowType, nodesType, KitType], changed,
      ($, key, _held, _next, heldTouched, nextTouched, nodes, kit) => {
        const filing = $.const(filed);
        return { before: filing(key, heldTouched, nodes, kit), after: filing(key, nextTouched, nodes, kit) };
      });
  }
  return East.function([keyType, rowType, rowType, rowType, rowType, nodesType, KitType], changed,
    ($, key, held, next, heldTouched, nextTouched, nodes, kit) => {
      const filing = $.const(filed);
      const before = $.let(filing(key, heldTouched, nodes, kit));
      const after = $.let(filing(key, nextTouched, nodes, kit));
      // Nothing of the collection touched: none of its totals or subtotals moves.
      $.if(East.greater(before.size(), 0n).or(() => East.greater(after.size(), 0n)), ($) => {
        const more = $.let(moved(key, held, next, heldTouched, nextTouched, nodes, kit));
        $(before.unionInPlace(more.before));
        $(after.unionInPlace(more.after));
      });
      return { before, after };
    });
}

/** Things people drag, filed: `(K, V, Nodes, Kit) → Dict<IK, P>`, each item once (or once a year past a year), at the level its length fits, under its node. */
function itemEntries(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, nodesType: WalkFnType): NodesEntries {
  const group = decl.groups[collection.group]!;
  const { keyType, rowType, entryKey, entries, tile } = types;
  const holding = fieldOf(group.type, collection.field, DictType(StringType, collection.itemType));
  const readStart = fieldReader(StringType, collection.itemType, { option: collection.start });
  const readEnd = fieldReader(StringType, collection.itemType, { option: collection.end });
  const place = placedItem(decl, collection, collection.itemType, types.entryValue);
  const words = whatWords(collection);
  return East.function([keyType, rowType, nodesType, KitType], entries, ($, key, row, nodes, kit) => {
    const startOf = $.const(kit.startOf);
    const nextOf = $.const(kit.nextOf);
    const file = $.const(kit.file);
    const path = $.const(kit.path);
    const held = $.const(holding);
    const begins = $.const(readStart);
    const ends = $.const(readEnd);
    const into = $.const(place);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return nodes(row).flattenToDict(($, node) => {
      const here = $.let(path(node.path));
      return held(node.node).flattenToDict(($, item, id) => {
        const value = $.let(into(item));
        return file(tile, begins(id, item), ends(id, item), East.str`${East.print(key)} ${words} ${East.print(id)}`, startOf, nextOf).toDict(
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
 * Things people drag rolled up, filed under every ancestor too: `(K, V,
 * Nodes, Kit) → Dict<IK, P>`, in the run `subtree` of the row and of each node
 * on the way, at the level and tile of the item's own filing, the keys from
 * the ancestor down naming the item.
 */
function itemSubtreeEntries(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, nodesType: WalkFnType): NodesEntries {
  const group = decl.groups[collection.group]!;
  const { keyType, rowType, entryKey, entries, tile } = types;
  const holding = fieldOf(group.type, collection.field, DictType(StringType, collection.itemType));
  const readStart = fieldReader(StringType, collection.itemType, { option: collection.start });
  const readEnd = fieldReader(StringType, collection.itemType, { option: collection.end });
  const place = placedItem(decl, collection, collection.itemType, types.entryValue);
  const words = whatWords(collection);
  return East.function([keyType, rowType, nodesType, KitType], entries, ($, key, row, nodes, kit) => {
    const startOf = $.const(kit.startOf);
    const nextOf = $.const(kit.nextOf);
    const file = $.const(kit.file);
    const path = $.const(kit.path);
    const held = $.const(holding);
    const begins = $.const(readStart);
    const ends = $.const(readEnd);
    const into = $.const(place);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return nodes(row).flattenToDict(($, node) => held(node.node).flattenToDict(($, item, id) => {
      const value = $.let(into(item));
      const filings = $.let(file(tile, begins(id, item), ends(id, item), East.str`${East.print(key)} ${words} ${East.print(id)}`, startOf, nextOf));
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

/** Things people drag, filed ({@link itemEntries}), and, rolled up, under every ancestor too ({@link itemSubtreeEntries}). */
function itemsFiled(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, nodesType: WalkFnType): NodesEntries {
  const own = itemEntries(decl, types, collection, nodesType);
  return collection.rollup ? nodesUnion(types, nodesType, [own, itemSubtreeEntries(decl, types, collection, nodesType)]) : own;
}

/**
 * Each node's items' shares of the tiles of a level they touch ({@link
 * NodesShares}), of the tiles asked for — an item that cannot touch them not
 * shared out at all — an item with no start touching none.
 */
function itemShares(decl: NestedDeclaration, types: NestedTypes, collection: NestedItems, nodesType: WalkFnType, level: RecordLevel): NodesShares {
  const group = decl.groups[collection.group]!;
  const holding = fieldOf(group.type, collection.field, DictType(StringType, collection.itemType));
  const readStart = fieldReader(StringType, collection.itemType, { option: collection.start });
  const readEnd = fieldReader(StringType, collection.itemType, { option: collection.end });
  const words = whatWords(collection);
  return East.function([types.keyType, types.rowType, WithinType, nodesType, KitType], ArrayType(NodeSharesType), ($, key, row, within, nodes, kit) => {
    const startOf = $.const(kit.startOf);
    const nextOf = $.const(kit.nextOf);
    const share = $.const(kit.share);
    const held = $.const(holding);
    const begins = $.const(readStart);
    const ends = $.const(readEnd);
    const may = $.const(reaches);
    const kept = $.const(sharesWithin);
    return nodes(row).map((_$, node) => ({
      path: node.path,
      shares: held(node.node).flattenToArray(($, item, id) => {
        const start = $.let(begins(id, item));
        const end = $.let(ends(id, item));
        const shares = $.let([], ArrayType(TileShareType));
        $.if(may(within, start, end), ($) => {
          $.assign(shares, kept(share(level, start, end, East.str`${East.print(key)} ${words} ${East.print(id)}`, startOf, nextOf), within));
        });
        return shares;
      }),
    }));
  });
}

/** Things people drag, totalled from their shares ({@link SharedEntries}): each node's items' count and milliseconds in each summary tile they touch. */
function itemTotals(types: NestedTypes, collection: NestedItems, summary: RecordLevel): SharedEntries {
  const { keyType, entryKey, entryValue, entries } = types;
  return East.function([keyType, ArrayType(NodeSharesType), KitType], entries, ($, key, shared, kit) => {
    const totalled = $.const(kit.totalled);
    const path = $.const(kit.path);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return shared.flattenToDict(($, node) => {
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
 * Things people drag rolled up, each ancestor's totals of its subtree's items,
 * from their shares ({@link SharedEntries}): in the run `subtreeTotals`.
 */
function itemSubtreeTotals(types: NestedTypes, collection: NestedItems, summary: RecordLevel): SharedEntries {
  const { keyType, entryKey, entryValue, entries } = types;
  return East.function([keyType, ArrayType(NodeSharesType), KitType], entries, ($, key, shared, kit) => {
    const totalled = $.const(kit.totalled);
    const path = $.const(kit.path);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    // Every node's shares, under each of its ancestors: the row, and each node on the way.
    const beneath = $.let(shared.flatMap((_$, node) => East.Array.range(0n, node.path.size()).flatMap((_$, depth) =>
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

/** Things people drag's totals from their shares ({@link itemTotals}), and, rolled up, each ancestor's ({@link itemSubtreeTotals}). */
function itemsTotalled(types: NestedTypes, collection: NestedItems, summary: RecordLevel): SharedEntries {
  const own = itemTotals(types, collection, summary);
  return collection.rollup ? sharedBoth(types, own, itemSubtreeTotals(types, collection, summary)) : own;
}

/** `(K, V, Nodes, Kit) → Dict<IK, P>`: things people drag's totals at every summary tile — their shares, totalled. */
function itemsTotalledAll(types: NestedTypes, nodesType: WalkFnType, shares: NodesShares, totals: SharedEntries): NodesEntries {
  return East.function([types.keyType, types.rowType, nodesType, KitType], types.entries, (_$, key, row, nodes, kit) =>
    totals(key, shares(key, row, variant('all', null), nodes, kit), kit));
}

/**
 * What a write moves of things people drag's totals ({@link NodesChanged}): the
 * totals of the summary tiles the items it touched touch, of the row before
 * and after.
 */
function itemsMoved(types: NestedTypes, nodesType: WalkFnType, summary: RecordLevel, shares: NodesShares, totals: SharedEntries): NodesChanged {
  const { keyType, rowType, changed } = types;
  return East.function([keyType, rowType, rowType, rowType, rowType, nodesType, KitType], changed,
    ($, key, held, next, heldTouched, nextTouched, nodes, kit) => {
      const shared = $.const(shares);
      const totalled = $.const(totals);
      const within = $.const(kit.within);
      const nextOf = $.const(kit.nextOf);
      // The summary tiles the items the patch names touch, before it and after.
      const touched = $.let(shared(key, heldTouched, variant('all', null), nodes, kit).concat(shared(key, nextTouched, variant('all', null), nodes, kit)));
      const at = $.let(within(touched.flattenToSet((_$, node) => node.shares.toSet((_$, share) => share.tile)), summary, nextOf));
      return { before: totalled(key, shared(key, held, at, nodes, kit), kit), after: totalled(key, shared(key, next, at, nodes, kit), kit) };
    });
}

/**
 * The months a row's things people drag touch, each with how many of them
 * touch it and the milliseconds of it they cover ({@link SpanPart}), an item
 * across a month's end counted in each.
 */
function itemsSpan(types: NestedTypes, collection: NestedItems, nodesType: WalkFnType, shares: NodesShares): NodesSpan {
  return East.function([types.keyType, types.rowType, nodesType, KitType], SpanTotalsType, ($, key, row, nodes, kit) => {
    const path = $.const(kit.path);
    const at = $.let(path(East.value([...collection.place], KeysType)));
    return shares(key, row, variant('all', null), nodes, kit).flatMap((_$, node) => node.shares).groupReduce(
      (_$, share) => ({ collection: at, tile: share.tile }),
      ($) => $.const(NO_SPAN_TOTALS, RecordSummaryTotalsType),
      (_$, totals, share) => ({ count: totals.count.add(1n), ms: totals.ms.add(share.ms) }),
    );
  });
}

/** A collection of values, filed: `(K, V, Nodes, Kit) → Dict<IK, P>`, each value at its instant, at the index's tile. */
function valueEntries(decl: NestedDeclaration, types: NestedTypes, collection: NestedValues, nodesType: WalkFnType): NodesEntries {
  const group = decl.groups[collection.group]!;
  const { keyType, rowType, entryKey, entries, tile } = types;
  const holding = fieldOf(group.type, collection.field, DictType(DateTimeType, collection.valueType));
  const place = placedItem(decl, collection, collection.valueType, types.entryValue);
  const words = whatWords(collection);
  return East.function([keyType, rowType, nodesType, KitType], entries, ($, key, row, nodes, kit) => {
    const startOf = $.const(kit.startOf);
    const nextOf = $.const(kit.nextOf);
    const file = $.const(kit.file);
    const path = $.const(kit.path);
    const held = $.const(holding);
    const into = $.const(place);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return nodes(row).flattenToDict(($, node) => {
      const here = $.let(path(node.path));
      return held(node.node).flattenToDict(($, value, at) => {
        const instant = $.let(some(at), OptionType(DateTimeType));
        const placed = $.let(into(value));
        return file(tile, instant, instant, East.str`${East.print(key)} ${words} ${East.print(at)}`, startOf, nextOf).toDict(
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
 * A node's values' totals in each tile of a level: `(values, level, Kit) →
 * Dict<tile, Totals>` — numbers' carry their values ({@link valueTotals});
 * any other's count them ({@link instantTotals}).
 */
function valuesTotalled(collection: NestedValues) {
  const valuesType = DictType(DateTimeType, collection.valueType);
  const totalsType = DictType(DateTimeType, RecordNestedTotalsType);
  if (collection.numeric === undefined) {
    return East.function([valuesType, RecordLevelType, KitType], totalsType, ($, values, level, kit) => {
      const startOf = $.const(kit.startOf);
      const counted = $.const(kit.counted);
      return counted(values.keys(), level, startOf);
    });
  }
  const asFloats = floatsOf(collection.valueType, collection.numeric);
  return East.function([valuesType, RecordLevelType, KitType], totalsType, ($, values, level, kit) => {
    const startOf = $.const(kit.startOf);
    const floats = $.const(asFloats);
    const summed = $.const(kit.summed);
    return summed(floats(values), level, startOf);
  });
}

/**
 * A collection of values, totalled ({@link WithinEntries}): each node's
 * values in each summary tile, of the tiles asked for: how many, and, for
 * numbers, their sum, the least, the greatest and the latest.
 */
function valueTotalsOf(decl: NestedDeclaration, types: NestedTypes, collection: NestedValues, nodesType: WalkFnType, summary: RecordLevel): WithinEntries {
  const group = decl.groups[collection.group]!;
  const { keyType, rowType, entryKey, entryValue, entries } = types;
  const holding = fieldOf(group.type, collection.field, DictType(DateTimeType, collection.valueType));
  const totalsOf = valuesTotalled(collection);
  return East.function([keyType, rowType, WithinType, nodesType, KitType], entries, ($, key, row, within, nodes, kit) => {
    const startOf = $.const(kit.startOf);
    const kept = $.const(kit.kept);
    const path = $.const(kit.path);
    const held = $.const(holding);
    const totalled = $.const(totalsOf);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    return nodes(row).flattenToDict(($, node) => {
      const here = $.let(path(node.path));
      const values = $.let(held(node.node));
      const counted = $.let(within.match({
        all: () => values,
        only: (_$, span) => values.filter((_$, _value, at) => kept(span, summary, at, startOf)),
      }));
      return totalled(counted, summary, kit).toDict(
        (_$, _totals, tile) => East.value({
          collection: collectionPath, row: key, path: here, run: variant('totals', null), level: summary, tile, item: variant('none', null),
        }, entryKey),
        (_$, totals) => East.value(variant('totals', totals), entryValue),
      );
    });
  });
}

/** `(K, V, Nodes, Kit) → Dict<IK, P>`: a collection of values' totals at every summary tile. */
function valuesTotalledAll(types: NestedTypes, nodesType: WalkFnType, totals: WithinEntries): NodesEntries {
  return East.function([types.keyType, types.rowType, nodesType, KitType], types.entries, (_$, key, row, nodes, kit) =>
    totals(key, row, variant('all', null), nodes, kit));
}

/**
 * What a write moves of a collection of values' totals ({@link NodesChanged}): the
 * totals of the summary tiles the values it touched are in, of the row before
 * and after.
 */
function valuesMoved(decl: NestedDeclaration, types: NestedTypes, collection: NestedValues, nodesType: WalkFnType, summary: RecordLevel, totals: WithinEntries): NodesChanged {
  const group = decl.groups[collection.group]!;
  const { keyType, rowType, changed } = types;
  const holding = fieldOf(group.type, collection.field, DictType(DateTimeType, collection.valueType));
  return East.function([keyType, rowType, rowType, rowType, rowType, nodesType, KitType], changed,
    ($, key, held, next, heldTouched, nextTouched, nodes, kit) => {
      const startOf = $.const(kit.startOf);
      const nextOf = $.const(kit.nextOf);
      const within = $.const(kit.within);
      const holds = $.const(holding);
      const totalled = $.const(totals);
      // The summary tiles the values the patch names are in, before it and after.
      const touched = $.let(nodes(heldTouched).concat(nodes(nextTouched)).flattenToSet((_$, node) =>
        holds(node.node).toSet((_$, _value, at) => startOf(summary, at))));
      const at = $.let(within(touched, summary, nextOf));
      return { before: totalled(key, held, at, nodes, kit), after: totalled(key, next, at, nodes, kit) };
    });
}

/**
 * Every node from the row down to a collection of values' group ({@link
 * Gathered}): each group's above it, holding none of its values, then its own
 * group's, holding its values as Floats.
 */
function valuesGathered(decl: NestedDeclaration, types: NestedTypes, collection: NestedValues, nodesOf: readonly NodesOf[], numeric: 'Float' | 'Integer'): Gathered {
  const { rowType } = types;
  const group = decl.groups[collection.group]!;
  // The nodes of each group above the collection's, from the row down.
  const above = chainTo(decl, collection.group).slice(0, -1).reduce<FunctionExpr<[EastType], ArrayType<typeof SubtotalNodeType>>>((before, at) => {
    const nodes = nodesOf[at.index]!;
    const atGroup = BigInt(at.index);
    const none = noValues(at.type);
    return East.function([rowType], ArrayType(SubtotalNodeType), ($, row) => {
      const earlier = $.const(before);
      const these = $.const(nodes);
      const values = $.const(none);
      return earlier(row).concat(these(row).map((_$, node) => ({
        key: { path: node.path, group: atGroup }, parent: node.parent, own: values(node.node),
      })));
    });
  }, East.function([rowType], ArrayType(SubtotalNodeType), () => []));
  const own = valuesAsFloats(group.type, collection, numeric);
  const ownGroup = BigInt(group.index);
  const nodesType = WalkType(rowType, group);
  return East.function([rowType, nodesType], ArrayType(SubtotalNodeType), ($, row, nodes) => {
    const earlier = $.const(above);
    const values = $.const(own);
    return earlier(row).concat(nodes(row).map((_$, node) => ({ key: { path: node.path, group: ownGroup }, parent: node.parent, own: values(node.node) })));
  });
}

/** A collection of values rolled up, every parent's subtotals at the tiles asked for ({@link SubtotalEntries}), composed bottom-up ({@link subtotalsOf}). */
function valueSubtotals(types: NestedTypes, collection: NestedValues): SubtotalEntries {
  const { keyType, entryKey, entryValue, entries, levels } = types;
  return East.function([keyType, ArrayType(SubtotalNodeType), SubtotalTilesType, KitType], entries, ($, key, nodes, tiles, kit) => {
    const startOf = $.const(kit.startOf);
    const compose = $.const(kit.subtotals);
    const path = $.const(kit.path);
    const collectionPath = $.let(path(East.value([...collection.place], KeysType)));
    const rollups = $.let([...collection.rollups], ArrayType(RecordRollupType));
    const tiers = $.let([...levels], ArrayType(RecordLevelType));
    return compose(nodes, rollups, tiers, tiles, startOf).toDict(
      (_$, _value, subtotal) => East.value({
        collection: collectionPath, row: key, path: subtotal.path, run: variant('subtotals', subtotal.rollup),
        level: subtotal.level, tile: subtotal.tile, item: variant('none', null),
      }, entryKey),
      (_$, value) => East.value(variant('subtotal', value), entryValue),
    );
  });
}

/** `(K, V, Nodes, Kit) → Dict<IK, P>`: a collection of values rolled up, every parent's subtotals at every tile. */
function valuesSubtotalledAll(types: NestedTypes, nodesType: WalkFnType, gathered: Gathered, subtotals: SubtotalEntries): NodesEntries {
  return East.function([types.keyType, types.rowType, nodesType, KitType], types.entries, (_$, key, row, nodes, kit) =>
    subtotals(key, gathered(row, nodes), variant('all', null), kit));
}

/**
 * What a write moves of a collection of values' subtotals ({@link NodesChanged}):
 * every parent's subtotals of the tiles at each level the values it touched
 * are at, of the row before and after — where no node holding the
 * collection's values is a parent of another; in a recursive tree, every
 * subtotal, for a node given its first value keeps subtotals at no tile, and
 * one losing its last begins to at every tile.
 */
function valuesSubtotalsMoved(decl: NestedDeclaration, types: NestedTypes, collection: NestedValues, nodesType: WalkFnType, gathered: Gathered, subtotals: SubtotalEntries): NodesChanged {
  const { keyType, rowType, changed, levels } = types;
  if (decl.groups[collection.group]!.through !== undefined) {
    return East.function([keyType, rowType, rowType, rowType, rowType, nodesType, KitType], changed,
      ($, key, held, next, _heldTouched, _nextTouched, nodes, kit) => {
        const gather = $.const(gathered);
        const composed = $.const(subtotals);
        return { before: composed(key, gather(held, nodes), variant('all', null), kit), after: composed(key, gather(next, nodes), variant('all', null), kit) };
      });
  }
  return East.function([keyType, rowType, rowType, rowType, rowType, nodesType, KitType], changed,
    ($, key, held, next, heldTouched, nextTouched, nodes, kit) => {
      const startOf = $.const(kit.startOf);
      const nextOf = $.const(kit.nextOf);
      const levelsWithin = $.const(kit.levelsWithin);
      const gather = $.const(gathered);
      const composed = $.const(subtotals);
      const tiers = $.let([...levels], ArrayType(RecordLevelType));
      // The tiles at each level the values the patch names are at, before it and after.
      const touched = $.let(gather(heldTouched, nodes).concat(gather(nextTouched, nodes)).flattenToSet((_$, node) => node.own.keys()));
      const at = $.let(levelsWithin(touched, tiers, startOf, nextOf));
      return { before: composed(key, gather(held, nodes), at, kit), after: composed(key, gather(next, nodes), at, kit) };
    });
}

/** The months a row's values are in, each with how many are in it ({@link SpanPart}), a value covering no milliseconds. */
function valuesSpan(decl: NestedDeclaration, types: NestedTypes, collection: NestedValues, nodesType: WalkFnType): NodesSpan {
  const group = decl.groups[collection.group]!;
  const holding = fieldOf(group.type, collection.field, DictType(DateTimeType, collection.valueType));
  const month = levelOf(SPAN_TILE);
  return East.function([types.keyType, types.rowType, nodesType, KitType], SpanTotalsType, ($, _key, row, nodes, kit) => {
    const startOf = $.const(kit.startOf);
    const path = $.const(kit.path);
    const held = $.const(holding);
    const at = $.let(path(East.value([...collection.place], KeysType)));
    return nodes(row).flatMap((_$, node) => held(node.node).toArray((_$, _value, instant) => startOf(month, instant))).groupReduce(
      (_$, tile) => ({ collection: at, tile }),
      ($) => $.const(NO_SPAN_TOTALS, RecordSummaryTotalsType),
      (_$, totals) => ({ count: totals.count.add(1n), ms: totals.ms }),
    );
  });
}

/**
 * A collection's entries of a row, given its group's nodes ({@link
 * NodesEntries}): its items or values filed — rolled up, under every ancestor
 * too — and, where a summary is declared, its totals; where its values roll
 * up, every parent's subtotals.
 *
 * @param decl - The checked declaration
 * @param types - The index's types
 * @param collection - The collection
 * @param nodesOf - Each group's nodes from a row
 * @returns Its entries
 */
function collectionEntries(decl: NestedDeclaration, types: NestedTypes, collection: NestedCollection, nodesOf: readonly NodesOf[]): NodesEntries {
  const nodesType = WalkType(types.rowType, decl.groups[collection.group]!);
  const { summary } = types;
  if (collection.kind === 'items') {
    const filed = itemsFiled(decl, types, collection, nodesType);
    if (summary === undefined) return filed;
    return nodesUnion(types, nodesType, [
      filed, itemsTotalledAll(types, nodesType, itemShares(decl, types, collection, nodesType, summary), itemsTotalled(types, collection, summary)),
    ]);
  }
  const totals = summary === undefined ? [] : [valuesTotalledAll(types, nodesType, valueTotalsOf(decl, types, collection, nodesType, summary))];
  const subtotals = collection.numeric === undefined || collection.rollups.length === 0 ? [] : [valuesSubtotalledAll(
    types, nodesType, valuesGathered(decl, types, collection, nodesOf, collection.numeric), valueSubtotals(types, collection))];
  return nodesUnion(types, nodesType, [valueEntries(decl, types, collection, nodesType), ...totals, ...subtotals]);
}

/**
 * A collection's part of a write's entries, by its patch, given its group's
 * nodes ({@link NodesChanged}): the entries of the items or values it touched,
 * before and after, and, where it touched any, the totals of the summary tiles
 * they touch and every parent's subtotals of the tiles at each level they
 * touch — every subtotal, in a recursive tree — of the row before and after.
 *
 * @param decl - The checked declaration
 * @param types - The index's types
 * @param collection - The collection
 * @param nodesOf - Each group's nodes from a row
 * @returns Its part
 */
function collectionPatched(decl: NestedDeclaration, types: NestedTypes, collection: NestedCollection, nodesOf: readonly NodesOf[]): NodesChanged {
  const nodesType = WalkType(types.rowType, decl.groups[collection.group]!);
  const { summary } = types;
  if (collection.kind === 'items') {
    const filed = itemsFiled(decl, types, collection, nodesType);
    if (summary === undefined) return patchedWith(types, nodesType, filed, undefined);
    const moved = itemsMoved(types, nodesType, summary, itemShares(decl, types, collection, nodesType, summary), itemsTotalled(types, collection, summary));
    return patchedWith(types, nodesType, filed, moved);
  }
  const moved = [
    ...(summary === undefined ? [] : [valuesMoved(decl, types, collection, nodesType, summary, valueTotalsOf(decl, types, collection, nodesType, summary))]),
    ...(collection.numeric === undefined || collection.rollups.length === 0 ? [] : [valuesSubtotalsMoved(
      decl, types, collection, nodesType, valuesGathered(decl, types, collection, nodesOf, collection.numeric), valueSubtotals(types, collection))]),
  ];
  return patchedWith(types, nodesType, valueEntries(decl, types, collection, nodesType), moved.length === 0 ? undefined : changedUnion(types, nodesType, moved));
}

/** A collection's months of a row, for the index's span, given its group's nodes ({@link NodesSpan}). */
function collectionSpan(decl: NestedDeclaration, types: NestedTypes, collection: NestedCollection): NodesSpan {
  const nodesType = WalkType(types.rowType, decl.groups[collection.group]!);
  if (collection.kind === 'items') return itemsSpan(types, collection, nodesType, itemShares(decl, types, collection, nodesType, levelOf(SPAN_TILE)));
  return valuesSpan(decl, types, collection, nodesType);
}

/** The groups holding a collection: a program's parts are theirs, each binding its group's walk once for its collections. */
function groupsHolding(decl: NestedDeclaration): readonly NestedGroup[] {
  return decl.groups.filter((group) => group.collections.length > 0);
}

/**
 * What a collection's part of a program calls of the kit ({@link KitType})
 * beside the tiles' steps and a path's: filing, and where a summary is
 * declared, its totals' — sharing items out, or counting or summing values —
 * and its parents' subtotals where its values roll up; a write's, too, the
 * tiles it touches; a span's, sharing items out.
 *
 * @param decl - The checked declaration
 * @param types - The index's types
 * @param collection - The collection
 * @param program - The program
 * @returns What it calls
 */
function kitCalls(decl: NestedDeclaration, types: NestedTypes, collection: NestedCollection, program: 'entries' | 'byPatch' | 'span'): readonly KitName[] {
  if (program === 'span') return collection.kind === 'items' ? ['share'] : [];
  const calls: KitName[] = ['file'];
  if (types.summary !== undefined) {
    if (collection.kind === 'items') calls.push('share', 'totalled');
    else calls.push('kept', collection.numeric === undefined ? 'counted' : 'summed');
    if (program === 'byPatch') calls.push('within');
  }
  if (collection.kind === 'values' && collection.numeric !== undefined && collection.rollups.length > 0) {
    calls.push('subtotals');
    if (program === 'byPatch' && decl.groups[collection.group]!.through === undefined) calls.push('levelsWithin');
  }
  return calls;
}

// ── The programs ──────────────────────────────────────────────────────────────

/** `(K, V, Kit) → Dict<IK, P>`: parts' entries, one after another, each a function calling the parts before it. */
function entriesUnion(types: NestedTypes, parts: readonly EntriesPart[]): EntriesPart {
  const [first, ...rest] = parts;
  if (first === undefined) return East.function([types.keyType, types.rowType, KitType], types.entries, () => new Map());
  return rest.reduce<EntriesPart>((before, part) => East.function([types.keyType, types.rowType, KitType], types.entries, ($, key, row, kit) => {
    const all = $.let(before(key, row, kit));
    $(all.unionInPlace(part(key, row, kit)));
    return all;
  }), first);
}

/** `(K, V, V, V, V, Kit) → { before, after }`: parts of a write's entries, one after another, each a function calling the parts before it. */
function patchedUnion(types: NestedTypes, parts: readonly PatchedPart[]): PatchedPart {
  const { keyType, rowType, changed } = types;
  const [first, ...rest] = parts;
  if (first === undefined) {
    return East.function([keyType, rowType, rowType, rowType, rowType, KitType], changed, () => ({ before: new Map(), after: new Map() }));
  }
  return rest.reduce<PatchedPart>((before, part) => East.function(
    [keyType, rowType, rowType, rowType, rowType, KitType], changed, ($, key, held, next, heldTouched, nextTouched, kit) => {
      const all = $.let(before(key, held, next, heldTouched, nextTouched, kit));
      const more = $.let(part(key, held, next, heldTouched, nextTouched, kit));
      $(all.before.unionInPlace(more.before));
      $(all.after.unionInPlace(more.after));
      return all;
    },
  ), first);
}

/** `(K, V, Kit) → Dict<{ collection, tile }, Totals>`: parts of the span, one after another, each a function calling the parts before it. */
function spanUnion(types: NestedTypes, parts: readonly SpanPart[]): SpanPart {
  const [first, ...rest] = parts;
  if (first === undefined) return East.function([types.keyType, types.rowType, KitType], SpanTotalsType, () => new Map());
  return rest.reduce<SpanPart>((before, part) => East.function([types.keyType, types.rowType, KitType], SpanTotalsType, ($, key, row, kit) => {
    const all = $.let(before(key, row, kit));
    $(all.unionInPlace(part(key, row, kit)));
    return all;
  }), first);
}

/** The types a nested series index's programs are built over ({@link NestedTypes}). */
function nestedTypes(decl: NestedDeclaration, keyType: EastType, rowType: EastType, tile: RecordTile, summary: RecordTile | undefined): NestedTypes {
  const entryKey = NestedEntryKeyType(keyType);
  const entryValue = NestedEntryType(decl.places);
  const entries = DictType(entryKey, entryValue);
  return {
    keyType, rowType, entryKey, entryValue, entries,
    changed: StructType({ before: entries, after: entries }),
    tile: levelOf(tile),
    summary: summary === undefined ? undefined : levelOf(summary),
    levels: RECORD_TILES.slice(RECORD_TILES.indexOf(tile)).map(levelOf),
  };
}

/** A program's kit, holding each function its collections' parts call ({@link kitCalls}). */
function kitOf(decl: NestedDeclaration, types: NestedTypes, program: 'entries' | 'byPatch' | 'span'): CallableFunctionExpr<[], KitType> {
  return programKit(new Set(decl.collections.flatMap((collection) => kitCalls(decl, types, collection, program))));
}

/** A row's entries: `(K, V) → Dict<IK, P>`, each group's part's, over a kit binding once each function they call. */
function entriesProgram(decl: NestedDeclaration, types: NestedTypes, nodesOf: readonly NodesOf[]): RowEntries {
  const kit = kitOf(decl, types, 'entries');
  const parts = entriesUnion(types, groupsHolding(decl).map((group) => groupEntries(types, nodesOf[group.index]!, nodesUnion(
    types, WalkType(types.rowType, group), group.collections.map((collection) => collectionEntries(decl, types, collection, nodesOf))))));
  return East.function([types.keyType, types.rowType], types.entries, ($, key, row) => {
    const tools = $.const(kit());
    return parts(key, row, tools);
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
 * touched moves, before and after ({@link collectionPatched}), over a kit
 * binding once each function they call; `whole` where a replace on the way
 * leaves the row to be compared whole.
 *
 * @param decl - The checked declaration
 * @param types - The index's types
 * @param nodesOf - Each group's nodes from a row
 * @returns The function
 */
function nestedByPatch(decl: NestedDeclaration, types: NestedTypes, nodesOf: readonly NodesOf[]) {
  const { keyType, rowType, entries } = types;
  const walk = rowWalk(decl);
  const kit = kitOf(decl, types, 'byPatch');
  const parts = patchedUnion(types, groupsHolding(decl).map((group) => groupPatched(types, nodesOf[group.index]!, changedUnion(
    types, WalkType(rowType, group), group.collections.map((collection) => collectionPatched(decl, types, collection, nodesOf))))));
  const patchType = patchTypeOf(rowType);
  const patchedType = NestedPatchedType(entries);
  return East.function([keyType, rowType, rowType, patchType], patchedType, ($, key, held, next, patch) => {
    const touched = $.const(walk);
    $.match(touched(held, next, patch), {
      replaced: ($) => {
        $.return(variant('whole', null));
      },
      unchanged: ($) => {
        $.return(variant('changed', { before: new Map(), after: new Map() }));
      },
      touched: ($, rows) => {
        const tools = $.const(kit());
        $.return(variant('changed', parts(key, held, next, rows.held, rows.next, tools)));
      },
    });
    return variant('whole', null);
  });
}

/**
 * A row's entries: `(K, V) → Dict<IK, P>`, each collection's part's — its
 * items or values filed, its totals where a summary is declared, its subtree
 * filing where it rolls items up, and its parents' subtotals where it rolls
 * values up — one after another, over a kit binding once each function they
 * call ({@link programKit}). And a write's, by its patch ({@link
 * nestedByPatch}).
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
  const types = nestedTypes(decl, keyType, rowType, tile, summary);
  const nodesOf = groupNodes(decl, rowType);
  return {
    entries: entriesProgram(decl, types, nodesOf),
    byPatch: nestedByPatch(decl, types, nodesOf),
    entryKey: types.entryKey,
    entryValue: types.entryValue,
  };
}

// ── Its span (#1438) ───────────────────────────────────────────────────────────

/**
 * A nested series index's span of a row (#1438): `(K, V) → Dict<{ collection,
 * tile }, Totals>`, each collection's months the row's items or values touch,
 * each with how many of them touch it and the milliseconds of it its items
 * cover. Summed across the record's rows as a summary index's totals are, and
 * a month let go once nothing touches it, a collection's first and last month
 * held are its span: the time a Plan's series reading it cover, whatever rows
 * they show. Its months' counts are how much there is in each: a Plan's
 * horizon strip draws them as its bars.
 *
 * @param decl - The checked declaration
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param tile - The index's tile
 * @returns A row's months, by collection
 */
export function nestedSpan(decl: NestedDeclaration, keyType: EastType, rowType: EastType, tile: RecordTile): FunctionExpr<[EastType, EastType], SpanTotalsType> {
  const types = nestedTypes(decl, keyType, rowType, tile, undefined);
  const nodesOf = groupNodes(decl, rowType);
  const kit = kitOf(decl, types, 'span');
  const parts = spanUnion(types, groupsHolding(decl).map((group) => groupSpan(types, nodesOf[group.index]!, spanNodesUnion(
    types, WalkType(rowType, group), group.collections.map((collection) => collectionSpan(decl, types, collection))))));
  return East.function([keyType, rowType], SpanTotalsType, ($, key, row) => {
    const tools = $.const(kit());
    return parts(key, row, tools);
  });
}

/**
 * A nested series index's span (#1438), an index of the record's beside it,
 * named by `nestedSpanName`: its rows' months by collection
 * ({@link nestedSpan}), summed as a summary index's totals are.
 *
 * @param name - The nested series index
 * @param rec - Its record
 * @param decl - Its checked declaration
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param tile - Its tile
 * @param runner - Its runner selection
 * @returns The span's definition
 */
function nestedSpanDefinition(
  name: string, rec: RecordDef, decl: NestedDeclaration, keyType: EastType, rowType: EastType, tile: RecordTile, runner: RecordIndexDef['runner'],
): RecordIndexDef {
  const spanName = nestedSpanName(name);
  const keyFn = nestedSpan(decl, keyType, rowType, tile);
  checkPure(`index.nested '${name}' span`, keyFn, INDEX_PURITY);
  return {
    kind: 'recordIndex',
    name: spanName,
    record: rec,
    on: Object.freeze([]),
    span: Object.freeze({ of: name, tile: SPAN_TILE }),
    keyFn,
    mergeFn: summaryMerge(spanName, NestedSpanKeyType),
    // A row touches several months, and a month stands for every row touching it.
    multi: true,
    keyType: NestedSpanKeyType,
    valueType: RecordSummaryTotalsType,
    runner,
  };
}

/** Where a node's items are filed: its collection's place and its path, as an entry's key holds them. */
const NodePlaceType = StructType({ collection: RecordNestedPathType, path: RecordNestedPathType });

/**
 * An item out of its entry's value: `(P) → I`, from the outside in — the
 * `item` case, then each child rows' field from the row down, then the
 * collection's own (`.item .members .load 0.82` → `0.82`). The inverse of
 * {@link placedItem}.
 *
 * @param decl - The declaration
 * @param collection - The collection
 * @param itemType - Its items' type
 * @param entryValue - The entry value, `P`
 * @returns The item
 */
function itemOf(decl: NestedDeclaration, collection: NestedCollection, itemType: EastType, entryValue: EastType): FunctionExpr<[EastType], EastType> {
  const names: string[] = [];
  for (let group = decl.groups[collection.group]!, name = collection.field; ;) {
    names.unshift(name);
    if (group.parent === undefined) break;
    name = group.parent.field;
    group = decl.groups[group.parent.group]!;
  }
  // The names are the declaration's, each a case of the variant it unwraps, so the variant's type is the one before.
  return East.function([entryValue], itemType, (_$, value) => ['item', ...names].reduce<Expr>(
    (within, name) => (within as unknown as VariantExpr<Record<string, EastType>>).unwrap(name), value as unknown as Expr) as never);
}

/**
 * A collection of a node, filled: `(keys, byPlace) → Dict<…>`, the items its
 * entries name at the node's path, under each one's id or instant — an item
 * filed in several tiles once.
 *
 * @param decl - The declaration
 * @param collection - The collection
 * @param entry - An entry's type, `{ ik, value }`
 * @param entryValue - The entry value, `P`
 * @returns The filling
 */
function collectionFill(decl: NestedDeclaration, collection: NestedCollection, entry: EastType, entryValue: EastType): FunctionExpr<[typeof KeysType, EastType], EastType> {
  const byPlace = DictType(NodePlaceType, ArrayType(entry));
  const itemType: EastType = collection.kind === 'items' ? collection.itemType : collection.valueType;
  const filled = filledType(collection);
  const item = itemOf(decl, collection, itemType, entryValue);
  const keyOf = collection.kind === 'items'
    ? East.function([entry], StringType, (_$, filed) => East.field(East.field(filed, 'ik'), 'item', RecordNestedItemType).unwrap('id'))
    : East.function([entry], DateTimeType, (_$, filed) => East.field(East.field(filed, 'ik'), 'item', RecordNestedItemType).unwrap('at'));
  return East.function([KeysType, byPlace], filled, ($, keys, entries) => {
    const path = $.const(pathOf);
    const itemFrom = $.const(item);
    const key = $.const(keyOf);
    const here = $.let({ collection: path(East.value([...collection.place], KeysType)), path: path(keys) }, NodePlaceType);
    return entries.get(here, () => East.value([], ArrayType(entry))).toDict(
      (_$, filed) => key(filed),
      (_$, filed) => itemFrom(East.field(filed, 'value', entryValue)),
      (_$, kept) => kept,
    );
  });
}

/** A collection's type: its items by their ids, or its values by their instants. */
function filledType(collection: NestedCollection): EastType {
  return collection.kind === 'items' ? DictType(StringType, collection.itemType) : DictType(DateTimeType, collection.valueType);
}

/**
 * An entry as a fill puts its item back: `(entry) → Option<entry>` — one filed
 * at its own node as it is; one filed under a parent (`subtree`) at the node
 * holding it, its path the parent's then the keys down to it, its item its id;
 * a total or a subtotal none.
 *
 * @param entry - An entry's type, `{ ik, value }`
 * @returns The placing
 */
function fillingEntry(entry: StructType<{ ik: EastType; value: EastType }>) {
  return East.function([entry], OptionType(entry), ($, filed) => {
    const keys = $.const(keysOf);
    const ik = $.let(filed.ik);
    return East.field(ik, 'run', RecordNestedRunType).match({
      items: () => some(filed),
      subtree: ($2) => {
        const under = $2.let(East.field(ik, 'item', RecordNestedItemType).unwrap('under'));
        const path = $2.let(keys(East.field(ik, 'path', RecordNestedPathType)).reverse().reduce(
          (_$, rest, key) => variant('step', { key, rest }), under.path));
        const item = $2.let(variant('id', under.id), RecordNestedItemType);
        return some({ ik: East.withField(East.withField(ik, 'path', path), 'item', item), value: filed.value });
      },
    }, () => none);
  });
}

/**
 * A lean row filled with items read of it: `(K, V, Array<{ ik, value }>) →
 * V`, each item the entries file — of a node, by its path, and a collection,
 * by its place — put back in its collection under its id or its instant, an
 * item filed in several tiles once, and every other field as the lean row
 * holds it. The inverse of the filing: a row's lean form filled with all its
 * entries is the row, and filled with the entries of some cells, the row
 * holding the items read there. An item filed under a parent is put back in
 * the node holding it, as its own entry puts it — so a parent's items read
 * whole are its descendants' — and totals and subtotals fill nothing.
 *
 * @param decl - The checked declaration
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param entryKey - The entry key, `IK`
 * @param entryValue - The entry value, `P`
 * @returns The filling
 */
export function nestedFill(decl: NestedDeclaration, keyType: EastType, rowType: EastType, entryKey: EastType, entryValue: EastType) {
  const entry = StructType({ ik: entryKey, value: entryValue });
  const byPlace = DictType(NodePlaceType, ArrayType(entry));
  // Each group's node filled, `(N, keys, byPlace) → N`, and its rows filled under a node at keys, `(Dict<String, N>, keys, byPlace) → Dict`:
  // its child groups' first.
  const fillOf: FunctionExpr<[EastType, typeof KeysType, typeof byPlace], EastType>[] = [];
  const rowsFillOf: FunctionExpr<[EastType, typeof KeysType, typeof byPlace], EastType>[] = [];
  for (const group of [...decl.groups].reverse()) {
    const fields: { readonly field: string; readonly fill: FunctionExpr<[EastType, typeof KeysType, typeof byPlace], EastType> }[] = [];
    for (const collection of group.collections) {
      const filled = collectionFill(decl, collection, entry, entryValue);
      const type = filledType(collection);
      fields.push({ field: collection.field, fill: East.function([group.type, KeysType, byPlace], type, ($, _node, keys, entries) => {
        const fill = $.const(filled);
        return fill(keys, entries);
      }) });
    }
    for (const child of group.rows) {
      const rowsType = DictType(StringType, decl.groups[child.group]!.type);
      const rowsOf = fieldOf(group.type, child.field, rowsType);
      const rowsFill = rowsFillOf[child.group]!;
      fields.push({ field: child.field, fill: East.function([group.type, KeysType, byPlace], rowsType, ($, node, keys, entries) => {
        const rows = $.const(rowsOf);
        const fill = $.const(rowsFill);
        return fill(rows(node), keys, entries);
      }) });
    }
    const own = fields.reduce<FunctionExpr<[EastType, typeof KeysType, typeof byPlace], EastType>>(
      (before, { field, fill }) => East.function([group.type, KeysType, byPlace], group.type, ($, node, keys, entries) => {
        const earlier = $.const(before);
        const value = $.const(fill);
        const held = $.let(earlier(node, keys, entries));
        return East.withField(held, field, value(node, keys, entries));
      }),
      East.function([group.type, KeysType, byPlace], group.type, (_$, node) => node),
    );
    fillOf[group.index] = own;
    const rowsType = DictType(StringType, group.type);
    if (group.through === undefined) {
      rowsFillOf[group.index] = East.function([rowsType, KeysType, byPlace], rowsType, ($, rows, keys, entries) => {
        const fill = $.const(own);
        return rows.map((_$, node, key) => fill(node, keys.concat([key]), entries));
      });
      continue;
    }
    // Beside recursive(): every row beneath, flattened, each filled at its keys, then rebuilt bottom-up, holding its own rebuilt rows.
    const keyed = StructType({ key: StringType, node: group.type });
    const deeper = fieldOf(group.type, group.through, rowsType);
    const holding = withField(group.type, group.through, rowsType);
    rowsFillOf[group.index] = East.function([rowsType, KeysType, byPlace], rowsType, ($, rows, keys, entries) => {
      const beneath = $.const(deeper);
      const fill = $.const(own);
      const hold = $.const(holding);
      const above = $.const(keysAbove);
      const roots = $.let(rows.flattenTree((_$, node) => beneath(node)).toTree(
        keyed,
        (_$, at) => at.path,
        (_$, at) => above(at.path),
        (_$, at, _i, children) => ({
          key: at.path.get(at.path.size().subtract(1n)),
          node: hold(fill(at.node, keys.concat(at.path), entries), children.toDict((_$, child) => child.key, (_$, child) => child.node)),
        }),
      ));
      return roots.toDict((_$, root) => root.key, (_$, root) => root.node);
    });
  }
  const rowFill = fillOf[0]!;
  const filling = fillingEntry(entry);
  return East.function([keyType, rowType, ArrayType(entry)], rowType, ($, _key, row, entries) => {
    const fill = $.const(rowFill);
    const place = $.const(filling);
    const own = $.let(entries
      .filterMap((_$, filed) => place(filed))
      .groupToArrays(($2, filed) => {
        const ik = $2.let(East.field(filed, 'ik'));
        const place = $2.let({ collection: East.field(ik, 'collection', RecordNestedPathType), path: East.field(ik, 'path', RecordNestedPathType) }, NodePlaceType);
        return place;
      }));
    return fill(row, East.value([], KeysType), own);
  });
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
  const fill = nestedFill(decl, keyType, valueType, entryKey, entryValue);
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
      collections: written.collections, tile, summary, declaration: decl.declaration, lean: nestedLean(decl, keyType, valueType), byPatch, fill,
      span: nestedSpanDefinition(name, rec, decl, keyType, valueType, tile, runner),
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
