/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Calendar's hidden pick (#1398), as the Allocation's and the Roster's
 * are (the shared hidden pick, `shared/schedule/hidden.ts`): an event Search
 * Records finds that its kind's source of the slice hides — its choices, never
 * its window, which the Calendar's navigation writes and a pick steps to — is
 * named by the choices that hide it, each as the rail words it, asked of e3
 * through the kind's source's part: which of the events the box lists its
 * choices hide, in one read, and which of them hide those, one request a
 * choice, none again at the same revision and narrowing. A pick of it clears
 * just those choices — every choice of the source while e3 has not said — its
 * window kept, a write of the rail like a chip's.
 *
 * Each kind's pick is read by a component of its own, as the sources a
 * builder's tabs follow are (`follow-sources.tsx`), so a payload naming
 * another set of kinds keeps each one's hooks in order. What renders with them
 * renders again only as a pick moves: a step of the window, or a revision that
 * says nothing new, renders nothing under them.
 *
 * @packageDocumentation
 */

import { useMemo, useRef, type ReactNode } from "react";
import { useSourceHidden, type SourceHidden } from "../shared/schedule/hidden.js";
import type { CalendarEventPart } from "./window.js";

/** An event kind's hidden pick: its source's, over the source's choices but its window, and the field its window holds. */
export interface KindHidden extends SourceHidden {
    /** The field of the source's narrowing the Calendar's window holds; `undefined` for a source that holds none. */
    readonly window: string | undefined;
    /** Moves as the source's choices do: what Search Records lists its lines again by, as it does as answers land. */
    readonly moves: number;
}

/** Each event kind narrowed through its source of the slice, its hidden pick, by the kind's slot. */
export type HiddenEvents = ReadonlyMap<string, KindHidden>;

/** The kinds read so far, in order. */
type Read = readonly (readonly [string, KindHidden])[];

const NOTHING_READ: Read = [];

/** Props of {@link HideEvents}. */
interface HideEventsProps {
    /** Each event kind narrowed through its source of the slice, in the kinds' order. */
    readonly parts: readonly CalendarEventPart[];
    /** What renders with each kind's hidden pick. */
    readonly children: (hidden: HiddenEvents) => ReactNode;
}

/**
 * Reads each event kind's hidden pick, and renders `children` with them — see the module docs.
 *
 * @param props - The kinds narrowed through their sources, and what renders with their picks
 * @returns What `children` renders
 */
export function HideEvents(props: HideEventsProps): ReactNode {
    return <HideAt {...props} at={0} read={NOTHING_READ} />;
}

/** The kind at `at`, or — every kind read — what `children` renders. */
function HideAt(props: HideEventsProps & { at: number; read: Read }): ReactNode {
    return props.at < props.parts.length ? <HideOne {...props} /> : <Hidden read={props.read} render={props.children} />;
}

/** Reads one kind's hidden pick, then the kinds after it. */
function HideOne(props: HideEventsProps & { at: number; read: Read }): ReactNode {
    const { parts, at, read } = props;
    const { kind, part } = parts[at]!;
    // The window the Calendar writes is its source's range: never a choice that hides an event.
    const window = part.config.range.type === "some" ? part.config.range.value : undefined;
    const hidden = useSourceHidden("Calendar", part, window);
    // Its choices, counted as they move: the same narrowing object while they hold, whatever the window.
    const seen = useRef({ where: hidden.where, moves: 0 });
    if (!Object.is(seen.current.where, hidden.where)) seen.current = { where: hidden.where, moves: seen.current.moves + 1 };
    const moves = seen.current.moves;
    const next = useMemo((): Read => [...read, [kind.key, { ...hidden, window, moves }] as const], [read, kind.key, hidden, window, moves]);
    return <HideAt {...props} at={at + 1} read={next} />;
}

/** Every kind read: what `render` renders with their picks, by slot — the same element while they and `render` hold. */
function Hidden({ read, render }: { read: Read; render: HideEventsProps["children"] }): ReactNode {
    const hidden = useMemo((): HiddenEvents => new Map(read), [read]);
    return useMemo(() => <>{render(hidden)}</>, [render, hidden]);
}

/**
 * Moves as e3 says what hides an event of any kind, and as a kind's choices move: what the box lists its lines again by.
 *
 * @param hidden - Each kind's hidden pick
 * @returns The sum of their versions and their choices' moves
 */
export function hiddenVersion(hidden: HiddenEvents): number {
    let version = 0;
    for (const kind of hidden.values()) version += kind.rows.version + kind.moves;
    return version;
}
