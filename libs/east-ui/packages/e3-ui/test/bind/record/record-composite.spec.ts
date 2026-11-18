/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A composite record's binding (east-workspace#1465, R73, R74): the sources
 * `Record.bind` names, from the record's declaration and on the handle; the
 * one check of whose an entry is; and a Save's refusal of an entry only its
 * source's load writes — before any commit, in both of `Record.onApply`'s
 * forms and in the draft of each.
 *
 * e3-ui's specs read and write no e3: the record is a handle made by hand as
 * `Record.bind` gives one, whose patch door answers committed. The refusal
 * over a deployed record, which e3 refuses too, runs in e3-ui-components'
 * record-apply spec.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, AsyncFunctionType, DictType, East, FunctionType, OptionType, PatchType, SortedMap, StringType, StructType, VariantType,
    compareFor, diffFor, equalFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import { Record, RecordOutcomeType, RecordToDraftResultType } from "@elaraai/e3-ui";
import { RecordBindingSourcesType, bindingSources, externalSourceOf } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { recordHandle } from "../../record-handles.js";
import { refusingPlatform } from "../../refusing-platform.js";
import * as ex from "./record.examples.js";

type Sources = ValueTypeOf<RecordBindingSourcesType>;
const sourcesEqual = equalFor(RecordBindingSourcesType);
const answerEqual = equalFor(OptionType(StringType));

/** The orders' sources, as their binding names them: the ERP's, which its load writes, and the planner's own. */
const SOURCES: Sources = [{ name: "erp", external: true }, { name: "own", external: false }];

const Orders = ex.orders.type;
const OrderKey = Orders.key;
type Order = ValueTypeOf<typeof ex.OrderType>;
const keyText = printFor(OrderKey);

const SO_1001: Order = { customer: "Acme", status: "open" };
const N_1: Order = { customer: "Brightside", status: "draft" };
/** The orders the record holds: one the ERP delivered, and one the planner added. */
const HELD = new SortedMap<ValueTypeOf<typeof OrderKey>, Order>([
    [variant("erp", "SO-1001"), SO_1001],
    [variant("own", "N-1"), N_1],
], compareFor(OrderKey));

describe("a composite record's binding names its sources (R73)", () => {
    test("from the record's declaration, in the order of its key's cases, whatever order they were declared in; a plain record's names none", () => {
        assert.ok(sourcesEqual(bindingSources(ex.orders), SOURCES));
        // Declared the other way round: the same list.
        const reversed = e3.recordComposite("orders_reversed", ex.OrderType, {
            sources: (source) => ({
                own: source.mutations(StringType),
                erp: source.load(StringType, ex.ErpOrdersType, East.function([ex.ErpOrdersType, ex.ErpOrdersType], PatchType(ex.ErpOrdersType),
                    (_$, delivery, current) => East.diff(current, delivery))),
            }),
            initial: { own: new Map() },
            mutations: (mutation) => ({ patch: mutation.patch() }),
        });
        assert.ok(sourcesEqual(bindingSources(reversed), SOURCES));
        assert.ok(sourcesEqual(bindingSources(ex.jobs), []));
    });

    test("the handle carries them as binding.sources: a composite record's, and none for a plain record", () => {
        // Compiled against a platform whose every read, write and call refuses: the binding's descriptor reaches none.
        const named = East.compile(East.function([], RecordBindingSourcesType, ($) => {
            const bound = $.let(Record.bind(ex.orders));
            return bound.binding.sources;
        }), refusingPlatform);
        assert.ok(sourcesEqual(named(), SOURCES));
        const plain = East.compile(East.function([], RecordBindingSourcesType, ($) => {
            const bound = $.let(Record.bind(ex.jobs));
            return bound.binding.sources;
        }), refusingPlatform);
        assert.ok(sourcesEqual(plain(), []));
    });
});

describe("the one check of whose an entry is", () => {
    const whose = East.compile(externalSourceOf(OrderKey), []);

    test("a key of an external source's case is that source's; one of the solution's own is nobody's load's", () => {
        assert.ok(answerEqual(whose(variant("erp", "SO-1001"), SOURCES), some("erp")));
        assert.ok(answerEqual(whose(variant("own", "N-1"), SOURCES), none));
    });

    test("it is the binding's sources that say: a source they call the solution's own, or do not name, locks nothing", () => {
        assert.ok(answerEqual(whose(variant("erp", "SO-1001"), [{ name: "erp", external: false }, { name: "own", external: false }]), none));
        assert.ok(answerEqual(whose(variant("erp", "SO-1001"), []), none));
    });

    test("over a key that is no variant, a plain record's, no entry is a load's", () => {
        const plain = East.compile(externalSourceOf(StringType), []);
        assert.ok(answerEqual(plain("erp", SOURCES), none));
    });
});

describe("a Save never writes an entry only its source's load writes (R74)", () => {
    const KeyedBatch = Editing.Types.ChangeSet(ex.OrderType, OrderKey);
    type Batch = ValueTypeOf<typeof KeyedBatch>;
    const change = diffFor(OptionType(ex.OrderType));
    const resultEqual = equalFor(Editing.Types.ApplyResult);
    const draftEqual = equalFor(RecordToDraftResultType);

    const erpKey = keyText(variant("erp", "SO-1001"));
    const ownKey = keyText(variant("own", "N-1"));
    const newErpKey = keyText(variant("erp", "SO-1002"));
    /** The words a write of the ERP's entry is refused in. */
    const refusedAs = (entry: string) => ({ entry, row: none, field: none, message: `entry ${entry} is source erp's, which only its load writes` });

    const batchOf = (...changes: Batch["changes"]): Batch => ({ requestId: "orders-1", base: variant("revision", "r1"), label: "Edit orders", changes });
    const erpEdit = { id: erpKey, patch: change(some(SO_1001), some({ ...SO_1001, status: "held" })), place: none };
    const erpInsert = { id: newErpKey, patch: change(none, some({ customer: "Calder", status: "open" })), place: some(variant("keyOrder", null)) };
    const ownEdit = { id: ownKey, patch: change(some(N_1), some({ ...N_1, status: "confirmed" })), place: none };

    /** The Save and its draft form over the orders, their handle naming the sources. */
    const save = East.compileAsync(East.asyncFunction([KeyedBatch], Editing.Types.ApplyResult, ($, batch) => {
        const record = $.let(recordHandle(Orders, HELD, "orders", true, SOURCES)());
        const saving = $.const(Record.onApply(record, { keyed: true }));
        return saving.apply(batch);
    }), []);
    const toDraft = East.compile(East.function([KeyedBatch], RecordToDraftResultType, ($, batch) => {
        const record = $.let(recordHandle(Orders, HELD, "orders", true, SOURCES)());
        const draft = $.const(Record.toDraft(record, { keyed: true }));
        return draft(batch);
    }), []);

    test("the words are the design's: the entry as East prints its key, and whose it is", () => {
        assert.equal(erpKey, '.erp "SO-1001"');
        assert.equal(refusedAs(erpKey).message, 'entry .erp "SO-1001" is source erp\'s, which only its load writes');
    });

    test("a change of an external entry is rejected before any commit, naming the entry and its source; a change of the solution's own is saved", async () => {
        assert.ok(resultEqual(await save(batchOf(erpEdit)), variant("rejected", [refusedAs(erpKey)])));
        // The handle's patch door answers every write committed at "s": reached only by a batch the plan lets through.
        assert.ok(resultEqual(await save(batchOf(ownEdit)), variant("applied", { revision: some("s") })));
    });

    test("a batch that names an external entry among others writes none of them: each external entry is named, in the batch's order, an added one too", async () => {
        assert.ok(resultEqual(await save(batchOf(ownEdit, erpEdit, erpInsert)), variant("rejected", [refusedAs(erpKey), refusedAs(newErpKey)])));
    });

    test("the draft of that Save is refused in the same words, and the solution's own entry is a draft", () => {
        assert.ok(draftEqual(toDraft(batchOf(erpEdit)), variant("rejected", [refusedAs(erpKey)])));
        assert.ok(draftEqual(toDraft(batchOf(ownEdit, erpInsert)), variant("rejected", [refusedAs(newErpKey)])));
        assert.equal(toDraft(batchOf(ownEdit)).type, "draft");
    });

    test("a handle typed by hand that names no sources refuses nothing here: the record's own refusal stands behind it", async () => {
        const CommitHandle = StructType({
            read: FunctionType([], Orders),
            history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
            commit: StructType({ patch: AsyncFunctionType([StringType, PatchType(Orders)], RecordOutcomeType) }),
        });
        const alone = East.compileAsync(East.asyncFunction([KeyedBatch], Editing.Types.ApplyResult, ($, batch) => {
            const record = $.let({
                read: East.function([], Orders, (_$2) => HELD),
                history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
                commit: { patch: East.asyncFunction([StringType, PatchType(Orders)], RecordOutcomeType, (_$2) => variant("committed", { commitHash: "c", stateHash: "s" })) },
            }, CommitHandle);
            const saving = $.const(Record.onApply(record, { keyed: true }));
            return saving(batch);
        }), []);
        assert.ok(resultEqual(await alone(batchOf(erpEdit)), variant("applied", { revision: some("s") })));
    });
});

describe("a Save of one entry's rows never writes an external entry's (R74)", () => {
    const Line = StructType({ id: StringType, task: StringType });
    const Week = StructType({ title: StringType, lines: ArrayType(Line) });
    const WeekKey = VariantType({ erp: StringType, own: StringType });
    const Weeks = DictType(WeekKey, Week);
    const LINES = [{ id: "l1", task: "Cut" }, { id: "l2", task: "Fold" }];
    const WEEKS = new SortedMap<ValueTypeOf<typeof WeekKey>, ValueTypeOf<typeof Week>>([
        [variant("erp", "W42"), { title: "Week 42, as planned upstream", lines: LINES }],
        [variant("own", "W42"), { title: "Week 42, ours", lines: LINES }],
    ], compareFor(WeekKey));
    const LinesBatch = Editing.Types.ChangeSet(Line);
    const lineChange = diffFor(OptionType(Line));
    const resultEqual = equalFor(Editing.Types.ApplyResult);

    const saveLines = East.compileAsync(East.asyncFunction([WeekKey, LinesBatch], Editing.Types.ApplyResult, ($, key, batch) => {
        const record = $.let(recordHandle(Weeks, WEEKS, "weeks", true, SOURCES)());
        const saving = $.const(Record.onApply(record, {
            entry: key,
            get: East.function([Week], ArrayType(Line), (_$2, week) => week.lines),
            set: East.function([Week, ArrayType(Line)], Week, (_$2, week, lines) => ({ title: week.title, lines })),
            idField: "id",
        }));
        return saving.apply(batch);
    }), []);
    const edit: ValueTypeOf<typeof LinesBatch> = {
        requestId: "week-1", base: variant("snapshot", LINES), label: "Edit the week",
        changes: [{ id: "l1", patch: lineChange(some(LINES[0]!), some({ id: "l1", task: "Trim" })), place: none }],
    };

    test("the rows of an external source's entry are its load's: rejected before any commit, naming the entry; the solution's own entry's rows are saved", async () => {
        assert.ok(resultEqual(await saveLines(variant("erp", "W42"), edit), variant("rejected", [{
            entry: "", row: none, field: none, message: 'entry .erp "W42" is source erp\'s, which only its load writes',
        }])));
        assert.ok(resultEqual(await saveLines(variant("own", "W42"), edit), variant("applied", { revision: some("s") })));
    });
});
