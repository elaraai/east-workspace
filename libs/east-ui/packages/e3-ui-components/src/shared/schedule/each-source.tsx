/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A read per source of a builder's rail, each in a component of its own, in
 * order — the one chain every builder reads its sources by: what each source
 * a builder's tabs follow shows (`follow-sources.tsx`), and each source's
 * hidden pick (`hidden-pick.tsx`' `HideSources`), the Calendar's event and
 * resource kinds' and the Schematic's kinds'. A read is a hook, and the hooks
 * of a component run in one order: a component a source keeps each source's
 * in order, whatever the number of sources a payload names. What renders with
 * them renders again only as a read is another value: a source whose read
 * holds renders nothing under it.
 *
 * @packageDocumentation
 */

import { useMemo, type ReactNode } from "react";

/** Props of {@link EachSource}. */
export interface EachSourceProps<S, C, R> {
    /** The sources, in order: one component reads each. */
    readonly sources: readonly S[];
    /** What every source's read is given beside its source: the builder's own. */
    readonly context: C;
    /**
     * A source's read: a hook, called in the source's own component, the same function for every source and every render
     * — what it returns stands for the source until it returns another value.
     */
    readonly read: (source: S, context: C) => R;
    /** What renders once every source is read: each source's read, in the sources' order. */
    readonly children: (read: readonly R[]) => ReactNode;
}

/** A step of the chain: the source at `at`, and the reads of those before it. */
interface ReadAtProps<S, C, R> extends EachSourceProps<S, C, R> {
    readonly at: number;
    readonly done: readonly R[];
}

/** No source read yet. */
const NOTHING_READ: readonly never[] = [];

/**
 * Reads each source in a component of its own, in order, and renders `children` with what each read — see the module
 * docs.
 *
 * @param props - The sources, the context their reads are given, the read, and what renders with them
 * @returns What `children` renders
 */
export function EachSource<S, C, R>(props: EachSourceProps<S, C, R>): ReactNode {
    return <ReadAt {...props} at={0} done={NOTHING_READ} />;
}

/** The source at `at`, or — every source read — what `children` renders. */
function ReadAt<S, C, R>(props: ReadAtProps<S, C, R>): ReactNode {
    return props.at < props.sources.length ? <ReadOne {...props} /> : <Read done={props.done} render={props.children} />;
}

/** Reads one source, then the ones after it. */
function ReadOne<S, C, R>(props: ReadAtProps<S, C, R>): ReactNode {
    const { sources, context, read, at, done } = props;
    // The source's read, in this component alone: its hooks keep their order whatever the other sources.
    const one = read(sources[at]!, context);
    const next = useMemo(() => [...done, one], [done, one]);
    return <ReadAt {...props} at={at + 1} done={next} />;
}

/** Every source read: what `render` renders with their reads — the same element while they and `render` hold. */
function Read<R>({ done, render }: { done: readonly R[]; render: (read: readonly R[]) => ReactNode }): ReactNode {
    return useMemo(() => <>{render(done)}</>, [render, done]);
}
