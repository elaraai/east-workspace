/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `@elaraai/e3/internal` — the record tiles' East functions, for the packages
 * that check their own tiling against e3's (e3-ui's record bindings).
 *
 * Not an API for solutions, and not held stable: a solution files its events
 * through a record's indexes. The main entry builds none of the SDK's East
 * functions when it is imported (#1466); importing this entry builds these
 * four.
 *
 * @packageDocumentation
 */
import { TILE_FNS } from './record-tiles.js';

/** The start of the tile of a level holding an instant: `(level, at) → its start`. */
export const tileStart = TILE_FNS.tileStart;

/** The start of the tile after one, for a tile's start: `(level, start) → the next tile's start`. */
export const tileNext = TILE_FNS.tileNext;

/**
 * The tiles of a level an event touches, and its share of each:
 * `(level, start, end, what) → each tile it touches, in order, and the
 * milliseconds of it the event covers`.
 */
export const tileShares = TILE_FNS.tileShares;

/** Where a series index files an event: `(tile, start, end, what) → each place it is filed, in order`. */
export const eventFilings = TILE_FNS.eventFilings;
