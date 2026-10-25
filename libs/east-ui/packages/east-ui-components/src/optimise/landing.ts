/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The landing and the highlight of a run's result (#1409, #1416; `Optimise
 * Spec.md` §8, §9.3, O7) — one hook every builder runs over its main. A
 * builder marks its entries as the result leaves them (`data-op="add|chg|
 * del|from"`, `data-fill`, `data-opn` on a total the result changed) and
 * calls {@link Landing.land}; the hook measures them after that commit and
 * gives each its cascade delay — the glows in reading order, by column in
 * 12px buckets then top to bottom, a step of min(40ms, 760ms ÷ n), so the
 * whole landing fits in 760ms however large the result (R14) — sets
 * `data-optimise-landing` on main for the flares, and `data-optimise-lit`
 * for the highlight: 8s from the landing (R16), or until {@link Landing.end}
 * — Undo, a new run, Apply or Cancel. The totals flash 120ms after the
 * cascade ends (its n steps), and the landing settles 1500ms after that, as
 * the mock's script has it. The `optimise` recipe draws every state from those
 * attributes; the cascade's delay is the one binding the hook writes
 * (`--optimise-delay`). Everything lands in one render: nothing slides, and
 * the view keeps its scroll and selection (R13). Under reduced motion the
 * recipe cascades nothing, and the steady highlight shows at once (R18).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";

/** How long the highlight lasts from the landing (O7): 8s. */
export const OPTIMISE_HIGHLIGHT_MS = 8000;
/** The most the cascade takes, however large the result (O7). */
export const OPTIMISE_CASCADE_MS = 760;
/** The cascade's step, at most. */
export const OPTIMISE_CASCADE_STEP_MS = 40;
/** Each entry's flare (§8). */
export const OPTIMISE_FLARE_MS = 1400;
/** How long after the cascade ends — its n steps — the totals flash. */
export const OPTIMISE_TOTALS_DELAY_MS = 120;
/** How long after the totals' delay the landing settles, every flare and the flash done (the mock's `end + 1500`). */
export const OPTIMISE_SETTLE_MS = 1500;
/** The width of a column bucket the cascade orders by. */
export const OPTIMISE_COLUMN_PX = 12;
/** How long the steady glow takes to fade at the highlight's end (§8): the recipe's transition. */
export const OPTIMISE_GLOW_FADE_MS = 600;

/** The CSS variable each entry's cascade delay is written to. */
const DELAY_VAR = "--optimise-delay";

/** A box the cascade orders: where it stands. */
export interface CascadeBox { readonly left: number; readonly top: number }

/**
 * The cascade's step for a result of `n` operations: min(40ms, 760ms ÷ n).
 *
 * @param n - How many entries land
 * @returns The step, in ms; 0 for none
 */
export function cascadeStep(n: number): number {
    return n <= 0 ? 0 : Math.min(OPTIMISE_CASCADE_STEP_MS, OPTIMISE_CASCADE_MS / n);
}

/**
 * Reading order over boxes: by column in 12px buckets, then top to bottom;
 * two at one place keep the order given.
 *
 * @param boxes - Where each entry stands
 * @returns The entries' indices, in the order they glow
 */
export function cascadeOrder(boxes: readonly CascadeBox[]): number[] {
    const bucket = (box: CascadeBox) => Math.round(box.left / OPTIMISE_COLUMN_PX);
    return boxes.map((box, i) => ({ box, i }))
        .sort((a, b) => bucket(a.box) - bucket(b.box) || a.box.top - b.box.top || a.i - b.i)
        .map(({ i }) => i);
}

/**
 * Each entry's cascade delay, by its index: its rank in reading order times
 * the step.
 *
 * @param boxes - Where each entry stands
 * @returns The delays, in ms, by the entries' indices
 */
export function cascadeDelays(boxes: readonly CascadeBox[]): number[] {
    const step = cascadeStep(boxes.length);
    const delays = new Array<number>(boxes.length).fill(0);
    cascadeOrder(boxes).forEach((index, rank) => { delays[index] = rank * step; });
    return delays;
}

/**
 * The attributes a builder spreads on its main: what the `optimise` recipe's `landing` slot draws from. An object type,
 * not an interface, so it spreads onto a frame's root through `BuilderFrame`'s `rootProps` (a record of attributes).
 */
export type LandingAttributes = {
    readonly "data-optimise-landing"?: "" | undefined;
    readonly "data-optimise-lit"?: "" | undefined;
};

/** The landing and the highlight, as a builder drives them. */
export interface Landing {
    /** Whether the highlight is on: the steady glow, the ghosts, the banner, the legend's item. */
    readonly lit: boolean;
    /** Whether the entries are landing: their flares are under way. */
    readonly landing: boolean;
    /** The attributes for main. */
    readonly attributes: LandingAttributes;
    /**
     * Lands a run's result: after the commit this is called in, every entry
     * marked `data-op` under main takes its cascade delay and flares, every
     * `data-opn` total flashes after them, and the highlight starts.
     *
     * @param run - The run that landed
     */
    land(run: number): void;
    /** Starts the highlight with no landing: a result with nothing to change, whose banner shows for the highlight. */
    light(): void;
    /** Ends the highlight now: dismiss, Undo, a new run, Apply or Cancel (R16). */
    end(): void;
}

interface Phase { readonly landing: boolean; readonly lit: boolean }
const OFF: Phase = { landing: false, lit: false };

/** The `optimise` recipe's landing styles, for the element a builder spreads {@link Landing.attributes} on. */
export interface LandingStyles {
    /**
     * For a builder's own root, beside its root styles: `css={[styles.root, landingStyles.main]}` — or, for a builder
     * with no root of its own around its frame, the frame's root (`BuilderFrame`'s `rootCss`), never a wrapper of the
     * builder's own around the frame.
     */
    readonly main: SystemStyleObject;
}

/**
 * The `optimise` recipe's landing styles, for the element a builder spreads
 * {@link Landing.attributes} on: what draws the flares, the steady glow, the
 * ghosts and the totals' flash from the attributes its entries carry.
 *
 * @returns The landing slot's styles, for a builder's own root or its frame's
 */
export function useLandingStyles(): LandingStyles {
    const recipe = useSlotRecipe({ key: "optimise" });
    return useMemo(() => {
        const styles = recipe({}) as Record<string, SystemStyleObject>;
        return { main: styles["landing"] ?? {} };
    }, [recipe]);
}

/**
 * The landing and the highlight over a builder's main — see the module docs.
 *
 * @param root - The builder's main: where its entries are measured
 * @returns The landing
 */
export function useLanding(root: RefObject<HTMLElement | null>): Landing {
    const [phase, setPhase] = useState<Phase>(OFF);
    // A landing asked for: measured after the commit that marked the entries, so each delay is from where it stands.
    const [asked, setAsked] = useState<number | undefined>(undefined);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const clearTimers = useCallback(() => { for (const timer of timers.current) clearTimeout(timer); timers.current = []; }, []);
    const after = useCallback((ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); }, []);
    useLayoutEffect(() => {
        if (asked === undefined) return;
        const el = root.current;
        const entries = el === null ? [] : [...el.querySelectorAll<HTMLElement>("[data-op]")];
        const delays = cascadeDelays(entries.map((entry) => entry.getBoundingClientRect()));
        entries.forEach((entry, i) => entry.style.setProperty(DELAY_VAR, `${Math.round(delays[i]!)}ms`));
        // The cascade ends after its n steps; the totals flash 120ms after it, and the landing settles 1500ms after that.
        const end = Math.round(entries.length * cascadeStep(entries.length)) + OPTIMISE_TOTALS_DELAY_MS;
        const totals = el === null ? [] : [...el.querySelectorAll<HTMLElement>("[data-opn]")];
        for (const total of totals) total.style.setProperty(DELAY_VAR, `${end}ms`);
        clearTimers();
        setPhase({ landing: true, lit: true });
        after(end + OPTIMISE_SETTLE_MS, () => setPhase((was) => (was.lit ? { landing: false, lit: true } : OFF)));
        after(OPTIMISE_HIGHLIGHT_MS, () => setPhase(OFF));
        setAsked(undefined);
    }, [asked, root, clearTimers, after]);
    useEffect(() => clearTimers, [clearTimers]);
    const land = useCallback((run: number) => { setAsked(run); }, []);
    const light = useCallback(() => {
        clearTimers();
        setPhase({ landing: false, lit: true });
        after(OPTIMISE_HIGHLIGHT_MS, () => setPhase(OFF));
    }, [clearTimers, after]);
    const end = useCallback(() => { clearTimers(); setAsked(undefined); setPhase(OFF); }, [clearTimers]);
    return useMemo(() => ({
        lit: phase.lit,
        landing: phase.landing,
        attributes: { "data-optimise-landing": phase.landing ? "" : undefined, "data-optimise-lit": phase.lit ? "" : undefined },
        land, light, end,
    }), [phase, land, light, end]);
}
