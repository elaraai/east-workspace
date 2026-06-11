/**
 * The Decision platform types — the lean envelope a reasoning/optimization task
 * emits and the Decide components render. Designed to be filled in one shot by
 * an agent: 5 required fields, the rest optional; primitives over structs;
 * display reuses east-ui's `Format` (no bespoke unit strings).
 *
 * Three data sources with different lifecycles (NOT one fat struct):
 *   - DecisionType        : the optimizer's argument for ONE decision (read-mostly)
 *   - ReferenceType       : similar past decisions (separate history dataset, joined by caseId)
 *   - JudgementInputType  : the operator's notes + injected constraints + verdict (staged input — written back)
 *
 * run / model / audit / freshness / commit-state come from the e3 platform
 * (DataflowRun, DatasetRef, binding.status()), not from these values.
 *
 * Lives alongside OntologyType — the platform's canonical decision envelope that
 * the Decide component family (DecisionQueue, …) binds to and renders.
 */

import {
    East,
    StructType,
    VariantType,
    ArrayType,
    DictType,
    OptionType,
    StringType,
    FloatType,
    IntegerType,
    BooleanType,
    DateTimeType,
    NullType,
    SetType,
    FunctionType,
    some,
    none,
    variant,
    type SubtypeExprOrValue,
    type ExprType,
    type EastType,
} from "@elaraai/east";
import { Format } from "@elaraai/east-ui";

/** east-ui value-format descriptor (currency / percent / compact / unit / …). */
const TickFormat = Format.Types.Tick;
type TickFormatType = typeof TickFormat;

// ============================================================================
// Urgency — queue sort + routine collapse + "past SLA" count.
// ============================================================================

export const UrgencyType = VariantType({
    overdue: NullType,
    due: NullType,
    routine: NullType,
});
export type UrgencyType = typeof UrgencyType;

// ============================================================================
// Stakes — drives the briefing chip now; typed-confirm / approval gating
// later. A bare classification: reversibility is a platform property (every
// committed change is a diffable, invertible patch), and blast-radius prose
// belongs in `summary` / `evidence`.
// ============================================================================

/**
 * Stakes level classification for a decision.
 *
 * @property low - Routine consequence if wrong
 * @property medium - Noticeable consequence; standard review
 * @property high - Significant consequence; expect scrutiny
 * @property critical - Irreversible-scale consequence; gates extra ceremony
 */
export const StakesLevelType = VariantType({
    low: NullType,
    medium: NullType,
    high: NullType,
    critical: NullType,
});
/** Type alias for {@link StakesLevelType}. */
export type StakesLevelType = typeof StakesLevelType;
/** String-literal proxy for {@link StakesLevelType}. */
export type StakesLevelLiteral = "low" | "medium" | "high" | "critical";



// ============================================================================
// Evidence — the typed chips behind "why this is recommended".
// ============================================================================

/**
 * One piece of the model's argument, rendered as a typed evidence chip.
 *
 * @property label - The evidence category ("forecast", "capacity", "track")
 * @property text - The headline fact ("SE region +14%")
 * @property note - Supporting context ("next 2 wks · holiday-demand driver")
 */
export const EvidenceType = StructType({
    label: StringType,
    text: StringType,
    note: OptionType(StringType),
});
/** Type alias for {@link EvidenceType}. */
export type EvidenceType = typeof EvidenceType;

// ============================================================================
// Prompts + levers — the judgement SPEC, task-authored in the envelope. The
// operator's RESPONSES (answers / constraints) live in the judgement record;
// the handle joins the two by case id.
// ============================================================================

/**
 * One judgement question gating commit.
 *
 * @property id - Stable answer key — rewording `text` never orphans answers
 * @property text - What the operator reads
 */
export const PromptType = StructType({
    id: StringType,
    text: StringType,
});
/** Type alias for {@link PromptType}. */
export type PromptType = typeof PromptType;

/**
 * One constrainable knob this case accepts — a case of the solution's
 * constraint contract variant (see `JudgementInputType`'s type parameter).
 *
 * @property case - The contract variant's case name
 * @property label - What the operator reads in the constraint builder
 */
export const LeverType = StructType({
    case: StringType,
    label: StringType,
});
/** Type alias for {@link LeverType}. */
export type LeverType = typeof LeverType;

// ============================================================================
// Judgement answers + verdict — the operator's captured responses.
// ============================================================================

/**
 * The captured response to one judgement prompt.
 *
 * @property yes - The operator stands behind the input
 * @property no - The operator contradicts it — blocks commit
 * @property unknown - The operator can't say — routes the case to handoff
 */
export const AnswerType = VariantType({
    yes: NullType,
    no: NullType,
    unknown: NullType,
});
/** Type alias for {@link AnswerType}. */
export type AnswerType = typeof AnswerType;
/** String-literal proxy for {@link AnswerType}. */
export type AnswerLiteral = "yes" | "no" | "unknown";

/**
 * The operator's final word on a case — how it left the queue.
 *
 * @property accepted - The chosen option's label (empty string accepts the
 *   recommendation itself)
 * @property rejected - The recommendation was rejected; the operator takes
 *   the decision manually
 * @property deferred - Put off, with an optional note ("revisit after wk 12")
 * @property handoff - Routed to someone else — the recipient / routing note
 *   (the "don't know" exit)
 */
export const VerdictType = VariantType({
    accepted: StringType,
    rejected: NullType,
    deferred: OptionType(StringType),
    handoff: StringType,
});
/** Type alias for {@link VerdictType}. */
export type VerdictType = typeof VerdictType;

// ============================================================================
// One of the OTHER options the optimizer evaluated (the recommendation is the
// decision itself). The ONLY sub-type. `label` is its identity — what a
// JudgementInput `verdict` references when the operator picks it.
// ============================================================================

export const DecisionOptionType = StructType({
    id: OptionType(StringType), // stable identity; verdicts reference id ?? label
    label: StringType, // display label
    value: FloatType, // its uplift (same unit/format as the decision) → right bar
    downside: OptionType(FloatType), // its if-wrong magnitude → left bar
    confidence: OptionType(FloatType), // 0..1 — per-option confidence in the ranked view
    note: OptionType(StringType), // "2 wk lead time · cost lock-in"
});
export type DecisionOptionType = typeof DecisionOptionType;

// ============================================================================
// The lean decision value — the optimizer's argument for ONE case.
// Domain-agnostic: title/urgency/value describe ANY decision, so capacity,
// availability, and utilisation decisions share one queue; `kind` groups them.
// ============================================================================

export const DecisionType = StructType({
    // ── required core (the queue row) ──
    id: StringType,
    kind: StringType, // "capacity" | "availability" | "utilisation" — grouping/icon
    title: StringType, // "Move 3 SE shifts Patel → Cho"
    urgency: UrgencyType,
    value: FloatType, // headline magnitude (sign ⇒ +/−); drives bar + queue sort

    // ── optional ──
    deadline: OptionType(DateTimeType), // when action is needed → "overdue 2h" label + intra-bucket sort
    format: OptionType(TickFormat), // how to render value/downside/option values (Format.Currency, …)
    summary: OptionType(StringType), // "SE region · wk 09-16"
    downside: OptionType(FloatType), // if-wrong magnitude (hero "−$8k")
    confidence: OptionType(FloatType), // 0..1
    detail: OptionType(StringType), // briefing body (prose / markdown)
    stakes: OptionType(StakesLevelType), // classification → hero chip + commit ceremony
    prompts: ArrayType(PromptType), // judgement checklist — questions the model can't answer; gates commit
    levers: ArrayType(LeverType), // which constraint-contract cases this case accepts
    evidence: ArrayType(EvidenceType), // typed chips: { label, text, note }
    alternatives: ArrayType(DecisionOptionType),
});
export type DecisionType = typeof DecisionType;


// ============================================================================
// SEPARATE DATASET — similar past decisions (queried by caseId / kind).
// ============================================================================

export const ReferenceType = StructType({
    caseId: StringType, // links to the live decision (or its kind)
    meta: OptionType(StringType), // "Mar 2024 · NE"
    outcome: OptionType(StringType), // "−$6k OT, 0 SLA"
    similarity: OptionType(FloatType), // 0.95 — drives the rail bar + novelty flag
});
export type ReferenceType = typeof ReferenceType;


// ============================================================================
// STAGED INPUT — the operator's contribution (the thing WRITTEN back).
// Modify = inject a constraint here; the reasoning tasks depend on it, so
// committing re-runs the optimizer (the modify → recalculate loop).
// ============================================================================

/**
 * Judgement.Inject — a typed requirement the next optimiser run must satisfy.
 *
 * Type-first variant (the `SlicePredicateType` shape): the outer case is the
 * constrained field's primitive kind, the inner case the requirement
 * operator with its typed payload. LOB-shaped on purpose — bounds, pins,
 * set membership, date windows — and mechanically translatable to solver
 * constraints (linear ≤/≥/=, membership encodings) by the reasoning task.
 * Aggregate constraints (counts/sums over groups) are a later variant case.
 *
 * @property string - `eq` / `neq` pin or forbid a value; `in` / `notIn` set
 *   membership
 * @property integer - `eq` pin; `atMost` / `atLeast` bounds; `between` range
 * @property float - `eq` pin; `atMost` / `atLeast` bounds; `between` range
 * @property datetime - `before` / `after` bounds; `between` window
 * @property boolean - `is` requirement
 */
export const DecisionConstraintType = VariantType({
    string: VariantType({
        eq: StringType,
        neq: StringType,
        in: SetType(StringType),
        notIn: SetType(StringType),
    }),
    integer: VariantType({
        eq: IntegerType,
        atMost: IntegerType,
        atLeast: IntegerType,
        between: StructType({ min: IntegerType, max: IntegerType }),
    }),
    float: VariantType({
        eq: FloatType,
        atMost: FloatType,
        atLeast: FloatType,
        between: StructType({ min: FloatType, max: FloatType }),
    }),
    datetime: VariantType({
        before: DateTimeType,
        after: DateTimeType,
        between: StructType({ min: DateTimeType, max: DateTimeType }),
    }),
    boolean: VariantType({
        is: BooleanType,
    }),
});
/** Type alias for {@link DecisionConstraintType}. */
export type DecisionConstraintType = typeof DecisionConstraintType;

/**
 * One constrainable field in a surface's constraint vocabulary — what the
 * judgement panel's typed builder offers. Mirrors `Slice.config` fields,
 * minus accessors: constraints are interpreted by the reasoning task, never
 * evaluated client-side.
 *
 * @property label - Display label ("Cho weekly hours cap")
 * @property kind - The field's primitive kind — drives the typed op editor
 */
/** A constraint field's primitive kind — drives the typed op editor. */
export const ConstraintKindType = VariantType({
    string: NullType,
    integer: NullType,
    float: NullType,
    datetime: NullType,
    boolean: NullType,
});
/** Type alias for {@link ConstraintKindType}. */
export type ConstraintKindType = typeof ConstraintKindType;

export const ConstraintFieldType = StructType({
    label: StringType,
    kind: ConstraintKindType,
});
/** Type alias for {@link ConstraintFieldType}. */
export type ConstraintFieldType = typeof ConstraintFieldType;

/**
 * The surface's constraint vocabulary, keyed by field id (the model-namespace
 * path the reasoning task resolves, e.g. `"cho.hardCapHrs"`).
 */
export const ConstraintVocabularyType = DictType(StringType, ConstraintFieldType);
/** Type alias for {@link ConstraintVocabularyType}. */
export type ConstraintVocabularyType = typeof ConstraintVocabularyType;

/** `update(editedDecision)` — the writer a probe (`modify`) editor receives.
 *  Calling it writes the edited decision back through its owning binding. */
export const DecisionUpdateType = FunctionType([DecisionType], NullType);
/** Type alias for {@link DecisionUpdateType}. */
export type DecisionUpdateType = typeof DecisionUpdateType;

/**
 * Build the judgement-record type for a solution's constraint contract — the
 * `sliceConfigFor(rowType)` pattern. The contract is a by-name `VariantType`
 * declared once in the solution package and imported by both the reasoning
 * task (which `$.matchTag`s constraints, fully typed) and the surface (whose
 * builder renders a typed editor per case payload). Defaults to
 * {@link DecisionConstraintType}, the primitive op-variant.
 */
export function judgementInputType<C extends EastType = DecisionConstraintType>(
    constraint?: C,
) {
    return StructType({
        caseId: StringType,
        answers: DictType(StringType, AnswerType), // per-prompt responses, keyed by prompt id
        knowledge: OptionType(StringType), // free-text "what the model can't see"
        constraints: ArrayType((constraint ?? DecisionConstraintType) as C), // injected requirements (upsert by case name) → re-run
        verdict: OptionType(VerdictType), // how the case left the queue (accepted / rejected / deferred / handoff)
        resolvedAt: OptionType(DateTimeType), // when the verdict was committed — the journal's timeline
    });
}

/** The default judgement-record type (primitive op-variant constraints). */
export const JudgementInputType = judgementInputType();
export type JudgementInputType = typeof JudgementInputType;


// ============================================================================
// Factory constructors — default every optional, so an agent writes the 5
// required fields (+ whatever it has) and never spells `none` / `[]` / `variant`.
// ============================================================================

/** String-literal proxy for {@link UrgencyType}. */
export type UrgencyLiteral = "overdue" | "due" | "routine";

/** Plain-JS shape for {@link Decision.option}. */
export interface DecisionOptionInput {
    id?: SubtypeExprOrValue<StringType>;
    label: SubtypeExprOrValue<StringType>;
    value: SubtypeExprOrValue<FloatType>;
    downside?: SubtypeExprOrValue<FloatType>;
    confidence?: SubtypeExprOrValue<FloatType>;
    note?: SubtypeExprOrValue<StringType>;
}

function createDecisionOption(input: DecisionOptionInput): ExprType<DecisionOptionType> {
    return East.value({
        id: input.id !== undefined ? some(input.id) : none,
        label: input.label,
        value: input.value,
        downside: input.downside !== undefined ? some(input.downside) : none,
        confidence: input.confidence !== undefined ? some(input.confidence) : none,
        note: input.note !== undefined ? some(input.note) : none,
    }, DecisionOptionType);
}



/** Plain-JS shape for one evidence chip (see {@link EvidenceType}). */
/** String-literal proxy for a constraint field's primitive kind. */
export type ConstraintKindLiteral = "string" | "integer" | "float" | "datetime" | "boolean";

/** Plain-JS shape for one constraint-vocabulary field — coerced to
 *  {@link ConstraintFieldType} by `Decision.bind`. */
export interface ConstraintFieldInput {
    label: SubtypeExprOrValue<StringType>;
    kind: ConstraintKindLiteral | SubtypeExprOrValue<ConstraintKindType>;
}

export interface EvidenceInput {
    label: SubtypeExprOrValue<StringType>;
    text: SubtypeExprOrValue<StringType>;
    note?: SubtypeExprOrValue<StringType>;
}

/** Plain-JS shape for {@link Decision.make} — required core + optional rest. */
export interface DecisionInput {
    id: SubtypeExprOrValue<StringType>;
    kind: SubtypeExprOrValue<StringType>;
    title: SubtypeExprOrValue<StringType>;
    urgency: SubtypeExprOrValue<UrgencyType> | UrgencyLiteral;
    value: SubtypeExprOrValue<FloatType>;
    deadline?: SubtypeExprOrValue<DateTimeType>;
    format?: SubtypeExprOrValue<TickFormatType>;
    summary?: SubtypeExprOrValue<StringType>;
    downside?: SubtypeExprOrValue<FloatType>;
    confidence?: SubtypeExprOrValue<FloatType>;
    detail?: SubtypeExprOrValue<StringType>;
    stakes?: StakesLevelLiteral | SubtypeExprOrValue<StakesLevelType>;
    prompts?: (string | PromptInput)[] | ExprType<ArrayType<PromptType>>;
    levers?: LeverInput[] | ExprType<ArrayType<LeverType>>;
    evidence?: EvidenceInput[] | ExprType<ArrayType<EvidenceType>>;
    alternatives?: SubtypeExprOrValue<ArrayType<DecisionOptionType>>;
}

/** Plain-JS shape for one judgement prompt — a bare string derives `id`
 *  from the text. */
export interface PromptInput {
    id?: SubtypeExprOrValue<StringType>;
    text: SubtypeExprOrValue<StringType>;
}

/** Plain-JS shape for one lever (see {@link LeverType}). */
export interface LeverInput {
    case: SubtypeExprOrValue<StringType>;
    label: SubtypeExprOrValue<StringType>;
}

function createDecision(input: DecisionInput): ExprType<DecisionType> {
    const stakesValue = input.stakes !== undefined
        ? some(typeof input.stakes === "string"
            ? East.value(variant(input.stakes, null), StakesLevelType)
            : input.stakes)
        : none;
    const promptsValue = input.prompts === undefined
        ? []
        : Array.isArray(input.prompts)
            ? input.prompts.map(prompt => East.value(
                typeof prompt === "string"
                    ? { id: prompt, text: prompt }
                    : { id: prompt.id ?? prompt.text, text: prompt.text },
                PromptType))
            : input.prompts;
    const leversValue = input.levers === undefined
        ? []
        : Array.isArray(input.levers)
            ? input.levers.map(lever => East.value({ case: lever.case, label: lever.label }, LeverType))
            : input.levers;
    const evidenceValue = input.evidence === undefined
        ? []
        : Array.isArray(input.evidence)
            ? input.evidence.map(e => East.value({
                label: e.label,
                text: e.text,
                note: e.note !== undefined ? some(e.note) : none,
            }, EvidenceType))
            : input.evidence;
    return East.value({
        id: input.id,
        kind: input.kind,
        title: input.title,
        urgency: typeof input.urgency === "string"
            ? East.value(variant(input.urgency, null), UrgencyType)
            : input.urgency,
        value: input.value,
        deadline: input.deadline !== undefined ? some(input.deadline) : none,
        format: input.format !== undefined ? some(input.format) : none,
        summary: input.summary !== undefined ? some(input.summary) : none,
        downside: input.downside !== undefined ? some(input.downside) : none,
        confidence: input.confidence !== undefined ? some(input.confidence) : none,
        detail: input.detail !== undefined ? some(input.detail) : none,
        stakes: stakesValue,
        prompts: promptsValue,
        levers: leversValue,
        evidence: evidenceValue,
        alternatives: input.alternatives ?? [],
    }, DecisionType);
}

/** Plain-JS shape for {@link Decision.reference}. */
export interface DecisionReferenceInput {
    caseId: SubtypeExprOrValue<StringType>;
    meta?: SubtypeExprOrValue<StringType>;
    outcome?: SubtypeExprOrValue<StringType>;
    similarity?: SubtypeExprOrValue<FloatType>;
}

function createReference(input: DecisionReferenceInput): ExprType<ReferenceType> {
    return East.value({
        caseId: input.caseId,
        meta: input.meta !== undefined ? some(input.meta) : none,
        outcome: input.outcome !== undefined ? some(input.outcome) : none,
        similarity: input.similarity !== undefined ? some(input.similarity) : none,
    }, ReferenceType);
}

/** Plain-JS shape for {@link Decision.judgement}. */
export interface DecisionJudgementInput {
    caseId: SubtypeExprOrValue<StringType>;
    answers?: SubtypeExprOrValue<DictType<StringType, AnswerType>>;
    knowledge?: SubtypeExprOrValue<StringType>;
    constraints?: SubtypeExprOrValue<ArrayType<DecisionConstraintType>>;
    verdict?: SubtypeExprOrValue<VerdictType>;
    resolvedAt?: SubtypeExprOrValue<DateTimeType>;
}

function createJudgement(input: DecisionJudgementInput): ExprType<JudgementInputType> {
    return East.value({
        caseId: input.caseId,
        answers: input.answers ?? new Map(),
        knowledge: input.knowledge !== undefined ? some(input.knowledge) : none,
        constraints: input.constraints ?? [],
        verdict: input.verdict !== undefined ? some(input.verdict) : none,
        resolvedAt: input.resolvedAt !== undefined ? some(input.resolvedAt) : none,
    }, JudgementInputType);
}

/**
 * The Decision platform namespace — ergonomic constructors + the East `Types`.
 *
 * @example
 * ```ts
 * Decision.make({
 *   id: "cap-SE-0916", kind: "capacity",
 *   title: "Raise SE senior-engineer cover to 6 FTE",
 *   urgency: "overdue", value: 80000,
 *   format: Format.Currency({ currency: "USD", compact: "short" }),
 *   downside: -8000, confidence: 0.82,
 *   evidence: ["forecast: SE +14%"],
 *   alternatives: [Decision.option({ label: "Hire 1 contractor", value: 48000, downside: -15000 })],
 * });
 * ```
 */
export const Decision = {
    /** Build one decision — required core + optional rest (optionals default to absent). */
    make: createDecision,
    /** Build one of a decision's other evaluated options. */
    option: createDecisionOption,
    /** Build one similar-past-decision reference (separate history dataset). */
    reference: createReference,
    /** Build one staged judgement contribution (knowledge + injected constraints + verdict). */
    judgement: createJudgement,
    Types: {
        Decision: DecisionType,
        Option: DecisionOptionType,
        Urgency: UrgencyType,
        Stakes: StakesLevelType,
        StakesLevel: StakesLevelType,
        Prompt: PromptType,
        Lever: LeverType,
        Evidence: EvidenceType,
        Reference: ReferenceType,
        JudgementInput: judgementInputType,
        DefaultJudgementInput: JudgementInputType,
        Constraint: DecisionConstraintType,
        ConstraintField: ConstraintFieldType,
        ConstraintVocabulary: ConstraintVocabularyType,
        Answer: AnswerType,
        Verdict: VerdictType,
    },
} as const;
