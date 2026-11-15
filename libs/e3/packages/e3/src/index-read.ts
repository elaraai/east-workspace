/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A reader for each kind of index, inside a task or a function
 * (east-workspace#1618).
 *
 * With `e3.index` a body holds an index's entries, `Dict<{ ik, k }, P>`, and
 * with a range read it reads a run of them. For a plain index that is the
 * whole read: the rows under a key are one run. The indexes a planning board
 * reads are not one run — a series index files each event once, at the level
 * its length fits, so a key's events over a span are a run a level; an
 * interval index answers a window with a run of starts and one a tree node
 * above the window's first instant — and each files more under those runs than
 * a window holds. A reader knows its kind's runs, and tests what they hold.
 *
 * A reader answers a **read** ({@link IndexRead}), which gives the rows its
 * words say and no others, each once, in the index's own order: `each` runs a
 * body for each, a segment in memory at a time, and `collect` gives them as a
 * Dict by the row's key. A read of several runs reads them in the order the
 * index holds them, so its rows come as a walk of the index would meet them.
 *
 * The runs are written as East, over the functions that file each index
 * (`record-tiles.ts`, `record-interval.ts`), so they run on every runner, and
 * are the runs a page's reader of the kind reads (east-ui's
 * `platform/slice/record-interval.ts`, `record-series.ts`).
 *
 * @packageDocumentation
 */

import {
  ArrayType, DateTimeType, DictType, East, Expr, FloatType, IntegerType, OptionType, SetType, StringType, compareFor, equalFor, isTypeEqual,
  none, printType, some, variant,
  type BlockBuilder, type BooleanType, type EastType, type ExprType, type KeyBound, type StructType, type SubtypeExprOrValue, type ValueTypeOf,
} from '@elaraai/east';
import { RecordLevelType, RecordNestedItemType, RecordNestedTotalsType, RecordRollupType, RecordSummaryTotalsType } from '@elaraai/e3-types';
import { AREA_FINEST_LEVEL, AREA_FNS, AREA_UNPLACED } from './record-area.js';
import { INTERVAL_LEAF } from './record-interval.js';
import { optionField, type OptionField, type RowType } from './record-keys.js';
import {
  checkNested, rollupOf, rollupWords,
  type ChildOf, type NestedCollection, type NestedDeclaration, type SeriesItems, type SeriesRecursive, type SeriesRollupInput, type SeriesRows,
  type SeriesValues,
} from './record-nested.js';
import { NESTED_FNS, itemOf } from './record-nested-programs.js';
import { RECORD_TILES, TILE_FNS, type RecordTile } from './record-tiles.js';
import type { IndexInputDef, RecordIndexDef } from './types.js';

/**
 * A read of an index: the rows a reader's words hold, each once, in the
 * index's own order.
 *
 * @typeParam P - What the read gives for a row: what the index carries
 * @typeParam K - What it gives beside it: the row's key, or a summary's tile
 */
export interface IndexRead<P extends EastType = EastType, K extends EastType = EastType> {
  /**
   * Runs a body once for each row the read holds, in the index's own order,
   * a segment of the index in memory at a time.
   *
   * It takes no label and runs to its end: a body skips a row with `$.if`,
   * and leaves the function with `$.return`.
   *
   * @typeParam Ret - The return type of the function the read is in
   * @param $ - The block the read is in
   * @param body - Given what the index carries for the row, and the row's key
   */
  each<Ret>($: BlockBuilder<Ret>, body: ($: BlockBuilder<Ret>, carried: ExprType<P>, key: ExprType<K>) => void): void;
  /**
   * The rows the read holds, as a new Dict by the row's key of what the index
   * carries for it.
   *
   * @typeParam Ret - The return type of the function the read is in
   * @param $ - The block the read is in
   * @returns The Dict, held in memory whole
   */
  collect<Ret>($: BlockBuilder<Ret>): ExprType<DictType<K, P>>;
}

/** A read's rows, given one at a time to `give`, in a block. */
type Walk = <Ret>($: BlockBuilder<Ret>, give: ($: BlockBuilder<Ret>, carried: Expr, key: Expr) => void) => void;

/** A read from the walk that gives its rows. */
function readOf<P extends EastType, K extends EastType>(keyType: K, carriedType: P, walk: Walk): IndexRead<P, K> {
  return {
    each: ($, body) => { walk($, body as never); },
    collect: ($) => {
      const rows = $.let(new Map(), DictType(keyType as EastType, carriedType as EastType));
      walk($, ($, carried, key) => { $(rows.insert(key as never, carried as never)); });
      return rows as never;
    },
  };
}

/** An index's entries as its readers hold them: the Dict, and the types of an entry's parts. */
interface Entries {
  /** The index, as a refusal names it: `e3.index 'jobs.jobs_by_press'`. */
  readonly name: string;
  readonly def: RecordIndexDef;
  readonly dict: ExprType<DictType<StructType<{ ik: EastType; k: EastType }>, EastType>>;
  /** The index's key type. */
  readonly ik: EastType;
  /** The row's key type; Null for an index whose entry stands for every row of its key. */
  readonly k: EastType;
  /** What the index carries. */
  readonly carried: EastType;
}

/** An entry's row key. */
const rowKey = (entry: Expr): Expr => East.field(entry, 'k');
/** A part of an entry's index key. */
const indexKeyPart = (entry: Expr, part: string): Expr => East.field(East.field(entry, 'ik'), part);

/** The instant a millisecond before one. */
function msBefore(at: ExprType<DateTimeType>): ExprType<DateTimeType> {
  return East.DateTime.fromEpochMilliseconds(at.toEpochMilliseconds().subtract(1n));
}

/** An object literal: what a reader's `on` is written as. */
function isObjectLiteral(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * The leading values a generated index's reader is given, as the key's `on`:
 * every leading field, exactly.
 *
 * @param entries - The index's entries
 * @param reader - The reader, as the refusal names it
 * @param on - What was written
 * @returns The key's `on`
 * @throws {Error} When a leading field is left out, one is given that leads nothing, or a value is not of its field's
 *   type, naming the fields the index is led by
 */
function leadingOn(entries: Entries, reader: string, on: unknown): Expr {
  const onType = (entries.ik as StructType<{ on: StructType<Record<string, EastType>> }>).fields.on;
  const names = Object.keys(onType.fields);
  const led = names.length === 0
    ? 'the index is led by no field, and takes no `on`'
    : `the index is led by ${names.map((name) => `'${name}'`).join(', ')}, and takes each exactly, as on: { ${names.map((name) => `${name}: …`).join(', ')} }`;
  const given = on === undefined ? {} : on;
  if (!isObjectLiteral(given)) throw new Error(`${entries.name} ${reader}: \`on\` is written as an object of the leading fields — ${led}`);
  const stranger = Object.keys(given).find((name) => !names.includes(name));
  if (stranger !== undefined) throw new Error(`${entries.name} ${reader}: '${stranger}' leads nothing — ${led}`);
  const missing = names.find((name) => given[name] === undefined);
  if (missing !== undefined) throw new Error(`${entries.name} ${reader}: '${missing}' is left out — ${led}`);
  try {
    return East.struct(onType, given);
  } catch (err) {
    const fields = names.map((name) => `${name}: ${printType(onType.fields[name]!)}`).join(', ');
    throw new Error(`${entries.name} ${reader}: a leading field is given a value of another type — \`on\` is { ${fields} }: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A reader's instant, as an expression. */
function instant(entries: Entries, reader: string, name: string, at: unknown): ExprType<DateTimeType> {
  if (at === undefined) throw new Error(`${entries.name} ${reader}: \`${name}\` is left out — a window is [from, to), each a DateTime`);
  return East.value(at as never, DateTimeType);
}

// ── Plain indexes: `of`, `between` ───────────────────────────────────────────

/**
 * A plain index's readers — `index.on`, `index.key`, `index.keys` — and those
 * of the indexes e3 keeps beside one, a nested series index's span and an
 * entries index's lean rows.
 *
 * @typeParam IK - The index's key type
 * @typeParam P - What the index carries
 * @typeParam K - The row's key type; for a span, whose entry stands for every row of its key and names none, the
 *   index key, which a read gives in a row's key's place
 */
export interface PlainReaders<IK extends EastType = EastType, P extends EastType = EastType, K extends EastType = EastType> {
  /**
   * The rows filed under an index key, or under a leading part of one:
   * `{ owner }` of an index on `['owner', 'due']`. One run.
   *
   * @param key - The index key, or its first fields
   * @returns The read
   * @throws {Error} Where the function is built, when the key is no leading part of the index's
   */
  of(key: KeyBound<IK>): IndexRead<P, K>;
  /**
   * The rows from one index key up to another: `from` and every key after it
   * that is before `to`. One run. An end left out is that end of the index.
   *
   * @param bounds - The two index keys, each whole or its first fields
   * @returns The read
   * @throws {Error} Where the function is built, when a bound is no leading part of the index's key
   */
  between(bounds: { from?: KeyBound<IK>; to?: KeyBound<IK> }): IndexRead<P, K>;
}

/**
 * Gives a run's rows. A fanned-out index files a row under each of several
 * keys, so a run of more than one key may hold it more than once: the keys of
 * the rows given are then kept, and a row is given the first time it is met.
 */
function giveRun<Ret>(
  $: BlockBuilder<Ret>, entries: Entries, run: Expr, once: boolean, give: ($: BlockBuilder<Ret>, carried: Expr, key: Expr) => void,
): void {
  const dict = run as Entries['dict'];
  if (summedEntries(entries)) {
    // An entry that stands for every row of its key names none: the read gives its index key in a row's key's place.
    $.for(dict, ($, carried, entry) => { give($, carried, East.field(entry, 'ik')); });
    return;
  }
  if (!once) {
    $.for(dict, ($, carried, entry) => { give($, carried, rowKey(entry)); });
    return;
  }
  const given = $.let(new Set(), SetType(entries.k));
  $.for(dict, ($, carried, entry) => {
    $.if(given.tryInsert(rowKey(entry) as never), ($) => { give($, carried, rowKey(entry)); });
  });
}

/** Whether an index's entry stands for every row of its key, and names none: a summary's, a nested series index's span's. */
const summedEntries = (entries: Entries): boolean => entries.def.summary !== undefined || entries.def.span !== undefined;

function plainReaders(entries: Entries): PlainReaders {
  // One whole key's rows are filed under it once each; a key that is a struct may be given by its first fields.
  const fanned = entries.def.multi && !summedEntries(entries);
  // What a read gives beside what the index carries: the row's key, or the index key of an entry that names no row.
  const given = summedEntries(entries) ? entries.ik : entries.k;
  return {
    of: (key) => {
      if (key === undefined) throw new Error(`${entries.name} of: the index key is left out — the key the rows are filed under, or its first fields`);
      // The run is made here, where a key that is no leading part of the index's is refused.
      const run = entries.dict.prefix({ ik: key } as never);
      return readOf(given, entries.carried, ($, give) => { giveRun($, entries, run, fanned && entries.ik.type === 'Struct', give); });
    },
    between: (bounds) => {
      const run = entries.dict.range({
        ...(bounds.from !== undefined && { from: { ik: bounds.from } }),
        ...(bounds.to !== undefined && { to: { ik: bounds.to } }),
      } as never);
      return readOf(given, entries.carried, ($, give) => { giveRun($, entries, run, fanned, give); });
    },
  };
}

// ── Interval indexes: `overlapping`, `unset` ─────────────────────────────────

/** The leading fields a generated index's reader takes: `on`, each field exactly, where the index is led by any. */
export type LeadingOn<IK> =
  IK extends StructType<{ on: StructType<infer L> }>
    ? keyof L extends never ? { on?: Record<never, never> } : { on: { [F in keyof L]: SubtypeExprOrValue<L[F]> } }
    : { on?: Readonly<Record<string, unknown>> };

/**
 * What a reader that takes the leading fields alone is given: `{ on }`, each
 * field exactly, which an index led by none may leave out.
 */
export type LeadingArgs<IK> =
  IK extends StructType<{ on: StructType<infer L> }>
    ? keyof L extends never ? [where?: LeadingOn<IK>] : [where: LeadingOn<IK>]
    : [where?: LeadingOn<IK>];

/** A half-open window of time, `[from, to)`. */
export interface TimeWindow {
  /** The window's first instant. */
  from: SubtypeExprOrValue<DateTimeType>;
  /** The instant it ends before. */
  to: SubtypeExprOrValue<DateTimeType>;
}

/**
 * An interval index's readers (`index.interval`).
 *
 * @typeParam IK - The index's key type, `{ on, node, at }`
 * @typeParam P - What the index carries
 * @typeParam K - The row's key type
 */
export interface IntervalReaders<IK extends EastType = EastType, P extends EastType = EastType, K extends EastType = EastType> {
  /**
   * The rows that overlap `[from, to)`: an event that ends at `from` is
   * outside, an instant at `from` is inside and one at `to` outside, and an
   * event with no end, or one at or before its start, is an instant. A window
   * that ends at or before its start holds none. At most 55 runs, in the
   * index's order: the starts inside the window, then one a tree node above
   * its first instant, from the root's down to its leaf's.
   *
   * @param window - The leading fields, each exactly, and the window
   * @returns The read
   * @throws {Error} Where the function is built, when a leading field is left out or of another type, naming them
   */
  overlapping(window: LeadingOn<IK> & TimeWindow): IndexRead<P, K>;
  /**
   * The rows with no start: the backlog. One run.
   *
   * @param where - The leading fields, each exactly; left out for an index led by none
   * @returns The read
   * @throws {Error} Where the function is built, when the start is not an Option field — every row then has one — or
   *   a leading field is left out or of another type
   */
  unset(...where: LeadingArgs<IK>): IndexRead<P, K>;
}

function intervalReaders(entries: Entries): IntervalReaders {
  const atType = (entries.ik as StructType<{ at: EastType }>).fields.at;
  const optional = isTypeEqual(atType, OptionType(DateTimeType));
  /** An instant as an entry is ordered by it: at the start field's type. */
  const at = (ms: ExprType<IntegerType>): Expr => {
    const time = East.DateTime.fromEpochMilliseconds(ms);
    return optional ? East.value(some(time), OptionType(DateTimeType)) : time;
  };
  return {
    overlapping: (window) => {
      const given = window as { on?: unknown; from?: unknown; to?: unknown };
      const written = { on: leadingOn(entries, 'overlapping', given.on), from: instant(entries, 'overlapping', 'from', given.from), to: instant(entries, 'overlapping', 'to', given.to) };
      return readOf(entries.k, entries.carried, ($, give) => {
      const on = $.const(written.on);
      const from = $.const(written.from);
      const to = $.const(written.to);
      $.if(East.less(from, to), ($) => {
        const fromMs = $.const(from.toEpochMilliseconds());
        // The nodes the window reads: node 0, which files the starts, and each node above the window's first
        // instant. Those are found from its leaf up, and a Set holds them all in the index's order: node 0, then the
        // root's child down to the leaf.
        const nodes = $.let(new Set<bigint>([0n]), SetType(IntegerType));
        const child = $.let(fromMs.add(INTERVAL_LEAF));
        $.while(child.greater(1n), ($) => {
          $(nodes.insert(child));
          $.assign(child, child.divide(2n));
        });
        // One loop, so the body is in the program once: a node's run is chosen by what the node is.
        $.for(nodes, ($, node) => {
          // Node 0's run is the starts inside the window. Any other node's events all cross its centre, so to the
          // left of it they overlap the window when they start before it, and to the right — an odd node — when they
          // end after its first instant.
          const run = $.const(node.equal(0n).ifElse(
            () => entries.dict.range({ from: { ik: { on, node, at: at(fromMs) } }, to: { ik: { on, node, at: at(to.toEpochMilliseconds()) } } } as never),
            () => node.remainder(2n).equal(1n).ifElse(
              () => entries.dict.range({ from: { ik: { on, node, at: at(fromMs.add(1n)) } }, to: { ik: { on, node: node.add(1n) } } } as never),
              () => entries.dict.range({ from: { ik: { on, node } }, to: { ik: { on, node, at: at(fromMs) } } } as never),
            ),
          ));
          $.for(run as Entries['dict'], ($, carried, entry) => { give($, carried, rowKey(entry)); });
        });
      });
      });
    },
    unset: (...where) => {
      if (!optional) {
        throw new Error(
          `${entries.name} unset: the index's start, '${entries.def.interval!.from}', is a DateTime field, so every row has one — ` +
          `a row with no start is one whose start is an Option<DateTime> left none`,
        );
      }
      const written = leadingOn(entries, 'unset', (where[0] as { on?: unknown } | undefined)?.on);
      return readOf(entries.k, entries.carried, ($, give) => {
        const on = $.const(written);
        const backlog = East.value(none, OptionType(DateTimeType));
        $.for(entries.dict.prefix({ ik: { on, node: 0n, at: backlog } } as never), ($, carried, entry) => { give($, carried, rowKey(entry)); });
      });
    },
  };
}

// ── Series and summary indexes: `events`, `totals` ───────────────────────────

/** A window of one key's time: the key the events are on, and `[from, to)`. */
export type KeyWindow<IK> = TimeWindow & {
  /** The key the events are on: a Plan's resource. */
  key: IK extends StructType<{ key: infer KT extends EastType }> ? SubtypeExprOrValue<KT> : unknown;
};

/**
 * A series index's readers (`index.series`).
 *
 * @typeParam IK - The index's key type, `{ on, key, level, tile }`
 * @typeParam P - What the index carries: the row
 * @typeParam K - The row's key type
 */
export interface SeriesReaders<IK extends EastType = EastType, P extends EastType = EastType, K extends EastType = EastType> {
  /**
   * The events on `key` that overlap `[from, to)`, by the interval index's
   * edges: an event that ends at `from` is outside, an instant at `from` is
   * inside and one at `to` outside. A window that ends at or before its start
   * holds none. One run a level, in the index's order of its levels — East's
   * order of their names: day, month, quarter, week, year — so the events come
   * in the index's order, which across levels is not time order.
   *
   * @param window - The leading fields, each exactly, the key, and the window
   * @returns The read: each event's row once, and its key
   * @throws {Error} Where the function is built, when a leading field is left out or of another type, naming them
   */
  events(window: LeadingOn<IK> & KeyWindow<IK>): IndexRead<P, K>;
}

/**
 * A summary index's readers (`index.summary`).
 *
 * @typeParam IK - The index's key type, `{ on, key, tile }`
 */
export interface SummaryReaders<IK extends EastType = EastType> {
  /**
   * The totals of each tile of `key` that overlaps `[from, to)`: how many
   * rows touch the tile, and the milliseconds of it they cover. A window that
   * ends at or before its start holds none. One run.
   *
   * @param window - The leading fields, each exactly, the key, and the window
   * @returns The read: each tile's totals, and the tile's start in place of a row's key
   * @throws {Error} Where the function is built, when a leading field is left out or of another type, naming them
   */
  totals(window: LeadingOn<IK> & KeyWindow<IK>): IndexRead<typeof RecordSummaryTotalsType, DateTimeType>;
}

/** The key a series or a summary reader is given, at the index's key field's type. */
function eventKey(entries: Entries, reader: string, key: unknown): Expr {
  if (key === undefined) throw new Error(`${entries.name} ${reader}: \`key\` is left out — the key the events are on`);
  return East.value(key as never, (entries.ik as StructType<{ key: EastType }>).fields.key);
}

/** What a series or a summary reader is given, each part an expression, refused where it is written. */
function keyWindow(entries: Entries, reader: string, window: unknown): { on: Expr; key: Expr; from: ExprType<DateTimeType>; to: ExprType<DateTimeType> } {
  const given = (window ?? {}) as { on?: unknown; key?: unknown; from?: unknown; to?: unknown };
  return {
    on: leadingOn(entries, reader, given.on),
    key: eventKey(entries, reader, given.key),
    from: instant(entries, reader, 'from', given.from),
    to: instant(entries, reader, 'to', given.to),
  };
}

/** A row's field read as an instant: the field itself, or an Option's value, `absent` for none. */
function timeOf(row: Expr, field: OptionField<DateTimeType>, absent: ExprType<DateTimeType>): ExprType<DateTimeType> {
  return field.optional
    ? East.field(row, field.field, OptionType(DateTimeType)).unwrap('some', () => absent)
    : East.field(row, field.field, DateTimeType);
}

/**
 * The levels an index files at from its tile up to the year, in the index's
 * order of them: East's order of the level's cases, which is by their names.
 */
function levelsFrom(tile: RecordTile): ValueTypeOf<typeof RecordLevelType>[] {
  return RECORD_TILES.slice(RECORD_TILES.indexOf(tile))
    .map((level): ValueTypeOf<typeof RecordLevelType> => variant(level, null))
    .sort(compareFor(RecordLevelType));
}

/** The tile arithmetic a reader's block holds: a tile's start, and the start of the tile after it. */
interface TileFns {
  readonly startOf: (level: Expr, at: ExprType<DateTimeType>) => ExprType<DateTimeType>;
  readonly nextOf: (level: Expr, at: ExprType<DateTimeType>) => ExprType<DateTimeType>;
}

/** The tile arithmetic, held once by a reader's block. */
function tileFns<Ret>($: BlockBuilder<Ret>): TileFns {
  return { startOf: $.const(TILE_FNS.tileStart) as never, nextOf: $.const(TILE_FNS.tileNext) as never };
}

/**
 * The run of a level's tiles a window `[from, to)` reads: the start of the
 * first, and of the tile after the last. The one place the run is worked out,
 * for every reader of tiles.
 *
 * `carried` starts the run a tile sooner, for events with a span: one filed at
 * a level ends within the tile after the one holding its start, so the events
 * of a level that overlap the window start in a tile from the one before the
 * window's first to its last.
 */
function tilesOver<Ret>(
  $: BlockBuilder<Ret>, tiles: TileFns, level: Expr, from: ExprType<DateTimeType>, to: ExprType<DateTimeType>, carried: boolean,
): { first: ExprType<DateTimeType>; after: ExprType<DateTimeType> } {
  const first = $.const(carried ? tiles.startOf(level, msBefore(tiles.startOf(level, from))) : tiles.startOf(level, from));
  const after = $.const(tiles.nextOf(level, tiles.startOf(level, msBefore(to))));
  return { first, after };
}

/** A window of time as a reader's block holds it, and the first tile of the run being read. */
interface SpanWindow {
  readonly from: ExprType<DateTimeType>;
  readonly fromMs: ExprType<IntegerType>;
  readonly toMs: ExprType<IntegerType>;
  readonly first: ExprType<DateTimeType>;
}

/**
 * Whether a filed entry's event overlaps a window and is the one to give: the
 * window's edges and the once rule, in one place for every reader of events
 * with a span — a series index's, and a nested series index's items.
 *
 * The edges are the interval index's: an event with no end, or one at or
 * before its start, is an instant, inside from `from` and outside at `to`;
 * any other overlaps where it starts before `to` and ends after `from`. An
 * event past a year is filed under each year it touches, and is given under
 * the first of them the run holds: the run's first tile, or the tile holding
 * its start, which of the tiles it is filed under is the one at or before its
 * start.
 *
 * @param $ - The block the entry is read in
 * @param event - The event: a row, or a nested item
 * @param start - Its start field
 * @param end - Its end field
 * @param entry - The entry's key, whose index key holds the tile it is filed under
 * @param window - The window, and the run's first tile
 * @returns Whether the entry is given
 */
function spanGiven<Ret>(
  $: BlockBuilder<Ret>, event: Expr, start: OptionField<DateTimeType>, end: OptionField<DateTimeType>, entry: Expr, window: SpanWindow,
): ExprType<BooleanType> {
  // The index files an event with a start alone, and one with no end, or one at or before its start, is an instant.
  const starts = $.const(timeOf(event, start, window.from));
  const startMs = $.const(starts.toEpochMilliseconds());
  const endMs = $.const(timeOf(event, end, starts).toEpochMilliseconds());
  const overlaps = endMs.lessEqual(startMs).ifElse(
    () => startMs.greaterEqual(window.fromMs).and(() => startMs.less(window.toMs)),
    () => startMs.less(window.toMs).and(() => endMs.greater(window.fromMs)),
  );
  const tile = $.const(indexKeyPart(entry, 'tile') as ExprType<DateTimeType>);
  return overlaps.and(() => East.equal(tile, window.first).or(() => startMs.greaterEqual(tile.toEpochMilliseconds())));
}

function seriesReaders(entries: Entries): SeriesReaders {
  const series = entries.def.series!;
  const rowType = entries.carried as RowType;
  const start = optionField(rowType, series.from, DateTimeType);
  const end = optionField(rowType, series.to, DateTimeType);
  if (start === undefined || end === undefined) {
    throw new Error(`${entries.name}: a series index carries its rows, and these carry no '${series.from}' and '${series.to}' to test a window by`);
  }
  const levels = levelsFrom(series.tile);
  return {
    events: (window) => {
      const written = keyWindow(entries, 'events', window);
      return readOf(entries.k, entries.carried, ($, give) => {
      const on = $.const(written.on);
      const key = $.const(written.key);
      const from = $.const(written.from);
      const to = $.const(written.to);
      $.if(East.less(from, to), ($) => {
        const tiles = tileFns($);
        const fromMs = $.const(from.toEpochMilliseconds());
        const toMs = $.const(to.toEpochMilliseconds());
        $.for($.const(levels, ArrayType(RecordLevelType)), ($, level) => {
          const { first, after } = tilesOver($, tiles, level, from, to, true);
          const run = entries.dict.range({ from: { ik: { on, key, level, tile: first } }, to: { ik: { on, key, level, tile: after } } } as never);
          $.for(run as Entries['dict'], ($, row, entry) => {
            $.if(spanGiven($, row, start, end, entry, { from, fromMs, toMs, first }), ($) => { give($, row, rowKey(entry)); });
          });
        });
      });
      });
    },
  };
}

function summaryReaders(entries: Entries): SummaryReaders {
  const level = variant(entries.def.summary!.tile, null);
  return {
    totals: (window) => {
      const written = keyWindow(entries, 'totals', window);
      return readOf(DateTimeType, RecordSummaryTotalsType, ($, give) => {
      const on = $.const(written.on);
      const key = $.const(written.key);
      const from = $.const(written.from);
      const to = $.const(written.to);
      $.if(East.less(from, to), ($) => {
        // A total is split by tile, so the tiles that overlap the window hold all of it.
        const { first, after } = tilesOver($, tileFns($), $.const(level, RecordLevelType), from, to, false);
        const run = entries.dict.range({ from: { ik: { on, key, tile: first } }, to: { ik: { on, key, tile: after } } } as never);
        $.for(run as Entries['dict'], ($, totals, entry) => { give($, totals, indexKeyPart(entry, 'tile')); });
      });
      });
    },
  };
}

// ── Area indexes: `within`, `unplaced` ───────────────────────────────────────

/** A window of the plane: its minimum corner, and its width and height. */
export interface AreaWindow {
  /** The window's least `x`. */
  x: SubtypeExprOrValue<FloatType>;
  /** Its least `y`. */
  y: SubtypeExprOrValue<FloatType>;
  /** Its width; a negative one holds no row. */
  width: SubtypeExprOrValue<FloatType>;
  /** Its height; a negative one holds no row. */
  height: SubtypeExprOrValue<FloatType>;
}

/**
 * An area index's readers (`index.area`).
 *
 * @typeParam IK - The index's key type, `{ on, area }`
 * @typeParam P - What the index carries: the row
 * @typeParam K - The row's key type
 */
export interface AreaReaders<IK extends EastType = EastType, P extends EastType = EastType, K extends EastType = EastType> {
  /**
   * The rows whose box meets the window, its edges included: a box that
   * touches the window is in it. A cell at each level coarser than the one
   * whose cells are an eighth of the window's larger side, and a range of
   * cells at that level: at most 266 runs, as a page's read of a viewport,
   * read in the index's order, a cell before the cells inside it. A zero is
   * one edge whatever its sign: a width of `-0.0` is a width of none.
   *
   * @param window - The leading fields, each exactly, and the window
   * @returns The read: each row once, and its key
   * @throws {Error} Where the function is built, when a leading field is left out or of another type, naming them;
   *   an East runtime error when the window is not finite
   */
  within(window: LeadingOn<IK> & AreaWindow): IndexRead<P, K>;
  /**
   * The rows not yet placed: those whose `x` or `y` is none. One run.
   *
   * @param where - The leading fields, each exactly; left out for an index led by none
   * @returns The read
   * @throws {Error} Where the function is built, when the box's place is no Option field — every row is then
   *   placed — or a leading field is left out or of another type
   */
  unplaced(...where: LeadingArgs<IK>): IndexRead<P, K>;
}

/** A reader's number, as an expression. */
function float(entries: Entries, reader: string, name: string, value: unknown): ExprType<FloatType> {
  if (value === undefined) throw new Error(`${entries.name} ${reader}: \`${name}\` is left out — a window is { x, y, width, height }, each a Float`);
  return East.value(value as never, FloatType);
}

/**
 * A Float with no sign on its zero. East orders `-0.0` below `0.0`, and a
 * window's edge, or a box's, at either is the one edge, as it is to a page's
 * read: a number plus zero is itself, and `0.0` for either zero.
 */
const unsigned = (value: ExprType<FloatType>): ExprType<FloatType> => value.add(0.0);

/** The larger of two Floats. */
const larger = (a: ExprType<FloatType>, b: ExprType<FloatType>): ExprType<FloatType> => a.greaterEqual(b).ifElse(() => a, () => b);
/** The smaller of two Floats. */
const smaller = (a: ExprType<FloatType>, b: ExprType<FloatType>): ExprType<FloatType> => a.lessEqual(b).ifElse(() => a, () => b);

function areaReaders(entries: Entries): AreaReaders {
  const area = entries.def.area!;
  const rowType = entries.carried as RowType;
  const xField = optionField(rowType, area.x, FloatType);
  const yField = optionField(rowType, area.y, FloatType);
  if (xField === undefined || yField === undefined) {
    throw new Error(`${entries.name}: an area index carries its rows, and these carry no '${area.x}' and '${area.y}' to test a window by`);
  }
  /** A row's place along an axis: the field itself, or an Option's value — a row a window's runs hold is placed. */
  const placeOf = (row: Expr, field: OptionField<FloatType>): ExprType<FloatType> =>
    field.optional ? East.field(row, field.field, OptionType(FloatType)).unwrap('some', () => 0.0) : East.field(row, field.field, FloatType);
  /** A row's size along an axis: its field's, or none for a point. */
  const sizeOf = (row: Expr, field: string | undefined): ExprType<FloatType> => field === undefined ? East.value(0.0, FloatType) : East.field(row, field, FloatType);
  // The domain is the finest cell's side times 2^27 either side of zero: a power of two, so every edge is exact.
  const half = area.cell * 2 ** (AREA_FINEST_LEVEL - 1);
  const finest = BigInt(AREA_FINEST_LEVEL);
  return {
    within: (window) => {
      const given = (window ?? {}) as { on?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown };
      const written = {
        on: leadingOn(entries, 'within', given.on),
        x: float(entries, 'within', 'x', given.x), y: float(entries, 'within', 'y', given.y),
        width: float(entries, 'within', 'width', given.width), height: float(entries, 'within', 'height', given.height),
      };
      return readOf(entries.k, entries.carried, ($, give) => {
        const on = $.const(written.on);
        const fromX = $.const(unsigned(written.x));
        const fromY = $.const(unsigned(written.y));
        const width = $.const(unsigned(written.width));
        const height = $.const(unsigned(written.height));
        // A number less itself is zero exactly when it is finite.
        $.if([fromX, fromY, width, height].reduce((finite, value) => finite.and(() => value.subtract(value).equal(0.0)), East.value(true)).not(), ($) => {
          $.error(`${entries.name} within: a window's x, y, width and height are finite numbers`);
        });
        $.if(width.greaterEqual(0.0).and(() => height.greaterEqual(0.0)), ($) => {
          const toX = $.const(fromX.add(width));
          const toY = $.const(fromY.add(height));
          const morton = $.const(AREA_FNS.mortonCode);
          // The deepest level read: the deepest whose cell is at least an eighth of the window's larger side.
          const eighth = $.const(larger(width, height).divide(8.0));
          const deepest = $.let(finest);
          const finestSide = $.let(area.cell);
          $.while(deepest.greater(0n).and(() => finestSide.less(eighth)), ($) => {
            $.assign(finestSide, finestSide.multiply(2.0));
            $.assign(deepest, deepest.subtract(1n));
          });
          // The runs the window reads, each by its first key and the key it ends before. They are found a level at a
          // time, and a Dict holds them in the index's order: a cell before the cells inside it, along the curve.
          const runs = $.let(new Map(), DictType(IntegerType, IntegerType));
          // From the root down: a level's cell side, its cells along an axis, a cell's step at the finest level, and the
          // codes under one cell.
          const level = $.let(0n);
          const side = $.let(half * 2);
          const count = $.let(1n);
          const step = $.let(1n << finest);
          const under = $.let(1n << (2n * finest));
          $.while(level.lessEqual(deepest), ($) => {
            // A row filed in a cell lies within it grown by a quarter of its side: the cells whose grown bounds meet
            // the window, along each axis. The root is read whatever the window: a row outside the domain files under it.
            const reach = $.const(side.divide(4.0));
            const last = $.const(count.subtract(1n).toFloat());
            const cellAt = (at: ExprType<FloatType>) => East.Float.roundFloor(smaller(larger(at.add(half).divide(side), East.value(0.0, FloatType)), last));
            const meets = (index: ExprType<IntegerType>, from: ExprType<FloatType>, to: ExprType<FloatType>) => {
              const start = index.toFloat().multiply(side).subtract(half);
              return level.equal(0n).or(() => start.subtract(reach).lessEqual(to).and(() => start.add(side).add(reach).greaterEqual(from)));
            };
            const firstX = $.const(cellAt(fromX.subtract(side).subtract(reach)));
            const lastX = $.const(cellAt(toX.add(side).add(reach)));
            const firstY = $.const(cellAt(fromY.subtract(side).subtract(reach)));
            const lastY = $.const(cellAt(toY.add(side).add(reach)));
            $.for(East.Array.range(firstX, lastX.add(1n)), ($, ix) => {
              $.if(meets(ix, fromX, toX), ($) => {
                $.for(East.Array.range(firstY, lastY.add(1n)), ($, iy) => {
                  $.if(meets(iy, fromY, toY), ($) => {
                    // A coarser cell by its own key: the rows filed in it. A cell of the deepest level by the range
                    // from its key to its last descendant's: the rows filed in it or in a finer cell inside it.
                    const code = $.const(morton(ix.multiply(step), iy.multiply(step)));
                    const start = $.const(code.multiply(32n).add(level));
                    $(runs.insert(start, level.less(deepest).ifElse(() => start.add(1n), () => code.add(under).multiply(32n))));
                  });
                });
              });
            });
            $.assign(level, level.add(1n));
            $.assign(side, side.divide(2.0));
            $.assign(count, count.multiply(2n));
            $.assign(step, step.divide(2n));
            $.assign(under, under.divide(4n));
          });
          $.for(runs, ($, end, start) => {
            const run = entries.dict.range({ from: { ik: { on, area: start } }, to: { ik: { on, area: end } } } as never);
            $.for(run as Entries['dict'], ($, row, entry) => {
              // The row's box, by its corner or its centre, whichever way its sides run.
              const x = $.const(unsigned(placeOf(row, xField)));
              const y = $.const(unsigned(placeOf(row, yField)));
              const w = $.const(unsigned(sizeOf(row, area.width)));
              const h = $.const(unsigned(sizeOf(row, area.height)));
              const [minX, maxX, minY, maxY] = area.at === 'centre'
                ? [x.subtract(w.abs().divide(2.0)), x.add(w.abs().divide(2.0)), y.subtract(h.abs().divide(2.0)), y.add(h.abs().divide(2.0))]
                : [smaller(x, x.add(w)), larger(x, x.add(w)), smaller(y, y.add(h)), larger(y, y.add(h))];
              $.if(minX.lessEqual(toX).and(() => maxX.greaterEqual(fromX)).and(() => minY.lessEqual(toY)).and(() => maxY.greaterEqual(fromY)), ($) => {
                give($, row, rowKey(entry));
              });
            });
          });
        });
      });
    },
    unplaced: (...where) => {
      if (!xField.optional) {
        throw new Error(
          `${entries.name} unplaced: the index's place, '${area.x}' and '${area.y}', is Float fields, so every row is placed — ` +
          `a row not yet placed is one whose place is an Option<Float> left none`,
        );
      }
      const written = leadingOn(entries, 'unplaced', (where[0] as { on?: unknown } | undefined)?.on);
      return readOf(entries.k, entries.carried, ($, give) => {
        const on = $.const(written);
        $.for(entries.dict.prefix({ ik: { on, area: AREA_UNPLACED } } as never), ($, row, entry) => { give($, row, rowKey(entry)); });
      });
    },
  };
}

// ── Entries indexes: `of` ────────────────────────────────────────────────────

/**
 * An entries index's readers (`index.entries`).
 *
 * @typeParam IK - The index's key type: the field's key
 * @typeParam P - What the index carries: the field's value
 * @typeParam K - The row's key type
 */
export interface EntriesReaders<IK extends EastType = EastType, P extends EastType = EastType, K extends EastType = EastType> {
  /**
   * A key's entry on every row that holds one: the value the row's field
   * holds under the key. One run.
   *
   * @param key - The field's key, whole
   * @returns The read: each entry's value, and its row's key
   * @throws {Error} Where the function is built, when the key is not of the field's key type
   */
  of(key: SubtypeExprOrValue<IK>): IndexRead<P, K>;
}

function entriesReaders(entries: Entries): EntriesReaders {
  return {
    of: (key) => {
      if (key === undefined) throw new Error(`${entries.name} of: the key is left out — a key of the rows' '${entries.def.entries!.field}'`);
      // The key whole: a row files an entry for each key its field holds, so a part of one would give a row several.
      const written = East.value(key as never, entries.ik);
      return readOf(entries.k, entries.carried, ($, give) => {
        $.for(entries.dict.prefix({ ik: written } as never), ($, value, entry) => { give($, value, rowKey(entry)); });
      });
    },
  };
}

// ── Nested series indexes: a reader for each run ─────────────────────────────

/** A node of a row's tree, and a window of its time: a collection, by its place, a row, and the path down to the node. */
export interface NestedWindow<K extends EastType = EastType, Place extends readonly string[] = readonly string[]> extends TimeWindow {
  /** The collection's place: its field names from the row down (`['jobs']`, `['members', 'load']`), a recursive step adding none. */
  collection: Place;
  /** The record row's key. */
  row: SubtypeExprOrValue<K>;
  /** The Dict keys from the row down to the node the read is about; left out, the row itself. */
  path?: SubtypeExprOrValue<ArrayType<StringType>>;
}

/**
 * The places of the collections a declaration files: each one's field names
 * from the row down, a recursive field adding none.
 */
export type NestedPlaceOf<C> = unknown extends C ? readonly string[] : {
  [F in keyof C & string]:
    C[F] extends SeriesRows<infer Below> ? readonly [F, ...NestedPlaceOf<Below>]
    : C[F] extends SeriesRecursive ? never
    : readonly [F]
}[keyof C & string];

/** What a collection at a place holds: an item's struct, or a value. */
export type NestedItemAt<V, C, Place> =
  Place extends readonly [infer F extends string, ...infer Rest]
    ? F extends keyof C
      ? C[F] extends SeriesRows<infer Below> ? NestedItemAt<ChildOf<V, F>, Below, Rest>
        : ChildOf<V, F> extends EastType ? ChildOf<V, F> : EastType
      : EastType
    : EastType;

/** What a read names a collection's items by: a thing people drag by its id, a value by its instant. */
export type NestedKeyAt<C, Place> =
  Place extends readonly [infer F extends string, ...infer Rest]
    ? F extends keyof C
      ? C[F] extends SeriesRows<infer Below> ? NestedKeyAt<Below, Rest>
        : C[F] extends SeriesValues ? DateTimeType
        : C[F] extends SeriesItems ? StringType
        : EastType
      : EastType
    : EastType;

/**
 * An item of a subtree, as a read names it and the index's key does: the Dict
 * keys from the node down to the node holding it — a path, `end` or a `step`
 * and the rest — and its id.
 */
export const NestedUnderType = RecordNestedItemType.cases.under;

/**
 * A nested series index's readers (`index.nested`): one for each run the
 * index files of a node.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's row type
 * @typeParam C - The index's collections, as declared
 */
export interface NestedReaders<K extends EastType = EastType, V = unknown, C = unknown> {
  /**
   * A node's own items, or values, that overlap `[from, to)`: an item timed
   * `{ from, to }` as an interval index's row overlaps a window, a value or
   * an instant where it is inside it. One run a level for items timed
   * `{ from, to }`, in the index's order of its levels; one for values and
   * instants.
   *
   * @param window - The collection, the row, the path to the node, and the window
   * @returns The read: each item or value once, and its id or its instant
   * @throws {Error} Where the function is built, when the index files no collection at the place, naming those it does
   */
  items<const Place extends NestedPlaceOf<C>>(window: NestedWindow<K, Place>): IndexRead<NestedItemAt<V, C, Place>, NestedKeyAt<C, Place>>;
  /**
   * A node's totals of a collection, a summary tile at a time, for each tile
   * that overlaps `[from, to)`: how many items touch it, the milliseconds of
   * it they cover, and for numbers their sum, least, greatest and latest. One
   * run.
   *
   * @param window - The collection, the row, the path to the node, and the window
   * @returns The read: each tile's totals, and the tile's start
   * @throws {Error} Where the function is built, when the index keeps no totals: it declares no `summary`
   */
  totals(window: NestedWindow<K, NestedPlaceOf<C>>): IndexRead<typeof RecordNestedTotalsType, DateTimeType>;
  /**
   * A parent's subtotals of a collection of values by one of its rollups, at
   * a level, for each tile that overlaps `[from, to)`. One run.
   *
   * @param window - The collection, the row, the path to the parent, the rollup as declared, the level — the
   *   index's tile where left out — and the window
   * @returns The read: each tile's subtotal, and the tile's start
   * @throws {Error} Where the function is built, when the collection keeps no subtotal by the rollup, naming those
   *   it does, or the index files at no such level
   */
  subtotals(window: NestedWindow<K, NestedPlaceOf<C>> & { rollup: SeriesRollupInput; level?: RecordTile }): IndexRead<FloatType, DateTimeType>;
  /**
   * The items of every node beneath a node, of a collection rolled up, that
   * overlap `[from, to)`. One run a level, in the index's order of its levels.
   *
   * @param window - The collection, the row, the path to the node, and the window
   * @returns The read: each item once, and the keys from the node down to the one holding it with its id
   * @throws {Error} Where the function is built, when the collection's items are not rolled up
   */
  subtree<const Place extends NestedPlaceOf<C>>(window: NestedWindow<K, Place>): IndexRead<NestedItemAt<V, C, Place>, typeof NestedUnderType>;
  /**
   * A node's totals of the items beneath it, of a collection rolled up, a
   * summary tile at a time. One run.
   *
   * @param window - The collection, the row, the path to the node, and the window
   * @returns The read: each tile's totals, and the tile's start
   * @throws {Error} Where the function is built, when the collection's items are not rolled up, or the index
   *   declares no `summary`
   */
  subtreeTotals(window: NestedWindow<K, NestedPlaceOf<C>>): IndexRead<typeof RecordNestedTotalsType, DateTimeType>;
}

/** A node's Dict keys from its row down, as a reader is given them. */
const KeysType = ArrayType(StringType);
/** Whether two rollups are one, as an index keeps them. */
const sameRollup = equalFor(RecordRollupType);

/** Each nested series index's declaration, as its readers hold it ({@link nestedDeclared}). */
const NESTED_DECLARED = new WeakMap<RecordIndexDef, NestedDeclaration>();

/**
 * A nested series index's declaration, as its readers hold it: its
 * collections, each with its place and what it holds.
 *
 * The record checked the declaration as it built the index. It is walked here
 * once more for an index, the first time a reader of it is called, and kept:
 * however many functions take the index as an input, and whether or not their
 * bodies read it.
 *
 * @param def - The nested series index
 * @returns Its declaration
 */
function nestedDeclared(def: RecordIndexDef): NestedDeclaration {
  let decl = NESTED_DECLARED.get(def);
  if (decl === undefined) {
    const rowType = (def.record.type as EastType & { readonly value: EastType }).value;
    decl = checkNested('index.nested', def.name, rowType, def.nested!.collections);
    NESTED_DECLARED.set(def, decl);
  }
  return decl;
}

function nestedReaders(entries: Entries): NestedReaders {
  const nested = entries.def.nested!;
  const rowKeyType = (entries.ik as StructType<{ row: EastType }>).fields.row;
  /** The levels the index files at, from its tile up to the year, as a refusal names them. */
  const filedAt = RECORD_TILES.slice(RECORD_TILES.indexOf(nested.tile));
  /** A collection's place, as a refusal names it: `['members', 'load']`. */
  const placeWords = (collection: NestedCollection): string => `[${collection.place.map((name) => `'${name}'`).join(', ')}]`;

  /** The collection a reader is given by its place, the node it reads, and the window, refused where they do not fit. */
  const written = (reader: string, window: unknown) => {
    const given = (window ?? {}) as { collection?: unknown; row?: unknown; path?: unknown; from?: unknown; to?: unknown };
    const place = given.collection;
    const decl = nestedDeclared(entries.def);
    const collection = Array.isArray(place)
      ? decl.collections.find((at) => at.place.length === place.length && at.place.every((name, i) => name === place[i]))
      : undefined;
    if (collection === undefined) {
      const places = decl.collections.map(placeWords).join(', ');
      throw new Error(`${entries.name} ${reader}: the index files no collection at ${JSON.stringify(place)} — it files ${places}, each by its field names from the row down`);
    }
    if (given.row === undefined) throw new Error(`${entries.name} ${reader}: \`row\` is left out — the key of the record's row the node is in`);
    return {
      collection,
      row: East.value(given.row as never, rowKeyType),
      path: East.value((given.path ?? []) as never, KeysType),
      from: instant(entries, reader, 'from', given.from),
      to: instant(entries, reader, 'to', given.to),
    };
  };
  type Written = ReturnType<typeof written>;

  /** What a collection's entry carries, out of its value: the item, or the value. */
  const itemTypeOf = (collection: NestedCollection): EastType => collection.kind === 'items' ? collection.itemType : collection.valueType;

  /**
   * A node's items of a run, `items` or `subtree`: a run a level for items
   * with a span, each tested by the window's edges and given once; one run, at
   * the index's tile, for instants and values.
   */
  const itemsOf = <Ret>(
    $: BlockBuilder<Ret>, run: 'items' | 'subtree', at: Written, give: ($: BlockBuilder<Ret>, carried: Expr, key: Expr) => void,
  ): void => {
    const { collection } = at;
    const spans = collection.kind === 'items' && collection.start.field !== collection.end.field;
    const path = $.const(NESTED_FNS.pathOf);
    const place = $.const(path(East.value([...collection.place], KeysType)));
    const row = $.const(at.row);
    const node = $.const(path(at.path));
    const from = $.const(at.from);
    const to = $.const(at.to);
    $.if(East.less(from, to), ($) => {
      const tiles = tileFns($);
      const unwrap = $.const(itemOf(nestedDeclared(entries.def), collection, itemTypeOf(collection), entries.carried));
      const fromMs = $.const(from.toEpochMilliseconds());
      const toMs = $.const(to.toEpochMilliseconds());
      // An item with a span is filed at the level its length fits; an instant, and a value, at the index's tile.
      const levels = spans ? levelsFrom(nested.tile) : [variant(nested.tile, null)];
      $.for($.const(levels, ArrayType(RecordLevelType)), ($, level) => {
        const { first, after } = tilesOver($, tiles, level, from, to, spans);
        const range = entries.dict.range({
          from: { ik: { collection: place, row, path: node, run: variant(run, null), level, tile: first } },
          to: { ik: { collection: place, row, path: node, run: variant(run, null), level, tile: after } },
        } as never);
        $.for(range as Entries['dict'], ($, value, entry) => {
          const item = $.const(unwrap(value));
          const filed = indexKeyPart(entry, 'item') as ExprType<StructType<Record<string, never>>> & { unwrap(name: string): Expr };
          const key = run === 'subtree' ? filed.unwrap('under') : collection.kind === 'items' ? filed.unwrap('id') : filed.unwrap('at');
          if (collection.kind === 'values') {
            // A value is at its instant, which its entry's key holds.
            const instantMs = $.const((filed.unwrap('at') as ExprType<DateTimeType>).toEpochMilliseconds());
            $.if(instantMs.greaterEqual(fromMs).and(() => instantMs.less(toMs)), ($) => { give($, item, key); });
            return;
          }
          $.if(spanGiven($, item, collection.start, collection.end, entry, { from, fromMs, toMs, first }), ($) => { give($, item, key); });
        });
      });
    });
  };

  /** A node's entries of a run that holds one a tile at a level — `totals`, `subtreeTotals`, a rollup's `subtotals` — for the tiles that overlap the window. */
  const tilesOf = <Ret>(
    $: BlockBuilder<Ret>, run: unknown, tile: RecordTile, held: 'totals' | 'subtotal', at: Written, give: ($: BlockBuilder<Ret>, carried: Expr, key: Expr) => void,
  ): void => {
    const path = $.const(NESTED_FNS.pathOf);
    const place = $.const(path(East.value([...at.collection.place], KeysType)));
    const row = $.const(at.row);
    const node = $.const(path(at.path));
    const from = $.const(at.from);
    const to = $.const(at.to);
    $.if(East.less(from, to), ($) => {
      const level = $.const(variant(tile, null), RecordLevelType);
      const { first, after } = tilesOver($, tileFns($), level, from, to, false);
      const range = entries.dict.range({
        from: { ik: { collection: place, row, path: node, run, level, tile: first } },
        to: { ik: { collection: place, row, path: node, run, level, tile: after } },
      } as never);
      $.for(range as Entries['dict'], ($, value, entry) => {
        give($, (value as unknown as { unwrap(name: string): Expr }).unwrap(held), indexKeyPart(entry, 'tile'));
      });
    });
  };

  const summary = (reader: string): RecordTile => {
    if (nested.summary === undefined) {
      throw new Error(`${entries.name} ${reader}: the index keeps no totals — declare the tile they are kept by, as index.nested({ …, summary: 'month' })`);
    }
    return nested.summary;
  };
  const rolledUp = (reader: string, collection: NestedCollection): void => {
    if (collection.kind !== 'items' || !collection.rollup) {
      throw new Error(
        `${entries.name} ${reader}: the collection at ${placeWords(collection)} is not rolled up, so no node holds ` +
        `the items beneath it — declare it index.nested.items(times, { rollup: true })`,
      );
    }
  };

  return {
    items: (window) => {
      const at = written('items', window);
      const keyType = at.collection.kind === 'items' ? StringType : DateTimeType;
      return readOf(keyType as EastType, itemTypeOf(at.collection), ($, give) => { itemsOf($, 'items', at, give); }) as never;
    },
    totals: (window) => {
      const at = written('totals', window);
      const tile = summary('totals');
      return readOf(DateTimeType, RecordNestedTotalsType, ($, give) => { tilesOf($, variant('totals', null), tile, 'totals', at, give); });
    },
    subtotals: (window) => {
      const at = written('subtotals', window);
      const given = window as { rollup?: unknown; level?: unknown };
      const { collection } = at;
      const kept = collection.kind === 'values' ? collection.rollups : [];
      const rollup = rollupOf(`${entries.name} subtotals: the collection at ${placeWords(collection)}`, given.rollup);
      if (!kept.some((declared) => sameRollup(declared, rollup))) {
        const names = kept.length === 0
          ? 'it keeps none: declare index.nested.values({ rollup }) under rows(…) or beside recursive()'
          : `it keeps ${kept.map((declared) => rollupWords(declared)).join(', ')}`;
        throw new Error(`${entries.name} subtotals: the collection at ${placeWords(collection)} keeps no subtotal by ${rollupWords(rollup)} — ${names}`);
      }
      const level = given.level === undefined ? nested.tile : given.level;
      if (typeof level !== 'string' || !(filedAt as readonly string[]).includes(level)) {
        throw new Error(`${entries.name} subtotals: the index keeps subtotals at ${filedAt.join(', ')}, and none at ${JSON.stringify(given.level)}`);
      }
      return readOf(DateTimeType, FloatType, ($, give) => { tilesOf($, variant('subtotals', rollup), level as RecordTile, 'subtotal', at, give); });
    },
    subtree: (window) => {
      const at = written('subtree', window);
      rolledUp('subtree', at.collection);
      return readOf(NestedUnderType, itemTypeOf(at.collection), ($, give) => { itemsOf($, 'subtree', at, give); }) as never;
    },
    subtreeTotals: (window) => {
      const at = written('subtreeTotals', window);
      rolledUp('subtreeTotals', at.collection);
      const tile = summary('subtreeTotals');
      return readOf(DateTimeType, RecordNestedTotalsType, ($, give) => { tilesOf($, variant('subtreeTotals', null), tile, 'totals', at, give); });
    },
  };
}

// ── The readers of an index ──────────────────────────────────────────────────

/** A Dict record's key type. */
type RecordKeyOf<T> = T extends DictType<infer K extends EastType, unknown> ? K : EastType;
/** A Dict record's row type. */
type RecordRowOf<T> = T extends DictType<unknown, infer V extends EastType> ? V : EastType;

/**
 * The readers of an index, by its kind: a series index's `events`, a summary
 * index's `totals`, an interval index's `overlapping` and `unset`, an area
 * index's `within` and `unplaced`, an entries index's `of`, a nested series
 * index's `items`, `totals`, `subtotals`, `subtree` and `subtreeTotals`, and
 * a plain index's `of` and `between`.
 *
 * What a read gives for a row is what the index carries as its record builds
 * it (`RecordIndexDef`'s `Carried`): beside a nested series index or an
 * entries index of the record, an index that carries nothing, or the row,
 * carries the lean row, and its reads are typed by it.
 *
 * @typeParam D - The index, as `record.indexes.<name>` types it
 */
export type IndexReadersOf<D> =
  D extends RecordIndexDef<string, infer T, infer IK, EastType, readonly string[] | undefined, infer C>
    ? D extends { readonly series: object } ? SeriesReaders<IK, C, RecordKeyOf<T>>
      : D extends { readonly summary: object } ? SummaryReaders<IK>
      : D extends { readonly interval: object } ? IntervalReaders<IK, C, RecordKeyOf<T>>
      : D extends { readonly area: object } ? AreaReaders<IK, C, RecordKeyOf<T>>
      : D extends { readonly entries: object } ? EntriesReaders<IK, C, RecordKeyOf<T>>
      : D extends { readonly nested: { readonly collections: infer N } } ? NestedReaders<RecordKeyOf<T>, RecordRowOf<T>, N>
      : PlainReaders<IK, C, D extends { readonly span: object } ? IK : RecordKeyOf<T>>
    : Record<never, never>;

/** The index an expression's readers read, kept on the expression: it carries one index's. */
const READS = Symbol('e3.indexReads');

/** An index input, as a refusal names it: `e3.index 'jobs.jobs_by_press'`. */
const inputWords = (input: IndexInputDef): string => `e3.index '${input.record.name}.${input.index.name}'`;

/**
 * An expression of an index's entries with the index's readers on it: the
 * expression itself, still the entries.
 *
 * An expression carries one index's readers. One that carries this index's
 * already — a body's parameter for it, or what `read` was given before — is
 * given back as it is, its readers not made again; one that carries another
 * index's is refused, naming it, which is how two indexes whose entries have
 * one type are told apart. An expression that carries none is known by its
 * type alone: the parameter of a task's own function for another index of the
 * same type is read as this one's, and is the author's to keep apart.
 *
 * @param input - The index, as `e3.index` takes it
 * @param entries - Its entries: the body's parameter for it, or any expression of the input's type
 * @returns The expression, with the readers of the index's kind
 * @throws {Error} When the expression is not of the index's entries' type, naming both, or carries another index's
 *   readers, naming that index
 */
export function readersOn(input: IndexInputDef, entries: unknown): Expr {
  const name = inputWords(input);
  if (!(entries instanceof Expr) || !isTypeEqual(Expr.type(entries), input.type)) {
    const given = entries instanceof Expr ? `an expression of ${printType(Expr.type(entries))}` : 'no East expression';
    throw new Error(`${name} reads its own entries, ${printType(input.type)}, and was given ${given} — pass the body's parameter for this index`);
  }
  const read = (entries as { readonly [READS]?: IndexInputDef })[READS];
  if (read !== undefined) {
    if (read.index === input.index) return entries;
    throw new Error(`${name} reads its own entries, and was given those of ${inputWords(read)}, which are of the same type — pass the body's parameter for this index`);
  }
  Object.defineProperty(entries, READS, { value: input });
  return Object.assign(entries, readersOf(name, input, entries));
}

/** The readers of an index's kind over an expression of its entries. */
function readersOf(name: string, input: IndexInputDef, entries: Expr): object {
  const type = input.type as DictType<StructType<{ ik: EastType; k: EastType }>, EastType>;
  const held: Entries = {
    name, def: input.index, dict: entries as Entries['dict'], ik: type.key.fields.ik, k: type.key.fields.k, carried: type.value,
  };
  const def = input.index;
  if (def.series !== undefined) return seriesReaders(held);
  if (def.summary !== undefined) return summaryReaders(held);
  if (def.interval !== undefined) return intervalReaders(held);
  if (def.area !== undefined) return areaReaders(held);
  if (def.entries !== undefined) return entriesReaders(held);
  if (def.nested !== undefined) return nestedReaders(held);
  return plainReaders(held);
}
