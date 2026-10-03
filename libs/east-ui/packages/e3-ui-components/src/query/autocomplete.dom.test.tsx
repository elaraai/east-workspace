/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The slot autocomplete (#936, `Query Editor Spec.md` §4.5) over the offers
 * #934's `slotItems` gives on #875's shared fixture
 * (`libs/east/test/fixtures/query-fixture.beast2`), in the slots' own words:
 * its anatomy — the label, the filter, the groups and their offers, the empty
 * text, the footer — its keys, the pointer, typing and the active offer,
 * opening and closing, and its placement.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi, type Mock } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { decodeBeast2, fromEastTypeValue, none, some, variant, type EastType } from "@elaraai/east";
import { formatters, system } from "@elaraai/east-ui-components";
import type { SlotRef } from "./model/refs.js";
import { activeItem, slotEmpty, slotHint, slotItems, slotLabel, slotPlaceholder, type SavedOffer, type SlotItem } from "./model/slots.js";
import { queryWords } from "./model/words.js";
import type { ComparisonKind, Condition, StepQuery, StepValue } from "./steps/values.js";
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
/** The add-step list of a bill of materials with no steps: every step, most of them disabled on one tree, and the tree's saved queries. */
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

/** A mounted autocomplete: its slot and builder, its callbacks, and its props to change. */
interface Mounted {
    readonly anchor: HTMLButtonElement;
    readonly bounds: HTMLDivElement;
    readonly onText: Mock<(text: string) => void>;
    readonly onPick: Mock<(item: SlotItem) => void>;
    readonly onClose: Mock<() => void>;
    /** Renders it again with some props changed, as its host does. */
    readonly update: (next: Partial<SlotAutocompleteProps>) => void;
    readonly unmount: () => void;
}

/**
 * Opens a slot's autocomplete in a builder, as its host does: the slot's
 * words, its offers for no text, and the offer `activeItem` opens on.
 */
function mount(offered: Offered, props: Partial<SlotAutocompleteProps> = {}, measure?: (anchor: HTMLButtonElement, bounds: HTMLDivElement) => void): Mounted {
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
    let current: SlotAutocompleteProps = {
        anchor, bounds,
        label: slotLabel(offered.slot, W), placeholder: slotPlaceholder(offered.slot, W), hint: slotHint(offered.slot, W),
        empty: slotEmpty(offered.slot, W), keys: W.messages.slotKeys(),
        items, text: "", onText, initialActive: activeItem(items, offered.query, ROOT, offered.slot), onPick, onClose,
        ...props,
    };
    const view = (p: SlotAutocompleteProps) => <ChakraProvider value={system}><SlotAutocomplete {...p} /></ChakraProvider>;
    const utils = render(view(current));
    return {
        anchor, bounds, onText, onPick, onClose,
        update: (next) => {
            current = { ...current, ...next };
            utils.rerender(view(current));
        },
        unmount: () => utils.unmount(),
    };
}

afterEach(() => {
    cleanup();
    document.body.replaceChildren();
});

// ─── Reading it ──────────────────────────────────────────────────────────────

/** The popover. */
const popover = (): HTMLElement => document.querySelector<HTMLElement>("[data-query-autocomplete]")!;
/** Its filter. */
const filter = (): HTMLInputElement => screen.getByRole<HTMLInputElement>("combobox");
/** Its list. */
const listbox = (): HTMLElement => screen.getByRole("listbox");
/** An offer by its label. */
const option = (label: string): HTMLElement => within(listbox()).getAllByRole("option").find(o => o.querySelector("[data-label]")?.textContent === label)!;
/** The label of the offer the filter names active. */
function activeLabel(): string | undefined {
    const active = filter().getAttribute("aria-activedescendant");
    return active === null ? undefined : document.getElementById(active)?.querySelector("[data-label]")?.textContent ?? undefined;
}

/** An offer as drawn: `[icon] label`, `#` as data, `TYPED` for the value typed, `— detail`, `(note)`, `· meta`, and `DISABLED` when it cannot be picked. */
function offerText(o: HTMLElement): string {
    const part = (name: string): string | undefined => o.querySelector(`[data-${name}]`)?.textContent ?? undefined;
    const label = o.querySelector("[data-label]")!;
    const icon = o.querySelector("svg")?.getAttribute("data-icon");
    const detail = part("detail");
    const note = part("note");
    const meta = part("meta");
    return [
        icon === null || icon === undefined ? "" : `[${icon}] `,
        label.textContent,
        label.hasAttribute("data-mono") ? " #" : "",
        label.hasAttribute("data-typed") ? " TYPED" : "",
        detail === undefined ? "" : ` — ${detail}`,
        note === undefined ? "" : ` (${note})`,
        meta === undefined ? "" : ` · ${meta}`,
        o.getAttribute("aria-disabled") === "true" ? " DISABLED" : "",
    ].join("");
}

/** The list as drawn: each group by the heading that labels it, over its offers. */
function drawn(): [string, string[]][] {
    return within(listbox()).getAllByRole("group").map((group): [string, string[]] => [
        document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent ?? "",
        within(group).getAllByRole("option").map(offerText),
    ]);
}

// ─── Anatomy ─────────────────────────────────────────────────────────────────

describe("the slot autocomplete — anatomy", () => {
    test("a field slot: its label, filter and footer; the orders' fields in their groups, in order, a payload's under its case with the case as its note; its current field active", () => {
        mount(FIELD);
        const list = listbox();
        expect({
            label: popover().querySelector("label")?.textContent,
            placeholder: filter().placeholder,
            groups: drawn(),
            active: activeLabel(),
            hint: popover().querySelector("[data-hint]")?.textContent,
            keys: popover().querySelector("[data-keys]")?.textContent,
        }).toEqual({
            label: "Field",
            placeholder: "Type to filter",
            groups: [
                ["Fields", ["customer ID — text", "discount — number, sometimes missing", "ID — whole number", "lines — list of lines", "status — one of cancelled, pending, shipped"]],
                ["Inside status", ["cancelled reason — text, sometimes missing (cancelled orders only)", "shipped date — date, sometimes missing (shipped orders only)"]],
                ["Fields", ["total — number"]],
            ],
            active: "total",
            hint: "Fields from the checked type",
            keys: "↑↓ ⏎ esc",
        });
        // A combobox over a listbox, both named by the label; the active offer selected and highlighted, and only it.
        const input = screen.getByRole("combobox", { name: "Field" });
        expect([input.getAttribute("aria-expanded"), input.getAttribute("aria-controls"), input.getAttribute("aria-autocomplete")]).toEqual(["true", list.id, "list"]);
        expect(screen.getByRole("listbox", { name: "Field" })).toBe(list);
        const options = within(list).getAllByRole("option");
        expect(options.map(o => [o.getAttribute("aria-selected"), o.hasAttribute("data-highlighted")])).toEqual(
            options.map(o => (o === option("total") ? ["true", true] : ["false", false])));
        expect(input.getAttribute("aria-activedescendant")).toBe(option("total").id);
    });

    test("the add-step list of one tree: every step with its icon and hint, those that do not fit disabled; the saved queries on the tree, with theirs", () => {
        mount(STEPS);
        expect({ label: popover().querySelector("label")?.textContent, groups: drawn(), active: activeLabel(), hint: popover().querySelector("[data-hint]")?.textContent }).toEqual({
            label: "Add a step",
            groups: [
                ["Add a step", [
                    "[filter] Keep rows where… — Keep only the rows that match DISABLED",
                    "[arrow-right-arrow-left] Look up from another dataset… — Bring in fields from a lookup table by key DISABLED",
                    "[layer-group] Group and total… — One row per group, with totals DISABLED",
                    "[arrow-down-wide-short] Sort by… — Order the rows DISABLED",
                    "[list-ol] Keep the first… — The first rows only DISABLED",
                    "[hashtag] Count the rows — Gives one number DISABLED",
                    "[table-columns] Show only some fields… — Pick and rename fields DISABLED",
                    "[fill-drip] Fill in missing values… — Use a default where a value is missing DISABLED",
                    "[arrow-turn-down] Open each bom's list… — One row per item in a list DISABLED",
                    "[calendar-day] Take part of a date… — Year, month or weekday DISABLED",
                    "[sitemap] List every part in the tree — Walk every nested level",
                    "[chart-line] Try the model over a range… — One row per input value DISABLED",
                ]],
                ["Start from a saved query", ["[bookmark] Pump parts cost — Saved · Tue", "[clock-rotate-left] Every part — Ran · today"]],
            ],
            active: "List every part in the tree",
            hint: "Only steps that fit the current shape",
        });
    });

    test("a value slot's counts: data, each with its meta at its end", () => {
        mount(ITEMS);
        expect({ label: popover().querySelector("label")?.textContent, placeholder: filter().placeholder, groups: drawn(), active: activeLabel() }).toEqual({
            label: "Value",
            placeholder: "Type or pick a value",
            groups: [["Items", ["1 # · item", "2 # · items", "3 # · items", "4 # · items"]]],
            active: "1",
        });
    });

    test("with nothing to offer, it says what to do, and nothing is active", async () => {
        const { onPick } = mount(NO_VALUES);
        expect({
            options: within(listbox()).queryAllByRole("option"),
            empty: popover().querySelector("[data-empty]")?.textContent,
            active: filter().getAttribute("aria-activedescendant"),
            hint: popover().querySelector("[data-hint]")?.textContent,
        }).toEqual({ options: [], empty: "Type a value, then press ⏎.", active: null, hint: "Values from the dataset summary" });
        await act(async () => { fireEvent.keyDown(filter(), { key: "Enter" }); });
        expect(onPick.mock.calls).toEqual([]);
    });
});

// ─── Keys ────────────────────────────────────────────────────────────────────

describe("the slot autocomplete — keys", () => {
    test("↓ and ↑ move over the offers that can be picked, wrapping past the disabled ones", () => {
        mount(STEPS);
        const moves: (string | undefined)[] = [];
        for (const key of ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp", "ArrowUp"]) {
            fireEvent.keyDown(filter(), { key });
            moves.push(activeLabel());
        }
        expect(moves).toEqual(["Pump parts cost", "Every part", "List every part in the tree", "Every part", "Pump parts cost", "List every part in the tree"]);
    });

    test("⏎ and Tab pick the active offer; ⌘⏎ and Ctrl ⏎ pass to the builder and pick nothing; Esc closes", async () => {
        const { onPick, onClose } = mount(STEPS);
        const items = offers(STEPS);
        let passed: boolean[] = [];
        await act(async () => {
            passed = [fireEvent.keyDown(filter(), { key: "Enter", metaKey: true }), fireEvent.keyDown(filter(), { key: "Enter", ctrlKey: true })];
        });
        expect([passed, onPick.mock.calls]).toEqual([[true, true], []]);
        await act(async () => { fireEvent.keyDown(filter(), { key: "Enter" }); });
        // Each key its own event, as a browser delivers them: ↓, then Tab on what ↓ made active.
        fireEvent.keyDown(filter(), { key: "ArrowDown" });
        await act(async () => { fireEvent.keyDown(filter(), { key: "Tab" }); });
        expect([onPick.mock.calls, onClose.mock.calls]).toEqual([[[items[10]], [items[12]]], []]);
        await act(async () => { fireEvent.keyDown(filter(), { key: "Escape" }); });
        expect([onPick.mock.calls.length, onClose.mock.calls]).toEqual([2, [[]]]);
    });
});

// ─── The pointer ─────────────────────────────────────────────────────────────

describe("the slot autocomplete — the pointer", () => {
    test("a click picks; a disabled offer is listed but never picked; the pointer moves the active offer over those that can be", async () => {
        const { onPick } = mount(STEPS);
        const items = offers(STEPS);
        fireEvent.pointerMove(option("Every part"));
        const hovered = activeLabel();
        fireEvent.pointerMove(option("Sort by…"));
        expect([hovered, activeLabel()]).toEqual(["Every part", "Every part"]);
        await act(async () => {
            fireEvent.click(option("Sort by…"));
            fireEvent.click(option("Pump parts cost"));
        });
        expect(onPick.mock.calls).toEqual([[items[12]]]);
    });

    test("a disabled offer's note — why it cannot be picked — is its Tooltip", async () => {
        mount(STEPS);
        fireEvent.pointerMove(option("Keep rows where…"));
        const tip = await screen.findByRole("tooltip");
        expect([tip.textContent, option("Keep rows where…").getAttribute("aria-describedby")]).toEqual(["Needs rows — the query gives one bom tree here", tip.id]);
    });

    test("a press outside it and its slot closes it; a press on its slot or in it does not, and a press in it keeps the filter focused", async () => {
        const { anchor, onClose } = mount(STEPS);
        await act(async () => {
            fireEvent.pointerDown(anchor);
            fireEvent.pointerDown(option("Every part"));
        });
        expect(onClose.mock.calls).toEqual([]);
        // A press on an offer is kept from the filter's blur; one in the filter is its own.
        expect([fireEvent.mouseDown(option("Every part")), fireEvent.mouseDown(filter())]).toEqual([false, true]);
        await act(async () => { fireEvent.pointerDown(document.body); });
        expect(onClose.mock.calls).toEqual([[]]);
    });
});

// ─── Typing and the active offer ─────────────────────────────────────────────

describe("the slot autocomplete — typing and the active offer", () => {
    test("typing tells the host; the offers it gives for the text make their first that can be picked active", async () => {
        const view = mount(FIELD);
        await act(async () => { fireEvent.change(filter(), { target: { value: "s" } }); });
        expect([view.onText.mock.calls, filter().value]).toEqual([[["s"]], "s"]);
        view.update({ text: "s", items: offers(FIELD, "s") });
        expect({ groups: drawn(), active: activeLabel() }).toEqual({
            groups: [
                ["Fields", ["customer ID — text", "discount — number, sometimes missing", "lines — list of lines", "status — one of cancelled, pending, shipped"]],
                ["Inside status", ["cancelled reason — text, sometimes missing (cancelled orders only)", "shipped date — date, sometimes missing (shipped orders only)"]],
            ],
            active: "customer ID",
        });
    });

    test("the host's echo of the text typed moves nothing: an offer moved to before the new offers arrive stays active", async () => {
        const view = mount(FIELD);
        await act(async () => { fireEvent.change(filter(), { target: { value: "s" } }); });
        fireEvent.keyDown(filter(), { key: "ArrowDown" });
        view.update({ text: "s", items: offers(FIELD, "s") });
        expect([filter().value, activeLabel()]).toEqual(["s", "discount"]);
    });

    test("offers recomputed for the same text keep the active offer while it is offered, wherever it moves; else the first that can be picked is active", () => {
        const view = mount(FIELD, { text: "s", items: offers(FIELD, "s"), initialActive: 0 });
        fireEvent.keyDown(filter(), { key: "ArrowDown" });
        fireEvent.keyDown(filter(), { key: "ArrowDown" });
        const moved = activeLabel();
        view.update({ items: offers(FIELD, "s") });
        const kept = activeLabel();
        // An offer before it gone: it moves up one, and stays active.
        view.update({ items: offers(FIELD, "s").filter(item => item.label !== "customer ID") });
        const followed = activeLabel();
        view.update({ items: offers(FIELD, "s").filter(item => item.label !== "lines") });
        expect([moved, kept, followed, activeLabel()]).toEqual(["lines", "lines", "lines", "customer ID"]);
    });

    test("a text the host sets, not the one typed, replaces it, and the first offer is active", async () => {
        const view = mount(FIELD);
        await act(async () => { fireEvent.change(filter(), { target: { value: "s" } }); });
        view.update({ text: "s", items: offers(FIELD, "s") });
        fireEvent.keyDown(filter(), { key: "ArrowDown" });
        view.update({ text: "", items: offers(FIELD) });
        expect([filter().value, activeLabel(), view.onText.mock.calls]).toEqual(["", "customer ID", [["s"]]]);
    });

    test("a value typed is offered first, and ⏎ picks it", async () => {
        const view = mount(ITEMS);
        await act(async () => { fireEvent.change(filter(), { target: { value: "7" } }); });
        view.update({ text: "7", items: offers(ITEMS, "7") });
        expect({ groups: drawn(), active: activeLabel() }).toEqual({ groups: [["Typed", ["Use “7” TYPED"]]], active: "Use “7”" });
        await act(async () => { fireEvent.keyDown(filter(), { key: "Enter" }); });
        expect(view.onPick.mock.calls).toEqual([[{ value: { kind: "value", value: variant("number", 7) }, label: "Use “7”", group: "Typed", typed: true }]]);
    });
});

// ─── Opening and closing ─────────────────────────────────────────────────────

describe("the slot autocomplete — opening and closing", () => {
    test("it opens on initialActive with its filter focused, without scrolling, and the active offer stays in view", () => {
        const focus = vi.spyOn(HTMLElement.prototype, "focus");
        const scroll = vi.fn();
        Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scroll });
        /** The offers scrolled into view, in order, by their labels. */
        const scrolled = (): (string | null | undefined)[] => scroll.mock.contexts.map(o => (o as HTMLElement).querySelector("[data-label]")?.textContent);
        try {
            mount(FIELD);
            const opened = { focused: document.activeElement === filter(), focus: focus.mock.calls, scrolls: scroll.mock.calls, scrolled: scrolled() };
            expect(opened).toEqual({ focused: true, focus: [[{ preventScroll: true }]], scrolls: [[{ block: "nearest" }]], scrolled: ["total"] });
            fireEvent.keyDown(filter(), { key: "ArrowUp" });
            expect([scroll.mock.calls, scrolled()]).toEqual([[[{ block: "nearest" }], [{ block: "nearest" }]], ["total", "shipped date"]]);
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
        const placedBelow = { parent: popover().parentElement === below.bounds, side: popover().getAttribute("data-side"), style: popover().getAttribute("style") };
        cleanup();
        document.body.replaceChildren();
        mount(FIELD, {}, scaled(box(160, 390, 40, 12)));
        const placedAbove = { side: popover().getAttribute("data-side"), style: popover().getAttribute("style") };
        expect([placedBelow, placedAbove]).toEqual([
            { parent: true, side: "below", style: "left: 120px; top: 128px; max-height: 664px;" },
            { side: "above", style: "left: 120px; bottom: 104px; max-height: 688px;" },
        ]);
    });
});
