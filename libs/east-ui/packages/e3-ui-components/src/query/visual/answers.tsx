/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page's visuals' answers (#1670): one {@link VisualAnswersProvider} a page
 * — the Studio's page, its builder's canvas — over the sources it lists, and
 * each tile's {@link useVisualAnswers}. A program is asked on e3 once per the
 * hashes of what it read, however many tiles ask it; a dataset's new hash,
 * which the dataset cache's poll follows without reading its content, asks
 * again only the programs that read it; a tile that goes, or asks another
 * program, stops waiting, and a program no tile waits for is given up.
 *
 * The rules are the asking layer's (`ask.ts`, `summaries.ts`); these hooks
 * hold them for React.
 *
 * @packageDocumentation
 */

import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { StudioSourceType } from "@elaraai/e3-ui/internal";
import { useReactiveDatasetCacheOptional } from "../../platform/dataset-hooks.js";
import { useQueryCall, useQueryCollection, useQueryPlanOptions, useQueryRoot, useQuerySourceStatus, useQuerySplitCall } from "../hooks.js";
import type { QueryRoot } from "../one-shot.js";
import { messageOf } from "../run-draft.js";
import { useQueryWords } from "../words.js";
import { askProgram, VisualAnswers, VisualAskError, type VisualAnswer } from "./ask.js";
import type { VisualAsk } from "./print.js";

/** A listed source, decoded. */
type Source = ValueTypeOf<typeof StudioSourceType>;

/** A page's answers: its sources by key, its kept answers, and the hash of each source as the poll last read it. */
interface PageAnswers {
    readonly sources: ReadonlyMap<string, Source>;
    readonly answers: VisualAnswers;
    readonly hashes: ReadonlyMap<string, string>;
}

const PageAnswersContext = createContext<PageAnswers | null>(null);

/**
 * Each source's hash, by its name in the root, as the dataset cache's
 * workspace poll reads it — its content never fetched; none where no cache
 * is mounted, so an answer is kept until the page goes.
 */
function useSourceHashes(root: QueryRoot | string): ReadonlyMap<string, string> {
    const cache = useReactiveDatasetCacheOptional();
    const [hashes, setHashes] = useState<ReadonlyMap<string, string>>(new Map());
    useEffect(() => {
        const workspace = cache?.getConfig().workspace;
        if (cache === null || workspace === undefined || typeof root === "string") return undefined;
        const stops = root.entries.map((entry) => cache.watchHash(workspace, entry.path, (hash) => setHashes((was) => {
            const next = new Map(was);
            if (hash === null) next.delete(entry.name);
            else next.set(entry.name, hash);
            return next;
        })));
        return () => {
            for (const stop of stops) stop();
        };
    }, [cache, root]);
    return hashes;
}

/** Props of {@link VisualAnswersProvider}. */
export interface VisualAnswersProviderProps {
    /** The sources the page lists. */
    readonly sources: readonly Source[];
    /** The page. */
    readonly children?: ReactNode;
}

/**
 * Asks a page's visuals' programs: on e3, through the query builder's calls
 * (`useQueryCall`, `useQuerySplitCall`, `useQueryCollection`,
 * `useQuerySourceStatus`) and its plan's options, over the root the page's
 * sources make — or a host's own calls, where it provides them.
 *
 * @param props - The sources and the page
 * @returns The page, its tiles able to ask
 */
export function VisualAnswersProvider({ sources, children }: VisualAnswersProviderProps) {
    const words = useQueryWords();
    const bindings = useMemo(() => sources.map((source) => source.binding), [sources]);
    const root = useQueryRoot(bindings, words);
    const call = useQueryCall();
    const split = useQuerySplitCall();
    const collection = useQueryCollection();
    const status = useQuerySourceStatus();
    const options = useQueryPlanOptions();
    const answers = useMemo(() => new VisualAnswers((program, signal) => (typeof root === "string"
        ? Promise.reject(new VisualAskError("refused", root))
        : askProgram(program, root, { call, split, collection, status }, options, signal))), [root, call, split, collection, status, options]);
    const hashes = useSourceHashes(root);
    const byKey = useMemo(() => {
        // A key two sources share keeps the first, as the sources' names do.
        const keyed = new Map<string, Source>();
        for (const source of sources) if (!keyed.has(source.key)) keyed.set(source.key, source);
        return keyed;
    }, [sources]);
    const value = useMemo((): PageAnswers => ({ sources: byKey, answers, hashes }), [byKey, answers, hashes]);
    return createElement(PageAnswersContext.Provider, { value }, children);
}

/**
 * The source a page lists under a key.
 *
 * @param key - The source's key
 * @returns It; `undefined` when the page lists none, or no provider is mounted
 */
export function useVisualSource(key: string): Source | undefined {
    return useContext(PageAnswersContext)?.sources.get(key);
}

/** Where a tile's answers stand. */
export type VisualAnswersState =
    | { readonly status: "waiting" }
    | { readonly status: "failed"; readonly message: string }
    | { readonly status: "answered"; readonly answers: readonly VisualAnswer[] };

/**
 * A tile's answers: each of its programs' answers, in order, once all have
 * landed.
 *
 * @param asks - Its programs, as the printer gave them
 * @param source - The source they read, by its key
 * @returns Waiting; failed, with why, until its programs or the data change;
 *   or answered
 */
export function useVisualAnswers(asks: readonly VisualAsk[], source: string): VisualAnswersState {
    const page = useContext(PageAnswersContext);
    const requests = useMemo(() => asks.map((ask) => ({ prefix: ask.program, reads: [source] })), [asks, source]);
    const key = requests.map((request) => request.prefix).join("\u0001");
    const [failed, setFailed] = useState<{ readonly key: string; readonly message: string } | undefined>(undefined);
    // Bumped when an answer lands, so the tile reads it.
    const [, setLanded] = useState(0);
    const held = page === null ? [] : requests.map((request) => page.answers.get(request, page.hashes));
    const missing = page === null || held.some((answer) => answer === undefined);
    useEffect(() => {
        if (page === null || !missing) return undefined;
        const controller = new AbortController();
        void Promise.all(requests.map((request) => page.answers.ensure(request, page.hashes, controller.signal))).then(
            () => {
                if (!controller.signal.aborted) setLanded((n) => n + 1);
            },
            (err: unknown) => {
                if (!controller.signal.aborted) setFailed({ key, message: messageOf(err) });
            },
        );
        // The tile going, or asking another program, stops it waiting.
        return () => controller.abort();
    }, [page, requests, key, missing]);
    if (page === null) return { status: "failed", message: "" };
    if (!missing) return { status: "answered", answers: held as VisualAnswer[] };
    if (failed?.key === key) return { status: "failed", message: failed.message };
    return { status: "waiting" };
}
