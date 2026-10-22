/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Plan (#821) and a Sheet (#851) over a bound paged source follow its
 * dataset — `Data.bindPaged` over the machines e3 itself holds (#1377), its
 * runtime's channels, revision pinning and `refresh` — rendered by the real
 * component, the Sheet in its frame (#1216). Another session writing the
 * dataset moves the source to the new content hash, and the component swaps
 * each row's content in place: the row element survives, and the old rows stay
 * on screen until the new revision's window lands. And a Sheet's first edit
 * drafts at once: the entry it reads before drafting is answered from the
 * window it shows, never fetched on its own (#1217).
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { Data, Plan, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { EastChakraPlan, type PlanRootValue } from "../plan/index.js";
import { EastChakraSheet } from "../sheet/frame/index.js";
import { boundFrame } from "../sheet/frame.test-utils.js";
import { getReactiveDatasetCache } from "./bind-runtime.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

// The Sheet's frame, tall enough for its rows (#1216).
let restoreFrame: () => void = () => {};
beforeEach(() => { restoreFrame = boundFrame(2000); });
afterEach(() => { restoreFrame(); });

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

/** A machine, and the label its row shows. */
const Machine = ex.PreviewMachine;
/** The machines' dotted path, as a request names them. */
const MACHINES = "inputs.preview_machines";
/** The machines another session writes in place of A's: B's labels. */
const B = new Map([["m1", { label: "B-M1" }], ["m2", { label: "B-M2" }]]);

/** Whether a request reads a window of the machines. */
const isWindow = (request: E3Request) => request.kind === "page" && request.dataset === MACHINES;
/** The requests that read the machines' rows: whole, a window, or a key search. */
const rowReads = (from: number) => h.requests().slice(from).filter((request) =>
    request.dataset === MACHINES && (request.kind === "read" || request.kind === "page" || request.kind === "find"));

/** The machines a window at a time, bound as a page binds them. */
const bindMachines = East.function([], undefined, () => Data.bindPaged(ex.previewMachinesInput));

/** The bound handle, the runtimes it reads through installed over the test's workspace as a mounted page's providers install them. */
async function machines(): Promise<Record<string, unknown>> {
    await h.install({ fn: bindMachines });
    return East.compile(bindMachines, getRegisteredPlatformImplementations())() as Record<string, unknown>;
}

/** A machine's row id — the `machines` series' entry at its key (#822). */
const machineId = (key: string) => variant("entry", { series: "machines", path: [key] }) as ValueTypeOf<typeof Plan.Types.RowId>;
/** The row's element: `data-plan-row` holds its id's canonical text. */
const machineRow = (key: string) => `[data-plan-row=${JSON.stringify(printFor(Plan.Types.RowId)(machineId(key)))}]`;

/** A canvas row per machine — what the series pipeline would derive; its
 *  series declares no gesture (#880, #825). */
function rowOf(key: string, label: string): ValueTypeOf<typeof Plan.Types.Row> {
    return {
        id: machineId(key),
        parent: none,
        gutter: { label: key, id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind: variant("span", {
            runs: [{
                key: `${key}-run`, start: variant("time", W27), end: variant("time", new Date("2026-07-13T00:00:00Z")),
                label, quantity: none, state: variant("actual", null), status: none, moved: none, icon: none,
            }],
            decisions: [], ports: [], rollup: none,
        }),
        collapsed: false, pinned: false, height: none, status: none, expand: none,
        edits: { drop: false, move: none },
    } as unknown as ValueTypeOf<typeof Plan.Types.Row>;
}

/** The Plan root over the bound handle — its `page` mapped to the canvas's
 *  blocks (one block of the machines' rows, #823), its identity, total,
 *  revision and refresh the handle's own: the `pinned` arm, the one a canvas
 *  follows from one snapshot to the next. */
function planOver(handle: Record<string, unknown>): PlanRootValue {
    const bound = handle as {
        id: string;
        page: (o: bigint, l: bigint) => { type: string; value?: ReadonlyMap<string, { label: string }> };
        total: () => unknown;
        revision: () => unknown;
        refresh: (target: unknown) => unknown;
    };
    const source = {
        id: bound.id,
        page: (offset: bigint, limit: bigint) => {
            const win = bound.page(offset, limit);
            if (win.type !== "some" || win.value === undefined) return none;
            return some([{ fixed: false, parent: none, rows: [...win.value].map(([k, v]) => rowOf(k, v.label)) }]);
        },
        total: bound.total,
        seek: none,
        revision: bound.revision,
        refresh: bound.refresh,
    };
    return {
        rows: variant("pinned", source),
        links: [],
        axis: variant("time", {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: [], now: none, format: none,
        }),
        grain: none, popover: none, hover: none, expandRender: none, expandGutter: none, pick: none,
        slice: none, footer: [], id: none, sources: [], editing: none, canDrop: none,
        onSelect: none, onElementClick: none,
        onGroupToggle: none, onGrainChange: none, ui: none, style: none,
    } as unknown as PlanRootValue;
}

describe("a Plan over Data.bindPaged follows its dataset (#821)", () => {
    test("writing the dataset swaps each row's content in place — no remount, no empty frame", async () => {
        const handle = await machines();
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraPlan value={planOver(handle)} storageKey="e3-821-plan" />
            </ChakraProvider>,
        );
        await screen.findByText("A-M1");
        const row = container.querySelector(machineRow("m1"));
        expect(row).toBeTruthy();

        // Another session writes the dataset, and the next status poll reports it. B's window is held on its way
        // to e3.
        const windows = h.e3.hold(isWindow);
        await h.write(ex.previewMachinesInput, B);
        expect(windows.held).toBeGreaterThan(0);
        // The same row, still showing A — never an empty frame.
        expect(container.querySelector(machineRow("m1"))).toBe(row);
        expect(screen.getByText("A-M1")).toBeTruthy();
        expect(screen.queryByText("B-M1")).toBeNull();

        // B's window lands: the row swaps its content, in place.
        await act(async () => { windows.release(); });
        await settle();
        await screen.findByText("B-M1");
        expect(screen.queryByText("A-M1")).toBeNull();
        expect(container.querySelector(machineRow("m1"))).toBe(row);
    });

    test("unmounted, it lets its dataset go: nothing follows the dataset, so nothing polls for it", async () => {
        const handle = await machines();
        const { unmount } = render(
            <ChakraProvider value={system}>
                <EastChakraPlan value={planOver(handle)} storageKey="e3-849-plan-unfollow" />
            </ChakraProvider>,
        );
        await screen.findByText("A-M1");
        /** The status polls that ask e3 for the machines' hash. */
        const polls = () => h.requests("status").filter((request) => request.query.getAll("path").some((path) => path.endsWith("preview_machines")));
        await act(async () => { await getReactiveDatasetCache().refresh(h.workspace); });
        expect(polls().length, "a poll follows the dataset while the canvas shows it").toBeGreaterThan(0);

        unmount();
        await settle();
        const asked = polls().length;
        await act(async () => { await getReactiveDatasetCache().refresh(h.workspace); });
        await settle();
        expect(polls(), "nothing follows the dataset, so no poll asks for it").toHaveLength(asked);
    });
});

/** A Sheet as an author writes it — a text column over the machines, bound a
 *  window at a time — so the rows reach the renderer through the Sheet's own
 *  derived source, pinned as `Data.bindPaged`'s handle is. */
const sheetProgram = East.function([], SheetPayloadType, ($) => {
    const bound = $.let(Data.bindPaged(ex.previewMachinesInput));
    return Sheet.Payload({ data: bound, columns: { label: Sheet.column.text(Machine, { header: "Label" }) }, blanks: 0 });
});

/** The same Sheet with an `onApply` of the host's, so a gesture drafts (#1217). */
const editedProgram = East.function([], SheetPayloadType, ($) => {
    const bound = $.let(Data.bindPaged(ex.previewMachinesInput));
    const apply = $.const(East.function([Sheet.Types.ChangeSet(Machine)], Sheet.Types.ApplyResult, (_$, _batch) => variant("applied", { revision: none })));
    return Sheet.Payload({ data: bound, columns: { label: Sheet.column.text(Machine, { header: "Label" }) }, blanks: 0, onApply: apply });
});

/** A Sheet's payload, its runtimes installed over the test's workspace first. */
async function sheetOf(program: typeof sheetProgram) {
    await h.install({ fn: program });
    return East.compile(program, getRegisteredPlatformImplementations())();
}

describe("a Sheet over Data.bindPaged follows its dataset (#851)", () => {
    test("writing the dataset swaps each row's content in place — no remount, no empty frame", async () => {
        const value = await sheetOf(sheetProgram);
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraSheet value={value} storageKey="e3-851-sheet" />
            </ChakraProvider>,
        );
        await screen.findByText("A-M1");
        const row = container.querySelector('[data-row-id="m1"]');
        expect(row).toBeTruthy();

        // Another session writes the dataset, and the next status poll reports it. B's window is held on its way
        // to e3.
        const windows = h.e3.hold(isWindow);
        await h.write(ex.previewMachinesInput, B);
        expect(windows.held).toBeGreaterThan(0);
        // The same row, still showing A — an empty frame would have unmounted it.
        expect(container.querySelector('[data-row-id="m1"]')).toBe(row);
        expect(screen.getByText("A-M1")).toBeTruthy();
        expect(screen.queryByText("B-M1")).toBeNull();

        // B's window lands: the row swaps its content, in place.
        await act(async () => { windows.release(); });
        await settle();
        await screen.findByText("B-M1");
        expect(screen.queryByText("A-M1")).toBeNull();
        expect(container.querySelector('[data-row-id="m1"]')).toBe(row);
    });

    test("a first edit drafts at once: the entry it reads is answered from the window the sheet shows, never fetched on its own (#1217)", async () => {
        const value = await sheetOf(editedProgram);
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraSheet value={value} storageKey="e3-1217-sheet" />
            </ChakraProvider>,
        );
        await screen.findByText("A-M1");
        await settle();
        const asked = h.requests().length;

        fireEvent.doubleClick(container.querySelector('[data-row-id="m1"] [data-key="label"]')!);
        await settle();
        const input = container.querySelector('[data-slot="editorInput"]')!;
        fireEvent.input(input, { target: { value: "A-M1, checked" } });
        await settle();
        fireEvent.keyDown(input, { key: "Enter" });
        await settle();

        // Drafted: the row marked, its cell the edit, Save on.
        expect(container.querySelector('[data-row-id="m1"][data-draft]')).not.toBeNull();
        expect(container.querySelector('[data-row-id="m1"] [data-key="label"]')!.textContent).toBe("A-M1, checked");
        expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
        // e3 was asked for the sheet's window, and for none of the machines' rows since.
        expect(rowReads(asked)).toEqual([]);
    });
});
