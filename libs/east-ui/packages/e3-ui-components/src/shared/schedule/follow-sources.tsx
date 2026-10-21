/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The sources of a builder's rail its tabs follow (#1340, #1345): a tab over
 * a source's rows — the Sheet's templates lists and its author's tabs, the
 * Calendar's templates — shows what that source shows. Each source's
 * visibility is read through the shared source visibility
 * (`useSourceVisibility`), so a choice on the rail narrows every place the
 * source's rows appear; a source the rail does not narrow reads no page and
 * hides nothing. One component reads one source, so a payload naming another
 * set of sources keeps each one's hooks in order.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { StringType, equalFor, none, some, type ArrayType, type ValueTypeOf } from "@elaraai/east";
import type { RowSourceType } from "@elaraai/east-ui";
import type { RecordSlicesChromeType } from "@elaraai/east-ui/internal";
import { useSourceVisibility, type KeyVisibilityWords } from "./visibility.js";
import { useSourceShown, type SourceShown } from "./source-tab.js";

/** The rail's chrome, as a builder's payload carries it. */
type Chrome = ValueTypeOf<typeof RecordSlicesChromeType>;

/** A source's narrowed keys, paged through its part, as a builder's payload carries them. */
type NarrowedKeys = ValueTypeOf<RowSourceType<ArrayType<StringType>>>;

const stringEqual = equalFor(StringType);

/** What one source a builder's tabs follow shows, and how its narrowing stands. */
export interface FollowedSource {
    /** What the source shows of a tab: its keys, whether it is busy or ready, and its own Clear filters. */
    shown: SourceShown;
    /** Why its narrowing could not be read; `undefined` while it reads, or has read. */
    error: string | undefined;
    /** Reads its narrowing again. */
    retry: () => void;
    /** Its name, as its banner says it: its label, else the noun the builder counts it in, else its name. */
    name: string;
}

/** The sources a builder's tabs follow, by the source's name. */
export type FollowedSources = ReadonlyMap<string, FollowedSource>;

/** The sources read so far, in order. */
type Read = readonly (readonly [string, FollowedSource])[];

const NOTHING_READ: Read = [];

/** What a source shows when it narrows nothing: every row, which no read needs. */
const NO_ROWS: readonly { key: string }[] = [];

/** Props of {@link FollowSources}. */
export interface FollowSourcesProps {
    /** The rail; `undefined` with no slice. */
    chrome: Chrome | undefined;
    /** Each source's narrowed keys, paged through its part, by the source's name, as the payload carries them. */
    narrowed: ReadonlyMap<string, NarrowedKeys>;
    /** The sources the builder's tabs follow, each once. */
    sources: readonly string[];
    /** What the builder counts each source in, by its name: a source's name where it has no label of its own. */
    nouns: ReadonlyMap<string, string>;
    /** What a source's failed narrowing says, by the source's name: its results moved while read, or could not be read. */
    said: (name: string) => KeyVisibilityWords;
    /** What renders once every source is read. */
    children: (followed: FollowedSources) => ReactNode;
}

/** A step of the reading: the sources read before this one. */
interface FollowAtProps extends FollowSourcesProps {
    at: number;
    read: Read;
}

/**
 * Reads each source a builder's tabs follow, and renders `children` with
 * what each shows — see the module docs.
 *
 * @param props - The rail, the narrowed keys, the sources, their nouns and what a failed narrowing says
 * @returns What `children` renders
 */
export function FollowSources(props: FollowSourcesProps): ReactNode {
    return <FollowAt {...props} at={0} read={NOTHING_READ} />;
}

/** The source at `at`, or — every source read — what `children` renders. */
function FollowAt(props: FollowAtProps): ReactNode {
    return props.at < props.sources.length ? <FollowOne {...props} /> : <Followed read={props.read} render={props.children} />;
}

/** Reads one source, then the ones after it. */
function FollowOne(props: FollowAtProps): ReactNode {
    const { chrome, narrowed, sources, nouns, said, at, read } = props;
    const source = sources[at]!;
    const part = useMemo(() => chrome?.slice.parts.find((p) => stringEqual(p.source, source)), [chrome, source]);
    const name = part !== undefined && part.label.type === "some" ? part.label.value : nouns.get(source) ?? source;
    const words = useMemo(() => said(name), [said, name]);
    const keys = narrowed.get(source);
    const visibility = useSourceVisibility(chrome, source, keys === undefined ? none : some(keys), NO_ROWS, words);
    const shown = useSourceShown(visibility, part?.slice);
    // The retry reads the part as it stands: one function, whatever renders between.
    const retryRef = useRef(visibility.retry);
    retryRef.current = visibility.retry;
    const retry = useCallback(() => retryRef.current(), []);
    const error = visibility.error;
    const next = useMemo((): Read => [...read, [source, { shown, error, retry, name }] as const], [read, source, shown, error, retry, name]);
    return <FollowAt {...props} at={at + 1} read={next} />;
}

/** Every source read: what `render` renders with them, by name. */
function Followed({ read, render }: { read: Read; render: FollowSourcesProps["children"] }): ReactNode {
    const followed = useMemo((): FollowedSources => new Map(read), [read]);
    return <>{render(followed)}</>;
}
