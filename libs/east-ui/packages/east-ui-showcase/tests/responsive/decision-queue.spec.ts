/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The DecisionQueue on the real in-page e3 (`Decision Queue Spec.md` §15), in
 * both themes, over its examples' cases — the mock's own:
 *
 * - **Anchoring** (R8–R13), watched frame by frame from each gesture until the
 *   list has held still: a head's top within 1px across an open that closes
 *   the card above it, a close of an open head stuck to the list's top, an
 *   open, Apply — its receipt 40px, standing where the head stood — the
 *   receipt's Undo, a `j` and an Escape; the open card's head stuck to the
 *   list's top over its body; and under reduced motion no animation and no
 *   transition, the anchoring kept.
 * - **Looks** (§8, P2, P13, P14, P21, R25): the card closed and open, its head
 *   and its chip, the receipt and the marks over the previews, computed in the
 *   theme against its tokens; and each preview kind's height and frame, swept
 *   through the previews gallery.
 * - **Narrow hosts** (R30): the same queue in a 360px parent and a 294px one,
 *   and the phone example in its own box — one column, nothing sideways, the
 *   count kept and the past-due count its short form, or in the 294px parent,
 *   at the row's floor, its clock and its number, its words said — and on a
 *   coarse pointer each control of the open card a 44px target by its box or
 *   its halo.
 *
 * The toolbar at every width, its 28px controls and the footer's line are the
 * shared sweeps', which list the queue beside the builders
 * (`toolbar-fit.spec.ts`, `toolbar-row-heights.spec.ts`,
 * `builder-footer-line.spec.ts`).
 *
 * Run: `pnpm exec playwright test decision-queue`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { steadyRing } from "./optimise-eye";
import { settled } from "./settle";
import { token } from "./tokens";

/** The full queue: the mock's nine cases and its three routine ones. */
const OPS = "e3/decision/decision/decisionQueueOps";
/** The previews gallery: a case for each preview kind and mark. */
const PREVIEWS = "e3/decision/decision/decisionQueuePreviews";
/** The full queue in a phone-width box. */
const PHONE = "e3/decision/decision/decisionQueuePhone";
/** The queue's root, in its entry. */
const ROOT = "[data-decision-queue]";

/** The Roster's case, the first waiting and open as the queue opens. */
const ROTA = "rota-tansy";
/** The Plan's case under it, whose Apply waits on no answer. */
const PRINT = "print-j3007";
/** The first case due today, the next card after the Plan's. */
const YARD = "yard-ld2235";

/** The page: tall enough that an example's 760px box shows whole beside the showcase's chrome. */
const PAGE = { width: 1600, height: 1200 } as const;

/**
 * How many frames a watched part holds still before the list is at rest: half a second at the display's rate, past a
 * hold's 200 ms wait before it settles and the 200 ms of its glide.
 */
const REST_FRAMES = 30;

/** Each preview kind's height, px (P2): the builders' crops and maps and the zones 120, a projection 116, the rest 112. */
const PREVIEW_HEIGHT: Readonly<Record<string, number>> = {
    roster: 120, plan: 120, calendar: 120, allocation: 120, zones: 120, projection: 116, sheet: 112, record: 112,
};

/** The themes each check runs in. */
const THEMES = ["light", "dark"] as const;

/** A case's card, its head and its receipt, by its key. */
const card = (key: string) => `[data-decision-card="${key}"]`;
const head = (key: string) => `[data-decision-head="${key}"]`;
const receipt = (key: string) => `[data-decision-receipt="${key}"]`;
/** A card's Apply: the last of its Decide group's buttons. */
const applyOf = (key: string) => `${card(key)} [role="group"][aria-label="Decide"] > button:last-child`;

/** A part of the queue as the list shows it: its top, px below the list's top, and its height. */
interface At {
    readonly top: number;
    readonly height: number;
}

/** Each frame a watcher saw something move in: each watched part where it stood, `null` where it was not drawn. */
type Frames = readonly (readonly (At | null)[])[];

/** The page's name for the watcher a gesture's frames are recorded under. */
const WATCHER = "__decisionQueueWatcher";

/** The queue's root in its entry. */
function queueOf(entry: Locator): Locator {
    return entry.locator(ROOT).first();
}

/**
 * Where a part of the queue stands now.
 *
 * @param entry - The example's entry
 * @param selector - The part, in the queue
 * @returns Its top below the list's top and its height; `null` while it is not drawn
 */
function partAt(entry: Locator, selector: string): Promise<At | null> {
    return queueOf(entry).evaluate((root, selector) => {
        const el = root.querySelector(selector);
        if (el === null) return null;
        const list = root.querySelector("[data-decision-list]")!.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        return { top: b.top - list.top, height: b.height };
    }, selector);
}

/**
 * Scrolls the list until a part of it stands `at` px below the list's top — on down while it is not drawn — as a
 * viewer's wheel scrolls it, and lets the rows it brings in mount.
 *
 * @param entry - The example's entry
 * @param selector - The part, in the queue
 * @param at - Where it is to stand, px below the list's top
 * @returns Where it stands then
 */
function place(entry: Locator, selector: string, at: number): Promise<number> {
    return queueOf(entry).evaluate(async (root, { selector, at }) => {
        const list = root.querySelector<HTMLElement>("[data-decision-list]")!;
        const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const top = () => {
            const el = root.querySelector(selector);
            return el === null ? undefined : el.getBoundingClientRect().top - list.getBoundingClientRect().top;
        };
        for (let tries = 0; tries < 40; tries++) {
            const now = top();
            if (now !== undefined && Math.abs(now - at) < 0.5) return now;
            list.scrollTop += now === undefined ? list.clientHeight / 2 : now - at;
            await frames();
        }
        return top() ?? Number.NaN;
    }, { selector, at });
}

/**
 * Scrolls the list by the least that shows a part of it whole, 12px clear of the list's bottom.
 *
 * @param entry - The example's entry
 * @param selector - The part, in the queue
 */
function showWhole(entry: Locator, selector: string): Promise<void> {
    return queueOf(entry).evaluate(async (root, selector) => {
        const list = root.querySelector<HTMLElement>("[data-decision-list]")!;
        const el = root.querySelector(selector);
        if (el === null) throw new Error(`${selector} is not drawn`);
        const bottom = list.getBoundingClientRect().top + list.clientHeight - 12;
        const b = el.getBoundingClientRect();
        if (b.bottom > bottom) list.scrollTop += b.bottom - bottom;
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }, selector);
}

/**
 * Watches where parts of the queue stand from just before a gesture until each has held still {@link REST_FRAMES}
 * frames: every frame in which one moved, came or went.
 *
 * @param page - The page
 * @param entry - The example's entry
 * @param selectors - The parts, in the queue
 * @param gesture - What the viewer does
 * @returns Each frame that moved something, the first as the gesture found them
 */
async function watch(page: Page, entry: Locator, selectors: readonly string[], gesture: () => Promise<void>): Promise<Frames> {
    await queueOf(entry).evaluate((root, { selectors, name }) => {
        const list = root.querySelector("[data-decision-list]")!;
        const round = (n: number) => Math.round(n * 10) / 10;
        const frames: ({ top: number; height: number } | null)[][] = [];
        let last = "";
        let still = 0;
        let on = true;
        const read = () => selectors.map((selector) => {
            const el = root.querySelector(selector);
            if (el === null) return null;
            const b = el.getBoundingClientRect();
            return { top: round(b.top - list.getBoundingClientRect().top), height: round(b.height) };
        });
        const tick = () => {
            if (!on) return;
            const frame = read();
            const said = JSON.stringify(frame);
            if (said === last) still += 1;
            else { frames.push(frame); last = said; still = 0; }
            requestAnimationFrame(tick);
        };
        tick();
        (window as unknown as Record<string, unknown>)[name] = { frames, still: () => still, done: () => { still = 0; }, stop: () => { on = false; } };
    }, { selectors, name: WATCHER });
    await gesture();
    // At rest from here on: the frames counted still before the gesture's last step landed are not its.
    await page.evaluate((name) => (window as unknown as Record<string, { done: () => void }>)[name]!.done(), WATCHER);
    await expect.poll(() => page.evaluate((name) => (window as unknown as Record<string, { still: () => number }>)[name]!.still(), WATCHER), {
        message: "the queue came to rest after the gesture",
        timeout: 15_000,
    }).toBeGreaterThanOrEqual(REST_FRAMES);
    return page.evaluate((name) => {
        const watcher = (window as unknown as Record<string, { frames: Frames; stop: () => void }>)[name]!;
        watcher.stop();
        return watcher.frames;
    }, WATCHER);
}

/**
 * Holds a watched part to where it stood: its top within 1px of `at` in every frame that drew it.
 *
 * @param frames - What the watcher saw
 * @param index - The part, by its place among the watched
 * @param at - Where it stood, px below the list's top
 * @param what - The part, for the failure
 */
function expectHeld(frames: Frames, index: number, at: number, what: string): void {
    const tops = frames.map((frame) => frame[index]).filter((part): part is At => part !== null && part !== undefined).map((part) => part.top);
    expect(tops.length, `${what}: drawn`).toBeGreaterThan(0);
    expect(tops.filter((top) => Math.abs(top - at) > 1), `${what}: its top, frame by frame, against ${at.toFixed(1)} — ${tops.join(" ")}`).toEqual([]);
}

/**
 * Presses a case's head as a pointer does, where the list shows it: at a point on its middle line that the page hands
 * the head — never a sticky head drawn over it — and no control in it. Nothing scrolls first.
 *
 * @param page - The page
 * @param entry - The example's entry
 * @param key - The case
 */
async function pressHead(page: Page, entry: Locator, key: string): Promise<void> {
    const point = await queueOf(entry).evaluate((root, selector) => {
        const el = root.querySelector(selector);
        if (el === null) return null;
        const view = root.querySelector("[data-decision-list]")!.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        const x = b.left + b.width / 2;
        for (let y = Math.max(b.top, view.top) + 4; y < Math.min(b.bottom, view.bottom) - 2; y += 4) {
            const hit = document.elementFromPoint(x, y);
            if (hit !== null && el.contains(hit) && hit.closest("button, a, input, label") === null) return { x, y };
        }
        return null;
    }, head(key));
    expect(point, `${key}'s head takes the pointer where the list shows it`).not.toBeNull();
    await page.mouse.click(point!.x, point!.y);
}

/**
 * Presses a control as a pointer does, at its centre, which must take the pointer. Nothing scrolls first.
 *
 * @param page - The page
 * @param control - The control
 */
async function press(page: Page, control: Locator): Promise<void> {
    const point = await control.evaluate((el) => {
        const b = el.getBoundingClientRect();
        const x = b.left + b.width / 2;
        const y = b.top + b.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { x, y, takes: hit !== null && el.contains(hit) };
    });
    expect(point.takes, "the control takes the pointer at its centre").toBe(true);
    await page.mouse.click(point.x, point.y);
}

/**
 * Points at a receipt once it has arrived — it arrives from its card's height to its own — so it stays while the
 * checks look (R27).
 *
 * @param page - The page
 * @param shown - The receipt
 */
async function pointAt(page: Page, shown: Locator): Promise<void> {
    const point = await shown.evaluate(async (el) => {
        await Promise.all(el.getAnimations().map((animation) => animation.finished.then(() => undefined, () => undefined)));
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 3, y: b.top + b.height / 2 };
    });
    await page.mouse.move(point.x, point.y);
}

/**
 * A theme radius as the page resolves it.
 *
 * @param page - The page
 * @param name - The radius token, after `--chakra-radii-` (`md`)
 * @returns Its computed radius
 */
function radius(page: Page, name: string): Promise<string> {
    return page.evaluate((n) => {
        const probe = document.createElement("span");
        probe.style.borderRadius = `var(--chakra-radii-${n})`;
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).borderTopLeftRadius;
        probe.remove();
        return value;
    }, name);
}

/**
 * A toolbar item's words as the row shows it.
 *
 * @param entry - The example's entry
 * @param item - The item's key
 * @param part - The part of it whose words are read
 * @returns A locator over them
 */
function rowItem(entry: Locator, item: string, part: string): Locator {
    return queueOf(entry).locator(`[data-frame-slot='toolbar'] [data-toolbar] > [data-toolbar-item='${item}'] ${part}`).first();
}

/** Waits until every preview the list has drawn has read its rows. */
async function previewsRead(entry: Locator): Promise<void> {
    await expect.poll(() => queueOf(entry).evaluate((root) => root.querySelectorAll("[data-decision-list] [data-decision-preview][aria-busy='true']").length), {
        message: "the previews drawn read their rows",
        timeout: 30_000,
    }).toBe(0);
}

/** The marks' looks as the page resolves them in the theme. */
interface MarkLook {
    /** The steady glow (P13), and inset on a cell. */
    readonly ring: string;
    readonly inset: string;
    /** The proposal's fill on an entry with none of its own, `brandTint`. */
    readonly tint: string;
    /** A ghost's dashed edge (P14), `elara.edge`. */
    readonly edge: string;
    /** A stale proposal's dashed edge, fill and words (P21). */
    readonly staleEdge: string;
    readonly staleFill: string;
}

/** The marks' looks in the page's theme. */
async function markLook(page: Page): Promise<MarkLook> {
    return {
        ring: await steadyRing(page, false),
        inset: await steadyRing(page, true),
        tint: await token(page, "brand-tint"),
        edge: await token(page, "elara-edge"),
        staleEdge: await token(page, "fg-subtle"),
        staleFill: await token(page, "bg-subtle"),
    };
}

/**
 * Each mark over the previews the list has drawn that is not drawn as its mark is (P13, P14, P21): a proposed entry's
 * glow — inset on a cell — and fill, unless it keeps its own; a ghost's dashed edge, unfilled, unlit; a stale preview's
 * proposal dashed on its paper, unlit.
 *
 * @param entry - The example's entry
 * @param want - The marks' looks in the theme
 * @returns Each fault, in words; none when every mark holds
 */
function markFaults(entry: Locator, want: MarkLook): Promise<string[]> {
    return queueOf(entry).evaluate((root, want) => {
        const faults: string[] = [];
        for (const preview of root.querySelectorAll("[data-decision-list] [data-decision-preview]")) {
            const stale = preview.hasAttribute("data-stale");
            const key = preview.closest("[data-decision-card]")?.getAttribute("data-decision-card") ?? "?";
            for (const el of preview.querySelectorAll("[data-op]")) {
                if (!(el instanceof HTMLElement)) continue;
                const s = getComputedStyle(el);
                const op = el.getAttribute("data-op");
                const fill = el.getAttribute("data-fill");
                const name = `${key}: ${op}${fill === null ? "" : `/${fill}`} '${(el.textContent ?? "").trim().slice(0, 24)}'`;
                const edge = [s.borderTopWidth, s.borderTopStyle, s.borderTopColor].join(" ");
                if (op === "add" || op === "chg") {
                    if (stale) {
                        if (edge !== `1px dashed ${want.staleEdge}`) faults.push(`${name}: stale, its edge ${edge}`);
                        if (s.backgroundColor !== want.staleFill) faults.push(`${name}: stale, its fill ${s.backgroundColor}`);
                        if (s.boxShadow !== "none") faults.push(`${name}: stale, yet lit ${s.boxShadow}`);
                    } else {
                        const ring = fill === "cell" ? want.inset : want.ring;
                        if (s.boxShadow !== ring) faults.push(`${name}: its glow ${s.boxShadow}, not ${ring}`);
                        if (fill !== "own" && s.backgroundColor !== want.tint) faults.push(`${name}: its fill ${s.backgroundColor}, not ${want.tint}`);
                    }
                } else if (op === "from" || op === "del") {
                    if (edge !== `1px dashed ${want.edge}`) faults.push(`${name}: its ghost's edge ${edge}`);
                    if (s.backgroundColor !== "rgba(0, 0, 0, 0)") faults.push(`${name}: its ghost filled ${s.backgroundColor}`);
                    if (s.boxShadow !== "none") faults.push(`${name}: its ghost lit ${s.boxShadow}`);
                }
            }
        }
        return faults;
    }, want);
}

/** A preview as the page draws it. */
interface PreviewLook {
    /** Its case. */
    readonly key: string;
    readonly kind: string;
    readonly stale: boolean;
    readonly height: number;
    /** Its frame: its edge's width, style and colour, its radius and its paper. */
    readonly edge: string;
    readonly radius: string;
    readonly background: string;
    /** Whether it lies inside its head's content box. */
    readonly inHead: boolean;
}

/**
 * Every preview the list has drawn, as the page draws it.
 *
 * @param entry - The example's entry
 * @returns Each preview's look
 */
function previewLooks(entry: Locator): Promise<PreviewLook[]> {
    return queueOf(entry).evaluate((root) => [...root.querySelectorAll<HTMLElement>("[data-decision-list] [data-decision-preview]")].map((preview) => {
        const s = getComputedStyle(preview);
        const b = preview.getBoundingClientRect();
        const headEl = preview.closest("[data-decision-head]");
        const hs = headEl === null ? undefined : getComputedStyle(headEl);
        const h = headEl?.getBoundingClientRect();
        const inHead = hs !== undefined && h !== undefined
            && b.left >= h.left + Number.parseFloat(hs.paddingLeft) - 0.5 && b.right <= h.right - Number.parseFloat(hs.paddingRight) + 0.5;
        return {
            key: preview.closest("[data-decision-card]")?.getAttribute("data-decision-card") ?? "?",
            kind: preview.getAttribute("data-kind") ?? "?",
            stale: preview.hasAttribute("data-stale"),
            height: Math.round(b.height * 10) / 10,
            edge: [s.borderTopWidth, s.borderTopStyle, s.borderTopColor].join(" "),
            radius: s.borderTopLeftRadius,
            background: s.backgroundColor,
            inHead,
        };
    }));
}

/**
 * Sweeps the list from its top to its end, a part of a view at a time, reading each preview it draws once its rows are
 * read, and each mark over them.
 *
 * @param page - The page
 * @param entry - The example's entry
 * @param want - The marks' looks in the theme
 * @returns Each case's preview, and each mark's fault
 */
async function sweepPreviews(page: Page, entry: Locator, want: MarkLook): Promise<{ looks: Map<string, PreviewLook>; faults: string[] }> {
    const looks = new Map<string, PreviewLook>();
    const faults = new Set<string>();
    const list = queueOf(entry).locator("[data-decision-list]");
    await list.evaluate((el) => { el.scrollTop = 0; });
    for (let step = 0; step < 60; step++) {
        await settled(page);
        await previewsRead(entry);
        for (const look of await previewLooks(entry)) looks.set(look.key, look);
        for (const fault of await markFaults(entry, want)) faults.add(fault);
        const end = await list.evaluate((el) => {
            const from = el.scrollTop;
            el.scrollTop = from + el.clientHeight * 0.75;
            return el.scrollTop === from;
        });
        if (end) break;
    }
    return { looks, faults: [...faults] };
}

/**
 * What is wrong with the queue at a narrow width (R30): the list scrolling sideways; a section, card, receipt or the
 * Routine band past the list's sides, or a card out of the one column; a part of a card — a preview's own parts
 * apart, its crop being its own — past the card's sides; and, on a fine pointer, a part whose content runs past its
 * box (a coarse pointer's halos reach past their controls by design, never moving one).
 *
 * @param entry - The example's entry
 * @param fine - Whether the pointer is fine: a part's content is held to its box
 * @returns Each fault, in words; none when the queue holds
 */
function narrowFaults(entry: Locator, fine: boolean): Promise<string[]> {
    return queueOf(entry).evaluate((root, fine) => {
        const faults: string[] = [];
        const list = root.querySelector<HTMLElement>("[data-decision-list]");
        if (list === null) return ["no list"];
        if (list.scrollWidth > list.clientWidth + 1) faults.push(`the list scrolls sideways: ${list.scrollWidth}px in ${list.clientWidth}px`);
        const box = list.getBoundingClientRect();
        const right = box.left + list.clientWidth;
        const named = (el: Element) => {
            const key = el.getAttribute("data-decision-card") ?? el.getAttribute("data-decision-receipt") ?? el.getAttribute("data-decision-section");
            return key === null ? el.tagName.toLowerCase() : key;
        };
        for (const row of list.querySelectorAll("[data-decision-section], [data-decision-card], [data-decision-receipt], [data-decision-routine]")) {
            const b = row.getBoundingClientRect();
            if (b.left < box.left - 0.5 || b.right > right + 0.5) faults.push(`${named(row)} runs past the list: ${b.left.toFixed(1)}–${b.right.toFixed(1)} in ${box.left.toFixed(1)}–${right.toFixed(1)}`);
        }
        const cards = [...list.querySelectorAll("[data-decision-card]")];
        const first = cards[0]?.getBoundingClientRect();
        for (const cardEl of cards) {
            const c = cardEl.getBoundingClientRect();
            if (first !== undefined && (Math.abs(c.left - first.left) > 0.5 || Math.abs(c.width - first.width) > 0.5)) {
                faults.push(`${named(cardEl)} is out of the one column: ${c.left.toFixed(1)} +${c.width.toFixed(1)}`);
            }
            for (const el of cardEl.querySelectorAll("*")) {
                if (!(el instanceof HTMLElement) || el.parentElement?.closest("[data-decision-preview]") != null) continue;
                const b = el.getBoundingClientRect();
                if (b.width === 0 || b.height === 0) continue;
                const what = `${named(cardEl)}: ${el.tagName.toLowerCase()} '${(el.textContent ?? "").trim().slice(0, 24)}'`;
                if (b.left < c.left - 0.5 || b.right > c.right + 0.5) faults.push(`${what} past the card's sides: ${b.left.toFixed(1)}–${b.right.toFixed(1)} in ${c.left.toFixed(1)}–${c.right.toFixed(1)}`);
                if (!fine || el.hasAttribute("data-decision-preview")) continue;
                const s = getComputedStyle(el);
                if (s.overflowX !== "visible" || s.textOverflow === "ellipsis" || el.clientWidth === 0) continue;
                if (el.scrollWidth > el.clientWidth + 1) faults.push(`${what}: its content runs ${el.scrollWidth - el.clientWidth}px past its box`);
            }
        }
        return faults;
    }, fine);
}

/**
 * Each control of the open card that is no 44px target on a coarse pointer (R30): its box, or its halo — the
 * absolutely placed `::before` or `::after` the shared hit area draws under `_coarse` — under 44px either way.
 *
 * @param entry - The example's entry
 * @returns Each fault, in words; none when every control is a 44px target
 */
function targetFaults(entry: Locator): Promise<string[]> {
    return queueOf(entry).evaluate((root) => {
        const open = root.querySelector("[data-decision-card][data-open]");
        if (open === null) return ["no card open"];
        const faults: string[] = [];
        for (const el of open.querySelectorAll<HTMLElement>("button, [role='option'], [role='radio'], label, a[href]")) {
            const b = el.getBoundingClientRect();
            if (b.width < 2 || b.height < 2) continue;
            let width = b.width;
            let height = b.height;
            for (const pseudo of ["::before", "::after"]) {
                const halo = getComputedStyle(el, pseudo);
                if (halo.content === "none" || halo.position !== "absolute") continue;
                width = Math.max(width, Number.parseFloat(halo.width) || 0);
                height = Math.max(height, Number.parseFloat(halo.height) || 0);
            }
            if (width < 43.5 || height < 43.5) {
                const role = el.getAttribute("role");
                const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24);
                faults.push(`${el.tagName.toLowerCase()}${role === null ? "" : `[${role}]`} '${name}': ${width.toFixed(1)} × ${height.toFixed(1)}`);
            }
        }
        return faults;
    });
}

/** Where the past-due count stands in a narrow row (R30): its short form, `2 late`, or at the row's floor its clock and its number. */
type LateForm = "short" | "floor";

/** The past-due count as the row shows it. */
interface LateLook {
    /** The toolbar's form of it: `1` its short form, `2` its clock and its number. */
    readonly form: string | null;
    /** Whether its clock is drawn. */
    readonly clock: boolean;
    /** The words drawn, and the words a screen reader hears: what no `aria-hidden` part holds. */
    readonly shown: string;
    readonly said: string;
    /** What a hover says. */
    readonly title: string | null;
}

/**
 * The past-due count as the row shows it.
 *
 * @param entry - The example's entry
 * @returns Its form, its clock, the words it draws and says, and its hover's
 */
function lateLook(entry: Locator): Promise<LateLook> {
    return queueOf(entry).locator("[data-frame-slot='toolbar'] [data-toolbar] > [data-toolbar-item='decision.late']").first().evaluate((item) => {
        const late = item.querySelector<HTMLElement>("[data-decision-late]");
        const shown: string[] = [];
        const said: string[] = [];
        if (late !== null) {
            const walker = document.createTreeWalker(late, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
                const parent = node.parentElement!;
                const hider = parent.closest("[aria-hidden='true']");
                if (hider === null || !late.contains(hider)) said.push(node.textContent ?? "");
                // What a screen reader alone hears is drawn a pixel square, clipped.
                if (parent.getBoundingClientRect().width > 1) shown.push(node.textContent ?? "");
            }
        }
        const clock = late?.querySelector("svg[data-icon='clock']");
        return {
            form: item.getAttribute("data-toolbar-form"),
            clock: clock != null && clock.getBoundingClientRect().width > 0,
            shown: shown.join("").trim(),
            said: said.join("").trim(),
            title: late?.getAttribute("title") ?? null,
        };
    });
}

/**
 * Holds the queue at a narrow width to R30: one column and nothing sideways, the count kept, the past-due count its
 * short form or at the row's floor its clock and its number, its words said and on hover, and on a coarse pointer the
 * open card's controls 44px targets.
 *
 * @param page - The page
 * @param entry - The example's entry
 * @param late - Where the past-due count stands, and its number
 * @param where - The width, for the failures
 */
async function expectNarrow(page: Page, entry: Locator, late: { readonly form: LateForm; readonly n: string }, where: string): Promise<void> {
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    expect(await narrowFaults(entry, !coarse), where).toEqual([]);
    await expect(rowItem(entry, "decision.title", "[data-decision-count]"), `${where}: the count stays`).toHaveText(/^\d+$/u);
    const want: LateLook = late.form === "short"
        ? { form: "1", clock: false, shown: `${late.n} late`, said: `${late.n} late`, title: null }
        : { form: "2", clock: true, shown: late.n, said: `${late.n} past due`, title: `${late.n} past due` };
    await expect.poll(() => lateLook(entry), {
        message: `${where}: the past-due count ${late.form === "short" ? "its short form" : "its clock and its number at the row's floor"}`,
    }).toEqual(want);
    if (coarse) expect(await targetFaults(entry), `${where}: each control a 44px target`).toEqual([]);
}

for (const theme of THEMES) {
    test(`anchoring: a head's top within 1px across an open closing the card above, a close stuck at the list's top, an open, Apply's receipt — 40px, where the head stood — its Undo, a j and an Escape; the open head stuck over its body; under reduced motion no animation, the anchoring kept (R8–R13, R25) (${theme}) @desktop`, async ({ page }) => {
        // A cold start of the page's e3, then a dozen gestures, each watched until the list has held still.
        test.setTimeout(120_000);
        await page.setViewportSize(PAGE);
        const entry = await visitBuilder(page, OPS, ROOT, theme);
        const queue = queueOf(entry);
        await queue.scrollIntoViewIfNeeded();
        await settled(page);
        // The first case waiting is open as the queue opens.
        await expect(queue.locator(card(ROTA))).toHaveAttribute("data-open", "");
        const title = rowItem(entry, "decision.title", "[data-decision-count]");

        await test.step("an open that closes the card above it: the head opened stays where it stood (R7, R8)", async () => {
            const placed = await place(entry, head(PRINT), 200);
            expect(Math.abs(placed - 200), `the Plan's case's head placed at ${placed}`).toBeLessThanOrEqual(1);
            await settled(page);
            const before = (await partAt(entry, head(PRINT)))!.top;
            const frames = await watch(page, entry, [head(PRINT)], () => pressHead(page, entry, PRINT));
            await expect(queue.locator(card(PRINT))).toHaveAttribute("data-open", "");
            await expect(queue.locator(card(ROTA))).not.toHaveAttribute("data-open");
            expectHeld(frames, 0, before, "the head opened");
        });

        await test.step("the open head sticks to the list's top over its body; closed there, it stays there (R9, R10)", async () => {
            await place(entry, card(PRINT), -100);
            await settled(page);
            const stuck = await queue.evaluate((root, key) => {
                const list = root.querySelector("[data-decision-list]")!.getBoundingClientRect();
                const cardEl = root.querySelector(`[data-decision-card="${key}"]`)!;
                const headEl = cardEl.querySelector("[data-decision-head]")!;
                const h = headEl.getBoundingClientRect();
                const x = h.left + h.width / 2;
                const over = [h.top + 2, h.top + h.height / 2, h.bottom - 2].every((y) => {
                    const hit = document.elementFromPoint(x, y);
                    return hit !== null && headEl.contains(hit);
                });
                return { position: getComputedStyle(headEl).position, card: cardEl.getBoundingClientRect().top - list.top, head: h.top - list.top, over };
            }, PRINT);
            expect(stuck.position, "the head is sticky").toBe("sticky");
            expect(stuck.card, "the card's top scrolled above the list's").toBeLessThan(-50);
            expect(Math.abs(stuck.head), `the head at the list's top: ${stuck.head}`).toBeLessThanOrEqual(1);
            expect(stuck.over, "the head draws over the body scrolled under it").toBe(true);
            const frames = await watch(page, entry, [head(PRINT)], () => pressHead(page, entry, PRINT));
            await expect(queue.locator(card(PRINT))).not.toHaveAttribute("data-open");
            expectHeld(frames, 0, stuck.head, "the head closed at the list's top");
        });

        await test.step("an open: the head stays where it stood, its body growing from under it and the Why chevron turning (R9, R11)", async () => {
            await place(entry, head(PRINT), 150);
            await settled(page);
            const before = (await partAt(entry, head(PRINT)))!.top;
            const frames = await watch(page, entry, [head(PRINT)], () => pressHead(page, entry, PRINT));
            await expect(queue.locator(card(PRINT))).toHaveAttribute("data-open", "");
            expectHeld(frames, 0, before, "the head opened");
            expect(await motionOf(entry, PRINT), "the body's arrival and the chevron's turn").toEqual({ body: "decision-open", chevron: "transform" });
        });

        let applied = 0;
        await test.step("Apply: the receipt — 40px, in its verdict's tone and the theme's — stands where the head stood, the count settling (R25, R26)", async () => {
            const apply = queue.locator(applyOf(PRINT));
            await expect(apply).toHaveText("Apply");
            await expect.poll(() => apply.getAttribute("aria-disabled"), { message: "Apply is on once the preview has read its rows", timeout: 30_000 }).toBeNull();
            await showWhole(entry, applyOf(PRINT));
            await settled(page);
            const before = (await partAt(entry, head(PRINT)))!.top;
            const named = (await queue.locator(head(PRINT)).locator(":scope > :nth-child(2)").textContent()) ?? "";
            const frames = await watch(page, entry, [receipt(PRINT)], async () => {
                await press(page, apply);
                await pointAt(page, queue.locator(receipt(PRINT)));
            });
            expectHeld(frames, 0, before - 1, "the receipt");
            const shown = queue.locator(receipt(PRINT));
            const height = await shown.evaluate(async (el) => {
                await Promise.all(el.getAnimations().map((animation) => animation.finished.then(() => undefined, () => undefined)));
                return el.getBoundingClientRect().height;
            });
            expect(Math.abs(height - 40), `the receipt 40px: ${height}`).toBeLessThanOrEqual(0.5);
            await expect(shown).toHaveRole("status");
            const look = await shown.evaluate((el) => {
                const s = getComputedStyle(el);
                const [dot, verdict, named, undo] = [...el.children];
                return {
                    background: s.backgroundColor,
                    edge: [s.borderTopWidth, s.borderTopStyle, s.borderTopColor].join(" "),
                    radius: s.borderTopLeftRadius,
                    padding: [s.paddingLeft, s.paddingRight],
                    dot: [dot?.getAttribute("data-verdict"), dot === undefined ? "" : getComputedStyle(dot).backgroundColor],
                    verdict: [verdict?.textContent, verdict === undefined ? "" : getComputedStyle(verdict).color],
                    title: named?.textContent,
                    undo: [undo?.textContent, undo === undefined ? "" : getComputedStyle(undo).color],
                };
            });
            expect(look).toEqual({
                background: await token(page, "bg-canvas"),
                edge: `1px solid ${await token(page, "border-subtle")}`,
                radius: await radius(page, "md"),
                padding: ["12px", "8px"],
                dot: ["applied", await token(page, "status-pos")],
                verdict: ["Applied", await token(page, "fg-success")],
                title: named,
                undo: ["Undo", await token(page, "brand-solid")],
            });
            await expect(title).toHaveAttribute("data-settle", "");
            expect(await title.evaluate((el) => getComputedStyle(el).animationName), "the count settles").toBe("decision-settle");
            applied = before;
        });

        await test.step("the receipt's Undo: the card back, open, its head where it stood (R26)", async () => {
            const frames = await watch(page, entry, [head(PRINT)], () => press(page, queue.locator(receipt(PRINT)).getByRole("button", { name: "Undo", exact: true })));
            await expect(queue.locator(card(PRINT))).toHaveAttribute("data-open", "");
            await expect(queue.locator(receipt(PRINT))).toHaveCount(0);
            expectHeld(frames, 0, applied, "the head the receipt's Undo brought back");
            await expect(queue.locator(head(PRINT))).toBeFocused();
        });

        let next = 0;
        await test.step("j: the next card opens, the one open closes above it, its head where it stood (R12)", async () => {
            const placed = await place(entry, head(YARD), 300);
            expect(Math.abs(placed - 300), `the next case's head placed at ${placed}`).toBeLessThanOrEqual(1);
            await settled(page);
            const before = (await partAt(entry, head(YARD)))!.top;
            await expect(queue.locator(head(PRINT))).toBeFocused();
            const frames = await watch(page, entry, [head(YARD)], () => page.keyboard.press("j"));
            await expect(queue.locator(card(YARD))).toHaveAttribute("data-open", "");
            await expect(queue.locator(card(PRINT))).not.toHaveAttribute("data-open");
            expectHeld(frames, 0, before, "the head j opened");
            await expect(queue.locator(head(YARD))).toBeFocused();
            next = before;
        });

        await test.step("Escape: the open card closes, its head where it stood (R12)", async () => {
            const frames = await watch(page, entry, [head(YARD)], () => page.keyboard.press("Escape"));
            await expect(queue.locator(card(YARD))).not.toHaveAttribute("data-open");
            expectHeld(frames, 0, next, "the head Escape closed");
            await expect(queue.locator(head(YARD))).toBeFocused();
        });

        await test.step("reduced motion: no arrival, no turn, no settle, the receipt 40px from its first frame — the anchoring kept (R13)", async () => {
            await page.emulateMedia({ reducedMotion: "reduce" });
            await page.mouse.move(0, 0);
            await place(entry, head(PRINT), 150);
            await settled(page);
            const before = (await partAt(entry, head(PRINT)))!.top;
            const opened = await watch(page, entry, [head(PRINT)], () => pressHead(page, entry, PRINT));
            await expect(queue.locator(card(PRINT))).toHaveAttribute("data-open", "");
            expectHeld(opened, 0, before, "the head opened under reduced motion");
            expect(await motionOf(entry, PRINT), "the body's arrival and the chevron's turn").toEqual({ body: "none", chevron: "none" });
            const apply = queue.locator(applyOf(PRINT));
            await expect.poll(() => apply.getAttribute("aria-disabled"), { timeout: 30_000 }).toBeNull();
            await showWhole(entry, applyOf(PRINT));
            await settled(page);
            const at = (await partAt(entry, head(PRINT)))!.top;
            const frames = await watch(page, entry, [receipt(PRINT)], async () => {
                await press(page, apply);
                await pointAt(page, queue.locator(receipt(PRINT)));
            });
            expectHeld(frames, 0, at - 1, "the receipt under reduced motion");
            const heights = frames.map((frame) => frame[0]).filter((part): part is At => part !== null && part !== undefined).map((part) => part.height);
            expect(heights.filter((h) => Math.abs(h - 40) > 0.5), `the receipt 40px in every frame — ${heights.join(" ")}`).toEqual([]);
            expect(await queue.locator(receipt(PRINT)).evaluate((el) => getComputedStyle(el).animationName), "the receipt's arrival").toBe("none");
            await expect(title).toHaveAttribute("data-settle", "");
            expect(await title.evaluate((el) => getComputedStyle(el).animationName), "the count's settle").toBe("none");
        });
    });

    test(`looks: the card closed and open, its head and its chip, and the marks over the previews, in the theme's tokens; each preview kind its height and frame, swept through the previews gallery (§8, P2, P13, P14, P21) (${theme}) @desktop`, async ({ page }) => {
        // A cold start of the page's e3, then a sweep of the gallery's cases, each read as the list reaches it.
        test.setTimeout(120_000);
        await page.setViewportSize(PAGE);
        const entry = await visitBuilder(page, OPS, ROOT, theme);
        const queue = queueOf(entry);
        await queue.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await settled(page);
        await expect(queue.locator(card(ROTA))).toHaveAttribute("data-open", "");
        // The open card above and the closed one under it, both drawn.
        await place(entry, head(PRINT), 400);
        await settled(page);
        const want = await markLook(page);

        await test.step("the card closed and open, its head and its chip", async () => {
            const look = await queue.evaluate((root, { open, closed }) => {
                const edge = (s: CSSStyleDeclaration, side: "top" | "bottom") =>
                    [s.getPropertyValue(`border-${side}-width`), s.getPropertyValue(`border-${side}-style`), s.getPropertyValue(`border-${side}-color`)].join(" ");
                const of = (key: string) => {
                    const cardEl = root.querySelector(`[data-decision-card="${key}"]`)!;
                    const headEl = cardEl.querySelector("[data-decision-head]")!;
                    const c = getComputedStyle(cardEl);
                    const h = getComputedStyle(headEl);
                    return {
                        card: { margin: c.marginTop, edge: edge(c, "top"), radius: c.borderTopLeftRadius, background: c.backgroundColor },
                        head: {
                            background: h.backgroundColor, padding: [h.paddingTop, h.paddingRight, h.paddingBottom, h.paddingLeft].join(" "),
                            position: h.position, top: h.top, rule: edge(h, "bottom"),
                        },
                        headEl,
                    };
                };
                const shut = of(closed);
                const chipEl = [...shut.headEl.children].at(-2)!.firstElementChild!;
                const chip = getComputedStyle(chipEl);
                return {
                    closed: { card: shut.card, head: shut.head },
                    open: { card: of(open).card, head: of(open).head },
                    chip: {
                        words: chipEl.textContent, height: chipEl.getBoundingClientRect().height, edge: edge(chip, "top"),
                        color: chip.color, transform: chip.textTransform,
                    },
                };
            }, { open: ROTA, closed: PRINT });
            const surface = await token(page, "bg-surface");
            const strong = await token(page, "border-strong");
            const subtle = await token(page, "border-subtle");
            const md = await radius(page, "md");
            const brand = await token(page, "brand-solid");
            expect(look.closed, "the closed card and its head").toEqual({
                card: { margin: "8px", edge: `1px solid ${strong}`, radius: md, background: surface },
                head: { background: surface, padding: "12px 12px 12px 12px", position: "sticky", top: "0px", rule: expect.stringMatching(/^0px /u) },
            });
            expect(look.open, "the open card and its head").toEqual({
                card: { margin: "8px", edge: `1px solid ${await token(page, "fg")}`, radius: md, background: surface },
                head: { background: await token(page, "bg-subtle"), padding: "12px 12px 12px 12px", position: "sticky", top: "0px", rule: `1px solid ${subtle}` },
            });
            expect(look.chip, "the proposal's chip").toEqual({ words: "Proposed", height: 18, edge: `1px dashed ${brand}`, color: brand, transform: "uppercase" });
        });

        await test.step("the marks over the cases' previews", async () => {
            await previewsRead(entry);
            expect(await markFaults(entry, want)).toEqual([]);
        });

        await test.step("the previews gallery: each preview kind its height and frame, inside its head, and its marks", async () => {
            const gallery = await visitBuilder(page, PREVIEWS, ROOT, undefined);
            await queueOf(gallery).scrollIntoViewIfNeeded();
            await page.mouse.move(0, 0);
            const { looks, faults } = await sweepPreviews(page, gallery, want);
            expect(faults, "the marks").toEqual([]);
            const kinds = [...new Set([...looks.values()].map((look) => look.kind))].sort();
            expect(kinds, "every preview kind drawn").toEqual(Object.keys(PREVIEW_HEIGHT).sort());
            expect([...looks.values()].some((look) => look.stale), "a stale preview drawn").toBe(true);
            const paper = await token(page, "bg-surface");
            const sm = await radius(page, "sm");
            const rule = `1px solid ${await token(page, "border-subtle")}`;
            const staleRule = `1px dashed ${await token(page, "border-strong")}`;
            for (const look of looks.values()) {
                expect({ height: look.height, edge: look.edge, radius: look.radius, background: look.background, inHead: look.inHead }, `${look.key}: its ${look.kind} preview`).toEqual({
                    height: PREVIEW_HEIGHT[look.kind], edge: look.stale ? staleRule : rule, radius: sm, background: paper, inHead: true,
                });
            }
        });
    });

    test(`narrow hosts: the same queue in a 360px parent and a 294px one, and the phone example in its own box — one column, nothing sideways, the count kept and the past-due count its short form, in the 294px one at the row's floor its clock and its number; on a coarse pointer each control of the open card a 44px target by its box or its halo (R30) (${theme})`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const entry = await visitBuilder(page, OPS, ROOT, theme);
        await expect(queueOf(entry).locator(card(ROTA))).toHaveAttribute("data-open", "");
        const wide = (await rowItem(entry, "decision.late", "[data-decision-late]").textContent()) ?? "";
        const pastDue = /^(\d+) past due$/u.exec(wide);
        expect(pastDue, `the past-due count at the queue's full width: '${wide}'`).not.toBeNull();
        const n = pastDue?.[1] ?? "";
        for (const [width, form] of [[360, "short"], [294, "floor"]] as const) {
            await test.step(`in a ${width}px parent`, async () => {
                await sizeBuilder(page, entry, ROOT, width);
                await expectNarrow(page, entry, { form, n }, `a ${width}px parent`);
            });
        }
        await test.step("the phone example, in its own box", async () => {
            const phone = await visitBuilder(page, PHONE, ROOT, undefined);
            await expect(queueOf(phone).locator(card(ROTA))).toHaveAttribute("data-open", "");
            await expectNarrow(page, phone, { form: "short", n }, "the phone example");
        });
    });
}

/**
 * How an open card moves: its body's arrival animation, and the turn of its Why chevron.
 *
 * @param entry - The example's entry
 * @param key - The open case
 * @returns The body's animation's name and the chevron's transition's property
 */
function motionOf(entry: Locator, key: string): Promise<{ body: string; chevron: string }> {
    return queueOf(entry).evaluate((root, key) => {
        const cardEl = root.querySelector(`[data-decision-card="${key}"]`)!;
        const body = cardEl.children[1];
        const why = [...cardEl.querySelectorAll("button[aria-expanded]")].find((button) => (button.textContent ?? "").startsWith("Why"));
        const chevron = why?.firstElementChild ?? null;
        return {
            body: body === undefined ? "no body" : getComputedStyle(body).animationName,
            chevron: chevron === null ? "no chevron" : getComputedStyle(chevron).transitionProperty,
        };
    }, key);
}
