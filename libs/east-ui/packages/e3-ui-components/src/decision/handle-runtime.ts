/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runtime implementation of `Decision.bind` (`decision_bind`) + the React
 * hook that consumes a handle.
 *
 * The platform implementation is the `Data.bind` / `Slice.bind` pattern:
 * given the binding descriptors, it builds the per-source bind handles
 * through the shared {@link defaultBindRuntime} and implements the handle's
 * closures once — union, write-routing by case id, judgement get-or-init and
 * writes, resolve (verdict + removal + selection clear), and the derived
 * commit gate. The case selection lives in workspace UI state under a key
 * derived from the bound source paths — owned entirely by this runtime,
 * visible nowhere.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
    East,
    OptionType,
    StringType,
    NullType,
    ArrayType,
    fromEastTypeValue,
    toEastTypeValue,
    encodeBeast2For,
    decodeBeast2For,
    variant,
    some,
    none,
    type ValueTypeOf,
    type EastTypeValue,
} from '@elaraai/east';
import type { PlatformFunction } from '@elaraai/east/internal';
import type { TreePath } from '@elaraai/e3-types';
import {
    decisionBindPlatformFn,
    DecisionBindPrimitives,
    DiffBindingType,
    DecisionType,
    DecisionHandleType,
    DecisionHandleRefType,
    CommitStateType,
    JudgementInputType,
    DecisionConstraintType,
    AnswerType,
    VerdictType,
    judgementInputType,
    type AnswerLiteral,
} from '@elaraai/e3-ui/internal';
import { StateRuntime, registerPlatformImplementation, getRegisteredPlatformImplementations, buildSliceHandle, DEFAULT_SLICE_STATE, getSomeorUndefined } from '@elaraai/east-ui-components/platform';
import type { Slice as SliceNS } from '@elaraai/east-ui/internal';

type SliceStateValue = ValueTypeOf<typeof SliceNS.Types.State>;
import {
    defaultBindRuntime,
    getBindingTypes,
    getReactiveDatasetCache,
    getStagedStore,
    datasetCacheKey,
    datasetPathToString,
    type BindHandle,
} from '../platform/index.js';
import type { Decision } from './types.js';

type DiffBindingValue = ValueTypeOf<typeof DiffBindingType>;

/** JS-side shape of a decoded {@link DecisionHandleType} value. */
export type DecisionHandleValue = ValueTypeOf<typeof DecisionHandleType>;
/** JS-side shape of a decoded {@link DecisionHandleRefType} payload value —
 *  the binding descriptors an extension payload carries. */
export type DecisionHandleRefValue = ValueTypeOf<typeof DecisionHandleRefType>;
/** JS-side shape of one staged judgement. */
export type Judgement = ValueTypeOf<typeof JudgementInputType>;
/** JS-side shape of the derived commit gate. */
export type CommitState = ValueTypeOf<typeof CommitStateType>;
/** JS-side shape of a verdict value. */
export type Verdict = ValueTypeOf<typeof VerdictType>;
/** JS-side shape of one typed constraint (a contract-variant value — the
 *  default contract's shape stands in for any solution contract here). */
export type ConstraintValue = ValueTypeOf<typeof DecisionConstraintType>;

type SelectionValue = ValueTypeOf<OptionType<StringType>>;

const SELECTION_TYPE = OptionType(StringType);
const encodeSelection = encodeBeast2For(SELECTION_TYPE);
const decodeSelection = decodeBeast2For(SELECTION_TYPE);

/** The UI-state key holding a handle's case selection — derived from the
 *  bound source paths so it is stable across reloads without anyone naming
 *  it. Shared by the platform impl (reads/writes) and the React hook
 *  (subscription). */
export function deriveSelectionKey(decisions: readonly DiffBindingValue[]): string {
    return ['decision.selection', ...decisions.map(d => datasetPathToString(d.source as TreePath))].join('|');
}

// =============================================================================
// Platform implementation.
// =============================================================================

function viewFor(binding: DiffBindingValue): BindHandle {
    const workspace = getReactiveDatasetCache().getConfig().workspace ?? '';
    const source = binding.source as TreePath;
    const types = getBindingTypes(workspace, source);
    if (!types) {
        throw new Error(
            `Decision.bind: no binding registered for ${datasetPathToString(source)} — bind it with Data.bind on the same surface first`,
        );
    }
    const patch = binding.patch.type === 'some' ? (binding.patch.value as TreePath) : undefined;
    return defaultBindRuntime.buildBindHandle(types.sourceType, source, patch, binding.mode.type);
}

/**
 * The canonical slice config over the fixed `DecisionType` — kind / title /
 * value filterable, kind + title searchable. Decoded form (plain JS
 * accessors); also what the queue's narrowing matches against.
 */
export const DECISION_SLICE_CONFIG = {
    fields: new Map<string, unknown>([
        ['kind', variant('string', { label: 'Kind', accessor: (d: Decision) => d.kind })],
        ['title', variant('string', { label: 'Title', accessor: (d: Decision) => d.title })],
        ['value', variant('float', { label: 'Value', accessor: (d: Decision) => d.value })],
    ]),
    rangeFieldId: none,
    searchFieldIds: ['kind', 'title'],
    breakdownFieldIds: [],
};

/**
 * The handle-owned slice key — derived from the bound source paths (like the
 * selection) plus a hash of the seed. The slice store is first-write-wins
 * (operator narrowing persists across reloads), so the seed must be part of
 * the key's identity: a changed seed binds a fresh key and always applies,
 * while edits over any given seed still persist.
 */
function deriveSliceKey(decisions: readonly DiffBindingValue[], sliceInit?: SliceStateValue): string {
    const sources = decisions.map(d => datasetPathToString(d.source as TreePath));
    const seed = sliceInit === undefined ? 'none' : hashString(stableStringify(sliceInit));
    return ['decision.slice', ...sources, seed].join('|');
}

/** Stable JSON for slice-state values (bigint / Date / Set / Map safe). */
function stableStringify(v: unknown): string {
    return JSON.stringify(v, (_k, x) => {
        if (typeof x === 'bigint') return `${x}n`;
        if (x instanceof Date) return x.toISOString();
        if (x instanceof Set) return [...x].sort();
        if (x instanceof Map) return [...x.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        return x;
    });
}

/** djb2 — short, stable, good enough for key identity. */
function hashString(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

// =============================================================================
// Host helpers (issue #106) — shared by the primitive impls and the slice rows
// getter. Lifted to module scope so each takes the binding descriptor as a
// parameter rather than closing over it: the IR-bearing handle methods carry
// ONLY the plain-data descriptors, and these resolve the live views / store from
// those descriptors at call time.
// =============================================================================

function readSelectionAt(selectionKey: string): SelectionValue {
    StateRuntime.trackKey(selectionKey);
    const bytes = StateRuntime.getStore().read(selectionKey);
    return bytes === undefined ? none : decodeSelection(bytes) as SelectionValue;
}
function writeSelectionAt(selectionKey: string, value: SelectionValue): null {
    StateRuntime.getStore().write(selectionKey, encodeSelection(value));
    return null;
}
function hostQueue(decisions: DiffBindingValue[]): Decision[] {
    return decisions.flatMap(b => viewFor(b).read() as Decision[]);
}
function readJudgementsAt(judgements: DiffBindingValue): Map<string, Judgement> {
    return viewFor(judgements).read() as Map<string, Judgement>;
}
function judgementForAt(judgements: DiffBindingValue, caseId: string): Judgement {
    return readJudgementsAt(judgements).get(caseId) ?? {
        caseId,
        answers: new Map(),
        knowledge: none,
        constraints: [],
        verdict: none,
        resolvedAt: none,
    };
}
function stageJudgementAt(judgements: DiffBindingValue, caseId: string, change: Partial<Judgement>): null {
    const dict = new Map(readJudgementsAt(judgements));
    dict.set(caseId, { ...judgementForAt(judgements, caseId), ...change });
    viewFor(judgements).write(dict);
    return null;
}
function removeFromOwningView(decisions: DiffBindingValue[], caseId: string): void {
    for (const binding of decisions) {
        const view = viewFor(binding);
        const rows = view.read() as Decision[];
        if (rows.some(d => d.id === caseId)) {
            view.write(rows.filter(d => d.id !== caseId));
        }
    }
}

// =============================================================================
// Compiled handle methods (issue #106) — each method is a thin IR-bearing
// East.function over a decision_* primitive, capturing only the plain-data
// descriptors. Cached per (descriptors + contract): the method IR is a pure
// function of them, and the primitives resolve the live views / store at call
// time, so a cached set still re-binds.
// =============================================================================

const decisionHandleCache = new Map<string, Record<string, unknown>>();

/** Cycle-safe structural token for a constraint type value (by-name contracts
 *  may be recursive), so the cache never serves methods compiled for a
 *  different contract `C`. */
function typeToken(tv: EastTypeValue): string {
    const seen = new WeakSet<object>();
    return JSON.stringify(tv, (_k, v) => {
        if (typeof v === 'object' && v !== null) {
            if (seen.has(v)) return '<cyc>';
            seen.add(v);
        }
        return typeof v === 'bigint' ? `${v}n` : v;
    });
}

function compileDecisionMethods(
    constraintType: EastTypeValue,
    decisions: DiffBindingValue[],
    judgements: DiffBindingValue,
    selectionKey: string,
): Record<string, unknown> {
    const platform = getRegisteredPlatformImplementations();
    const c = fromEastTypeValue(constraintType);
    const decisionsExpr = East.value(decisions as never, ArrayType(DiffBindingType));
    const judgementsExpr = East.value(judgements as never, DiffBindingType);
    const selKeyExpr = East.value(selectionKey, StringType);
    const {
        queue, selected, select, clearSelection, decision, update,
        judgement, answer, addKnowledge, inject, resolve, commitState,
    } = DecisionBindPrimitives;

    return {
        queue:          East.compile(East.function([], ArrayType(DecisionType), ($) => { $.return(queue(decisionsExpr)); }), platform),
        selected:       East.compile(East.function([], OptionType(StringType), ($) => { $.return(selected(selKeyExpr)); }), platform),
        select:         East.compile(East.function([StringType], NullType, ($, id) => { $.return(select(selKeyExpr, id)); }), platform),
        clearSelection: East.compile(East.function([], NullType, ($) => { $.return(clearSelection(selKeyExpr)); }), platform),
        decision:       East.compile(East.function([], OptionType(DecisionType), ($) => { $.return(decision(decisionsExpr, selKeyExpr)); }), platform),
        update:         East.compile(East.function([DecisionType], NullType, ($, edited) => { $.return(update(decisionsExpr, edited)); }), platform),
        judgement:      East.compile(East.function([StringType], judgementInputType(c), ($, id) => { $.return(judgement([c], judgementsExpr, id)); }), platform),
        answer:         East.compile(East.function([StringType, StringType, AnswerType], NullType, ($, id, prompt, ans) => { $.return(answer(judgementsExpr, id, prompt, ans)); }), platform),
        addKnowledge:   East.compile(East.function([StringType, StringType], NullType, ($, id, text) => { $.return(addKnowledge(judgementsExpr, id, text)); }), platform),
        inject:         East.compile(East.function([StringType, c], NullType, ($, id, con) => { $.return(inject([c], judgementsExpr, id, con)); }), platform),
        resolve:        East.compile(East.function([StringType, VerdictType], NullType, ($, id, verdict) => { $.return(resolve(decisionsExpr, judgementsExpr, selKeyExpr, id, verdict)); }), platform),
        commitState:    East.compile(East.function([StringType], CommitStateType, ($, id) => { $.return(commitState(decisionsExpr, judgementsExpr, id)); }), platform),
    };
}

/** The decoded/runtime shape of a {@link DecisionHandleType} value — the methods
 *  the renderer + React hook call. The compiled East.functions are typed loosely
 *  by inference, so we re-assert the call shapes here. */
interface DecisionHandleFns {
    decisions: DiffBindingValue[];
    judgements: DiffBindingValue;
    sliceInit: unknown;
    slice: ReturnType<typeof buildSliceHandle>;
    queue: () => Decision[];
    selected: () => SelectionValue;
    select: (caseId: string) => unknown;
    clearSelection: () => unknown;
    decision: () => unknown;
    update: (next: Decision) => unknown;
    judgement: (caseId: string) => Judgement;
    answer: (caseId: string, promptId: string, response: unknown) => unknown;
    addKnowledge: (caseId: string, text: string) => unknown;
    inject: (caseId: string, constraint: ConstraintValue) => unknown;
    resolve: (caseId: string, verdict: Verdict) => unknown;
    commitState: (caseId: string) => CommitState;
    journal: () => Judgement[];
}

/**
 * Build a decision handle from its binding descriptors. The descriptor fields
 * (decisions / judgements / sliceInit) are plain data; the 12 methods are
 * IR-bearing East.functions capturing only those descriptors, so the whole
 * handle is serializable East data (issue #106). `journal` is a host-only helper
 * the React hook calls on the locally-built handle (not part of the encodable
 * handle type). `constraintType` is the contract `C` — supplied by the platform
 * resolver for East-side callers; the hook omits it (the methods' runtime
 * behaviour is contract-agnostic, so the default contract's types suffice for a
 * never-encoded local handle).
 */
function buildDecisionHandle(
    decisions: DiffBindingValue[],
    judgements: DiffBindingValue,
    sliceInit?: SliceStateValue,
    constraintType?: EastTypeValue,
): DecisionHandleFns {
    const cType = constraintType ?? toEastTypeValue(DecisionConstraintType);
    const selectionKey = deriveSelectionKey(decisions);

    const slice = buildSliceHandle(
        deriveSliceKey(decisions, sliceInit),
        DECISION_SLICE_CONFIG,
        sliceInit ?? DEFAULT_SLICE_STATE,
        () => hostQueue(decisions),
        none,
    );

    const journal = (): Judgement[] => {
        const entries = [...readJudgementsAt(judgements).values()].filter(j => j.verdict.type === 'some');
        const at = (j: Judgement) => (j.resolvedAt.type === 'some' ? j.resolvedAt.value.getTime() : 0);
        return entries.sort((a, b) => at(b) - at(a));
    };

    const cacheKey = `${hashString(stableStringify({ decisions, judgements }))}|${typeToken(cType)}`;
    let methods = decisionHandleCache.get(cacheKey);
    if (methods === undefined) {
        methods = compileDecisionMethods(cType, decisions, judgements, selectionKey);
        decisionHandleCache.set(cacheKey, methods);
    }

    return {
        decisions,
        judgements,
        sliceInit: sliceInit !== undefined ? some(sliceInit) : none,
        slice,
        journal,
        ...methods,
    } as unknown as DecisionHandleFns;
}

/** The `decision_bind` implementation + its backing primitives. Registered on
 *  module load. */
export const DecisionBindPlatform: PlatformFunction[] = [
    // Generic over the constraint contract — the resolver receives the contract
    // type value and threads it into the IR-bearing judgement / inject methods.
    decisionBindPlatformFn.implement((constraintType: EastTypeValue) =>
        (decisionsArg: unknown, judgementsArg: unknown, sliceInitArg: unknown) =>
            buildDecisionHandle(
                decisionsArg as DiffBindingValue[],
                judgementsArg as DiffBindingValue,
                getSomeorUndefined(sliceInitArg as never) as SliceStateValue | undefined,
                constraintType,
            )),

    // ── issue #106 primitives — host I/O backing the IR-bearing handle methods.
    // Each is a faithful lift of the original closure body, taking the plain-data
    // descriptor(s) + the selection key as arguments. ──
    DecisionBindPrimitives.queue.implement((decisions: unknown) =>
        hostQueue(decisions as DiffBindingValue[]) as never),
    DecisionBindPrimitives.selected.implement((selectionKey: unknown) =>
        readSelectionAt(selectionKey as string)),
    DecisionBindPrimitives.select.implement((selectionKey: unknown, caseId: unknown) =>
        writeSelectionAt(selectionKey as string, some(caseId as string))),
    DecisionBindPrimitives.clearSelection.implement((selectionKey: unknown) =>
        writeSelectionAt(selectionKey as string, none)),
    DecisionBindPrimitives.decision.implement((decisions: unknown, selectionKey: unknown) => {
        const sel = readSelectionAt(selectionKey as string);
        if (sel.type === 'none') return none as never;
        const found = hostQueue(decisions as DiffBindingValue[]).find(d => d.id === sel.value);
        return (found === undefined ? none : some(found)) as never;
    }),
    DecisionBindPrimitives.update.implement((decisions: unknown, edited: unknown) => {
        const e = edited as Decision;
        for (const binding of decisions as DiffBindingValue[]) {
            const view = viewFor(binding);
            const rows = view.read() as Decision[];
            if (rows.some(d => d.id === e.id)) {
                view.write(rows.map(d => (d.id === e.id ? e : d)));
            }
        }
        return null;
    }),
    DecisionBindPrimitives.judgement.implement((_c: EastTypeValue) =>
        (judgements: unknown, caseId: unknown) =>
            judgementForAt(judgements as DiffBindingValue, caseId as string) as never),
    DecisionBindPrimitives.answer.implement((judgements: unknown, caseId: unknown, prompt: unknown, response: unknown) => {
        const answers = new Map(judgementForAt(judgements as DiffBindingValue, caseId as string).answers);
        answers.set(prompt as string, response as Judgement['answers'] extends Map<string, infer A> ? A : never);
        return stageJudgementAt(judgements as DiffBindingValue, caseId as string, { answers });
    }),
    DecisionBindPrimitives.addKnowledge.implement((judgements: unknown, caseId: unknown, text: unknown) =>
        stageJudgementAt(judgements as DiffBindingValue, caseId as string, { knowledge: some(text as string) })),
    DecisionBindPrimitives.inject.implement((_c: EastTypeValue) =>
        (judgements: unknown, caseId: unknown, constraint: unknown) => {
            // Upsert by contract case name — one constraint per lever.
            const con = constraint as ConstraintValue;
            const constraints = judgementForAt(judgements as DiffBindingValue, caseId as string).constraints
                .filter(x => x.type !== con.type)
                .concat([con]);
            return stageJudgementAt(judgements as DiffBindingValue, caseId as string, { constraints });
        }),
    DecisionBindPrimitives.resolve.implement((decisions: unknown, judgements: unknown, selectionKey: unknown, caseId: unknown, verdict: unknown) => {
        stageJudgementAt(judgements as DiffBindingValue, caseId as string, { verdict: some(verdict as Verdict), resolvedAt: some(new Date()) });
        removeFromOwningView(decisions as DiffBindingValue[], caseId as string);
        writeSelectionAt(selectionKey as string, none);
        return null;
    }),
    DecisionBindPrimitives.commitState.implement((decisions: unknown, judgements: unknown, caseId: unknown) => {
        const cid = caseId as string;
        const decision = hostQueue(decisions as DiffBindingValue[]).find(d => d.id === cid);
        const prompts = decision?.prompts ?? [];
        const answers = judgementForAt(judgements as DiffBindingValue, cid).answers;
        const responses = prompts.map(p => answers.get(p.id)?.type);
        if (responses.some(r => r === 'no')) return variant('blocked', null) as never;
        if (responses.some(r => r === 'unknown')) return variant('handoff', null) as never;
        const unanswered = responses.filter(r => r === undefined).length;
        if (unanswered > 0) return variant('gated', BigInt(unanswered)) as never;
        return variant('ready', null) as never;
    }),
];

registerPlatformImplementation(DecisionBindPlatform);

// =============================================================================
// React hook.
// =============================================================================

export interface UseDecisionHandleResult {
    /** The visible queue (union of every bound view). `null` until the
     *  bindings' types are registered and readable. */
    decisions: Decision[] | null;
    /** The selected case id, or `null` when no case is open. */
    selected: string | null;
    /** Resolved cases (judgements carrying a verdict), newest first; `null`
     *  while the bindings aren't readable. */
    journal: Judgement[] | null;
    /** The staged judgement for a case (a fresh empty one when nothing is
     *  staged yet); `null` while the bindings aren't readable. */
    judgementFor: (caseId: string) => Judgement | null;
    /** The derived commit gate for a case; `null` while unreadable. */
    commitStateFor: (caseId: string) => CommitState | null;
    select: (caseId: string) => void;
    clearSelection: () => void;
    /** Probe edit — routed to the owning view's patch overlay by `id`. */
    update: (next: Decision) => void;
    /** Record the response to one judgement prompt (by prompt id). */
    answer: (caseId: string, promptId: string, response: AnswerLiteral) => void;
    addKnowledge: (caseId: string, text: string) => void;
    /** Stage a typed constraint (a contract-variant value; upserts by case name). */
    inject: (caseId: string, constraint: ConstraintValue) => void;
    /** Commit a verdict: judgement write + removal through the owning patch
     *  + selection clear. */
    resolve: (caseId: string, verdict: Verdict) => void;
    /** The handle-owned slice over the queue (closures; key derived from the
     *  bound source paths). `null` until the bindings are readable. */
    slice: ReturnType<typeof buildSliceHandle> | null;
}

/** Subscribe to every store the handle projects from: each binding's source
 *  and patch (staged store + dataset cache) plus the selection state key. */
function useHandleVersion(handle: DecisionHandleRefValue | null): number {
    const staged = getStagedStore();
    const cache = getReactiveDatasetCache();
    const state = StateRuntime.getStore();
    const workspace = cache.getConfig().workspace ?? '';

    const keys = useMemo(() => {
        if (!handle) return [] as string[];
        const bindings = [...handle.decisions, handle.judgements];
        const ks: string[] = [];
        for (const b of bindings) {
            ks.push(datasetCacheKey(workspace, b.source as TreePath));
            if (b.patch.type === 'some') ks.push(datasetCacheKey(workspace, b.patch.value as TreePath));
        }
        return ks;
    }, [workspace, handle]);

    const selectionKey = handle ? deriveSelectionKey(handle.decisions) : undefined;

    const subscribe = useCallback((cb: () => void) => {
        const unsubs = keys.flatMap(k => [staged.subscribe(k, cb), cache.subscribe(k, cb)]);
        if (selectionKey !== undefined) unsubs.push(state.subscribe(selectionKey, cb));
        return () => { for (const u of unsubs) u(); };
    }, [staged, cache, state, keys, selectionKey]);

    const getSnapshot = useCallback(
        () => keys.reduce((sum, k) => sum + staged.getKeyVersion(k) + cache.getKeyVersion(k), 0)
            + (selectionKey !== undefined ? state.getKeyVersion(selectionKey) : 0),
        [staged, cache, state, keys, selectionKey],
    );

    return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Resolve a {@link DecisionHandleRefType} payload value into live reads +
 * stable writers. The hook reconstructs the handle from its descriptors
 * (the same construction the platform impl performs) and adds store
 * subscriptions so the surface re-renders when any bound value or the
 * selection changes.
 */
export function useDecisionHandle(ref: DecisionHandleRefValue | null): UseDecisionHandleResult {
    const version = useHandleVersion(ref);

    // The ref is the handle's encodable identity; the live handle is
    // (re)constructed locally — the same construction the `decision_bind`
    // platform impl performs for East-side callers.
    const fns = useMemo(
        () => (ref
            ? buildDecisionHandle([...ref.decisions], ref.judgements,
                getSomeorUndefined(ref.slice as never) as SliceStateValue | undefined)
            : null),
        [ref],
    );

    const { decisions, selected, journal } = useMemo(() => {
        try {
            if (!fns) return { decisions: null, selected: null, journal: null };
            const sel = fns.selected();
            return {
                decisions: fns.queue(),
                selected: sel.type === 'some' ? (sel.value as string) : null,
                journal: fns.journal(),
            };
        } catch {
            // Binding types not registered yet (first render before the
            // surface's Data.bind calls run) — render the loading state.
            return { decisions: null, selected: null, journal: null };
        }
        // `version` drives recompute when any underlying store changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fns, version]);

    const judgementFor = useCallback((caseId: string): Judgement | null => {
        try { return fns ? fns.judgement(caseId) : null; } catch { return null; }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fns, version]);

    const commitStateFor = useCallback((caseId: string): CommitState | null => {
        try { return fns ? fns.commitState(caseId) : null; } catch { return null; }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fns, version]);

    const select = useCallback((caseId: string) => { fns?.select(caseId); }, [fns]);
    const clearSelection = useCallback(() => { fns?.clearSelection(); }, [fns]);
    const update = useCallback((next: Decision) => { fns?.update(next); }, [fns]);
    const answer = useCallback((caseId: string, promptId: string, response: AnswerLiteral) => {
        fns?.answer(caseId, promptId, variant(response, null));
    }, [fns]);
    const addKnowledge = useCallback((caseId: string, text: string) => {
        fns?.addKnowledge(caseId, text);
    }, [fns]);
    const inject = useCallback((caseId: string, constraint: ConstraintValue) => {
        fns?.inject(caseId, constraint);
    }, [fns]);
    const resolve = useCallback((caseId: string, verdict: Verdict) => {
        fns?.resolve(caseId, verdict);
    }, [fns]);

    return {
        decisions,
        selected,
        journal,
        judgementFor,
        commitStateFor,
        select,
        clearSelection,
        update,
        answer,
        addKnowledge,
        inject,
        resolve,
        slice: fns ? (fns.slice as ReturnType<typeof buildSliceHandle>) : null,
    };
}
