/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Sheet through its carrier (#1179, #1216). `<Sheet>` returns the sheet
 * as the `Sheet` extension — its payload's bytes beside its kind — and the
 * dispatcher hands it to the renderer registered against that kind, decoding
 * the payload's functions against the registered platform: a paged source's
 * `page` and `total`, and the editing wire's `onApply`. Every sheet here is
 * built by `<Sheet>`, compiled, and rendered through `EastChakraComponent`,
 * as an app renders it: in its frame.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, East, IntegerType, OptionType, StringType, StructType, encodeBeast2For, none, some, type ValueTypeOf } from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { EastChakraComponent, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { getStore, initializeStore } from "@elaraai/east-ui-components/internal";
import { Sheet } from "@elaraai/e3-ui/internal";
import { boundFrame } from "./frame.test-utils.js";
// The sheet is an extension: its renderer registers as it loads.
import "./frame/index.js";

let restoreFrame: () => void = () => {};
beforeEach(() => { restoreFrame = boundFrame(2000); });
afterEach(() => {
    cleanup();
    localStorage.clear();
    restoreFrame();
});

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

type UIValue = ValueTypeOf<typeof UIComponentType>;

const encodeInteger = encodeBeast2For(IntegerType);

const Job = StructType({ id: StringType, task: StringType, qty: IntegerType });
const Jobs = ArrayType(Job);
/** Three jobs — module scope, so the East bodies call no host helper. */
const JOBS = [
    { id: "j1", task: "Cut", qty: 1n },
    { id: "j2", task: "Drill", qty: 2n },
    { id: "j3", task: "Pack", qty: 3n },
];

/** The jobs as a paged source, built in East to the row-source contract: a
 *  window of them at a time, in stream order. */
const JOBS_PAGE = East.function([IntegerType, IntegerType], OptionType(Jobs), ($, offset, limit) => {
    const all = $.const(JOBS, Jobs);
    const n = $.let(all.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const end = $.let(start.add(limit).less(n).ifElse(() => start.add(limit), () => n));
    return some(all.slice(start, end));
});
const JOBS_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(JOBS, Jobs);
    return some(all.size());
});
const JOBS_SOURCE = { id: "sheet-carrier-jobs", page: JOBS_PAGE, total: JOBS_TOTAL, seek: none };

/** Render a compiled UI value through the dispatcher. */
function mount(value: UIValue, storageKey: string) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey={storageKey} />
        </ChakraProvider>,
    );
}

/** Every row drawn, by its id. */
const rowIds = (container: HTMLElement): (string | null)[] =>
    [...container.querySelectorAll('[data-slot="row"][data-row-id]')].map((el) => el.getAttribute("data-row-id"));

/** A sheet over the jobs. */
const VIEW = East.function([], UIComponentType, ($) => {
    const jobs = $.const(JOBS, Jobs);
    return Sheet({
        data: jobs,
        columns: { task: Sheet.column.text(Job, { header: "Task" }), qty: Sheet.column.integer(Job, { header: "Qty" }) },
        id: "id",
    });
});

/** The same sheet over a paged source of the jobs. */
const PAGED_VIEW = East.function([], UIComponentType, ($) => {
    const source = $.const(JOBS_SOURCE, Paged.Types.Source(Jobs));
    return Sheet({ data: source, columns: { task: Sheet.column.text(Job, { header: "Task" }) }, id: "id" });
});

describe("<Sheet> through its carrier (#1179, #1216)", () => {
    test("the sheet is the Sheet extension — its payload carried as bytes beside its kind — and the dispatcher draws it, in its frame", async () => {
        initializeStore(new UIStore());
        const value = East.compile(VIEW, getRegisteredPlatformImplementations())();
        if (value.type !== "Extension") throw new Error(`expected the Sheet extension, got the ${value.type} arm`);
        expect(value.value.kind).toBe("Sheet");
        const { container } = mount(value, "sheet-carrier-view");
        await waitFor(() => expect(rowIds(container)).toEqual(["j1", "j2", "j3"]));
        // In its frame: the rows in main, the footer in the frame's footer.
        expect(container.querySelector('[data-builder-frame] [data-frame-slot="main"] [data-sheet-card]')).not.toBeNull();
        expect(container.querySelector('[data-builder-frame] [data-frame-slot="footer"] [data-slot="footer"]')).not.toBeNull();
        expect([...container.querySelectorAll('[data-slot="headerCell"]')].map((h) => h.textContent)).toEqual(["Task", "Qty"]);
        expect(container.querySelector('[data-row-id="j2"] [data-key="task"]')!.textContent).toBe("Drill");
    });

    test("a paged source crosses the carrier — its page and total are East functions, decoded, and called by the sheet", async () => {
        initializeStore(new UIStore());
        const { container } = mount(East.compile(PAGED_VIEW, getRegisteredPlatformImplementations())(), "sheet-carrier-paged");
        await waitFor(() => expect(rowIds(container)).toEqual(["j1", "j2", "j3"]));
        await waitFor(() => expect(container.querySelector('[data-slot="footerTransport"]')?.textContent).toBe("3 loaded of 3"));
    });
});

// ── An edit across the carrier ──────────────────────────────────────────────

const JOBS_KEY = "sheet.carrier.jobs";
const TICK_KEY = "sheet.carrier.tick";

/** A Reactive sheet over the jobs bound in State, saved through `onUpdate`;
 *  the render also reads a tick nothing else does — so a tick write rebuilds a
 *  sheet over the same data, decoded anew. */
const EDITED = East.compile(East.function([], UIComponentType, (_$) =>
    Reactive.Root(East.function([], UIComponentType, ($) => {
        const tick = $.let(State.bind([IntegerType], TICK_KEY, 0n));
        $(tick.read());
        const data = $.const(State.bind([Jobs], JOBS_KEY, JOBS));
        return Sheet({ data, columns: { qty: Sheet.column.integer(Job, { header: "Qty" }) }, id: "id", onUpdate: data.write });
    })),
), getRegisteredPlatformImplementations());

/** The jobs as the State holds them. */
const readJobs = East.compile(East.function([], Jobs, ($) => {
    const data = $.const(State.bind([Jobs], JOBS_KEY, JOBS));
    return data.read();
}), getRegisteredPlatformImplementations());

describe("an edit through the carrier (#1179)", () => {
    test("a draft survives the host's rebuild over the same data, and Save writes the bound State through the decoded onApply", async () => {
        initializeStore(new UIStore());
        const { container, getByRole } = mount(EDITED(), "sheet-carrier-edit");
        const row = () => container.querySelector('[data-row-id="j2"]')!;
        const cell = () => row().querySelector('[data-key="qty"]')!;
        const input = () => container.querySelector('[data-slot="editorInput"]')!;
        const flush = () => act(async () => { await Promise.resolve(); await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
        await waitFor(() => expect(cell().textContent).toBe("2"));
        // An edit, committed as a draft. The number field reports its change a
        // microtask later: let it land before ⏎.
        fireEvent.doubleClick(cell());
        await flush();
        fireEvent.input(input(), { target: { value: "7" } });
        await flush();
        fireEvent.keyDown(input(), { key: "Enter" });
        await flush();
        expect(cell().textContent).toBe("7");
        expect(row().hasAttribute("data-draft")).toBe(true);
        // The host's render runs again over the same data: the payload is
        // decoded anew, and the draft stays.
        act(() => { getStore().write(TICK_KEY, encodeInteger(1n)); });
        await flush();
        expect(cell().textContent).toBe("7");
        expect(row().hasAttribute("data-draft")).toBe(true);
        // Save runs the decoded onApply: the State takes the batch, and the
        // sheet reconciles to it.
        const save = getByRole("button", { name: "Save" });
        await act(async () => { fireEvent.mouseDown(save, { button: 0 }); fireEvent.click(save); });
        expect(readJobs()).toEqual([JOBS[0], { ...JOBS[1]!, qty: 7n }, JOBS[2]]);
        await waitFor(() => expect((getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true));
        expect(row().hasAttribute("data-draft")).toBe(false);
        expect(cell().textContent).toBe("7");
    }, 30_000);
});
