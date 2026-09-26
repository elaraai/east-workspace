/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Closure-only changes, through the DISPATCHER (#809).
 *
 * A Reactive re-evaluation rebuilds its whole subtree. When only a closure's
 * captures moved — a resolver over new State, a callback over a new tick — the
 * data is unchanged, and a memo on `equalFor` (every pair of functions equal)
 * dropped the new value: the renderer kept calling the stale closure. Every memo
 * on the path, `EastChakraComponent` first, now compares with `equivalentFor`, so
 * the change arrives and the NEW closure runs. And because the renderers re-sync
 * local state only on a DATA change, what the user typed or decided survives it.
 *
 * The first two trees are built by the real factories and compiled, so their
 * closures are the ones East emits; the review surfaces are decoded payloads
 * with host callbacks, the shape the e3 webview hands the dispatcher.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, StringType, StructType,
    decodeBeast2For, encodeBeast2For, none, some, toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Input, Plan, Reactive, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { EastChakraComponent } from "../component.js";
import { initializeStore, getStore } from "../platform/state-runtime.js";
import { UIStore } from "../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../platform/registry.js";
import type { RosterValue } from "../collections/roster/index.js";
import type { TableRootValue } from "../collections/table/index.js";
import { rowSel } from "../collections/plan/plan.test-utils.js";

afterEach(cleanup);

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

type UIValue = ValueTypeOf<typeof UIComponentType>;

const encodeString = encodeBeast2For(StringType);
const decodeString = decodeBeast2For(StringType);
const encodeInteger = encodeBeast2For(IntegerType);

function mount(value: UIValue) {
    const view = (v: UIValue) => (
        <ChakraProvider value={system}>
            <EastChakraComponent value={v} storageKey="equivalence" />
        </ChakraProvider>
    );
    const utils = render(view(value));
    return { ...utils, rerender: (v: UIValue) => utils.rerender(view(v)) };
}

// ── A Plan whose resolver captured State ────────────────────────────────────

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
const NOW = new Date("2026-08-12T00:00:00Z");
const UnitRow = StructType({ start: DateTimeType, end: DateTimeType, tonnes: FloatType });
/** Three units — module scope, so the East body calls no host helper. */
const UNITS = new Map(Array.from({ length: 3 }, (_, i) => [
    `u${String(i).padStart(2, "0")}`,
    { start: W27, end: W39, tonnes: (i + 1) * 5 },
] as const));

const LABEL_KEY = "equivalence.plan.label";
const TICK_KEY = "equivalence.plan.tick";

/** Counts the resolver's calls — through a platform function in its body, so
 *  the resolver stays a real East closure. */
let expandCalls = 0;
const countExpand = East.platform("test_equivalence_count_expand", [], NullType);
const PLATFORM = [
    ...getRegisteredPlatformImplementations(),
    countExpand.implement(() => { expandCalls += 1; }),
];

/** A Reactive canvas: the expand resolver captures the label READ from State
 *  (a value, not the handle), and the render also reads a tick nothing captures
 *  — so a tick write rebuilds an EQUIVALENT canvas, a label write a new one. */
const reactivePlan = East.compile(East.function([], UIComponentType, (_$) =>
    Reactive.Root(East.function([], UIComponentType, ($) => {
        const labelBind = $.let(State.bind([StringType], LABEL_KEY, "ALPHA"));
        const tickBind = $.let(State.bind([IntegerType], TICK_KEY, 0n));
        const label = $.const(labelBind.read());
        $(tickBind.read());
        const units = $.const(UNITS, DictType(StringType, UnitRow));
        const series = $.const([
            Plan.series.span(UnitRow, {
                key: "units", title: "Units",
                label: (_r, k) => k, id: true,
                expand: (_r) => some({ height: none, axis: variant("keep", null) }),
                runs: (r) => [Plan.run({ key: "run", start: r.start, end: r.end, label: "RUN", state: "actual" })],
            }),
        ], ArrayType(Plan.Types.Series(UnitRow)));
        const expandRender = $.const(East.function([Plan.Types.RowId], UIComponentType, ($2, _id) => {
            $2(countExpand());
            return Text.Root(label);
        }));
        const axis = $.const(Plan.axis({ window: { min: W27, max: W39 }, resolution: "week", now: NOW }));
        return Plan.Root({ axis, data: units, series, expandRender });
    })),
), PLATFORM);

// ── An uncontrolled input whose callback captured State ─────────────────────

const INPUT_TICK_KEY = "equivalence.input.tick";
const INPUT_LOG_KEY = "equivalence.input.log";

/** The input's own data never changes; its `onChange` captures the tick, so a
 *  tick write is a closure-only change. The callback logs `tick:text`. */
const reactiveInput = East.compile(East.function([], UIComponentType, (_$) =>
    Reactive.Root(East.function([], UIComponentType, ($) => {
        const tickBind = $.let(State.bind([IntegerType], INPUT_TICK_KEY, 0n));
        const logBind = $.let(State.bind([StringType], INPUT_LOG_KEY, ""));
        const tick = $.const(tickBind.read());
        const onChange = $.const(East.function([StringType], NullType, ($2, text) => {
            $2(logBind.write(East.str`${tick}:${text}`));
        }));
        return Input.String("", { onChange });
    })),
), PLATFORM);

describe("closure-only changes through the dispatcher (#809)", () => {
    test("a Reactive re-renders a Plan whose resolver captured new State; an equivalent rebuild does not", async () => {
        initializeStore(new UIStore());
        expandCalls = 0;
        const { container } = mount(reactivePlan());
        // The unit's row — the `units` series' entry at its key (#822).
        const unit = rowSel("u00", "data-plan-row", "units");
        await waitFor(() => expect(container.querySelector(unit)).toBeTruthy());
        fireEvent.click(container.querySelector(`${unit} [data-plan-control="expand"]`) as HTMLElement);
        await waitFor(() => expect(container.querySelector("[data-plan-expandrender]")?.textContent).toBe("ALPHA"));
        const callsAfterOpen = expandCalls;

        // The render re-runs, but the rebuilt canvas is equivalent — same data,
        // same resolver IR, same captured label: every memo bails.
        act(() => { getStore().write(TICK_KEY, encodeInteger(1n)); });
        expect(expandCalls).toBe(callsAfterOpen);

        // Only the resolver's capture moved. `equalFor` called the canvases
        // equal and the open region kept saying ALPHA.
        act(() => { getStore().write(LABEL_KEY, encodeString("BETA")); });
        await waitFor(() => expect(container.querySelector("[data-plan-expandrender]")?.textContent).toBe("BETA"));
    }, 30_000);

    test("an uncontrolled input keeps what the user typed, and the NEW callback runs", async () => {
        initializeStore(new UIStore());
        const { container } = mount(reactiveInput());
        const input = () => container.querySelector("input") as HTMLInputElement;
        const log = () => decodeString(getStore().read(INPUT_LOG_KEY) ?? encodeString(""));

        fireEvent.change(input(), { target: { value: "hello" } });
        await act(async () => { await Promise.resolve(); });
        expect(log()).toBe("0:hello");

        // A closure-only change: the input's data is the same, its callback
        // captured a new tick. The typed text must survive the re-render.
        act(() => { getStore().write(INPUT_TICK_KEY, encodeInteger(1n)); });
        expect(input().value).toBe("hello");

        fireEvent.change(input(), { target: { value: "hello!" } });
        await act(async () => { await Promise.resolve(); });
        expect(log()).toBe("1:hello!");
    });
});

// ── Review decisions across closure-only changes ────────────────────────────

/** A review config with every verb off — each test wires the one it drives. */
const REVIEW = {
    columnLabel: "Decision", summary: none,
    onApprove: none, onReject: none,
    onApproveAll: none, onRejectAll: none, onRerun: none, rerunLabel: "Rerun",
};

/** Two people, one committed shift; the review is wired per test. */
const ROSTER = {
    id: "roster", sources: [], mode: variant("edit", null),
    days: ["Mon"], personHeader: "Person", personWidth: none,
    people: [
        { key: "p0", label: "P0", sublabel: none, status: none, approval: none },
        { key: "p1", label: "P1", sublabel: none, status: none, approval: none },
    ],
    shifts: [{ key: "s0", person: "p0", day: "Mon", label: "8h", state: variant("committed", null) }],
    density: none, height: none, maxHeight: none, summary: none,
    onDrag: none, canDrop: none, onSelect: none, onAccept: none, onAddAt: none,
    review: none,
} as unknown as RosterValue;

/** Two rows of one `name` column, printed by the table itself; the review
 *  verdicts come from the accessor each test wires. */
const TABLE = {
    rows: variant("inline", [
        new Map<string, unknown>([["name", variant("String", "alpha")]]),
        new Map<string, unknown>([["name", variant("String", "bravo")]]),
    ]),
    columns: [{
        key: "name",
        dataType: toEastTypeValue(StringType), valueType: toEastTypeValue(StringType),
        header: some("NAME"), width: none, minWidth: none, maxWidth: none,
        render: none, format: none,
        aggregate: none, aggregateRender: none,
    }],
    frozen: [],
    columnGroups: none, footer: none, footerRows: none, expandedContent: none,
    interactive: none, columnResize: some(false), virtualization: some(false),
    density: none, rowStatus: none, pagination: none, selection: none,
    onCellClick: none, onCellDoubleClick: none, onRowClick: none, onRowDoubleClick: none,
    onRowSelectionChange: none, onSortChange: none,
    review: some(REVIEW), reviewStatus: none, reviewApproval: none,
    slice: none, groupBy: none, style: none,
} as unknown as TableRootValue;

/** The Approve buttons, one per row, in row order. */
const approveButtons = (container: HTMLElement): HTMLElement[] =>
    [...container.querySelectorAll('[data-slot="decisionCol"] button')]
        .filter((b) => b.textContent === "Approve") as HTMLElement[];

describe("review decisions across closure-only changes (#809)", () => {
    test("Roster: an optimistic decision survives a new callback, and the new callback runs", async () => {
        initializeStore(new UIStore());
        const first: bigint[] = [];
        const second: bigint[] = [];
        // The same people and shifts every time; only `onApprove` changes.
        const roster = (onApprove: (ref: { rowIndex: bigint }) => null): UIValue =>
            variant("Roster", { ...ROSTER, review: some({ ...REVIEW, onApprove: some(onApprove) }) }) as unknown as UIValue;
        const { container, rerender } = mount(roster((ref) => { first.push(ref.rowIndex); return null; }));
        fireEvent.click(approveButtons(container)[0]!);
        await act(async () => { await Promise.resolve(); });
        expect(approveButtons(container)[0]!.getAttribute("aria-pressed")).toBe("true");
        expect(first).toEqual([0n]);

        rerender(roster((ref) => { second.push(ref.rowIndex); return null; }));
        expect(approveButtons(container)[0]!.getAttribute("aria-pressed")).toBe("true");

        fireEvent.click(approveButtons(container)[1]!);
        await act(async () => { await Promise.resolve(); });
        expect(second).toEqual([1n]);
        expect(first).toEqual([0n]);
    });

    test("Table: the same verdicts keep the optimistic decisions; moved verdicts re-seed them", async () => {
        initializeStore(new UIStore());
        // The same rows every time; only the verdict accessor changes.
        const table = (reviewApproval: (rowIndex: bigint) => unknown): UIValue =>
            variant("Table", { ...TABLE, reviewApproval: some(reviewApproval) }) as unknown as UIValue;
        const { container, rerender } = mount(table(() => none));
        await waitFor(() => expect(approveButtons(container)).toHaveLength(2));
        fireEvent.click(approveButtons(container)[0]!);
        expect(approveButtons(container)[0]!.getAttribute("aria-pressed")).toBe("true");

        // A new accessor answering the same verdicts: nothing to re-seed.
        rerender(table(() => none));
        expect(approveButtons(container)[0]!.getAttribute("aria-pressed")).toBe("true");

        // A new accessor whose verdicts moved: the decisions follow the data.
        rerender(table((rowIndex) => (rowIndex === 1n ? some(variant("approved", null)) : none)));
        await waitFor(() => expect(approveButtons(container)[1]!.getAttribute("aria-pressed")).toBe("true"));
        expect(approveButtons(container)[0]!.getAttribute("aria-pressed")).toBe("false");
    });
});
