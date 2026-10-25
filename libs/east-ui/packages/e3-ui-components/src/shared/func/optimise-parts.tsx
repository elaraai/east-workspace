/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What every builder draws of a run of the app's optimiser (#1409; `Optimise
 * Spec.md` §6, §7): the eye in its toolbar, before the history item; the
 * banner in its banners slot while the highlight is on, or until the next run
 * on failure — a title and one line, no actions and no close, as the mock's
 * alert is; the footer line while the call is out and for 2.5s after Stop;
 * the legend's `Elara change` during the highlight; and the lock while the
 * call is out. One hook over the run (`useOptimise`) and the landing
 * (east-ui-components' `useLanding`), so each builder lists the parts in its
 * frame and draws nothing of them itself.
 *
 * A result lands once the builder's own reads hold it: a step recorded moves
 * the drafts, the builder reads its rows again, and only then do its entries
 * carry the run's marks. So the landing waits for the builder's data to move
 * ({@link OptimisePartsArgs.landKey}) before it measures the entries and
 * starts the cascade — on a result, and on a Redo that re-inserts the run's
 * step, which replays the landing without the banner (R9).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    OptimiseBanner, optimiseRunningLine, optimiseStoppedLine, optimiseToolbarItem,
    type HistoryAction, type Landing, type OptimiseButtonSize, type OptimiseOutcome, type ToolbarItem,
} from "@elaraai/east-ui-components";
import type { LoadingLineValue } from "@elaraai/east-ui-components/internal";
import type { OptimiseRun } from "./use-optimise.js";

/**
 * What the parts are made over.
 *
 * @typeParam Req - The run's request
 */
export interface OptimisePartsArgs<Req> {
    /** The run. */
    readonly run: OptimiseRun<Req>;
    /** The landing over the builder's frame. */
    readonly landing: Landing;
    /** The period's label — `W11`, `Oct 5 – 9`, `8 work orders` — which the eye, the footer line and the banner name. */
    readonly period: string;
    /**
     * Whether the period cannot be optimised at all — read only, published, a month in view (ruled 25 Oct 2026, over
     * D1): the builder lists no eye, rather than a disabled one.
     */
    readonly readOnly: boolean;
    /**
     * Whether the period cannot take a run yet — its reads in flight, a save under way: the eye disabled, its place
     * kept, so a period step moves nothing in the toolbar.
     */
    readonly busy?: boolean | undefined;
    /** The run's request for a run number: the period's rows as the session holds them, and the builder's context. */
    readonly request: (run: number) => Req;
    /**
     * What moves when the builder's reads hold a step's drafts — its rows as read, by identity: a result lands once it
     * has moved from where it stood as the step was recorded.
     */
    readonly landKey: unknown;
    /** The eye's size: `toolbar` — 32 × 28, the builders' toolbar rows' — unless given. */
    readonly size?: OptimiseButtonSize | undefined;
}

/** The parts, as a builder lists them in its frame. */
export interface OptimiseParts {
    /** The eye's toolbar item, to list immediately before the history item; `undefined` with no optimiser, or where the period cannot be optimised. */
    readonly toolbarItem: ToolbarItem | undefined;
    /** The banner, for the banners slot; nothing with no optimiser. */
    readonly banner: ReactNode;
    /** The footer line while the call is out or just stopped; `undefined` otherwise, when the builder's own line shows. */
    readonly line: LoadingLineValue | undefined;
    /** Whether the legend's `Elara change` shows: the highlight is on over a run that changed something. */
    readonly legend: boolean;
    /** Whether the builder holds its lock (R2): a call is out. */
    readonly locked: boolean;
    /**
     * Lands a run's result once the builder's reads hold it: called as the step is recorded, it waits for `landKey`
     * to move, then starts the cascade and the highlight.
     *
     * @param run - The run that landed
     */
    landAfter(run: number): void;
    /**
     * A history action the builder is about to run, heard first (R9, R16): Undo, Apply and Discard end the highlight;
     * a Redo that re-inserts a run's step replays its landing without the banner.
     *
     * @param action - The action
     * @param redoOrigin - The origin of the step the Redo would re-insert, when the action is one
     */
    acted(action: HistoryAction, redoOrigin?: string | undefined): void;
}

/**
 * The parts of a run, over the run and the landing (see the module docs).
 *
 * @typeParam Req - The run's request
 * @param args - The run, the landing, the period, its request and what moves as the builder's reads do
 * @returns The parts
 */
export function useOptimiseParts<Req>({ run, landing, period, readOnly, busy = false, request, landKey, size = "toolbar" }: OptimisePartsArgs<Req>): OptimiseParts {
    // Whether the banner stays away for this highlight: a Redo's replay (R9).
    const [quiet, setQuiet] = useState(false);
    // A landing waiting for the builder's reads to move from where they stood as its step was recorded.
    const [waiting, setWaiting] = useState<{ run: number; key: unknown } | undefined>(undefined);
    const live = useRef({ request, period, landKey });
    live.current = { request, period, landKey };
    // The landing's commands hold still while its phase moves: what the effects below hang on, never the landing itself.
    const { land, light, end, lit } = landing;
    useLayoutEffect(() => {
        if (waiting === undefined || Object.is(waiting.key, landKey)) return;
        setWaiting(undefined);
        land(waiting.run);
    }, [waiting, landKey, land]);
    const landAfter = useCallback((landed: number) => { setWaiting({ run: landed, key: live.current.landKey }); }, []);
    const onRun = useCallback(() => {
        // A run during a highlight ends the highlight first (R12).
        end();
        setQuiet(false);
        run.start(live.current.request, live.current.period);
    }, [end, run]);
    const { outcome } = run;
    // A result with nothing to change lights the highlight with no landing: its banner shows for the 8s (R10) — once per outcome.
    useEffect(() => {
        if (outcome?.kind === "none") light();
    }, [outcome, light]);
    // A period that can no longer be optimised while its run is out — a month opened over the week, the week published —
    // takes the eye with it, so the run stops as a period change stops one (O4): nothing is left running with no Stop.
    const { running, stop } = run;
    useEffect(() => {
        if (readOnly && running) stop();
    }, [readOnly, running, stop]);
    const toolbarItem = useMemo(() => run.offered && !readOnly ? optimiseToolbarItem({
        period, running: run.running, blink: run.blinks, disabled: busy, onRun, onStop: run.stop, size,
    }) : undefined, [run.offered, run.running, run.blinks, run.stop, period, readOnly, busy, onRun, size]);
    const shown: OptimiseOutcome | undefined = useMemo(() => {
        if (outcome === undefined) return undefined;
        if (outcome.kind === "fail") return { kind: "fail", period: outcome.period };
        if (!lit || quiet) return undefined;
        return outcome.kind === "done"
            ? { kind: "done", period: outcome.period, added: outcome.counts.added, changed: outcome.counts.changed, removed: outcome.counts.removed }
            : { kind: "none", period: outcome.period };
    }, [outcome, lit, quiet]);
    // No close on the banner (§8): done and none go with the highlight, a failure with the next run.
    const banner = useMemo(() => run.offered ? <OptimiseBanner outcome={shown} /> : null, [run.offered, shown]);
    const line = run.running ? optimiseRunningLine(period, run.seconds) : run.stopped ? optimiseStoppedLine() : undefined;
    const acted = useCallback((action: HistoryAction, redoOrigin?: string) => {
        if (action === "undo" || action === "apply" || action === "discard") end();
        else if (action === "redo" && redoOrigin === "optimise" && outcome?.kind === "done") { setQuiet(true); landAfter(outcome.run); }
    }, [end, outcome, landAfter]);
    return useMemo(() => ({ toolbarItem, banner, line, legend: lit && outcome?.kind === "done", locked: run.running, landAfter, acted }),
        [toolbarItem, banner, line, lit, outcome, run.running, landAfter, acted]);
}
