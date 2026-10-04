/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Query.Builder>`'s surfaces (#936, `Query Editor Spec.md` §7 B1–B8, U1,
 * U2), rendered through its carrier over a saved queries record in memory —
 * the shared fixture's default query among them — with a one-shot call that
 * never reaches a server:
 *
 * - **B1–B8**: the one toolbar and its fold; the pane, its tabs and its rail;
 *   the Query tab's parts — the source, the step cards and their rows, the
 *   shape lines, the foot; the slots' and the cards' states; the status line;
 *   the save popover and its description; no border.
 * - **U1**: a condition built by clicks, each pick opening the next slot; the
 *   autocomplete's keys, and ⌘⏎ running; a fix; the history over a pick.
 * - **U2**: Visual · jq and back — its notes and notices, a syntax error
 *   keeping jq; Copy jq and Run; saving — an update, a rename, a taken name,
 *   a stale entry's refusal at its commit and before it, and a new query
 *   named on its Apply; the steps while a save goes, which are the drafts it
 *   saves, never the query as it stood before them.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { East, JqType, PatchType, checkJq, encodeBeast2For, equalFor, none, some, variant } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { Query } from "@elaraai/e3-ui/internal";
import {
    RECORD, ROOT, WORKSPACE, commits as committed, mountBuilder, offlineCall, openQuery, press, readRecord as recordOf, recordHarness, savedQuery,
    savedRecord, settle, type RecordHarness,
} from "./query.test-utils.js";

/** The shared fixture's default query (`Query Editor Spec.md` §4.7). */
const DEFAULT_PROGRAM = [
    ".customers as $customers",
    ".orders",
    "map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
    "map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
    "map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
    "sort_by(-.total)",
    ".[:10]",
].join("\n| ");
const TOP = savedQuery("Top shipped orders, 2026", DEFAULT_PROGRAM);
const BIG = savedQuery("Big orders", ".orders | map(select(.total >= 1000))");
const COUNT = savedQuery("Order count", ".orders | length");
const programEqual = equalFor(JqType);
const savedEqual = equalFor(Query.Types.SavedQuery);

let harness: RecordHarness;

beforeEach(() => {
    harness = recordHarness(savedRecord([TOP, BIG, COUNT]));
});
afterEach(() => {
    cleanup();
    localStorage.clear();
});

// ─── What the builder shows ──────────────────────────────────────────────────

/** The builder's element. */
const builderOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-query-builder]")!;
/** The step cards, in order. */
const cardsOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-step-id]")];
/** A card's title. */
const titleOf = (card: HTMLElement) => card.getAttribute("aria-label");
/** A row's parts, as words: a slot's or a chip's text, an input's value, an icon button's name, a word as written. */
function partsOf(row: HTMLElement): string[] {
    return [...row.children].map((el) => {
        if (el instanceof HTMLInputElement) return `[${el.value}]`;
        if (el.getAttribute("aria-haspopup") === "listbox") return `<${el.querySelector("span")!.textContent}>`;
        if (el.tagName === "BUTTON" && el.textContent === "") return `(${el.getAttribute("aria-label")})`;
        return el.textContent ?? "";
    });
}
/** A card's rows, each as its parts. */
const rowsOf = (card: HTMLElement) => [...card.querySelectorAll<HTMLElement>("[data-query-line=row]")].map(partsOf);
/** The shape lines' words, in order. */
const shapesOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-query-shape-text]")].map((el) => el.textContent);
/** The open autocomplete. */
const popover = () => document.querySelector<HTMLElement>("[data-query-autocomplete]");
/** Its offers' labels, in order. */
const offers = () => [...popover()!.querySelectorAll<HTMLElement>("[role=option]")].map((o) => o.querySelector("[data-label]")!.textContent);
/** Its active offer's label. */
const activeOffer = () => popover()!.querySelector<HTMLElement>("[role=option][aria-selected=true] [data-label]")?.textContent;
/** Its label. */
const popoverLabel = () => popover()!.querySelector("label")!.textContent;
/** Its filter field. */
const filterOf = () => within(popover()!).getByRole("combobox");

/** Opens a slot by the words it shows, in a card. */
async function openSlot(card: HTMLElement, text: string) {
    const slot = [...card.querySelectorAll<HTMLElement>("[aria-haspopup=listbox]")].find((el) => el.querySelector("span")!.textContent === text);
    if (slot === undefined) throw new Error(`no slot “${text}”`);
    await act(async () => { fireEvent.click(slot); });
    await settle();
}

/** Picks an offer of the open autocomplete by its label, as a click does. */
async function pick(label: string) {
    const option = [...popover()!.querySelectorAll<HTMLElement>("[role=option]")].find((o) => o.querySelector("[data-label]")!.textContent === label);
    if (option === undefined) throw new Error(`no offer “${label}”: ${offers().join(", ")}`);
    await act(async () => { fireEvent.click(option); });
    await settle();
}

/** Presses a key in the autocomplete's filter. */
async function key(name: string, init: Record<string, unknown> = {}) {
    await act(async () => { fireEvent.keyDown(filterOf(), { key: name, ...init }); });
    await settle();
}

/** Quick add: a step at the end of the query. */
async function quickAdd(label: string) {
    await press(label, document.querySelector<HTMLElement>("[data-query-foot]")!);
}

/** The status line's words: the check, its tone, the shape, the fields; the save state, its tone, the name. */
function statusOf(container: HTMLElement) {
    const status = container.querySelector<HTMLElement>("[data-query-status]")!;
    const check = status.querySelector<HTMLElement>("[data-query-check]")!;
    const save = status.querySelector<HTMLElement>("[data-query-save]")!;
    return {
        check: [check.getAttribute("data-query-check"), check.firstElementChild!.textContent],
        gives: status.querySelector("[data-query-gives]")?.textContent,
        save: [save.getAttribute("data-query-save"), save.firstElementChild!.textContent, save.querySelector("[data-query-name]")!.textContent],
    };
}

/** A saved query's program, as the record holds it. */
const savedProgramOf = (name: string) => recordOf(harness).get(name)!.program;

/** The pane's rail, while it is collapsed: its icon, its badge and its name. */
const railOf = (container: HTMLElement) => builderOf(container).querySelector<HTMLElement>("[data-collapsed] [title=Query]")!;

/** Waits for the save popover to close. */
const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

/** The save popover's Save. */
const saveIn = () => within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }) as HTMLButtonElement;

/** The view strip's buttons, by name. */
const viewButton = (name: "Visual" | "jq") => within(screen.getByRole("group", { name: "View" })).getByRole("button", { name });

// ─── B1–B8 ───────────────────────────────────────────────────────────────────

describe("<Query.Builder> — the toolbar, the pane, the Query tab and the status line (#936)", () => {
    test("B1: the one toolbar — the history item, Copy jq, Save… and Run with its keys at its end; Visual · jq in the Query tab's band; Table · Tree and Download ▾ in the results'", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", TOP.name));
        const items = [...builderOf(container).querySelector<HTMLElement>("[data-frame-slot=toolbar]")!.querySelectorAll<HTMLElement>("[data-toolbar-item]")];
        expect(items.map((el) => [el.getAttribute("data-toolbar-item"), el.hasAttribute("data-toolbar-end")])).toEqual([
            ["history", true], ["copy", false], ["save", false], ["run", false],
        ]);
        // The result's controls head the results, in a band as tall as the pane's tab row.
        const results = container.querySelector<HTMLElement>("[data-query-results] [data-query-results-bar]")!;
        expect([results.getAttribute("role"), [...results.querySelectorAll("[data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"))])
            .toEqual(["toolbar", ["result-view", "download"]]);
        // Visual · jq heads the Query tab's body, in the band a Library holds its search box in.
        const band = container.querySelector<HTMLElement>("[data-query-tab=query] > [data-query-tab-bar]")!;
        expect([band.parentElement!.firstElementChild === band, [...band.querySelectorAll("[data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"))])
            .toEqual([true, ["view"]]);
        expect([viewButton("Visual").getAttribute("aria-pressed"), viewButton("jq").getAttribute("aria-pressed")]).toEqual(["true", "false"]);
        expect(screen.getByRole("button", { name: "Copy jq" }).textContent).toBe("Copy jq");
        expect(container.querySelector("[data-query-save-open]")!.textContent).toBe("Save…");
        const run = container.querySelector<HTMLElement>("[data-query-run]")!;
        expect([run.textContent, run.querySelector("kbd")?.textContent]).toEqual(["Run⌘⏎", "⌘⏎"]);
    }, 30_000);

    test("B2: the toolbar folds on one ladder — Run's keys, Copy jq to its icon, then the history item; the results' band, Download to its icon, then Table · Tree to its icons", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        expect(builderOf(container).querySelector("[data-frame-slot=toolbar] [data-toolbar]")!.getAttribute("data-toolbar-ladder")).toBe("run>1 copy>1 history>1");
        expect(container.querySelector("[data-query-results-bar] [data-toolbar]")!.getAttribute("data-toolbar-ladder")).toBe("download>1 result-view>1");
    }, 30_000);

    test("B3: the pane — Query, Datasets and Library; collapsed, its rail counts the steps; one width in either view", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", TOP.name));
        expect(screen.getAllByRole("tab").map((tab) => [tab.textContent, tab.getAttribute("aria-selected")])).toEqual([
            ["Query", "true"], ["Datasets", "false"], ["Library", "false"],
        ]);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Collapse Query" })); });
        await settle();
        expect(railOf(container).textContent).toBe("5Query");
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Expand Query" })); });
        await settle();
        // The pane keeps its width as Visual · jq switches: its size is its style, so its class stays.
        const width = () => builderOf(container).querySelector<HTMLElement>("[data-side=start][data-surface=shell]")!.className;
        const visual = width();
        await act(async () => { fireEvent.click(viewButton("jq")); });
        await settle();
        expect([container.querySelector("[data-query-tab=query]")!.getAttribute("data-mode"), width()]).toEqual(["jq", visual]);
    }, 30_000);

    test("B4: the Query tab over the default query — the source, five cards with their numbers, titles and rows, the shape lines, and the foot", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", TOP.name));
        const source = container.querySelector<HTMLElement>("[data-query-source]")!;
        expect(source.textContent).toBe("Start with ordersorders · list of orders");
        const cards = cardsOf(container);
        expect(cards.map((card) => [card.querySelector("span")!.textContent, titleOf(card)])).toEqual([
            ["1", "Keep rows where"], ["2", "Look up from another dataset"], ["3", "Show only these fields"], ["4", "Sort"], ["5", "Keep the first"],
        ]);
        expect(rowsOf(cards[0]!)).toEqual([
            ["", "<status>", "<is>", "<shipped>", "(Remove)"],
            ["and", "<total>", "<is at least>", "<100>", "(Remove)"],
            ["and", "<shipped date>", "<is in year>", "<2026>", "(Remove)"],
        ]);
        expect(rowsOf(cards[1]!)).toEqual([
            ["find", "<customer ID>", "in", "<customers>"],
            ["bring in", "name", "region", "Add field"],
        ]);
        expect(cards[1]!.querySelector("[data-query-line=note]")!.textContent).toBe("Left empty when a customer isn't found.");
        expect(rowsOf(cards[3]!)).toEqual([["by", "<total>", "<highest first>"]]);
        expect(rowsOf(cards[4]!)).toEqual([["[10]", "orders"]]);
        expect(shapesOf(container)).toEqual([
            "Many orders",
            "Many shipped orders",
            "Many shipped orders+ name, region",
            "Many ordersorder, customer, region, total, shipped",
            "Many orders",
            "Up to 10 orders",
        ]);
        const foot = container.querySelector<HTMLElement>("[data-query-foot]")!;
        expect([...foot.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
            "Add a step at the end", "Keep rows", "Group and total", "Sort by", "Keep the first", "Show only fields",
        ]);
    }, 30_000);

    test("B5: an unfinished step is dashed and says so; its empty slot is dashed with its placeholder; a step added opens its first empty slot", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", BIG.name));
        await quickAdd("Sort by");
        const card = cardsOf(container)[1]!;
        expect([titleOf(card), card.hasAttribute("data-unfinished"), card.textContent!.endsWith("Not in the query until it's finished.")]).toEqual(["Sort", true, true]);
        const slot = card.querySelector<HTMLElement>("[aria-haspopup=listbox]")!;
        expect([slot.hasAttribute("data-empty"), slot.textContent]).toEqual([true, "field▾"]);
        expect([slot.hasAttribute("data-open"), popoverLabel()]).toEqual([true, "Sort by"]);
        expect(statusOf(container).check).toEqual(["warning", "1 to finish"]);
    }, 30_000);

    test("B6: the status line — the check and the shape the query gives; the save state and the name", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        expect(statusOf(container)).toEqual({ check: ["success", "Checks clean"], gives: "Gives many orders", save: ["new", "Not saved", "Untitled orders query"] });
        await openQuery(variant("saved", TOP.name));
        expect(statusOf(container)).toEqual({ check: ["success", "Checks clean"], gives: "Gives up to 10 orders", save: ["saved", "Saved", "Top shipped orders, 2026"] });
        expect(container.querySelector("[data-query-status]")!.textContent).toContain("· order, customer, region, total, shipped");
        await quickAdd("Keep the first");
        expect(statusOf(container).save).toEqual(["unsaved", "Unsaved changes", "Top shipped orders, 2026"]);
    }, 30_000);

    test("B7: the save popover — Save query · its name, the name offered, the generated description muted with its hint; edited, its count and Use generated", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", BIG.name));
        await act(async () => { fireEvent.click(container.querySelector("[data-query-save-open]")!); });
        await settle();
        const dialog = within(screen.getByRole("dialog"));
        expect(dialog.getByText("Save query ·").textContent).toBe("Save query · Big orders");
        expect((dialog.getByRole("textbox", { name: "Query name" }) as HTMLInputElement).value).toBe("Big orders");
        const description = dialog.getByRole("textbox", { name: "What the query answers, in one sentence" }) as HTMLTextAreaElement;
        expect([description.value, description.hasAttribute("data-generated")]).toEqual(["Orders where total is at least 1,000.", true]);
        expect(dialog.getByText("Generated from the steps · edit to write your own")).toBeTruthy();
        await act(async () => { fireEvent.change(description, { target: { value: "Orders of 1,000 or more." } }); });
        expect([dialog.getByText("24/140 · shown under the name in the library"), dialog.getByRole("button", { name: "Use generated" })]).toHaveLength(2);
    }, 30_000);

    test("B8: no border around the builder; the slots' and the cards' states are the recipe's, by data attributes", () => {
        const recipe = system.getSlotRecipe("queryBuilder") as { base: Record<string, Record<string, unknown>> };
        expect(Object.keys(recipe.base["root"]!).filter((k) => /^border/i.test(k) || /^(outline|boxShadow)$/.test(k))).toEqual([]);
        expect([recipe.base["slot"]!["&[data-empty]"], recipe.base["slot"]!["&[data-error]"]]).toEqual([
            { borderStyle: "dashed", color: "fg.subtle" }, { borderColor: "fg.danger", color: "fg.danger" },
        ]);
        expect([recipe.base["card"]!["&[data-unfinished]"], recipe.base["card"]!["&[data-error]"]]).toEqual([{ borderStyle: "dashed" }, { borderColor: "fg.danger" }]);
    });
});

// ─── U1 ──────────────────────────────────────────────────────────────────────

describe("<Query.Builder> — chaining, keys, fixes and the history (#936 U1)", () => {
    test("a condition built by clicks: Keep rows opens its field; a field opens its value; the comparison's own offers; each pick one gesture", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", BIG.name));
        await quickAdd("Keep rows");
        expect(popoverLabel()).toBe("Field");
        expect(offers().slice(0, 5)).toEqual(["customer ID", "discount", "ID", "lines", "status"]);
        await pick("status");
        // A case field takes "is", and opens its value: the cases.
        expect([popoverLabel(), offers()]).toEqual(["Value", ["cancelled", "pending", "shipped"]]);
        await pick("pending");
        expect(popover()).toBeNull();
        const card = cardsOf(container)[1]!;
        expect(rowsOf(card)).toEqual([["", "<status>", "<is>", "<pending>", "(Remove)"]]);
        await openSlot(card, "is");
        expect([popoverLabel(), offers(), activeOffer()]).toEqual(["Compare", ["is", "is not"], "is"]);
        await pick("is not");
        expect(popover()).toBeNull();
        expect(rowsOf(cardsOf(container)[1]!)).toEqual([["", "<status>", "<is not>", "<pending>", "(Remove)"]]);
    }, 30_000);

    test("the autocomplete's keys: ↓ ↑ move and wrap, Esc closes, Tab and ⏎ pick, typing offers the value typed; ⌘⏎ anywhere runs", async () => {
        const offline = offlineCall();
        const { container } = await mountBuilder(offline.call);
        await openQuery(variant("saved", BIG.name));
        const card = cardsOf(container)[0]!;
        await openSlot(card, "is at least");
        expect(activeOffer()).toBe("is at least");
        await key("ArrowDown");
        expect(activeOffer()).toBe("is at most");
        await key("ArrowUp");
        await key("ArrowUp");
        await key("ArrowUp");
        expect(activeOffer()).toBe("is");
        await key("ArrowUp");
        expect(activeOffer()).toBe("is less than");
        await key("Escape");
        expect(popover()).toBeNull();
        expect(rowsOf(card)[0]).toEqual(["", "<total>", "<is at least>", "<1000>", "(Remove)"]);
        await openSlot(card, "is at least");
        await key("ArrowDown");
        await key("Tab");
        expect(rowsOf(cardsOf(container)[0]!)[0]).toEqual(["", "<total>", "<is at most>", "<1000>", "(Remove)"]);
        await openSlot(cardsOf(container)[0]!, "1000");
        // Opening the query ran it (#938), under the server's time limit (#1131); a value slot reads the summary of its rows:
        // one one-shot call more, with a summary's limits.
        expect(offline.requests.map((r) => r.limits)).toEqual([
            some({ timeoutMs: none, maxResultBytes: some(1_048_576n), maxLogBytes: none }),
            some({ timeoutMs: some(5_000n), maxResultBytes: some(1_048_576n), maxLogBytes: none }),
        ]);
        await act(async () => { fireEvent.change(filterOf(), { target: { value: "2,500" } }); });
        await settle();
        expect(offers()[0]).toBe("Use “2,500”");
        await key("Enter");
        expect(rowsOf(cardsOf(container)[0]!)[0]).toEqual(["", "<total>", "<is at most>", "<2500>", "(Remove)"]);
        // ⌘⏎ — not a pick — runs the query, from anywhere in the builder: one one-shot call more, with a run's limits.
        await act(async () => { fireEvent.keyDown(cardsOf(container)[0]!, { key: "Enter", metaKey: true }); });
        await settle();
        expect(offline.requests.map((r) => r.limits)).toEqual([
            some({ timeoutMs: none, maxResultBytes: some(1_048_576n), maxLogBytes: none }),
            some({ timeoutMs: some(5_000n), maxResultBytes: some(1_048_576n), maxLogBytes: none }),
            some({ timeoutMs: none, maxResultBytes: some(1_048_576n), maxLogBytes: none }),
        ]);
        expect(container.querySelector("[data-query-run]")!.textContent).toBe("Run⌘⏎");
    }, 30_000);

    test("a fix: a payload's field read before the rows are narrowed says so, and Keep only shipped orders first narrows them", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", BIG.name));
        await openSlot(cardsOf(container)[0]!, "total");
        await pick("shipped date");
        // A date takes "is in year", and opens its value.
        expect(popoverLabel()).toBe("Value");
        await act(async () => { fireEvent.change(filterOf(), { target: { value: "2026" } }); });
        await settle();
        await key("Enter");
        const card = cardsOf(container)[0]!;
        expect(rowsOf(card)).toEqual([["", "<shipped date>", "<is in year>", "<2026>", "(Remove)"]]);
        const problem = card.querySelector<HTMLElement>("[data-query-problem]")!;
        expect([problem.getAttribute("data-severity"), problem.textContent]).toEqual(["error", "Only shipped orders have a shipped date.Keep only shipped orders first"]);
        expect(card.hasAttribute("data-error")).toBe(true);
        await press("Keep only shipped orders first", card);
        const fixed = cardsOf(container)[0]!;
        expect(rowsOf(fixed)).toEqual([
            ["", "<status>", "<is>", "<shipped>", "(Remove)"],
            ["and", "<shipped date>", "<is in year>", "<2026>", "(Remove)"],
        ]);
        expect([fixed.querySelector("[data-query-problem]"), fixed.hasAttribute("data-error")]).toEqual([null, false]);
    }, 30_000);

    test("the history: a pick, undone and redone by the history item; Discard returns to the saved query", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", BIG.name));
        await openSlot(cardsOf(container)[0]!, "is at least");
        await pick("is more than");
        const row = () => rowsOf(cardsOf(container)[0]!)[0];
        expect(row()).toEqual(["", "<total>", "<is more than>", "<1000>", "(Remove)"]);
        await press("Undo");
        expect(row()).toEqual(["", "<total>", "<is at least>", "<1000>", "(Remove)"]);
        await press("Redo");
        expect(row()).toEqual(["", "<total>", "<is more than>", "<1000>", "(Remove)"]);
        await quickAdd("Keep the first");
        expect(cardsOf(container).map(titleOf)).toEqual(["Keep rows where", "Keep the first"]);
        await press("Discard");
        expect([cardsOf(container).map(titleOf), row()]).toEqual([["Keep rows where"], ["", "<total>", "<is at least>", "<1000>", "(Remove)"]]);
    }, 30_000);
});

// ─── U2 ──────────────────────────────────────────────────────────────────────

describe("<Query.Builder> — Visual · jq and saving (#936 U2)", () => {
    /** The jq view's text field. */
    const jqField = () => screen.getByRole("textbox", { name: "jq query" }) as HTMLTextAreaElement;
    /** Types the jq, and leaves it. */
    async function typeJq(text: string) {
        await act(async () => { fireEvent.change(jqField(), { target: { value: text } }); });
        await act(async () => { fireEvent.blur(jqField()); });
        await settle();
    }

    test("to jq prints the program, and back to visual leaves the steps as they were", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", BIG.name));
        await act(async () => { fireEvent.click(viewButton("jq")); });
        await settle();
        expect(jqField().value).toBe(".orders\n| map(select(.total >= 1000))");
        expect(viewButton("jq").getAttribute("aria-pressed")).toBe("true");
        await act(async () => { fireEvent.click(viewButton("Visual")); });
        await settle();
        expect([cardsOf(container).map(titleOf), statusOf(container).save[0]]).toEqual([["Keep rows where"], "saved"]);
    }, 30_000);

    test("the jq view says what it leaves out; jq it cannot read as steps stays jq, said; parts that are not steps stay jq steps, with a notice", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", BIG.name));
        await quickAdd("Sort by");
        await act(async () => { fireEvent.click(viewButton("jq")); });
        await settle();
        expect(container.querySelector("[data-query-tab=query]")!.textContent).toContain("1 unfinished step is left out of the jq until it is finished.");
        // A syntax error keeps the jq, with its note.
        await typeJq(".orders | map(select(.total >= 1000)");
        await act(async () => { fireEvent.click(viewButton("Visual")); });
        await settle();
        expect(jqField().value).toBe(".orders | map(select(.total >= 1000)");
        expect(container.querySelector("[data-query-tab=query]")!.textContent).toContain("Fix the syntax problem first — the visual steps are built from the jq.");
        expect(statusOf(container).check).toEqual(["danger", "1 problem"]);
        // A step that is no canonical form stays a jq step, and a notice says so.
        await typeJq(".orders | map(.total)");
        await act(async () => { fireEvent.click(viewButton("Visual")); });
        await settle();
        expect(cardsOf(container).map(titleOf)).toEqual(["jq step"]);
        expect(container.querySelector("[data-query-tab=query] [role=status]")!.textContent).toBe("1 part of the jq doesn't match a visual step, so it stays as jq.");
        // Each jq typed and left is one gesture: undone, the jq that did not parse is back, in the jq view; undone again, the steps.
        await press("Undo");
        expect([container.querySelector("[data-query-tab=query]")!.getAttribute("data-mode"), jqField().value])
            .toEqual(["jq", ".orders | map(select(.total >= 1000)"]);
        await press("Undo");
        expect(cardsOf(container).map(titleOf)).toEqual(["Keep rows where", "Sort"]);
    }, 30_000);

    test("Copy jq copies the program — in the jq view, the jq as typed — and shows its check for a moment; Run says Running while its call goes", async () => {
        const copied: string[] = [];
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
        let answer: (() => void) | undefined;
        const { container } = await mountBuilder(() => new Promise((_resolve, reject) => { answer = () => reject(new Error("offline")); }));
        try {
            await openQuery(variant("saved", BIG.name));
            const copy = () => container.querySelector<HTMLElement>("[data-query-copy]")!;
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            await act(async () => { fireEvent.click(copy()); });
            expect([copied, copy().textContent, copy().hasAttribute("data-copied")]).toEqual([[".orders\n| map(select(.total >= 1000))"], "Copied", true]);
            await act(async () => { vi.advanceTimersByTime(1_599); });
            expect(copy().textContent).toBe("Copied");
            await act(async () => { vi.advanceTimersByTime(1); });
            expect([copy().textContent, copy().hasAttribute("data-copied")]).toEqual(["Copy jq", false]);
            vi.useRealTimers();
            await act(async () => { fireEvent.click(viewButton("jq")); });
            await act(async () => { fireEvent.change(jqField(), { target: { value: ".orders | length" } }); });
            await act(async () => { fireEvent.click(copy()); });
            expect(copied).toEqual([".orders\n| map(select(.total >= 1000))", ".orders | length"]);
            // Run: its call goes until it answers, and the button says so.
            await act(async () => { fireEvent.click(container.querySelector("[data-query-run]")!); });
            await settle();
            const run = container.querySelector<HTMLElement>("[data-query-run]")!;
            expect([run.hasAttribute("data-loading"), run.textContent]).toEqual([true, "Running"]);
            await act(async () => { answer!(); });
            await settle();
            expect([container.querySelector("[data-query-run]")!.hasAttribute("data-loading"), container.querySelector("[data-query-run]")!.textContent]).toEqual([false, "Run⌘⏎"]);
        } finally {
            vi.useRealTimers();
            Reflect.deleteProperty(navigator, "clipboard");
        }
    }, 30_000);

    test("Save… saves the open query as one patch of its entry, under its name, with its description", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", BIG.name));
        await quickAdd("Keep the first");
        await act(async () => { fireEvent.click(container.querySelector("[data-query-save-open]")!); });
        await settle();
        const dialog = within(screen.getByRole("dialog"));
        await act(async () => { fireEvent.change(dialog.getByRole("textbox", { name: "What the query answers, in one sentence" }), { target: { value: "The first ten big orders." } }); });
        await press("Save", screen.getByRole("dialog"));
        await closed();
        expect(await committed(harness)).toEqual(["patch", "$init"]);
        const saved = recordOf(harness).get("Big orders")!;
        expect(programEqual(saved.program, checkJq(".orders\n| map(select(.total >= 1000))\n| .[:10]", ROOT.type, { root: true }).program!)).toBe(true);
        expect(saved.description).toEqual(some("The first ten big orders."));
        expect(statusOf(container).save).toEqual(["saved", "Saved", "Big orders"]);
        expect(container.querySelector("[data-query-save]")!.hasAttribute("data-fresh")).toBe(true);
    }, 30_000);

    test("the history item's Save: from its click until the record reads back, the steps are the drafts it saves — never the query as it stood before them", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", BIG.name));
        await quickAdd("Keep the first");
        const steps = () => cardsOf(container).map(titleOf);
        const drafted = ["Keep rows where", "Keep the first"];
        expect(steps()).toEqual(drafted);
        // The record takes the save only once released, so the builder is seen while the save goes.
        const forward = harness.memory.mutate.bind(harness.memory);
        let release = (): void => { throw new Error("the save never reached the record"); };
        harness.memory.mutate = async (ws, record, mutation, request) => {
            await new Promise<void>((resolve) => { release = resolve; });
            return forward(ws, record, mutation, request);
        };
        await press("Save", builderOf(container).querySelector<HTMLElement>("[data-slot=history]")!);
        expect([steps(), statusOf(container).save[0]]).toEqual([drafted, "unsaved"]);
        await act(async () => { release(); });
        await settle();
        expect(await committed(harness)).toEqual(["patch", "$init"]);
        expect([steps(), statusOf(container).save[0]]).toEqual([drafted, "saved"]);
    }, 30_000);

    test("a rename: saved under a new name, the query moves to it, and the builder opens it", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", BIG.name));
        await act(async () => { fireEvent.click(container.querySelector("[data-query-save-open]")!); });
        await settle();
        await act(async () => { fireEvent.change(screen.getByRole("textbox", { name: "Query name" }), { target: { value: "Large orders" } }); });
        await press("Save", screen.getByRole("dialog"));
        expect(await committed(harness)).toEqual(["patch", "$init"]);
        expect([...recordOf(harness).keys()]).toEqual(["Large orders", "Order count", "Top shipped orders, 2026"]);
        expect(programEqual(savedProgramOf("Large orders"), BIG.program)).toBe(true);
        expect(builderOf(container).getAttribute("data-query-open")).toBe(`query.saved:"Large orders"`);
    }, 30_000);

    test("a name another saved query holds is refused in the popover; a stale entry's save is refused there, and the other save stands", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", BIG.name));
        await quickAdd("Keep the first");
        await act(async () => { fireEvent.click(container.querySelector("[data-query-save-open]")!); });
        await settle();
        const name = screen.getByRole("textbox", { name: "Query name" });
        await act(async () => { fireEvent.change(name, { target: { value: "Order count" } }); });
        expect([screen.getByText("Order count is taken").id, saveIn().disabled]).toEqual([name.getAttribute("aria-describedby"), true]);
        await act(async () => { fireEvent.change(name, { target: { value: "Big orders" } }); });
        // Another operator's save of the query lands between this save's read and its commit.
        const other = { ...BIG, description: some("Orders of 1,000 or more."), saved_at: new Date(Date.UTC(2026, 9, 1, 8, 0)) };
        const patch = East.compile(Query.save, [])(savedRecord([TOP, BIG, COUNT]), some(BIG.name), other);
        const forward = harness.memory.mutate.bind(harness.memory);
        let raced = false;
        harness.memory.mutate = async (ws, record, mutation, request) => {
            if (!raced) {
                raced = true;
                await forward(ws, record, mutation, { args: [encodeBeast2For(PatchType(Query.Types.Saved))(patch)] });
            }
            return forward(ws, record, mutation, request);
        };
        await press("Save", screen.getByRole("dialog"));
        expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe(
            "Big orders changed since this edit began — last changed by memory. Discard your changes to see it, or save under another name.",
        );
        expect(savedEqual(recordOf(harness).get(BIG.name)!, other)).toBe(true);
    }, 30_000);

    test("drafts gone stale under another save of the query are not saved: the popover says why, and the other save stands", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", BIG.name));
        await quickAdd("Keep the first");
        // Another operator's save of the query lands while these drafts stand.
        const other = { ...BIG, description: some("Orders of 1,000 or more."), saved_at: new Date(Date.UTC(2026, 9, 1, 8, 0)) };
        const patch = East.compile(Query.save, [])(savedRecord([TOP, BIG, COUNT]), some(BIG.name), other);
        await act(async () => { await harness.memory.mutate(WORKSPACE, RECORD, "patch", { args: [encodeBeast2For(PatchType(Query.Types.Saved))(patch)] }); });
        await settle();
        await act(async () => { fireEvent.click(container.querySelector("[data-query-save-open]")!); });
        await settle();
        await press("Save", screen.getByRole("dialog"));
        expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe("Source changed — review or discard these drafts");
        expect(await committed(harness)).toEqual(["patch", "$init"]);
        expect(savedEqual(recordOf(harness).get(BIG.name)!, other)).toBe(true);
    }, 30_000);

    test("a new query's Apply opens the save popover to name it, and its save opens the saved query", async () => {
        const { container } = await mountBuilder(offlineCall().call);
        await quickAdd("Keep the first");
        await press("Save", builderOf(container).querySelector<HTMLElement>("[data-slot=history]")!);
        const dialog = within(screen.getByRole("dialog"));
        expect(dialog.getByText("Save query ·").textContent).toBe("Save query · Untitled orders query");
        await act(async () => { fireEvent.change(dialog.getByRole("textbox", { name: "Query name" }), { target: { value: "First ten orders" } }); });
        await press("Save", screen.getByRole("dialog"));
        expect(await committed(harness)).toEqual(["patch", "$init"]);
        expect(programEqual(savedProgramOf("First ten orders"), checkJq(".orders\n| .[:10]", ROOT.type, { root: true }).program!)).toBe(true);
        expect(builderOf(container).getAttribute("data-query-open")).toBe(`query.saved:"First ten orders"`);
        expect(statusOf(container).save).toEqual(["saved", "Saved", "First ten orders"]);
    }, 30_000);
});
