/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The copilot in the DOM (Sheet Spec §5 rows 10–12, §9): fills as grey ghosts
 * with one next target, the ⇥ walk, the row fill, proposal rows with ✓ / ×
 * and the rejection memory, an async proposer's pending chip and settlement
 * with fake timers, supersession (latest wins), a swapped provider function
 * value re-running the copilot, a proposed row's cells under a column the
 * host hides (#1186), and a folded gutter's row-actions menu taking the fill
 * and the suggestions as the gutter's buttons do (#1215) — every provider a
 * compiled East function over the typed context, the async one behind a test
 * platform function.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, East, FloatType, IntegerType, OptionType, StringType, StructType,
    equalFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { system, UIStore, getRegisteredPlatformImplementations, registerPlatformImplementation } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { EastChakraSheet, SheetGrid, SheetProvider, SheetRoot } from "./index.js";
import { sheetJournal, type PatchEvent } from "./journal.test-utils.js";
import { touchFrame } from "./frame.test-utils.js";
import type { SheetRootValue } from "./values.js";

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => { initializeStore(new UIStore()); vi.useFakeTimers(); });

const PlanRowType = StructType({
    id: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), activity: StringType, qty: OptionType(FloatType), notes: StringType,
});
const ActivityType = StructType({ name: StringType, uom: StringType, rate: FloatType, days: IntegerType });
const Ctx = Sheet.Types.DraftContext(PlanRowType, ActivityType);
const Proposals = ArrayType(Sheet.Types.Proposal(PlanRowType));
const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
const FloatFill = OptionType(Sheet.Types.Fill(FloatType));

/** The model behind the async proposer — the test resolves each call by hand. */
const recommend = East.asyncPlatform("sheet_copilot_dom_recommend", [Ctx], Proposals);
type ProposalsValue = ValueTypeOf<typeof Proposals>;
const calls: { resolve: (rows: ProposalsValue) => void; reject: (err: unknown) => void }[] = [];
registerPlatformImplementation([recommend.implement((_ctx: unknown) => new Promise<ProposalsValue>((resolve, reject) => { calls.push({ resolve, reject }); }))]);
/** A proposal the model would return — every field of the patch an Option over the FIELD (so an Option field reads `some(some(x))`). */
const modelRow = (activity: string): ProposalsValue => [{
    patch: { id: none, start: some(some(new Date("2026-03-02T00:00:00Z"))), end: none, activity: some(activity), qty: some(some(250)), notes: some("from the model") },
    meta: "the model",
}] as unknown as ProposalsValue;

const FEB16 = new Date("2026-02-16T00:00:00Z");
const FEB20 = new Date("2026-02-20T00:00:00Z");
const ACTIVITIES = [
    { name: "Routing", uom: "pcs", rate: 150.0, days: 4n },
    { name: "Spraying", uom: "pcs", rate: 60.0, days: 4n },
    { name: "Wrapping", uom: "cartons", rate: 120.0, days: 3n },
];
const ROWS = [
    { id: "j1", start: some(FEB16), end: some(FEB20), activity: "Routing", qty: some(1200.0), notes: "first" },
];
const ROWS_WITH_WRAPPING = [
    ...ROWS,
    { id: "j2", start: some(FEB20), end: none, activity: "Wrapping", qty: none, notes: "" },
];

type Options = { proposers?: "sync" | "async"; hours?: number; rows?: ValueTypeOf<typeof PlanRowType>[] };

/** The sheet the way an author declares it: derive · history · sequence · default fills, a pattern proposer, an async model. */
function buildCopilotSheet(opts: Options = {}): SheetRootValue {
    const program = East.function([], Sheet.Types.Root, ($) => {
        const rows = $.const(opts.rows ?? ROWS, ArrayType(PlanRowType));
        const activities = $.const(ACTIVITIES, ArrayType(ActivityType));
        const hours = $.const(opts.hours ?? 8.0);
        // derive — End = Start + the driver's days.
        const endFromStart = $.const(East.function([Ctx], DateFill, ($2, ctx) => {
            const noFill = $2.const(none, DateFill);
            return ctx.row.start.match({
                missing: () => noFill,
                invalid: () => noFill,
                value: (_$, value) => value.match({
                    none: () => noFill,
                    some: (_$, start) => ctx.driver.match({
                        none: () => noFill,
                        some: (_$, d) => East.value(some({ value: start.addDays(d.days), meta: East.str`+${d.days}d · ${d.name}` }), DateFill),
                    }),
                }),
            });
        }));
        // history — the last row above with this activity.
        const lastQuantity = $.const(East.function([Ctx], FloatFill, ($2, ctx) => {
            const noFill = $2.const(none, FloatFill);
            const similar = $2.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.activity.hasTag("value").and(() => ctx.row.activity.hasTag("value")).and(() => r.activity.unwrap("value").equal(ctx.row.activity.unwrap("value")))));
            return similar.length().equal(0n).ifElse(
                (_$) => noFill,
                ($3) => {
                    const r = $3.let(similar.get(similar.length().subtract(1n)));
                    return r.qty.match({
                        missing: () => noFill, invalid: () => noFill,
                        value: (_$, value) => value.match({ none: () => noFill, some: (_$, q) => East.value(some({ value: q, meta: East.str`like ${r.id.unwrap("value")}` }), FloatFill) }),
                    });
                });
        }));
        // default — `hours` at the driver's rate.
        const shiftQuantity = $.const(East.function([Ctx], FloatFill, ($2, ctx) => {
            const noFill = $2.const(none, FloatFill);
            return ctx.driver.match({
                none: (_$) => noFill,
                some: (_$, d) => East.value(some({ value: d.rate.multiply(hours), meta: East.str`${d.rate}/h × ${hours} h` }), FloatFill),
            });
        }));
        // sequence — a week after the nearest dated row above.
        const nextSlot = $.const(East.function([Ctx], DateFill, ($2, ctx) => {
            const noFill = $2.const(none, DateFill);
            const dated = $2.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.start.hasTag("value").and(() => r.start.unwrap("value").hasTag("some"))));
            return dated.length().equal(0n).ifElse(
                (_$) => noFill,
                ($3) => {
                    const last = $3.let(dated.get(dated.length().subtract(1n)));
                    return East.value(some({ value: last.start.unwrap("value").unwrap("some").addDays(7n), meta: East.str`week after ${last.id.unwrap("value")}` }), DateFill);
                });
        }));
        // A domain pattern — spraying follows routing.
        const followUps = $.const(East.function([Ctx], Proposals, ($2, ctx) => ctx.row.activity.hasTag("value").and(() => ctx.row.activity.unwrap("value").equal("Routing")).ifElse(
            ($3) => $3.const([{
                patch: Sheet.patch(PlanRowType, { activity: "Spraying", start: ctx.row.start.match({ value: (_$, value) => value, missing: () => none, invalid: () => none }), qty: ctx.row.qty.match({ value: (_$, value) => value, missing: () => none, invalid: () => none }), notes: "spray the routed panels" }),
                meta: "spraying follows routing",
            }], Proposals),
            (_$3) => East.value([], Proposals),
        )));
        // A model — an ASYNC proposer behind the platform function.
        const modelProposals = $.const(East.asyncFunction([Ctx], Proposals, (_$2, ctx) => recommend(ctx)));
        return Sheet.Payload(rows, {
            start: Sheet.column.date(PlanRowType, { header: "Start", fill: [nextSlot] }),
            end: Sheet.column.date(PlanRowType, { header: "End", base: "start", fill: [endFromStart] }),
            activity: Sheet.column.lookup(PlanRowType, { header: "Activity" }),
            qty: Sheet.column.quantity(PlanRowType, ActivityType, { header: "Qty", uom: (d) => d.uom, fill: [lastQuantity, shiftQuantity] }),
            notes: Sheet.column.text(PlanRowType, { header: "Notes" }),
        }, {
            id: "id",
            driver: Sheet.driver("activity", activities, { key: (a) => a.name, label: (a) => a.name }),
            suggest: { ahead: 2n, triggers: ["activity", "start", "qty", "notes"], propose: opts.proposers === "async" ? [modelProposals] : [followUps] },
            blanks: 3,
            footer: [{ text: "1 planned" }],
        });
    });
    return East.compile(program, getRegisteredPlatformImplementations())();
}

/** Swap the host callbacks for spies after compilation. */
function withSpies(root: SheetRootValue) {
    const journal = sheetJournal(root);
    return { value: journal.value, edits: journal.events, draft: journal.draft };
}

/** Mounts the sheet — as `Sheet.View`, or with `hidden` its grid alone, under a host that hides those columns (#1186). */
function mount(value: SheetRootValue, hidden?: ReadonlySet<string>) {
    const ui = (v: SheetRootValue) => (
        <ChakraProvider value={system}>
            {hidden === undefined
                ? <EastChakraSheet value={v} storageKey="sheet-copilot-test" />
                : <SheetProvider value={v} storageKey="sheet-copilot-test" host={{ hidden }}><SheetRoot><SheetGrid /></SheetRoot></SheetProvider>}
        </ChakraProvider>
    );
    const utils = render(ui(value));
    const card = utils.container.querySelector("[data-sheet-card]") as HTMLElement;
    const rows = () => [...utils.container.querySelectorAll('[data-slot="row"]:not([data-proposed])')] as HTMLElement[];
    const cell = (r: number, key: string) => rows()[r]!.querySelector(`[data-slot="cell"][data-key="${key}"]`) as HTMLElement;
    const input = () => utils.container.querySelector('[data-slot="editorInput"]') as HTMLInputElement | null;
    const key = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(card, { key: k, ...init });
    const editorKey = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(input()!, { key: k, ...init });
    const type = (text: string) => fireEvent.change(input()!, { target: { value: text } });
    /** Let the copilot's timers and the microtask chains behind a settlement run. */
    const settle = async (ms = 10) => {
        await act(async () => {
            for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(ms);
        });
    };
    const proposals = () => [...utils.container.querySelectorAll('[data-slot="row"][data-proposed]')] as HTMLElement[];
    const stripChips = () => [...utils.container.querySelectorAll('[data-slot="stripChip"]')].map((c) => c.textContent);
    const message = () => utils.container.querySelector('[data-slot="footerMessage"]')!.textContent;
    const rerender = (v: SheetRootValue) => utils.rerender(ui(v));
    return { ...utils, card, rows, cell, input, key, editorKey, type, settle, proposals, stripChips, message, rerender };
}

const source = (e: PatchEvent) => e.origin.type;

test.each(["fillRow", "accept"] as const)("footer activity selection then %s persists without crypto.randomUUID", async action => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    try {
        const { value, edits, draft } = withSpies(buildCopilotSheet());
        const { container, cell, key, type, input, settle, proposals } = mount(value);
        key("R");
        type("Rout");
        await settle(100);
        fireEvent.mouseDown(container.querySelector('[data-slot="stripChip"]')!, { button: 0 });
        await settle(100);
        expect(input()!.value).toBe("Routing");
        expect(proposals()).toHaveLength(1);
        fireEvent.mouseDown(container.querySelector(`[data-slot="${action}"]`)!, { button: 0 });
        await settle();
        expect(input()).toBeNull();
        expect(cell(1, "activity").textContent).toBe("Routing");
        expect(cell(1, "qty").hasAttribute("data-proposed")).toBe(false);
        expect(edits).toHaveLength(1);
        expect(edits[0]!.draftChanges).toHaveLength(action === "accept" ? 2 : 1);
        const entry = draft(edits[0]!.draftChanges[0]!.id, Sheet.Types.Draft(PlanRowType));
        expect(entry.activity).toEqual(variant("value", "Routing"));
        expect(entry.qty).toEqual(variant("value", some(1200)));
        if (action === "accept") expect(cell(2, "activity").textContent).toBe("Spraying");
        fireEvent.mouseDown(cell(0, "notes"), { button: 0 });
        await settle();
        expect(cell(1, "activity").textContent).toBe("Routing");
        key("z", { ctrlKey: true });
        await settle();
        expect(container.querySelectorAll('[data-row-id]')).toHaveLength(1);
        key("z", { ctrlKey: true, shiftKey: true });
        await settle();
        expect(cell(1, "activity").textContent).toBe("Routing");
        if (action === "accept") expect(cell(2, "activity").textContent).toBe("Spraying");
        expect(edits.map(event => event.origin.type)).toEqual([action === "accept" ? "pattern" : "row", "undo", "redo"]);
    } finally { vi.unstubAllGlobals(); }
});

describe("fills (B§5.1)", () => {
    test("clicking the row-fill button commits its open activity editor and fills one row in one patch", async () => {
        const { value, edits, draft } = withSpies(buildCopilotSheet());
        const { container, cell, key, type, input, settle } = mount(value);
        key("R");
        type("Routing");
        await settle(100);
        fireEvent.mouseDown(container.querySelector('[data-slot="fillRow"]')!, { button: 0 });
        await settle();
        expect(input()).toBeNull();
        expect(cell(1, "activity").textContent).toBe("Routing");
        expect(cell(1, "start").hasAttribute("data-proposed")).toBe(false);
        expect(cell(1, "qty").hasAttribute("data-proposed")).toBe(false);
        expect(edits).toHaveLength(1);
        expect(edits[0]!.draftChanges).toHaveLength(1);
        const entry = draft(edits[0]!.draftChanges[0]!.id, Sheet.Types.Draft(PlanRowType));
        expect(entry.activity).toEqual(variant("value", "Routing"));
        expect(entry.qty).toEqual(variant("value", some(1200)));
        fireEvent.mouseDown(cell(0, "notes"), { button: 0 });
        await settle();
        expect(cell(1, "activity").textContent).toBe("Routing");
        expect(edits).toHaveLength(1);
    });

    test("typing an activity on the blank row fills the rest in grey after the latency — one next target, the strip reads suggested; ⇥ arms then takes with the fill provenance; a taken start derives the end", async () => {
        const { value, edits, draft } = withSpies(buildCopilotSheet());
        const { container, cell, key, type, editorKey, settle, stripChips } = mount(value);
        // The ring opens on the blank row's Activity column.
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        // The new real row: Start ← a week after j1, End ← the predicted Start + 4 d (fills chain), Qty ← like j1.
        expect(cell(1, "start").hasAttribute("data-proposed")).toBe(true);
        expect(cell(1, "start").textContent).toBe("23 Feb 26");
        expect(cell(1, "end").hasAttribute("data-proposed")).toBe(true);
        expect(cell(1, "end").textContent).toBe("27 Feb 26");
        expect(cell(1, "qty").hasAttribute("data-proposed")).toBe(true);
        expect(cell(1, "qty").textContent).toBe("1,200pcs");
        expect(container.querySelectorAll('[data-slot="nextTarget"]')).toHaveLength(1);
        expect(cell(1, "start").hasAttribute("data-next-target")).toBe(true);
        expect(container.querySelector('[data-slot="stripLabel"]')!.textContent).toBe("suggested");
        expect(stripChips()).toEqual(["Start", "End", "Qty", "+1 row"]);   // the pattern proposer offers a spraying row too
        expect(container.querySelector('[data-slot="stripChip"][data-armed]')!.textContent).toBe("Start");
        expect(container.querySelector('[data-slot="stripMeta"]')!.textContent).toBe("week after j1");
        expect(container.querySelector('[data-slot="footerHint"]')!.textContent).toMatch(/⇥ walks the fills/);
        expect(container.querySelector('[data-slot="row"][data-anchor] [data-slot="fillRow"]')).toBeTruthy();
        // ⇥ arms the target: the ring lands on it, nothing is written yet.
        key("Tab");
        expect(cell(1, "start").hasAttribute("data-selected")).toBe(true);
        expect(edits).toHaveLength(1);
        // ⇥ again writes it — a `fill` commit — and the copilot re-runs over the real Start: End still derives, now the next target.
        key("Tab");
        await settle();
        expect(edits).toHaveLength(2);
        expect(draft(edits[1]!.draftChanges[0]!.id, Sheet.Types.Draft(PlanRowType)).start).toEqual(variant("value", some(new Date("2026-02-23T00:00:00Z"))));
        expect(source(edits[1]!)).toBe("fill");
        expect(cell(1, "start").hasAttribute("data-proposed")).toBe(false);
        expect(cell(1, "start").textContent).toBe("23 Feb 26");
        expect(cell(1, "end").hasAttribute("data-proposed")).toBe(true);
        expect(cell(1, "end").textContent).toBe("27 Feb 26");
        expect(cell(1, "end").hasAttribute("data-next-target")).toBe(true);
        expect(container.querySelector('[data-slot="footerMessage"]')!.textContent).toBe("Took start — week after j1");
        // The ✓ take button shows on hover and takes that fill.
        fireEvent.mouseEnter(cell(1, "qty"));
        const take = cell(1, "qty").querySelector('[data-slot="take"]')!;
        expect(take).toBeTruthy();
        fireEvent.mouseDown(take, { button: 0 });
        await settle();
        expect(draft(edits.at(-1)!.draftChanges[0]!.id, Sheet.Types.Draft(PlanRowType)).qty).toEqual(variant("value", some(1200)));
        expect(source(edits.at(-1)!)).toBe("fill");
        expect(cell(1, "qty").textContent).toBe("1,200pcs");
    });

    test("⌘⏎ fills the whole row in one step with the `row` provenance; ⌫ on the armed target dismisses just that fill; esc dismisses the rest", async () => {
        const { value, edits, draft } = withSpies(buildCopilotSheet());
        const { container, cell, key, type, editorKey, settle } = mount(value);
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        // Dismiss Start: ⇥ arms it, ⌫ rejects it and remembers.
        key("Tab");
        key("Backspace");
        expect(cell(1, "start").hasAttribute("data-proposed")).toBe(false);
        expect(container.querySelector('[data-slot="footerMessage"]')!.textContent).toBe("Dismissed — start will not be suggested again on this row");
        // A re-run does not bring it back.
        fireEvent.mouseDown(cell(1, "notes"), { button: 0 });
        key("n");
        type("note");
        editorKey("Enter");
        await settle();
        expect(cell(1, "start").hasAttribute("data-proposed")).toBe(false);
        expect(cell(1, "qty").hasAttribute("data-proposed")).toBe(true);
        // ⌘⏎ takes what is left in one step.
        key("Enter", { metaKey: true });
        await settle();
        const rowFills = edits.filter((e) => source(e) === "row");
        expect(rowFills).toHaveLength(1);
        expect(draft(rowFills[0]!.draftChanges[0]!.id, Sheet.Types.Draft(PlanRowType)).qty).toEqual(variant("value", some(1200)));
        expect(cell(1, "qty").hasAttribute("data-proposed")).toBe(false);
        expect(cell(1, "qty").textContent).toBe("1,200pcs");
    });

    test("the gutter's → button fills the row; a read-only sheet runs no copilot", async () => {
        const { value, edits, draft } = withSpies(buildCopilotSheet());
        const { container, key, type, editorKey, settle } = mount(value);
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        fireEvent.mouseDown(container.querySelector('[data-slot="fillRow"]')!, { button: 0 });
        await settle();
        const fills = edits.filter((e) => source(e) === "row");
        expect(fills).toHaveLength(1);
        const filled = draft(fills[0]!.draftChanges[0]!.id, Sheet.Types.Draft(PlanRowType));
        expect(filled.start.type).toBe("value");
        expect(filled.end.type).toBe("value");
        expect(filled.qty).toEqual(variant("value", some(1200)));
        expect(container.querySelector('[data-slot="footerMessage"]')!.textContent).toBe("Filled 3 cells on row 2");
        // Nothing left to fill on the row (the proposal row's cells are hatched, not fills).
        expect(container.querySelectorAll('[data-slot="row"]:not([data-proposed]) [data-slot="cell"][data-proposed]')).toHaveLength(0);
        cleanup();
        const ro = mount({ ...buildCopilotSheet(), readOnly: some(true) } as SheetRootValue);
        expect(ro.container.querySelector("[data-sheet][data-copilot]")).toBeNull();
    });
});

describe("proposals (B§5.2)", () => {
    test("a proposed row sits under its anchor with a real number; ✓ inserts it as a `pattern` edit and re-anchors; × rejects it and the pairing is not offered again", async () => {
        const { value, edits, draft } = withSpies(buildCopilotSheet());
        const { container, cell, key, type, editorKey, settle, proposals, stripChips, message } = mount(value);
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        expect(proposals()).toHaveLength(1);
        const p = proposals()[0]!;
        expect(p.querySelector('[data-slot="gutter"]')!.textContent).toBe("3");
        expect(p.querySelector('[data-key="activity"]')!.textContent).toBe("Spraying");
        expect(p.querySelector('[data-key="notes"]')!.textContent).toBe("spray the routed panels");
        expect(p.querySelectorAll('[data-slot="hatch"]').length).toBeGreaterThan(0);
        expect(stripChips()).toEqual(["Start", "End", "Qty", "+1 row"]);
        // A click selects it (the bar, the wash); ⏎ takes the row fill first, then the row.
        fireEvent.mouseDown(p.querySelector('[data-key="activity"]')!, { button: 0 });
        expect(proposals()[0]!.hasAttribute("data-picked")).toBe(true);
        expect(container.querySelector('[data-slot="footerHint"]')!.textContent).toMatch(/⏎ adds the selected row/);
        fireEvent.mouseDown(proposals()[0]!.querySelector('[data-slot="accept"]')!, { button: 0 });
        await settle();
        expect(proposals()).toHaveLength(0);
        expect(cell(2, "activity").textContent).toBe("Spraying");
        expect(cell(2, "notes").textContent).toBe("spray the routed panels");
        const inserted = edits.filter((e) => e.draftChanges.some(change => change.place.type === "some"));
        expect(inserted).toHaveLength(2);   // the typed row, then the proposal
        expect(source(inserted[1]!)).toBe("pattern");
        expect(draft(inserted[1]!.draftChanges.find(change => change.place.type === "some")!.id, Sheet.Types.Draft(PlanRowType)).activity).toEqual(variant("value", "Spraying"));
        expect(message()).toBe("Took Spraying");
        // The proposal carried the anchor's predicted Start and Qty; re-anchored on the taken row, its End derives.
        expect(cell(2, "start").textContent).toBe("23 Feb 26");
        expect(cell(2, "qty").textContent).toBe("1,200pcs");
        expect(cell(2, "end").hasAttribute("data-proposed")).toBe(true);
        expect(cell(2, "end").textContent).toBe("27 Feb 26");
        // Reject on another Routing: the pairing is remembered.
        fireEvent.mouseDown(cell(3, "activity"), { button: 0 });
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        expect(proposals()).toHaveLength(1);
        fireEvent.mouseDown(proposals()[0]!.querySelector('[data-slot="reject"]')!, { button: 0 });
        expect(proposals()).toHaveLength(0);
        expect(message()).toBe("Rejected — Spraying will not be suggested after Routing again");
        fireEvent.mouseDown(cell(4, "activity"), { button: 0 });
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        expect(proposals()).toHaveLength(0);
    });
});

describe("a column the host hides (#1186)", () => {
    test("a proposed row keeps its cells under a hidden column: the grid never draws the column, and the row taken carries them", async () => {
        const { value, edits, draft } = withSpies(buildCopilotSheet());
        const { container, key, type, editorKey, settle, proposals } = mount(value, new Set(["notes"]));
        expect([...container.querySelectorAll('[data-slot="headerCell"]')].map((c) => c.getAttribute("data-key"))).toEqual(["start", "end", "activity", "qty"]);
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        expect(proposals()).toHaveLength(1);
        expect(proposals()[0]!.querySelector('[data-key="activity"]')!.textContent).toBe("Spraying");
        expect(proposals()[0]!.querySelector('[data-key="notes"]')).toBeNull();
        fireEvent.mouseDown(proposals()[0]!.querySelector('[data-slot="accept"]')!, { button: 0 });
        await settle();
        const inserted = edits.filter((e) => e.origin.type === "pattern");
        expect(inserted).toHaveLength(1);
        const taken = draft(inserted[0]!.draftChanges.find((change) => change.place.type === "some")!.id, Sheet.Types.Draft(PlanRowType));
        expect(taken.activity).toEqual(variant("value", "Spraying"));
        expect(taken.notes).toEqual(variant("value", "spray the routed panels"));
    });
});

describe("async providers (§5 row 11)", () => {
    test("an async proposer shows a pending chip and lands reactively; a newer context cancels the wait — the older settlement never lands", async () => {
        const { value } = withSpies(buildCopilotSheet({ proposers: "async" }));
        const { container, cell, key, type, editorKey, settle, proposals, stripChips } = mount(value);
        calls.length = 0;
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        expect(calls).toHaveLength(1);
        expect(container.querySelector('[data-slot="stripChip"][data-pending]')!.textContent).toBe("rows ⋯");
        expect(proposals()).toHaveLength(0);
        // A newer context: a trigger column commits on the anchor before the model answers.
        fireEvent.mouseDown(cell(1, "qty"), { button: 0 });
        key("1");
        type("1000");
        editorKey("Enter");
        await settle();
        expect(calls).toHaveLength(2);
        // The first call settles late — dropped; the second lands.
        calls[0]!.resolve(modelRow("Wrapping"));
        await settle();
        expect(proposals()).toHaveLength(0);
        calls[1]!.resolve(modelRow("Spraying"));
        await settle();
        expect(proposals()).toHaveLength(1);
        expect(proposals()[0]!.querySelector('[data-key="activity"]')!.textContent).toBe("Spraying");
        expect(proposals()[0]!.querySelector('[data-key="notes"]')!.textContent).toBe("from the model");
        expect(stripChips()).not.toContain("rows ⋯");
    });

    test("a rejected model call is skipped with a diagnostic and the pending chip clears", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const { value } = withSpies(buildCopilotSheet({ proposers: "async" }));
        const { container, key, type, editorKey, settle, proposals } = mount(value);
        calls.length = 0;
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        calls[0]!.reject(new Error("model down"));
        await settle();
        expect(container.querySelector('[data-slot="stripChip"][data-pending]')).toBeNull();
        expect(proposals()).toHaveLength(0);
        expect(error).toHaveBeenCalledWith(expect.stringContaining("proposer #1"), expect.any(Error));
        error.mockRestore();
    });
});

describe("a swapped provider (§6.2, #809)", () => {
    test("a closure-only change swaps the provider the next trigger runs, and keeps the local edits", async () => {
        // The same data twice; only closures differ (the default fill's
        // captured `hours`, the spy). The memo sees them (`equivalentFor`); the
        // local layer, keyed on the value's DATA, does not reset.
        const eight = withSpies(buildCopilotSheet({ rows: ROWS_WITH_WRAPPING, hours: 8.0 }));
        const two = withSpies(buildCopilotSheet({ rows: ROWS_WITH_WRAPPING, hours: 2.0 }));
        const { cell, key, type, editorKey, settle, rerender } = mount(eight.value);
        // j2 (Wrapping, no history): the default fill is eight hours at 120/h.
        fireEvent.mouseDown(cell(1, "notes"), { button: 0 });
        key("x");
        type("x");
        editorKey("Enter");
        await settle();
        expect(cell(1, "qty").textContent).toBe("960cartons");
        // The patch channel stays the same spy, so only the fill provider's
        // closure differs between the two values.
        rerender({ ...two.value, editing: { ...two.value.editing, onPatch: eight.value.editing.onPatch } });
        expect(cell(1, "notes").textContent).toBe("x");
        fireEvent.mouseDown(cell(1, "notes"), { button: 0 });
        key("y");
        type("y");
        editorKey("Enter");
        await settle();
        expect(cell(1, "qty").textContent).toBe("240cartons");
    });
});

// ── A folded gutter (#1215) ───────────────────────────────────────────────

describe("a folded gutter (#1215)", () => {
    // A phone's sheet: a coarse pointer, and a frame too narrow for the touch gutter beside the first column.
    let restoreFrame: () => void = () => {};
    beforeEach(() => { restoreFrame = touchFrame(300); });
    afterEach(() => { restoreFrame(); });

    const draftEqual = equalFor(Sheet.Types.Draft(PlanRowType));
    /** A row's row-actions button. */
    const actionsOf = (row: HTMLElement) => row.querySelector<HTMLElement>('[data-slot="rowActions"]')!;
    /** Taps a row's row-actions button: its menu opens, and a frame passes — the menu takes the focus in it, as it does before any pick. */
    const openActions = async (row: HTMLElement) => {
        await act(async () => { fireEvent.click(actionsOf(row)); });
        await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    };
    /** The open menu's items, as they read. */
    const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    /** Picks an item of the open menu as a pointer does: pressed on it, then its click. */
    const pick = async (name: string) => {
        const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent === name);
        if (item === undefined) throw new Error(`no menu item ${name}`);
        await act(async () => { fireEvent.pointerDown(item); });
        await act(async () => { fireEvent.click(item); });
    };

    test("the anchor's menu fills the row, as its → does — one `row` patch, the grid keeping the focus — and Undo takes it back", async () => {
        const { value, edits, draft } = withSpies(buildCopilotSheet());
        const { container, card, key, type, editorKey, settle } = mount(value);
        expect(card.getAttribute("data-gutter")).toBe("folded");
        expect(card.style.getPropertyValue("--sheet-gutter")).toBe("108px");
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        // No → in a folded gutter: the anchor's fill heads its menu, its discard and the inserts after it.
        expect(container.querySelector('[data-slot="fillRow"]')).toBeNull();
        const anchor = container.querySelector<HTMLElement>('[data-slot="row"][data-anchor]')!;
        await openActions(anchor);
        expect(menuItems()).toEqual(["Fill this row", "Discard new row", "Insert above", "Insert below"]);
        const id = anchor.getAttribute("data-row-id")!;
        const typed = draft(id, Sheet.Types.Draft(PlanRowType));
        await pick("Fill this row");
        await settle();
        expect(edits.filter((e) => source(e) === "row")).toHaveLength(1);
        expect(draft(id, Sheet.Types.Draft(PlanRowType)).qty).toEqual(variant("value", some(1200)));
        expect(container.querySelector('[data-slot="footerMessage"]')!.textContent).toBe("Filled 3 cells on row 2");
        expect(document.activeElement).toBe(card);
        key("z", { ctrlKey: true });
        await settle();
        expect(source(edits.at(-1)!)).toBe("undo");
        expect(draftEqual(draft(id, Sheet.Types.Draft(PlanRowType)), typed)).toBe(true);
    });

    test("a suggestion's menu is its ✓ and ×: adding it is a `pattern` insert Undo takes back; rejecting it remembers the pairing", async () => {
        const { value, edits } = withSpies(buildCopilotSheet());
        const { container, cell, key, type, editorKey, settle, proposals, message } = mount(value);
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        expect(proposals()).toHaveLength(1);
        expect(proposals()[0]!.querySelector('[data-slot="accept"]')).toBeNull();
        await openActions(proposals()[0]!);
        expect(menuItems()).toEqual(["Add this suggested row", "Reject this suggestion"]);
        await pick("Add this suggested row");
        await settle();
        expect(proposals()).toHaveLength(0);
        expect(cell(2, "activity").textContent).toBe("Spraying");
        expect(edits.filter((e) => source(e) === "pattern")).toHaveLength(1);
        expect(message()).toBe("Took Spraying");
        key("z", { ctrlKey: true });
        await settle();
        expect(source(edits.at(-1)!)).toBe("undo");
        expect(container.querySelectorAll('[data-slot="row"][data-row-id]:not([data-proposed])')).toHaveLength(2);
        // Another Routing: its suggestion rejected from the menu, and not offered again.
        fireEvent.mouseDown(cell(2, "activity"), { button: 0 });
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        expect(proposals()).toHaveLength(1);
        await openActions(proposals()[0]!);
        await pick("Reject this suggestion");
        expect(proposals()).toHaveLength(0);
        expect(message()).toBe("Rejected — Spraying will not be suggested after Routing again");
        fireEvent.mouseDown(cell(3, "activity"), { button: 0 });
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        expect(proposals()).toHaveLength(0);
    });
});

// ── Grouped rows (#740, G11) ──────────────────────────────────────────────

const LineType = StructType({ activity: StringType, qty: OptionType(FloatType), notes: StringType });
const PlanType = StructType({ id: StringType, name: StringType, lines: ArrayType(LineType) });
const GroupCtx = Sheet.Types.DraftContext(PlanType, "lines");
const LineProposals = ArrayType(Sheet.Types.Proposal(LineType));
const NotesFill = OptionType(Sheet.Types.Fill(StringType));
const PLANS = [
    { id: "p1", name: "Bay 2 week 8", lines: [{ activity: "Routing", qty: some(120.0), notes: "first" }] },
    { id: "p2", name: "Bay 3 week 8", lines: [] },
];

/** A grouped sheet whose fill reads the plan and whose proposer follows routing with spraying — both over `Sheet.Types.DraftContext(PlanType, "lines")`. */
function buildGroupedCopilot(): SheetRootValue {
    const program = East.function([], Sheet.Types.Root, ($) => {
        const plans = $.const(PLANS, ArrayType(PlanType));
        const inPlan = $.const(East.function([GroupCtx], NotesFill, (_$2, ctx) =>
            East.value(some({ value: East.str`${ctx.group.unwrap("some").name.unwrap("value")} · line ${ctx.rowIndex.add(1n)} of ${ctx.rows.length()} · ${ctx.groups.length()} plans`, meta: "the plan" }), NotesFill)));
        const followUps = $.const(East.function([GroupCtx], LineProposals, ($2, ctx) => ctx.row.activity.hasTag("value").and(() => ctx.row.activity.unwrap("value").equal("Routing")).ifElse(
            ($3) => $3.const([{ patch: Sheet.patch(LineType, { activity: "Spraying", notes: "spray the routed panels" }), meta: "spraying follows routing" }], LineProposals),
            (_$3) => East.value([], LineProposals),
        )));
        return Sheet.Payload(plans, {
            activity: Sheet.column.text(LineType, { header: "Activity" }),
            qty: Sheet.column.quantity(LineType, { header: "Qty" }),
            notes: Sheet.column.text(LineType, { header: "Notes", fill: [inPlan] }),
        }, {
            id: "id",
            group: Sheet.group(PlanType, "lines", { title: "name" }),
            suggest: { ahead: 1n, triggers: ["activity", "qty"], propose: [followUps] },
        });
    });
    return East.compile(program, getRegisteredPlatformImplementations())();
}

describe("the copilot on grouped rows (#740, G11)", () => {
    test("a line's providers see its plan — its lines, the plan, the resident plans; the row fill names the line within its plan; a taken proposal lands in the anchor's plan", async () => {
        const { value, edits, draft } = withSpies(buildGroupedCopilot());
        const { container, key, type, editorKey, settle, proposals, message } = mount(value);
        const lines = (id: string) => [...container.querySelectorAll(`[data-slot="row"][data-group-id="${id}"]`)] as HTMLElement[];
        // The ring opens on the first plan's blank line.
        key("R");
        type("Routing");
        editorKey("Enter");
        await settle();
        expect(edits).toHaveLength(1);
        expect(draft("p1", Sheet.Types.DraftGroup(PlanType, "lines")).lines).toHaveLength(2);
        const created = lines("p1")[1]!;
        expect(created.querySelector('[data-key="notes"]')!.hasAttribute("data-proposed")).toBe(true);
        expect(created.querySelector('[data-key="notes"] > span:not([id])')!.textContent).toBe("Bay 2 week 8 · line 2 of 2 · 2 plans");
        // The proposed line sits under its anchor with aligned columns and no enclosing group border.
        expect(proposals()).toHaveLength(1);
        expect(proposals()[0]!.querySelector('[data-slot="gutterNumber"]')!.textContent).toBe("3");
        expect(proposals()[0]!.querySelector('[data-slot="edge"]')).toBeNull();
        // The gutter's → fills the line.
        fireEvent.mouseDown(created.querySelector('[data-slot="fillRow"]')!, { button: 0 });
        await settle();
        expect(message()).toBe("Filled 1 cell on line 2 of Bay 2 week 8");
        expect(edits.at(-1)!.draftChanges.map(change => change.id)).toEqual(["p1"]);
        expect(source(edits.at(-1)!)).toBe("row");
        // ✓ takes the proposal: a `pattern` insert into p1, never p2.
        fireEvent.mouseDown(proposals()[0]!.querySelector('[data-slot="accept"]')!, { button: 0 });
        await settle();
        const inserted = edits.filter((e) => e.origin.type === "pattern");
        expect(inserted).toHaveLength(1);
        expect(inserted[0]!.draftChanges.map(change => change.id)).toEqual(["p1"]);
        expect(draft("p1", Sheet.Types.DraftGroup(PlanType, "lines")).lines).toHaveLength(3);
        expect(lines("p1").map((r) => r.querySelector('[data-key="activity"]')!.textContent)).toEqual(["Routing", "Routing", "Spraying", ""]);
        expect(lines("p2").map((r) => r.querySelector('[data-key="activity"]')!.textContent)).toEqual([""]);
    });
});
