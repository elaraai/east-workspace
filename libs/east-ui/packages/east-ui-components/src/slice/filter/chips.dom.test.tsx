/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A row of filter chips (`chips.tsx`, #1673). An editor's actions stand in
 * its popover's foot: for one that submits by itself, Remove filter and
 * Cancel, and a new filter's Done; for one whose edits wait for its button,
 * Cancel and Apply — or Add filter — the button off until the editor tells
 * the row a draft it has something to do with, and nothing done until it is
 * pressed. A filter `+N more` holds is edited there, in the same popover, its
 * actions giving the list back — the focus going with what it shows, back to
 * the filter's line, never left on nothing nor on Clear all; left with no
 * filter to hold, it is shut, and the row lets go. While an editor is
 * open the row stands as it stood as the editor opened — its chips' words and
 * how many there are — and holds the rail it is drawn in, letting both go once
 * no editor is open and the press that shut the last has clicked; a filter
 * taken out meanwhile leaves it at once. A chip given its whole words says
 * them on hover, its label cut where it runs long. Chips in groups are drawn
 * each group's together, the group named once before its first, in the order
 * the host names the groups, each chip still the host's by its place; a group
 * folded whole goes unnamed, and `+N more` holds the filters the row folds —
 * none it shows — under their groups' names, each line's × taking out its own
 * filter alone.
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

/** One filter's row, whose editors submit by themselves. */
function Row() {
    return (
        <ChakraProvider value={system}>
            <SliceFilterChips density="focused" onRemove={() => undefined} onClear={() => undefined}
                chips={[{ label: "region is SA", editLabel: "Filter on Orders", editor: () => <div>its rows</div> }]} rows
                add={() => <div>a new filter's rows</div>} />
        </ChakraProvider>
    );
}

/**
 * A row whose editors' edits wait for their button: an editor tells the row a region as its draft; Apply makes it the
 * filter's — or, told the empty word, takes the filter out — and Add filter adds one of it. What was done is noted.
 * It folds a number of its last chips, or — told how many it shows — the rest of them.
 */
function DraftRow({ foldChips: folds, shows, done }: { foldChips?: number; shows?: number; done: string[] }) {
    const [regions, setRegions] = useState(["SA", "VIC", "QLD"]);
    // Told how many it shows, the row folds the rest — none, once no more are left than it shows.
    const foldChips = shows === undefined ? folds : Math.max(0, regions.length - shows);
    const chips = regions.map((region, i): SliceFilterChip<string> => ({
        label: `Region: ${region}`,
        editLabel: `Filter ${region}`,
        editor: (_close, tell) => (
            <div>
                <button type="button" onClick={() => tell("NSW")}>Pick NSW</button>
                <button type="button" onClick={() => tell("")}>Remove every condition</button>
                <button type="button" onClick={() => tell(region)}>Pick what it holds</button>
            </div>
        ),
        apply: (draft) => (draft === undefined || draft === region ? undefined : () => {
            done.push(draft === "" ? `removed ${region}` : `${region} is ${draft}`);
            setRegions((was) => (draft === "" ? was.filter((_held, j) => j !== i) : was.map((held, j) => (j === i ? draft : held))));
        }),
    }));
    return (
        <ChakraProvider value={system}>
            <SliceFilterChips<string> density={foldChips === undefined ? "focused" : "compact"} foldChips={foldChips} chips={chips} rows
                onRemove={(i) => { done.push(`removed ${regions[i]}`); setRegions((was) => was.filter((_held, j) => j !== i)); }} onClear={() => setRegions([])}
                add={(_close, tell) => <button type="button" onClick={() => tell("WA")}>Write WA</button>}
                addApply={(draft) => (draft === undefined ? undefined : () => { done.push(`added ${draft}`); setRegions((was) => [...was, draft]); })} />
        </ChakraProvider>
    );
}

/** The open popover. */
const opened = () => document.querySelector<HTMLElement>("[data-scope='popover'][data-part='content'][data-state='open']");
/**
 * A button of the open popover, by its words. By its words, not its role: jsdom never ends the animation a popover
 * leaves by, so one opened a second time is still marked hidden to the accessibility tree a role is found in.
 */
const inPopover = (words: string): HTMLElement => {
    const found = [...(opened()?.querySelectorAll<HTMLElement>("button") ?? [])].find((b) => b.textContent === words);
    if (found === undefined) throw new Error(`the open popover holds no button “${words}”`);
    return found;
};
/** The open popover's head's words, and its foot's buttons — each off one marked. */
const popoverNow = () => {
    const content = opened();
    if (content === null) return null;
    const foot = [...content.querySelectorAll<HTMLButtonElement>("button")].filter((b) => /^(Remove filter|Cancel|Apply|Add filter|Done|Clear all)$/.test(b.textContent ?? ""));
    return {
        head: content.querySelector("button[aria-label='Close']")!.parentElement!.querySelector("span")!.textContent,
        foot: foot.map((b) => `${b.textContent}${b.disabled ? " (off)" : ""}`),
    };
};

/** Opens a popover by its trigger, and names the buttons in its foot. */
async function footOf(trigger: HTMLElement): Promise<string[]> {
    await act(async () => { fireEvent.click(trigger); await Promise.resolve(); });
    const content = document.querySelector("[data-scope='popover'][data-part='content'][data-state='open']");
    expect(content, "the popover opened").not.toBeNull();
    const words = [...content!.querySelectorAll("button")].map((b) => b.textContent ?? "").filter((t) => t !== "");
    await act(async () => { fireEvent.click(trigger); await Promise.resolve(); });
    return words;
}

describe("an editor's actions, in its popover's foot", () => {
    test("an editor that submits by itself: a filter's foot holds Remove filter and Cancel, and the new filter's Done", async () => {
        render(<Row />);
        expect(await footOf(document.querySelector<HTMLElement>("[data-slice-clause]")!)).toEqual(["Remove filter", "Cancel"]);
        expect(await footOf(screen.getByRole("button", { name: "Add filter" }))).toEqual(["Done"]);
    });

    test("a filter whose edits wait: Remove filter, Cancel and Apply — Apply off until its editor tells a draft with something to do, then doing it once and shutting", async () => {
        const done: string[] = [];
        render(<DraftRow done={done} />);
        await press(chipAt(0));
        expect(popoverNow()).toEqual({ head: "Filter SA", foot: ["Remove filter", "Cancel", "Apply (off)"] });
        await press(inPopover("Pick NSW"));
        // Nothing is done by the edit: the row says what it said, and Apply stands on.
        expect([popoverNow()!.foot, done, words()]).toEqual([["Remove filter", "Cancel", "Apply"], [], ["Region: SA", "Region: VIC", "Region: QLD"]]);
        // A draft that says what the filter holds leaves Apply nothing to do.
        await press(inPopover("Pick what it holds"));
        expect(popoverNow()!.foot).toEqual(["Remove filter", "Cancel", "Apply (off)"]);
        await press(inPopover("Pick NSW"));
        await press(inPopover("Apply"));
        expect([opened(), done, words()]).toEqual([null, ["SA is NSW"], ["Region: NSW", "Region: VIC", "Region: QLD"]]);
    });

    test("Cancel, and Esc, throw the draft away: nothing is done, and the editor opened again starts with none", async () => {
        const done: string[] = [];
        render(<DraftRow done={done} />);
        await press(chipAt(0));
        await press(inPopover("Pick NSW"));
        await press(inPopover("Cancel"));
        expect([opened(), done, words()]).toEqual([null, [], ["Region: SA", "Region: VIC", "Region: QLD"]]);
        await press(chipAt(0));
        expect(popoverNow()!.foot).toEqual(["Remove filter", "Cancel", "Apply (off)"]);
        await press(inPopover("Pick NSW"));
        await escape();
        await press(chipAt(1));
        // Another filter's editor is given no draft of the first's.
        expect([popoverNow(), done]).toEqual([{ head: "Filter VIC", foot: ["Remove filter", "Cancel", "Apply (off)"] }, []]);
    });

    test("every condition removed, Apply takes the filter out; Remove filter does at once", async () => {
        const done: string[] = [];
        render(<DraftRow done={done} />);
        await press(chipAt(0));
        await press(inPopover("Remove every condition"));
        expect(done).toEqual([]);
        await press(inPopover("Apply"));
        expect([opened(), done, words()]).toEqual([null, ["removed SA"], ["Region: VIC", "Region: QLD"]]);
        await press(chipAt(0));
        await press(inPopover("Remove filter"));
        expect([opened(), done, words()]).toEqual([null, ["removed SA", "removed VIC"], ["Region: QLD"]]);
    });

    test("a new filter whose editor waits: Cancel and Add filter — off until it has one to add, then adding it once and shutting, its chip the row's", async () => {
        const done: string[] = [];
        render(<DraftRow done={done} />);
        const add = screen.getByRole("button", { name: "Add filter" });
        await press(add);
        expect(popoverNow()).toEqual({ head: "Add filter", foot: ["Cancel", "Add filter (off)"] });
        await press(inPopover("Write WA"));
        expect([popoverNow()!.foot, done, words()]).toEqual([["Cancel", "Add filter"], [], ["Region: SA", "Region: VIC", "Region: QLD"]]);
        await press(opened()!.querySelector<HTMLElement>("[data-slice-submit]")!);
        expect([opened(), done, words()]).toEqual([null, ["added WA"], ["Region: SA", "Region: VIC", "Region: QLD", "Region: WA"]]);
        // Written, then cancelled: none is added.
        await press(add);
        await press(inPopover("Write WA"));
        await press(inPopover("Cancel"));
        expect([opened(), done]).toEqual([null, ["added WA"]]);
    });
});

describe("a filter +N more holds is edited there", () => {
    /** The filters the open `+N more` lists, by their words. */
    const listed = () => [...document.querySelectorAll("[data-slice-more-words]")].map((el) => el.textContent);

    test("a press on its words shows its editor in the same popover — its head and its foot the filter's — and Apply gives the list back, saying what was done", async () => {
        const done: string[] = [];
        // The row shows the first filter, and folds two.
        render(<DraftRow foldChips={2} done={done} />);
        await press(document.querySelector<HTMLElement>("[data-slice-more]")!);
        expect([popoverNow(), listed()]).toEqual([{ head: "2 more filters", foot: ["Clear all", "Done"] }, ["Region: VIC", "Region: QLD"]]);
        const line = screen.getByRole("button", { name: "Edit filter: Region: QLD" });
        line.focus();
        await press(line);
        expect([popoverNow(), listed()]).toEqual([{ head: "Filter QLD", foot: ["Remove filter", "Cancel", "Apply (off)"] }, []]);
        // The line pressed went with the list: the focus goes to the editor's popover's first control, never to the page.
        expect(focused()).toBe("Close");
        await press(inPopover("Pick NSW"));
        await pressFocused(inPopover("Apply"));
        expect([popoverNow(), listed(), done]).toEqual([{ head: "2 more filters", foot: ["Clear all", "Done"] }, ["Region: VIC", "Region: NSW"], ["QLD is NSW"]]);
        // And back to the filter's line, which says what it holds now.
        expect(focused()).toBe("Edit filter: Region: NSW");
    });

    test("Cancel gives the list back as it was; Remove filter takes the filter out and gives back what is left", async () => {
        const done: string[] = [];
        render(<DraftRow foldChips={2} done={done} />);
        await press(document.querySelector<HTMLElement>("[data-slice-more]")!);
        await press(screen.getByRole("button", { name: "Edit filter: Region: VIC" }));
        await press(inPopover("Pick NSW"));
        await press(inPopover("Cancel"));
        expect([popoverNow()!.head, listed(), done]).toEqual(["2 more filters", ["Region: VIC", "Region: QLD"], []]);
        await press(screen.getByRole("button", { name: "Edit filter: Region: VIC" }));
        // The draft of the edit cancelled is forgotten.
        expect(popoverNow()!.foot).toEqual(["Remove filter", "Cancel", "Apply (off)"]);
        await press(inPopover("Remove filter"));
        expect([listed(), done, words()]).toEqual([["Region: QLD"], ["removed VIC"], ["Region: SA"]]);
    });

    test("the focus goes back to the line the editor was opened from — never to Clear all, drawn where Cancel stood — or to the line that took its place", async () => {
        render(<DraftRow foldChips={2} done={[]} />);
        await press(document.querySelector<HTMLElement>("[data-slice-more]")!);
        await pressFocused(screen.getByRole("button", { name: "Edit filter: Region: VIC" }));
        await pressFocused(inPopover("Cancel"));
        expect([popoverNow()!.foot, focused()]).toEqual([["Clear all", "Done"], "Edit filter: Region: VIC"]);
        // Its filter removed, the line that takes its place.
        await pressFocused(document.activeElement as HTMLElement);
        await pressFocused(inPopover("Remove filter"));
        expect([listed(), focused()]).toEqual([["Region: QLD"], "Edit filter: Region: QLD"]);
    });

    test("a line its × takes out hands the focus to the line before it, where none takes its place", async () => {
        render(<DraftRow foldChips={2} done={[]} />);
        await press(document.querySelector<HTMLElement>("[data-slice-more]")!);
        const removes = opened()!.querySelectorAll<HTMLElement>("[data-slice-more-row] button[aria-label='Remove filter']");
        await pressFocused(removes[1]!);
        expect([listed(), focused()]).toEqual([["Region: VIC"], "Edit filter: Region: VIC"]);
    });

    test("left with no filter to hold, +N more is shut: the row lets go of what it held, and the focus goes to the row's last chip — or, every filter cleared, to + FILTER", async () => {
        const told: boolean[] = [];
        const hold = (holding: boolean) => { told.push(holding); };
        // The row shows two filters, and folds the third.
        render(<SliceRailHold.Provider value={hold}><DraftRow shows={2} done={[]} /></SliceRailHold.Provider>);
        await press(document.querySelector<HTMLElement>("[data-slice-more]")!);
        expect([listed(), told]).toEqual([["Region: QLD"], [true]]);
        await pressFocused(opened()!.querySelector<HTMLElement>("[data-slice-more-row] button[aria-label='Remove filter']")!);
        expect([opened(), document.querySelector("[data-slice-more]"), words(), told]).toEqual([null, null, ["Region: SA", "Region: VIC"], [true, false]]);
        expect(document.activeElement).toBe(chipAt(1));
        cleanup();
        render(<DraftRow foldChips={2} done={[]} />);
        await press(document.querySelector<HTMLElement>("[data-slice-more]")!);
        await pressFocused(inPopover("Clear all"));
        expect([words(), document.activeElement]).toEqual([[], screen.getByRole("button", { name: "Add filter" })]);
    });
});

/**
 * A host whose editors submit by themselves, each press an edit made at once: a chip's lengthens its own words, or takes
 * the other filters out; the new filter's adds one. Each chip's whole words are its label's, said in full, unless told.
 */
function LiveRow({ hold, wholes = true }: { hold?: ((holding: boolean) => void) | undefined; wholes?: boolean }) {
    const [labels, setLabels] = useState(["Region: SA", "Units: more than 1"]);
    const chips = labels.map((label, i): SliceFilterChip => ({
        label,
        ...(wholes ? { whole: `${label} — said whole` } : {}),
        editLabel: "Filter on Orders",
        editor: () => (
            <div>
                <button type="button" onClick={() => setLabels((was) => was.map((held, j) => (j === i ? `${held} +1` : held)))}>Edit</button>
                <button type="button" onClick={() => setLabels((was) => was.filter((_held, j) => j === i))}>Remove the rest</button>
            </div>
        ),
    }));
    const row = (
        <SliceFilterChips density="focused" chips={chips} rows onRemove={(i) => setLabels((was) => was.filter((_held, j) => j !== i))}
            onClear={() => setLabels([])} add={() => <button type="button" onClick={() => setLabels((was) => [...was, "Revenue: at least 100"])}>Add</button>} />
    );
    return <ChakraProvider value={system}>{hold === undefined ? row : <SliceRailHold.Provider value={hold}>{row}</SliceRailHold.Provider>}</ChakraProvider>;
}

/** What holds the focus, by its name: its label, else its words. */
const focused = () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent;
/** Presses a control as a keyboard does: the focus on it first. */
const pressFocused = async (el: HTMLElement) => { el.focus(); await press(el); };
/** The row's chips' words, in order. */
const words = () => [...document.querySelectorAll("[data-slice-clause]")].map((chip) => chip.textContent);
/** A chip of the row, by its place. */
const chipAt = (i: number) => document.querySelector<HTMLElement>(`[data-slice-clause='${i}']`)!;
/** Clicks a control, React's updates and the popover's let land. */
const press = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); await Promise.resolve(); }); };
/** Esc, as the open popover hears it. */
const escape = async () => { await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await Promise.resolve(); }); };
/** A pointer pressed or released somewhere on the page, as the window hears it. */
const pointerEvent = (type: "pointerdown" | "pointerup") =>
    new PointerEvent(type, { pointerId: 1, pointerType: "mouse", buttons: type === "pointerdown" ? 1 : 0, bubbles: true });
/** A pointer pressed somewhere on the page. */
const pointerDown = async () => {
    await act(async () => {
        document.body.dispatchEvent(pointerEvent("pointerdown"));
        await Promise.resolve();
    });
};
/**
 * The press's release, and its click where it makes one: in one task, as a browser dispatches them. A step that waits
 * out the press runs in a task after the release — one an async `act` may reach before it returns, as it waits a task
 * of its own: so the release is sent, and read, in a synchronous `act`.
 */
const release = (click?: HTMLElement) => {
    act(() => {
        document.body.dispatchEvent(pointerEvent("pointerup"));
        if (click !== undefined) fireEvent.click(click);
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
        // A press: the editor shuts before it clicks — and its click lands on the other chip, where the row stood. That
        // chip's editor opens, the row held, then and in the task after.
        await pointerDown();
        await escape();
        release(chipAt(1));
        expect([told, words()]).toEqual([[true], ["Region: SA", "Units: more than 1"]]);
        await nextTask();
        expect([told, words()]).toEqual([[true], ["Region: SA", "Units: more than 1"]]);
        // A press that clicks nothing: the row still held in its release's task, and let go in the task after.
        await pointerDown();
        await escape();
        release();
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
        editor: () => <button type="button" onClick={() => setHeld((was) => [...was, { on: "orders", label: "Revenue: at least 100" }])}>Add on orders</button>,
    }));
    return (
        <ChakraProvider value={system}>
            <SliceFilterChips density={density} foldChips={foldChips} chips={chips} groups={Object.keys(DATASETS)} rows
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

    test("folded: +N more holds the filters the row folds — none it shows — each under its group's name, its head counting them; a group folded whole goes unnamed in the row, and one split between the two is named in each", async () => {
        /** The open `+N more`: its head's words, and the groups' names and the filters it holds, in order. */
        const more = () => {
            const content = document.querySelector("[data-scope='popover'][data-part='content'][data-state='open']")!;
            return {
                head: content.querySelector("button[aria-label='Close']")!.parentElement!.querySelector("span")!.textContent,
                held: [...content.querySelectorAll("[data-slice-more-group], [data-slice-more-words]")].map((el) => el.textContent),
            };
        };
        // The stock's one filter folded: the row draws the orders' two, the stock unnamed; +1 more holds the stock's alone.
        render(<GroupedRow density="compact" foldChips={1} />);
        expect(drawnRow()).toEqual(["Orders", "Region: SA", "Units: more than 1"]);
        await press(document.querySelector<HTMLElement>("[data-slice-more]")!);
        expect(more()).toEqual({ head: "1 more filter", held: ["Stock", "Site: North — said whole"] });
        cleanup();
        // The orders' second and the stock's folded: the orders named before their first in the row, and again in +2 more.
        render(<GroupedRow density="compact" foldChips={2} />);
        expect(drawnRow()).toEqual(["Orders", "Region: SA"]);
        await press(document.querySelector<HTMLElement>("[data-slice-more]")!);
        expect(more()).toEqual({ head: "2 more filters", held: ["Orders", "Units: more than 1 — said whole", "Stock", "Site: North — said whole"] });
    });

    test("+N more's × takes out the filter its line holds, alone: the row and +N more hold the rest", async () => {
        render(<GroupedRow density="compact" foldChips={2} />);
        await press(document.querySelector<HTMLElement>("[data-slice-more]")!);
        // +2 more holds the orders' second, then the stock's: its first line's × takes out the orders' second alone.
        await press(document.querySelector<HTMLElement>("[data-slice-more-row] button[aria-label='Remove filter']")!);
        const held = [...document.querySelectorAll("[data-slice-more-words]")].map((el) => el.textContent);
        expect([drawnRow(), held]).toEqual([["Orders", "Region: SA"], ["Site: North — said whole"]]);
    });

    test("chips in no group: no name is drawn, in the row or in +N more, which holds the one it folds", async () => {
        render(<LiveRow />);
        expect(document.querySelectorAll("[data-slice-chip-group]")).toHaveLength(0);
        cleanup();
        render(
            <ChakraProvider value={system}>
                <SliceFilterChips density="compact" foldChips={1} onRemove={() => undefined} onClear={() => undefined} add={() => null}
                    chips={["Region: SA", "Units: more than 1"].map((label): SliceFilterChip => ({ label, editLabel: "Filter", editor: () => null }))} />
            </ChakraProvider>,
        );
        await press(document.querySelector<HTMLElement>("[data-slice-more]")!);
        const held = [...document.querySelectorAll("[data-slice-more-words]")].map((el) => el.textContent);
        expect([document.querySelectorAll("[data-slice-chip-group], [data-slice-more-group]").length, held]).toEqual([0, ["Units: more than 1"]]);
    });
});
