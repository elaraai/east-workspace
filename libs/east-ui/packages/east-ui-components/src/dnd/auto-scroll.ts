/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Auto-scroll for the drag layer (#608) — the scroll container under the
 * pointer, not the dragged element's own.
 *
 * dnd-kit scrolls the scroll containers the dragged element sits in. A card
 * dragged out of a Library onto a Plan sits in none that matter — the Plan's
 * body is not its ancestor — so a row below the fold could never be reached.
 * This scrolls whatever lies under the pointer instead: while the pointer
 * rests within {@link EDGE} px of a scroll container's edge, the container
 * scrolls toward that edge every frame, faster the nearer the pointer is, until
 * it can scroll no further (the next container out, then the page, takes over)
 * or the pointer moves away. After every step the layer reads the point again:
 * the content moved under a pointer that did not.
 *
 * @packageDocumentation
 */

/** The band along a container's edge, in px, where a resting pointer scrolls it. */
export const EDGE = 48;
/** px per frame at the very edge of the band. */
const MAX_SPEED = 18;
/** px per frame at the inner edge of the band. */
const MIN_SPEED = 3;

type Point = { x: number; y: number };
type Axis = "x" | "y";

/** The page's own scroller (absent in some environments — jsdom reports none). */
function page(): HTMLElement | null {
    return (document.scrollingElement as HTMLElement | null | undefined) ?? null;
}

/** Whether an element scrolls along an axis — it clips with a scrollbar, and has more to show. */
function scrolls(el: HTMLElement, axis: Axis): boolean {
    const more = axis === "x" ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight;
    if (!more) return false;
    if (el === page()) return true;
    const style = getComputedStyle(el);
    const overflow = axis === "x" ? style.overflowX : style.overflowY;
    return overflow === "auto" || overflow === "scroll";
}

/** The containers that scroll, from the element outward to the page. */
function containersFrom(start: Element | null): HTMLElement[] {
    const out: HTMLElement[] = [];
    const root = page();
    for (let n = start as HTMLElement | null; n !== null && n !== document.body && n !== root; n = n.parentElement) {
        if (scrolls(n, "x") || scrolls(n, "y")) out.push(n);
    }
    if (root !== null && (scrolls(root, "x") || scrolls(root, "y"))) out.push(root);
    return out;
}

/** How far an element can still scroll toward each edge. */
function room(el: HTMLElement): { up: boolean; down: boolean; left: boolean; right: boolean } {
    return {
        up: el.scrollTop > 0,
        down: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
        left: el.scrollLeft > 0,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    };
}

/** The speed a pointer `d` px inside the band scrolls at — 0 outside it. */
function speed(d: number): number {
    return d >= EDGE || d < 0 ? 0 : MIN_SPEED + (MAX_SPEED - MIN_SPEED) * (1 - d / EDGE);
}

/** The velocity a point gives a container: toward the edge it rests near, where the container can go. */
function velocity(el: HTMLElement, point: Point): Point {
    const r = el === page()
        ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
        : el.getBoundingClientRect();
    const can = room(el);
    const down = r.bottom - point.y;
    const up = point.y - r.top;
    const right = r.right - point.x;
    const left = point.x - r.left;
    const vy = can.down && speed(down) > 0 ? speed(down) : can.up && speed(up) > 0 ? -speed(up) : 0;
    const vx = can.right && speed(right) > 0 ? speed(right) : can.left && speed(left) > 0 ? -speed(left) : 0;
    return { x: vx, y: vy };
}

const frame = (fn: () => void): number =>
    typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number);
const cancelFrame = (id: number): void => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
    else clearTimeout(id);
};

/**
 * Scrolls the container under a resting pointer toward the edge it rests
 * near — see the module docs.
 */
export class EdgeScroller {
    private point: Point | undefined;
    private pending: number | undefined;
    private readonly onStep: () => void;

    /**
     * @param onStep - Called after every scroll step — the layer reads the point again
     */
    constructor(onStep: () => void) {
        this.onStep = onStep;
    }

    /**
     * The pointer moved: scroll while it rests within a container's edge band.
     *
     * @param point - Where the pointer is, in client px
     */
    update(point: Point): void {
        this.point = point;
        if (this.pending === undefined) this.tick();
    }

    /** The drag ended: stop scrolling. */
    stop(): void {
        if (this.pending !== undefined) cancelFrame(this.pending);
        this.pending = undefined;
        this.point = undefined;
    }

    private readonly tick = (): void => {
        this.pending = undefined;
        const point = this.point;
        if (point === undefined) return;
        for (const el of containersFrom(document.elementFromPoint(point.x, point.y))) {
            const v = velocity(el, point);
            if (v.x === 0 && v.y === 0) continue;
            el.scrollLeft += v.x;
            el.scrollTop += v.y;
            this.onStep();
            this.pending = frame(this.tick);
            return;
        }
        // Near no edge that can move: idle until the pointer moves again.
    };
}

/**
 * Scroll the nearest container of an element a step along an arrow key's axis
 * — a keyboard drag that found nothing that way on screen, so a virtualizer
 * mounts what lies beyond.
 *
 * @param from - The element the drag rests over
 * @param code - The arrow key's `code`
 */
export function scrollStep(from: Element, code: string): void {
    const axis: Axis = code === "ArrowLeft" || code === "ArrowRight" ? "x" : "y";
    const sign = code === "ArrowRight" || code === "ArrowDown" ? 1 : -1;
    const el = containersFrom(from).find((c) => scrolls(c, axis));
    if (el === undefined) return;
    if (axis === "x") el.scrollLeft += sign * Math.round(el.clientWidth * 0.6);
    else el.scrollTop += sign * Math.round(el.clientHeight * 0.6);
}
