/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Loose rows between the groups (#846): a source of entries
 * `Sheet.Types.Entry(PackageType, "tasks")` — a package with its tasks, or a
 * task of its own standing between the packages. A loose row draws as a
 * plain row numbered in the groups' sequence; the seam above a band, or
 * beside a loose row, inserts one; it edits, deletes, pastes and counts on
 * its own; fold-all passes it by, and no band sticks over it. Every value
 * built by the east-ui factory and COMPILED; Apply writes through the live
 * onUpdate adapter.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, East, FloatType, OptionType, StringType, StructType, decodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, State, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { StateImpl, initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { EastChakraSheet } from "./index.js";
import { sheetJournal } from "./journal.test-utils.js";
import { measureRowsAsDrawn } from "./frame.test-utils.js";
import type { SheetRootValue } from "./values.js";

let restoreRows: () => void = () => {};
beforeEach(() => { localStorage.clear(); initializeStore(new UIStore()); restoreRows = measureRowsAsDrawn(); });
afterEach(() => { cleanup(); restoreRows(); vi.useRealTimers(); });

const TaskType = StructType({ id: StringType, task: StringType, qty: OptionType(FloatType), note: StringType });
const PackageType = StructType({ id: StringType, name: StringType, tasks: ArrayType(TaskType) });
const EntryType = Sheet.Types.Entry(PackageType, "tasks");
const DraftEntry = Sheet.Types.DraftEntry(EntryType);
const Ctx = Sheet.Types.DraftContext(PackageType, "tasks");
const Proposals = ArrayType(Sheet.Types.Proposal(TaskType));

/** Fixtures at MODULE scope: East bodies never call host helpers. */
const ENTRIES: ValueTypeOf<typeof EntryType>[] = [
    variant("row", { id: "brief", task: "Review drawings", qty: none, note: "brief note" }),
    variant("group", { id: "p1", name: "Roughing", tasks: [
        { id: "t1", task: "Machine blanks", qty: some(1200.0), note: "" },
        { id: "t2", task: "Inspect lots", qty: some(4.0), note: "" },
    ] }),
    variant("row", { id: "handover", task: "Hand over", qty: none, note: "handover note" }),
    variant("row", { id: "signoff", task: "Sign off", qty: none, note: "" }),
    variant("group", { id: "p2", name: "Finishing", tasks: [{ id: "t3", task: "Finish housings", qty: some(1200.0), note: "" }] }),
];

/**
 * The sheet the way an author builds one: entries of packages and loose
 * tasks, a new task's default note, and — with `proposer` — a proposer that
 * follows a hand-over with two tasks.
 */
function buildLoose(opts: { proposer?: boolean } = {}): SheetRootValue {
    const program = East.function([], UIComponentType, ($) => {
        const entries = $.const(ENTRIES, ArrayType(EntryType));
        const newTask = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(TaskType), () => Sheet.patch(TaskType, { note: "new" })));
        const newPackage = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(PackageType), () => Sheet.patch(PackageType, { tasks: [] })));
        const followUps = $.const(East.function([Ctx], Proposals, ($2, ctx) => ctx.row.task.hasTag("value").and(() => ctx.row.task.unwrap("value").startsWith("Hand")).ifElse(
            ($3) => $3.const([
                { patch: Sheet.patch(TaskType, { task: "Check drawings", note: "proposed" }), meta: "after a hand-over" },
                { patch: Sheet.patch(TaskType, { task: "Book transport", note: "proposed" }), meta: "after a hand-over" },
            ], Proposals),
            (_$3) => East.value([], Proposals),
        )));
        return Sheet.Root(entries, {
            task: Sheet.column.text(TaskType, { header: "Task" }),
            qty: Sheet.column.quantity(TaskType, { header: "Qty" }),
        }, {
            id: "id",
            group: Sheet.group(PackageType, "tasks", { title: "name", noun: { singular: "package", plural: "packages" } }),
            newRow: newTask,
            newGroup: newPackage,
            ...(opts.proposer === true ? { suggest: { ahead: 2n, triggers: ["task" as const], propose: [followUps] } } : {}),
        });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

/** The same sheet over a live binding: Apply writes the checked batch through onUpdate. */
const liveProgram = East.function([], UIComponentType, ($) => {
    const entries = $.const(State.bind([ArrayType(EntryType)], "sheet-loose-dom", ENTRIES));
    const newTask = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(TaskType), () => Sheet.patch(TaskType, { note: "new" })));
    return Sheet.Root(entries, {
        task: Sheet.column.text(TaskType, { header: "Task" }),
        qty: Sheet.column.quantity(TaskType, { header: "Qty" }),
    }, { id: "id", group: Sheet.group(PackageType, "tasks", { title: "name" }), newRow: newTask, onUpdate: entries.write });
}).toIR().compile(StateImpl);
const liveView = (): SheetRootValue => {
    const value = liveProgram();
    if (value.type !== "Sheet") throw new Error("Expected Sheet");
    return value.value;
};

/** Swap the host's edit channel for a spy after compilation — the renderer takes every function from the value. */
function withSpy(root: SheetRootValue) {
    const journal = sheetJournal(root);
    return { value: journal.value, edits: journal.events, draft: (id: string) => journal.draft(id, DraftEntry), drafts: journal.drafts };
}

function mount(value: SheetRootValue) {
    const utils = render(<ChakraProvider value={system}><EastChakraSheet value={value} storageKey="sheet-loose-test" /></ChakraProvider>);
    const card = utils.container.querySelector("[data-sheet-card]") as HTMLElement;
    const band = (id: string) => utils.container.querySelector(`[data-slot="row"][data-band-row][data-row-id="${id}"]`) as HTMLElement | null;
    const lines = (id: string) => [...utils.container.querySelectorAll(`[data-slot="row"][data-group-id="${id}"]`)] as HTMLElement[];
    /** A loose row — a plain row on the grouped sheet: its own id, no group. */
    const loose = (id: string) => utils.container.querySelector(`[data-slot="row"][data-row-id="${id}"]:not([data-band-row]):not([data-group-id])`) as HTMLElement | null;
    const numberOf = (row: HTMLElement) => row.querySelector('[data-slot="gutterNumber"]')!.textContent;
    const order = () => [...utils.container.querySelectorAll('[data-slot="row"]:not([data-proposed])')].map((r) => (r.hasAttribute("data-band-row") ? `[${r.getAttribute("data-row-id")}]` : r.hasAttribute("data-group-id") ? `  ${r.querySelector('[data-key="task"]')!.textContent}` : r.getAttribute("data-row-id")));
    const input = () => utils.container.querySelector('[data-slot="editorInput"]') as HTMLInputElement | null;
    const key = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(card, { key: k, ...init });
    const editorKey = (k: string) => fireEvent.keyDown(input()!, { key: k });
    const type = (text: string) => fireEvent.input(input()!, { target: { value: text } });
    const tick = () => new Promise<void>((r) => queueMicrotask(r));
    const flush = () => act(async () => { await tick(); await tick(); });
    const msg = () => utils.container.querySelector('[data-slot="footerMessage"]')!.textContent;
    const summary = () => utils.container.querySelector('[data-slot="footerSummary"]')!.textContent;
    const foldAll = () => utils.container.querySelector('[data-slot="foldAll"]') as HTMLElement;
    /** Hover the seam above a row: its chips show in the sheet's one insertion layer. */
    const chip = (row: HTMLElement, slot: "insertRow" | "insertGroup") => {
        fireEvent.mouseEnter(row.querySelector('[data-slot="insertPoint"]')!);
        return utils.container.querySelector(`[data-slot="insertLayer"] [data-slot="${slot}"]`) as HTMLElement | null;
    };
    const press = async (name: string) => {
        const button = utils.getByRole("button", { name });
        await act(async () => { fireEvent.mouseDown(button, { button: 0 }); fireEvent.click(button); });
    };
    return { ...utils, card, band, lines, loose, numberOf, order, input, key, editorKey, type, flush, msg, summary, foldAll, chip, press };
}

/** The entry drafts a gesture changed, by id. */
const changed = (event: { draftChanges: readonly { id: string }[] }) => event.draftChanges.map((c) => c.id);
/** A draft entry's row arm — the loose row's field drafts. */
function rowArm(entry: ValueTypeOf<typeof DraftEntry>) {
    if (entry.type !== "row") throw new Error(`Expected a loose row, got ${entry.type}`);
    return entry.value;
}
/** A draft entry's group arm — the group's field drafts and its tasks. */
function groupArm(entry: ValueTypeOf<typeof DraftEntry>) {
    if (entry.type !== "group") throw new Error(`Expected a group, got ${entry.type}`);
    return entry.value;
}

describe("the body", () => {
    test("a loose row is a plain row between the groups — no rail, numbered in the groups' sequence, its own cells; the footer counts loose rows on their own", () => {
        const ui = mount(withSpy(buildLoose()).value);
        expect(ui.order()).toEqual(["brief", "[p1]", "  Machine blanks", "  Inspect lots", "  ", "handover", "signoff", "[p2]", "  Finish housings", "  "]);
        // Numbered in the groups' sequence; lines number from 1 within their group.
        expect(ui.numberOf(ui.loose("brief")!)).toBe("1");
        expect(ui.numberOf(ui.band("p1")!)).toBe("2");
        expect(ui.lines("p1").map(ui.numberOf)).toEqual(["1", "2", "3"]);
        expect(ui.numberOf(ui.loose("handover")!)).toBe("3");
        expect(ui.numberOf(ui.loose("signoff")!)).toBe("4");
        expect(ui.numberOf(ui.band("p2")!)).toBe("5");
        // Its own cells; no rail — a line's connector joins its group, a loose row has none.
        expect(ui.loose("handover")!.querySelector('[data-key="task"]')!.textContent).toBe("Hand over");
        expect(ui.loose("handover")!.querySelector('[data-slot="connector"]')).toBeNull();
        expect(ui.lines("p1")[0]!.querySelector('[data-slot="connector"]')).not.toBeNull();
        expect(ui.loose("brief")!.querySelector('[role="rowheader"]')!.getAttribute("aria-label")).toBe("Row 1");
        // The footer counts the groups, their lines, and the loose rows on their own.
        expect(ui.summary()).toBe("2 packages · 3 lines · 3 loose rows");
        expect(ui.foldAll().getAttribute("aria-label")).toBe("Fold 2 packages");
    });

    test("fold-all folds the groups and passes the loose rows by — a ring on a loose row stays on it", async () => {
        const ui = mount(withSpy(buildLoose()).value);
        const task = () => ui.loose("signoff")!.querySelector('[data-key="task"]')!;
        fireEvent.mouseDown(task(), { button: 0 });
        fireEvent.click(ui.foldAll());
        await ui.flush();
        expect(ui.band("p1")!.hasAttribute("data-folded")).toBe(true);
        expect(ui.band("p2")!.hasAttribute("data-folded")).toBe(true);
        expect(ui.order()).toEqual(["brief", "[p1]", "handover", "signoff", "[p2]"]);
        expect(ui.msg()).toBe("Folded 2 packages — the corner, ⌥ on a chevron or ⇧Space opens them");
        // The ring re-found its loose row — not the group above it.
        expect(task().hasAttribute("data-selected")).toBe(true);
        expect(ui.band("p1")!.querySelector('[data-selected]')).toBeNull();
        expect(ui.foldAll().getAttribute("aria-label")).toBe("Open 2 packages");
    });
});

describe("insertion", () => {
    test("the seam above a band inserts a loose row before its group; beside a loose row, a loose row beside it; a line's seam, a line with a minted id", async () => {
        const { value, edits, draft } = withSpy(buildLoose());
        const ui = mount(value);
        // Above p1's band: a row — not a line — before the group.
        const above = ui.chip(ui.band("p1")!, "insertRow")!;
        expect(above.getAttribute("aria-label")).toBe("Insert row before");
        fireEvent.click(above);
        await ui.flush();
        expect(edits).toHaveLength(1);
        expect(edits[0]!.origin.type).toBe("insert");
        const first = edits[0]!.draftChanges[0]!;
        expect(first.place).toEqual(some(variant("ordered", variant("before", "p1"))));
        // Its draft is the entry's row arm: its id its own, the constructor's note, the task still to type.
        const created = rowArm(draft(first.id));
        expect(created.id).toEqual(variant("value", first.id));
        expect(created.note).toEqual(variant("value", "new"));
        expect(created.task.type).toBe("missing");
        expect(ui.order().slice(0, 3)).toEqual(["brief", first.id, "[p1]"]);
        expect(ui.numberOf(ui.loose(first.id)!)).toBe("2");
        expect(ui.numberOf(ui.band("p1")!)).toBe("3");
        expect(ui.loose(first.id)!.querySelector('[data-slot="editor"]')).toBeTruthy();
        ui.editorKey("Escape");
        // Beside a loose row: before it.
        const beside = ui.chip(ui.loose("signoff")!, "insertRow")!;
        expect(beside.getAttribute("aria-label")).toBe("Insert row before");
        fireEvent.click(beside);
        await ui.flush();
        const second = edits[1]!.draftChanges[0]!;
        expect(second.place).toEqual(some(variant("ordered", variant("before", "signoff"))));
        expect(draft(second.id).type).toBe("row");
        ui.editorKey("Escape");
        // A line's seam: a line in its group — named as one — whose id is minted.
        const line = ui.chip(ui.lines("p1")[1]!, "insertRow")!;
        expect(line.getAttribute("aria-label")).toBe("Insert line before");
        fireEvent.click(line);
        await ui.flush();
        expect(changed(edits[2]!)).toEqual(["p1"]);
        const p1 = groupArm(draft("p1"));
        expect(p1.tasks.map((t) => t.task)).toEqual([variant("value", "Machine blanks"), variant("missing", null), variant("value", "Inspect lots")]);
        const minted = p1.tasks[1]!.id;
        if (minted.type !== "value") throw new Error("Expected a minted id");
        expect(minted.value).not.toBe("");
        expect(["t1", "t2", "t3", "brief", "handover", "signoff", first.id, second.id]).not.toContain(minted.value);
        // A line already there keeps its own.
        expect(p1.tasks[0]!.id).toEqual(variant("value", "t1"));
        expect(ui.summary()).toBe("2 packages · 4 lines · 5 loose rows");
    });

    test("Alt+Insert on a loose row inserts a loose row after it; on a band, the group's first line", async () => {
        const { value, edits, draft } = withSpy(buildLoose());
        const ui = mount(value);
        fireEvent.mouseDown(ui.loose("brief")!.querySelector('[data-key="task"]')!, { button: 0 });
        ui.key("Insert", { altKey: true });
        await ui.flush();
        const after = edits[0]!.draftChanges[0]!;
        expect(after.place).toEqual(some(variant("ordered", variant("after", "brief"))));
        expect(draft(after.id).type).toBe("row");
        ui.editorKey("Escape");
        fireEvent.mouseDown(ui.band("p2")!.querySelector('[data-key="$title"]')!, { button: 0 });
        ui.key("Insert", { altKey: true });
        await ui.flush();
        expect(changed(edits[1]!)).toEqual(["p2"]);
        expect(groupArm(draft("p2")).tasks.map((t) => t.task.type)).toEqual(["missing", "value"]);
    });
});

describe("edits", () => {
    test("typing on a loose row commits it as an entry of its own — its row arm, its hidden note kept", async () => {
        const { value, edits, draft } = withSpy(buildLoose());
        const ui = mount(value);
        fireEvent.mouseDown(ui.loose("handover")!.querySelector('[data-key="task"]')!, { button: 0 });
        ui.key("H");
        ui.type("Handed over");
        ui.editorKey("Enter");
        await ui.flush();
        expect(edits).toHaveLength(1);
        expect(changed(edits[0]!)).toEqual(["handover"]);
        expect(rowArm(draft("handover"))).toEqual({ id: variant("value", "handover"), task: variant("value", "Handed over"), qty: variant("value", none), note: variant("value", "handover note") });
        expect(edits[0]!.domainChanges.type).toBe("some");
        expect(ui.loose("handover")!.querySelector('[data-key="task"]')!.textContent).toBe("Handed over");
        // ⏎ moved the ring down onto the next loose row.
        expect(ui.loose("signoff")!.querySelector('[data-key="task"]')!.hasAttribute("data-selected")).toBe(true);
    });
});

describe("delete", () => {
    test("a loose row deletes on its own", async () => {
        const { value, edits, drafts } = withSpy(buildLoose());
        const ui = mount(value);
        fireEvent.mouseDown(ui.loose("brief")!.querySelector('[data-slot="gutter"]')!, { button: 0 });
        ui.key("Backspace");
        await ui.flush();
        expect(edits).toHaveLength(1);
        expect(edits[0]!.origin.type).toBe("remove");
        expect(changed(edits[0]!)).toEqual(["brief"]);
        expect(drafts.has("brief")).toBe(false);
        expect(ui.loose("brief")).toBeNull();
        expect(ui.msg()).toBe("Deleted 1 row");
        expect(ui.numberOf(ui.band("p1")!)).toBe("1");
    });

    test("a range of loose rows and lines deletes both in one gesture; the group it empties takes the ring where its band lands, and ⌫ again removes it", async () => {
        const { value, edits, drafts, draft } = withSpy(buildLoose());
        const ui = mount(value);
        // From the hand-over through p2's only line: two loose rows, p2's band, its line.
        fireEvent.mouseDown(ui.loose("handover")!.querySelector('[data-slot="gutter"]')!, { button: 0 });
        fireEvent.mouseDown(ui.lines("p2")[0]!.querySelector('[data-slot="gutter"]')!, { button: 0, shiftKey: true });
        ui.key("Backspace");
        await ui.flush();
        expect(edits).toHaveLength(1);
        expect(changed(edits[0]!).sort()).toEqual(["handover", "p2", "signoff"]);
        expect(drafts.has("handover")).toBe(false);
        expect(drafts.has("signoff")).toBe(false);
        expect(groupArm(draft("p2")).tasks).toEqual([]);
        expect(ui.msg()).toBe("Deleted 3 rows — ⌫ again removes the package");
        expect(ui.order()).toEqual(["brief", "[p1]", "  Machine blanks", "  Inspect lots", "  ", "[p2]", "  "]);
        // The emptied package's band holds the ring — two rows above it went with it.
        expect(ui.band("p2")!.hasAttribute("data-picked")).toBe(true);
        ui.key("Backspace");
        await ui.flush();
        expect(changed(edits[1]!)).toEqual(["p2"]);
        expect(ui.band("p2")).toBeNull();
    });
});

describe("the clipboard", () => {
    test("paste on a loose row fills the loose rows from the ring down, then new loose rows after the last of them — never across a band", async () => {
        const { value, edits, draft } = withSpy(buildLoose());
        const ui = mount(value);
        fireEvent.mouseDown(ui.loose("handover")!.querySelector('[data-key="task"]')!, { button: 0 });
        fireEvent.paste(ui.card, { clipboardData: { getData: () => "Pack\nLabel\nShip\nInvoice" } });
        await ui.flush();
        expect(edits).toHaveLength(1);
        expect(edits[0]!.origin.type).toBe("pasted");
        expect(rowArm(draft("handover")).task).toEqual(variant("value", "Pack"));
        expect(rowArm(draft("signoff")).task).toEqual(variant("value", "Label"));
        // Two new loose rows after the sign-off, in order; p2 untouched.
        const added = edits[0]!.draftChanges.filter((c) => c.place.type === "some");
        expect(added).toHaveLength(2);
        expect(added[0]!.place).toEqual(some(variant("ordered", variant("after", "signoff"))));
        expect(added[1]!.place).toEqual(some(variant("ordered", variant("after", added[0]!.id))));
        expect(rowArm(draft(added[0]!.id)).task).toEqual(variant("value", "Ship"));
        expect(rowArm(draft(added[1]!.id)).task).toEqual(variant("value", "Invoice"));
        expect(changed(edits[0]!)).not.toContain("p2");
        expect(ui.order().slice(5)).toEqual(["handover", "signoff", added[0]!.id, added[1]!.id, "[p2]", "  Finish housings", "  "]);
        expect(ui.msg()).toBe("Pasted 4×1 from clipboard");
    });
});

describe("proposals", () => {
    test("proposals under a loose row land after it as new loose rows, in order — where the row below leaves room", async () => {
        vi.useFakeTimers();
        const { value, edits, draft } = withSpy(buildLoose({ proposer: true }));
        const ui = mount(value);
        const settle = () => act(async () => { for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(100); });
        const proposals = () => [...ui.container.querySelectorAll('[data-slot="row"][data-proposed]')] as HTMLElement[];
        // Under the hand-over the sign-off is busy: nothing is proposed there (B§5.2).
        fireEvent.mouseDown(ui.loose("handover")!.querySelector('[data-key="task"]')!, { button: 0 });
        ui.key("H");
        ui.type("Handed over");
        ui.editorKey("Enter");
        await settle();
        expect(proposals()).toHaveLength(0);
        // Under the sign-off a band follows: the two proposals show, numbered on after it.
        fireEvent.mouseDown(ui.loose("signoff")!.querySelector('[data-key="task"]')!, { button: 0 });
        ui.key("H");
        ui.type("Handle returns");
        ui.editorKey("Enter");
        await settle();
        expect(proposals()).toHaveLength(2);
        expect(proposals().map((p) => p.querySelector('[data-slot="gutterNumber"]')!.textContent)).toEqual(["5", "6"]);
        // ✓ on the second takes both — one `pattern` gesture.
        fireEvent.mouseDown(proposals()[1]!.querySelector('[data-slot="accept"]')!, { button: 0 });
        await settle();
        const taken = edits.find((e) => e.origin.type === "pattern")!;
        const added = taken.draftChanges.filter((c) => c.place.type === "some");
        expect(added.map((c) => rowArm(draft(c.id)).task)).toEqual([variant("value", "Check drawings"), variant("value", "Book transport")]);
        expect(added[0]!.place).toEqual(some(variant("ordered", variant("after", "signoff"))));
        expect(added[1]!.place).toEqual(some(variant("ordered", variant("after", added[0]!.id))));
        expect(ui.order().slice(5, 10)).toEqual(["handover", "signoff", added[0]!.id, added[1]!.id, "[p2]"]);
    });
});

describe("Apply", () => {
    test("a loose row inserted above a band and a line inserted into a group apply through onUpdate — the entries in their places, each with its id", async () => {
        const ui = mount(liveView());
        const wire = () => {
            const root = liveView();
            if (root.rows.type !== "inline") throw new Error("Expected inline rows");
            return root.rows.value;
        };
        fireEvent.click(ui.chip(ui.band("p2")!, "insertRow")!);
        await ui.flush();
        ui.type("Stage parts");
        ui.editorKey("Enter");
        await ui.flush();
        fireEvent.click(ui.chip(ui.lines("p1")[0]!, "insertRow")!);
        await ui.flush();
        ui.type("Deburr");
        ui.editorKey("Enter");
        await ui.flush();
        expect((ui.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(false);
        await ui.press("Apply changes");
        const rows = wire();
        expect(rows.map((r) => [r.id, r.band.type])).toEqual([
            ["brief", "none"], ["p1", "some"], ["handover", "none"], ["signoff", "none"], [rows[4]!.id, "none"], ["p2", "some"],
        ]);
        expect(rows[4]!.cells.get("task")).toEqual(variant("String", "Stage parts"));
        expect(rows[1]!.lines.map((l) => l.cells.get("task"))).toEqual([variant("String", "Deburr"), variant("String", "Machine blanks"), variant("String", "Inspect lots")]);
        // The saved entries themselves: the loose row an entry of its own, the new line with a minted id.
        const saved = (id: string, at: bigint): ValueTypeOf<typeof EntryType> => {
            const read = liveView().editing.readEntry(id, at);
            if (read.type !== "some") throw new Error(`Expected entry ${id}`);
            return decodeBeast2For(EntryType)(read.value);
        };
        const staged = saved(rows[4]!.id, 4n);
        expect(staged).toEqual(variant("row", { id: rows[4]!.id, task: "Stage parts", qty: none, note: "new" }));
        const p1 = saved("p1", 1n);
        if (p1.type !== "group") throw new Error("Expected a group");
        expect(p1.value.tasks.map((t) => t.task)).toEqual(["Deburr", "Machine blanks", "Inspect lots"]);
        expect(p1.value.tasks[0]!.id).not.toBe("");
        expect(p1.value.tasks[0]!.id).not.toBe(rows[4]!.id);
        expect(p1.value.tasks.slice(1).map((t) => t.id)).toEqual(["t1", "t2"]);
    });
});

describe("the sticky band", () => {
    /** The pinned header's height in the stand-in layout. */
    const HEADER_PX = 60;
    // jsdom lays nothing out: the frame is 600 px tall, the header sits at its
    // top, and a mounted row is where its offset puts it under the header, less
    // the frame's scroll — enough for the sheet to find what sticks.
    const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
    let realRect: typeof Element.prototype.getBoundingClientRect;
    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
            configurable: true,
            get(this: HTMLElement) { return this.getAttribute("data-virtual-rows") === "bounded" ? 600 : 0; },
        });
        realRect = Element.prototype.getBoundingClientRect;
        const measured = realRect;
        Element.prototype.getBoundingClientRect = function (this: Element) {
            const box = (top: number, height: number) => ({ x: 0, y: top, top, left: 0, right: 1024, bottom: top + height, width: 1024, height, toJSON: () => ({}) }) as DOMRect;
            if (this instanceof HTMLElement && this.dataset["slot"] === "virtualRow") {
                const frame = this.closest<HTMLElement>('[data-virtual-rows="bounded"]');
                const offset = Number(/translateY\((-?[\d.]+)px\)/.exec(this.style.transform)?.[1] ?? 0);
                return box(HEADER_PX + offset - (frame?.scrollTop ?? 0), measured.call(this).height);
            }
            if (this.querySelector(':scope > [data-slot="header"]') !== null) return box(0, HEADER_PX);
            return measured.call(this);
        };
    });
    afterEach(() => {
        Element.prototype.getBoundingClientRect = realRect;
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffsetHeight);
    });

    /** A read-only bounded sheet: a package of eight tasks, six loose tasks, another package. */
    function buildFramed(): SheetRootValue {
        const program = East.function([], UIComponentType, ($) => {
            const tasks = $.let(East.Array.range(0n, 8n).map(($2, i) => $2.const({ id: East.str`t${i}`, task: East.str`Task ${i}`, qty: none, note: "" }, TaskType)), ArrayType(TaskType));
            const loose = $.let(East.Array.range(0n, 6n).map(($2, i) => $2.const(variant("row", { id: East.str`l${i}`, task: East.str`Loose ${i}`, qty: none, note: "" }), EntryType)), ArrayType(EntryType));
            const first = $.const(variant("group", { id: "g1", name: "First", tasks }), EntryType);
            const last = $.const(variant("group", { id: "g2", name: "Last", tasks }), EntryType);
            const entries = $.let(East.value([first], ArrayType(EntryType)).concat(loose).concat([last]), ArrayType(EntryType));
            return Sheet.Root(entries, { task: Sheet.column.text(TaskType, { header: "Task" }) }, {
                id: "id", group: Sheet.group(PackageType, "tasks", { title: "name" }), readOnly: true, style: { height: "600px" },
            });
        });
        const value = East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
        return value.value;
    }

    test("a group's band sticks while its lines scroll under the header — never over the loose rows after it", async () => {
        const ui = mount(buildFramed());
        const frame = ui.container.querySelector('[data-virtual-rows="bounded"]') as HTMLElement;
        const sticking = () => ui.container.querySelector('[data-slot="stickyBand"]');
        // The band is 42 px and each line 36: at 100 px the second line is under the header — the band sticks.
        act(() => { frame.scrollTop = 100; fireEvent.scroll(frame); });
        await waitFor(() => expect(sticking()).not.toBeNull());
        // At 340 px the first loose row is under the header: no band stands for it.
        act(() => { frame.scrollTop = 340; fireEvent.scroll(frame); });
        await waitFor(() => expect(sticking()).toBeNull());
    });
});
