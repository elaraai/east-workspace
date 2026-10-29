/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The DecisionQueue's interface (#1450, `Decision Queue Spec.md` §5, §12, §13,
 * §15): what `DecisionQueue.decisions`, `DecisionQueue.verdicts`, each
 * `DecisionQueue.change.*` and the tag refuse at build, each naming the change
 * to make; the roles' inference, each mistake a compile error; and the
 * payload's types. Building reads no record, so what a payload holds once read
 * is checked on e3 itself, in e3-ui-components; here, what is refused before
 * anything is read.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, Expr, FloatType, NullType, OptionType, PatchType, StringType, StructType, VariantType, isTypeEqual,
    type BlockBuilder, type EastType, type ExprType,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Slice, Style } from "@elaraai/east-ui";
import * as E3UI from "@elaraai/e3-ui";
import { Calendar, Data, DecisionQueue, Record, Roster, Schedule, Sheet } from "@elaraai/e3-ui";
import {
    DecisionCaseType, DecisionOptionType, DecisionPointType, DecisionQueuePayloadType, DecisionTargetType, DecisionVerdictType, DecisionZoneType,
    createDecisionQueuePayload, type DecisionQueueProps,
} from "@elaraai/e3-ui/internal";
import * as yard from "../allocation/allocation.examples.js";
import { calendarJobs, calendarMachines } from "../calendar/calendar.examples.js";
import { planEventJobs, planPrintPresses } from "../plan/plan-events.examples.js";
import { minimalDuties, minimalShiftTimes, minimalTeams, minimalWorkers } from "../roster/roster.examples.js";
import { OptimiseWorkOrder, optimiseWorkOrders } from "../sheet/optimise.examples.js";
import * as ops from "./ops.js";

/** Builds in a block, as a UI's body does: what it declares is built there — and refused, if it is, as it is built. */
function inBlock<T>(build: ($: BlockBuilder<NullType>) => T): T {
    let out: T | undefined;
    East.function([], NullType, ($) => { out = build($); });
    return out!;
}

// ============================================================================
// The smallest queue's (§3.2): a record of proposals, each its own one decision
// ============================================================================

/** A proposal, as its roles read it. */
type P = ExprType<typeof ops.Proposal>;

/** The proposals' targets (§3.2): the work orders as the Sheet draws them, and the price list, which no builder draws. */
function proposalTargets($: BlockBuilder<NullType>) {
    const orders = $.let(Record.bind(optimiseWorkOrders));
    const prices = $.let(Record.bind(ops.listPrices));
    return {
        orders: DecisionQueue.change.sheet(orders, { name: "Sheet", icon: "table-cells", columns: {
            reference: Sheet.column.text(OptimiseWorkOrder, { header: "Reference" }),
            due: Sheet.column.date(OptimiseWorkOrder, { header: "Due" }),
        } }),
        pricing: DecisionQueue.change.record(prices, { name: "Pricing", icon: "tag", label: (r) => r.region }),
    };
}

/** The proposals' roles (§3.2): each an East function over the app's own row, the option's beside the case's (D15). */
const proposalRoles = (of: unknown) => ({
    scope: (p: P) => p.site, due: (p: P) => p.deadline, unit: (p: P) => p.metric, model: (p: P) => p.run, why: (p: P) => p.rationale,
    title: (p: P) => p.headline, summary: (p: P) => p.brief, detail: (p: P) => p.description, value: (p: P) => p.saving,
    change: { from: (p: P) => p.details, of } as { from: unknown; of: unknown },
});

/** The proposals' roles, as a test changes them. */
type ProposalRoles = ReturnType<typeof proposalRoles> & Readonly<Record<string, unknown>>;

/**
 * Declares the proposals' cases: the roles the test gives beside or in place of
 * the base's, over the binding it gives — `Data.bind(proposals)` by default.
 */
function proposalCases(
    roles: (base: ProposalRoles) => object = (base) => base,
    binding: ($: BlockBuilder<NullType>) => unknown = ($) => $.let(Data.bind(ops.proposals)),
) {
    return inBlock(($) => {
        const cases = binding($);
        return DecisionQueue.decisions(cases as never, roles(proposalRoles(proposalTargets($)) as ProposalRoles) as never);
    });
}

/** The verdicts' roles over the app's verdict row (§3.1): every part of a verdict, each a field by name. */
const verdictRoles = (entries: unknown) => ({
    entries,
    verdict: { field: "verdict", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" } as Readonly<Record<string, unknown>>,
    option: "option",
    answer: { field: "answer", yes: "yes", no: "no", unsure: "unsure" } as Readonly<Record<string, unknown>>,
    reason: { field: "reason", context: "context", data: "data", priorities: "priorities", other: "other" } as Readonly<Record<string, unknown>>,
    note: "note",
});

/** The verdicts' roles, as a test changes them. */
type VerdictRoles = ReturnType<typeof verdictRoles> & Readonly<Record<string, unknown>>;

/**
 * Declares the proposals' verdicts: the roles the test gives beside or in place
 * of the base's, over the binding it gives — the record with its patch door by default.
 */
function proposalVerdicts(
    roles: (base: VerdictRoles) => object = (base) => base,
    binding: ($: BlockBuilder<NullType>) => unknown = ($) => $.let(Record.bind(ops.proposalVerdicts)),
) {
    return inBlock(($) => {
        const rows = binding($);
        const entries = $.let(Data.bindPaged(ops.proposalVerdicts));
        return DecisionQueue.verdicts(rows as never, roles(verdictRoles(entries) as VerdictRoles) as never);
    });
}

/**
 * Builds the smallest queue's payload: the props the test gives beside or in
 * place of the base's, its cases bound as the test binds them.
 */
function proposalQueue(change: (base: DecisionQueueProps, $: BlockBuilder<NullType>) => object = (base) => base) {
    return inBlock(($) => {
        const cases = $.let(Data.bind(ops.proposals));
        const verdictRows = $.let(Record.bind(ops.proposalVerdicts));
        const verdictEntries = $.let(Data.bindPaged(ops.proposalVerdicts));
        const decisions = DecisionQueue.decisions(cases, {
            scope: (p) => p.site, due: (p) => p.deadline, unit: (p) => p.metric, model: (p) => p.run, why: (p) => p.rationale,
            title: (p) => p.headline, summary: (p) => p.brief, detail: (p) => p.description, value: (p) => p.saving,
            change: { from: (p) => p.details, of: proposalTargets($) },
        });
        const verdicts = DecisionQueue.verdicts(verdictRows, {
            entries: verdictEntries,
            verdict: { field: "verdict", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" },
        });
        return createDecisionQueuePayload(change({ id: "proposals", decisions, verdicts }, $) as DecisionQueueProps);
    });
}

// ============================================================================
// The cases with alternatives (§3.1): the app's cases, each with its options
// ============================================================================

/** A case and an option of the app's, as their roles read them. */
type C = ExprType<typeof ops.OpsCase>;
type O = ExprType<typeof ops.OpsOption>;

/** The cases' roles (§3.1): the case's, `recommended`, and the option's in `options`, over the option, its key and its case. */
const opsRoles = () => ({
    scope: (c: C) => c.scope, due: (c: C) => c.due, routine: (c: C) => c.routine, unit: (c: C) => c.unit, model: (c: C) => c.model,
    why: (c: C) => c.why, ifWrong: (c: C) => c.ifWrong, recommended: (c: C) => c.recommended,
    options: {
        from: (c: C) => c.options,
        label: (o: O) => o.label, title: (o: O) => o.title, summary: (o: O) => o.summary, detail: (o: O) => o.detail, note: (o: O) => o.note,
        value: (o: O) => o.value, confidence: (o: O) => o.confidence, question: (o: O) => o.question, warn: (o: O) => o.warn,
        refused: (o: O) => o.refused, knockOn: (o: O) => o.knockOn, guesses: (o: O) => o.guesses,
        change: { from: (o: O) => o.change, of: {} },
    } as Readonly<Record<string, unknown>>,
});

/** Declares the app's cases with alternatives, the roles the test gives — refused before any target is read. */
function opsCases(roles: (base: ReturnType<typeof opsRoles> & Readonly<Record<string, unknown>>) => object) {
    return inBlock(($) => {
        const cases = $.let(Data.bind(ops.opsCases));
        return DecisionQueue.decisions(cases as never, roles(opsRoles()) as never);
    });
}

// ============================================================================
// The tag and its namespace
// ============================================================================

test("the queue is one tag over the app's records: Decision.bind and <DecisionJournal> are gone (§13)", () => {
    assert.equal("Decision" in E3UI, false);
    assert.equal("DecisionJournal" in E3UI, false);
    assert.doesNotThrow(() => proposalQueue());
});

describe("the props §13 removed, each refused naming its replacement", () => {
    const removed: readonly (readonly [string, RegExp])[] = [
        ["handle", /DecisionQueue: `handle` is gone — the queue reads the app's cases and writes its verdicts: decisions=\{DecisionQueue\.decisions\(Data\.bind\(cases\), \{ … \}\)\} verdicts=\{DecisionQueue\.verdicts\(Record\.bind\(verdicts\), \{ entries, verdict \}\)\}/],
        ["heading", /DecisionQueue: `heading` is gone — the queue fills the box its host gives it, and a heading over it is the host's own/],
        ["modify", /DecisionQueue: `modify` is gone — Modify edits a row in its target's own form/],
        ["evidence", /DecisionQueue: `evidence` is gone — the open card draws where its option's change lands, its target's preview/],
        ["defaultExpanded", /DecisionQueue: `defaultExpanded` is gone — the open case is the queue's own, kept under its `id`; the host hears it with `onSelect`/],
        ["defaultFacet", /DecisionQueue: `defaultFacet` is gone — the open card shows its change, its options, Why and Your call together/],
        ["facets", /DecisionQueue: `facets` is gone — the open card shows its change, its options, Why and Your call together; a role left out turns off what it drives/],
        ["onApply", /DecisionQueue: `onApply` is gone — Apply writes the option's change through its target's patch door and the verdict through `verdicts`/],
        ["onReject", /DecisionQueue: `onReject` is gone — Override, Defer and Hand off each write a verdict through `verdicts`/],
        ["affordances", /DecisionQueue: `affordances` is gone — the rail is the slice's: slice=\{\{ slice: Slice\.bindRecords\(key, \{ decisions: \{ source, … \} \}\) \}\}/],
        ["maxHeight", /DecisionQueue: `maxHeight` is gone — the queue fills the box its host gives it, which the host sizes/],
        ["density", /DecisionQueue: `density` is gone — the queue's cards keep one spacing, and its narrow layout follows its own width/],
        ["groups", /DecisionQueue: `groups` is gone — the queue sections its cases by when they are due, routine ones in a band of their own/],
        ["groupBy", /DecisionQueue: `groupBy` is gone — the queue sections its cases by when they are due, routine ones in a band of their own/],
        ["collapsible", /DecisionQueue: `collapsible` is gone — the Routine band folds, its fold kept under the queue's `id`/],
    ];
    for (const [prop, refusal] of removed) {
        test(`\`${prop}\``, () => {
            assert.throws(() => proposalQueue((base) => ({ ...base, [prop]: true })), refusal);
        });
    }
});

describe("the tag's own props", () => {
    test("`id` names the queue's state, and is required", () => {
        const refusal = /DecisionQueue: `id` names the queue's state — the open card, the Routine band's fold, each card's choices and the session's drafts: id="opsQueue"/;
        assert.throws(() => proposalQueue((base) => ({ ...base, id: undefined })), refusal);
        assert.throws(() => proposalQueue((base) => ({ ...base, id: "" })), refusal);
    });

    test("`decisions` is DecisionQueue.decisions, and `verdicts` DecisionQueue.verdicts", () => {
        assert.throws(() => proposalQueue((base, $) => ({ ...base, decisions: $.let(Data.bind(ops.proposals)) })),
            /DecisionQueue: `decisions` is DecisionQueue\.decisions\(binding, roles\) — the app's cases, and the roles that read each part of a card from them/);
        assert.throws(() => proposalQueue((base, $) => ({ ...base, verdicts: $.let(Record.bind(ops.proposalVerdicts)) })),
            /DecisionQueue: `verdicts` is DecisionQueue\.verdicts\(Record\.bind\(record\), \{ entries, verdict, … \}\) — the app's record each verdict is written to, declaring patch: mutation\.patch\(\)/);
    });

    test("`onSelect`, `readOnly` and `now` are taken as values or East expressions", () => {
        assert.doesNotThrow(() => proposalQueue((base) => ({ ...base, readOnly: true, now: new Date("2028-03-08T09:00:00Z"),
            onSelect: East.function([OptionType(StringType)], NullType, () => null) })));
    });
});

describe("the rail: one Slice.bindRecords, its `decisions` source over the cases' record (D4)", () => {
    /** The proposals by site: the rail's one source. */
    const bySite = () => Data.bindPaged(ops.proposals, { indexes: ["proposals_by_site"] });
    /** The base's cases, bound for a read through the slice's source. */
    const paged = (base: DecisionQueueProps, $: BlockBuilder<NullType>) => {
        const cases = $.let(Data.bindPaged(ops.proposals));
        return {
            ...base,
            decisions: DecisionQueue.decisions(cases, {
                scope: (p) => p.site, due: (p) => p.deadline, unit: (p) => p.metric, model: (p) => p.run, why: (p) => p.rationale,
                title: (p) => p.headline, summary: (p) => p.brief, detail: (p) => p.description, value: (p) => p.saving,
                change: { from: (p) => p.details, of: proposalTargets($) },
            }),
        };
    };

    test("the cases bound Data.bindPaged read through the slice's `decisions` source", () => {
        assert.doesNotThrow(() => proposalQueue((base, $) => {
            const slice = $.let(Slice.bindRecords("spec.queue", { decisions: { source: bySite(), fields: { site: { label: "Site" } } } }));
            return { ...paged(base, $), slice: { slice } };
        }));
    });

    test("the slice is taken as { slice }, never the bare handle, and only Slice.bindRecords", () => {
        assert.throws(() => proposalQueue((base, $) => ({ ...base, slice: $.let(Slice.bindRecords("spec.bare", { decisions: { source: bySite() } })) })),
            /DecisionQueue: `slice` takes \{ slice \} — slice=\{\{ slice: Slice\.bindRecords\(key, \{ decisions: \{ source, … \} \}\) \}\}: the bare handle is not taken/);
        assert.throws(() => proposalQueue((base) => ({ ...base, slice: { slice: Slice.bind("spec.local", [{ site: "A" }], { fields: { site: { label: "Site" } } }) } })),
            /DecisionQueue: `slice` is Slice\.bindRecords\(key, \{ decisions \}\)/);
    });

    test("a source of the slice other than `decisions` is refused, naming it", () => {
        assert.throws(() => proposalQueue((base, $) => {
            const slice = $.let(Slice.bindRecords("spec.cases", { cases: { source: bySite() } }));
            return { ...paged(base, $), slice: { slice } };
        }), /DecisionQueue: `slice` narrows its cases, through one source over the cases' record — its source 'cases' is none of them/);
    });

    test("cases bound Data.bind beside the slice's source, or Data.bindPaged with none, are refused naming the other", () => {
        assert.throws(() => proposalQueue((base, $) => {
            const slice = $.let(Slice.bindRecords("spec.whole", { decisions: { source: bySite() } }));
            return { ...base, slice: { slice } };
        }), /DecisionQueue\.decisions: Data\.bind\(source\) reads the cases whole, which the slice's `decisions` source exists to avoid — bind them Data\.bindPaged\(record\)/);
        assert.throws(() => proposalQueue((base, $) => paged(base, $)),
            /DecisionQueue\.decisions: Data\.bindPaged\(record\) reads the cases through the slice's `decisions` source — give slice=\{\{ slice: Slice\.bindRecords\(key, \{ decisions: \{ source: Data\.bindPaged\(record, \{ indexes \}\) \} \}\) \}\}, or bind Data\.bind\(source\)/);
    });
});

// ============================================================================
// The cases
// ============================================================================

describe("DecisionQueue.decisions: the cases, read only, each role an East function over the app's row (§5.1)", () => {
    test("the proposals declare: each case its own one proposal, its option's roles beside the case's (D15)", () => {
        assert.doesNotThrow(() => proposalCases());
    });

    test("the cases are read only: a Record.bind is refused, naming Data.bind and Data.bindPaged", () => {
        // The proposals as a record declaring its patch door, which the queue never writes through.
        const editable = e3.record("decision_spec_proposals", DictType(StringType, ops.Proposal), {
            initial: new Map(), mutations: (mutation) => ({ patch: mutation.patch() }),
        });
        assert.throws(() => proposalCases(undefined, ($) => $.let(Record.bind(editable))),
            /DecisionQueue\.decisions: the cases are read only — bind them Data\.bind\(source\) to read them whole, or Data\.bindPaged\(record\) to read them through the slice's `decisions` source: the queue writes no case, only its verdict/);
    });

    test("a role is an East function, never a field's name", () => {
        assert.throws(() => proposalCases((base) => ({ ...base, scope: "site" })),
            /DecisionQueue\.decisions: `scope` is an East function over the row and its key — scope: \(row\) => row\.field — and it takes a String/);
        assert.throws(() => proposalCases((base) => ({ ...base, value: "saving" })),
            /DecisionQueue\.decisions: `value` is an East function over the row and its key — value: \(row\) => row\.field — and it takes a Float/);
    });

    test("a role returning another type than its role takes is refused, naming both", () => {
        assert.throws(() => proposalCases((base) => ({ ...base, scope: (p: P) => p.saving })), /DecisionQueue\.decisions: `scope` returns .*Float.* — it takes a String/);
        assert.throws(() => proposalCases((base) => ({ ...base, due: (p: P) => p.site })), /DecisionQueue\.decisions: `due` returns .*String.* — it takes an Option<DateTime>/);
        assert.throws(() => proposalCases((base) => ({ ...base, value: (p: P) => p.site })), /DecisionQueue\.decisions: `value` returns .*String.* — it takes a Float/);
        assert.throws(() => proposalCases((base) => ({ ...base, confidence: (p: P) => p.saving })), /DecisionQueue\.decisions: `confidence` returns .*Float.* — it takes an Option<Float>/);
    });

    test("a required role left out is refused, naming what it reads", () => {
        const required = [["scope", "a String"], ["due", "an Option<DateTime>"], ["unit", "a String"], ["model", "a String"], ["why", "a String"],
            ["title", "a String"], ["summary", "a String"], ["detail", "a String"], ["value", "a Float"]] as const;
        for (const [role, takes] of required) {
            assert.throws(() => proposalCases((base) => ({ ...base, [role]: undefined })),
                new RegExp(`DecisionQueue\\.decisions: \`${role}\` is required — an East function reading ${takes} from the row`), role);
        }
    });

    test("cases with alternatives: `recommended` among them, the option's roles over the option, its key and its case", () => {
        const of = /DecisionQueue\.decisions: `options\.change\.of` gives no target for the tag 'orders' — give each of the variant's tags \(orders, pricing, print, rota, rotaCost, workshop, yard\) a target/;
        // Declared up to the change role, whose targets this test gives none of.
        assert.throws(() => opsCases((base) => base), of);
        assert.throws(() => opsCases((base) => ({ ...base, options: { ...base.options, label: (_o: O, key: ExprType<StringType>) => key,
            note: (_o: O, _key: ExprType<StringType>, c: C) => c.scope } })), /`options\.note` returns .*String.* — it takes an Option<String>/);
        assert.throws(() => opsCases((base) => ({ ...base, recommended: undefined })),
            /DecisionQueue\.decisions: `recommended` is required — an East function reading a String, a key of the case's options from the row/);
        assert.throws(() => opsCases((base) => ({ ...base, options: { ...base.options, title: (o: O) => o.value } })),
            /DecisionQueue\.decisions: `options\.title` returns .*Float.* — it takes a String/);
        assert.throws(() => opsCases((base) => ({ ...base, options: { ...base.options, from: (c: C) => c.scope } })),
            /DecisionQueue\.decisions: `options\.from` returns .*String.* — it takes a Dict<String, O>, the case's alternatives by key, each a struct/);
        assert.throws(() => opsCases((base) => ({ ...base, options: (c: C) => c.options })),
            /DecisionQueue\.decisions: `options` is \{ from, …the option's roles \} — from: \(c\) => c\.options, a Dict<String, O> of the case's alternatives/);
    });

    test("D15's two forms are never mixed: `recommended` with no `options`, or an option's role both beside the case's and in `options`", () => {
        assert.throws(() => proposalCases((base) => ({ ...base, recommended: (p: P) => p.site })),
            /DecisionQueue\.decisions: `recommended` names one of a case's `options` — and no `options` are given: give options: \{ from, … \} with the option's roles inside it, or leave `recommended` out for cases that are each their own one proposal, the option's roles beside the case's \(D15\)/);
        assert.throws(() => opsCases((base) => ({ ...base, title: (c: C) => c.scope })),
            /DecisionQueue\.decisions: `title` is given beside the case's roles and `options` too — an option's roles go in options: \{ from, … \} for cases with alternatives, or beside the case's for cases that are each their own one proposal, never both \(D15\)/);
    });
});

describe("the change role: the app's variant, and a target for each of its tags (D6)", () => {
    /** The proposals' targets, bound in the declaration's block. */
    const withChange = (change: (of: ReturnType<typeof proposalTargets>) => unknown) => inBlock(($) => {
        const cases = $.let(Data.bind(ops.proposals));
        return DecisionQueue.decisions(cases as never, { ...proposalRoles(undefined), change: change(proposalTargets($)) } as never);
    });

    test("`change` is { from, of }, and `from` returns a variant", () => {
        assert.throws(() => withChange(() => ({ from: (p: P) => p.details })),
            /DecisionQueue\.decisions: `change` is \{ from, of \} — from: \(o\) => o\.change, the variant whose tag is the kind of decision, and of: a target for each tag, DecisionQueue\.change\.\*/);
        assert.throws(() => withChange((of) => ({ from: (p: P) => p.site, of })),
            /DecisionQueue\.decisions: `change\.from` returns .*String.* — it takes a variant, its tag the kind of decision and each tag's value a patch of the record that kind changes, PatchType\(DictType\(K, R\)\)/);
    });

    test("`of` gives every tag a target, and names no other", () => {
        assert.throws(() => withChange(({ orders }) => ({ from: (p: P) => p.details, of: { orders } })),
            /DecisionQueue\.decisions: `change\.of` gives no target for the tag 'pricing' — give each of the variant's tags \(orders, pricing\) a target, DecisionQueue\.change\.\*: a tag with no target cannot reach the queue \(D6\)/);
        assert.throws(() => withChange((of) => ({ from: (p: P) => p.details, of: { ...of, shipping: of.orders } })),
            /DecisionQueue\.decisions: `change\.of` names 'shipping', which is no tag of the variant `change\.from` returns \(orders, pricing\)/);
        assert.throws(() => withChange((of) => ({ from: (p: P) => p.details, of: { ...of, orders: "Sheet" } })),
            /DecisionQueue\.decisions: `change\.of\.orders` is a target — DecisionQueue\.change\.roster\(…\), \.plan, \.calendar, \.allocation, \.sheet, \.record, \.zones or \.projection/);
    });

    test("a tag's target draws the record its patch is of: another is refused, naming both", () => {
        assert.throws(() => withChange(({ pricing }) => ({ from: (p: P) => p.details, of: { orders: pricing, pricing } })),
            /DecisionQueue\.decisions: `change\.of\.orders` draws .*region.* — and the tag's value is a patch of .*reference.*: give the tag a target over the record its patch is of \(D6\)/);
    });

    test("a projection reads its series from the options' own row: one over another is refused, naming both", () => {
        const Series = StructType({ forecast: ArrayType(StructType({ week: FloatType, units: FloatType })) });
        assert.throws(() => inBlock(($) => {
            const cases = $.let(Data.bind(ops.proposals));
            const prices = $.let(Record.bind(ops.listPrices));
            const { orders } = proposalTargets($);
            const pricing = DecisionQueue.change.projection(prices, { name: "Demand", icon: "chart-line", option: Series,
                points: (o) => o.forecast, x: (p) => p.week, y: (p) => p.units });
            return DecisionQueue.decisions(cases as never, { ...proposalRoles(undefined), change: { from: (p: P) => p.details, of: { orders, pricing } } } as never);
        }), /DecisionQueue\.decisions: `change\.of\.pricing` reads its series from options of .*forecast.* — and the cases, each its own proposal, are .*headline.*: give the projection the option's own row type/);
    });
});

test("the roles' inference: a renamed field, a wrong return, `of` missing a tag or naming another, a target over another record — each a compile error", () => {
    // Type-level: the build never runs. A declaration that accepted any of these would fail the build on its unused directive.
    const never = (): void => {
        inBlock(($) => {
            const cases = $.let(Data.bind(ops.proposals));
            const { orders, pricing } = proposalTargets($);
            // The declaration that compiles, for the ones below that must not.
            $(DecisionQueue.decisions(cases, { scope: (p) => p.site, due: (p) => p.deadline, unit: (p) => p.metric, model: (p) => p.run, why: (p) => p.rationale, title: (p) => p.headline, summary: (p) => p.brief, detail: (p) => p.description, value: (p) => p.saving, change: { from: (p) => p.details, of: { orders, pricing } } }).build(undefined));
            // @ts-expect-error — `sight` is no field of the proposal: a role reads the app's own names
            DecisionQueue.decisions(cases, { scope: (p) => p.sight, due: (p) => p.deadline, unit: (p) => p.metric, model: (p) => p.run, why: (p) => p.rationale, title: (p) => p.headline, summary: (p) => p.brief, detail: (p) => p.description, value: (p) => p.saving, change: { from: (p) => p.details, of: { orders, pricing } } });
            // @ts-expect-error — `saving` is a Float, and `scope` takes a String
            DecisionQueue.decisions(cases, { scope: (p) => p.saving, due: (p) => p.deadline, unit: (p) => p.metric, model: (p) => p.run, why: (p) => p.rationale, title: (p) => p.headline, summary: (p) => p.brief, detail: (p) => p.description, value: (p) => p.saving, change: { from: (p) => p.details, of: { orders, pricing } } });
            // @ts-expect-error — `of` gives the tag `pricing` no target
            DecisionQueue.decisions(cases, { scope: (p) => p.site, due: (p) => p.deadline, unit: (p) => p.metric, model: (p) => p.run, why: (p) => p.rationale, title: (p) => p.headline, summary: (p) => p.brief, detail: (p) => p.description, value: (p) => p.saving, change: { from: (p) => p.details, of: { orders } } });
            // @ts-expect-error — `of` names `shipping`, no tag of the variant
            DecisionQueue.decisions(cases, { scope: (p) => p.site, due: (p) => p.deadline, unit: (p) => p.metric, model: (p) => p.run, why: (p) => p.rationale, title: (p) => p.headline, summary: (p) => p.brief, detail: (p) => p.description, value: (p) => p.saving, change: { from: (p) => p.details, of: { orders, pricing, shipping: pricing } } });
            // @ts-expect-error — `orders` patches the work orders, and its target draws the price list
            DecisionQueue.decisions(cases, { scope: (p) => p.site, due: (p) => p.deadline, unit: (p) => p.metric, model: (p) => p.run, why: (p) => p.rationale, title: (p) => p.headline, summary: (p) => p.brief, detail: (p) => p.description, value: (p) => p.saving, change: { from: (p) => p.details, of: { orders: pricing, pricing } } });
            // Cases with alternatives of the test's own, each option's change the proposals' variant: the option's type is read
            // from `options.from`, for the roles after it.
            const Offer = StructType({ title: StringType, brief: StringType, value: FloatType, details: ops.ProposalDetails });
            const Choice = StructType({ site: StringType, deadline: OptionType(DateTimeType), metric: StringType, run: StringType, rationale: StringType,
                pick: StringType, offers: DictType(StringType, Offer) });
            const choices = $.let(Data.bind(e3.record("decision_spec_choices", DictType(StringType, Choice), { initial: new Map() })));
            $(DecisionQueue.decisions(choices, { scope: (c) => c.site, due: (c) => c.deadline, unit: (c) => c.metric, model: (c) => c.run, why: (c) => c.rationale, recommended: (c) => c.pick, options: { from: (c) => c.offers, title: (o) => o.title, summary: (o) => o.brief, detail: (o, key, c) => East.str`${key} at ${c.site}`, value: (o) => o.value, change: { from: (o) => o.details, of: { orders, pricing } } } }).build(undefined));
            // @ts-expect-error — `headline` is no field of the option
            DecisionQueue.decisions(choices, { scope: (c) => c.site, due: (c) => c.deadline, unit: (c) => c.metric, model: (c) => c.run, why: (c) => c.rationale, recommended: (c) => c.pick, options: { from: (c) => c.offers, title: (o) => o.headline, summary: (o) => o.brief, detail: (o) => o.brief, value: (o) => o.value, change: { from: (o) => o.details, of: { orders, pricing } } } });
            // @ts-expect-error — the option's `of` gives the tag `orders` no target
            DecisionQueue.decisions(choices, { scope: (c) => c.site, due: (c) => c.deadline, unit: (c) => c.metric, model: (c) => c.run, why: (c) => c.rationale, recommended: (c) => c.pick, options: { from: (c) => c.offers, title: (o) => o.title, summary: (o) => o.brief, detail: (o) => o.brief, value: (o) => o.value, change: { from: (o) => o.details, of: { pricing } } } });
            const verdictRows = $.let(Record.bind(ops.proposalVerdicts));
            const entries = $.let(Data.bindPaged(ops.proposalVerdicts));
            // The verdicts' roles that compile, for the ones below that must not: each a field of the verdict's row, by name.
            $(DecisionQueue.verdicts(verdictRows, { entries, verdict: { field: "verdict", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" }, option: "option", note: "note" }).build());
            // @ts-expect-error — `outcome` is no field of the verdict's row
            DecisionQueue.verdicts(verdictRows, { entries, verdict: { field: "outcome", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" } });
            // @ts-expect-error — `done` is no case of the verdict's variant
            DecisionQueue.verdicts(verdictRows, { entries, verdict: { field: "verdict", applied: "done", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" } });
            // @ts-expect-error — `verdict` is a variant, and the option taken is an Option<String> field
            DecisionQueue.verdicts(verdictRows, { entries, verdict: { field: "verdict", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" }, option: "verdict" });
        });
    };
    assert.equal(typeof never, "function");
});

// ============================================================================
// The verdicts
// ============================================================================

describe("DecisionQueue.verdicts: the app's record the queue writes, each role a field by name (§5.2)", () => {
    test("every part of a verdict mapped to a field of the app's row, or only the verdict", () => {
        assert.doesNotThrow(() => proposalVerdicts());
        assert.doesNotThrow(() => proposalVerdicts((base) => ({ entries: base.entries, verdict: base.verdict })));
    });

    test("the record is bound with its patch door, and read by key through `entries`", () => {
        assert.throws(() => proposalVerdicts(undefined, ($) => $.let(Data.bind(ops.proposalVerdicts))),
            /DecisionQueue\.verdicts: the queue writes each verdict — bind the record with its patch door, Record\.bind\(record\), its record declaring patch: mutation\.patch\(\), and read it by key beside it, entries: Data\.bindPaged\(record\)/);
        assert.throws(() => proposalVerdicts((base) => ({ ...base, entries: undefined })),
            /DecisionQueue\.verdicts: `entries` reads the verdicts by key — the keys of the cases read — never whole: give entries: Data\.bindPaged\(record\), the record's own entries/);
    });

    test("`verdict` names a variant field of the row and a case of it for each of the queue's, each a case of its own", () => {
        assert.throws(() => proposalVerdicts((base) => ({ ...base, verdict: undefined })),
            /DecisionQueue\.verdicts: `verdict` names the row's verdict field and its cases — \{ field, applied, overridden, deferred, handedOff \}/);
        assert.throws(() => proposalVerdicts((base) => ({ ...base, verdict: { ...base.verdict, field: "outcome" } })),
            /DecisionQueue\.verdicts: `verdict\.field` names "outcome", a field the row does not have \(verdict, option, answer, reason, note\)/);
        assert.throws(() => proposalVerdicts((base) => ({ ...base, verdict: { ...base.verdict, field: "answer" } })),
            /DecisionQueue\.verdicts: `verdict\.field` names a variant field, not an Option — "answer" holds/);
        assert.throws(() => proposalVerdicts((base) => ({ ...base, verdict: { ...base.verdict, applied: "done" } })),
            /DecisionQueue\.verdicts: `verdict\.applied` names a case of "verdict" \(applied, deferred, handedOff, overridden\) — and it names "done"/);
        assert.throws(() => proposalVerdicts((base) => ({ ...base, verdict: { ...base.verdict, overridden: "applied" } })),
            /DecisionQueue\.verdicts: `verdict` names a case of "verdict" for each of applied, overridden, deferred, handedOff — each a case of its own — and it names applied, applied, deferred, handedOff/);
    });

    test("a verdict's case holds Null, or when the verdict was given", () => {
        const Odd = StructType({ verdict: VariantType({ applied: StringType, overridden: NullType, deferred: NullType, handedOff: NullType }) });
        const odd = e3.record("decision_spec_odd_verdicts", DictType(StringType, Odd), {
            initial: new Map(), mutations: (mutation) => ({ patch: mutation.patch() }),
        });
        assert.throws(() => inBlock(($) => {
            const rows = $.let(Record.bind(odd));
            const entries = $.let(Data.bindPaged(odd));
            return DecisionQueue.verdicts(rows, { entries, verdict: { field: "verdict", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" } });
        }), /DecisionQueue\.verdicts: the case "applied" holds Null or \{ at: DateTime \}, the time the verdict was given — and it holds .*String/);
    });

    test("`answer` and `reason` name an Option of a variant of unit cases; `option` and `note` an Option<String>; each a field of its own", () => {
        assert.throws(() => proposalVerdicts((base) => ({ ...base, answer: { ...base.answer, field: "note" } })),
            /DecisionQueue\.verdicts: `answer\.field` names an Option of a variant, its cases 3 of the app's — "note" holds/);
        assert.throws(() => proposalVerdicts((base) => ({ ...base, reason: { ...base.reason, other: "elsewhere" } })),
            /DecisionQueue\.verdicts: `reason\.other` names a case of "reason" \(context, data, other, priorities\) — and it names "elsewhere"/);
        assert.throws(() => proposalVerdicts((base) => ({ ...base, option: "verdict" })),
            /DecisionQueue\.verdicts: `option` names an Option<String> field — "verdict" holds/);
        assert.throws(() => proposalVerdicts((base) => ({ ...base, option: "note" })),
            /DecisionQueue\.verdicts: two roles name "note" — each part of the verdict is written to a field of its own/);
    });
});

// ============================================================================
// The targets
// ============================================================================

describe("DecisionQueue.change: a target's record is bound with its patch door (Q1, §12)", () => {
    test("a record, a Sheet's record, areas and a projection's record bound read only are refused, naming the patch door", () => {
        const readOnly = (where: string) => new RegExp(`DecisionQueue\\.change\\.${where}: the record is bound read only — Apply writes a change through its patch door: ` +
            "bind it Record\\.bind\\(record\\), its record declaring patch: mutation\\.patch\\(\\)");
        assert.throws(() => inBlock(($) => DecisionQueue.change.record($.let(Data.bind(ops.listPrices)) as never, { name: "Pricing", icon: "tag" })), readOnly("record"));
        assert.throws(() => inBlock(($) => DecisionQueue.change.sheet($.let(Data.bind(optimiseWorkOrders)) as never, { name: "Sheet", icon: "table-cells", columns: {} })),
            readOnly("sheet"));
        assert.throws(() => inBlock(($) => DecisionQueue.change.zones($.let(Data.bind(ops.listPrices)) as never, {} as never)), readOnly("zones"));
        assert.throws(() => inBlock(($) => DecisionQueue.change.projection($.let(Data.bind(ops.listPrices)) as never, {} as never)), readOnly("projection"));
    });

    test("a builder's kind bound read only is refused where the kind is declared, naming the patch door", () => {
        assert.throws(() => inBlock(($) => Schedule.events($.let(Data.bind(planEventJobs)) as never, {
            name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" },
        } as never)), /Record\.onApply: "patch" is not bound as this record's patch door — bind the record with patch: mutation\.patch\(\) among the mutations it declares/);
    });

    test("every target names its surface and its icon (D10)", () => {
        assert.throws(() => inBlock(($) => DecisionQueue.change.record($.let(Record.bind(ops.listPrices)), { icon: "tag" } as never)),
            /DecisionQueue\.change\.record: `name` names the target's surface, the eyebrow's first word — name: "Roster"/);
        assert.throws(() => inBlock(($) => DecisionQueue.change.record($.let(Record.bind(ops.listPrices)), { name: "Pricing" } as never)),
            /DecisionQueue\.change\.record: `icon` names its Font Awesome solid icon — icon: "users"/);
    });
});

describe("DecisionQueue.change.record, .zones and .projection: records no builder draws (§5.3)", () => {
    /** The price list, bound with its patch door. */
    const prices = ($: BlockBuilder<NullType>) => $.let(Record.bind(ops.listPrices));

    test("a record's label and measure are East functions over its row; its group a String field of it, counted over the record read whole", () => {
        assert.doesNotThrow(() => inBlock(($) => DecisionQueue.change.record(prices($), { name: "Pricing", icon: "tag", label: (r) => r.region,
            measure: (r) => r.demand, group: "region", locked: (r) => East.greater(r.price, 12.0) }).build(["pricing"], "spec.pricing")));
        assert.throws(() => inBlock(($) => DecisionQueue.change.record(prices($), { name: "Pricing", icon: "tag", label: ((r: ExprType<typeof ops.ListPrice>) => r.price) as never })),
            /DecisionQueue\.change\.record: `label` returns .*Float.* — it takes a String/);
        assert.throws(() => inBlock(($) => DecisionQueue.change.record(prices($), { name: "Pricing", icon: "tag", group: "price" as never })),
            /DecisionQueue\.change\.record: `group` names a String field of the row, as a rail's fields do — and "price" holds .*Float/);
        assert.throws(() => inBlock(($) => DecisionQueue.change.record(prices($), { name: "Pricing", icon: "tag", group: "region", entries: $.let(Data.bindPaged(ops.listPrices)) })),
            /DecisionQueue\.change\.record: `group` counts each group's rows over the record read whole — leave `entries` out to read it whole/);
    });

    test("areas in zones: each one's zone and place are required, and the zones are the app's list", () => {
        const Area = StructType({ zone: StringType, column: FloatType, row: FloatType, depot: BooleanType });
        const areas = e3.record("decision_spec_areas", DictType(StringType, Area), {
            initial: new Map(), mutations: (mutation) => ({ patch: mutation.patch() }),
        });
        const zones = [{ key: "fast", label: "Fast movers", color: Style.ColorToken("teal", "500") }, { key: "bulk", label: "Bulk", color: Style.ColorToken("orange", "500") }];
        const bound = ($: BlockBuilder<NullType>) => $.let(Record.bind(areas));
        assert.doesNotThrow(() => inBlock(($) => DecisionQueue.change.zones(bound($), { name: "Layout", icon: "map", zone: (a) => a.zone, x: (a) => a.column,
            y: (a) => a.row, depot: (a) => a.depot, zones }).build(["layout"], "spec.layout")));
        type A = ExprType<typeof Area>;
        assert.throws(() => inBlock(($) => DecisionQueue.change.zones(bound($), { name: "Layout", icon: "map", zone: (a: A) => a.zone, y: (a: A) => a.row, zones } as never)),
            /DecisionQueue\.change\.zones: `x` is required — an East function reading a Float from the row/);
        assert.throws(() => inBlock(($) => DecisionQueue.change.zones(bound($), { name: "Layout", icon: "map", zone: (a: A) => a.zone, x: (a: A) => a.column, y: (a: A) => a.row } as never)),
            /DecisionQueue\.change\.zones: `zones` is the app's list of zones — each \{ key, label, color \}, color a theme colour token/);
    });

    test("a projection: the option's row type, the series it gives and each point's place", () => {
        const Series = StructType({ forecast: ArrayType(StructType({ week: FloatType, units: FloatType })) });
        assert.doesNotThrow(() => inBlock(($) => DecisionQueue.change.projection(prices($), { name: "Demand", icon: "chart-line", option: Series,
            points: (o) => o.forecast, x: (p) => p.week, y: (p) => p.units, limit: { y: 120.0, label: "Reorder point" } }).build(["pricing"], "spec.demand")));
        assert.throws(() => inBlock(($) => DecisionQueue.change.projection(prices($), { name: "Demand", icon: "chart-line", option: StringType } as never)),
            /DecisionQueue\.change\.projection: `option` is the option's row type — the struct the cases' options are, option: OpsOption — which `points` reads/);
        assert.throws(() => inBlock(($) => DecisionQueue.change.projection(prices($), { name: "Demand", icon: "chart-line", option: Series,
            points: ((o: ExprType<typeof Series>) => o.forecast.size()) as never, x: (p: never) => p, y: (p: never) => p } as never)),
        /DecisionQueue\.change\.projection: `points` returns .*Integer.* — it takes an Array of the series' points, each a struct/);
    });
});

describe("the builders' targets: each takes its builder's own props, refused as its tag refuses them (§5.3)", () => {
    /** The smallest roster's props (`rosterMinimal`), bound in the block. */
    const rosterProps = ($: BlockBuilder<NullType>) => {
        const rota = $.let(Record.bind(minimalDuties));
        const staff = $.let(Data.bind(minimalWorkers));
        const times = $.let(Data.bind(minimalShiftTimes));
        const groups = $.let(Data.bind(minimalTeams));
        return {
            name: "Roster", icon: "users",
            events: { duty: Schedule.events(rota, { name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "person", of: "people" }, shift: "shift", group: "team" }) },
            resources: { people: Schedule.resources(staff.read(), { name: "People", icon: "user", label: (w) => w.name, group: (w) => w.team }) },
            shifts: Roster.shifts(times.read(), { label: (s) => s.name, code: (s) => s.code, start: (s) => s.starts, hours: (s) => s.hours, order: (s) => s.order }),
            groups: Roster.groups(groups.read(), { label: (t) => t.name }),
        };
    };

    test("the Roster's: one duty kind, a map by people or by cost, `map: \"cost\"` taking `pay`, and <Roster>'s own refusals as the queue builds it", () => {
        assert.doesNotThrow(() => inBlock(($) => DecisionQueue.change.roster(rosterProps($)).build(["rota"], "spec.rota")));
        assert.doesNotThrow(() => inBlock(($) => DecisionQueue.change.roster({ ...rosterProps($), locked: (d) => East.equal(d.team, "dispatch") }).build(["rota"], "spec.rota")));
        assert.throws(() => inBlock(($) => { const props = rosterProps($); return DecisionQueue.change.roster({ ...props, events: { ...props.events, other: props.events.duty } }); }),
            /DecisionQueue\.change\.roster: `events` holds one kind, the duties, as <Roster> takes it — and it holds 2 \(duty, other\)/);
        assert.throws(() => inBlock(($) => DecisionQueue.change.roster({ ...rosterProps($), events: {} } as never)),
            /DecisionQueue\.change\.roster: `events` holds the duty kind, as <Roster> takes it — events: \{ duty: Schedule\.events\(Record\.bind\(duties\), \{ start, end, resource, shift, group \}\) \}/);
        assert.throws(() => inBlock(($) => DecisionQueue.change.roster({ ...rosterProps($), map: "hours" } as never)),
            /DecisionQueue\.change\.roster: `map` is "people", a row per person, or "cost", a row per pay code — and it is hours/);
        assert.throws(() => inBlock(($) => DecisionQueue.change.roster({ ...rosterProps($), map: "cost" })),
            /DecisionQueue\.change\.roster: `map: "cost"` reads the change by what it costs, a row per pay code — give `pay`, the Roster's own, with its `currency` \(P7\)/);
        assert.throws(() => inBlock(($) => DecisionQueue.change.roster({ ...rosterProps($), groups: undefined } as never).build(["rota"], "spec.rota")),
            /^Error: DecisionQueue\.change\.roster: .*groups/);
    });

    /** The smallest Plan's kinds (`planEvents`), bound in the block. */
    const planProps = ($: BlockBuilder<NullType>) => {
        const presses = $.let(Record.bind(planPrintPresses, []));
        const jobs = $.let(Record.bind(planEventJobs));
        return {
            name: "Plan", icon: "bars-progress",
            resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
            events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" }, state: "state" }) },
        };
    };

    test("the Plan's: the kind the tags patch, named by `event` beside others, and <Plan>'s own refusals", () => {
        assert.doesNotThrow(() => inBlock(($) => DecisionQueue.change.plan(planProps($)).build(["print"], "spec.print")));
        assert.throws(() => inBlock(($) => { const props = planProps($); return DecisionQueue.change.plan({ ...props, events: { job: props.events.job, other: props.events.job } }); }),
            /DecisionQueue\.change\.plan: `event` names the kind the tags patch, one of `events` \(job, other\) — needed with more than one kind, the others drawn as context/);
        assert.throws(() => inBlock(($) => { const props = planProps($); return DecisionQueue.change.plan({ ...props, event: "press" } as never); }),
            /DecisionQueue\.change\.plan: `event` names the kind the tags patch, one of `events` \(job\) — and it is press/);
        assert.throws(() => inBlock(($) => DecisionQueue.change.plan({ ...planProps($), events: {} })),
            /DecisionQueue\.change\.plan: `events` holds the event kinds, as the builder takes them — at least one, the kind the tags patch/);
        assert.throws(() => inBlock(($) => DecisionQueue.change.plan({ ...planProps($), resources: {} })), /DecisionQueue\.change\.plan.*presses/);
    });

    test("the Calendar's: the kind the tags patch and the week, and <Calendar>'s own refusals", () => {
        const calendarProps = ($: BlockBuilder<NullType>) => {
            const machines = $.let(Record.bind(calendarMachines, []));
            const jobs = $.let(Record.bind(calendarJobs));
            return {
                name: "Calendar", icon: "calendar-days",
                resources: { machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: (row) => row.name }) },
                events: { job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" } }) },
            };
        };
        assert.doesNotThrow(() => inBlock(($) => DecisionQueue.change.calendar({ ...calendarProps($), week: { start: "sunday" } }).build(["workshop"], "spec.workshop")));
        assert.throws(() => inBlock(($) => DecisionQueue.change.calendar({ ...calendarProps($), resources: {} })), /DecisionQueue\.change\.calendar.*machines/);
    });

    test("the Allocation's: <Allocation>'s kinds and functions, refused in its own words, named for the target", () => {
        const allocationProps = ($: BlockBuilder<NullType>) => {
            const bins = $.let(Record.bind(yard.kilnBins));
            const kilns = $.let(Data.bind(yard.kilns));
            const bays = $.let(Data.bind(yard.yardBays));
            return {
                name: "Allocation", icon: "fire-flame-curved",
                events: { bin: Schedule.events(bins, {
                    name: "Bin", icon: "box", at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                    quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
                }) },
                resources: {
                    bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: (b) => b.name, offset: (b) => b.offset }),
                    kilns: Schedule.resources(kilns.read(), { name: "Kilns", icon: "fire", label: (k) => k.name, min: (k) => k.min, max: (k) => k.max }),
                },
            };
        };
        assert.doesNotThrow(() => inBlock(($) => DecisionQueue.change.allocation(allocationProps($)).build(["yard"], "spec.yard")));
        assert.throws(() => inBlock(($) => { const props = allocationProps($); return DecisionQueue.change.allocation({ ...props, events: { bin: props.events.bin, other: props.events.bin } } as never); }),
            /DecisionQueue\.change\.allocation: Allocation: `events` holds one kind, the bins — and it holds 2 \(bin, other\)/);
        assert.throws(() => inBlock(($) => DecisionQueue.change.allocation({ ...allocationProps($), arrivals: [] } as never)),
            /DecisionQueue\.change\.allocation: `arrivals` is Allocation\.arrivals\(rows, \{ label, quantity, hold, … \}\) over the app's rows, as <Allocation> takes it — the Waiting lane's/);
    });
});

// ============================================================================
// The payload
// ============================================================================

test("the payload's types: the namespace's Types are the carrier's, and the tag builds its payload", () => {
    assert.ok(isTypeEqual(DecisionQueue.Types.Payload, DecisionQueuePayloadType));
    assert.ok(isTypeEqual(DecisionQueue.Types.Target, DecisionTargetType));
    assert.ok(isTypeEqual(DecisionQueue.Types.Case, DecisionCaseType));
    assert.ok(isTypeEqual(DecisionQueue.Types.Option, DecisionOptionType));
    assert.ok(isTypeEqual(DecisionQueue.Types.Verdict, DecisionVerdictType));
    assert.ok(isTypeEqual(DecisionQueue.Types.Zone, DecisionZoneType));
    assert.ok(isTypeEqual(DecisionQueue.Types.Point, DecisionPointType));
    assert.ok(isTypeEqual(Expr.type(proposalQueue() as Expr) as EastType, DecisionQueuePayloadType));
    // Every target on the wire is one type, whatever record it draws: the queue's payload holds them in one array.
    const target = inBlock(($) => proposalTargets($).pricing.build(["pricing"], "spec.pricing"));
    assert.ok(isTypeEqual(Expr.type(target as Expr) as EastType, DecisionTargetType));
    assert.ok(isTypeEqual(PatchType(DictType(StringType, ops.ListPrice)), ops.ProposalDetails.cases.pricing));
});
