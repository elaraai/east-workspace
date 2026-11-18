/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page's visuals' answers (#1670): one {@link VisualAnswersProvider} a page
 * — the Studio's page, its builder's canvas and the preview beside it — over
 * the sources it lists, and each tile's {@link useVisualAnswers}. A program is
 * asked on e3 once per the hashes of what it read, however many tiles ask it;
 * a dataset's new hash, which the dataset cache's poll follows without
 * reading its content, asks again only the programs that read it, and a new
 * minute only those that read `.now` — the only tiles that draw again as it
 * moves on; a tile asked again keeps what it drew until its new answers land;
 * a tile that goes, or asks another program, stops waiting, and a program no
 * tile waits for is given up. A source the page cannot query fails only the
 * visuals that read it, and a tile whose call failed offers to ask again.
 *
 * The rules are the asking layer's (`ask.ts`, `summaries.ts`); these hooks
 * hold them for React.
 *
 * @packageDocumentation
 */

import { createContext, createElement, Fragment, use, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrayType, DateTimeType, equalFor, type ValueTypeOf } from "@elaraai/east";
import { StudioSourceType } from "@elaraai/e3-ui/internal";
import { useReactiveDatasetCacheOptional } from "../../platform/dataset-hooks.js";
import { messageOf } from "../../shared/message.js";
import { useNow } from "../../shared/time/now-line.js";
import { useQueryCall, useQueryCollection, useQueryPlanOptions, useQuerySourceStatus, useQuerySourcesRoot, useQuerySplitCall } from "../hooks.js";
import { withMinute } from "../model/summaries.js";
import { NOW_FIELD, minuteOf, rootHasClock, type QueryRoot } from "../one-shot.js";
import type { PlanOptions } from "../plan.js";
import type { DraftRunSeams } from "../run-draft.js";
import { useQueryWords } from "../words.js";
import { askProgram, VisualAnswers, VisualAskError, type VisualAnswer, type VisualRequest } from "./ask.js";
import type { VisualAsk } from "./print.js";

/** A listed source, decoded. */
type Source = ValueTypeOf<typeof StudioSourceType>;

const sourcesEqual = equalFor(ArrayType(StudioSourceType));
const sameMinute = equalFor(DateTimeType);

/**
 * A page's answers: the sources it lists, and by key; the root its programs
 * read, where it has sources to query; its kept answers; the hash of each
 * source as the poll last read it; whether the root's `.now` is the clock; why
 * each source it cannot query cannot, by key; and the minute it is when an ask
 * is made. The minute a tile draws by is apart from these, in
 * {@link PageMinuteContext}: as it moves on, these stay as they were.
 */
interface PageAnswers {
    readonly list: Source[];
    readonly sources: ReadonlyMap<string, Source>;
    readonly root: QueryRoot | undefined;
    readonly answers: VisualAnswers;
    readonly hashes: ReadonlyMap<string, string>;
    readonly clock: boolean;
    readonly refused: ReadonlyMap<string, string>;
    readonly minute: () => Date;
}

const PageAnswersContext = createContext<PageAnswers | null>(null);

/**
 * The minute a page takes as now (#1670): apart from its answers, so that
 * only what reads it — a tile whose programs read `.now`, the filters that
 * count back from it — draws again as it moves on.
 */
const PageMinuteContext = createContext<Date | undefined>(undefined);

/**
 * The hashes a tile's programs are kept by: the page's of its sources, and —
 * for programs that read `.now`, where it is the clock — the minute they are
 * asked for, under `now`.
 *
 * @param page - The page's answers
 * @param minute - The minute; `undefined` where none of the programs reads `.now`
 * @returns The hashes
 */
function hashesOf(page: PageAnswers, minute: Date | undefined): ReadonlyMap<string, string> {
    return minute !== undefined && page.clock ? withMinute(page.hashes, minute) : page.hashes;
}

/**
 * Each source's hash, by its name in the root, as the dataset cache's
 * workspace poll reads it — its content never fetched; none where no cache
 * is mounted, so an answer is kept until the page goes.
 */
function useSourceHashes(root: QueryRoot | undefined): ReadonlyMap<string, string> {
    const cache = useReactiveDatasetCacheOptional();
    const [hashes, setHashes] = useState<ReadonlyMap<string, string>>(new Map());
    useEffect(() => {
        const workspace = cache?.getConfig().workspace;
        if (cache === null || workspace === undefined || root === undefined) return undefined;
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
    /** The instant the page takes as now, whose minute a program reads as `.now` — a test's or a showcase's; the clock, read at each minute, when omitted. */
    readonly now?: Date | undefined;
    /** The page. */
    readonly children?: ReactNode;
}

/**
 * Asks a page's visuals' programs: on e3, through the query builder's calls
 * (`useQueryCall`, `useQuerySplitCall`, `useQueryCollection`,
 * `useQuerySourceStatus`) and its plan's options, over the root of the
 * page's sources that can be queried — or a host's own calls, where it
 * provides them.
 *
 * @param props - The sources, the instant taken as now, and the page
 * @returns The page, its tiles able to ask
 *
 * @remarks
 * - **One per page**: a provider inside another over the same sources — a
 *   builder's publish preview beside its canvas — asks through the outer one,
 *   so what the canvas has answered the preview draws at once; one that names
 *   an instant of its own keeps its own.
 * - **The answers outlive the calls' identity**: a host that renders its
 *   `E3Provider` with a new config — a token refreshed — keeps every answer;
 *   only new sources start the page's answers again.
 * - **A source the page cannot query** — a paged source read through a
 *   record's index — fails only the visuals that read it, with why.
 */
export function VisualAnswersProvider({ sources, now, children }: VisualAnswersProviderProps) {
    const outer = useContext(PageAnswersContext);
    if (outer !== null && now === undefined && sourcesEqual(outer.list, [...sources])) return createElement(Fragment, null, children);
    return createElement(PageAnswersRoot, { sources, now }, children);
}

/** A page's own answers: see {@link VisualAnswersProvider}. */
function PageAnswersRoot({ sources, now, children }: VisualAnswersProviderProps) {
    const words = useQueryWords();
    const bindings = useMemo(() => sources.map((source) => source.binding), [sources]);
    const { root, refused: refusedByName } = useQuerySourcesRoot(bindings, words);
    const call = useQueryCall();
    const split = useQuerySplitCall();
    const collection = useQueryCollection();
    const status = useQuerySourceStatus();
    const options = useQueryPlanOptions();
    // The calls a program is asked through, as they are when it is asked: a new identity of theirs keeps every answer.
    const seams = useRef<{ readonly seams: DraftRunSeams; readonly options: PlanOptions }>({ seams: { call, split, collection, status }, options });
    useLayoutEffect(() => {
        seams.current = { seams: { call, split, collection, status }, options };
    }, [call, split, collection, status, options]);
    const answers = useMemo(() => new VisualAnswers((program, signal, at) => (root === undefined
        ? Promise.reject(new VisualAskError("refused", ""))
        : askProgram(program, root, seams.current.seams, at === undefined ? seams.current.options : { ...seams.current.options, now: at }, signal))), [root]);
    // `.now` is the clock unless a source is named `now`, whose poll then gives its hash.
    const clock = root !== undefined && rootHasClock(root);
    const instant = useNow(now);
    // The minute, one object all minute long: what reads it draws again only once it moves on.
    const held = useRef<Date | undefined>(undefined);
    const next = minuteOf(instant);
    if (held.current === undefined || !sameMinute(held.current, next)) held.current = next;
    const minute = held.current;
    // The minute an ask made from an action reads, as it is when the action is taken: the page's answers keep their
    // identity as the minute moves on, so the tiles that read none draw nothing again.
    const latest = useRef(minute);
    useLayoutEffect(() => { latest.current = minute; }, [minute]);
    const minuteNow = useCallback(() => latest.current, []);
    const hashes = useSourceHashes(root);
    const value = useMemo((): PageAnswers => {
        // A key two sources share keeps the first, as the sources' names do.
        const byKey = new Map<string, Source>();
        const refused = new Map<string, string>();
        for (const source of sources) {
            if (byKey.has(source.key)) continue;
            byKey.set(source.key, source);
            const why = refusedByName.get(source.binding.name);
            if (why !== undefined) refused.set(source.key, why);
        }
        return { list: [...sources], sources: byKey, root, answers, hashes, clock, refused, minute: minuteNow };
    }, [sources, refusedByName, root, answers, hashes, clock, minuteNow]);
    return createElement(PageAnswersContext.Provider, { value }, createElement(PageMinuteContext.Provider, { value: minute }, children));
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

/**
 * The root the page's programs read: a struct of the sources it can query —
 * what a filter's conditions are checked against, and its values read from.
 *
 * @returns The root; `undefined` when the page has no source to query, or no provider is mounted
 */
export function useVisualRoot(): QueryRoot | undefined {
    return useContext(PageAnswersContext)?.root;
}

/**
 * The minute the page takes as now: what a filter that counts back from now
 * counts from. What reads it draws again as it moves on.
 *
 * @returns The minute; `undefined` when no provider is mounted
 */
export function useVisualMinute(): Date | undefined {
    return useContext(PageMinuteContext);
}

/**
 * A tile's programs as the page's answers keep them: each by its text and the
 * source it reads — and, one that reads `.now`, by the minute too, which it is
 * asked for.
 *
 * @param asks - Its programs, as the printer gave them
 * @param source - The source they read, by its key
 * @param minute - The page's minute; `undefined` where none of them reads `.now`
 * @returns The requests, in order
 */
function requestsOf(asks: readonly VisualAsk[], source: string, minute: Date | undefined): VisualRequest[] {
    return asks.map((ask): VisualRequest => (ask.readsNow
        ? { prefix: ask.program, reads: [source, NOW_FIELD], ...(minute === undefined ? {} : { now: minute }) }
        : { prefix: ask.program, reads: [source] }));
}

/**
 * Asks a visual's programs once, when an action needs their answers — an
 * export of its rows (#1671) — through the page's answers, so what the page
 * holds is not asked again, and what it asks is kept for its tiles.
 *
 * @param source - The source the programs read, by its key
 * @returns Asks the programs, and gives their answers in order; it rejects
 *   with why when a call never answered, or the page cannot query the source
 */
export function useVisualAsk(source: string): (asks: readonly VisualAsk[]) => Promise<readonly VisualAnswer[]> {
    const page = useContext(PageAnswersContext);
    return useCallback(async (asks: readonly VisualAsk[]) => {
        if (page === null) throw new VisualAskError("refused", "");
        const refused = page.refused.get(source);
        if (refused !== undefined) throw new VisualAskError("refused", refused);
        // The minute as it is when the action is taken.
        const minute = asks.some((ask) => ask.readsNow) ? page.minute() : undefined;
        const hashes = hashesOf(page, minute);
        const answers = await Promise.all(requestsOf(asks, source, minute).map((request) => page.answers.ensure(request, hashes)));
        return answers.map((answer) => {
            // Asked with no signal, a program is never given up: none means its run gave none.
            if (answer === undefined) throw new VisualAskError("refused", "");
            return answer;
        });
    }, [page, source]);
}

/** Where a tile's answers stand. */
export type VisualAnswersState =
    | { readonly status: "waiting" }
    | {
        readonly status: "failed"; readonly message: string;
        /** Asks again: a call that failed; `undefined` for a source the page cannot query, which asking again cannot mend. */
        readonly retry: (() => void) | undefined;
    }
    | { readonly status: "answered"; readonly answers: readonly VisualAnswer[] };

/**
 * A tile's answers: each of its programs' answers, in order, once all have
 * landed. A program that reads `.now` is asked for the page's minute, and
 * asked again when the minute moves on.
 *
 * @param asks - Its programs, as the printer gave them
 * @param source - The source they read, by its key
 * @returns Waiting; failed, with why — until its programs or the data change,
 *   or it is asked again; or answered — the answers it last drew, while the
 *   same programs are asked again
 *
 * @remarks
 * - **The minute**: only a tile whose programs read `.now` reads it, and draws
 *   again as it moves on (#1670); the page's other tiles draw nothing again.
 * - **Asked again** — a new minute, a dataset written — a tile keeps drawing
 *   the answers it drew, for the same programs, until the new ones land; a
 *   call that fails says so. Programs of their own — a filter changed — wait.
 * - An answer kept under a hash the page has moved past since the tile asked
 *   — a dataset written between the call's read and the poll's — is asked for
 *   once more; an answer of a newer hash than the page's waits for the poll to
 *   read it.
 */
export function useVisualAnswers(asks: readonly VisualAsk[], source: string): VisualAnswersState {
    const page = useContext(PageAnswersContext);
    // Only a tile whose programs read `.now` reads the minute: `use`, which may be called where a hook may not, leaves
    // the page's other tiles unsubscribed to it.
    const minute = asks.some((ask) => ask.readsNow) ? use(PageMinuteContext) : undefined;
    const requests = useMemo(() => requestsOf(asks, source, minute), [asks, source, minute]);
    const hashes = useMemo(() => (page === null ? undefined : hashesOf(page, minute)), [page, minute]);
    const key = requests.map((request) => request.prefix).join("\u0001");
    // What the tile asks for: its programs, under the hashes the page holds of what they read.
    const askedFor = hashes === undefined ? key
        : `${key}\u0002${requests.map((request) => request.reads.map((read) => hashes.get(read) ?? "").join("\u0000")).join("\u0001")}`;
    const [failed, setFailed] = useState<{ readonly key: string; readonly message: string } | undefined>(undefined);
    // The answers landed for what it asks for: a second that misses waits for the page's hashes to move.
    const [landed, setLanded] = useState<{ readonly for: string; readonly times: number }>({ for: "", times: 0 });
    const [attempt, setAttempt] = useState(0);
    const refused = page?.refused.get(source);
    const held = page === null || hashes === undefined || refused !== undefined ? [] : requests.map((request) => page.answers.get(request, hashes));
    const missing = page === null || refused !== undefined || held.some((answer) => answer === undefined);
    const waits = landed.for === askedFor && landed.times >= 2;
    useEffect(() => {
        if (page === null || hashes === undefined || refused !== undefined || !missing || waits) return undefined;
        const controller = new AbortController();
        void Promise.all(requests.map((request) => page.answers.ensure(request, hashes, controller.signal))).then(
            () => {
                if (!controller.signal.aborted) setLanded((was) => ({ for: askedFor, times: was.for === askedFor ? was.times + 1 : 1 }));
            },
            (err: unknown) => {
                if (!controller.signal.aborted) setFailed({ key, message: messageOf(err) });
            },
        );
        // The tile going, or asking another program, stops it waiting.
        return () => controller.abort();
    }, [page, hashes, refused, requests, key, askedFor, missing, waits, landed, attempt]);
    const retry = useCallback(() => {
        setFailed(undefined);
        setAttempt((n) => n + 1);
    }, []);
    // The answers it last drew, and for which programs: what it keeps drawing while the same programs are asked again.
    const drawn = useRef<{ readonly key: string; readonly answers: readonly VisualAnswer[] } | undefined>(undefined);
    if (page === null) return { status: "failed", message: "", retry: undefined };
    if (refused !== undefined) return { status: "failed", message: refused, retry: undefined };
    if (!missing) {
        const answers = held as VisualAnswer[];
        drawn.current = { key, answers };
        return { status: "answered", answers };
    }
    if (failed?.key === key) return { status: "failed", message: failed.message, retry };
    // Asked again — a new minute, a dataset written: what it drew stands until the new answers land.
    if (drawn.current?.key === key) return { status: "answered", answers: drawn.current.answers };
    return { status: "waiting" };
}
