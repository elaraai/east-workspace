/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The time tiles a series index and a summary index file a record's events by
 * (#1039): a day, an ISO week from Monday, a calendar month, a quarter or a
 * year, each in UTC and half-open, `[its start, the next tile's start)`.
 *
 * An event `[start, end)` touches every tile it overlaps, and covers the
 * milliseconds of each that it overlaps: its shares, which add up to its
 * length exactly. An instant — no end, or an end at or before its start —
 * touches the one tile holding it and covers none of it. The arithmetic is
 * Integer milliseconds and East's own calendar, so every runtime files an event
 * under the same tiles with the same shares, which is what lets a maintained
 * index equal its rebuild byte for byte.
 *
 * @packageDocumentation
 */
import { ArrayType, DateTimeType, East, IntegerType, StringType, StructType } from '@elaraai/east';

/** A tile's length: a day, an ISO week, a calendar month, a quarter or a year. */
export type RecordTile = 'day' | 'week' | 'month' | 'quarter' | 'year';

/** The tiles, from the shortest. */
export const RECORD_TILES: readonly RecordTile[] = ['day', 'week', 'month', 'quarter', 'year'];

/**
 * The most tiles one event may touch: one row of a series or a summary index
 * never writes more entries than this, whatever its span. An event touching
 * more is refused where it is written, naming it and the tile.
 */
export const MAX_EVENT_TILES = 4096n;

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
