/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's editing wire (#880), driven from the host the way the renderer's
 * session drives it: the root compiled, its functions called with JS values
 * and entry bytes. What the IR proves on its own — the rows' flags, the
 * build-time refusals — is in `plan.spec.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FunctionType, IntegerType, NullType, OptionType, StringType, StructType,
    decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { ApprovalStateType, Editing, EditingRequestStore, Plan, UIComponentType } from "@elaraai/east-ui/internal";

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const W29 = new Date("2026-07-13T00:00:00Z");
const W31 = new Date("2026-07-27T00:00:00Z");
const W32 = new Date("2026-08-03T00:00:00Z");
const W33 = new Date("2026-08-10T00:00:00Z");
const END = new Date("2026-09-21T00:00:00Z");

// ── The canvas: lines holding machines — a gesture on a machine drafts its line ──

const Job = StructType({ key: StringType, start: DateTimeType, end: DateTimeType });
const Machine = StructType({ approval: ApprovalStateType, jobs: ArrayType(Job) });
const Line = StructType({ name: StringType, machines: DictType(StringType, Machine) });
const Lines = DictType(StringType, Line);
type LineValue = ValueTypeOf<typeof Line>;
type JobValue = ValueTypeOf<typeof Job>;
type Verdict = ValueTypeOf<typeof ApprovalStateType>;
type RowId = ValueTypeOf<typeof Plan.Types.RowId>;
type Gesture = ValueTypeOf<typeof Plan.Types.Gesture>;

const PENDING: Verdict = variant("pending", null);
const APPROVED: Verdict = variant("approved", null);
const REJECTED: Verdict = variant("rejected", null);
const B214: JobValue = { key: "b214", start: W28, end: W31 };
// A job card dropped at W29 becomes a fortnight's job, keyed by the card and the list's size.
const WELD: JobValue = { key: "weld-1", start: W29, end: W31 };

const line1 = (m03: Verdict = PENDING, m03Jobs: JobValue[] = [B214], m04: Verdict = APPROVED): LineValue => ({
    name: "Line 1",
    machines: new Map([["M03", { approval: m03, jobs: m03Jobs }], ["M04", { approval: m04, jobs: [] }]]),
});
const line2 = (m11: Verdict = PENDING): LineValue => ({
    name: "Line 2",
    machines: new Map([["M11", { approval: m11, jobs: [] }]]),
});
const SEED: Map<string, LineValue> = new Map([["L1", line1()], ["L2", line2()]]);

const axis = Plan.axis({ window: { min: W27, max: END }, resolution: "week" });

/** The lines, their machines stepped down into through a plain field — reviewed, taking dropped jobs, and moving them (#825). */
const SERIES = [
    Plan.series.span(Line, {
        key: "lines", title: "Lines", label: (l) => l.name, runs: (_l) => [],
        children: Plan.children((l) => l.machines, [
            Plan.series.span(Machine, {
                key: "machines", title: "Machines", label: (_m, k) => k,
                review: { verdict: "approval" },
                runs: (m) => m.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.key, state: "confirmed" })),
                edit: {
                    items: "jobs",
                    key: "key",
                    start: "start",
                    end: "end",
                    create: (drop, m) => ({
                        key: East.str`${drop.from.key}-${East.print(m.jobs.size())}`,
                        start: drop.at.unwrap("time"),
                        end: drop.at.unwrap("time").addWeeks(2n),
                    }),
                },
            }),
        ]),
    }),
];

const machine = (line: string, m: string): RowId => variant("entry", { series: "machines", path: [line, m] });
const lineRow = (line: string): RowId => variant("entry", { series: "lines", path: [line] });
const verdict = (v: Verdict): Gesture => variant("verdict", v);
const dropOf = (card: string, row: RowId, at: Date): Gesture =>
    variant("drop", { from: { library: "jobs", key: card }, row, at: variant("time", at), duplicate: false });
const moveOf = (key: string, from: RowId, to: RowId, start: Date, end: Date): Gesture =>
    variant("move", { key, from, to, start: variant("time", start), end: variant("time", end) });

const encodeLine = encodeBeast2For(Line);
const decodeLine = decodeBeast2For(Line);
const sameLine = equalFor(Line);
const sameIds = equalFor(ArrayType(Plan.Types.RowId));
const sameBlocks = equalFor(Plan.Types.Blocks);
const sameApproval = equalFor(OptionType(ApprovalStateType));

/** The Plan arm of a compiled component. */
function planOf(ui: ValueTypeOf<typeof UIComponentType>) {
    if (ui.type !== "Plan") throw new Error(`Expected a Plan, got ${ui.type}`);
    return ui.value;
}

/** A canvas's editing declaration. */
function editingOf(root: ReturnType<typeof planOf>) {
    if (root.editing.type !== "some") throw new Error("Expected the canvas to declare editing");
    return root.editing.value;
}
type Wire = ReturnType<typeof editingOf>;

/** The entry one request writes, decoded — `undefined` when no series took the gesture. */
function writeOne(wire: Wire, id: string, entry: LineValue, rows: RowId[], gesture: Gesture): LineValue | undefined {
    const [out] = wire.write([{ id, entry: encodeLine(entry), rows, gesture }]);
    return out?.type === "some" ? decodeLine(out.value) : undefined;
}

// ── An inline canvas, its session read-only ──────────────────────────────────

const inlineRoot = planOf(East.function([], UIComponentType, ($) => {
    const data = $.const(SEED, Lines);
    return Plan.Root({ axis, data, series: SERIES, editing: {} });
}).toIR().compile([])());
const inline = editingOf(inlineRoot);

test("a verdict on a machine writes its LINE — the machine's field set, every other field as it was", () => {
    const written = writeOne(inline, "L1", line1(), [machine("L1", "M03")], verdict(APPROVED));
    assert.ok(written !== undefined && sameLine(written, line1(APPROVED)));
});

test("a card dropped on a machine joins its jobs as `create` builds it — from the card, the bucket's instant and the entry", () => {
    const written = writeOne(inline, "L1", line1(), [machine("L1", "M03")], dropOf("weld", machine("L1", "M03"), W29));
    assert.ok(written !== undefined && sameLine(written, line1(PENDING, [B214, WELD])));
});

test("Approve all is one request per entry over each of its rows, and every verdict lands in that one entry", () => {
    const outs = inline.write([
        { id: "L1", entry: encodeLine(line1()), rows: [machine("L1", "M03"), machine("L1", "M04")], gesture: verdict(REJECTED) },
        { id: "L2", entry: encodeLine(line2()), rows: [machine("L2", "M11")], gesture: verdict(REJECTED) },
    ]);
    const [one, two] = outs.map((o) => (o.type === "some" ? decodeLine(o.value) : undefined));
    assert.equal(outs.length, 2);
    assert.ok(one !== undefined && sameLine(one, line1(REJECTED, [B214], REJECTED)));
    assert.ok(two !== undefined && sameLine(two, line2(REJECTED)));
});

test("a row no series takes the gesture on writes nothing — the line's own row, a machine the line lacks, another line's row", () => {
    const entry = encodeLine(line1());
    const outs = inline.write([
        { id: "L1", entry, rows: [lineRow("L1")], gesture: verdict(APPROVED) },
        { id: "L1", entry, rows: [machine("L1", "M99")], gesture: verdict(APPROVED) },
        // Line 2's M03 — a key Line 1 also holds — is not Line 1's row.
        { id: "L1", entry, rows: [machine("L2", "M03")], gesture: verdict(APPROVED) },
        // The lines series declares no `edit`, so a card finds no list there.
        { id: "L1", entry, rows: [lineRow("L1")], gesture: dropOf("weld", lineRow("L1"), W29) },
    ]);
    assert.deepEqual(outs.map((o) => o.type), ["none", "none", "none", "none"]);
});

// ── Moves and resizes (#825) — the item's instants, and the list it is in ───

const M03 = machine("L1", "M03");
const M04 = machine("L1", "M04");
const M11 = machine("L2", "M11");
/** B-214 a week later, whole. */
const B214_LATER: JobValue = { key: "b214", start: W29, end: W32 };

test("a move along its row sets the job's instants where it is — every other job and field as they were", () => {
    const moved = writeOne(inline, "L1", line1(PENDING, [B214, WELD]), [M03], moveOf("b214", M03, M03, W29, W32));
    assert.ok(moved !== undefined && sameLine(moved, line1(PENDING, [B214_LATER, WELD])));
    // A resize is the same gesture with one end moved.
    const resized = writeOne(inline, "L1", line1(), [M03], moveOf("b214", M03, M03, W28, W33));
    assert.ok(resized !== undefined && sameLine(resized, line1(PENDING, [{ key: "b214", start: W28, end: W33 }])));
});

test("a move to another machine of the same line is ONE request, source row first: the job leaves M03 and joins M04", () => {
    const moved = writeOne(inline, "L1", line1(), [M03, M04], moveOf("b214", M03, M04, W29, W32));
    const expected: LineValue = {
        name: "Line 1",
        machines: new Map([["M03", { approval: PENDING, jobs: [] }], ["M04", { approval: APPROVED, jobs: [B214_LATER] }]]),
    };
    assert.ok(moved !== undefined && sameLine(moved, expected));
});

test("a move to a machine of another line is two requests in order — the job leaves one line and joins the other", () => {
    const gesture = moveOf("b214", M03, M11, W29, W32);
    const outs = inline.write([
        { id: "L1", entry: encodeLine(line1()), rows: [M03], gesture },
        { id: "L2", entry: encodeLine(line2()), rows: [M11], gesture },
    ]);
    const [one, two] = outs.map((o) => (o.type === "some" ? decodeLine(o.value) : undefined));
    assert.ok(one !== undefined && sameLine(one, line1(PENDING, [])));
    const joined: LineValue = { name: "Line 2", machines: new Map([["M11", { approval: PENDING, jobs: [B214_LATER] }]]) };
    assert.ok(two !== undefined && sameLine(two, joined));
});

test("a move that lands nowhere is refused whole — a job is never taken without being put", () => {
    const entry = encodeLine(line1());
    // Onto the line's own row, whose series takes no move: taken from M03, put nowhere.
    const ontoLine = inline.write([{ id: "L1", entry, rows: [M03, lineRow("L1")], gesture: moveOf("b214", M03, lineRow("L1"), W29, W32) }]);
    assert.deepEqual(ontoLine.map((o) => o.type), ["none"]);
    // Its target's request missing: the source alone is refused too.
    const alone = inline.write([{ id: "L1", entry, rows: [M03], gesture: moveOf("b214", M03, M11, W29, W32) }]);
    assert.deepEqual(alone.map((o) => o.type), ["none"]);
    // The target first: nothing is carried yet when it is written, so nothing lands.
    const reversed = inline.write([
        { id: "L2", entry: encodeLine(line2()), rows: [M11], gesture: moveOf("b214", M03, M11, W29, W32) },
        { id: "L1", entry, rows: [M03], gesture: moveOf("b214", M03, M11, W29, W32) },
    ]);
    assert.deepEqual(reversed.map((o) => o.type), ["none", "none"]);
    // A key no job has: nothing to take, nothing written.
    assert.equal(writeOne(inline, "L1", line1(), [M03], moveOf("b999", M03, M03, W29, W32)), undefined);
    // An instant on another arm than the field holds (a number into a DateTime).
    const [numeric] = inline.write([{ id: "L1", entry, rows: [M03], gesture: variant("move", {
        key: "b214", from: M03, to: M03, start: variant("number", 3), end: variant("number", 5),
    }) }]);
    assert.equal(numeric?.type, "none");
});

test("a machine's jobs keep their keys unique — a move onto a machine already holding the key, or a card whose job repeats one, is refused", () => {
    // M04 already holds a job keyed b214 — another job, the same key. The move
    // would leave M04 two jobs one key names, so it puts the job nowhere, and
    // the move is refused whole.
    const B214_ELSEWHERE: JobValue = { key: "b214", start: W31, end: W33 };
    const clash: LineValue = {
        name: "Line 1",
        machines: new Map([["M03", { approval: PENDING, jobs: [B214] }], ["M04", { approval: APPROVED, jobs: [B214_ELSEWHERE] }]]),
    };
    const [sameLineMove] = inline.write([{ id: "L1", entry: encodeLine(clash), rows: [M03, M04], gesture: moveOf("b214", M03, M04, W29, W32) }]);
    assert.equal(sameLineMove?.type, "none");
    // Across lines: the target line refuses it, so the source line gives nothing up.
    const l2Clash: LineValue = { name: "Line 2", machines: new Map([["M11", { approval: PENDING, jobs: [B214_ELSEWHERE] }]]) };
    const across = inline.write([
        { id: "L1", entry: encodeLine(line1()), rows: [M03], gesture: moveOf("b214", M03, M11, W29, W32) },
        { id: "L2", entry: encodeLine(l2Clash), rows: [M11], gesture: moveOf("b214", M03, M11, W29, W32) },
    ]);
    assert.deepEqual(across.map((o) => o.type), ["none", "none"]);
    // `create` keys a card by the card and the list's size: on a machine holding
    // one weld job already, a second weld card mints "weld-1" again — refused.
    assert.equal(writeOne(inline, "L1", line1(PENDING, [WELD]), [M03], dropOf("weld", M03, W29)), undefined);
    // Along its own row the key is its own, so a move there is untouched by the rule.
    const along = writeOne(inline, "L1", clash, [M04], moveOf("b214", M04, M04, W29, W32));
    assert.ok(along !== undefined && sameLine(along, {
        name: "Line 1",
        machines: new Map([["M03", { approval: PENDING, jobs: [B214] }], ["M04", { approval: APPROVED, jobs: [B214_LATER] }]]),
    }));
});

// Every instant field type (#825): a number axis's Integer field and a Plan.Types.Instant field, and an ordinal
// axis's String fields.
const Slot = StructType({ key: StringType, at: IntegerType });
const Board = StructType({ slots: ArrayType(Slot), marks: ArrayType(Plan.Types.EventMark) });
type BoardValue = ValueTypeOf<typeof Board>;
type InstantValue = ValueTypeOf<typeof Plan.Types.Instant>;
const boardOf = (at: bigint, mark: InstantValue): BoardValue => ({
    slots: [{ key: "s1", at }],
    marks: [{ key: "k", at: mark, kind: variant("milestone", null), icon: none, label: none }],
});
const BOARD = boardOf(2n, variant("number", 2));
const numberWire = editingOf(planOf(East.function([], UIComponentType, ($) => {
    const data = $.const(new Map([["b", BOARD]]), DictType(StringType, Board));
    return Plan.Root({
        axis: Plan.axis.number({ window: { min: 0, max: 10 }, step: 1 }),
        data,
        series: [
            Plan.series.buckets(Board, {
                key: "slots", title: "Slots", label: (_b, k) => k,
                events: (b) => b.slots.map((_$, s) => Plan.event({ key: s.key, at: s.at, state: "confirmed" })),
                edit: { items: "slots", key: "key", at: "at" },
            }),
            Plan.series.events(Board, {
                key: "marks", title: "Marks", label: (_b, k) => k, marks: (b) => b.marks,
                edit: { items: "marks", key: "key", at: "at" },
            }),
        ],
        editing: {},
    });
}).toIR().compile([])()));

test("a move writes the axis instant into the item's field on its arm — an Integer rounded half away from zero, an instant as it is", () => {
    const encode = encodeBeast2For(Board);
    const decode = decodeBeast2For(Board);
    const same = equalFor(Board);
    const slots: RowId = variant("entry", { series: "slots", path: ["b"] });
    const marks: RowId = variant("entry", { series: "marks", path: ["b"] });
    const place = (row: RowId, key: string, at: number): BoardValue | undefined => {
        const [out] = numberWire.write([{
            id: "b", entry: encode(BOARD), rows: [row],
            gesture: variant("move", { key, from: row, to: row, start: variant("number", at), end: variant("number", at) }),
        }]);
        return out?.type === "some" ? decode(out.value) : undefined;
    };
    const at36 = place(slots, "s1", 3.6);
    assert.ok(at36 !== undefined && same(at36, boardOf(4n, variant("number", 2))));
    const at25 = place(slots, "s1", 2.5);
    assert.ok(at25 !== undefined && same(at25, boardOf(3n, variant("number", 2))));
    const mark = place(marks, "k", 5.5);
    assert.ok(mark !== undefined && same(mark, boardOf(2n, variant("number", 5.5))));
});

const Phase = StructType({ key: StringType, from: StringType, to: StringType });
const Flow = StructType({ phases: ArrayType(Phase) });
const FLOW: ValueTypeOf<typeof Flow> = { phases: [{ key: "p1", from: "PREP", to: "BUILD" }] };
const ordinalWire = editingOf(planOf(East.function([], UIComponentType, ($) => {
    const data = $.const(new Map([["f", FLOW]]), DictType(StringType, Flow));
    return Plan.Root({
        axis: Plan.axis.ordinal({ values: ["INTAKE", "PREP", "BUILD", "QC"] }),
        data,
        series: [Plan.series.cards(Flow, {
            key: "phases", title: "Phases", label: (_f, k) => k,
            chips: (f) => f.phases.map((_$, p) => Plan.chip({ key: p.key, from: p.from, to: p.to, label: p.key, state: "confirmed" })),
            edit: { items: "phases", key: "key", start: "from", end: "to" },
        })],
        editing: {},
    });
}).toIR().compile([])()));

test("an ordinal axis's move writes its values into String fields", () => {
    const row: RowId = variant("entry", { series: "phases", path: ["f"] });
    const [out] = ordinalWire.write([{
        id: "f", entry: encodeBeast2For(Flow)(FLOW), rows: [row],
        gesture: variant("move", { key: "p1", from: row, to: row, start: variant("ordinal", "BUILD"), end: variant("ordinal", "QC") }),
    }]);
    assert.ok(out?.type === "some" && equalFor(Flow)(decodeBeast2For(Flow)(out.value), { phases: [{ key: "p1", from: "BUILD", to: "QC" }] }));
});

test("derive draws each draft in its entry's place — with none it is the canvas's own blocks, and a draft derives like data", () => {
    const plain = inline.derive(0n, 0n, new Map());
    assert.ok(plain.type === "some" && inlineRoot.rows.type === "inline" && sameBlocks(plain.value, inlineRoot.rows.value));
    const grown: LineValue = { name: "Line 2", machines: new Map([["M11", { approval: PENDING, jobs: [] }], ["M12", { approval: PENDING, jobs: [] }]]) };
    const drafted = inline.derive(0n, 0n, new Map([
        ["L1", encodeLine(line1(APPROVED, [B214, WELD]))],
        ["L2", encodeLine(grown)],
    ]));
    assert.equal(drafted.type, "some");
    if (drafted.type !== "some") return;
    const rows = drafted.value.flatMap((b) => b.rows);
    // A drafted machine the source lacks draws where the applied batch would put it.
    assert.ok(sameIds(rows.map((r) => r.id), [
        lineRow("L1"), machine("L1", "M03"), machine("L1", "M04"), lineRow("L2"), machine("L2", "M11"), machine("L2", "M12"),
    ]));
    const m03 = rows[1]!;
    assert.ok(sameApproval(m03.approval, some(APPROVED)));
    assert.equal(m03.kind.type === "span" ? m03.kind.value.runs.length : -1, 2);
    assert.ok(sameApproval(rows[4]!.approval, some(PENDING)));
});

test("deriveEntry derives one entry's rows — what a draft is compared by, where it was made", () => {
    const rows = inline.deriveEntry("L1", encodeLine(line1())).flatMap((b) => b.rows);
    assert.ok(sameIds(rows.map((r) => r.id), [lineRow("L1"), machine("L1", "M03"), machine("L1", "M04")]));
});

test("entryIds lists a window's entries in the source's order, and readEntry reads one back by its id", () => {
    assert.deepEqual(inline.entryIds(0n, 10n), some(["L1", "L2"]));
    assert.deepEqual(inline.entryIds(1n, 1n), some(["L2"]));
    assert.deepEqual(inline.entryIds(9n, 5n), some([]));
    const read = inline.readEntry("L2", 0n);
    assert.ok(read.type === "some" && sameLine(decodeLine(read.value), line2()));
    assert.equal(inline.readEntry("L9", 0n).type, "none");
});

test("the declaration names the canvas's entries — their type and key, whole-entry drafts, and the snapshot a batch begins from", () => {
    assert.equal(inline.idField.type, "none");
    assert.equal(inline.keyType.type, "some");
    assert.equal(inline.mode.type, "batch");
    assert.equal(inline.onApply.type, "none");
    assert.equal(inline.onPatch.type, "none");
    assert.equal(inline.ready.type, "none");
    assert.ok(inline.snapshot.type === "some" && equalFor(Lines)(decodeBeast2For(Lines)(inline.snapshot.value), SEED));
});

// ── A paged canvas — the session reads the very windows the canvas pages ─────

const Logged = StructType({ ui: UIComponentType, log: FunctionType([], ArrayType(StringType)) });
const pagedHarness = East.function([], Logged, ($) => {
    const entries = $.const(SEED, Lines);
    const keys = $.const(["L1", "L2"], ArrayType(StringType));
    const log = $.let([], ArrayType(StringType));
    const handle = $.const({
        id: "ops",
        page: East.function([IntegerType, IntegerType], OptionType(Lines), ($, offset, limit) => {
            $(log.pushLast(East.str`${East.print(offset)}+${East.print(limit)}`));
            const n = $.let(keys.size());
            const start = $.let(offset.less(n).ifElse(() => offset, () => n));
            const end = $.let(offset.add(limit).less(n).ifElse(() => offset.add(limit), () => n));
            const out = $.let(new Map(), Lines);
            $.for(keys.slice(start, end), ($2, key) => { $2(out.insert(key, entries.get(key))); });
            return some(out);
        }),
        total: East.function([], OptionType(IntegerType), () => some(2n)),
    }, StructType({
        id: StringType,
        page: FunctionType([IntegerType, IntegerType], OptionType(Lines)),
        total: FunctionType([], OptionType(IntegerType)),
    }));
    const ui = $.let(Plan.Root({ axis, data: handle, series: SERIES, editing: {} }));
    return { ui, log: East.function([], ArrayType(StringType), () => log) };
});

test("a paged canvas edits the windows it pages — derive and entryIds read the joined window, readEntry the window its offset lies in", () => {
    const paged = pagedHarness.toIR().compile([])();
    const root = planOf(paged.ui);
    const wire = editingOf(root);
    const before = paged.log().length;
    assert.deepEqual(wire.entryIds(0n, 200n), some(["L1", "L2"]));
    const read = wire.readEntry("L2", 1n);
    assert.ok(read.type === "some" && sameLine(decodeLine(read.value), line2()));
    // An offset in the next window reads THAT window — the entry is not there.
    assert.equal(wire.readEntry("L2", 201n).type, "none");
    // Every read is a whole window at the canvas's page size, as the canvas asks.
    assert.deepEqual(paged.log().slice(before), ["0+200", "0+200", "200+200"]);
    // Without drafts, derive is the canvas's own page; a draft takes its entry's place.
    const page = root.rows.type === "paged" ? root.rows.value.page(0n, 200n) : undefined;
    const plain = wire.derive(0n, 200n, new Map());
    assert.ok(page?.type === "some" && plain.type === "some" && sameBlocks(plain.value, page.value));
    const drafted = wire.derive(0n, 200n, new Map([["L2", encodeLine(line2(APPROVED))]]));
    assert.equal(drafted.type, "some");
    if (drafted.type !== "some") return;
    const m11 = drafted.value.flatMap((b) => b.rows).find((r) => equalFor(Plan.Types.RowId)(r.id, machine("L2", "M11")));
    assert.ok(m11 !== undefined && sameApproval(m11.approval, some(APPROVED)));
    // Read-only here, and a paged batch's base is the source's revision, so no
    // snapshot rides the wire; the session is the handle's, by its id.
    assert.equal(wire.onApply.type, "none");
    assert.equal(wire.snapshot.type, "none");
    assert.equal(wire.sourceId, "ops");
});

// ── The author's callbacks, over the canvas's own entry and key ─────────────

test("ready checks each drafted entry in one call, in order — a check that throws refuses its own entry alone", () => {
    const wire = editingOf(planOf(East.function([], UIComponentType, ($) => {
        const data = $.const(SEED, Lines);
        const ready = $.const(East.function([Line, StringType], Editing.Types.Readiness, ($, line, key) => {
            $.if(key.equal("L9"), ($) => { $.error("no such line"); });
            const crowded = $.let(line.machines.filter((_$, m) => m.jobs.size().greater(1n)));
            const result = $.let(variant("ready", null), Editing.Types.Readiness);
            $.if(crowded.size().greater(0n), ($) => {
                $.assign(result, variant("invalid", crowded.toArray((_$, _m, k) => ({ field: "jobs", message: East.str`${k} is crowded` }))));
            });
            return result;
        }));
        return Plan.Root({ axis, data, series: SERIES, editing: { ready } });
    }).toIR().compile([])()));
    assert.equal(wire.ready.type, "some");
    if (wire.ready.type !== "some") return;
    const results = wire.ready.value([
        { id: "L1", entry: encodeLine(line1(PENDING, [B214, WELD])) },
        { id: "L2", entry: encodeLine(line2()) },
        { id: "L9", entry: encodeLine(line2()) },
    ]);
    assert.equal(results.length, 3);
    assert.deepEqual(results[0], variant("invalid", [{ field: "jobs", message: "M03 is crowded" }]));
    assert.deepEqual(results[1], variant("ready", null));
    const failed = results[2]!;
    assert.equal(failed.type, "invalid");
    if (failed.type === "invalid") assert.match(failed.value[0]!.message, /^Readiness check failed: .*no such line/);
});

test("onPatch hears each gesture at Plan.Types.PatchEvent(R) — whole-entry drafts, decoded from the session's bytes", () => {
    const heard = East.function([], Logged, ($) => {
        const data = $.const(SEED, Lines);
        const log = $.let([], ArrayType(StringType));
        const onPatch = $.const(East.function([Plan.Types.PatchEvent(Line)], NullType, ($, event) => {
            $(log.pushLast(East.str`${event.origin.getTag()} · ${event.label} · ${East.print(event.draftChanges.size())}`));
        }));
        const ui = $.let(Plan.Root({ axis, data, series: SERIES, editing: { onPatch } }));
        return { ui, log: East.function([], ArrayType(StringType), () => log) };
    }).toIR().compile([])();
    const wire = editingOf(planOf(heard.ui));
    assert.equal(wire.onPatch.type, "some");
    if (wire.onPatch.type !== "some") return;
    const PatchEvent = Plan.Types.PatchEvent(Line);
    const draftDiff = diffFor(OptionType(Editing.Types.DraftField(Line)));
    wire.onPatch.value(encodeBeast2For(PatchEvent)({
        transactionId: "t1", origin: variant("verdict", null), label: "Approve L1-M03",
        draftChanges: [{ id: "L1", patch: draftDiff(none, some(variant("value", line1(APPROVED)))), place: none }],
        domainChanges: none, readiness: variant("ready", null),
    }));
    assert.deepEqual(heard.log(), ["verdict · Approve L1-M03 · 1"]);
});

const Batch = Editing.Types.ChangeSet(Line, StringType);
type BatchValue = ValueTypeOf<typeof Batch>;
const encodeBatch = encodeBeast2For(Batch);
const lineDiff = diffFor(OptionType(Line));
const approveM03 = (requestId: string, base: BatchValue["base"]): BatchValue => ({
    requestId, base, label: "Approve L1-M03",
    changes: [{ id: "L1", patch: lineDiff(some(line1()), some(line1(APPROVED))), place: none }],
});

test("onApply receives the change set at the canvas's own entry and key types — sync, or async", async () => {
    const sync = editingOf(planOf(East.function([], UIComponentType, ($) => {
        const data = $.const(SEED, Lines);
        const onApply = $.const(East.function([Batch], Editing.Types.ApplyResult, (_$, batch) =>
            variant("applied", { revision: some(batch.requestId) })));
        return Plan.Root({ axis, data, series: SERIES, editing: { onApply, mode: "auto" } });
    }).toIR().compile([])()));
    assert.equal(sync.mode.type, "auto");
    assert.ok(sync.onApply.type === "some" && sync.onApply.value.type === "sync");
    if (sync.onApply.type === "some" && sync.onApply.value.type === "sync") {
        const result = sync.onApply.value.value(encodeBatch(approveM03("r1", variant("snapshot", SEED))));
        assert.deepEqual(result, variant("applied", { revision: some("r1") }));
    }
    const later = editingOf(planOf(East.function([], UIComponentType, ($) => {
        const data = $.const(SEED, Lines);
        const onApply = $.const(East.asyncFunction([Batch], Editing.Types.ApplyResult, (_$, batch) =>
            variant("applied", { revision: some(batch.label) })));
        return Plan.Root({ axis, data, series: SERIES, editing: { onApply } });
    }).toIR().compile([])()));
    assert.ok(later.onApply.type === "some" && later.onApply.value.type === "async");
    if (later.onApply.type === "some" && later.onApply.value.type === "async") {
        const result = await later.onApply.value.value(encodeBatch(approveM03("r2", variant("snapshot", SEED))));
        assert.deepEqual(result, variant("applied", { revision: some("Approve L1-M03") }));
    }
});

// ── The inline adapter — a live handle, written through onUpdate ─────────────

// The host's store, reached as `State.bind`'s is: through platform calls, so
// the handle captures nothing. A handle's identity is its reader's bytes — the
// ledger's key — so it must not change when the source does.
const LinesStore = {
    read: East.platform("plan_editing_spec_read", [], Lines),
    write: East.platform("plan_editing_spec_write", [Lines], NullType),
};
const liveHarness = East.function([], UIComponentType, ($) => {
    const handle = $.const({
        read: East.function([], Lines, () => LinesStore.read()),
        write: East.function([Lines], NullType, ($, lines) => { $(LinesStore.write(lines)); }),
    }, StructType({ read: FunctionType([], Lines), write: FunctionType([Lines], NullType) }));
    return Plan.Root({ axis, data: handle, series: SERIES, editing: { onUpdate: handle.write } });
});

test("onUpdate applies a batch through the live handle — checked against the snapshot it began from, and never written twice", () => {
    let saved = SEED;
    let writes = 0;
    // The request ledger copies its bytes in and out, as the renderer's does:
    // an encoder may hand the same buffer back on its next call.
    const ledger = new Map<string, Uint8Array>();
    const wire = editingOf(planOf(liveHarness.toIR().compile([
        LinesStore.read.implement(() => saved),
        LinesStore.write.implement((lines) => {
            saved = lines;
            writes += 1;
            return null;
        }),
        EditingRequestStore.read.implement((key) => {
            const recorded = ledger.get(key);
            return recorded === undefined ? none : some(recorded.slice());
        }),
        EditingRequestStore.write.implement((key, payload) => {
            ledger.set(key, payload.slice());
            return null;
        }),
    ])()));
    if (wire.onApply.type !== "some" || wire.onApply.value.type !== "sync") return assert.fail("the inline adapter is synchronous");
    const apply = wire.onApply.value.value;
    if (wire.snapshot.type !== "some") return assert.fail("an inline session carries its snapshot");
    // The base is the snapshot the canvas was drawn from.
    const base: BatchValue["base"] = variant("snapshot", decodeBeast2For(Lines)(wire.snapshot.value));
    const first = encodeBatch(approveM03("r1", base));
    assert.deepEqual(apply(first), variant("applied", { revision: none }));
    assert.ok(sameLine(saved.get("L1")!, line1(APPROVED)));
    assert.ok(sameLine(saved.get("L2")!, line2()));
    assert.equal(writes, 1);
    // The canvas reads the handle live: the entry read back is the applied one.
    const read = wire.readEntry("L1", 0n);
    assert.ok(read.type === "some" && sameLine(decodeLine(read.value), line1(APPROVED)));
    // A replay answers from the ledger — nothing is written twice.
    assert.deepEqual(apply(first), variant("applied", { revision: none }));
    assert.equal(writes, 1);
    // A new batch from the old base is refused, never rebased: the source moved under it.
    const stale = encodeBatch({
        requestId: "r2", base, label: "Approve L2-M11",
        changes: [{ id: "L2", patch: lineDiff(some(line2()), some(line2(APPROVED))), place: none }],
    });
    assert.equal(apply(stale).type, "conflict");
    assert.ok(sameLine(saved.get("L2")!, line2()));
    assert.equal(writes, 1);
});
