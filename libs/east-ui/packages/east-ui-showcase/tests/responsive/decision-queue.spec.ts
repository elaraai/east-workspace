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
 *   open, Apply — the card standing where it stood, inert, while its preview
 *   settles over its clock, then its receipt 40px, standing where the head
 *   stood, the keyboard on the next card's head, the count holding — the
 *   receipt's Undo, a `j` and an Escape; the open card's head stuck to the
 *   list's top over its body; under reduced motion no animation and no
 *   transition, the applied card's clock 0, the anchoring kept; and Save,
 *   which takes the applied case out of the waiting ones, the Save notice
 *   saying so and the count settling — at once under reduced motion — and
 *   settling again as the history's Undo past the Save is saved (R4,
 *   R24–R27, P22).
 * - **Looks** (§8, P2, P13–P16, P21, P22): the list's rows — the first card 12
 *   below the list's top, the next 8 below it — the card closed and open, its
 *   head and its chip, and the marks over the previews, computed in the theme
 *   against its tokens; each preview kind's height and frame, swept through
 *   the previews gallery; and the gallery's knock-on and breach applied, each
 *   card standing while every mark settles — the glow, the ghost and the two
 *   rings — before its receipt arrives.
 * - **Narrow hosts** (R30): the same queue in a 360px parent and a 294px one,
 *   and the phone example in its own box — one column, nothing sideways, the
 *   count kept — and on a coarse pointer each control of the open card, the
 *   Roster's case with its options and its question, a 44px target by its box
 *   or its halo.
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

/** The first case waiting in its source's order — Saturday's cover, a routine one — open as the queue opens. */
const FIRST = "cover-saturday";
/** The case under it. */
const SECOND = "orders-ready";
/** The Plan's case, whose Apply waits on no answer. */
const PRINT = "print-j3007";
/** The case under the Plan's: the next waiting card after it. */
const NEXT = "ready-a1";
/** The Roster's case, whose open card offers its options and asks its question. */
const ROTA = "rota-tansy";
/** The gallery's knock-on: a job the change pushes keeps its fill in a dashed ring beside its ghost. */
const KNOCK = "print-knock";
/** The gallery's breach: the job the change places and the one it still overlaps each take the warning ring. */
const BREACH = "print-breach";

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
 * Waits for a receipt to arrive: it arrives from its card's height to its own (R24).
 *
 * @param shown - The receipt
 */
async function arrived(shown: Locator): Promise<void> {
    await shown.evaluate(async (el) => {
        await Promise.all(el.getAnimations().map((animation) => animation.finished.then(() => undefined, () => undefined)));
    });
}

/** The page's name for what a card was as its Apply landed. */
const APPLIED = "__decisionApplied";

/** A mark of an applied card's preview as its Apply landed. */
interface AppliedMark {
    /** Its mark, `null` for an entry drawn as it is. */
    readonly op: string | null;
    /** Whether it takes the knock-on's ring, or the breach's. */
    readonly knock: boolean;
    readonly breach: boolean;
    /** What its transitions move, in order. */
    readonly moves: readonly string[];
}

/** What a card was as its Apply landed (P22): whether it took anything more, its preview, its clock and its marks. */
interface Applied {
    /** Whether it takes nothing more: inert. */
    readonly inert: boolean;
    /** Whether its preview settles (`data-applied`). */
    readonly preview: boolean;
    /** Its clock, whose end the queue waits on: its animation's name and duration. */
    readonly clock: { readonly name: string; readonly duration: string };
    /** Each mark of its preview. */
    readonly marks: readonly AppliedMark[];
}

/**
 * Watches for a case's card to be applied (P22), and records what it was in the commit that applied it — before any
 * frame drew it — holding its clock there if asked, so its preview is read settled while the card stands.
 *
 * @param entry - The example's entry
 * @param key - The case
 * @param hold - Whether the card's clock is paused as it starts
 */
function watchApplied(entry: Locator, key: string, hold: boolean): Promise<void> {
    return queueOf(entry).evaluate((root, { key, hold, name }) => {
        const page = window as unknown as Record<string, unknown>;
        delete page[name];
        const observer = new MutationObserver(() => {
            const cardEl = root.querySelector<HTMLElement>(`[data-decision-card="${key}"][data-applied]`);
            if (cardEl === null) return;
            observer.disconnect();
            // The card's own animations, its style brought up to date first: the clock among them as it starts.
            if (hold) {
                for (const animation of cardEl.getAnimations()) {
                    if (animation instanceof CSSAnimation && animation.animationName === "decision-applied") animation.pause();
                }
            }
            const s = getComputedStyle(cardEl);
            const preview = cardEl.querySelector("[data-decision-preview]");
            page[name] = {
                inert: cardEl.inert,
                preview: preview?.hasAttribute("data-applied") ?? false,
                clock: { name: s.animationName, duration: s.animationDuration },
                marks: [...preview?.querySelectorAll<HTMLElement>("[data-op], [data-knock], [data-breach]") ?? []].map((el) => ({
                    op: el.getAttribute("data-op"),
                    knock: el.hasAttribute("data-knock"),
                    breach: el.hasAttribute("data-breach"),
                    moves: el.getAnimations().flatMap((animation) => (animation instanceof CSSTransition ? [animation.transitionProperty] : [])).sort(),
                })),
            };
        });
        observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-applied"] });
    }, { key, hold, name: APPLIED });
}

/**
 * What a case's card was as its Apply landed, once {@link watchApplied} has seen it.
 *
 * @param page - The page
 * @param key - The case
 * @returns What it was
 */
async function appliedOf(page: Page, key: string): Promise<Applied> {
    await expect.poll(() => page.evaluate((name) => name in window, APPLIED), { message: `${key}'s card applied`, timeout: 15_000 }).toBe(true);
    return page.evaluate((name) => (window as unknown as Record<string, Applied>)[name]!, APPLIED);
}

/**
 * Lets every transition the marks of a held applied card's preview started run out, the card standing, and reads each
 * mark settled (P22): a proposal unlit, a ghost gone, a ring's colour clear.
 *
 * @param entry - The example's entry
 * @param key - The case
 * @returns Each mark not settled, in words; none when every one has
 */
function settledFaults(entry: Locator, key: string): Promise<string[]> {
    return queueOf(entry).evaluate(async (root, key) => {
        const preview = root.querySelector(`[data-decision-card="${key}"][data-applied] [data-decision-preview]`);
        if (preview === null) return ["the card gave way before its preview settled"];
        const marks = [...preview.querySelectorAll<HTMLElement>("[data-op], [data-knock], [data-breach]")];
        await Promise.all(marks.flatMap((el) => el.getAnimations().map((animation) => animation.finished.then(() => undefined, () => undefined))));
        const faults: string[] = [];
        for (const el of marks) {
            const s = getComputedStyle(el);
            const op = el.getAttribute("data-op");
            const what = `${el.getAttribute("data-preview-tile") ?? "?"} ${op ?? "as it is"}`;
            if ((op === "add" || op === "chg") && s.boxShadow !== "none") faults.push(`${what}: still lit, ${s.boxShadow}`);
            if ((op === "from" || op === "del") && s.opacity !== "0") faults.push(`${what}: its ghost still drawn, opacity ${s.opacity}`);
            if ((el.hasAttribute("data-knock") || el.hasAttribute("data-breach")) && s.outlineColor !== "rgba(0, 0, 0, 0)") {
                faults.push(`${what}: its ring still drawn, ${s.outlineColor}`);
            }
        }
        return faults;
    }, key);
}

/**
 * Lets a held card's clock run on: it ends as the rest of its duration runs out, and the queue sets the receipt in the
 * card's place.
 *
 * @param entry - The example's entry
 * @param key - The case
 */
function releaseApplied(entry: Locator, key: string): Promise<void> {
    return queueOf(entry).evaluate((root, key) => {
        for (const animation of root.querySelector(`[data-decision-card="${key}"]`)?.getAnimations() ?? []) {
            if (animation instanceof CSSAnimation && animation.animationName === "decision-applied") animation.play();
        }
    }, key);
}

/**
 * Each mark of an applied card's preview that did not set out to settle as it should (P22, R13): with motion, a
 * proposal's glow, a ghost's opacity and a ring's colour each by a transition of its own; under reduced motion, nothing
 * by a transition.
 *
 * @param applied - What the card was as its Apply landed
 * @param motion - Whether the page moves: no reduced motion
 * @returns Each fault, in words; none when every mark set out as it should
 */
function moveFaults(applied: Applied, motion: boolean): string[] {
    return applied.marks.flatMap((mark) => {
        const what = `${mark.op ?? "as it is"}${mark.knock ? " knocked on" : ""}${mark.breach ? " breaching" : ""}`;
        if (!motion) return mark.moves.length === 0 ? [] : [`${what}: moves ${mark.moves.join(", ")} under reduced motion`];
        const want = [
            ...(mark.op === "add" || mark.op === "chg" ? ["box-shadow"] : []),
            ...(mark.op === "from" || mark.op === "del" ? ["opacity"] : []),
            ...(mark.knock || mark.breach ? ["outline-color"] : []),
        ];
        const missing = want.filter((property) => !mark.moves.includes(property));
        return missing.length === 0 ? [] : [`${what}: no transition of ${missing.join(", ")}, only of ${mark.moves.join(", ") || "nothing"}`];
    });
}

/**
 * A theme duration as the page resolves it.
 *
 * @param page - The page
 * @param name - The duration token, after `--chakra-durations-` (`slow`)
 * @returns Its computed duration
 */
function duration(page: Page, name: string): Promise<string> {
    return page.evaluate((n) => {
        const probe = document.createElement("span");
        probe.style.animationDuration = `var(--chakra-durations-${n})`;
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).animationDuration;
        probe.remove();
        return value;
    }, name);
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
 * What is wrong with the queue at a narrow width (R30): the list scrolling sideways; a card or a receipt past the list's
 * sides, or a card out of the one column; a part of a card — a preview's own parts
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
            const key = el.getAttribute("data-decision-card") ?? el.getAttribute("data-decision-receipt");
            return key === null ? el.tagName.toLowerCase() : key;
        };
        for (const row of list.querySelectorAll("[data-decision-card], [data-decision-receipt]")) {
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

/**
 * Holds the queue at a narrow width to R30: one column and nothing sideways, the count kept, and on a coarse pointer
 * the open card's controls 44px targets.
 *
 * @param page - The page
 * @param entry - The example's entry
 * @param where - The width, for the failures
 */
async function expectNarrow(page: Page, entry: Locator, where: string): Promise<void> {
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    expect(await narrowFaults(entry, !coarse), where).toEqual([]);
    await expect(rowItem(entry, "decision.title", "[data-decision-count]"), `${where}: the count stays`).toHaveText(/^\d+$/u);
    if (coarse) expect(await targetFaults(entry), `${where}: each control a 44px target`).toEqual([]);
}

/**
 * Opens the Roster's case as a viewer does: the list scrolled to it, and its head pressed.
 *
 * @param page - The page
 * @param entry - The example's entry
 */
async function openRota(page: Page, entry: Locator): Promise<void> {
    await place(entry, head(ROTA), 40);
    await settled(page);
    await pressHead(page, entry, ROTA);
    await expect(queueOf(entry).locator(card(ROTA))).toHaveAttribute("data-open", "");
}

for (const theme of THEMES) {
    test(`anchoring: a head's top within 1px across an open closing the card above, a close stuck at the list's top, an open, Apply — the card standing while its preview settles, then its receipt 40px, where the head stood, the keyboard on the next head, the count holding — its Undo, a j and an Escape; the open head stuck over its body; under reduced motion no animation, the applied card's clock 0, the anchoring kept; Save taking the applied case out of the waiting ones, the count settling (R3, R4, R8–R13, R24–R27, P22) (${theme}) @desktop`, async ({ page }) => {
        // A cold start of the page's e3, then a dozen gestures, each watched until the list has held still.
        test.setTimeout(120_000);
        await page.setViewportSize(PAGE);
        const entry = await visitBuilder(page, OPS, ROOT, theme);
        const queue = queueOf(entry);
        await queue.scrollIntoViewIfNeeded();
        await settled(page);
        // The first case waiting is open as the queue opens.
        await expect(queue.locator(card(FIRST))).toHaveAttribute("data-open", "");
        const title = rowItem(entry, "decision.title", "[data-decision-count]");
        await expect(title).toHaveText("12");

        await test.step("an open that closes the card above it: the head opened stays where it stood (R7, R8)", async () => {
            const placed = await place(entry, head(PRINT), 200);
            expect(Math.abs(placed - 200), `the Plan's case's head placed at ${placed}`).toBeLessThanOrEqual(1);
            await settled(page);
            const before = (await partAt(entry, head(PRINT)))!.top;
            const frames = await watch(page, entry, [head(PRINT)], () => pressHead(page, entry, PRINT));
            await expect(queue.locator(card(PRINT))).toHaveAttribute("data-open", "");
            await expect(queue.locator(card(FIRST))).not.toHaveAttribute("data-open");
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
        await test.step("Apply: the card stands where it stood, inert, while its preview settles over its clock — the proposal unlit, the ghost gone — then the receipt — 40px, in its verdict's tone and the theme's — stands where the head stood, the keyboard on the next case's head, which neither opens nor scrolls, the count holding e3's (R3, R24, R25, P22)", async () => {
            const apply = queue.locator(applyOf(PRINT));
            await expect(apply).toHaveText("Apply");
            await expect.poll(() => apply.getAttribute("aria-disabled"), { message: "Apply is on once the preview has read its rows", timeout: 30_000 }).toBeNull();
            await showWhole(entry, applyOf(PRINT));
            await settled(page);
            const before = (await partAt(entry, head(PRINT)))!.top;
            const named = (await queue.locator(head(PRINT)).locator(":scope > :nth-child(2)").textContent()) ?? "";
            // The card's clock held as the Apply lands, so its marks are read settled while it stands; then let run on.
            await watchApplied(entry, PRINT, true);
            let stood: Applied | undefined;
            let unsettled: string[] = [];
            const frames = await watch(page, entry, [receipt(PRINT), head(PRINT)], async () => {
                await press(page, apply);
                stood = await appliedOf(page, PRINT);
                unsettled = await settledFaults(entry, PRINT);
                await releaseApplied(entry, PRINT);
                await arrived(queue.locator(receipt(PRINT)));
            });
            const { marks, ...landed } = stood!;
            expect(landed, "the card as its Apply landed: inert, its preview settling, its clock the slow duration").toEqual({
                inert: true, preview: true, clock: { name: "decision-applied", duration: await duration(page, "slow") },
            });
            expect(marks.map((mark) => mark.op).sort(), "its preview's marks: the job's ghost, and where it lands").toEqual(["add", "from"]);
            expect(moveFaults(stood!, true), "each mark setting out to settle").toEqual([]);
            expect(unsettled, "each mark settled while the card stood").toEqual([]);
            expectHeld(frames, 1, before, "the applied card's head, standing while its preview settles");
            expectHeld(frames, 0, before - 1, "the receipt");
            // The keyboard on the next waiting case's head, which neither opens nor scrolls: the receipt held above says so.
            await expect(queue.locator(head(NEXT))).toBeFocused();
            await expect(queue.locator(card(NEXT))).not.toHaveAttribute("data-open");
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
            // A draft moves no count of e3's: the chip holds, unsettled.
            await expect(title).toHaveText("12");
            await expect(title).not.toHaveAttribute("data-settle");
            applied = before;
        });

        await test.step("the receipt's Undo: the card back, open, its head where it stood (R27)", async () => {
            const frames = await watch(page, entry, [head(PRINT)], () => press(page, queue.locator(receipt(PRINT)).getByRole("button", { name: "Undo", exact: true })));
            await expect(queue.locator(card(PRINT))).toHaveAttribute("data-open", "");
            await expect(queue.locator(receipt(PRINT))).toHaveCount(0);
            expectHeld(frames, 0, applied, "the head the receipt's Undo brought back");
            await expect(queue.locator(head(PRINT))).toBeFocused();
        });

        let next = 0;
        await test.step("j: the next card opens, the one open closes above it, its head where it stood (R12)", async () => {
            const placed = await place(entry, head(NEXT), 300);
            expect(Math.abs(placed - 300), `the next case's head placed at ${placed}`).toBeLessThanOrEqual(1);
            await settled(page);
            const before = (await partAt(entry, head(NEXT)))!.top;
            await expect(queue.locator(head(PRINT))).toBeFocused();
            const frames = await watch(page, entry, [head(NEXT)], () => page.keyboard.press("j"));
            await expect(queue.locator(card(NEXT))).toHaveAttribute("data-open", "");
            await expect(queue.locator(card(PRINT))).not.toHaveAttribute("data-open");
            expectHeld(frames, 0, before, "the head j opened");
            await expect(queue.locator(head(NEXT))).toBeFocused();
            next = before;
        });

        await test.step("Escape: the open card closes, its head where it stood (R12)", async () => {
            const frames = await watch(page, entry, [head(NEXT)], () => page.keyboard.press("Escape"));
            await expect(queue.locator(card(NEXT))).not.toHaveAttribute("data-open");
            expectHeld(frames, 0, next, "the head Escape closed");
            await expect(queue.locator(head(NEXT))).toBeFocused();
        });

        await test.step("reduced motion: no arrival, no turn, the applied card's clock 0 and its marks moving by no transition, the receipt 40px from its first frame — the anchoring kept (R13, P22)", async () => {
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
            await watchApplied(entry, PRINT, false);
            const frames = await watch(page, entry, [receipt(PRINT)], async () => {
                await press(page, apply);
                await arrived(queue.locator(receipt(PRINT)));
            });
            // The card gives way at once: its clock run in the theme's moment, which still ends, and its marks moving by no
            // transition.
            const stood = await appliedOf(page, PRINT);
            expect(stood.clock.name, "the applied card's clock").toBe("decision-applied");
            expect(Number.parseFloat(stood.clock.duration), `the applied card's clock under reduced motion: ${stood.clock.duration}`).toBeLessThan(0.001);
            expect(moveFaults(stood, false), "its marks moving by no transition").toEqual([]);
            expectHeld(frames, 0, at - 1, "the receipt under reduced motion");
            const heights = frames.map((frame) => frame[0]).filter((part): part is At => part !== null && part !== undefined).map((part) => part.height);
            expect(heights.filter((h) => Math.abs(h - 40) > 0.5), `the receipt 40px in every frame — ${heights.join(" ")}`).toEqual([]);
            // Its arrival drew nothing, and ended.
            await expect(queue.locator(receipt(PRINT)), "the receipt arrived").not.toHaveAttribute("data-arriving");
        });

        const toolbar = queue.locator("[data-frame-slot='toolbar']");
        await test.step("Save, under reduced motion: the applied case leaves the waiting ones, the Save notice says so, and e3's count settles at once, with no animation (R4, R13, R26)", async () => {
            await press(page, toolbar.getByRole("button", { name: "Save", exact: true }));
            await expect(queue.locator(receipt(PRINT)), "the case saved leaves the list").toHaveCount(0, { timeout: 30_000 });
            await expect(title).toHaveText("11", { timeout: 30_000 });
            await expect(title).toHaveAttribute("data-settle", "");
            expect(await title.evaluate((el) => getComputedStyle(el).animationName), "the count's settle").toBe("none");
            await expect(queue.locator("[data-decision-footer] [data-record-save-notice='']")).toHaveText("1 decision left this view", { timeout: 30_000 });
        });

        await test.step("the history's Undo past the Save, saved: the case back among the waiting ones, and e3's count settling (R4, R27)", async () => {
            await page.emulateMedia({ reducedMotion: "no-preference" });
            await press(page, toolbar.getByRole("button", { name: "Undo", exact: true }));
            await press(page, toolbar.getByRole("button", { name: "Save", exact: true }));
            await expect(title).toHaveText("12", { timeout: 30_000 });
            await expect(title).toHaveAttribute("data-settle", "");
            expect(await title.evaluate((el) => getComputedStyle(el).animationName), "the count settles").toBe("decision-settle");
            // Back where the source has it: the list read from its top down to it.
            await queue.locator("[data-decision-list]").evaluate((el) => { el.scrollTop = 0; });
            await settled(page);
            await place(entry, head(PRINT), 40);
            await expect(queue.locator(card(PRINT)), "the case back, waiting").toHaveCount(1, { timeout: 30_000 });
        });
    });

    test(`looks: the list's rows, the card closed and open, its head and its chip, and the marks over the previews, in the theme's tokens; each preview kind its height and frame, swept through the previews gallery; the gallery's knock-on and breach applied, every mark settling before the receipt (§8, P2, P13–P16, P21, P22) (${theme}) @desktop`, async ({ page }) => {
        // A cold start of the page's e3, then a sweep of the gallery's cases, each read as the list reaches it.
        test.setTimeout(120_000);
        await page.setViewportSize(PAGE);
        const entry = await visitBuilder(page, OPS, ROOT, theme);
        const queue = queueOf(entry);
        await queue.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await settled(page);
        await expect(queue.locator(card(FIRST))).toHaveAttribute("data-open", "");
        // The open card above and the closed one under it, both drawn.
        await place(entry, head(SECOND), 400);
        await settled(page);
        const want = await markLook(page);

        await test.step("the list's rows, the card closed and open, its head and its chip", async () => {
            const look = await queue.evaluate((root, { open, closed }) => {
                const edge = (s: CSSStyleDeclaration, side: "top" | "bottom") =>
                    [s.getPropertyValue(`border-${side}-width`), s.getPropertyValue(`border-${side}-style`), s.getPropertyValue(`border-${side}-color`)].join(" ");
                const of = (key: string) => {
                    const cardEl = root.querySelector(`[data-decision-card="${key}"]`)!;
                    const headEl = cardEl.querySelector("[data-decision-head]")!;
                    const c = getComputedStyle(cardEl);
                    const h = getComputedStyle(headEl);
                    return {
                        card: { edge: edge(c, "top"), radius: c.borderTopLeftRadius, background: c.backgroundColor },
                        head: {
                            background: h.backgroundColor, padding: [h.paddingTop, h.paddingRight, h.paddingBottom, h.paddingLeft].join(" "),
                            position: h.position, top: h.top, rule: edge(h, "bottom"),
                        },
                        cardEl,
                        headEl,
                    };
                };
                const shut = of(closed);
                const opened = of(open);
                const chipEl = [...shut.headEl.children].at(-2)!.firstElementChild!;
                const chip = getComputedStyle(chipEl);
                // The top of the list's content, wherever the list has scrolled to; the open card is the first.
                const list = root.querySelector("[data-decision-list]")!;
                const top = list.getBoundingClientRect().top - list.scrollTop;
                const first = opened.cardEl.getBoundingClientRect();
                const under = shut.cardEl.getBoundingClientRect();
                return {
                    rows: { first: first.top - top, gap: under.top - first.bottom },
                    closed: { card: shut.card, head: shut.head },
                    open: { card: opened.card, head: opened.head },
                    chip: {
                        words: chipEl.textContent, height: chipEl.getBoundingClientRect().height, edge: edge(chip, "top"),
                        color: chip.color, transform: chip.textTransform,
                    },
                };
            }, { open: FIRST, closed: SECOND });
            // The list's rows (§8): the first card 12 below the list's top, and the card under it 8 below it.
            expect(Math.abs(look.rows.first - 12), `the first card 12 below the list's top: ${look.rows.first}`).toBeLessThanOrEqual(1);
            expect(Math.abs(look.rows.gap - 8), `the card under it 8 below it: ${look.rows.gap}`).toBeLessThanOrEqual(1);
            const surface = await token(page, "bg-surface");
            const strong = await token(page, "border-strong");
            const subtle = await token(page, "border-subtle");
            const md = await radius(page, "md");
            const brand = await token(page, "brand-solid");
            expect(look.closed, "the closed card and its head").toEqual({
                card: { edge: `1px solid ${strong}`, radius: md, background: surface },
                head: { background: surface, padding: "12px 12px 12px 12px", position: "sticky", top: "0px", rule: expect.stringMatching(/^0px /u) },
            });
            expect(look.open, "the open card and its head").toEqual({
                card: { edge: `1px solid ${await token(page, "fg")}`, radius: md, background: surface },
                head: { background: await token(page, "bg-subtle"), padding: "12px 12px 12px 12px", position: "sticky", top: "0px", rule: `1px solid ${subtle}` },
            });
            expect(look.chip, "the proposal's chip").toEqual({ words: "Proposed", height: 18, edge: `1px dashed ${brand}`, color: brand, transform: "uppercase" });
        });

        await test.step("the marks over the cases' previews", async () => {
            await previewsRead(entry);
            expect(await markFaults(entry, want)).toEqual([]);
        });

        let gallery: Locator | undefined;
        await test.step("the previews gallery: each preview kind its height and frame, inside its head, and its marks", async () => {
            gallery = await visitBuilder(page, PREVIEWS, ROOT, undefined);
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

        await test.step("the gallery's knock-on and breach, applied: each card stands while every mark settles — the proposal unlit, the ghost gone, the knock-on's ring and the breach's clear — then gives way to its receipt (P15, P16, P22)", async () => {
            const shown = queueOf(gallery!);
            const settles = new Set<string>();
            for (const key of [KNOCK, BREACH]) {
                // From the list's top down to the case: the sweep left the list at its end, and the breach stands above the
                // knock-on, and `place` looks for a case not drawn yet further down.
                await shown.locator("[data-decision-list]").evaluate((el) => { el.scrollTop = 0; });
                await settled(page);
                const placed = await place(gallery!, head(key), 40);
                expect(Math.abs(placed - 40), `${key}'s head placed at ${placed}`).toBeLessThanOrEqual(1);
                await settled(page);
                await pressHead(page, gallery!, key);
                await expect(shown.locator(card(key))).toHaveAttribute("data-open", "");
                const apply = shown.locator(applyOf(key));
                await expect.poll(() => apply.getAttribute("aria-disabled"), { message: `${key}'s Apply is on once its preview has read its rows`, timeout: 30_000 }).toBeNull();
                await showWhole(gallery!, applyOf(key));
                await settled(page);
                // Its clock held as the Apply lands, so its marks are read settled while it stands; then let run on.
                await watchApplied(gallery!, key, true);
                await press(page, apply);
                const stood = await appliedOf(page, key);
                const unsettled = await settledFaults(gallery!, key);
                await releaseApplied(gallery!, key);
                await arrived(shown.locator(receipt(key)));
                expect(stood.inert, `${key}: inert as it stands`).toBe(true);
                expect(moveFaults(stood, true), `${key}: each mark setting out to settle`).toEqual([]);
                expect(unsettled, `${key}: each mark settled while the card stood`).toEqual([]);
                for (const mark of stood.marks) {
                    if (mark.op !== null) settles.add(mark.op);
                    if (mark.knock) settles.add("knock");
                    if (mark.breach) settles.add("breach");
                }
            }
            expect([...settles].sort(), "the marks the two cards settle").toEqual(["add", "breach", "from", "knock"]);
        });
    });

    test(`narrow hosts: the same queue in a 360px parent and a 294px one, and the phone example in its own box — one column, nothing sideways, the count kept; on a coarse pointer each control of the open card a 44px target by its box or its halo (R30) (${theme})`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const entry = await visitBuilder(page, OPS, ROOT, theme);
        await expect(queueOf(entry).locator(card(FIRST))).toHaveAttribute("data-open", "");
        // The Roster's case open: its options and its question among the card's controls.
        await openRota(page, entry);
        for (const width of [360, 294] as const) {
            await test.step(`in a ${width}px parent`, async () => {
                await sizeBuilder(page, entry, ROOT, width);
                await expect(queueOf(entry).locator(card(ROTA)), "the open case stays open").toHaveAttribute("data-open", "");
                await expectNarrow(page, entry, `a ${width}px parent`);
            });
        }
        await test.step("the phone example, in its own box", async () => {
            const phone = await visitBuilder(page, PHONE, ROOT, undefined);
            await expect(queueOf(phone).locator(card(FIRST))).toHaveAttribute("data-open", "");
            await openRota(page, phone);
            await expectNarrow(page, phone, "the phone example");
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
