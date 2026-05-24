/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Interaction tests for the self-driving Slice renderers. The renderers are
 * mounted against a **fake bind closure** (a plain JS object implementing the
 * `SliceBind` contract over mutable JS state) so we exercise the React /
 * useState / builder layer in isolation — no East compile, no store. The real
 * bind + apply logic is covered separately by `test/platform/slice.spec.ts`.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../theme/index.js";
import { EastChakraSliceCohort } from "./cohort/index.js";
import { EastChakraSliceFilter } from "./filter/index.js";
import { EastChakraSliceSearch } from "./search/index.js";

/** Minimal `SliceBind` closure over mutable JS state — mirrors the runtime impl. */
function fakeSlice(init: Record<string, unknown> = {}) {
    let s: any = {
        range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none, ...init,
    };
    const set = (patch: Record<string, unknown>) => { s = { ...s, ...patch }; };
    return {
        key: "test.fake",
        read: () => s,
        write: (ns: any) => { s = ns; },
        setRange: (o: unknown) => set({ range: o }),
        setCompare: (o: unknown) => set({ compare: o }),
        addFilter: (p: unknown) => set({ filters: [...s.filters, p] }),
        removeFilter: (i: unknown) => set({ filters: s.filters.filter((_: unknown, j: number) => j !== Number(i)) }),
        clearFilters: () => set({ filters: [], activeCohorts: new Set<string>() }),
        defineCohort: (c: any) => set({ cohorts: [...s.cohorts, c] }),
        updateCohort: (id: string, c: any) => set({ cohorts: s.cohorts.map((x: any) => x.id === id ? c : x) }),
        removeCohort: (id: string) => { const a = new Set<string>(s.activeCohorts); a.delete(id); set({ cohorts: s.cohorts.filter((c: any) => c.id !== id), activeCohorts: a }); },
        toggleCohort: (id: string) => { const a = new Set<string>(s.activeCohorts); a.has(id) ? a.delete(id) : a.add(id); set({ activeCohorts: a }); },
        setBreakdown: (o: unknown) => set({ breakdown: o }),
        setSearch: (o: unknown) => set({ search: o }),
        setVisible: (o: unknown) => set({ visible: o }),
        select: (o: unknown) => set({ selectedIndex: o }),
        isActive: () => s.filters.length > 0 || s.activeCohorts.size > 0,
        activeCount: () => BigInt(s.filters.length + s.activeCohorts.size),
        dimensions: () => [{ fieldId: "region", label: "Region" }],
        fields: () => [
            { fieldId: "scenario", label: "Scenario", kind: "string" },
            { fieldId: "region", label: "Region", kind: "string" },
            { fieldId: "sessions", label: "Sessions", kind: "integer" },
        ],
        // data-derived: the fake has no bound rows, so these return inert stubs —
        // these tests assert on the mutators / state, not the derived counts.
        totalCount: () => 0n,
        resultCount: () => BigInt(s.filters.length),
        groups: () => [] as Array<{ key: string; count: bigint }>,
        matches: () => [] as Array<{ id: string; label: string; meta: unknown }>,
        cohortCounts: () => new Map<string, bigint>(),
        searchFieldIds: () => [] as string[],
        rangeFieldId: () => none,
    };
}

// jsdom lacks the browser APIs Chakra's Combobox positioner relies on.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as any).ResizeObserver ??= ResizeObserverStub;
(Element.prototype as any).scrollIntoView ??= () => {};

const ui = (node: React.ReactElement) => render(<ChakraProvider value={system}>{node}</ChakraProvider>);
afterEach(cleanup);

describe("Slice.Cohort — edits happen in the Slice.Edit popover (never inline)", () => {
    test("editOpen pre-opens the editor; adding a clause + Apply keeps both clauses", async () => {
        const slice = fakeSlice({
            cohorts: [{ id: "eu", name: "EU", filters: [variant("string", { fieldId: "region", op: variant("eq", "EU") })] }],
            activeCohorts: new Set(["eu"]),
        });
        const value: any = { slice, createdBy: none, lastEdited: none, reevaluateEvery: none, density: none, editOpen: some(true) };
        ui(<EastChakraSliceCohort value={value} />);

        expect(screen.getByText(/region = EU/)).toBeTruthy();   // existing clause shown in the popover

        fireEvent.change(screen.getByLabelText("Field"), { target: { value: "sessions" } });
        fireEvent.change(screen.getByLabelText("Operator"), { target: { value: "gte" } });
        // The value field is now a typed IntegerInput (spinbutton); it commits on a microtask.
        await act(async () => { fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "30" } }); });
        fireEvent.click(screen.getByText("Add"));
        fireEvent.click(screen.getByText("Apply"));

        const cohorts = slice.read().cohorts;
        expect(cohorts.length).toBe(1);
        expect(cohorts[0].filters.length).toBe(2);            // ← erase bug would make this 1
        expect(cohorts[0].filters[0].value.op.value).toBe("EU"); // original first
        expect(cohorts[0].filters[1].value.op.value).toBe(30n); // typed bigint, not "30"
    });

    test("no inline editor — the focused predicate editor never renders outside the popover", () => {
        const slice = fakeSlice({
            cohorts: [{ id: "eu", name: "EU", filters: [variant("string", { fieldId: "region", op: variant("eq", "EU") })] }],
        });
        const value: any = { slice, createdBy: none, lastEdited: none, reevaluateEvery: none, density: none, editOpen: none };
        ui(<EastChakraSliceCohort value={value} />);
        // Closed: the pill renders but no builder / Apply is in the DOM.
        expect(screen.queryByLabelText("Field")).toBeNull();
        expect(screen.queryByText("Apply")).toBeNull();
    });

    test("new-cohort popover (no cohorts) authors a cohort via name + clause + Apply", async () => {
        const slice = fakeSlice();
        const value: any = { slice, createdBy: none, lastEdited: none, reevaluateEvery: none, density: none, editOpen: some(true) };
        ui(<EastChakraSliceCohort value={value} />);

        fireEvent.change(screen.getByLabelText("Cohort name"), { target: { value: "Big EU" } });
        fireEvent.change(screen.getByLabelText("Field"), { target: { value: "sessions" } });
        fireEvent.change(screen.getByLabelText("Operator"), { target: { value: "gte" } });
        await act(async () => { fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "30" } }); });
        fireEvent.click(screen.getByText("Add"));
        fireEvent.click(screen.getByText("Apply"));

        const cohorts = slice.read().cohorts;
        expect(cohorts.length).toBe(1);
        expect(cohorts[0].name).toBe("Big EU");
        expect(cohorts[0].filters.length).toBe(1);
        expect(cohorts[0].filters[0].value.op.value).toBe(30n);
    });
});

describe("Slice.Filter — add-filter builder applies (in a Slice.Edit popover)", () => {
    test("editOpen opens the builder; filling it and clicking Add appends a predicate", async () => {
        const slice = fakeSlice();
        const value: any = { slice, unit: some("events"), density: none, editOpen: some(true) };
        ui(<EastChakraSliceFilter value={value} />);

        fireEvent.change(screen.getByLabelText("Field"), { target: { value: "sessions" } });
        fireEvent.change(screen.getByLabelText("Operator"), { target: { value: "gte" } });
        await act(async () => { fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "20" } }); });
        fireEvent.click(screen.getByText("Add"));

        const filters = slice.read().filters;
        expect(filters.length).toBe(1);
        expect(filters[0].type).toBe("integer");
        expect(filters[0].value.op.type).toBe("gte");
        expect(filters[0].value.op.value).toBe(20n);
    });

    test("remove chip calls removeFilter", () => {
        const slice = fakeSlice({ filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 20n) })] });
        const value: any = { slice, unit: none, density: none, editOpen: none };
        ui(<EastChakraSliceFilter value={value} />);

        fireEvent.click(screen.getByLabelText("Remove filter"));
        expect(slice.read().filters.length).toBe(0);
    });
});

describe("Slice.Search — combobox drives the query", () => {
    test("typing in the combobox input sets the slice search", async () => {
        const user = userEvent.setup();
        const slice = fakeSlice();
        const value: any = { slice, recent: ["demand-spike"] };
        ui(<EastChakraSliceSearch value={value} />);

        await user.type(screen.getByPlaceholderText("Search…"), "SKU");
        await Promise.resolve(); // flush the queueMicrotask around setSearch

        const search = slice.read().search;
        expect(search.type).toBe("some");
        expect(search.value).toBe("SKU");
    });
});
