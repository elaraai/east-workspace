/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The hidden pick's React parts (#1398), beside its reads and its words
 * (`hidden.ts`): each source's pick read in a component of its own, in order
 * ({@link HideSources}, over the shared chain `each-source.tsx`), and the pick
 * of a row — of the key search, or Go to issue — that the rail's narrowing may
 * hide ({@link useHiddenPick}).
 *
 * A pick clears what hides the row — each source's choices e3 named, every
 * choice of a source while it has not said — catching a clear that throws and
 * saying why where the builder says a gesture's error, the keyboard left where
 * it is; then goes to the row, as the builder goes — its selection, a step to
 * its period; then, once the builder draws it under the narrowing the pick
 * left, selects it where the builder selects it only then, and hands it the
 * keyboard (east-ui-components' `usePickHandOff`): a pick of the box's does,
 * once the box has let the keyboard go, unless the viewer has moved on; a step
 * through the matches, or Go to issue, leaves it where it is.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { usePickHandOff, type PickHandOff, type PickingSource } from "@elaraai/east-ui-components/internal";
import { EachSource } from "./each-source.js";
import { clearHidden, useSourceHidden, type SourceHidden, type SourceHiding } from "./hidden.js";

/** One source a builder's hidden picks are read over. */
export interface HiddenSource {
    /** What its pick is kept by: the source's name — a kind's slot. */
    readonly key: string;
    /** The source's part of the slice. */
    readonly part: ValueTypeOf<RecordSliceBindType>;
    /** The field of its narrowing the builder's navigation writes — an event kind's window — which hides no row; none by default. */
    readonly window?: string | undefined;
}

/** Each source's hidden pick, by its key. */
export type HiddenPicks = ReadonlyMap<string, SourceHidden>;

/** Props of {@link HideSources}. */
export interface HideSourcesProps {
    /** Who asks, as the console names it when a read fails: `Calendar`, `Schematic`. */
    readonly name: string;
    /** The sources, in the builder's order, each once. */
    readonly sources: readonly HiddenSource[];
    /** What renders with their picks. */
    readonly children: (picks: HiddenPicks) => ReactNode;
}

/**
 * Reads each source's hidden pick in a component of its own, in order — so a payload naming another set of sources keeps
 * each one's hooks in order — and renders `children` with them, again only as a pick moves: a step of a window it keeps,
 * or a revision that says nothing new, renders nothing under it.
 *
 * @param props - Who asks, the sources, and what renders with their picks
 * @returns What `children` renders
 */
export function HideSources({ name, sources, children }: HideSourcesProps): ReactNode {
    return (
        <EachSource sources={sources} context={name} read={useHiddenSource}>
            {(read) => <Picked read={read} render={children} />}
        </EachSource>
    );
}

/** One source's pick read: its key, and the pick. */
type PickedEntry = readonly [string, SourceHidden];

/**
 * One source's hidden pick, read in its own component.
 *
 * @param source - The source
 * @param name - Who asks
 * @returns Its key and its pick, the same pair while they hold
 */
function useHiddenSource(source: HiddenSource, name: string): PickedEntry {
    const pick = useSourceHidden(name, source.part, source.window);
    const { key } = source;
    return useMemo((): PickedEntry => [key, pick], [key, pick]);
}

/** Every source's pick read: what `render` renders with them, by key — the same map while each source's pick holds. */
function Picked({ read, render }: { read: readonly PickedEntry[]; render: HideSourcesProps["children"] }): ReactNode {
    const picks = useMemo((): HiddenPicks => new Map(read), [read]);
    return <>{render(picks)}</>;
}

/** How a pick lands, where the builder waits for it to draw the row the pick goes to. */
export interface PickLanding<T> {
    /** Whether the builder draws the row now, under the narrowing the pick left and in the period it went to, read: it lands then. */
    readonly drawn: (target: T) => boolean;
    /**
     * What the builder does as it lands, beside the keyboard: the Allocation selects its bin then, its day read, and the
     * Schematic its item, the narrowing it was context under gone; none where it selected the row as it went.
     */
    readonly selects?: ((target: T) => void) | undefined;
    /**
     * Brings the keyboard to the row, drawn: where its ring is — a person's name, an event's block, a bin's card; none
     * where the builder hands its view no keyboard (the Schematic's Find).
     */
    readonly focus?: ((target: T) => void) | undefined;
}

/** What {@link useHiddenPick} says a failed clear in, and how a pick lands. */
export interface HiddenPickOptions<T> {
    /** Says why the choices hiding a row could not be cleared, where the builder says a gesture's error: the clear's own words, else `uncleared`. */
    readonly onError: (words: string, reason: unknown) => void;
    /** What it says where a clear threw no words of its own: `The filters hiding the bin could not be cleared`. */
    readonly uncleared: string;
    /** How a pick lands; none where the builder lands its rows itself — the Sheet's lens's jump, the Schematic's canvas. */
    readonly landing?: PickLanding<T> | undefined;
}

/** A builder's pick of a row the rail's narrowing may hide — see the module docs. */
export interface HiddenPick<T> {
    /**
     * The key search's source, as the box drives it: a pick arms the hand-off of the keyboard, a step or a clear drops
     * it. A builder keeps the one it made while its source holds.
     */
    readonly search: <S extends PickingSource>(source: S) => S;
    /**
     * A pick of a row: what hides it cleared, then the builder's own `go`, then — while it lands — the row selected and
     * handed the keyboard once the builder draws it.
     *
     * @param hidden - What hides the row, each source's and what e3 said hides it there; `undefined` where nothing does
     * @param target - The row, as the builder's landing reads it
     * @param go - The builder's own going to it — its selection, a step to its period — `false` where it draws the row
     *   nowhere (an event waiting in the backlog): nothing lands, the keyboard left where it is
     */
    readonly pick: (hidden: readonly SourceHiding[] | undefined, target: T, go: () => boolean | void) => void;
    /**
     * Clears what hides a row, for a builder whose own reveal lands it — the Sheet's lens's jump, the Schematic's canvas.
     *
     * @param hidden - What hides it; `undefined` where nothing does
     * @returns Whether every source's choices were cleared; `false` where a clear threw — said where the builder says a
     *   gesture's error, the keyboard left where it is
     */
    readonly clear: (hidden: readonly SourceHiding[] | undefined) => boolean;
    /** The hand-off of the keyboard the box's picks arm: what a builder that lands its rows itself lands it through. */
    readonly handOff: PickHandOff;
}

/**
 * A builder's pick of a row the rail's narrowing may hide — see the module docs.
 *
 * @param options - Where a failed clear is said, and how a pick lands
 * @returns The pick: the box's source, the pick, the clear alone, and the hand-off
 */
export function useHiddenPick<T = never>(options: HiddenPickOptions<T>): HiddenPick<T> {
    const handOff = usePickHandOff();
    // The latest options: a pick and its landing read them as they run.
    const latest = useRef(options);
    latest.current = options;
    // The row a pick goes to, waiting for the builder to draw it; a pick renders the builder again, so whether it is drawn
    // already is asked at once.
    const waiting = useRef<{ readonly target: T } | undefined>(undefined);
    const [, setPicked] = useState(0);
    const clear = useCallback((hidden: readonly SourceHiding[] | undefined): boolean => {
        if (hidden === undefined) return true;
        try {
            clearHidden(hidden);
            return true;
        } catch (reason) {
            // The narrowing stands, so nothing will draw the row: nothing takes the keyboard, which stays where it is.
            handOff.drop();
            const { onError, uncleared } = latest.current;
            onError(reason instanceof Error ? reason.message : uncleared, reason);
            return false;
        }
    }, [handOff]);
    const pick = useCallback((hidden: readonly SourceHiding[] | undefined, target: T, go: () => boolean | void) => {
        if (!clear(hidden)) return;
        if (go() === false || latest.current.landing === undefined) {
            handOff.drop();
            waiting.current = undefined;
            return;
        }
        waiting.current = { target };
        setPicked((n) => n + 1);
    }, [clear, handOff]);
    // Landed once the builder draws the row: asked after every render, as what draws it — the narrowing the pick left, the
    // period it went to — lands in renders of its own.
    useEffect(() => {
        const landing = latest.current.landing;
        const now = waiting.current;
        if (now === undefined || landing === undefined || !landing.drawn(now.target)) return;
        waiting.current = undefined;
        landing.selects?.(now.target);
        const focus = landing.focus;
        if (focus !== undefined) handOff.land(() => focus(now.target));
    });
    const search = useCallback(<S extends PickingSource>(source: S): S => handOff.search(source), [handOff]);
    return useMemo(() => ({ search, pick, clear, handOff }), [search, pick, clear, handOff]);
}
