/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A press's own page (#1621), over the scoped-page example's records on e3
 * itself: a Calendar, a Plan and a Sheet whose rail's sources hold the page's
 * scope, the runs and the crew scoped to one press. Each payload compiles
 * against the platform a UI task's preview gives it, its slice made on the
 * record Slice's platform over e3's pages, and every read of the runs is
 * counted from the harness's request log.
 *
 * - Every read of a scoped source carries the press: the runs in a window, the
 *   backlog, and the crew's rows — each asked of e3 through an index the press
 *   leads, with the press, and never the record whole. What the Backlog tab
 *   counts on such a page is the DOM's (`src/calendar/calendar-scope.dom.test.tsx`).
 * - A Sheet's rail reads the press's runs, and its lens places them in the
 *   record, whose rows are the sheet's own. Its saved views hold the viewer's
 *   choices alone: one saved on a press's page counts another's runs under that
 *   page's press, and opens there.
 * - A run made on the page takes its press from the scope and its crew member
 *   from the row it lands on; a scope of several presses leaves a template's
 *   own. A draft that leaves the scope stays a draft, and its Save commits it.
 * - Search Records finds the press's runs alone, by their keys: through the
 *   index on exactly the press, each search a range of the press and the key
 *   together, a block of matches for each press of the page's, in the order the
 *   index files them. Rows a builder holds whole, as the Roster its people, are
 *   held to the scope by asking e3 which of them it holds.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    East, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant,
    type BlockBuilder, type ExprType, type ValueTypeOf, type option,
} from "@elaraai/east";
import { Slice, type SeekQueryType } from "@elaraai/east-ui";
import { Editing } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore, createRecordSliceImplementation } from "@elaraai/east-ui-components/platform";
import { recordSliceBasePage, recordSliceKeySearch, recordSlicePlace } from "@elaraai/east-ui-components/internal";
import {
    Calendar, CalendarPayloadType, Data, Plan, PlanPayloadType, Record, Schedule, Sheet, SheetPayloadType, createCalendarPayload, createSheetPayload,
} from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar-scope";
import { datasetPathToString } from "../src/platform/dataset-store.js";
import { scopeHeld, scopeHolds } from "../src/shared/schedule/found-blocks.js";
import type { SheetSavedView } from "../src/sheet/values.js";
import { clearNarrowing, narrowingEqual, narrowingOf, viewRowsRead, writeNarrowing } from "../src/sheet/view-state.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "calendar/calendar-scope": ex });

type CalendarPayload = ValueTypeOf<typeof CalendarPayloadType>;
type PlanPayload = ValueTypeOf<typeof PlanPayloadType>;
type SheetPayload = ValueTypeOf<typeof SheetPayloadType>;
type Run = ValueTypeOf<typeof ex.PressRun>;

/** The runs, as the request log names them. */
const RUNS = datasetPathToString(ex.pressRuns.path);
const OCT_1 = new Date("2026-10-01T00:00:00Z");
const OCT_3 = new Date("2026-10-03T00:00:00Z");
const NO_DRAFTS = new SortedMap<string, Uint8Array>([], compareFor(StringType));
const decodeRun = decodeBeast2For(ex.PressRun);
const encodeRun = encodeBeast2For(ex.PressRun);
const runEqual = equalFor(ex.PressRun);
const printString = printFor(StringType);
const maybeText = printFor(OptionType(StringType));

/**
 * The rail of a page for `presses`: the runs and the crew scoped to them, the runs' read together with the dates and a
 * choice of crew member, and the templates, which every press offers, unscoped.
 */
function railOf(presses: readonly string[]) {
    return Slice.bindRecords("spec.press", {
        run: { source: Data.bindPaged(ex.pressRuns, { indexes: ["press_runs_by_press", "press_runs_by_press_time", "press_runs_by_press_crew_time"] }), scope: { press: [...presses] },
            range: "start", fields: { crew: { label: "Crew" }, start: { label: "Dates" } } },
        crew: { source: Data.bindPaged(ex.pressCrew, { indexes: ["press_crew_by_press"] }), scope: { press: [...presses] } },
        runTemplates: { source: Data.bindPaged(ex.pressRunTemplates, { indexes: ["press_run_templates_by_group"] }), fields: { group: { label: "Template" } } },
    });
}

/** The example's Calendar, its payload declared in East over e3, its rail scoped to `presses`. */
function calendarOf($: BlockBuilder<typeof CalendarPayloadType>, presses: readonly string[]): ExprType<typeof CalendarPayloadType> {
    const crew = $.let(Data.bind(ex.pressCrew));
    const runs = $.let(Record.bind(ex.pressRuns, ["patch"]));
    const templates = $.let(Data.bind(ex.pressRunTemplates));
    const entries = $.let(Data.bindPaged(ex.pressRuns));
    const slice = $.let(railOf(presses));
    return createCalendarPayload({
        slice: { slice },
        resources: { crew: Calendar.resources(crew.read(), { name: "Crew", icon: "users", label: (row) => row.name }) },
        events: {
            run: Calendar.events(runs, { name: "Run", icon: "print", title: "title", start: "start", end: "end", resource: { field: "crew", of: "crew" }, entries,
                backlog: { duration: (row) => variant("hours", row.hours), due: (row) => row.due },
                templates: Calendar.templates(templates.read(), { name: (row) => row.name, group: (row) => some(row.group), duration: (row) => variant("hours", row.hours),
                    values: (row) => row.values, source: "runTemplates" }),
            }),
        },
        library: [Calendar.library.templates(), Calendar.library.backlog()],
    }) as ExprType<typeof CalendarPayloadType>;
}

/** The same page as a Plan: its runs on its crew's rows. */
function planOf($: BlockBuilder<typeof PlanPayloadType>, presses: readonly string[]): ExprType<typeof PlanPayloadType> {
    const crew = $.let(Data.bind(ex.pressCrew));
    const runs = $.let(Record.bind(ex.pressRuns, ["patch"]));
    const templates = $.let(Data.bind(ex.pressRunTemplates));
    const entries = $.let(Data.bindPaged(ex.pressRuns));
    const slice = $.let(railOf(presses));
    return Plan.Payload({
        axis: Plan.axis({ window: { min: OCT_1, max: new Date("2026-10-08T00:00:00Z") }, resolution: "day" }),
        slice: { slice },
        resources: { crew: Schedule.resources(crew.read(), { name: "Crew", icon: "users", label: (row) => row.name }) },
        events: {
            run: Schedule.events(runs, { name: "Run", icon: "print", title: "title", start: "start", end: "end", resource: { field: "crew", of: "crew" }, entries,
                backlog: { duration: (row) => variant("hours", row.hours), due: (row) => row.due },
                templates: Schedule.templates(templates.read(), { name: (row) => row.name, group: (row) => some(row.group), duration: (row) => variant("hours", row.hours),
                    values: (row) => row.values, source: "runTemplates" }),
            }),
        },
    }) as ExprType<typeof PlanPayloadType>;
}

/**
 * The runs as a Sheet on `press`'s page: the rail's `rows` source scoped to the press, a choice of crew member beside it
 * through the index the press leads, and the sheet's rows the record's own, the press's drawn over them as the lens.
 */
function sheetOf($: BlockBuilder<typeof SheetPayloadType>, press: ExprType<StringType>): ExprType<typeof SheetPayloadType> {
    const runs = $.let(Record.bind(ex.pressRuns, ["patch"]));
    const slice = $.let(Slice.bindRecords(East.str`spec.sheet.${press}`, {
        rows: { source: Data.bindPaged(ex.pressRuns, { indexes: ["press_runs_by_press", "press_runs_by_press_time", "press_runs_by_press_crew_time"] }), scope: { press: [press] },
            fields: { crew: { label: "Crew" } } },
    }));
    return createSheetPayload({
        slice: { slice },
        columns: { title: Sheet.column.text(ex.PressRun, { header: "Title" }), press: Sheet.column.text(ex.PressRun, { header: "Press" }) },
        onApply: Record.onApply(runs, { keyed: true }), edits: { insertRows: false },
    });
}

/**
 * A payload's program compiled over e3 as a UI task's preview compiles it, in a store of its own: its slice made on the
 * record Slice's platform over e3's pages.
 */
async function compiled<F>(program: ReturnType<typeof East.function>): Promise<F> {
    const { platform } = await h.platform(program);
    StateRuntime.initializeStore(new UIStore());
    const implementations = [...platform];
    implementations.push(...createRecordSliceImplementation(() => implementations));
    return East.compile(program as never, implementations) as F;
}
/** A payload built over e3 as a UI task's preview builds it. */
const built = async <T>(program: ReturnType<typeof East.function>): Promise<T> => (await compiled<() => T>(program))();
const calendarFor = (presses: readonly string[]) => built<CalendarPayload>(East.function([], CalendarPayloadType, ($) => calendarOf($, presses)));
const planFor = (presses: readonly string[]) => built<PlanPayload>(East.function([], PlanPayloadType, ($) => planOf($, presses)));
/** The Sheet on a press's page, each press's built in one store, as one page's parameter changes. */
const sheetPages = () => compiled<(press: string) => SheetPayload>(East.function([StringType], SheetPayloadType, ($, press) => sheetOf($, press)));

/** A Sheet's rail. */
function chromeOf(payload: SheetPayload) {
    if (payload.sheet.slice.type !== "some") assert.fail("the sheet has no rail");
    return payload.sheet.slice.value;
}
/** A Sheet's `rows` source, as its rail holds it. */
function rowsOf(payload: SheetPayload) {
    const part = chromeOf(payload).slice.parts.find((p) => p.source === "rows");
    if (part === undefined) assert.fail("the rail has no `rows` source");
    return part.slice;
}

/** A source's narrowed keys, as the payload carries them: every key, once its pages are read. */
async function keysOf(source: unknown): Promise<string[]> {
    const handle = (source as { value: { total(): option<bigint>; page(offset: bigint, limit: bigint): option<string[]> } }).value;
    const total = await h.ready(() => handle.total());
    return total === 0n ? [] : [...await h.ready(() => handle.page(0n, total))];
}

/** Every read of the runs so far: each a search, a page, or a read of runs, rows or the record whole. */
const runReads = () => h.requests().filter((request) => request.dataset === RUNS && ["find", "page", "runs", "rows", "read"].includes(request.kind));

/** The press a read of an index the press leads asks for: each exact search's leading values, as e3 prints them. */
const leadingOf = (reads: ReturnType<typeof runReads>) =>
    reads.flatMap((request) => request.searches.flatMap((search) => ("fields" in search ? [search.fields[0]!] : [])));

describe("a press's own page reads that press alone (#1621)", () => {
    test("a Calendar: the press's runs in the dates in view and in its backlog, and its crew's rows — each read through an index the press leads", async () => {
        for (const [press, scheduled, backlog, crew] of [["P-1", ["r1", "r2", "r3"], ["r6", "r7"], ["c1", "c2"]], ["P-2", ["r4", "r5"], ["r8"], ["c3", "c4"]]] as const) {
            const payload = await calendarFor([press]);
            const kind = payload.events[0]!;
            const items = await h.ready(() => kind.items(OCT_1, OCT_3, NO_DRAFTS, none));
            assert.deepEqual(items.map((item) => item.key), scheduled, `${press}'s runs in the window`);
            const waiting = await h.ready(() => kind.unscheduled(OCT_1, OCT_3, NO_DRAFTS, none));
            assert.deepEqual(waiting.map((item) => item.key).sort(compareFor(StringType)), backlog, `${press}'s backlog`);
            assert.deepEqual(await keysOf(payload.narrowed.get("crew")), crew, `${press}'s crew's rows`);
        }
        const reads = runReads();
        assert.ok(reads.length > 0);
        assert.deepEqual(reads.filter((request) => request.kind === "read"), [], "the runs are never read whole");
        const indexes = new Set(reads.flatMap((request) => { const index = request.query.get("index"); return index === null ? [] : [index]; }));
        assert.deepEqual([...indexes], ["press_runs_by_press_time"], "every read of the narrowing through the index the press leads");
        const leading = leadingOf(reads);
        assert.ok(leading.length > 0, "each search names its press");
        assert.deepEqual([...new Set(leading)].sort(compareFor(StringType)), [`(press=${printString("P-1")})`, `(press=${printString("P-2")})`]);
    });

    test("a Plan: the same, its runs on its crew's rows", async () => {
        const payload = await planFor(["P-2"]);
        const kind = payload.events[0]!;
        const items = await h.ready(() => kind.items(OCT_1, OCT_3, NO_DRAFTS, none));
        assert.deepEqual(items.map((item) => item.key), ["r4", "r5"]);
        const waiting = await h.ready(() => kind.unscheduled(OCT_1, OCT_3, NO_DRAFTS, none));
        assert.deepEqual(waiting.map((item) => item.key), ["r8"]);
        assert.deepEqual([...new Set(leadingOf(runReads()))], [`(press=${printString("P-2")})`]);
    });

    test("a Sheet: its rail's rows are the press's, and its lens places them in the record, whose rows are the sheet's own", async () => {
        const page = (await sheetPages())("P-1");
        const rows = rowsOf(page);
        assert.equal(await h.ready(() => rows.total()), 5n, "the source's count is the press's runs");
        // In their keys' order, through the index on exactly the press: what Search Records finds a run among them by.
        assert.deepEqual(await keysOf(page.narrowed.get("rows")), ["r1", "r2", "r3", "r6", "r7"]);
        // The lens: where the press's runs sit among the record's, placed from the index the press leads.
        const placed = await h.ready(() => recordSlicePlace(rows, rows.read().where));
        assert.deepEqual([placed.total, placed.records], [5n, 8n]);
        // The sheet's own rows: the record's, every press's, in its order — its total what its pages hold.
        if (page.sheet.rows.type !== "pinned") assert.fail(`expected the record's rows pinned, got ${page.sheet.rows.type}`);
        const record = page.sheet.rows.value;
        assert.equal(await h.ready(() => record.total()), 8n);
        assert.deepEqual((await h.ready(() => record.page(0n, 8n))).rows.map((row) => row.id), ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);
        // Every search of the narrowing names the press: through the index on exactly it, by the press itself.
        const named = runReads().flatMap((request) => request.searches.map((search) =>
            ("fields" in search ? search.fields[0]! : "key" in search ? search.key : "from" in search ? search.from[0] ?? "" : "")));
        assert.ok(named.length > 0 && named.every((text) => text.includes(printString("P-1"))), `every search names the press: ${named.join(", ")}`);
    });

    test("a Sheet's saved views hold the viewer's choices alone: one saved on a press's page counts another's runs under that page's press, and opens there", async () => {
        const sheet = await sheetPages();
        const p1 = sheet("P-1");
        const rows1 = rowsOf(p1);
        // The runs waiting for a crew member, chosen on Press 1's page.
        rows1.write({ ...rows1.read(), preset: none, where: new Map([["crew", variant("values", [maybeText(none)])]]) });
        const saved = narrowingOf(chromeOf(p1));
        assert.deepEqual([...saved.get("rows")!.where.keys()], ["crew"], "the view holds the choice, and not the press");
        assert.deepEqual([...rows1.read().where.keys()].sort(compareFor(StringType)), ["crew", "press"], "a read of the source carries both");
        assert.deepEqual(await keysOf(p1.narrowed.get("rows")), ["r6", "r7"]);
        const view: SheetSavedView = { id: "waiting", name: "Waiting", narrowing: saved, folds: new Map() };
        assert.equal(await h.ready(() => rows1.countWhere(viewRowsRead(rows1, view))), 2n);

        // Press 2's page: the view counts its runs waiting, and opens on them.
        const p2 = sheet("P-2");
        const rows2 = rowsOf(p2);
        assert.equal(await h.ready(() => rows2.countWhere(viewRowsRead(rows2, view))), 1n);
        writeNarrowing(chromeOf(p2), view.narrowing);
        assert.deepEqual(await keysOf(p2.narrowed.get("rows")), ["r8"]);
        assert.ok(narrowingEqual(narrowingOf(chromeOf(p2)), view.narrowing), "the view is open: the page holds its choices, and nothing more");
        // The All tab clears the choices, and the press stays.
        writeNarrowing(chromeOf(p2), clearNarrowing(narrowingOf(chromeOf(p2))));
        assert.deepEqual(await keysOf(p2.narrowed.get("rows")), ["r4", "r5", "r8"]);
    });
});

/** A Calendar's source of its rail, by its name. */
function partOf(payload: CalendarPayload, source: string) {
    if (payload.slice.type !== "some") assert.fail("the Calendar has no rail");
    const part = payload.slice.value.slice.parts.find((p) => p.source === source);
    if (part === undefined) assert.fail(`the rail has no \`${source}\` source`);
    return part.slice;
}

/** Each run a key search's blocks hold, in the page's rows' order: read back by their place there. */
async function foundRuns(part: ReturnType<typeof partOf>, query: ValueTypeOf<typeof SeekQueryType>): Promise<{ blocks: bigint[][]; keys: string[] }> {
    const blocks = await h.ready(() => recordSliceKeySearch(part, query));
    const keys: string[] = [];
    for (const block of blocks) {
        const entries = await h.ready(() => recordSliceBasePage(part, block.row, block.count)) as readonly { key: string }[];
        keys.push(...entries.map((entry) => entry.key));
    }
    return { blocks: blocks.map((block) => [block.row, block.count]), keys };
}

describe("Search Records on a press's page finds the press's runs alone, by their keys (#1621)", () => {
    test("a key's start finds the press's runs in their keys' order, each search naming the press — never another press's run", async () => {
        const part = partOf(await calendarFor(["P-1"]), "run");
        const before = runReads().length;
        assert.deepEqual(await foundRuns(part, variant("prefix", "r")), { blocks: [[0n, 5n]], keys: ["r1", "r2", "r3", "r6", "r7"] });
        // Through the index on exactly the press, its search bounding the press and the key together.
        const reads = runReads().slice(before);
        assert.deepEqual([...new Set(reads.flatMap((request) => { const index = request.query.get("index"); return index === null ? [] : [index]; }))], ["press_runs_by_press"]);
        const ranges = reads.flatMap((request) => request.searches.flatMap((search) => ("from" in search ? [search.from] : [])));
        assert.ok(ranges.length > 0 && ranges.every((from) => from[0] === printString("P-1")), "every range names the press first");
        assert.deepEqual(reads.filter((request) => request.kind === "read"), [], "the runs are never read whole");
    });

    test("a key finds its run among the press's — at its place there — and another press's run is no match", async () => {
        const part = partOf(await calendarFor(["P-1"]), "run");
        assert.deepEqual(await foundRuns(part, variant("key", printString("r6"))), { blocks: [[3n, 1n]], keys: ["r6"] });
        assert.deepEqual(await foundRuns(part, variant("key", printString("r4"))), { blocks: [], keys: [] }, "r4 is Press 2's");
        assert.deepEqual(await foundRuns(part, variant("prefix", "x")), { blocks: [], keys: [] });
    });

    test("on a page of two presses, a block of matches each, in the order the index files the presses — however the scope lists them — the second's after the first's rows", async () => {
        const part = partOf(await calendarFor(["P-2", "P-1"]), "run");
        assert.deepEqual(await foundRuns(part, variant("prefix", "r")), { blocks: [[0n, 5n], [5n, 3n]], keys: ["r1", "r2", "r3", "r6", "r7", "r4", "r5", "r8"] });
        assert.deepEqual(await foundRuns(part, variant("prefix", "r5")), { blocks: [[6n, 1n]], keys: ["r5"] });
    });

    test("rows a builder holds whole — the Roster's people — are held to the scope by asking e3 which of them it holds: a key of no row is held by none, and a source with no scope holds every row", async () => {
        const payload = await calendarFor(["P-1"]);
        const held = await h.ready(() => scopeHolds(partOf(payload, "crew"), ["c1", "c2", "c3", "c4", "c9"]));
        assert.deepEqual([...held].sort(compareFor(StringType)), ["c1", "c2"]);
        assert.equal(await scopeHeld(partOf(payload, "runTemplates"), ["flyers"]), undefined, "the templates are not scoped");
        assert.equal(await scopeHeld(undefined, ["c1"]), undefined);
    });
});

describe("a run made on a press's page takes its press from the scope (#1621)", () => {
    const create = (crew: string) => variant("create", {
        template: "flyers", start: new Date("2026-10-01T15:00:00Z"), end: new Date("2026-10-01T17:00:00Z"), resource: some({ kind: "crew", key: crew }),
    });

    test("a Calendar's: its press the page's, its crew member the row's, the rest its template's", async () => {
        const kind = (await calendarFor(["P-2"])).events[0]!;
        const made = kind.write([{ id: "r9", entry: new Uint8Array(), gesture: create("c3") }])[0]!;
        if (made.type !== "some") assert.fail("the run was refused");
        assert.ok(runEqual(decodeRun(made.value), {
            title: "Flyer run", press: "P-2", crew: some("c3"), start: some(new Date("2026-10-01T15:00:00Z")), end: some(new Date("2026-10-01T17:00:00Z")), hours: 2.0, due: none,
        }), "the template holds no press: the page's scope gives it");
    });

    test("a Plan's the same", async () => {
        const kind = (await planFor(["P-1"])).events[0]!;
        const made = kind.write([{ id: "r9", entry: new Uint8Array(), gesture: create("c2") }])[0]!;
        if (made.type !== "some") assert.fail("the run was refused");
        const run = decodeRun(made.value);
        assert.deepEqual([run.press, run.crew], ["P-1", some("c2")]);
    });

    test("a scope of several presses names none, so the template's own stands", async () => {
        const kind = (await calendarFor(["P-1", "P-2"])).events[0]!;
        const made = kind.write([{ id: "r9", entry: new Uint8Array(), gesture: create("c1") }])[0]!;
        if (made.type !== "some") assert.fail("the run was refused");
        assert.equal(decodeRun(made.value).press, "");
    });

    test("a draft that leaves the scope stays a draft, and its Save commits it", async () => {
        const kind = (await calendarFor(["P-1"])).events[0]!;
        const r1 = (await h.read(ex.pressRuns)).get("r1")! as Run;
        // An edit of its press: the scope writes nothing into it.
        const moved = kind.write([{ id: "r1", entry: encodeRun(r1), gesture: variant("field", { path: ["press"], value: encodeBeast2For(StringType)("P-2") }) }])[0]!;
        if (moved.type !== "some") assert.fail("the edit was refused");
        assert.ok(runEqual(decodeRun(moved.value), { ...r1, press: "P-2" }));
        // Its Save, through the record's patch door.
        const apply = kind.editing.onApply;
        if (apply.type !== "some" || apply.value.type !== "async") assert.fail("expected an async Apply");
        const batch = encodeBeast2For(Editing.Types.ChangeSet(ex.PressRun, StringType))({
            requestId: "move-r1", base: variant("revision", "state-0"), label: "Move a run to another press",
            changes: [{ id: "r1", patch: variant("replace", { before: some(r1), after: some({ ...r1, press: "P-2" }) }), place: none }],
        } as never);
        const result = await apply.value.value(batch);
        assert.equal(result.type, "applied");
        assert.equal((await h.read(ex.pressRuns)).get("r1")!.press, "P-2", "the commit is e3's");
    });
});
