/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The time tiles a series index and a summary index file a record's events by
 * (#1039): a day, an ISO week from Monday, a calendar month, a quarter or a
 * year, each in UTC and half-open, `[its start, the next tile's start)`.
 *
 * A summary index splits an event over every tile it overlaps
 * ({@link tileShares}): its shares, the milliseconds of each tile it covers,
 * which add up to its length exactly. An instant — no end, or an end at or
 * before its start — touches the one tile holding it and covers none of it.
 *
 * A series index files an event once (#1433, {@link eventFilings}): at the
 * finest level, from its tile up, whose shortest tile holds the event's
 * length, under the tile of that level holding its start — or, past a year,
 * under each year it touches. An event filed at a level ends before the end of
 * the tile after the one holding its start, so a reader finds every event at a
 * level that overlaps a range by reading its tiles from the one before the
 * range's first.
 *
 * The arithmetic is Integer milliseconds and East's own calendar, so every
 * runtime files an event alike, which is what lets a maintained index equal
 * its rebuild byte for byte.
 *
 * @packageDocumentation
 */
import { ArrayType, DateTimeType, East, IntegerType, StringType, StructType, variant } from '@elaraai/east';
import { RecordLevelType } from '@elaraai/e3-types';

/** A tile's length: a day, an ISO week, a calendar month, a quarter or a year. */
export type RecordTile = 'day' | 'week' | 'month' | 'quarter' | 'year';

/** The tiles, from the shortest. */
export const RECORD_TILES: readonly RecordTile[] = ['day', 'week', 'month', 'quarter', 'year'];

/**
 * The most tiles one event is filed under or split over: a series index files
 * an event longer than a year under each year it touches, as many as this
 * ({@link eventFilings}), and a summary index splits one over its tiles, as
 * many as this ({@link tileShares}). An event past either is refused where it
 * is written, naming it.
 */
export const MAX_EVENT_TILES = 4096n;

/**
 * Each level's shortest tile, in milliseconds: a day; a week; a month's 28
 * days; a quarter's 90, January to March in a common year; a year's 365. An
 * event filed at a level is no longer than this, so the tile after the one
 * holding its start, at least as long, holds its end.
 */
export const SHORTEST_MS: Readonly<Record<RecordTile, bigint>> = {
  day: 86_400_000n,
  week: 604_800_000n,
  month: 2_419_200_000n,
  quarter: 7_776_000_000n,
  year: 31_536_000_000n,
};

/** A day, in milliseconds. */
const DAY_MS = 86_400_000n;
/** An ISO week, in milliseconds. */
const WEEK_MS = 604_800_000n;
/** 1969-12-29T00:00:00Z, the Monday before the epoch, in milliseconds: where weeks are counted from. */
const MONDAY_MS = -259_200_000n;

/**
 * One tile an event touches: the tile's start, and how many of its
 * milliseconds the event covers.
 *
 * @property tile - The tile's start, UTC
 * @property ms - The milliseconds of the tile the event covers; 0 for an instant
 */
export const TileShareType = StructType({ tile: DateTimeType, ms: IntegerType });
/** Type alias for {@link TileShareType}. */
export type TileShareType = typeof TileShareType;

/**
 * Refuses a tile no index files by, naming the ones it does.
 *
 * @param constructor - The constructor, as the refusal names it
 * @param name - The index
 * @param tile - The tile the author declared
 * @returns The tile
 * @throws {Error} When `tile` is not one of {@link RECORD_TILES}
 */
export function checkTile(constructor: string, name: string, tile: unknown): RecordTile {
  if (typeof tile === 'string' && (RECORD_TILES as readonly string[]).includes(tile)) return tile as RecordTile;
  throw new Error(`${constructor} '${name}' takes a tile: ${RECORD_TILES.map((t) => `"${t}"`).join(', ')} — got ${JSON.stringify(tile)}`);
}

/**
 * A fixed-length tile's start: the instant floored to a whole number of
 * `length` milliseconds from `origin`, whichever sign the runtime's remainder
 * takes, so an instant before 1970 is tiled as one after it.
 */
function fixedStart(length: bigint, origin: bigint) {
  return East.function([DateTimeType], DateTimeType, ($, at) => {
    const ms = $.let(at.toEpochMilliseconds());
    // The offset into its tile, in [0, length).
    const into = $.let(ms.subtract(origin).remainder(length).add(length).remainder(length));
    return East.DateTime.fromEpochMilliseconds(ms.subtract(into));
  });
}

/**
 * The start of the tile holding an instant: an East function, so every runtime
 * computes it alike — a day and a week counted in whole milliseconds from
 * midnight of the epoch and from the Monday before it, a month, a quarter and
 * a year by East's calendar (`roundDownMonth`, `roundDownYear`).
 *
 * @param tile - The tile
 * @returns `(at) → the start of the tile holding it`
 */
export function tileStart(tile: RecordTile) {
  switch (tile) {
    case 'day': return fixedStart(DAY_MS, 0n);
    case 'week': return fixedStart(WEEK_MS, MONDAY_MS);
    case 'month': return East.function([DateTimeType], DateTimeType, (_$, at) => East.DateTime.roundDownMonth(at, 1n));
    case 'quarter': return East.function([DateTimeType], DateTimeType, (_$, at) => East.DateTime.roundDownMonth(at, 3n));
    case 'year': return East.function([DateTimeType], DateTimeType, (_$, at) => East.DateTime.roundDownYear(at, 1n));
  }
}

/** A calendar tile's next start: `months` on, January of the next year past December. */
function calendarNext(months: bigint) {
  return East.function([DateTimeType], DateTimeType, ($, start) => {
    const year = $.let(start.getYear());
    const month = $.let(start.getMonth().add(months));
    $.if(month.greater(12n), ($) => {
      $.assign(year, year.add(1n));
      $.assign(month, month.subtract(12n));
    });
    return East.DateTime.fromComponents(year, month, 1n, 0n, 0n, 0n, 0n);
  });
}

/**
 * The start of the tile after one: an East function, so every runtime computes
 * it alike.
 *
 * @param tile - The tile
 * @returns `(start) → the next tile's start`, for a tile's start
 */
export function tileNext(tile: RecordTile) {
  switch (tile) {
    case 'day': return East.function([DateTimeType], DateTimeType, (_$, start) => East.DateTime.fromEpochMilliseconds(start.toEpochMilliseconds().add(DAY_MS)));
    case 'week': return East.function([DateTimeType], DateTimeType, (_$, start) => East.DateTime.fromEpochMilliseconds(start.toEpochMilliseconds().add(WEEK_MS)));
    case 'month': return calendarNext(1n);
    case 'quarter': return calendarNext(3n);
    case 'year': return calendarNext(12n);
  }
}

/**
 * The tiles an event touches, and its share of each: an East function, so
 * every runtime files an event alike (see the module docs).
 *
 * @param tile - The tile
 * @returns `(start, end, what) → each tile it touches, in order, and the
 *   milliseconds of it the event covers`: one tile, covered for none, when
 *   `end` is at or before `start`. `what` names the event in a refusal.
 * @throws East runtime error when the event touches more than
 *   {@link MAX_EVENT_TILES} tiles, naming `what`, its span and the tile
 */
export function tileShares(tile: RecordTile) {
  const startOf = tileStart(tile);
  const nextOf = tileNext(tile);
  const tooMany = `touches more than ${MAX_EVENT_TILES} ${tile} tiles: declare a coarser tile`;
  return East.function([DateTimeType, DateTimeType, StringType], ArrayType(TileShareType), ($, start, end, what) => {
    const first = $.const(startOf);
    const next = $.const(nextOf);
    const shares = $.let([], ArrayType(TileShareType));
    const from = $.let(start.toEpochMilliseconds());
    const to = $.let(end.toEpochMilliseconds());
    const at = $.let(first(start));
    // An instant: the tile holding it, none of it covered.
    $.if(to.lessEqual(from), ($) => {
      $(shares.pushLast({ tile: at, ms: 0n }));
      $.return(shares);
    });
    $.while(at.toEpochMilliseconds().less(to), ($) => {
      $.if(shares.size().greaterEqual(MAX_EVENT_TILES), ($) => {
        $.error(East.str`${what}, from ${East.print(start)} to ${East.print(end)}, ${tooMany}`);
      });
      const after = $.let(next(at));
      const lo = $.let(at.toEpochMilliseconds().greater(from).ifElse(() => at.toEpochMilliseconds(), () => from));
      const hi = $.let(after.toEpochMilliseconds().less(to).ifElse(() => after.toEpochMilliseconds(), () => to));
      $(shares.pushLast({ tile: at, ms: hi.subtract(lo) }));
      $.assign(at, after);
    });
    return shares;
  });
}

/**
 * One place a series index files an event (#1433): the level, and the start of
 * that level's tile.
 *
 * @property level - The level it is filed at
 * @property tile - The start of the level's tile, UTC
 */
export const TileFilingType = StructType({ level: RecordLevelType, tile: DateTimeType });
/** Type alias for {@link TileFilingType}. */
export type TileFilingType = typeof TileFilingType;

/**
 * Where a series index files an event (see the module docs): once, at the
 * finest level from `tile` up whose shortest tile ({@link SHORTEST_MS}) holds
 * its length, under the tile of that level holding its start; past a year,
 * under each year it touches. An East function, unrolled at build over the
 * levels, so every runtime files an event alike.
 *
 * @param tile - The index's declared tile, its finest level
 * @returns `(start, end, what) → each place it is filed, in order`: an instant
 *   — `end` at or before `start` — at `tile`. `what` names the event in a
 *   refusal, as {@link tileShares}' does.
 * @throws East runtime error when an event longer than a year touches more
 *   than {@link MAX_EVENT_TILES} years, naming `what` and its span
 */
export function eventFilings(tile: RecordTile) {
  const levels = RECORD_TILES.slice(RECORD_TILES.indexOf(tile));
  const tooLong = `touches more than ${MAX_EVENT_TILES} year tiles: end it within ${MAX_EVENT_TILES} years of its start`;
  return East.function([DateTimeType, DateTimeType, StringType], ArrayType(TileFilingType), ($, start, end, what) => {
    const length = $.let(end.toEpochMilliseconds().subtract(start.toEpochMilliseconds()));
    const filed = $.let([], ArrayType(TileFilingType));
    for (const level of levels) {
      const startOf = $.const(tileStart(level));
      $.if(filed.size().equal(0n).and(() => length.lessEqual(SHORTEST_MS[level])), ($) => {
        $(filed.pushLast({ level: variant(level, null), tile: startOf(start) }));
      });
    }
    // Longer than a year: each year it touches, as many as MAX_EVENT_TILES.
    $.if(filed.size().equal(0n), ($) => {
      const yearOf = $.const(tileStart('year'));
      const nextYear = $.const(tileNext('year'));
      const at = $.let(yearOf(start));
      $.while(at.toEpochMilliseconds().less(end.toEpochMilliseconds()), ($) => {
        $.if(filed.size().greaterEqual(MAX_EVENT_TILES), ($) => {
          $.error(East.str`${what}, from ${East.print(start)} to ${East.print(end)}, ${tooLong}`);
        });
        $(filed.pushLast({ level: variant('year', null), tile: at }));
        $.assign(at, nextYear(at));
      });
    });
    return filed;
  });
}
