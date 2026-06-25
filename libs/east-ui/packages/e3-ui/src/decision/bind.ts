/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Decision.bind` — the per-surface decision handle (see
 * `docs/decision-loop.md` and the `Decision.Handle` block in
 * `design/decide.html`).
 *
 * Decisions arrive from multiple reasoning tasks, each bound with its own
 * {@link Data.bind} diff view (read-only source ⊕ operator patch overlay);
 * the operator's staged contribution is a judgements dict bound the same
 * way. `Decision.bind` is a generic platform function over those bindings'
 * descriptors — the `Data.bind` / `Slice.bind` pattern: the East layer
 * declares the contract, the runtime (in `@elaraai/e3-ui-components`)
 * implements the handle's closures. It adds only what no single binding
 * can: the union of the decision views, write-routing by case id, the
 * handle-owned case selection, and the derived commit gate.
 *
 * The type parameter is the solution's **constraint contract** — a by-name
 * `VariantType` declared once in the solution package and imported by both
 * the reasoning task (which `$.matchTag`s injected constraints, fully
 * typed) and the surface. Pass it like `Data.bind`'s type token:
 * `Decision.bind([RosterConstraint], { decisions, judgements })`; omit it
 * for the default primitive op-variant.
 *
 * @packageDocumentation
 */

import {
    East,
    ArrayType,
    DictType,
    OptionType,
    StructType,
    VariantType,
    FunctionType,
    StringType,
    IntegerType,
    NullType,
    some,
    none,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
} from '@elaraai/east';

import { SliceStateType, SliceBindType } from '@elaraai/east-ui/internal';

import { DiffBindingType, type BoundValue } from '../bind/data.js';
import {
    DecisionType,
    DecisionConstraintType,
    judgementInputType,
    AnswerType,
    VerdictType,
} from './types.js';

// ============================================================================
// Commit state — derived per case, never stored.
// ============================================================================

/**
 * The derived commit gate for one case — a pure function of the decision's
 * `prompts` and the staged judgement's `answers`.
 *
 * @property gated - That many prompts are still unanswered; Apply disabled
 * @property blocked - Some prompt was answered `no`; commit blocked
 * @property handoff - Some prompt was answered `unknown`; the case routes to
 *   handoff
 * @property ready - Every prompt answered `yes` (or the case has no
 *   prompts); Apply enabled
 */
export const CommitStateType = VariantType({
    gated: IntegerType,
    blocked: NullType,
    handoff: NullType,
    ready: NullType,
});
/** Type alias for {@link CommitStateType}. */
export type CommitStateType = typeof CommitStateType;

// ============================================================================
// Handle type — generic over the solution's constraint contract.
// ============================================================================

/**
 * Build the judgements dataset type for a constraint contract — staged
 * judgements keyed by case id. Bind it with
 * `Data.bind(judgementsInput, { mode: "staged" })`.
 */
export function judgementsType<C extends EastType = DecisionConstraintType>(constraint?: C) {
    return DictType(StringType, judgementInputType(constraint));
}

/** The default judgements dataset type (primitive op-variant constraints). */
export const JudgementsType = judgementsType();
/** Type alias for {@link JudgementsType}. */
export type JudgementsType = typeof JudgementsType;

/**
 * Build the decision-handle type for a constraint contract.
 *
 * The descriptor fields identify the underlying bindings (renderer
 * subscriptions, provenance); the closures — implemented by the platform
 * runtime, like `Data.bind`'s — are the only read/write paths, so the
 * handle's semantics live once.
 *
 * @property decisions - Per-source binding descriptors
 * @property judgements - The judgements binding descriptor
 * @property sliceInit - The initial slice state passed at bind (data; feeds
 *   component payload refs)
 * @property slice - The handle-owned slice over the unioned queue (canonical
 *   `DecisionType` config; key derived from the bound source paths, like the
 *   selection). Components mount its rail; seeding `slice` at bind with no
 *   rail mounted gives an invisible author scope.
 * @property queue - The visible queue: union of every bound view (source ⊕
 *   patch each)
 * @property selected - The selected case id, if any
 * @property select - Open a case (Triage → Understand)
 * @property clearSelection - Close the case without resolving
 * @property decision - The selected case's decision, if it is still queued
 * @property update - Probe edit: write an edited decision through its owning
 *   view's patch overlay (routed by `id`)
 * @property judgement - The staged judgement for a case (a fresh empty one
 *   when nothing is staged yet)
 * @property answer - Record the response to one judgement prompt (keyed by
 *   prompt id)
 * @property addKnowledge - Record free-text context the model can't see
 * @property inject - Stage a typed constraint (a contract-variant value;
 *   upserts by case name); the next optimiser run folds it in
 * @property resolve - Commit a verdict: writes it to the judgement, removes
 *   the case through its owning patch overlay, clears the selection (closes
 *   the loop back to Triage)
 * @property commitState - The derived commit gate for a case — see
 *   {@link CommitStateType}
 */
export function decisionHandleType<C extends EastType = DecisionConstraintType>(constraint?: C) {
    const c = (constraint ?? DecisionConstraintType) as C;
    return StructType({
        decisions: ArrayType(DiffBindingType),
        judgements: DiffBindingType,
        sliceInit: OptionType(SliceStateType),
        slice: SliceBindType,
        queue: FunctionType([], ArrayType(DecisionType)),
        selected: FunctionType([], OptionType(StringType)),
        select: FunctionType([StringType], NullType),
        clearSelection: FunctionType([], NullType),
        decision: FunctionType([], OptionType(DecisionType)),
        update: FunctionType([DecisionType], NullType),
        judgement: FunctionType([StringType], judgementInputType(c)),
        answer: FunctionType([StringType, StringType, AnswerType], NullType),
        addKnowledge: FunctionType([StringType, StringType], NullType),
        inject: FunctionType([StringType, c], NullType),
        resolve: FunctionType([StringType, VerdictType], NullType),
        commitState: FunctionType([StringType], CommitStateType),
    });
}

/** The default handle type (primitive op-variant constraints). */
export const DecisionHandleType = decisionHandleType();
/** Type alias for {@link DecisionHandleType}. */
export type DecisionHandleType = typeof DecisionHandleType;

/** The TypeScript type of a {@link decisionBind} handle expression. */
export type DecisionHandle<C extends EastType = DecisionConstraintType> =
    ExprType<ReturnType<typeof decisionHandleType<C>>>;

/** What a surface needs from a handle of ANY contract — the descriptor
 *  fields its payload ref carries. Components accept this so one queue
 *  serves every solution contract. */
export type DecisionHandleLike = Pick<DecisionHandle, 'decisions' | 'judgements' | 'sliceInit'>;

/**
 * The encodable identity of a handle — its binding descriptors. Extension
 * component payloads are beast2-encoded, so they carry this ref (plain
 * data); the renderer runtime reconstructs the live handle from it. The
 * closure-rich handle itself never crosses an encoding boundary.
 *
 * @property decisions - Per-source binding descriptors
 * @property judgements - The judgements binding descriptor
 */
export const DecisionHandleRefType = StructType({
    decisions: ArrayType(DiffBindingType),
    judgements: DiffBindingType,
    slice: OptionType(SliceStateType),
});
/** Type alias for {@link DecisionHandleRefType}. */
export type DecisionHandleRefType = typeof DecisionHandleRefType;

// ============================================================================
// Platform function — generic over the constraint contract.
// ============================================================================

/**
 * The underlying `Decision.bind` platform-function definition. End-users
 * call {@link decisionBind} (via `Decision.bind`); the runtime
 * implementation registers against this raw definition in
 * `@elaraai/e3-ui-components` via `decisionBindPlatformFn.implement(...)`.
 */
export const decisionBindPlatformFn = East.genericPlatform(
    "decision_bind",
    ["C"],
    [ArrayType(DiffBindingType), DiffBindingType, OptionType(SliceStateType)],
    decisionHandleType("C" as never),
    { optional: true },
);

// ============================================================================
// decision_* primitives — low-level host I/O backing the handle's methods
// (issue #106)
//
// The handle's 12 closures become thin IR-bearing `East.function`s over these
// primitives, capturing only the PLAIN-DATA binding descriptors (the `decisions`
// array + the `judgements` descriptor) and the derived selection key. The host
// side-effects — resolving each descriptor to its live `Data.bind` view, the
// queue union, write-routing by case id, the selection store, the staged
// judgement reads/writes — live in the primitive impls, resolved from the
// descriptors at call time. So a captured decision handle (e.g.
// `onClick={() => handle.resolve(id, verdict)}`) encodes through beast2 and
// `decodeBeast2For({ platform })` re-binds it instead of throwing
// "Cannot serialize function: no IR attached".
//
// `judgement` / `inject` are generic over the constraint contract `C` (their
// types depend on it, exactly like the handle type); the rest are concrete.
// Implemented by `DecisionBindPlatform` in `@elaraai/e3-ui-components`.
// ----------------------------------------------------------------------------
const decision_queue           = East.platform("decision_queue", [ArrayType(DiffBindingType)], ArrayType(DecisionType), { optional: true });
const decision_selected        = East.platform("decision_selected", [StringType], OptionType(StringType), { optional: true });
const decision_select          = East.platform("decision_select", [StringType, StringType], NullType, { optional: true });
const decision_clear_selection = East.platform("decision_clear_selection", [StringType], NullType, { optional: true });
const decision_decision        = East.platform("decision_decision", [ArrayType(DiffBindingType), StringType], OptionType(DecisionType), { optional: true });
const decision_update          = East.platform("decision_update", [ArrayType(DiffBindingType), DecisionType], NullType, { optional: true });
const decision_judgement       = East.genericPlatform("decision_judgement", ["C"], [DiffBindingType, StringType], judgementInputType("C" as never), { optional: true });
const decision_answer          = East.platform("decision_answer", [DiffBindingType, StringType, StringType, AnswerType], NullType, { optional: true });
const decision_add_knowledge   = East.platform("decision_add_knowledge", [DiffBindingType, StringType, StringType], NullType, { optional: true });
const decision_inject          = East.genericPlatform("decision_inject", ["C"], [DiffBindingType, StringType, "C"], NullType, { optional: true });
const decision_resolve         = East.platform("decision_resolve", [ArrayType(DiffBindingType), DiffBindingType, StringType, StringType, VerdictType], NullType, { optional: true });
const decision_commit_state    = East.platform("decision_commit_state", [ArrayType(DiffBindingType), DiffBindingType, StringType], CommitStateType, { optional: true });

/**
 * Low-level platform primitives that back {@link decisionBind}'s handle methods.
 *
 * @internal Not for direct use — author against `Decision.bind`. These exist so
 * each handle method can be an IR-bearing `East.function` (serializable) rather
 * than a raw host closure. Keyed by the plain-data binding descriptors + the
 * derived selection key; the impls resolve the live views / store at call time.
 */
export const DecisionBindPrimitives = {
    queue: decision_queue,
    selected: decision_selected,
    select: decision_select,
    clearSelection: decision_clear_selection,
    decision: decision_decision,
    update: decision_update,
    judgement: decision_judgement,
    answer: decision_answer,
    addKnowledge: decision_add_knowledge,
    inject: decision_inject,
    resolve: decision_resolve,
    commitState: decision_commit_state,
} as const;

// ============================================================================
// User-facing factory.
// ============================================================================

/**
 * Options for {@link decisionBind}.
 *
 * @property decisions - The bound decision views — one
 *   `Data.bind(…)` handle per
 *   reasoning task (source ⊕ patch each)
 * @property judgements - The bound judgements view —
 *   `Data.bind(…)` (the staged
 *   operator input)
 * @property slice - Optional initial state for the handle-owned slice over
 *   the queue (`Slice.state({ filters: [...] })`). Seeded once; the
 *   operator's rail edits write over it. With no rail mounted on the queue
 *   it acts as an invisible author scope.
 */
export interface DecisionBindOptions<C extends EastType = DecisionConstraintType> {
    decisions: BoundValue<ArrayType<DecisionType>>[];
    judgements: BoundValue<ReturnType<typeof judgementsType<C>>>;
    slice?: SubtypeExprOrValue<SliceStateType>;
}

/**
 * Build a decision handle from bound decision views + the bound judgements
 * view. Call once at the surface boundary inside a `Reactive` block; pass
 * the handle to every Decide component on the surface.
 *
 * @param types - Optional constraint-contract token, `Data.bind`-style:
 *   `Decision.bind([RosterConstraint], options)`. Omit for the default
 *   primitive op-variant.
 * @param options - {@link DecisionBindOptions}.
 * @returns A decision-handle expression.
 *
 * @remarks
 * The handle's case selection is owned by the runtime: it lives in
 * workspace UI state under a key derived from the bound source paths
 * (deterministic, so it survives reloads), written only by `select` /
 * `clearSelection` / `resolve`. Everything consuming the same handle shares
 * the selection by construction.
 *
 * @example
 * ```tsx
 * const rosterView = $.let(Data.bind(rosterOut, { patch: rosterPatch }));
 * const judgementsView = $.let(Data.bind(judgementsInput, { mode: "staged" }));
 * const handle = $.let(Decision.bind([RosterConstraint], { decisions: [rosterView], judgements: judgementsView }));
 * ```
 */
export function decisionBind(options: DecisionBindOptions): DecisionHandle;
export function decisionBind<C extends EastType>(types: [C], options: DecisionBindOptions<C>): DecisionHandle<C>;
export function decisionBind<C extends EastType>(
    typesOrOptions: [C] | DecisionBindOptions,
    maybeOptions?: DecisionBindOptions<C>,
): DecisionHandle<C> {
    const [constraint, options] = maybeOptions !== undefined
        ? [(typesOrOptions as [C])[0], maybeOptions]
        : [DecisionConstraintType as unknown as C, typesOrOptions as unknown as DecisionBindOptions<C>];
    return decisionBindPlatformFn(
        [constraint],
        options.decisions.map(view => view.binding),
        options.judgements.binding,
        options.slice !== undefined ? some(East.value(options.slice, SliceStateType)) : none,
    ) as unknown as DecisionHandle<C>;
}
