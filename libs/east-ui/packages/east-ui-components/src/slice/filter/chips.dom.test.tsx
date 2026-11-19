/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A row of filter chips (`chips.tsx`, #1673). One whose editors apply each
 * edit as it is made (`live`): a filter's popover keeps Remove filter and
 * holds no Cancel, and the new filter's holds no Done — neither says an edit
 * waits for them; a row whose editors wait keeps both. While an editor is
 * open the row stands as it stood as the editor opened — its chips' words and
 * how many there are — and holds the rail it is drawn in, letting both go once
 * no editor is open and the press that shut the last has clicked; a filter
 * taken out meanwhile leaves it at once. A chip given its whole words says
 * them on hover, its label cut where it runs long. Chips in groups are drawn
 * each group's together, the group named once before its first, in the order
 * the host names the groups, each chip still the host's by its place; a group
 * folded whole goes unnamed, and `+N more` lists the filters under their
 * groups' names.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { useState } from "react";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { SliceRailHold } from "../rail/hold.js";
import { SliceFilterChips, type SliceFilterChip } from "./chips.js";

afterEach(cleanup);

/** The popover's positioner observes sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}
beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverStub); });
afterEach(() => { vi.unstubAllGlobals(); });

/** One filter's row, its editors applying each edit as it is made or not. */
function Row({ live }: { live: boolean }) {
    return (
        <ChakraProvider value={system}>
            <SliceFilterChips density="focused" live={live} onRemove={() => undefined} onClear={() => undefined}
                chips={[{ label: "region is SA", editLabel: "Filter on Orders", large: true, editor: () => <div>its rows</div> }]}
                add={() => <div>a new filter's rows</div>} />
        </ChakraProvider>
    );
}

/** Opens a popover by its trigger, and names the buttons in its foot. */
async function footOf(trigger: HTMLElement): Promise<string[]> {
    await act(async () => { fireEvent.click(trigger); await Promise.resolve(); });
    const content = document.querySelector("[data-scope='popover'][data-part='content'][data-state='open']");
    expect(content, "the popover opened").not.toBeNull();
    const words = [...content!.querySelectorAll("button")].map((b) => b.textContent ?? "").filter((t) => t !== "");
    await act(async () => { fireEvent.click(trigger); await Promise.resolve(); });
    return words;
}

describe("a row of filter chips whose editors apply each edit as it is made", () => {
    test("live: a filter's popover keeps Remove filter and holds no Cancel; the new filter's holds no Done", async () => {
        render(<Row live />);
        expect(await footOf(document.querySelector<HTMLElement>("[data-slice-clause]")!)).toEqual(["Remove filter"]);
        expect(await footOf(screen.getByRole("button", { name: "Add filter" }))).toEqual([]);
    });

    test("waiting: a filter's popover has Remove filter and Cancel, and the new filter's Done", async () => {
        render(<Row live={false} />);
        expect(await footOf(document.querySelector<HTMLElement>("[data-slice-clause]")!)).toEqual(["Remove filter", "Cancel"]);
        expect(await footOf(screen.getByRole("button", { name: "Add filter" }))).toEqual(["Done"]);
    });
});

/**
 * A host whose editors apply each edit as it is made: a chip's lengthens its own words, or takes the other filters
 * out; the new filter's adds one. Each chip's whole words are its label's, said in full, unless told.
 */
function LiveRow({ hold, wholes = true }: { hold?: ((holding: boolean) => void) | undefined; wholes?: boolean }) {
    const [labels, setLabels] = useState(["Region: SA", "Units: more than 1"]);
    const chips = labels.map((label, i): SliceFilterChip => ({
        label,
        ...(wholes ? { whole: `${label} — said whole` } : {}),
        editLabel: "Filter on Orders",
        large: true,
        editor: () => (
            <div>
                <button type="button" onClick={() => setLabels((was) => was.map((held, j) => (j === i ? `${held} +1` : held)))}>Edit</button>
                <button type="button" onClick={() => setLabels((was) => was.filter((_held, j) => j === i))}>Remove the rest</button>
            </div>
        ),
    }));
    const row = (
        <SliceFilterChips density="focused" live chips={chips} onRemove={(i) => setLabels((was) => was.filter((_held, j) => j !== i))}
            onClear={() => setLabels([])} add={() => <button type="button" onClick={() => setLabels((was) => [...was, "Revenue: at least 100"])}>Add</button>} />
    );
    return <ChakraProvider value={system}>{hold === undefined ? row : <SliceRailHold.Provider value={hold}>{row}</SliceRailHold.Provider>}</ChakraProvider>;
}

/** The row's chips' words, in order. */
const words = () => [...document.querySelectorAll("[data-slice-clause]")].map((chip) => chip.textContent);
/** A chip of the row, by its place. */
const chipAt = (i: number) => document.querySelector<HTMLElement>(`[data-slice-clause='${i}']`)!;
/** Clicks a control, React's updates and the popover's let land. */
const press = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); await Promise.resolve(); }); };
/** Esc, as the open popover hears it. */
const escape = async () => { await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await Promise.resolve(); }); };
/** A pointer pressed or released somewhere on the page, as the window hears it. */
const pointer = async (type: "pointerdown" | "pointerup") => {
    await act(async () => {
        document.body.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", buttons: type === "pointerdown" ? 1 : 0, bubbles: true }));
        await Promise.resolve();
    });
};
/** The task after this one: where a release's click has landed. */
const nextTask = async () => { await act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, 0); }); }); };

describe("a row held still while an editor is open (#1673)", () => {
    test("keeps a chip's words as they stood while its editor changes them, and says them once it shuts", async () => {
        render(<LiveRow />);
        await press(chipAt(0));
        await press(screen.getByRole("button", { name: "Edit" }));
        await press(screen.getByRole("button", { name: "Edit" }));
        expect(words()).toEqual(["Region: SA", "Units: more than 1"]);
        await escape();
        expect(words()).toEqual(["Region: SA +1 +1", "Units: more than 1"]);
    });

    test("keeps a filter the new filter's editor adds off the row until the editor shuts", async () => {
        render(<LiveRow />);
        await press(screen.getByRole("button", { name: "Add filter" }));
        await press(screen.getByRole("button", { name: "Add" }));
        expect(words()).toEqual(["Region: SA", "Units: more than 1"]);
        await escape();
        expect(words()).toEqual(["Region: SA", "Units: more than 1", "Revenue: at least 100"]);
    });

    test("takes a filter out of the row at once, while it holds the rest", async () => {
        render(<LiveRow />);
        await press(chipAt(0));
        await press(screen.getByRole("button", { name: "Edit" }));
        await press(screen.getByRole("button", { name: "Remove the rest" }));
        expect(words()).toEqual(["Region: SA +1"]);
    });

    test("holds the rail while an editor is open, and lets it go once none is", async () => {
        const told: boolean[] = [];
        render(<LiveRow hold={(holding) => told.push(holding)} />);
        expect(told).toEqual([]);
        await press(chipAt(0));
        expect(told).toEqual([true]);
        await escape();
        expect(told).toEqual([true, false]);
    });

    test("an editor shut while a press is in progress: the row lets go once the press has clicked — and a click that opens another editor keeps it held", async () => {
        const told: boolean[] = [];
        render(<LiveRow hold={(holding) => told.push(holding)} />);
        await press(chipAt(0));
        await press(screen.getByRole("button", { name: "Edit" }));
        // A press: the editor shuts before it clicks.
        await pointer("pointerdown");
        await escape();
        await pointer("pointerup");
        expect([told, words()]).toEqual([[true], ["Region: SA", "Units: more than 1"]]);
        // Its click lands on the other chip, where the row stood: that chip's editor opens, the row held.
        await press(chipAt(1));
        await nextTask();
        expect([told, words()]).toEqual([[true], ["Region: SA", "Units: more than 1"]]);
        // A press that clicks nothing lets go once its click would have landed.
        await pointer("pointerdown");
        await escape();
        await pointer("pointerup");
        expect(told).toEqual([true]);
        await nextTask();
        expect([told, words()]).toEqual([[true, false], ["Region: SA +1", "Units: more than 1"]]);
    });

    test("a row that never held lets go of nothing: another drawn beside it — as one drawn to be measured is — mounts and goes, the hold untouched", async () => {
        const told: string[] = [];
        const first = (holding: boolean) => told.push(`first ${holding}`);
        const second = (holding: boolean) => told.push(`second ${holding}`);
        const Rows = ({ both }: { both: boolean }) => <><LiveRow hold={first} />{both && <LiveRow hold={second} />}</>;
        const { rerender } = render(<Rows both={false} />);
        await press(chipAt(0));
        rerender(<Rows both />);
        rerender(<Rows both={false} />);
        expect(told).toEqual(["first true"]);
    });
});

describe("a chip's words", () => {
    test("say its whole words on hover where it is given them, its label cut where it runs long; else its label, uncut", () => {
        render(<LiveRow />);
        expect([chipAt(0).title, chipAt(0).hasAttribute("data-chip-cut")]).toEqual(["Region: SA — said whole", true]);
        cleanup();
        render(<LiveRow wholes={false} />);
        expect([chipAt(0).title, chipAt(0).hasAttribute("data-chip-cut")]).toEqual(["Region: SA", false]);
    });
});

/** The datasets the grouped row's filters are on, by key: the order its host names them in. */
const DATASETS: Record<string, string> = { orders: "Orders", stock: "Stock" };

/**
 * Filters on two datasets, as a host gives them — interleaved, in the order they were added — each chip's group its
 * dataset. A chip's editor adds a filter on the orders.
 */
function GroupedRow({ density = "focused", foldChips }: { density?: "compact" | "focused"; foldChips?: number }) {
    const [held, setHeld] = useState([
        { on: "orders", label: "Region: SA" }, { on: "stock", label: "Site: North" }, { on: "orders", label: "Units: more than 1" },
    ]);
    const chips = held.map((filter): SliceFilterChip => ({
        label: filter.label,
        whole: `${filter.label} — said whole`,
        group: { key: filter.on, label: DATASETS[filter.on]! },
        editLabel: "Filter",
        large: true,
        editor: () => <button type="button" onClick={() => setHeld((was) => [...was, { on: "orders", label: "Revenue: at least 100" }])}>Add on orders</button>,
    }));
    return (
        <ChakraProvider value={system}>
            <SliceFilterChips density={density} foldChips={foldChips} live chips={chips} groups={Object.keys(DATASETS)}
                onRemove={(i) => setHeld((was) => was.filter((_filter, j) => j !== i))} onClear={() => setHeld([])} add={() => null} />
        </ChakraProvider>
    );
}

/** The row as drawn: each group's name and each chip's words, in order. */
const drawnRow = () => [...document.querySelectorAll("[data-slice-chip-group], [data-slice-clause]")].map((el) => el.textContent);
/** The host's place of each chip, in the order the row draws them. */
const places = () => [...document.querySelectorAll("[data-slice-clause]")].map((el) => el.getAttribute("data-slice-clause"));

describe("a row of chips in groups (#1673)", () => {
    test("draws each group's chips together, the group named once before its first, the groups as the host names them; each chip is still the host's by its place", async () => {
        render(<GroupedRow />);
        expect([drawnRow(), places()]).toEqual([["Orders", "Region: SA", "Units: more than 1", "Stock", "Site: North"], ["0", "2", "1"]]);
        // The × of the chip drawn second takes out the host's third filter.
        await press(chipAt(2).querySelector<HTMLElement>("[data-chip-remove]")!);
        expect(drawnRow()).toEqual(["Orders", "Region: SA", "Stock", "Site: North"]);
    });

    test("a group's first filter taken out moves no group, and Delete hands the focus to the chip drawn in its place", async () => {
        render(<GroupedRow />);
        chipAt(0).focus();
        await act(async () => { fireEvent.keyDown(chipAt(0), { key: "Delete" }); await Promise.resolve(); });
        // Stock's filter is now the host's first; the orders still draw first.
        expect([drawnRow(), places()]).toEqual([["Orders", "Units: more than 1", "Stock", "Site: North"], ["1", "0"]]);
        expect(document.activeElement).toBe(chipAt(1));
    });

    test("a filter added on the orders while an editor is open stays off the row as it stood; once shut, it joins its group", async () => {
        render(<GroupedRow />);
        await press(chipAt(0));
        await press(screen.getByRole("button", { name: "Add on orders" }));
        expect(drawnRow()).toEqual(["Orders", "Region: SA", "Units: more than 1", "Stock", "Site: North"]);
        await escape();
        expect(drawnRow()).toEqual(["Orders", "Region: SA", "Units: more than 1", "Revenue: at least 100", "Stock", "Site: North"]);
    });

    test("folded: a group folded whole into +N more goes unnamed in the row, and +N more lists every filter under its group's name", async () => {
        render(<GroupedRow density="compact" foldChips={1} />);
        expect(drawnRow()).toEqual(["Orders", "Region: SA", "Units: more than 1"]);
        await press(document.querySelector<HTMLElement>("[data-slice-more]")!);
        const listed = [...document.querySelectorAll("[data-slice-more-group], [data-slice-more-row] > span")].map((el) => el.textContent);
        expect(listed).toEqual(["Orders", "Region: SA — said whole", "Units: more than 1 — said whole", "Stock", "Site: North — said whole"]);
    });

    test("chips in no group: no name is drawn, in the row or in +N more", async () => {
        render(<LiveRow />);
        expect(document.querySelectorAll("[data-slice-chip-group]")).toHaveLength(0);
        cleanup();
        render(
            <ChakraProvider value={system}>
                <SliceFilterChips density="compact" foldChips={1} live onRemove={() => undefined} onClear={() => undefined} add={() => null}
                    chips={["Region: SA", "Units: more than 1"].map((label): SliceFilterChip => ({ label, editLabel: "Filter", editor: () => null }))} />
            </ChakraProvider>,
        );
        await press(document.querySelector<HTMLElement>("[data-slice-more]")!);
        expect([document.querySelectorAll("[data-slice-chip-group], [data-slice-more-group]").length, document.querySelectorAll("[data-slice-more-row]").length]).toEqual([0, 2]);
    });
});
