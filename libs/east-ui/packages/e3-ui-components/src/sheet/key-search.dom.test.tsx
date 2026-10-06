/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The paged Sheet's key search in its frame's toolbar (#1221): the shared
 * toolbar item over the source's `seek` — its box, folded to its icon on a row
 * short of room — and ⌘F and ⌘/ in the grid reach it in either form: the box,
 * its text selected; folded, the box in its popover, opened, the focus in it.
 * jsdom lays nothing out, so the row's width and the item's are stubbed from
 * the form it shows: the box 200px, the icon 44.
 */
import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { DictType, East, IntegerType, NullType, OptionType, StringType, StructType, none, some } from "@elaraai/east";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { Paged } from "@elaraai/east-ui/internal";
import { Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import { system, StateImpl, UIStore } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { EastChakraSheet } from "./frame/index.js";
import { boundFrame } from "./frame.test-utils.js";

// jsdom lacks ResizeObserver; the toolbar and the popover's positioner observe through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

/** The stubbed layout: the toolbar row's width. */
const row = { px: 0 };

let restoreFrame: () => void = () => {};
let restoreRect: () => void = () => {};
beforeEach(() => {
    initializeStore(new UIStore());
    restoreFrame = boundFrame(2000);
    const measured = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const width = this.hasAttribute("data-toolbar") ? row.px
            : this.getAttribute("data-toolbar-item") === "seek" ? (this.querySelector('[data-key-search="icon"]') !== null ? 44 : 200)
                : undefined;
        if (width === undefined) return measured.call(this);
        return { x: 0, y: 0, left: 0, top: 0, width, height: 30, right: width, bottom: 30, toJSON() { return {}; } } as DOMRect;
    };
    restoreRect = () => { Element.prototype.getBoundingClientRect = measured; };
});
afterEach(() => { cleanup(); restoreRect(); restoreFrame(); });

// A keyed source, built by hand to the row-source contract as the insertion
// tests build theirs: two jobs in key order, at one snapshot, and a `seek` —
// which gives the sheet its key search. No query is typed here, so it finds
// nothing.
const Job = StructType({ id: StringType, task: StringType });
const JobsByKey = DictType(StringType, Job);
const JOBS = new Map([
    ["J-0001", { id: "J-0001", task: "Panel cutting" }],
    ["J-0002", { id: "J-0002", task: "Edge banding" }],
]);
const PAGE = East.function([IntegerType, IntegerType], OptionType(JobsByKey), ($, offset, limit) => {
    const all = $.const(JOBS, JobsByKey);
    const keys = $.let(all.toArray((_$, _v, k) => k));
    const n = $.let(keys.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const end = $.let(start.add(limit).less(n).ifElse(() => start.add(limit), () => n));
    return some(all.getKeys(keys.slice(start, end).toSet()));
});
const TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(JOBS, JobsByKey);
    return some(all.size());
});
const SEEK = East.function([SeekQueryType], OptionType(SeekRangeType), () => none);
const REVISION = East.function([], OptionType(StringType), () => some("key-search"));
const REFRESH = East.function([OptionType(StringType)], NullType, () => null);
const SOURCE = { id: "key-search", page: PAGE, total: TOTAL, seek: some(SEEK), revision: REVISION, refresh: REFRESH };

const program = East.function([], SheetPayloadType, ($) => {
    const data = $.const(SOURCE, Paged.Types.PinnedSource(JobsByKey));
    return Sheet.Payload({ data, columns: { task: Sheet.column.text(Job) } });
}).toIR().compile(StateImpl);

/** The sheet in a toolbar row `px` wide, once its rows are in. */
async function mount(px: number) {
    row.px = px;
    const ui = render(<ChakraProvider value={system}><EastChakraSheet value={program()} storageKey="key-search" /></ChakraProvider>);
    await waitFor(() => expect(ui.container.querySelectorAll('[data-slot="row"][data-row-id]')).toHaveLength(2));
    const seek = () => ui.container.querySelector<HTMLElement>('[data-builder-frame] [data-frame-slot="toolbar"] [data-toolbar-item="seek"]');
    const card = () => ui.container.querySelector<HTMLElement>("[data-sheet-card]")!;
    /** A key pressed in the grid, ⌘ held. */
    const command = async (key: string) => {
        card().focus();
        await act(async () => { fireEvent.keyDown(card(), { key, metaKey: true }); });
    };
    return { ...ui, seek, command };
}

/** The box in the key search's popover, once it is open. */
const popoverBox = () => waitFor(() => {
    const input = document.querySelector<HTMLInputElement>('[data-key-search="popover"] input');
    if (input === null) throw new Error("no popover");
    return input;
});

test("folded to its icon on a row short of room, the key search opens in its popover on ⌘F and on ⌘/, the focus in its box", async () => {
    const ui = await mount(100);
    await waitFor(() => expect(ui.seek()?.getAttribute("data-toolbar-form")).toBe("1"));
    const icon = ui.seek()!.querySelector<HTMLElement>('[data-key-search="icon"]')!;
    expect(icon.getAttribute("aria-label")).toBe("Search keys");
    await ui.command("f");
    const box = await popoverBox();
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(icon.getAttribute("data-state")).toBe("open");
    // Closed again, ⌘/ opens it.
    await act(async () => { fireEvent.click(icon); });
    await waitFor(() => expect(icon.getAttribute("data-state")).toBe("closed"));
    await ui.command("/");
    const again = await popoverBox();
    await waitFor(() => expect(document.activeElement).toBe(again));
    expect(icon.getAttribute("data-state")).toBe("open");
});

test("in its box on a row with room, ⌘F puts the focus in it, its text selected", async () => {
    const ui = await mount(1000);
    await waitFor(() => expect(ui.seek()?.getAttribute("data-toolbar-form")).toBe("0"));
    const input = ui.seek()!.querySelector<HTMLInputElement>("input")!;
    await act(async () => { fireEvent.change(input, { target: { value: "J-0" } }); });
    input.blur();
    await ui.command("f");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
});
