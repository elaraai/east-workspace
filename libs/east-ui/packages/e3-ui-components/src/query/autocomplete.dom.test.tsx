/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The slot autocomplete (#936, #1673; `Query Editor Spec.md` §4.5) — the
 * builder's frames around the one picker — over the offers #934's `slotItems`
 * gives on #875's shared fixture (`libs/east/test/fixtures/query-fixture.beast2`),
 * in the slots' own words: what the picker lists for a slot — its label, its
 * search, the groups and their offers, the empty text, where the offers come
 * from — its keys, the pointer, typing and the highlight, opening and closing,
 * a phone's view, and the popover's placement.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi, type Mock } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { decodeBeast2, fromEastTypeValue, none, some, variant, type EastType } from "@elaraai/east";
import { formatters, system } from "@elaraai/east-ui-components";
import type { SlotRef } from "./model/refs.js";
import { activeItem, currentItem, slotEmpty, slotHint, slotItems, slotLabel, slotPlaceholder, type SavedOffer, type SlotItem } from "./model/slots.js";
import { queryWords } from "./model/words.js";
import type { ComparisonKind, Condition, StepQuery, StepValue } from "./steps/values.js";
import type { SlotPopover } from "./use-query-editor.js";
import { SlotAutocomplete, placeAutocomplete, type PlacementBox, type SlotAutocompleteProps } from "./autocomplete.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

/** The shared fixture's root type, and the words. */
const fixture = decodeBeast2(readFileSync(join(import.meta.dirname, "../../../../../east/test/fixtures/query-fixture.beast2")));
const ROOT: EastType = fromEastTypeValue(fixture.type);
const W = queryWords(formatters("en-AU"));

// ─── Offers from the model, over the fixture ─────────────────────────────────

let ids = 0;
const id = (prefix: string): string => `${prefix}${++ids}`;
const num = (value: number): StepValue => variant("number", value);
/** A condition testing one field. */
const condition = (field: string, cmp: ComparisonKind, value: StepValue): Condition =>
    variant("test", { id: id("c"), field: some(field), cmp: some(variant(cmp, null)), value: some(value), inner: none, whole: false }) as Condition;
/** Orders, kept where one condition holds. */
const keepRows = (cond: Condition): StepQuery => ({ source: "orders", steps: [variant("filter", { id: id("s"), match: variant("all", null), conds: [cond] })] });

/** A slot of a query, and the saved queries its offers draw on. */
interface Offered {
    readonly query: StepQuery;
    readonly slot: SlotRef;
    readonly saved?: readonly SavedOffer[];
}

/** A slot's offers for a text. */
function offers({ query, slot, saved }: Offered, text = ""): SlotItem[] {
    return slotItems(query, ROOT, slot, text, saved === undefined ? { words: W } : { words: W, saved });
}

const total = condition("total", "ge", num(100));
const totalQuery = keepRows(total);
/** The field slot of `total is at least 100`: the orders' fields, and their payloads' under their case. */
const FIELD: Offered = { query: totalQuery, slot: { kind: "field", stepId: totalQuery.steps[0]!.value.id, condId: total.value.id } };
/** Its value slot: with no summary fetched, nothing to offer. */
const NO_VALUES: Offered = { query: totalQuery, slot: { kind: "value", stepId: totalQuery.steps[0]!.value.id, condId: total.value.id } };
const lines = condition("lines", "lengthAtLeast", num(1));
const linesQuery = keepRows(lines);
/** The value slot of `lines has at least 1`: one to four items, as data. */
const ITEMS: Offered = { query: linesQuery, slot: { kind: "value", stepId: linesQuery.steps[0]!.value.id, condId: lines.value.id } };
/** The add-step list of a bill of materials with no steps: every step, most of them refused on one tree, and the tree's saved queries. */
const STEPS: Offered = {
    query: { source: "bom", steps: [] },
    slot: { kind: "add-step", stepId: "" },
    saved: [
        { name: "Pump parts cost", source: "bom", when: "Saved · Tue" },
        { name: "Cancelled orders", source: "orders", when: "Saved · Mon" },
        { name: "Every part", source: "bom", when: "Ran · today", recent: true },
    ],
};

// ─── Mounting ────────────────────────────────────────────────────────────────

/** A mounted autocomplete: its slot and builder, its callbacks, and the open slot's offers to change. */
interface Mounted {
    readonly anchor: HTMLButtonElement;
    readonly bounds: HTMLDivElement;
    readonly onText: Mock<(text: string) => void>;
    readonly onPick: Mock<(item: SlotItem) => void>;
    readonly onClose: Mock<() => void>;
    /** Renders it again with the open slot's offers changed, as its host does. */
    readonly update: (next: Partial<SlotPopover>) => void;
    readonly unmount: () => void;
}

/** What a test gives a mount: the frame's own props, and the open slot's changed. */
type MountProps = Partial<Omit<SlotAutocompleteProps, "popover" | "bounds">> & { readonly popover?: Partial<SlotPopover> };

/**
 * Opens a slot's autocomplete in a builder, as its host does: the slot's
 * words, its offers for no text, the offer `activeItem` opens on, and the one
 * that sets what the slot holds now (`currentItem`).
 */
function mount(offered: Offered, props: MountProps = {}, measure?: (anchor: HTMLButtonElement, bounds: HTMLDivElement) => void): Mounted {
    const bounds = document.createElement("div");
    const anchor = document.createElement("button");
    anchor.textContent = "slot";
    bounds.append(anchor);
    document.body.append(bounds);
    measure?.(anchor, bounds);
    const items = offers(offered);
    const onText = vi.fn<(text: string) => void>();
    const onPick = vi.fn<(item: SlotItem) => void>();
    const onClose = vi.fn<() => void>();
    const { popover: given, ...frame } = props;
    let popover: SlotPopover = {
        slot: { ref: offered.slot, key: "slot", anchor },
        generation: "slot|",
        label: slotLabel(offered.slot, W), placeholder: slotPlaceholder(offered.slot, W), hint: slotHint(offered.slot, W), empty: slotEmpty(offered.slot, W),
        items, text: "", initialActive: activeItem(items, offered.query, ROOT, offered.slot), current: currentItem(items, offered.query, ROOT, offered.slot),
        onText, onPick, onClose,
        ...given,
    };
    const view = () => <ChakraProvider value={system}><SlotAutocomplete popover={popover} bounds={bounds} {...frame} /></ChakraProvider>;
    const utils = render(view());
    return {
        anchor, bounds, onText, onPick, onClose,
        update: (next) => {
            popover = { ...popover, ...next };
            utils.rerender(view());
        },
        unmount: () => utils.unmount(),
    };
}

afterEach(() => {
    cleanup();
    document.body.replaceChildren();
});

// ─── Reading it ──────────────────────────────────────────────────────────────

/** The frame: the popover in the builder's pane, or a phone's view. */
const frame = (): HTMLElement => document.querySelector<HTMLElement>("[data-query-autocomplete]")!;
/** The picker in it. */
const picker = (): HTMLElement => frame().querySelector<HTMLElement>("[data-chooser]")!;
/** Its search. */
const search = (): HTMLInputElement => screen.getByRole<HTMLInputElement>("combobox");
/** Its list. */
const listbox = (): HTMLElement => screen.getByRole("listbox");
/** An offer by its label. */
const option = (label: string): HTMLElement => within(listbox()).getAllByRole("option").find(o => o.querySelector("[data-option-label]")?.textContent === label)!;
/** The label of the offer highlighted. */
const lit = (): string | undefined => listbox().querySelector("[data-highlighted] [data-option-label]")?.textContent ?? undefined;

/**
 * An offer as drawn: `[icon] label`, ` #` when it reads as data, `— line`, `· range`, and its state when it is not
 * simply enabled — `CURRENT`, checked; `REFUSED`, its × and its reason on its line.
 */
function offerText(o: HTMLElement): string {
    const part = (name: string): string | undefined => o.querySelector(`[data-option-${name}]`)?.textContent ?? undefined;
    const label = o.querySelector("[data-option-label]")!;
    const icon = o.querySelector("[data-option-icon] svg")?.getAttribute("data-icon");
    const line = part("line");
    const range = part("range");
    const state = o.getAttribute("data-state");
    return [
        icon === null || icon === undefined ? "" : `[${icon}] `,
        label.textContent,
        label.hasAttribute("data-words") ? "" : " #",
        line === undefined ? "" : ` — ${line}`,
        range === undefined || range === "" ? "" : ` · ${range}`,
        state === null ? "" : ` ${state.toUpperCase()}`,
    ].join("");
}

/** The list as drawn: each group by its name, over its offers. */
function drawn(): [string, string[]][] {
    return within(listbox()).getAllByRole("group").map((group): [string, string[]] => [group.getAttribute("aria-label") ?? "", within(group).getAllByRole("option").map(offerText)]);
}

// ─── What it lists ───────────────────────────────────────────────────────────

describe("the slot autocomplete — what it lists", () => {
    test("a field slot: its label and search; the orders' fields in their groups, in order, each with its kind's icon, a payload's under its case with the case on its line; its current field highlighted; where they come from in its foot", () => {
        mount(FIELD);
        expect({
            label: picker().querySelector("[data-chooser-label]")?.textContent,
            placeholder: search().placeholder,
            groups: drawn(),
            lit: lit(),
            hint: picker().querySelector("[data-chooser-hint]")?.textContent,
        }).toEqual({
            label: "Field",
            placeholder: "Type to filter",
            groups: [
                ["Fields", ["[font] customer ID — text", "[hashtag] discount — number, sometimes missing", "[hashtag] ID — whole number", "[list] lines — list of lines", "[shapes] status — one of cancelled, pending, shipped"]],
                ["Inside status", ["[font] cancelled reason — text, sometimes missing · cancelled orders only", "[calendar] shipped date — date, sometimes missing · shipped orders only"]],
                ["Fields", ["[hashtag] total — number"]],
            ],
            lit: "total",
            hint: "Fields from the checked type",
        });
        // A combobox over a listbox, both named by the label; the highlighted offer the one it names.
        const input = screen.getByRole("combobox", { name: "Field" });
        expect([input.getAttribute("aria-expanded"), input.getAttribute("aria-controls"), input.getAttribute("aria-autocomplete")]).toEqual(["true", listbox().id, "list"]);
        expect(screen.getByRole("listbox", { name: "Field" })).toBe(listbox());
        expect(input.getAttribute("aria-activedescendant")).toBe(option("total").id);
    });

    test("the add-step list of one tree: every step with its icon and hint, those that do not fit refused with why on their line; the saved queries on the tree, with theirs", () => {
        mount(STEPS);
        const needsRows = "Needs rows — the query gives one bom tree here";
        expect({ label: picker().querySelector("[data-chooser-label]")?.textContent, groups: drawn(), lit: lit(), hint: picker().querySelector("[data-chooser-hint]")?.textContent }).toEqual({
            label: "Add a step",
            groups: [
                ["Add a step", [
                    `[filter] Keep rows where… — Keep only the rows that match · ${needsRows} REFUSED`,
                    `[arrow-right-arrow-left] Look up from another dataset… — Bring in fields from a lookup table by key · ${needsRows} REFUSED`,
                    `[layer-group] Group and total… — One row per group, with totals · ${needsRows} REFUSED`,
                    `[arrow-down-wide-short] Sort by… — Order the rows · ${needsRows} REFUSED`,
                    `[list-ol] Keep the first… — The first rows only · ${needsRows} REFUSED`,
                    `[hashtag] Count the rows — Gives one number · ${needsRows} REFUSED`,
                    `[table-columns] Show only some fields… — Pick and rename fields · ${needsRows} REFUSED`,
                    `[fill-drip] Fill in missing values… — Use a default where a value is missing · ${needsRows} REFUSED`,
                    `[arrow-turn-down] Open each bom's list… — One row per item in a list · ${needsRows} REFUSED`,
                    `[calendar-day] Take part of a date… — Year, month or weekday · ${needsRows} REFUSED`,
                    "[sitemap] List every part in the tree — Walk every nested level",
                    "[chart-line] Try the model over a range… — One row per input value · Needs a calculation REFUSED",
                ]],
                ["Start from a saved query", ["[bookmark] Pump parts cost — Saved · Tue", "[clock-rotate-left] Every part — Ran · today"]],
            ],
            lit: "List every part in the tree",
            hint: "Only steps that fit the current shape",
        });
        // Refused, it wears its ×: its reason is on its line, where a pointer never has to hover for it.
        expect(within(option("Sort by…")).getByLabelText("Doesn't fit")).toBeTruthy();
    });

    test("a value slot's counts: data, each with its meta at its end", () => {
        mount(ITEMS);
        expect({ label: picker().querySelector("[data-chooser-label]")?.textContent, placeholder: search().placeholder, groups: drawn(), lit: lit() }).toEqual({
            label: "Value",
            placeholder: "Type or pick a value",
            groups: [["Items", ["1 # · item", "2 # · items", "3 # · items", "4 # · items"]]],
            lit: "1",
        });
    });

    test("with nothing to offer, it says what to do, and nothing is highlighted", () => {
        const { onPick } = mount(NO_VALUES);
        expect({
            options: within(listbox()).queryAllByRole("option"),
            empty: listbox().textContent,
            active: search().getAttribute("aria-activedescendant"),
            hint: picker().querySelector("[data-chooser-hint]")?.textContent,
        }).toEqual({ options: [], empty: "Type a value, then press ⏎.", active: null, hint: "Values from the dataset summary" });
        fireEvent.keyDown(search(), { key: "Enter" });
        expect(onPick.mock.calls).toEqual([]);
    });
});

// ─── Keys ────────────────────────────────────────────────────────────────────

describe("the slot autocomplete — keys", () => {
    test("↓ and ↑ move over the offers that can be picked, wrapping past the refused ones", () => {
        mount(STEPS);
        const moves: (string | undefined)[] = [];
        for (const key of ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp", "ArrowUp"]) {
            fireEvent.keyDown(search(), { key });
            moves.push(lit());
        }
        expect(moves).toEqual(["Pump parts cost", "Every part", "List every part in the tree", "Every part", "Pump parts cost", "List every part in the tree"]);
    });

    test("⏎ and Tab pick the highlighted offer, the focus back on its slot; ⌘⏎ and Ctrl ⏎ pass to the builder and pick nothing; Esc closes", () => {
        const { anchor, onPick, onClose } = mount(STEPS);
        const items = offers(STEPS);
        const passed = [fireEvent.keyDown(search(), { key: "Enter", metaKey: true }), fireEvent.keyDown(search(), { key: "Enter", ctrlKey: true })];
        expect([passed, onPick.mock.calls]).toEqual([[true, true], []]);
        fireEvent.keyDown(search(), { key: "Enter" });
        const focused = document.activeElement === anchor;
        // Each key its own event, as a browser delivers them: ↓, then Tab on what ↓ highlighted.
        fireEvent.keyDown(search(), { key: "ArrowDown" });
        fireEvent.keyDown(search(), { key: "Tab" });
        expect([focused, onPick.mock.calls, onClose.mock.calls]).toEqual([true, [[items[10]], [items[12]]], []]);
        fireEvent.keyDown(search(), { key: "Escape" });
        expect([onPick.mock.calls.length, onClose.mock.calls]).toEqual([2, [[]]]);
    });
});

// ─── The pointer ─────────────────────────────────────────────────────────────

describe("the slot autocomplete — the pointer", () => {
    test("a click picks; a refused offer is listed but never picked; the pointer moves the highlight over those that can be", () => {
        const { onPick } = mount(STEPS);
        const items = offers(STEPS);
        fireEvent.mouseEnter(option("Every part"));
        const hovered = lit();
        fireEvent.mouseEnter(option("Sort by…"));
        expect([hovered, lit()]).toEqual(["Every part", "Every part"]);
        fireEvent.click(option("Sort by…"));
        fireEvent.click(option("Pump parts cost"));
        expect(onPick.mock.calls).toEqual([[items[12]]]);
    });

    test("a press outside it and its slot closes it; a press on its slot or in it does not, and a press in it keeps the search focused", async () => {
        const { anchor, onClose } = mount(STEPS);
        await act(async () => {
            fireEvent.pointerDown(anchor);
            fireEvent.pointerDown(option("Every part"));
        });
        expect(onClose.mock.calls).toEqual([]);
        // A press on an offer or on the frame is kept from the search's blur; one in the search is its own.
        expect([fireEvent.mouseDown(option("Every part")), fireEvent.mouseDown(frame()), fireEvent.mouseDown(search())]).toEqual([false, false, true]);
        await act(async () => { fireEvent.pointerDown(document.body); });
        expect(onClose.mock.calls).toEqual([[]]);
    });
});

// ─── Typing and the highlight ────────────────────────────────────────────────

describe("the slot autocomplete — typing and the highlight", () => {
    test("typing tells the host; the offers it gives for the text are shown, the highlight on their first that can be picked", () => {
        const view = mount(FIELD);
        fireEvent.change(search(), { target: { value: "s" } });
        expect(view.onText.mock.calls).toEqual([["s"]]);
        view.update({ text: "s", items: offers(FIELD, "s") });
        expect({ value: search().value, groups: drawn(), lit: lit() }).toEqual({
            value: "s",
            groups: [
                ["Fields", ["[font] customer ID — text", "[hashtag] discount — number, sometimes missing", "[list] lines — list of lines", "[shapes] status — one of cancelled, pending, shipped"]],
                ["Inside status", ["[font] cancelled reason — text, sometimes missing · cancelled orders only", "[calendar] shipped date — date, sometimes missing · shipped orders only"]],
            ],
            lit: "customer ID",
        });
    });

    test("the host's echo of the text typed moves nothing: an offer moved to before the new offers arrive stays highlighted", () => {
        const view = mount(FIELD);
        fireEvent.change(search(), { target: { value: "s" } });
        fireEvent.keyDown(search(), { key: "ArrowDown" });
        view.update({ text: "s", items: offers(FIELD, "s") });
        expect([search().value, lit()]).toEqual(["s", "discount"]);
    });

    test("offers given again for the same text keep the highlight while its offer is there, wherever it moves; else it is on the first that can be picked", () => {
        const view = mount(FIELD, { popover: { text: "s", items: offers(FIELD, "s"), initialActive: 0 } });
        fireEvent.keyDown(search(), { key: "ArrowDown" });
        fireEvent.keyDown(search(), { key: "ArrowDown" });
        const moved = lit();
        view.update({ items: offers(FIELD, "s") });
        const kept = lit();
        // An offer before it gone: it moves up one, and stays highlighted.
        view.update({ items: offers(FIELD, "s").filter(item => item.label !== "customer ID") });
        const followed = lit();
        view.update({ items: offers(FIELD, "s").filter(item => item.label !== "lines") });
        expect([moved, kept, followed, lit()]).toEqual(["lines", "lines", "lines", "customer ID"]);
    });

    test("the search is the host's: a text it sets is the search's, and telling it nothing", () => {
        const view = mount(FIELD);
        view.update({ text: "s", items: offers(FIELD, "s") });
        const given = search().value;
        view.update({ text: "", items: offers(FIELD) });
        expect([given, search().value, view.onText.mock.calls]).toEqual(["s", "", []]);
    });

    test("a value typed is offered first, and ⏎ picks it", () => {
        const view = mount(ITEMS);
        fireEvent.change(search(), { target: { value: "7" } });
        view.update({ text: "7", items: offers(ITEMS, "7") });
        expect({ groups: drawn(), lit: lit() }).toEqual({ groups: [["Typed", ["Use “7”"]]], lit: "Use “7”" });
        fireEvent.keyDown(search(), { key: "Enter" });
        expect(view.onPick.mock.calls).toEqual([[{ value: { kind: "value", value: variant("number", 7) }, label: "Use “7”", group: "Typed", typed: true }]]);
    });
});

// ─── Opening and closing ─────────────────────────────────────────────────────

describe("the slot autocomplete — opening and closing", () => {
    test("it opens on the slot's offer with its search focused, without scrolling, and the highlighted offer stays in view, once it is placed too", () => {
        const focus = vi.spyOn(HTMLElement.prototype, "focus");
        const scroll = vi.fn();
        Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scroll });
        /** The offers scrolled into view, in order, by their labels. */
        const scrolled = (): (string | null | undefined)[] => scroll.mock.contexts.map(o => (o as HTMLElement).querySelector("[data-option-label]")?.textContent);
        try {
            mount(FIELD);
            const opened = { focused: document.activeElement === search(), focus: focus.mock.calls, scrolled: [...new Set(scrolled())], last: scrolled().at(-1) };
            expect(opened).toEqual({ focused: true, focus: [[{ preventScroll: true }]], scrolled: ["total"], last: "total" });
            fireEvent.keyDown(search(), { key: "ArrowUp" });
            expect([scrolled().at(-1), scroll.mock.calls.every(([how]) => (how as ScrollIntoViewOptions).block === "nearest")]).toEqual(["shipped date", true]);
        } finally {
            focus.mockRestore();
            delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
        }
    });

    test("closing with the focus in it hands the focus back to its slot; a focus moved elsewhere first stays there", () => {
        const first = mount(FIELD);
        first.unmount();
        const returned = document.activeElement === first.anchor;
        const second = mount(FIELD);
        const elsewhere = document.createElement("input");
        document.body.append(elsewhere);
        elsewhere.focus();
        second.unmount();
        expect([returned, document.activeElement === elsewhere]).toEqual([true, true]);
    });
});

// ─── A phone's view ──────────────────────────────────────────────────────────

describe("the slot autocomplete — a phone's view", () => {
    /** A phone's frame's overlay slot, over the builder. */
    const overlay = (): HTMLDivElement => {
        const slot = document.createElement("div");
        slot.setAttribute("data-frame-slot", "overlay");
        document.body.append(slot);
        return slot;
    };

    test("a view over the builder: ← back, its title and what it is for at its head; the picker bare, its label not said again, the field the slot holds checked; where the offers come from at its foot", () => {
        const slot = overlay();
        mount(FIELD, { view: slot, backLabel: "Back to the step", context: "Step 1 · condition 1" });
        const view = frame();
        expect({
            inSlot: slot.contains(view),
            titled: screen.getByRole("dialog", { name: "Field" }) === view,
            back: within(view).queryByRole("button", { name: "Back to the step" }) !== null,
            context: within(view).queryByText("Step 1 · condition 1") !== null,
            surface: picker().getAttribute("data-surface"),
            label: picker().querySelector("[data-chooser-label]"),
            current: offerText(option("total")),
            foot: view.querySelector("[data-hint]")?.textContent,
        }).toEqual({
            inSlot: true, titled: true, back: true, context: true, surface: "bare", label: null, current: "[hashtag] total — number CURRENT", foot: "Fields from the checked type",
        });
    });

    test("Esc goes back wherever the focus is, ahead of the pane under it; ← goes back; closing hands the focus back to its slot", async () => {
        const view = mount(FIELD, { view: overlay(), backLabel: "Back to the step" });
        const pane = vi.fn();
        document.body.addEventListener("keydown", pane);
        try {
            await act(async () => { fireEvent.keyDown(document.body, { key: "Escape" }); });
            expect([view.onClose.mock.calls.length, pane.mock.calls.length]).toEqual([1, 0]);
            const back = within(frame()).getByRole("button", { name: "Back to the step" });
            fireEvent.click(back);
            expect(view.onClose.mock.calls.length).toBe(2);
            back.focus();
            view.unmount();
            expect(document.activeElement).toBe(view.anchor);
        } finally {
            document.body.removeEventListener("keydown", pane);
        }
    });

    test("a short list of steps has no search: its steps alone, picked by a tap", () => {
        const view = mount(STEPS, { view: overlay(), search: false });
        expect(screen.queryByRole("combobox")).toBeNull();
        fireEvent.click(option("List every part in the tree"));
        expect(view.onPick.mock.calls).toEqual([[offers(STEPS)[10]]]);
    });
});

// ─── Placement ───────────────────────────────────────────────────────────────

/** A box as the viewport measures one. */
const box = (left: number, top: number, width: number, height: number): PlacementBox => ({ left, top, width, height });
/** A builder 1000 × 800, unscaled, at the viewport's corner. */
const BUILDER = box(0, 0, 1000, 800);

describe("placeAutocomplete", () => {
    test("below its slot, left-aligned with it, as tall as the room below leaves", () => {
        expect(placeAutocomplete({ anchor: box(100, 50, 80, 24), bounds: BUILDER, width: 320, scale: 1 })).toEqual({ side: "below", left: 100, top: 78, maxHeight: 714 });
    });

    test("above its slot when under 280px remain below and more is above, its bottom edge held; below while 280px remain, or while less is above", () => {
        expect([
            placeAutocomplete({ anchor: box(100, 700, 80, 24), bounds: BUILDER, width: 320, scale: 1 }),
            placeAutocomplete({ anchor: box(100, 492, 80, 24), bounds: BUILDER, width: 320, scale: 1 }),
            placeAutocomplete({ anchor: box(100, 100, 80, 24), bounds: box(0, 0, 1000, 300), width: 320, scale: 1 }),
        ]).toEqual([
            { side: "above", left: 100, bottom: 104, maxHeight: 688 },
            { side: "below", left: 100, top: 520, maxHeight: 272 },
            { side: "below", left: 100, top: 128, maxHeight: 164 },
        ]);
    });

    test("clamped 8px inside the builder at its right and at its left", () => {
        expect([
            placeAutocomplete({ anchor: box(900, 50, 80, 24), bounds: BUILDER, width: 320, scale: 1 }),
            placeAutocomplete({ anchor: box(150, 50, 80, 24), bounds: box(200, 0, 1000, 800), width: 320, scale: 1 }),
        ]).toEqual([
            { side: "below", left: 672, top: 78, maxHeight: 714 },
            { side: "below", left: 8, top: 78, maxHeight: 714 },
        ]);
    });

    test("a builder CSS-scaled to half measures half: in its own pixels the popover goes where it would unscaled; a scale not above 0 counts as 1", () => {
        expect([
            placeAutocomplete({ anchor: box(150, 65, 40, 12), bounds: box(100, 40, 500, 400), width: 320, scale: 0.5 }),
            placeAutocomplete({ anchor: box(150, 390, 40, 12), bounds: box(100, 40, 500, 400), width: 320, scale: 0.5 }),
            placeAutocomplete({ anchor: box(100, 50, 80, 24), bounds: BUILDER, width: 320, scale: 0 }),
        ]).toEqual([
            { side: "below", left: 100, top: 78, maxHeight: 714 },
            { side: "above", left: 100, bottom: 104, maxHeight: 688 },
            { side: "below", left: 100, top: 78, maxHeight: 714 },
        ]);
    });

    test("the popover is portaled into the builder and placed there from what it measures — its one inline style", () => {
        // The builder CSS-scaled to half: 1000 × 800 laid out, measured 500 × 400.
        const scaled = (anchorBox: PlacementBox) => (anchor: HTMLButtonElement, bounds: HTMLDivElement): void => {
            anchor.getBoundingClientRect = () => new DOMRect(anchorBox.left, anchorBox.top, anchorBox.width, anchorBox.height);
            bounds.getBoundingClientRect = () => new DOMRect(100, 40, 500, 400);
            Object.defineProperty(bounds, "offsetWidth", { configurable: true, value: 1000 });
        };
        const below = mount(FIELD, {}, scaled(box(160, 90, 40, 12)));
        const placedBelow = { parent: frame().parentElement === below.bounds, side: frame().getAttribute("data-side"), style: frame().getAttribute("style") };
        cleanup();
        document.body.replaceChildren();
        mount(FIELD, {}, scaled(box(160, 390, 40, 12)));
        const placedAbove = { side: frame().getAttribute("data-side"), style: frame().getAttribute("style") };
        expect([placedBelow, placedAbove]).toEqual([
            { parent: true, side: "below", style: "left: 120px; top: 128px; max-height: 664px;" },
            { side: "above", style: "left: 120px; bottom: 104px; max-height: 688px;" },
        ]);
    });
});
