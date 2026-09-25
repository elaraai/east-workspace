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

/** The lines, their machines stepped down into through a plain field — reviewed, and taking dropped jobs. */
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
