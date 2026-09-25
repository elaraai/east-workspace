/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Plan (#821) and a Sheet (#851) over a bound paged source follow its
 * dataset — the real `Data.bindPaged` runtime (`defaultPagedRuntime`, its
 * channels, its revision pinning and `refresh`) behind a stand-in paging
 * service, rendered by the real component. Writing the dataset moves the
 * source to the new content hash, and the component swaps each row's content
 * in place: the row element survives, and the old rows stay on screen until
 * the new revision's window lands.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    DictType, East, StringType, StructType, compareFor, encodeBeast2For, none, printFor, some, toEastTypeValue, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Plan, Sheet, UIComponentType } from "@elaraai/east-ui/internal";
import {
    EastChakraPlan, EastChakraSheet, getRegisteredPlatformImplementations, system,
    type PlanRootValue, type SheetRootValue,
} from "@elaraai/east-ui-components";
import type { DatasetPage } from "@elaraai/e3-api-client";
import type { TreePath } from "@elaraai/e3-types";
import { clearPagedApi, defaultPagedRuntime, initializePagedApi, type PagedApi } from "./paged-runtime.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(() => {
    cleanup();
    clearPagedApi();
    localStorage.clear();
});

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

/** The dataset: machines keyed by id, each with the label its run shows. */
const Machine = StructType({ label: StringType });
const Machines = DictType(StringType, Machine);
const encodeMachines = encodeBeast2For(Machines);
/** The dataset's key order — what its element windows are served in. */
const compareKeys = compareFor(StringType);
const MACHINES_PATH: TreePath = [variant("field", "inputs"), variant("field", "machines")];

/** What the stand-in server holds, and which revisions it answers yet. */
interface Content { hash: string; labels: Record<string, string> }

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((yes) => { resolve = yes; });
    return { promise, resolve };
}

/** The paging service: pages pinned to the current content hash, a refused
 *  stale pin (409), and a revision watch the test fires as the status poll. */
function standInServer(initial: Content) {
    const state = { content: initial, held: new Map<string, { promise: Promise<void>; resolve: () => void }>() };
    const watchers: ((hash: string | null) => void)[] = [];
    const api: PagedApi = {
        async getRevision() { return state.content.hash; },
        async getPage(_ws, _path, window): Promise<DatasetPage> {
            const gate = state.held.get(window.hash ?? "");
            if (gate !== undefined) await gate.promise;
            if (window.hash !== undefined && window.hash !== state.content.hash) {
                throw Object.assign(new Error("stale pin"), { code: "dataset_hash_mismatch" });
            }
            const all = Object.entries(state.content.labels).sort(([a], [b]) => compareKeys(a, b));
            const slice = all.slice(window.offset, window.offset + window.limit);
            const data = encodeMachines(new Map(slice.map(([k, label]) => [k, { label }])));
            return {
                data, totalElements: all.length, totalBytes: data.length, totalExact: true,
                segmentCount: 1, offset: window.offset, count: slice.length, hash: state.content.hash,
            };
        },
        async findKey() { throw new Error("these tests never seek"); },
        watchRevision(_ws, _path, onRevision) {
            watchers.push(onRevision);
            return () => { watchers.splice(watchers.indexOf(onRevision), 1); };
        },
    };
    return {
        api,
        /** Write the dataset: new content under a new hash, its pages held back. */
        write(next: Content) {
            state.held.set(next.hash, deferred());
            state.content = next;
        },
        /** The status poll reports the dataset's hash. */
        poll() { for (const w of [...watchers]) w(state.content.hash); },
        /** Let a revision's held pages answer. */
        release(hash: string) { state.held.get(hash)?.resolve(); state.held.delete(hash); },
    };
}

/** A machine's row id — the `machines` series' entry at its key (#822). */
const machineId = (key: string) => variant("entry", { series: "machines", path: [key] }) as ValueTypeOf<typeof Plan.Types.RowId>;
/** The row's element: `data-plan-row` holds its id's canonical text. */
const machineRow = (key: string) => `[data-plan-row=${JSON.stringify(printFor(Plan.Types.RowId)(machineId(key)))}]`;

/** A canvas row per machine — what the series pipeline would derive. */
function rowOf(key: string, label: string): ValueTypeOf<typeof Plan.Types.Row> {
    return {
        id: machineId(key),
        parent: none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind: variant("span", {
            runs: [{
                key: `${key}-run`, start: variant("time", W27), end: variant("time", new Date("2026-07-13T00:00:00Z")),
                label, quantity: none, qty: none, state: variant("actual", null), status: none, moved: none, icon: none,
            }],
            decisions: [], ports: [], rollup: none, unit: none,
        }),
        collapsed: none, pinned: none, height: none, status: none, approval: none, expand: none,
    } as unknown as ValueTypeOf<typeof Plan.Types.Row>;
}

/** The Plan root over the bound handle — its `page` mapped to the canvas's
 *  blocks (one block of the machines' rows, #823), its identity, total,
 *  revision and refresh the handle's own. */
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
        rows: variant("paged", source),
        links: [],
        axis: variant("time", {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: [], now: none, format: none,
        }),
        grain: none, popover: none, hover: none, expandRender: none, expandGutter: none, review: none, pick: none,
        slice: none, footer: [], id: "", sources: [], onDrag: none, canDrop: none,
        onSelect: none, onRunClick: none, onEventClick: none, onMarkClick: none, onChipClick: none, onCellClick: none,
        onGroupToggle: none, onGrainChange: none, style: none,
    } as unknown as PlanRootValue;
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("a Plan over Data.bindPaged follows its dataset (#821)", () => {
    test("writing the dataset swaps each row's content in place — no remount, no empty frame", async () => {
        const server = standInServer({ hash: "A", labels: { m1: "A-M1", m2: "A-M2" } });
        initializePagedApi(server.api, "ws");
        const handle = defaultPagedRuntime.buildHandle(toEastTypeValue(Machines), MACHINES_PATH);
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraPlan value={planOver(handle)} storageKey="e3-821-plan" />
            </ChakraProvider>,
        );
        await screen.findByText("A-M1");
        const row = container.querySelector(machineRow("m1"));
        expect(row).toBeTruthy();

        // The dataset is written, and the next status poll reports it. B's
        // window is still on the wire.
        server.write({ hash: "B", labels: { m1: "B-M1", m2: "B-M2" } });
        await act(async () => { server.poll(); });
        await settle();
        // The same row, still showing A — never an empty frame.
        expect(container.querySelector(machineRow("m1"))).toBe(row);
        expect(screen.getByText("A-M1")).toBeTruthy();
        expect(screen.queryByText("B-M1")).toBeNull();

        // B's window lands: the row swaps its content, in place.
        server.release("B");
        await settle();
        await screen.findByText("B-M1");
        expect(screen.queryByText("A-M1")).toBeNull();
        expect(container.querySelector(machineRow("m1"))).toBe(row);
    });
});

/** A Sheet as an author writes it — a text column over the bound machines,
 *  the handle its input — so the rows reach the renderer through the Sheet's
 *  own derived source. */
const sheetProgram = East.function([Paged.Types.Source(Machines)], UIComponentType, (_$, machines) =>
    Sheet.Root(machines, { label: Sheet.column.text(Machine, { header: "Label" }) }, { blanks: 0 }));

/** The Sheet root over the bound handle. */
function sheetOver(handle: Record<string, unknown>): SheetRootValue {
    const ui = East.compile(sheetProgram, getRegisteredPlatformImplementations())(handle as never) as unknown as { value: SheetRootValue };
    return ui.value;
}

describe("a Sheet over Data.bindPaged follows its dataset (#851)", () => {
    test("writing the dataset swaps each row's content in place — no remount, no empty frame", async () => {
        const server = standInServer({ hash: "A", labels: { m1: "A-M1", m2: "A-M2" } });
        initializePagedApi(server.api, "ws");
        const handle = defaultPagedRuntime.buildHandle(toEastTypeValue(Machines), MACHINES_PATH);
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraSheet value={sheetOver(handle)} storageKey="e3-851-sheet" />
            </ChakraProvider>,
        );
        await screen.findByText("A-M1");
        const row = container.querySelector('[data-row-id="m1"]');
        expect(row).toBeTruthy();

        // The dataset is written, and the next status poll reports it. B's
        // window is still on the wire.
        server.write({ hash: "B", labels: { m1: "B-M1", m2: "B-M2" } });
        await act(async () => { server.poll(); });
        await settle();
        // The same row, still showing A — an empty frame would have unmounted it.
        expect(container.querySelector('[data-row-id="m1"]')).toBe(row);
        expect(screen.getByText("A-M1")).toBeTruthy();
        expect(screen.queryByText("B-M1")).toBeNull();

        // B's window lands: the row swaps its content, in place.
        server.release("B");
        await settle();
        await screen.findByText("B-M1");
        expect(screen.queryByText("A-M1")).toBeNull();
        expect(container.querySelector('[data-row-id="m1"]')).toBe(row);
    });
});
