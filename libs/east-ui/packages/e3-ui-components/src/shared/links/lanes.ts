/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Room for the links' lanes and captions (#1680's review, ruled 17 Nov 2026),
 * where a host lays its rows out for its links — the Plan's links focus.
 *
 * - **Lane bands.** A loopback's lane runs on the rule on its destination
 *   row's source-facing side (`geometry.ts`). Such a rule opens into a band
 *   of one track per lane, each `weight + 6` tall: the weight, its 1px casing
 *   either side and 2px clear either side. The band is its tracks' sum.
 * - **Tracks in order.** A band's tracks are ordered so no link's riser
 *   crosses another's lane where an order can keep them apart: the order of
 *   fewest crossings, the order given among equals.
 * - **Caption tracks.** A one-row link's caption — a feed's or a runoff's —
 *   takes a 14px track (its 12px knockout and 1 clear either side) in the
 *   band above its row, nearest the row: a 32px row has 5.5px above its bar
 *   and a 42px row 10.5px, so neither has room for the knockout inside it.
 * - **An S's caption** sits in the band its riser crosses nearest its
 *   mid-height ({@link sCaptionAt}), once the rows are laid out.
 *
 * A rule no lane and no caption uses stays a plain rule: no band. Rules are
 * named by the row below them: rule `r` lies above row `r`, and rule
 * `rows` below the last. Pure: no React, no DOM.
 *
 * @packageDocumentation
 */

import { LINK_KNOCKOUT_H } from "./look.js";
import { loopRisers, ribbonForward } from "./geometry.js";

/** What a lane's track takes beyond its weight: 1px of casing and 2px clear, either side (px). */
export const LANE_TRACK_PAD = 6;

/** A caption's track: its knockout and 1px clear either side (px). */
export const CAPTION_TRACK = LINK_KNOCKOUT_H + 2;

/** The most tracks a band's order is searched over whole; past it, the order given stands. */
const ORDER_SEARCH_MAX = 7;

/** A link as its bands are planned: its rows, by their place top to bottom, and its ends across the page. */
export interface PlannedLink {
    /** The source's row. */
    readonly from: number;
    /** The destination's row. */
    readonly to: number;
    /** The source's end, across the page. */
    readonly sourceEnd: number;
    /** The destination's start, across the page. */
    readonly destinationStart: number;
    /** Its weight: its stroke's width. */
    readonly weight: number;
    /** Whether it has a caption: a link with no quantity takes no caption track. */
    readonly captioned: boolean;
}

/** A track a band holds: the rule it opens, and its centre's place down the band, from the band's top. */
export interface LaneTrack {
    readonly rule: number;
    readonly centre: number;
}

/** The bands a host opens its rules into, and what each link takes of them. */
export interface LanePlan {
    /** Each opened rule's band, its height, by the rule. A rule left out stays a plain rule. */
    readonly bands: ReadonlyMap<number, number>;
    /** Each link's lane, for a loopback: its track. In the order given. */
    readonly lanes: readonly (LaneTrack | undefined)[];
    /** Each one-row link's caption track, for one with a caption. In the order given. */
    readonly captions: readonly (LaneTrack | undefined)[];
}

/** A loopback's lane as a band's order is searched: its link, its direction, and its risers. */
interface Lane {
    readonly link: number;
    /** Whether it runs down to its destination: its source's row above its band. */
    readonly down: boolean;
    readonly entry: number;
    readonly exit: number;
    readonly height: number;
}

/**
 * Where a lane at track `t` has its risers pass through: a lane running down
 * comes from above into its track and leaves it below; one running up comes
 * from below and leaves above. A riser passes through every track between.
 */
function risersThrough(lane: Lane, at: number, other: number): number[] {
    // `at` is this lane's track, `other` the track another lane's lane runs along.
    const passes: number[] = [];
    const exitFromAbove = lane.down;
    if (exitFromAbove ? other < at : other > at) passes.push(lane.exit);
    if (exitFromAbove ? other > at : other < at) passes.push(lane.entry);
    return passes;
}

/** How many times two lanes, at two tracks, have a riser cross the other's lane. */
function crossings(a: Lane, ta: number, b: Lane, tb: number): number {
    const inside = (x: number, lane: Lane) => x > lane.entry && x < lane.exit;
    return risersThrough(b, tb, ta).filter((x) => inside(x, a)).length
        + risersThrough(a, ta, tb).filter((x) => inside(x, b)).length;
}

/** Every order of `n` places, the order given first, in the order of a lexicographic walk. */
function* orders(n: number): Generator<number[]> {
    const order = Array.from({ length: n }, (_, i) => i);
    const walk = function* (k: number): Generator<number[]> {
        if (k === n) {
            yield [...order];
            return;
        }
        for (let i = k; i < n; i++) {
            [order[k], order[i]] = [order[i]!, order[k]!];
            yield* walk(k + 1);
            [order[k], order[i]] = [order[i]!, order[k]!];
        }
    };
    yield* walk(0);
}

/**
 * A band's lanes, top to bottom: the order whose risers cross the fewest
 * lanes, the order given first among equals.
 */
function ordered(lanes: readonly Lane[]): Lane[] {
    if (lanes.length < 2 || lanes.length > ORDER_SEARCH_MAX) return [...lanes];
    let best: number[] | undefined;
    let fewest = Infinity;
    for (const order of orders(lanes.length)) {
        let count = 0;
        for (let i = 0; i < order.length && count < fewest; i++) {
            for (let j = i + 1; j < order.length; j++) count += crossings(lanes[order[i]!]!, i, lanes[order[j]!]!, j);
        }
        if (count < fewest) {
            fewest = count;
            best = order;
            if (count === 0) break;
        }
    }
    return best!.map((i) => lanes[i]!);
}

/**
 * Plans the bands a host's rules open into for its links.
 *
 * @param rows - How many rows there are, top to bottom
 * @param links - The links whose two ends are on the rows, in drawing order
 * @returns The bands, by the rule each opens, and what each link takes of them
 */
export function planLanes(rows: number, links: readonly PlannedLink[]): LanePlan {
    const loops = new Map<number, Lane[]>();
    const captionsAt = new Map<number, number[]>();
    links.forEach((link, i) => {
        if (link.from < 0 || link.to < 0 || link.from >= rows || link.to >= rows) return;
        if (link.from === link.to) {
            // A feed or a runoff: its caption's track is in the band above its row.
            if (link.captioned) captionsAt.set(link.from, [...captionsAt.get(link.from) ?? [], i]);
            return;
        }
        if (ribbonForward(link.sourceEnd, link.destinationStart)) return;
        // A loopback: its lane on the destination row's source-facing rule.
        const down = link.from < link.to;
        const rule = down ? link.to : link.to + 1;
        const { entry, exit } = loopRisers(link.sourceEnd, link.destinationStart);
        loops.set(rule, [...loops.get(rule) ?? [], { link: i, down, entry, exit, height: link.weight + LANE_TRACK_PAD }]);
    });
    const bands = new Map<number, number>();
    const lanes: (LaneTrack | undefined)[] = links.map(() => undefined);
    const captions: (LaneTrack | undefined)[] = links.map(() => undefined);
    const rules = [...new Set([...loops.keys(), ...captionsAt.keys()])].sort((a, b) => a - b);
    for (const rule of rules) {
        let y = 0;
        // The lanes first, in the order that keeps their risers apart; the captions after them, nearest the row below.
        for (const lane of ordered(loops.get(rule) ?? [])) {
            lanes[lane.link] = { rule, centre: y + lane.height / 2 };
            y += lane.height;
        }
        for (const link of captionsAt.get(rule) ?? []) {
            captions[link] = { rule, centre: y + CAPTION_TRACK / 2 };
            y += CAPTION_TRACK;
        }
        bands.set(rule, y);
    }
    return { bands, lanes, captions };
}

/** A band as laid out: its top and its bottom, down the page. */
export interface LaidBand {
    readonly top: number;
    readonly bottom: number;
}

/**
 * Where an S's caption is centred, down the page: the middle of the band its
 * riser crosses nearest its mid-height — `undefined` where it crosses none,
 * and the caption stays on the riser at its mid-height.
 *
 * @param crossed - The bands between the S's two rows, as laid out
 * @param mid - The riser's mid-height
 * @returns The caption's centre
 */
export function sCaptionAt(crossed: readonly LaidBand[], mid: number): number | undefined {
    let best: number | undefined;
    for (const band of crossed) {
        if (!(band.bottom > band.top)) continue;
        const centre = (band.top + band.bottom) / 2;
        if (best === undefined || Math.abs(centre - mid) < Math.abs(best - mid)) best = centre;
    }
    return best;
}
