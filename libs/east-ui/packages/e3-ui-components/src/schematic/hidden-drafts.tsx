/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of the rail's choices hide each unsaved change Issues names that the
 * drawing leaves out (#1391, ruled 27 Oct 2026, "Checked in view, said so") —
 * the shared hidden pick (`shared/schedule/hidden.ts`), as the Sheet's Issues
 * and every builder's Search Records ask it. A drafted row waits in its
 * session, drawn nowhere, where its kind's source's narrowing leaves out the
 * row it drafts (`drafted.ts`' `waitingDrafts`): its issue's line names the
 * choices that do, each as the rail words it, asked of e3 through the kind's
 * source's part — the rows read by their keys in one request, and which
 * choices hide them, one request a choice, none again at the same revision and
 * narrowing — and Go to issue clears just those choices, every choice of the
 * source while e3 has not said (`clearHiding`), before the canvas selects the
 * row once the narrowing they leave draws it.
 *
 * Each kind's pick is read by a component of its own, as the sources a
 * builder's tabs follow are (`follow-sources.tsx`) and the Calendar's kinds'
 * picks are (`calendar/hidden.tsx`), so a payload naming another set of kinds
 * keeps each one's hooks in order. A kind asks e3 only of the rows Issues
 * names: while every draft draws, nothing is asked.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, type ReactNode } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useSourceHidden, type SourceHidden } from "../shared/schedule/hidden.js";

/** A kind read through its source of the slice: the kind's slot, and the source's part. */
export interface SchematicHiddenPart {
    /** The kind's slot. */
    readonly slot: string;
    /** Its source's part of the slice. */
    readonly part: ValueTypeOf<RecordSliceBindType>;
}

/** Each kind's hidden pick, by the kind's slot. */
export type SchematicHiddenPicks = ReadonlyMap<string, SourceHidden>;

/** The picks read so far, in order. */
type Read = readonly (readonly [string, SourceHidden])[];

const NOTHING_READ: Read = [];

/** No row asked of a kind. */
const NO_KEYS: readonly string[] = [];

/** Props of {@link HideDrafts}. */
export interface HideDraftsProps {
    /** Each kind read through its source of the slice, in the Schematic's order of its kinds. */
    readonly parts: readonly SchematicHiddenPart[];
    /**
     * The keys of the drafted rows the drawing leaves out that Issues names, by their kind's slot: what each kind's pick
     * asks e3 which choices hide.
     */
    readonly asked: ReadonlyMap<string, readonly string[]>;
    /** What renders with the picks. */
    readonly children: (picks: SchematicHiddenPicks) => ReactNode;
}

/** A step of the reading: the kind at `at`, and the picks read before it. */
interface HideAtProps extends HideDraftsProps {
    readonly at: number;
    readonly read: Read;
}

/**
 * Reads each kind's hidden pick, asking it of the rows Issues names, and renders `children` with them — see the module
 * docs.
 *
 * @param props - The kinds read through their sources, the rows asked of each, and what renders with the picks
 * @returns What `children` renders
 */
export function HideDrafts(props: HideDraftsProps): ReactNode {
    return <HideAt {...props} at={0} read={NOTHING_READ} />;
}

/** The kind at `at`, or — every kind read — what `children` renders. */
function HideAt(props: HideAtProps): ReactNode {
    return props.at < props.parts.length ? <HideKind key={props.parts[props.at]!.slot} {...props} /> : <Hidden read={props.read} render={props.children} />;
}

/** Reads one kind's hidden pick, asking it of the rows Issues names of the kind, then the kinds after it. */
function HideKind(props: HideAtProps): ReactNode {
    const { parts, asked, at, read } = props;
    const { slot, part } = parts[at]!;
    const hidden = useSourceHidden("Schematic", part);
    const keys = asked.get(slot) ?? NO_KEYS;
    // The rows the drawing leaves out as the narrowing does, known hidden: each says so at once, while e3 is asked which
    // choices hide it — each asked once at the record's revision and the narrowing, so a render that moves neither asks
    // nothing. Asked after every render: the revision and the narrowing land in renders of their own.
    const ask = hidden.rows.askIds;
    useEffect(() => {
        if (keys.length > 0) ask(keys, true);
    });
    const next = useMemo((): Read => [...read, [slot, hidden] as const], [read, slot, hidden]);
    return <HideAt {...props} at={at + 1} read={next} />;
}

/** Every kind read: what `render` renders with their picks, by slot. */
function Hidden({ read, render }: { read: Read; render: HideDraftsProps["children"] }): ReactNode {
    const picks = useMemo((): SchematicHiddenPicks => new Map(read), [read]);
    return <>{render(picks)}</>;
}
