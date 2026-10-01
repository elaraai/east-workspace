/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Dropping a query into the builder (#939, `Query Editor Spec.md` §4.13, §7
 * D5–D6): the builder's body in its drop target, under the shared drag layer,
 * beside query library cards — drag sources registered through the layer's
 * own public hook, keyed by the saved query's name — and read only through
 * the layer's stage attributes and what it says:
 *
 * - **D5**: a card it takes, dropped on the body, opens its query; armed while
 *   one is dragged, and its words while one rests on it; a card whose query
 *   can't open here refused, its reason said, and not opened; a builder named
 *   by an id takes its own library's cards only; and the keyboard's drag.
 * - **D6**: with no drag layer on the page there is no target, and nothing
 *   throws.
 *
 * jsdom has no layout. As the drag layer's own tests do (east-ui-components'
 * `dnd/dnd.test-utils.ts`, which the package does not export), a pointer drag
 * points `document.elementFromPoint` — the seam the layer hit-tests through —
 * at what the card rests over, and a keyboard drag steps between client rects
 * laid out for it.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useCallback } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { queryKeys } from "@elaraai/e3-ui/internal";
import { DragLayerProvider, system, useDragSourceItem } from "@elaraai/east-ui-components";
import { QueryDropTarget } from "./drops.js";
import { useQueryWords } from "./words.js";

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

// ─── The saved queries the cards name ────────────────────────────────────────

/** A query of five steps, which opens here. */
const TOP = "Top shipped orders, 2026";
/** A query of one step, which opens here. */
const COUNT = "Order count";
/** A query whose steps the builder doesn't know, which opens here. */
const RECENT = "Cancelled orders";
/** A query that reads a data source this builder isn't handed. */
const ELSEWHERE = "Customers by region";
/** Why it can't open here, in the builder's words. */
const REASON = "Reads customers, which isn't here";

/** Each query's steps, by name. */
const STEPS: ReadonlyMap<string, number> = new Map([[TOP, 5], [COUNT, 1], [ELSEWHERE, 2]]);
/** Why a query can't open here, by name. */
const REFUSALS: ReadonlyMap<string, string> = new Map([[ELSEWHERE, REASON]]);
const refusal = (name: string) => REFUSALS.get(name);
const steps = (name: string) => STEPS.get(name);

// ─── The page ────────────────────────────────────────────────────────────────

/** A card of a query library: a drag source under the library's id, keyed and labelled by the query's name. */
function Card({ library, name }: { library: string; name: string }) {
    const drag = useDragSourceItem({ library, key: name, label: name }, <span>{name}</span>);
    return <div data-testid={`card-${name}`} {...drag}>{name}</div>;
}

/** The builder's body — its pane and its results — in its drop target; each query a drop opens is kept in `opened`. */
function Builder({ id, opened }: { id?: string; opened: string[] }) {
    const words = useQueryWords();
    const onOpen = useCallback((name: string) => { opened.push(name); }, [opened]);
    return (
        <QueryDropTarget id={id} refusal={refusal} steps={steps} onOpen={onOpen} words={words}>
            <div data-testid="body">
                <div data-testid="pane" />
                <div data-testid="results" />
            </div>
        </QueryDropTarget>
    );
}

/** The query library's cards beside the builder, under one drag layer. */
function mount() {
    const opened: string[] = [];
    const library = queryKeys(undefined).library;
    const utils = render(
        <ChakraProvider value={system}>
            <DragLayerProvider>
                {[TOP, COUNT, RECENT, ELSEWHERE].map((name) => <Card key={name} library={library} name={name} />)}
                <Builder opened={opened} />
            </DragLayerProvider>
        </ChakraProvider>,
    );
    return { ...utils, opened };
}

// ─── Reading and driving it ──────────────────────────────────────────────────

type Rect = { left: number; top: number; width: number; height: number };

/** Point the layer's hit test at one element, wherever the point is. */
function pointAt(el: Element | null): void {
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => el;
}

/** Lay elements out: each its client rect, and the hit test answering from them. */
function layOut(rects: ReadonlyMap<Element, Rect>): void {
    for (const [el, r] of rects) {
        vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
            left: r.left, top: r.top, width: r.width, height: r.height,
            right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top,
            toJSON: () => ({}),
        } as DOMRect);
    }
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = (x, y) => {
        for (const [el, r] of rects) {
            if (el.isConnected && x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height) return el;
        }
        return null;
    };
}

/** A key on the focused element — the layer's keyboard sensor reads its `code`. */
function press(code: string): void {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: code === "Space" ? " " : code, code });
}

/** The keyboard sensor starts listening on the next task. */
const tick = (): Promise<void> => act(() => new Promise<void>((resolve) => { setTimeout(resolve, 0); }));

/** What the drag layer last said to a screen reader. */
const announced = (): string => document.querySelector("[id^='DndLiveRegion']")?.textContent ?? "";

/** The drop zone: the cell the layer marks. */
const zoneOf = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>("[data-query-drop]")!;

/** The drag stages the layer has marked an element with. */
const stagesOf = (el: HTMLElement): string[] => ["data-drop-valid", "data-drop-active", "data-drop-invalid"].filter((a) => el.hasAttribute(a));

/** The target's words as drawn — the query a drop opens, and its steps — or `null` with no target. */
function wordsOf(c: HTMLElement): (string | null)[] | null {
    const target = c.querySelector("[data-query-drop-target]");
    return target === null ? null : [...target.children].map((el) => el.textContent);
}

/**
 * Pick a card up and hold it over an element: the move travels past the
 * layer's 4px, so the drag engages on it.
 *
 * @param card - The card
 * @param over - What it rests over, or nothing
 * @returns Let go there
 */
async function hold(card: HTMLElement, over: Element | null): Promise<() => Promise<void>> {
    await act(async () => {
        fireEvent.pointerDown(card, { pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 0 });
        pointAt(over);
        fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 });
    });
    return async () => {
        await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 }); });
    };
}

/** Rest a held card over another element. */
async function moveOver(over: Element | null): Promise<void> {
    await act(async () => {
        pointAt(over);
        fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 20, clientY: 20 });
    });
}

/** Cancel the drag in flight. */
async function cancel(): Promise<void> {
    await act(async () => { fireEvent.keyDown(document, { key: "Escape", code: "Escape" }); });
}

// ─── D5 ──────────────────────────────────────────────────────────────────────

describe("<QueryDropTarget> — a query library's card dropped on the builder (#939 D5)", () => {
    test("a card it takes, dropped on the body, opens its query — and the layer says where it rests and where it landed", async () => {
        const { getByTestId, opened } = mount();
        const letGo = await hold(getByTestId(`card-${TOP}`), getByTestId("results"));
        expect(announced()).toBe(`${TOP} is over the query builder.`);
        await letGo();
        expect(opened).toEqual([TOP]);
        expect(announced()).toBe(`${TOP} was dropped on the query builder.`);
    });

    test("armed while a card it takes is dragged; over while one rests on the body — the pane or the results — with what a drop opens and its steps; nothing left behind", async () => {
        const { container, getByTestId, opened } = mount();
        const zone = zoneOf(container);
        // At rest: the body in its zone, no stage, no target.
        expect(zone.contains(getByTestId("body"))).toBe(true);
        expect([stagesOf(zone), wordsOf(container)]).toEqual([[], null]);

        // Dragged, not over the builder: armed — the target's CSS draws its dashed frame.
        await hold(getByTestId(`card-${TOP}`), null);
        expect(stagesOf(zone)).toEqual(["data-drop-valid"]);
        // Resting on the pane, then the results — the one cell: over, and its words.
        await moveOver(getByTestId("pane"));
        expect(stagesOf(zone)).toEqual(["data-drop-valid", "data-drop-active"]);
        expect(wordsOf(container)).toEqual([`Drop to open “${TOP}”`, "5 steps."]);
        await moveOver(getByTestId("results"));
        expect(stagesOf(zone)).toEqual(["data-drop-valid", "data-drop-active"]);
        await cancel();
        expect([stagesOf(zone), wordsOf(container)]).toEqual([[], null]);

        // A query of one step; a query whose steps the builder doesn't know says only what a drop opens.
        await hold(getByTestId(`card-${COUNT}`), getByTestId("results"));
        expect(wordsOf(container)).toEqual([`Drop to open “${COUNT}”`, "1 step."]);
        await cancel();
        const letGo = await hold(getByTestId(`card-${RECENT}`), getByTestId("results"));
        expect(wordsOf(container)).toEqual([`Drop to open “${RECENT}”`]);
        await letGo();
        expect([stagesOf(zone), wordsOf(container), opened]).toEqual([[], null, [RECENT]]);
    });

    test("a card whose query can't open here is refused where it rests — the ⊘ stage, and the layer says why — and its drop opens nothing", async () => {
        const { container, getByTestId, opened } = mount();
        const zone = zoneOf(container);
        const letGo = await hold(getByTestId(`card-${ELSEWHERE}`), getByTestId("results"));
        // Never armed: refused from the drag's start, and ⊘ where it rests.
        expect(stagesOf(zone)).toEqual(["data-drop-invalid"]);
        expect(announced()).toBe(`the query builder (${REASON}) does not take ${ELSEWHERE}.`);
        await letGo();
        expect(opened).toEqual([]);
        expect(announced()).toBe(`${ELSEWHERE} was not dropped.`);
        expect(stagesOf(zone)).toEqual([]);
        // Another card lands there.
        await (await hold(getByTestId(`card-${TOP}`), getByTestId("results")))();
        expect(opened).toEqual([TOP]);
    });

    test("a builder named by an id takes the cards of the query library of that id — and no other library's", async () => {
        const opened: string[] = [];
        const { container, getByTestId } = render(
            <ChakraProvider value={system}>
                <DragLayerProvider>
                    <Card library={queryKeys("north").library} name={TOP} />
                    <Card library={queryKeys(undefined).library} name={COUNT} />
                    <Builder id="north" opened={opened} />
                </DragLayerProvider>
            </ChakraProvider>,
        );
        const zone = zoneOf(container);
        // Another library's card: the builder is no destination for it — never armed, never over — and its drop opens nothing.
        const other = await hold(getByTestId(`card-${COUNT}`), getByTestId("results"));
        expect(stagesOf(zone)).toEqual([]);
        await other();
        expect(opened).toEqual([]);
        // Its own library's card opens.
        await (await hold(getByTestId(`card-${TOP}`), getByTestId("results")))();
        expect(opened).toEqual([TOP]);
    });

    test("the keyboard: Space picks a card up, an arrow rests it on the body, Space drops it — and opens its query", async () => {
        Element.prototype.scrollIntoView ??= function scrollIntoView() { /* jsdom does not scroll */ };
        const { container, getByTestId, opened } = mount();
        const card = getByTestId(`card-${TOP}`);
        const zone = zoneOf(container);
        // The card at the left, the builder's body to its right.
        layOut(new Map([[card, { left: 0, top: 0, width: 120, height: 30 }], [zone, { left: 200, top: 0, width: 600, height: 400 }]]));
        card.focus();
        press("Space");
        await tick();
        expect(announced()).toBe(`Picked up ${TOP}.`);
        press("ArrowRight");
        expect(stagesOf(zone)).toEqual(["data-drop-valid", "data-drop-active"]);
        expect(wordsOf(container)).toEqual([`Drop to open “${TOP}”`, "5 steps."]);
        expect(announced()).toBe(`${TOP} is over the query builder.`);
        // The drop: the layer's overlay settles it a microtask later, inside the act.
        await act(async () => { press("Space"); });
        expect(opened).toEqual([TOP]);
        expect(announced()).toBe(`${TOP} was dropped on the query builder.`);
    });
});

// ─── D6 ──────────────────────────────────────────────────────────────────────

describe("<QueryDropTarget> — no drag layer, no target (#939 D6)", () => {
    test("without a DragLayerProvider the body renders alone — in no zone and no drop cell, with no target — and nothing throws", () => {
        const opened: string[] = [];
        const { container, getByTestId } = render(
            <ChakraProvider value={system}>
                <Card library={queryKeys(undefined).library} name={TOP} />
                <Builder opened={opened} />
            </ChakraProvider>,
        );
        const body = getByTestId("body");
        expect([body.closest("[data-query-drop]"), body.closest("[data-drag-cell]")]).toEqual([null, null]);
        expect(container.querySelector("[data-query-drop-target]")).toBeNull();
        // The library's card is no drag source without a layer either.
        expect(getByTestId(`card-${TOP}`).hasAttribute("tabindex")).toBe(false);
        expect(opened).toEqual([]);
    });
});
