/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Configure tab's Follows block (#1673, LNK-3 to LNK-5, LNK-7), drawn: a
 * visual that follows none says what following does; its chooser offers the
 * page's visuals whose click selects, one whose link would make a cycle
 * refused; picking one links it, the match filling itself where both read one
 * source and proposed by name and kind across sources; the match's two fields,
 * what it shows with nothing selected, and Stop following each edit it.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Studio, type StudioCellType, type StudioSourceType } from "@elaraai/e3-ui/internal";
import { StateRuntime, UIStore, system } from "@elaraai/east-ui-components";
import { LISTED_ORDERS } from "../query/visual/visual.test-utils.js";
import { StudioFollows, type ConfigurePlacement } from "./follows.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });
afterEach(() => { cleanup(); });

const v = Studio.visual;
type Cell = ValueTypeOf<typeof StudioCellType>;
type Visual = Extract<Cell["content"], { type: "visual" }>["value"];
type Source = ValueTypeOf<typeof StudioSourceType>;

const cell = (key: string, content: Cell["content"]): Cell => ({ key, row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content });
const visualOf = (of: Cell): Visual => {
    if (of.content.type !== "visual") throw new Error("not a visual");
    return of.content.value;
};

/** Dispatches, named as another system names an order's fields. */
const DISPATCH: Source = {
    ...LISTED_ORDERS, key: "dispatch", name: "Dispatch",
    fields: [
        { id: "sent_at", label: "Sent", kind: variant("date", null), format: none },
        { id: "customer_id", label: "Customer id", kind: variant("text", null), format: none },
        { id: "depot", label: "Depot", kind: variant("text", null), format: none },
    ],
};

const customers = cell("c-customers", v.of("orders", v.list({ item: v.group("customer"), values: [v.sum("revenue")] })));
const regions = cell("c-regions", v.of("orders", v.bar({ x: v.group("region"), values: [v.sum("revenue")] })));
const months = cell("c-months", v.of("orders", v.column({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")] })));
const sent = cell("c-sent", v.of("dispatch", v.column({ x: v.group("sent_at", { bucket: "month" }), values: [v.count()] })));
const NAMES: Record<string, string> = { "c-customers": "Top customers", "c-regions": "Revenue by region", "c-months": "Revenue by month", "c-sent": "Dispatches by month" };
const placed = (cells: Cell[]): ConfigurePlacement[] => cells.map((of) => ({ cell: of, name: NAMES[of.key]! }));

/** The block over a follower among the page's placements, and each visual it wrote. */
function mount(follower: Cell, cells: Cell[]) {
    const edits: Visual[] = [];
    const field = ({ label, part, hint, children }: { label: string; part: string; hint?: string | undefined; children: ReactNode }) => (
        <div key={label} data-field={label} data-part={part}>{children}{hint !== undefined && <p data-hint="">{hint}</p>}</div>
    );
    const { container } = render(
        <ChakraProvider value={system}>
            <StudioFollows placement={follower.key} visual={visualOf(follower)} placements={placed(cells)} sources={[LISTED_ORDERS, DISPATCH]} field={field}
                onEdit={(visual) => { edits.push(visual); }} />
        </ChakraProvider>,
    );
    return { container, edits };
}

const press = async (el: Element) => { await act(async () => { fireEvent.click(el); }); };
const fields = (container: HTMLElement) => [...container.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field"));
const hints = (container: HTMLElement) => [...container.querySelectorAll("[data-hint]")].map((el) => el.textContent);
/** A follower of the customers list, on the customer. */
const following = (empty: "all" | "prompt", to = "customer") => ({ follow: { leader: "c-customers", from: "customer", to, empty: variant(empty, null) } });

describe("the Follows block (#1673)", () => {
    test("a visual that follows none says so, and what following does; its chooser offers Nothing and the page's visuals whose click selects — a chart whose click filters is none", async () => {
        const { container } = mount(months, [customers, regions, months]);
        expect(fields(container)).toEqual(["Follows"]);
        expect(container.querySelector("[data-configure-follows]")!.textContent).toBe("Nothing");
        expect(hints(container)).toEqual(["Pick a visual whose click selects: this one then shows what is selected there."]);
        await press(container.querySelector("[data-configure-follows]")!);
        expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Nothing", "Top customersList · Orders"]);
    });

    test("picking a leader links it: the match fills itself where both read one source, and it shows everything until something is selected", async () => {
        const { container, edits } = mount(months, [customers, regions, months]);
        await press(container.querySelector("[data-configure-follows]")!);
        await press(screen.getByRole("option", { name: /Top customers/ }));
        expect(edits.map((visual) => visual.follow)).toEqual([some({ leader: "c-customers", from: "customer", to: "customer", empty: variant("all", null) })]);
    });

    test("across sources the match is proposed by name and kind: the customer against the dispatch's customer id", async () => {
        const { container, edits } = mount(sent, [customers, sent]);
        await press(container.querySelector("[data-configure-follows]")!);
        await press(screen.getByRole("option", { name: /Top customers/ }));
        expect(edits.map((visual) => visual.follow.type === "some" && [visual.follow.value.from, visual.follow.value.to])).toEqual([["customer", "customer_id"]]);
    });

    test("a visual that follows shows its leader, the match in each source's words, what it shows with nothing selected, and Stop following", async () => {
        const follower = cell("c-sent", v.of("dispatch", v.column({ x: v.group("sent_at", { bucket: "month" }), values: [v.count()] }), following("all", "customer_id")));
        const { container, edits } = mount(follower, [customers, follower]);
        expect(fields(container)).toEqual(["Follows", "Match", "With nothing selected"]);
        expect(container.querySelector("[data-configure-follows]")!.textContent).toBe("Top customers");
        expect([container.querySelector("[data-configure-match-from]")!.textContent, container.querySelector("[data-configure-match-to]")!.textContent]).toEqual(["Customer", "Customer id"]);
        expect(hints(container)).toEqual(["Orders' Customer against Dispatch's Customer id."]);
        // This visual's field: any of its source's.
        await press(container.querySelector("[data-configure-match-to]")!);
        expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Sent", "Customer id", "Depot"]);
        await press(screen.getByRole("option", { name: "Depot" }));
        // What it shows with nothing selected.
        await press(screen.getByRole("button", { name: "Ask to pick" }));
        await press(container.querySelector("[data-configure-stop-following]")!);
        expect(edits.map((visual) => (visual.follow.type === "some" ? [visual.follow.value.to, visual.follow.value.empty.type] : "none")))
            .toEqual([["depot", "all"], ["customer_id", "prompt"], "none"]);
    });

    test("a leader whose link would make a cycle is refused, saying why, and picking Nothing takes the link off", async () => {
        // The customers list follows the months chart, whose click selects: the months chart may not follow it back.
        const leading = cell("c-months", v.of("orders", v.column({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")] }), { click: variant("select", null) }));
        const back = cell("c-customers", v.of("orders", v.list({ item: v.group("customer"), values: [v.sum("revenue")] }), { follow: { leader: "c-months", from: "ordered_at", to: "ordered_at", empty: variant("all", null) } }));
        const refused = mount(leading, [back, leading]);
        await press(refused.container.querySelector("[data-configure-follows]")!);
        const option = screen.getByRole("option", { name: /Top customers/ });
        expect(option.textContent).toContain("It follows this visual already");
        await press(option);
        expect(refused.edits).toEqual([]);
    });

    test("Nothing takes the link off", async () => {
        const follower = cell("c-months", v.of("orders", v.column({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")] }), following("all")));
        const { container, edits } = mount(follower, [customers, follower]);
        await press(container.querySelector("[data-configure-follows]")!);
        await press(screen.getByRole("option", { name: "Nothing" }));
        expect(edits.map((visual) => visual.follow)).toEqual([none]);
    });
});
