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
 * Where the layout lays resources out — the timeline's rows, the Resources
 * view's columns — an event is hidden too where its resource kind's source of
 * the slice hides its resource, as the Allocation's bin is by its lane's, its
 * arrival's and its resource's sources: the resources a source shows, where
 * the Calendar follows it, or — the paged kind's, whose windows are its
 * narrowing's rows themselves — which of them its narrowing holds, asked of e3
 * by their keys. Its line names that source's choices beside its kind's own,
 * and a pick clears them too. The time grids, the month and the agenda narrow
 * no event by its resource.
 *
 * Each source's pick is read by a component of its own, as the sources a
 * builder's tabs follow are (`follow-sources.tsx`), so a payload naming
 * another set of kinds keeps each one's hooks in order. What renders with them
 * renders again only as a pick moves: a step of the window, or a revision that
 * says nothing new, renders nothing under them.
 *
 * @packageDocumentation
 */

import { useMemo, useRef, type ReactNode } from "react";
import type { ValueTypeOf, option } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import type { FollowedSources } from "../shared/schedule/follow-sources.js";
import { useSourceHidden, type SourceHidden } from "../shared/schedule/hidden.js";
import type { CalendarEventPart } from "./window.js";

/** An event kind's hidden pick: its source's, over the source's choices but its window, and the field its window holds. */
export interface KindHidden extends SourceHidden {
    /** The field of the source's narrowing the Calendar's window holds; `undefined` for a source that holds none. */
    readonly window: string | undefined;
    /** Moves as the source's choices do: what Search Records lists its lines again by, as it does as answers land. */
    readonly moves: number;
}

/** A resource kind's hidden pick: its source's, and what the source shows of the kind. */
export interface ResourceHidden extends SourceHidden {
    /**
     * The resources the source shows, by their keys, where the Calendar follows it — `none` while it narrows none;
     * `undefined` for the paged kind, whose windows are its narrowing's rows themselves: which of its resources the
     * narrowing holds is asked of e3.
     */
    readonly shown: option<ReadonlySet<string>> | undefined;
    /** Moves as the source's choices, or the resources it shows, do: what Search Records lists its lines again by. */
    readonly moves: number;
}

/** A resource kind narrowed through its source of the slice: the kind's slot, and the source's part. */
export interface CalendarResourcePart {
    readonly kind: string;
    readonly part: ValueTypeOf<RecordSliceBindType>;
}

/** Each event kind's hidden pick and each resource kind's, by the kind's slot. */
export interface HiddenEvents {
    readonly kinds: ReadonlyMap<string, KindHidden>;
    readonly resources: ReadonlyMap<string, ResourceHidden>;
}

/** The picks read so far, in order. */
type KindsRead = readonly (readonly [string, KindHidden])[];
type ResourcesRead = readonly (readonly [string, ResourceHidden])[];

const NO_KINDS: KindsRead = [];
const NO_RESOURCES: ResourcesRead = [];

/** Props of {@link HideEvents}. */
interface HideEventsProps {
    /** Each event kind narrowed through its source of the slice, in the kinds' order. */
    readonly parts: readonly CalendarEventPart[];
    /** Each resource kind narrowed through its source of the slice, in the kinds' order. */
    readonly resources: readonly CalendarResourcePart[];
    /** The sources the Calendar follows: what each resource kind's shows, but the paged kind's. */
    readonly followed: FollowedSources;
    /** What renders with the picks. */
    readonly children: (hidden: HiddenEvents) => ReactNode;
}

/** A step of the reading: the source at `at` — the event kinds' first, then the resource kinds' — and the picks before it. */
interface HideAtProps extends HideEventsProps {
    readonly at: number;
    readonly kindsRead: KindsRead;
    readonly resourcesRead: ResourcesRead;
}

/**
 * Reads each event kind's hidden pick and each resource kind's, and renders `children` with them — see the module docs.
 *
 * @param props - The kinds narrowed through their sources, the sources the Calendar follows, and what renders with the picks
 * @returns What `children` renders
 */
export function HideEvents(props: HideEventsProps): ReactNode {
    return <HideAt {...props} at={0} kindsRead={NO_KINDS} resourcesRead={NO_RESOURCES} />;
}

/** The source at `at`, or — every one read — what `children` renders. */
function HideAt(props: HideAtProps): ReactNode {
    if (props.at < props.parts.length) return <HideKind {...props} />;
    if (props.at < props.parts.length + props.resources.length) return <HideResource {...props} />;
    return <Hidden kindsRead={props.kindsRead} resourcesRead={props.resourcesRead} render={props.children} />;
}

/** Reads one event kind's hidden pick, then the sources after it. */
function HideKind(props: HideAtProps): ReactNode {
    const { parts, at, kindsRead } = props;
    const { kind, part } = parts[at]!;
    // The window the Calendar writes is its source's range: never a choice that hides an event.
    const window = part.config.range.type === "some" ? part.config.range.value : undefined;
    const hidden = useSourceHidden("Calendar", part, window);
    // Its choices, counted as they move: the same narrowing object while they hold, whatever the window.
    const seen = useRef({ where: hidden.where, moves: 0 });
    if (!Object.is(seen.current.where, hidden.where)) seen.current = { where: hidden.where, moves: seen.current.moves + 1 };
    const moves = seen.current.moves;
    const next = useMemo((): KindsRead => [...kindsRead, [kind.key, { ...hidden, window, moves }] as const], [kindsRead, kind.key, hidden, window, moves]);
    return <HideAt {...props} at={at + 1} kindsRead={next} />;
}

/** Reads one resource kind's hidden pick, then the sources after it. */
function HideResource(props: HideAtProps): ReactNode {
    const { parts, resources, followed, at, resourcesRead } = props;
    const { kind, part } = resources[at - parts.length]!;
    const hidden = useSourceHidden("Calendar", part);
    // What its source shows, where the Calendar follows it: the paged kind's source it follows not.
    const shown = followed.get(kind)?.shown.keys;
    // Its choices and what they show, counted as they move.
    const seen = useRef({ where: hidden.where, shown, moves: 0 });
    if (!Object.is(seen.current.where, hidden.where) || !Object.is(seen.current.shown, shown)) {
        seen.current = { where: hidden.where, shown, moves: seen.current.moves + 1 };
    }
    const moves = seen.current.moves;
    const next = useMemo((): ResourcesRead => [...resourcesRead, [kind, { ...hidden, shown, moves }] as const], [resourcesRead, kind, hidden, shown, moves]);
    return <HideAt {...props} at={at + 1} resourcesRead={next} />;
}

/** Every source read: what `render` renders with their picks, by slot — the same element while they and `render` hold. */
function Hidden({ kindsRead, resourcesRead, render }: { kindsRead: KindsRead; resourcesRead: ResourcesRead; render: HideEventsProps["children"] }): ReactNode {
    const hidden = useMemo((): HiddenEvents => ({ kinds: new Map(kindsRead), resources: new Map(resourcesRead) }), [kindsRead, resourcesRead]);
    return useMemo(() => <>{render(hidden)}</>, [render, hidden]);
}

/**
 * Moves as e3 says what hides an event, and as a source's choices — or what a resource kind's shows — move: what the box
 * lists its lines again by.
 *
 * @param hidden - Each kind's hidden pick
 * @returns The sum of their versions and their moves
 */
export function hiddenVersion(hidden: HiddenEvents): number {
    let version = 0;
    for (const kind of hidden.kinds.values()) version += kind.rows.version + kind.moves;
    for (const kind of hidden.resources.values()) version += kind.rows.version + kind.moves;
    return version;
}
