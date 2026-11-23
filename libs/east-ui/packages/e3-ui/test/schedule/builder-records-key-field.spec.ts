/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The records a builder writes beside its event kinds, over rows that hold
 * their own key in a field (`keyField`, east-workspace#1705): a builder's
 * periods (`Schedule.periods`), keyed by each period's start, a DateTime, and
 * the Roster's targets (`Roster.targets`), keyed by a String the Roster mints.
 * Each one's session names the field as its entries' identity field — which
 * the renderer's session keeps a new row's key in — its Save writes a new
 * row's key into it and leaves a stored row's alone, and what each refuses.
 *
 * e3-ui's specs read and write no e3: each record is a handle made by hand
 * (`record-handles.ts`), its draft door answering the patch as a draft.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType, VariantType,
    compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, printFor, some, variant, type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { EditingType } from "@elaraai/east-ui/internal";
import { FuncDraftType, Record } from "@elaraai/e3-ui";
import { Roster, Schedule } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { recordHandle } from "../record-handles.js";

/** A week of the rota: its first day, which is its key too, and whether it is issued. */
const Week = StructType({ from: DateTimeType, state: VariantType({ open: NullType, issued: NullType }), note: StringType });
const Weeks = DictType(DateTimeType, Week);
const FIRST = new Date("2026-11-16T00:00:00Z");
const SECOND = new Date("2026-11-23T00:00:00Z");
const NEVER = new Date(0);
/** The weeks the record holds: one, saved before its row held its key. */
const WEEKS = new SortedMap<Date, ValueTypeOf<typeof Week>>([[FIRST, { from: NEVER, state: variant("open", null), note: "" }]], compareFor(DateTimeType));
const weeksHandle = recordHandle(Weeks, WEEKS, "spec_weeks");
/** The weeks, built as a builder builds its periods: told their key field, or told none. */
const weeksKind = (options: object) => East.compile(East.function([], Schedule.Types.PeriodsKind, ($) => {
    const handle = $.let(weeksHandle());
    return Schedule.periods(handle as never, { every: "week", status: { field: "state", draft: "open", published: "issued" }, ...options } as never).build();
}), []);

/** A staffing target: its reference, which is its key too, its floor, and the Roster's roles. */
const Cover = StructType({ ref: StringType, floor: IntegerType, day: DateTimeType, team: StringType, shift: StringType, heads: IntegerType, hours: DictType(StringType, FloatType) });
const Covers = DictType(StringType, Cover);
const NO_HOURS = new SortedMap<string, number>([], compareFor(StringType));
/** The targets the record holds: one, saved before its row held its key. */
const COVERS = new SortedMap<string, ValueTypeOf<typeof Cover>>([
    ["t-1", { ref: "", floor: 1n, day: FIRST, team: "north", shift: "early", heads: 2n, hours: NO_HOURS }],
], compareFor(StringType));
const coversHandle = recordHandle(Covers, COVERS, "spec_covers");
/** The targets' session, built as the Roster builds them: told their key field, or told none. */
const coversSession = (options: object) => East.compile(East.function([], EditingType, ($) => {
    const handle = $.let(coversHandle());
    return Roster.targets(handle as never, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours", ...options } as never).build().editing;
}), []);

describe("a builder's periods told their record's key field", () => {
    test("their session names the field as its entries' identity field; told none, it names none", () => {
        assert.ok(equalFor(OptionType(StringType))(weeksKind({ keyField: "from" })().editing.idField, some("from")));
        assert.ok(equalFor(OptionType(StringType))(weeksKind({})().editing.idField, none));
    });

    test("their Save writes a new period's start into the field, whatever its row was given there, and leaves a stored period's field as it holds it", () => {
        const kind = weeksKind({ keyField: "from" })();
        if (kind.editing.toDraft.type !== "some") assert.fail("expected the session's draft form");
        const id = printFor(DateTimeType);
        const change = diffFor(OptionType(Week));
        const answer = kind.editing.toDraft.value(encodeBeast2For(Editing.Types.ChangeSet(Week, DateTimeType))({
            requestId: "", base: variant("snapshot", WEEKS), label: "",
            changes: [
                { id: id(SECOND), patch: change(none, some({ from: NEVER, state: variant("issued", null), note: "" })), place: some(variant("keyOrder", null)) },
                { id: id(FIRST), patch: change(some(WEEKS.get(FIRST)!), some({ ...WEEKS.get(FIRST)!, note: "held" })), place: none },
            ],
        }));
        if (answer.type !== "draft") assert.fail(`expected a draft, got ${answer.type}`);
        const after = new SortedMap<Date, ValueTypeOf<typeof Week>>([
            [FIRST, { from: NEVER, state: variant("open", null), note: "held" }], [SECOND, { from: SECOND, state: variant("issued", null), note: "" }],
        ], compareFor(DateTimeType));
        assert.ok(equalFor(PatchType(Weeks))(decodeBeast2For(PatchType(Weeks))(decodeBeast2For(FuncDraftType)(answer.value).args[0]!), diffFor(Weeks)(WEEKS, after)));
    });

    test("refuses a field of another type than a period's start", () => {
        assert.throws(() => weeksKind({ keyField: "note" }),
            /Schedule\.periods: `keyField` names the field of an entry that holds its key, a \.DateTime as the key is — "note" is a \.String field of \.Struct/);
    });
});

describe("the Roster's targets told their record's key field", () => {
    test("their session names the field as its entries' identity field; told none, it names none", () => {
        assert.ok(equalFor(OptionType(StringType))(coversSession({ keyField: "ref" })().idField, some("ref")));
        assert.ok(equalFor(OptionType(StringType))(coversSession({})().idField, none));
    });

    test("their Save writes a new target's key into the field, whatever its `values` gave there, and leaves a stored target's field as it holds it", () => {
        const session = coversSession({ keyField: "ref" })();
        if (session.toDraft.type !== "some") assert.fail("expected the session's draft form");
        const change = diffFor(OptionType(Cover));
        const added: ValueTypeOf<typeof Cover> = { ref: "from-values", floor: 2n, day: SECOND, team: "south", shift: "late", heads: 1n, hours: NO_HOURS };
        const answer = session.toDraft.value(encodeBeast2For(Editing.Types.ChangeSet(Cover, StringType))({
            requestId: "", base: variant("snapshot", COVERS), label: "",
            changes: [
                { id: "t-2", patch: change(none, some(added)), place: some(variant("keyOrder", null)) },
                { id: "t-1", patch: change(some(COVERS.get("t-1")!), some({ ...COVERS.get("t-1")!, heads: 3n })), place: none },
            ],
        }));
        if (answer.type !== "draft") assert.fail(`expected a draft, got ${answer.type}`);
        const after = new SortedMap<string, ValueTypeOf<typeof Cover>>([
            ["t-1", { ...COVERS.get("t-1")!, heads: 3n }], ["t-2", { ...added, ref: "t-2" }],
        ], compareFor(StringType));
        assert.ok(equalFor(PatchType(Covers))(decodeBeast2For(PatchType(Covers))(decodeBeast2For(FuncDraftType)(answer.value).args[0]!), diffFor(Covers)(COVERS, after)));
    });

    test("refuse a field of another type than the key, and one a role writes, naming the role", () => {
        assert.throws(() => coversSession({ keyField: "floor" }),
            /Roster\.targets: `keyField` names the field of an entry that holds its key, a \.String as the key is — "floor" is a \.Integer field of \.Struct/);
        assert.throws(() => coversSession({ keyField: "team" }),
            /Roster\.targets: `keyField` names "team", which `group` writes — a target's key is kept in its key field by the Roster, and nothing else writes it/);
    });
});

// Records declared with e3, as an app declares them: what each option's type is checked over.
const weeks = e3.record("key_field_weeks", Weeks, {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
const covers = e3.record("key_field_covers", Covers, {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The options' type checks: never called — `tsc` checks what each line says. */
export function keyFieldBuilderRecordChecks($: BlockBuilder<NullType>): void {
    const boundWeeks = $.let(Record.bind(weeks));
    Schedule.periods(boundWeeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, keyField: "from" });
    // @ts-expect-error — `note` is a String, and a period is keyed by its start, a DateTime
    Schedule.periods(boundWeeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, keyField: "note" });
    const boundCovers = $.let(Record.bind(covers));
    Roster.targets(boundCovers, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours", keyField: "ref" });
    // @ts-expect-error — `floor` is an Integer, and the targets are keyed by a String
    Roster.targets(boundCovers, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours", keyField: "floor" });
}
