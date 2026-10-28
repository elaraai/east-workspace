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
 * hides nothing. One component reads one source — the shared chain,
 * `each-source.tsx` — so a payload naming another set of sources keeps each
 * one's hooks in order.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { StringType, equalFor, none, some, type ArrayType, type ValueTypeOf } from "@elaraai/east";
import type { RowSourceType } from "@elaraai/east-ui";
import type { RecordSlicesChromeType } from "@elaraai/east-ui/internal";
import { EachSource } from "./each-source.js";
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

/** What it does not narrow shows every row, which no read needs. */
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

/** What every source's read is given: the rail, the narrowed keys, the nouns and the words. */
type FollowContext = Pick<FollowSourcesProps, "chrome" | "narrowed" | "nouns" | "said">;

/** One source read: its name, and what it shows. */
type FollowedEntry = readonly [string, FollowedSource];

/**
 * Reads each source a builder's tabs follow, and renders `children` with
 * what each shows — see the module docs.
 *
 * @param props - The rail, the narrowed keys, the sources, their nouns and what a failed narrowing says
 * @returns What `children` renders
 */
export function FollowSources({ chrome, narrowed, sources, nouns, said, children }: FollowSourcesProps): ReactNode {
    const context = useMemo((): FollowContext => ({ chrome, narrowed, nouns, said }), [chrome, narrowed, nouns, said]);
    return (
        <EachSource sources={sources} context={context} read={useFollowedSource}>
            {(read) => <Followed read={read} render={children} />}
        </EachSource>
    );
}

/**
 * One source a builder's tabs follow, read in its own component: what it shows and how its narrowing stands.
 *
 * @param source - The source's name
 * @param context - The rail, the narrowed keys, the nouns and the words
 * @returns The source's name and what it shows, the same pair while they hold
 */
function useFollowedSource(source: string, context: FollowContext): FollowedEntry {
    const { chrome, narrowed, nouns, said } = context;
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
    return useMemo((): FollowedEntry => [source, { shown, error, retry, name }], [source, shown, error, retry, name]);
}

/** Every source read: what `render` renders with them, by name — the same map while each source's read holds. */
function Followed({ read, render }: { read: readonly FollowedEntry[]; render: FollowSourcesProps["children"] }): ReactNode {
    const followed = useMemo((): FollowedSources => new Map(read), [read]);
    return <>{render(followed)}</>;
}
