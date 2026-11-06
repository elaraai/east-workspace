/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's action column (#1474, `Sheet Actions - DX Proposal.md`): the
 * examples; the machine on the wire — `start`, each case's `next`, its take
 * by its type or its `take`, its value type; the cell, its case and value,
 * and the summary; the gate — a row complete, `blocked`, a draft incomplete;
 * each case's `updates` over the wire context, the row's cells and the band's;
 * a form's opening value; and every refusal, naming the column and the case.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, IntegerType, NullType, OptionType, StringType, StructType,
    decodeBeast2For, encodeBeast2For, equalFor, isTypeEqual, none, some, toEastTypeValue, variant,
    type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { Sheet } from "@elaraai/e3-ui/internal";
import * as ex from "./sheet-actions.examples.js";

describeEast("Sheet — action column examples (#1474)", test => {
    Assert.examples(test, {
        sheetActionsBasic: ex.sheetActionsBasic,
        sheetActionsWorkOrders: ex.sheetActionsWorkOrders,
        sheetActionsTickets: ex.sheetActionsTickets,
        sheetActionsReadOnly: ex.sheetActionsReadOnly,
        sheetActionsPhone: ex.sheetActionsPhone,
        sheetActionsPinned: ex.sheetActionsPinned,
    });
}, { platformFns: TestImpl });

// ── Fixtures: Example 3's tickets on an inline flat sheet, Example 2's orders on a grouped one ──

const Ticket = StructType({ id: StringType, title: StringType, crew: StringType, due: OptionType(DateTimeType), action: OptionType(ex.TicketAction) });
type TicketValue = ValueTypeOf<typeof Ticket>;
const OPEN = ["acknowledged", "deferred", "handed_over", "closed"] as const;
const CREWS = [{ key: "day", label: "Day crew" }, { key: "swing", label: "Swing crew" }];
const TICKETS: TicketValue[] = [
    { id: "T-301", title: "Spindle noise", crew: "day", due: some(new Date("2026-11-03T00:00:00Z")), action: none },
    { id: "T-302", title: "Coolant leak", crew: "swing", due: none, action: some(variant("deferred", new Date("2026-11-09T00:00:00Z"))) },
];

/** Example 2's first order, as an inline group: step 10 completed, 20 started, 30 not yet. */
const ORDERS: ValueTypeOf<typeof ex.WorkOrder>[] = [{ id: "WO-1042", name: "Frame assembly", status: "in_progress", steps: [
    { op: "10", step: "Cut tube stock", plan: 24n, good: some(24n), done: some(new Date("2026-11-02T08:42:00Z")), action: some(variant("completed", null)) },
    { op: "20", step: "Weld frame", plan: 24n, good: none, done: none, action: some(variant("started", null)) },
    { op: "30", step: "Grind welds", plan: 24n, good: none, done: none, action: none },
] }];
const SheetCellsType = DictType(StringType, Sheet.Types.Cell);
const StatusWord = StructType({ word: StringType, label: StringType });

type Root = ValueTypeOf<typeof Sheet.Types.Root>;
type Kind = ValueTypeOf<typeof Sheet.Types.ActionKind>;
type WireContext = ValueTypeOf<typeof Sheet.Types.WireContext>;
const CrewType = StructType({ key: StringType, label: StringType });

/** The tickets' action column, with any of its config changed. */
function ticketAction(change: Record<string, unknown> = {}) {
    const column = ticketColumn();
    return { ...column, config: { ...column.config, ...change } } as typeof column;
}

/** The tickets' action column as Example 3 declares it, beside a `blocked` over its crew. */
function ticketColumn() {
    return Sheet.column.action(Ticket, ex.TicketAction, {
        header: "Action",
        name: (t) => t.title,
        start: OPEN,
        blocked: (ctx) => ctx.row.crew.equal("").ifElse(() => East.value(some("names no crew"), OptionType(StringType)), () => East.value(none, OptionType(StringType))),
        cases: {
            acknowledged: { label: "Acknowledge", state: "Acknowledged", tone: "info", icon: "eye", next: OPEN },
            deferred: {
                label: "Defer", state: "Deferred", tone: "warning", icon: "clock", next: OPEN,
                take: Sheet.action.form({ fields: Sheet.field.date({ label: "Until", precision: "date" }), initial: (ctx) => ctx.today.addDays(1n) }),
                summary: (until) => East.str`until ${until.printFormatted("DD MMM")}`,
                updates: (until) => ({ row: Sheet.patch(Ticket, { due: some(until) }) }),
            },
            handed_over: {
                label: "Hand over", state: "Handed over", next: OPEN,
                take: Sheet.action.menu({ of: "crews" }),
                summary: (crew) => crew,
                updates: (crew) => ({ row: Sheet.patch(Ticket, { crew }) }),
            },
            closed: { label: "Close", state: "Closed", tone: "success", icon: "check" },
        },
    });
}

/** The tickets' sheet root, built and run. */
function ticketRoot(columns: Record<string, unknown> = {}, rows: TicketValue[] = TICKETS): Root {
    const fn = East.function([], Sheet.Types.Root, ($) => {
        const data = $.const(rows, ArrayType(Ticket));
        const crews = $.const(CREWS, ArrayType(CrewType));
        return Sheet.Root(data, {
            title: Sheet.column.text(Ticket, { header: "Ticket" }),
            crew: Sheet.column.text(Ticket, { header: "Crew" }),
            due: Sheet.column.date(Ticket, { header: "Due" }),
            action: ticketAction(),
            ...columns,
        } as never, { id: "id", registers: { crews: Sheet.register.members(crews, { kind: "crew", key: (c) => c.key, label: (c) => c.label }) } } as never);
    });
    return East.compile(fn, [])() as Root;
}

/** A column's action kind. */
function kindOf(root: Root, key: string): Kind {
    const column = root.columns.find((c) => equalFor(StringType)(c.key, key))!;
    assert.equal(column.kind.type, "action");
    return column.kind.value as Kind;
}

/** The inline rows of a root. */
function rowsOf(root: Root): ValueTypeOf<typeof Sheet.Types.Rows> {
    assert.equal(root.rows.type, "inline");
    return root.rows.value as ValueTypeOf<typeof Sheet.Types.Rows>;
}

/** The wire context of a flat sheet's row, its cells as given (else as projected). */
function contextOf(root: Root, index: number, cells?: Map<string, ValueTypeOf<typeof Sheet.Types.Cell>>): WireContext {
    const rows = rowsOf(root);
    const row = rows[index]!;
    return {
        drafts: new Map(), rowIndex: BigInt(index), rowId: row.id, offset: BigInt(index), line: none,
        row: (cells ?? row.cells) as never, rows, rowsOffset: 0n, partial: false, driver: none,
        today: new Date("2026-11-02T00:00:00Z"),
    } as WireContext;
}

/** What `build` throws inside a block, as a sheet's factory runs; `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        East.function([], NullType, ($) => { build($); });
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

/** A ticket sheet built with the action column given. */
function withAction(column: unknown): string {
    return refusal(($) => {
        const data = $.const(TICKETS, ArrayType(Ticket));
        const crews = $.const(CREWS, ArrayType(CrewType));
        return Sheet.Root(data, { title: Sheet.column.text(Ticket), action: column } as never,
            { id: "id", registers: { crews: Sheet.register.members(crews, { kind: "crew", key: (c) => c.key, label: (c) => c.label }) } } as never);
    });
}

const encodeDate = encodeBeast2For(DateTimeType);

describe("the machine on the wire", () => {
    test("start, and each case in the author's order with its words, tone, icon, next and value type", () => {
        const kind = kindOf(ticketRoot(), "action");
        assert.deepEqual(kind.start, [...OPEN]);
        assert.deepEqual(kind.cases.map((c) => [c.case, c.label, c.state, c.next.length]), [
            ["acknowledged", "Acknowledge", "Acknowledged", 4],
            ["deferred", "Defer", "Deferred", 4],
            ["handed_over", "Hand over", "Handed over", 4],
            ["closed", "Close", "Closed", 0],
        ]);
        assert.ok(equalFor(OptionType(Sheet.Types.ActionCase.fields.tone.cases.some))(kind.cases[0]!.tone, some(variant("info", null))));
        assert.ok(equalFor(OptionType(StringType))(kind.cases[1]!.icon, some("clock")));
        assert.ok(equalFor(OptionType(StringType))(kind.cases[2]!.icon, none));
        assert.ok(equalFor(Sheet.Types.ActionCase.fields.valueType)(kind.cases[1]!.valueType, toEastTypeValue(DateTimeType)));
        assert.equal(kind.summary, "$summary:action");
        assert.ok(equalFor(OptionType(StringType))(kind.name, some("$name:action")));
        assert.ok(equalFor(OptionType(StringType))(kind.title, none));
    });

    test("each case's take: NullType a button, a String with `of` a register's menu, a DateTime a form of one field at its case's name", () => {
        const [ack, deferred, handed] = kindOf(ticketRoot(), "action").cases;
        assert.equal(ack!.take.type, "button");
        assert.ok(equalFor(Sheet.Types.ActionTake)(handed!.take, variant("register", "crews")));
        const form = deferred!.take;
        if (form.type !== "form") assert.fail(`Defer's take is a ${form.type}, not a form`);
        assert.equal(form.value.scalar, true);
        assert.deepEqual(form.value.specs.map((s) => [s.path, s.label, s.editor.type]), [[["deferred"], "Until", "datetime"]]);
    });

    test("a variant whose every case is NullType is a menu of its cases, the labelled first; a struct a form, a field per field", () => {
        const kind = (() => {
            const fn = East.function([], Sheet.Types.Root, ($) => {
                const data = $.const([], ArrayType(ex.Step));
                return Sheet.Root(data as never, { action: Sheet.column.action(ex.Step, ex.StepAction, {
                    cases: {
                        started: { label: "Start", state: "Started" },
                        completed: { label: "Complete", state: "Completed" },
                        reported: { label: "Report", state: "Reported" },
                        held: { label: "Hold", state: "Held", take: Sheet.action.menu({ labels: { machine_down: "Machine down" } }) },
                        alerted: { label: "Alert", state: "Alerted", take: Sheet.action.form({ fields: { changes: Sheet.field.text({ label: "What changed" }) } }) },
                        verified: { label: "Verify", state: "Verified" },
                    },
                }) } as never, { id: "op" } as never);
            });
            const root = East.compile(fn, [])() as Root;
            return kindOf(root, "action");
        })();
        const byCase = new Map(kind.cases.map((c) => [c.case, c.take]));
        assert.ok(equalFor(Sheet.Types.ActionTake)(byCase.get("held")!, variant("menu", [
            { case: "machine_down", label: "Machine down" }, { case: "awaiting_parts", label: "Awaiting parts" }, { case: "quality_hold", label: "Quality hold" },
        ])));
        const alert = byCase.get("alerted")!;
        if (alert.type !== "form") assert.fail(`Alert's take is a ${alert.type}, not a form`);
        assert.equal(alert.value.scalar, false);
        assert.deepEqual(alert.value.specs.map((s) => [s.path.join("."), s.label, s.editor.type]), [["changes", "What changed", "text"], ["severity", "Severity", "select"]]);
        // An Integer with no take: a form of one number.
        assert.equal(byCase.get("reported")!.type, "form");
    });
});

describe("the cell and its summary", () => {
    test("a row's case and its value ride the Action cell; none is the blank cell; the summary its rule cell's text", () => {
        const rows = rowsOf(ticketRoot());
        const cell = (i: number, key: string) => rows[i]!.cells.get(key)!;
        assert.equal(cell(0, "action").type, "Null");
        const deferred = cell(1, "action");
        if (deferred.type !== "Action") assert.fail(`the deferred row's action cell is a ${deferred.type}, not an Action`);
        assert.equal(deferred.value.case, "deferred");
        assert.deepEqual(decodeBeast2For(DateTimeType)(deferred.value.value), new Date("2026-11-09T00:00:00Z"));
        assert.ok(equalFor(Sheet.Types.Cell)(cell(1, "$summary:action"), variant("String", "until 09 Nov")));
        assert.ok(equalFor(Sheet.Types.Cell)(cell(0, "$summary:action"), variant("String", "")));
        assert.ok(equalFor(Sheet.Types.Cell)(cell(0, "$name:action"), variant("String", "Spindle noise")));
    });
});

describe("the gate: whether a row may act now", () => {
    test("a complete row is open; `blocked` gives its reason; a draft missing a required field names it", () => {
        const root = ticketRoot();
        const kind = kindOf(root, "action");
        assert.ok(equalFor(Sheet.Types.ActionGate)(kind.gate(contextOf(root, 0)), variant("open", null)));
        const noCrew = new Map(rowsOf(root)[0]!.cells);
        noCrew.set("crew", variant("String", ""));
        assert.ok(equalFor(Sheet.Types.ActionGate)(kind.gate(contextOf(root, 0, noCrew)), variant("blocked", "names no crew")));
        const untitled = new Map(rowsOf(root)[0]!.cells);
        untitled.set("title", variant("Null", null));
        assert.ok(equalFor(Sheet.Types.ActionGate)(kind.gate(contextOf(root, 0, untitled)), variant("incomplete", ["Ticket"])));
    });
});

describe("each case's updates and initial, over the wire context", () => {
    test("Defer's updates set Due through its column; Hand over's the crew; a case without updates has none", () => {
        const root = ticketRoot();
        const [ack, deferred, handed] = kindOf(root, "action").cases;
        assert.equal(ack!.updates.type, "none");
        const until = new Date("2026-11-20T00:00:00Z");
        const out = deferred!.updates.value!(encodeDate(until), contextOf(root, 0), new Date("2026-11-02T14:02:00Z"));
        assert.ok(equalFor(SheetCellsType)(out.row, new Map([["due", variant("DateTime", until)]]) as never));
        assert.equal(out.group.size, 0);
        const handedOut = handed!.updates.value!(encodeBeast2For(StringType)("swing"), contextOf(root, 0), new Date());
        assert.ok(equalFor(SheetCellsType)(handedOut.row, new Map([["crew", variant("String", "swing")]]) as never));
    });

    test("a form's initial opens at its value, encoded at the case's type: tomorrow", () => {
        const root = ticketRoot();
        const deferred = kindOf(root, "action").cases[1]!;
        assert.deepEqual(decodeBeast2For(DateTimeType)(deferred.initial.value!(contextOf(root, 0))), new Date("2026-11-03T00:00:00Z"));
    });

    test("on a grouped sheet, Complete writes Good and Done on the step and the order's status on its band, read-only as it is", () => {
        const fn = East.function([], Sheet.Types.Root, ($) => {
            const orders = $.const(ORDERS, ArrayType(ex.WorkOrder));
            const statuses = $.const([{ word: "in_progress", label: "In progress" }, { word: "on_hold", label: "On hold" }, { word: "done", label: "Done" }], ArrayType(StatusWord));
            return Sheet.Root(orders, {
                good: Sheet.column.integer(ex.Step, { header: "Good" }),
                action: Sheet.column.action(ex.Step, ex.StepAction, {
                    start: ["started"],
                    cases: {
                        started: { label: "Start", state: "Started", next: ["completed"] },
                        completed: {
                            label: "Complete", state: "Completed",
                            updates: (_v, ctx, at) => ({
                                row: Sheet.patch(ex.Step, { good: some(ctx.row.good.match({ some: (_$, g) => g }, () => ctx.row.plan)), done: some(at) }),
                                group: Sheet.patch(ex.WorkOrder, { status: "in_progress" }),
                            }),
                        },
                        reported: { label: "Report", state: "Reported" },
                        held: { label: "Hold", state: "Held" },
                        alerted: { label: "Alert", state: "Alerted" },
                        verified: { label: "Verify", state: "Verified" },
                    },
                }),
                done: Sheet.column.date(ex.Step, { header: "Done" }),
            }, {
                id: "id",
                group: Sheet.group(ex.WorkOrder, "steps", { title: "name", cells: { action: Sheet.group.cell.enum(ex.WorkOrder, "statuses", "status", { editable: false }) } }),
                registers: { statuses: Sheet.register.members(statuses, { kind: "status", key: (s) => s.word, label: (s) => s.label }) },
            } as never);
        });
        const root = East.compile(fn, [])() as Root;
        const completed = kindOf(root, "action").cases.find((c) => c.case === "completed")!;
        const rows = rowsOf(root);
        const order = rows[0]!;
        // WO-1042's step 20, as its line's context.
        const ctx = { drafts: new Map(), rowIndex: 1n, rowId: order.id, offset: 0n, line: some("1"), row: order.lines[1]!.cells, rows, rowsOffset: 0n, partial: false, driver: none, today: new Date("2026-11-02T00:00:00Z") } as WireContext;
        const at = new Date("2026-11-02T14:02:00Z");
        const out = completed.updates.value!(encodeBeast2For(NullType)(null), ctx, at);
        assert.ok(equalFor(SheetCellsType)(out.row, new Map<string, unknown>([["good", variant("Integer", 24n)], ["done", variant("DateTime", at)]]) as never));
        assert.ok(equalFor(SheetCellsType)(out.group, new Map([["action", variant("String", "in_progress")]]) as never));
    });
});

describe("refusals, each naming the column and the case", () => {
    test("the declaration as it stands builds", () => {
        assert.equal(withAction(ticketAction()), "");
    });

    test("a case missing, or one the variant does not have", () => {
        const cases = { acknowledged: { label: "A", state: "A" }, deferred: { label: "D", state: "D" }, handed_over: { label: "H", state: "H" } };
        assert.match(withAction(ticketAction({ cases })), /^Sheet: action column "action" declares no case for "closed" — `cases` gives every case of the variant its words$/);
        assert.match(withAction(ticketAction({ cases: { ...cases, closed: { label: "C", state: "C" }, reopened: { label: "R", state: "R" } } })),
            /declares "reopened", a case the variant does not have \(acknowledged, closed, deferred, handed_over\)$/);
    });

    test("a start or next naming a case the variant does not have, or one twice; a start on a field always in a case", () => {
        assert.match(withAction(ticketAction({ start: ["opened"] })), /^Sheet: action column "action"'s `start` names "opened", a case the variant does not have/);
        assert.match(withAction(ticketAction({ start: ["closed", "closed"] })), /`start` names "closed" twice — each case is offered once$/);
        const NoOption = StructType({ id: StringType, title: StringType, state: ex.JobState });
        assert.match(refusal(($) => {
            const data = $.const([], ArrayType(NoOption));
            return Sheet.Root(data, { state: Sheet.column.action(NoOption, ex.JobState, {
                start: ["started"],
                cases: { started: { label: "Start", state: "Started" }, finished: { label: "Finish", state: "Finished" } },
            }) }, { id: "id" });
        }), /^Sheet: action column "state" has a `start`, and its field is always in a case/);
    });

    test("a field of another type; a take that does not fit its case; a register the sheet does not declare", () => {
        assert.match(withAction(Sheet.column.action(Ticket, ex.JobState, { cases: { started: { label: "S", state: "S" }, finished: { label: "F", state: "F" } } } as never)),
            /^Sheet: action column "action" sits on a variant field — it sits on a field of its variant, or an Option of it$/);
        assert.match(withAction(ticketAction({ cases: { ...{}, acknowledged: { label: "A", state: "A", take: Sheet.action.form() }, deferred: { label: "D", state: "D" }, handed_over: { label: "H", state: "H" }, closed: { label: "C", state: "C" } } })),
            /case "acknowledged" is NullType — it asks nothing, and is a button; it takes no `take`$/);
        assert.match(withAction(ticketAction({ cases: { acknowledged: { label: "A", state: "A" }, deferred: { label: "D", state: "D", take: Sheet.action.menu({ of: "crews" }) }, handed_over: { label: "H", state: "H" }, closed: { label: "C", state: "C" } } })),
            /case "deferred" is a DateTime — Sheet\.action\.menu\(\{ of \}\) chooses a register member, whose key is a String$/);
        assert.match(withAction(ticketAction({ cases: { acknowledged: { label: "A", state: "A" }, deferred: { label: "D", state: "D" }, handed_over: { label: "H", state: "H", take: Sheet.action.menu({ of: "teams" }) }, closed: { label: "C", state: "C" } } })),
            /case "handed_over"'s menu names register "teams", which `registers` does not declare \(crews\)$/);
    });

    test("a group patch on a flat sheet; a summary that is no String", () => {
        assert.match(withAction(ticketAction({ cases: {
            acknowledged: { label: "A", state: "A", updates: () => ({ group: Sheet.patch(ex.WorkOrder, { status: "x" }) }) },
            deferred: { label: "D", state: "D" }, handed_over: { label: "H", state: "H" }, closed: { label: "C", state: "C" },
        } })), /case "acknowledged"'s `updates` returns a group patch, and the sheet declares no group/);
        assert.match(withAction(ticketAction({ cases: {
            acknowledged: { label: "A", state: "A" }, deferred: { label: "D", state: "D", summary: (d: never) => d }, handed_over: { label: "H", state: "H" }, closed: { label: "C", state: "C" },
        } })), /case "deferred" has a `summary` returning a DateTime — it returns String or Option<String>$/);
    });

    test("names and takes are checked at compile time", () => {
        const never = (): void => {
            Sheet.column.action(Ticket, ex.TicketAction, {
                // @ts-expect-error — `start` names only the variant's cases
                start: ["opened"],
                cases: {
                    // @ts-expect-error — `next` names only the variant's cases
                    acknowledged: { label: "A", state: "A", next: ["reopened"] },
                    // @ts-expect-error — a DateTime's take is a form, never a register's menu
                    deferred: { label: "D", state: "D", take: Sheet.action.menu({ of: "crews" }) },
                    handed_over: { label: "H", state: "H" },
                    closed: { label: "C", state: "C" },
                },
            });
            // @ts-expect-error — every case of the variant is declared
            Sheet.column.action(Ticket, ex.TicketAction, { cases: { acknowledged: { label: "A", state: "A" } } });
        };
        assert.equal(typeof never, "function");
    });
});

test("ActionContext: the row complete, its neighbours Options, a flat sheet's group none", () => {
    assert.ok(isTypeEqual(Sheet.Types.ActionContext(Ticket), StructType({
        row: Ticket, index: IntegerType, rows: ArrayType(OptionType(Ticket)), group: OptionType(NullType), today: DateTimeType,
    })));
    assert.ok(isTypeEqual(Sheet.Types.ActionContext(ex.WorkOrder, "steps"), StructType({
        row: ex.Step, index: IntegerType, rows: ArrayType(OptionType(ex.Step)), group: OptionType(ex.WorkOrder), today: DateTimeType,
    })));
});
