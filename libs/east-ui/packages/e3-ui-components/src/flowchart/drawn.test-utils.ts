/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Where the Flowchart's canvas draws a flow, read from its drawing, for the
 * DOM tests. jsdom lays nothing out: the canvas measures 0×0, so its lanes
 * stand side by side from the left edge, as wide as `layout.ts` makes them,
 * and its states sit where it puts them — a card as tall as its details, where
 * they draw on the cards. A point a drag rests on, and a place a test expects,
 * is read from where the canvas draws its states, its lanes, their headers and
 * the "+ LANE" tail, so it holds whatever size the cards take.
 */

/** A point of the canvas, in its px. */
export interface Point {
    readonly x: number;
    readonly y: number;
}

/** A box the canvas draws, in its px. */
export interface Area {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

/** A row the canvas draws its states in: where it starts and ends, and its middle, where each of its cards' middles stands. */
export interface DrawnRow {
    readonly start: number;
    readonly end: number;
    readonly middle: number;
}

/** The states drawn, ghosts among them, in the order the canvas draws them. */
export const stateKeys = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll("[data-flowchart-node]")].map((el) => el.getAttribute("data-flowchart-node"));

/** A state's card, by its key. */
export const node = (c: HTMLElement, key: string): HTMLElement => c.querySelector<HTMLElement>(`[data-flowchart-node="${key}"]`)!;

/** An element's box, where its inline left, top, width and height place it. */
function placed(el: HTMLElement): Area {
    const { left, top, width, height } = el.style;
    return { x: parseFloat(left), y: parseFloat(top), w: parseFloat(width), h: parseFloat(height) };
}

/** An SVG rect's box. */
function rectOf(el: Element): Area {
    const at = (name: string): number => parseFloat(el.getAttribute(name)!);
    return { x: at("x"), y: at("y"), w: at("width"), h: at("height") };
}

/** A box's middle. */
export const middleOf = (area: Area): Point => ({ x: area.x + area.w / 2, y: area.y + area.h / 2 });

/** A state's card, where the canvas draws it. */
export const cardBox = (c: HTMLElement, key: string): Area => placed(node(c, key));

/** A state's middle, where a pointer rests on it. */
export const centreOf = (c: HTMLElement, key: string): Point => middleOf(cardBox(c, key));

/** The rows the canvas draws its states in, top to bottom: each as tall as its tallest card, each card standing in its middle. */
export function rowsOf(c: HTMLElement): DrawnRow[] {
    const rows = new Map<number, { readonly start: number; readonly end: number }>();
    for (const key of stateKeys(c)) {
        const card = cardBox(c, key!);
        const middle = card.y + card.h / 2;
        const row = rows.get(middle);
        rows.set(middle, { start: Math.min(row?.start ?? card.y, card.y), end: Math.max(row?.end ?? card.y + card.h, card.y + card.h) });
    }
    return [...rows].sort(([a], [b]) => a - b).map(([middle, row]) => ({ ...row, middle }));
}

/** The row a state is drawn in, from the first. */
export const rowOf = (c: HTMLElement, key: string): number => rowsOf(c).findIndex((row) => row.middle === centreOf(c, key).y);

/** Whether a state is drawn in another's lane, the next row down. */
export const drawnUnder = (c: HTMLElement, key: string, above: string): boolean =>
    centreOf(c, key).x === centreOf(c, above).x && rowOf(c, key) === rowOf(c, above) + 1;

/** A lane's band, where the canvas draws it: the box it tracks a pointer over, where the Flowchart takes a new state. */
export const bandOf = (c: HTMLElement, lane: string): Area => rectOf(c.querySelector(`[data-flowchart-band="${lane}"]`)!);

/** The lane a state is drawn in: the band its middle stands in. */
export function laneOf(c: HTMLElement, key: string): string | null {
    const { x } = centreOf(c, key);
    const band = [...c.querySelectorAll("[data-flowchart-band]")].find((el) => {
        const area = rectOf(el);
        return x >= area.x && x < area.x + area.w;
    });
    return band?.getAttribute("data-flowchart-band") ?? null;
}

/** A lane's header, where the canvas draws it: the strip across its band's top that a click lands on. */
export const headOf = (c: HTMLElement, lane: string): Area => rectOf(c.querySelector(`[data-flowchart-lane-head="${lane}"] > rect`)!);

// ── Points a drag rests on ──────────────────────────────────────────────

/**
 * Between two states, one row under the other: the middle of the gap between
 * their rows, at the upper's middle across — where the line from one to the
 * other passes, the two in one lane.
 */
export function between(c: HTMLElement, above: string, below: string): Point {
    const rows = rowsOf(c);
    return { x: centreOf(c, above).x, y: (rows[rowOf(c, above)]!.end + rows[rowOf(c, below)]!.start) / 2 };
}

/** Above a state's middle: its card's top, at its middle across. */
export const topOf = (c: HTMLElement, key: string): Point => ({ x: centreOf(c, key).x, y: cardBox(c, key).y });

/** The "+ LANE" tail, past the lanes: no lane. */
export const tail = (c: HTMLElement): Point => middleOf(placed(c.querySelector<HTMLElement>("[data-flowchart-addlane]")!));

/** A lane, under its last state. */
export function under(c: HTMLElement, lane: string): Point {
    const ends = stateKeys(c).filter((key) => laneOf(c, key!) === lane).map((key) => cardBox(c, key!).y + cardBox(c, key!).h);
    return { x: middleOf(bandOf(c, lane)).x, y: Math.max(...ends) + 8 };
}

/** A lane's header: its strip's middle. */
export const headerOf = (c: HTMLElement, lane: string): Point => middleOf(headOf(c, lane));

/** The gap before a lane: where its band starts, halfway down it. */
export const gapBefore = (c: HTMLElement, lane: string): Point => ({ x: bandOf(c, lane).x, y: middleOf(bandOf(c, lane)).y });
