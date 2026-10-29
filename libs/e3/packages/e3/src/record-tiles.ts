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
 * Each is one East function, the tile an East value it is given
 * (`RecordLevelType`), and the arithmetic Integer milliseconds and East's own
 * calendar, so every runtime files an event alike, which is what lets a
 * maintained index equal its rebuild byte for byte.
 *
 * @packageDocumentation
 */
import { ArrayType, DateTimeType, East, FunctionType, IntegerType, OptionType, StringType, StructType, variant } from '@elaraai/east';
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

/** The most tiles, as a refusal names it. */
const MAX_TILES_TEXT = `${MAX_EVENT_TILES}`;
/** What a refusal says of an event split over too many tiles, after the tile's name. */
const TOO_MANY_TILES = ' tiles: declare a coarser tile';
/** What a refusal says of an event filed under too many years. */
const TOO_MANY_YEARS = `touches more than ${MAX_EVENT_TILES} year tiles: end it within ${MAX_EVENT_TILES} years of its start`;

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
 * The start of the tile of a level holding an instant: a day and a week
 * counted in whole milliseconds from midnight of the epoch and from the Monday
 * before it — whichever sign the runtime's remainder takes, so an instant
 * before 1970 is tiled as one after it — and a month, a quarter and a year by
 * East's calendar (`roundDownMonth`, `roundDownYear`).
 *
 * `(level, at) → the start of the tile holding it`
 */
export const tileStart = East.function([RecordLevelType, DateTimeType], DateTimeType, ($, level, at) => {
  const ms = $.let(at.toEpochMilliseconds());
  return level.match({
    day: () => East.DateTime.fromEpochMilliseconds(ms.subtract(ms.remainder(DAY_MS).add(DAY_MS).remainder(DAY_MS))),
    week: () => East.DateTime.fromEpochMilliseconds(ms.subtract(ms.subtract(MONDAY_MS).remainder(WEEK_MS).add(WEEK_MS).remainder(WEEK_MS))),
    month: () => East.DateTime.roundDownMonth(at, 1n),
    quarter: () => East.DateTime.roundDownMonth(at, 3n),
    year: () => East.DateTime.roundDownYear(at, 1n),
  });
});

/** `(start, months) → the start of the calendar month that many on`: January of the next year past December. */
const monthsOn = East.function([DateTimeType, IntegerType], DateTimeType, ($, start, months) => {
  const year = $.let(start.getYear());
  const month = $.let(start.getMonth().add(months));
  $.if(month.greater(12n), ($) => {
    $.assign(year, year.add(1n));
    $.assign(month, month.subtract(12n));
  });
  return East.DateTime.fromComponents(year, month, 1n, 0n, 0n, 0n, 0n);
});

/**
 * The start of the tile after one, for a tile's start.
 *
 * `(level, start) → the next tile's start`
 */
export const tileNext = East.function([RecordLevelType, DateTimeType], DateTimeType, ($, level, start) => {
  const calendar = $.const(monthsOn);
  return level.match({
    day: () => East.DateTime.fromEpochMilliseconds(start.toEpochMilliseconds().add(DAY_MS)),
    week: () => East.DateTime.fromEpochMilliseconds(start.toEpochMilliseconds().add(WEEK_MS)),
    month: () => calendar(start, 1n),
    quarter: () => calendar(start, 3n),
    year: () => calendar(start, 12n),
  });
});

/**
 * `(level, at) → a tile's start`: the type of {@link tileStart} and {@link
 * tileNext}, which a function given either takes.
 */
export const TileStepFnType = FunctionType([RecordLevelType, DateTimeType], DateTimeType);

/** `(level) → its name`, as a refusal names a tile. */
const levelName = East.function([RecordLevelType], StringType, (_$, level) => level.match({
  day: () => 'day', week: () => 'week', month: () => 'month', quarter: () => 'quarter', year: () => 'year',
}));

/**
 * The tiles of a level an event touches, and its share of each ({@link
 * tileShares}), given the functions that step through the tiles: a program
 * binding {@link tileStart} and {@link tileNext} once hands them to each
 * function that calls either.
 *
 * `(level, start, end, what, first, next) → each tile it touches, in order,
 * and the milliseconds of it the event covers`
 *
 * Throws an East runtime error when the event touches more than
 * {@link MAX_EVENT_TILES} tiles, naming `what`, its span and the tile.
 */
const tileSharesOver = East.function(
  [RecordLevelType, DateTimeType, DateTimeType, StringType, TileStepFnType, TileStepFnType], ArrayType(TileShareType),
  ($, level, start, end, what, first, next) => {
    const shares = $.let([], ArrayType(TileShareType));
    const from = $.let(start.toEpochMilliseconds());
    const to = $.let(end.toEpochMilliseconds());
    const at = $.let(first(level, start));
    // An instant: the tile holding it, none of it covered.
    $.if(to.lessEqual(from), ($) => {
      $(shares.pushLast({ tile: at, ms: 0n }));
      $.return(shares);
    });
    $.while(at.toEpochMilliseconds().less(to), ($) => {
      $.if(shares.size().greaterEqual(MAX_EVENT_TILES), ($) => {
        const name = $.const(levelName);
        $.error(East.str`${what}, from ${East.print(start)} to ${East.print(end)}, touches more than ${MAX_TILES_TEXT} ${name(level)}${TOO_MANY_TILES}`);
      });
      const after = $.let(next(level, at));
      const lo = $.let(at.toEpochMilliseconds().greater(from).ifElse(() => at.toEpochMilliseconds(), () => from));
      const hi = $.let(after.toEpochMilliseconds().less(to).ifElse(() => after.toEpochMilliseconds(), () => to));
      $(shares.pushLast({ tile: at, ms: hi.subtract(lo) }));
      $.assign(at, after);
    });
    return shares;
  },
);

/**
 * The tiles of a level an event touches, and its share of each (see the
 * module docs).
 *
 * `(level, start, end, what) → each tile it touches, in order, and the
 * milliseconds of it the event covers`: one tile, covered for none, when `end`
 * is at or before `start`. `what` names the event in a refusal.
 *
 * Throws an East runtime error when the event touches more than
 * {@link MAX_EVENT_TILES} tiles, naming `what`, its span and the tile.
 */
export const tileShares = East.function([RecordLevelType, DateTimeType, DateTimeType, StringType], ArrayType(TileShareType), ($, level, start, end, what) => {
  const first = $.const(tileStart);
  const next = $.const(tileNext);
  return tileSharesOver(level, start, end, what, first, next);
});

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

/** `(level) → its shortest tile, in milliseconds` ({@link SHORTEST_MS}). */
const shortestMs = East.function([RecordLevelType], IntegerType, (_$, level) => level.match({
  day: () => SHORTEST_MS.day, week: () => SHORTEST_MS.week, month: () => SHORTEST_MS.month, quarter: () => SHORTEST_MS.quarter, year: () => SHORTEST_MS.year,
}));

/** The levels, from the finest. */
const LEVELS = [variant('day', null), variant('week', null), variant('month', null), variant('quarter', null), variant('year', null)];

/**
 * Where a series index files an event (see the module docs), given the
 * functions that step through the tiles ({@link tileSharesOver}'s): once, at
 * the finest level from the index's tile up whose shortest tile
 * ({@link SHORTEST_MS}) holds its length, under the tile of that level holding
 * its start; past a year, under each year it touches.
 *
 * `(tile, start, end, what, startOf, nextOf) → each place it is filed, in
 * order`: an instant — `end` at or before `start` — at `tile`. `what` names
 * the event in a refusal, as {@link tileShares}' does.
 *
 * Throws an East runtime error when an event longer than a year touches more
 * than {@link MAX_EVENT_TILES} years, naming `what` and its span.
 */
const eventFilingsOver = East.function(
  [RecordLevelType, DateTimeType, DateTimeType, StringType, TileStepFnType, TileStepFnType], ArrayType(TileFilingType),
  ($, tile, start, end, what, startOf, nextOf) => {
    const shortest = $.const(shortestMs);
    const levels = $.const(LEVELS, ArrayType(RecordLevelType));
    const length = $.let(end.toEpochMilliseconds().subtract(start.toEpochMilliseconds()));
    const filed = $.let([], ArrayType(TileFilingType));
    // The levels from the index's tile up, the first whose shortest tile holds the event.
    const reached = $.let(false);
    $.for(levels, ($, level) => {
      $.if(East.equal(level, tile), ($) => { $.assign(reached, true); });
      $.if(reached.and(() => filed.size().equal(0n)).and(() => length.lessEqual(shortest(level))), ($) => {
        $(filed.pushLast({ level, tile: startOf(level, start) }));
      });
    });
    // Longer than a year: each year it touches, as many as MAX_EVENT_TILES.
    $.if(filed.size().equal(0n), ($) => {
      const year = $.const(variant('year', null), RecordLevelType);
      const at = $.let(startOf(year, start));
      $.while(at.toEpochMilliseconds().less(end.toEpochMilliseconds()), ($) => {
        $.if(filed.size().greaterEqual(MAX_EVENT_TILES), ($) => {
          $.error(East.str`${what}, from ${East.print(start)} to ${East.print(end)}, ${TOO_MANY_YEARS}`);
        });
        $(filed.pushLast({ level: year, tile: at }));
        $.assign(at, nextOf(year, at));
      });
    });
    return filed;
  },
);

/**
 * Where a series index files an event: {@link eventFilingsOver}, its tiles
 * stepped through by {@link tileStart} and {@link tileNext}.
 *
 * `(tile, start, end, what) → each place it is filed, in order`
 */
export const eventFilings = East.function([RecordLevelType, DateTimeType, DateTimeType, StringType], ArrayType(TileFilingType), ($, tile, start, end, what) => {
  const startOf = $.const(tileStart);
  const nextOf = $.const(tileNext);
  return eventFilingsOver(tile, start, end, what, startOf, nextOf);
});

/**
 * The places an event is filed ({@link eventFilingsOver}) — a series index's, a nested one's item's: none for an
 * event with no start; one with no end is an instant.
 *
 * `(tile, start, end, what, startOf, nextOf) → each place it is filed, in order`
 */
export const placedFilingsOver = East.function(
  [RecordLevelType, OptionType(DateTimeType), OptionType(DateTimeType), StringType, TileStepFnType, TileStepFnType], ArrayType(TileFilingType),
  ($, tile, start, end, what, startOf, nextOf) => {
    $.match(start, {
      some: ($, from) => { $.return(eventFilingsOver(tile, from, end.unwrap('some', () => from), what, startOf, nextOf)); },
      none: () => {},
    });
    return [];
  },
);

/**
 * The places an event is filed — a series index's, a nested one's item's: none
 * for an event with no start; one with no end is an instant ({@link
 * placedFilingsOver}, stepping by {@link tileStart} and {@link tileNext}).
 *
 * `(tile, start, end, what) → each place it is filed, in order`
 */
export const placedFilings = East.function(
  [RecordLevelType, OptionType(DateTimeType), OptionType(DateTimeType), StringType], ArrayType(TileFilingType),
  ($, tile, start, end, what) => {
    const startOf = $.const(tileStart);
    const nextOf = $.const(tileNext);
    return placedFilingsOver(tile, start, end, what, startOf, nextOf);
  },
);

/**
 * The tiles an event touches, and its share of each ({@link tileSharesOver}) — a summary's, a nested index's totals':
 * none for an event with no start; one with no end is an instant.
 *
 * `(tile, start, end, what, first, next) → each tile it touches, in order, and the milliseconds of it the event covers`
 */
export const placedSharesOver = East.function(
  [RecordLevelType, OptionType(DateTimeType), OptionType(DateTimeType), StringType, TileStepFnType, TileStepFnType], ArrayType(TileShareType),
  ($, tile, start, end, what, first, next) => {
    $.match(start, {
      some: ($, from) => { $.return(tileSharesOver(tile, from, end.unwrap('some', () => from), what, first, next)); },
      none: () => {},
    });
    return [];
  },
);

/**
 * The tiles an event touches, and its share of each — a summary's, a nested
 * index's totals': none for an event with no start; one with no end is an
 * instant ({@link placedSharesOver}, stepping by {@link tileStart} and {@link
 * tileNext}).
 *
 * `(tile, start, end, what) → each tile it touches, in order, and the milliseconds of it the event covers`
 */
export const placedShares = East.function(
  [RecordLevelType, OptionType(DateTimeType), OptionType(DateTimeType), StringType], ArrayType(TileShareType),
  ($, tile, start, end, what) => {
    const first = $.const(tileStart);
    const next = $.const(tileNext);
    return placedSharesOver(tile, start, end, what, first, next);
  },
);
