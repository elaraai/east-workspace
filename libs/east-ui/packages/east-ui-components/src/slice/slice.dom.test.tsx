/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Interaction tests for the self-driving Slice renderers. Most suites mount
 * against a **fake bind closure** (a plain JS object implementing the
 * `SliceBind` contract over mutable JS state, kept faithful to the real
 * mutator contracts — defineCohort throws on a duplicate id, addFilter dedups,
 * toggleFilter is an idempotent toggle) to exercise the React / useState /
 * builder layer in isolation. The final suite mounts against a **real**
 * `Slice.bind` handle + `UIStore` (#170) so the full render → handle → store →
 * `useSliceReactivity` → chip round-trip is covered too. The apply engine is
 * covered separately by `test/platform/slice.spec.ts`.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup, act, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import {
    IntegerType, OptionType, SetType, SortedSet, StringType,
    compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { buildSliceHandle } from "../platform/slice/index.js";
import { sliceConfig } from "../testing/slice.js";
import { initializeStore } from "../platform/state-runtime.js";
import { UIStore } from "../platform/state-store.js";
import { system } from "../theme/index.js";
import { EastChakraSliceBreakdown } from "./breakdown/index.js";
import { EastChakraSliceCohort } from "./cohort/index.js";
import { SliceDensityContext } from "./density.js";
import { SliceEditPopover } from "./edit/index.js";
import { EastChakraSliceFilter } from "./filter/index.js";
import { EastChakraSliceLegend } from "./legend/index.js";
import { EastChakraSliceRail, affordanceDescriptor, rangeBounds, rangeOfWindow, useSliceToolbarItems } from "./rail/index.js";
import { railAffordanceKinds } from "./rail-kinds.js";
import { EastChakraSliceRange } from "./range/index.js";
import { EastChakraSliceSearch } from "./search/index.js";
import { EastChakraSliceSummary } from "./summary/index.js";

/** Structural predicate equality — the same comparator the real impl uses. */
const predEqual = equalFor(Slice.Types.Predicate) as (x: unknown, y: unknown) => boolean;

/** East's equality over Integer and String sets, and East's order for their
 *  members: a built set is an East Set, which iterates in that order. */
const equalIntegerSets = equalFor(SetType(IntegerType));
const compareIntegers = compareFor(IntegerType);
const equalStringSets = equalFor(SetType(StringType));
const compareStrings = compareFor(StringType);

/** Minimal `SliceBind` closure over mutable JS state — mirrors the runtime
 *  impl. `derived` overrides the data-derived stubs (groups, fields, …) for
 *  tests that need non-empty platform-computed results. */
function fakeSlice(init: Record<string, unknown> = {}, derived: Record<string, unknown> = {}) {
    let s: any = {
        range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none, ...init,
    };
    const set = (patch: Record<string, unknown>) => { s = { ...s, ...patch }; };
    return {
        key: "test.fake",
        read: () => s,
        write: (ns: any) => { s = ns; },
        setRange: (o: unknown) => set({ range: o }),
        setCompare: (o: unknown) => set({ compare: o }),
        setResolution: (o: unknown) => set({ resolution: o }),
        // Faithful to the real primitive: a structurally-equal predicate is a
        // no-op (#164 dedup).
        addFilter: (p: unknown) => { if (!s.filters.some((f: unknown) => predEqual(f, p))) set({ filters: [...s.filters, p] }); },
        // Faithful to the real primitive: idempotent add/remove over structural
        // equality (#165).
        toggleFilter: (p: unknown) => {
            const i = s.filters.findIndex((f: unknown) => predEqual(f, p));
            set({ filters: i >= 0 ? s.filters.filter((_: unknown, j: number) => j !== i) : [...s.filters, p] });
        },
        removeFilter: (i: unknown) => set({ filters: s.filters.filter((_: unknown, j: number) => j !== Number(i)) }),
        // Faithful to the real primitive: "clear all" zeroes EVERY narrowing —
        // filters, active cohorts, range, and search.
        clearFilters: () => set({ filters: [], activeCohorts: new Set<string>(), range: none, search: none }),
        // Faithful to the real `Slice.bind` primitive (platform/slice/index.ts):
        // defining a duplicate id throws. The DOM fake previously just appended,
        // which is why the Filter "Save as cohort" duplicate-id bug (#161) was
        // invisible to tests.
        defineCohort: (c: any) => {
            if (s.cohorts.some((x: any) => x.id === c.id)) throw new Error(`[Slice.bind] cohort id "${c.id}" already exists`);
            set({ cohorts: [...s.cohorts, c] });
        },
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
        // Fake facet options mirror groups (no bound rows to self-exclude over);
        // override via `derived` when a test needs them to differ.
        facetGroups: () => [] as Array<{ key: string; count: bigint }>,
        matches: () => [] as Array<{ id: string; label: string; meta: unknown }>,
        cohortCounts: () => new Map<string, bigint>(),
        searchFieldIds: () => [] as string[],
        rangeFieldId: () => none,
        ...derived,
    };
}

// jsdom lacks the browser APIs Chakra's Combobox positioner relies on.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as any).ResizeObserver ??= ResizeObserverStub;
(Element.prototype as any).scrollIntoView ??= () => {};
(Element.prototype as any).scrollTo ??= () => {};

const ui = (node: React.ReactElement) => render(<ChakraProvider value={system}>{node}</ChakraProvider>);
afterEach(cleanup);

/**
 * Mounts a surface whose editor popover is open at mount (`editOpen`), and lets
 * the popover settle before a test clicks in it. Zag starts the popover's
 * machine in a microtask after its first layout, and the positioner is
 * `pointer-events: none` until React renders the placement that start sets —
 * in a task of its own, which can come after user-event's first `setTimeout(0)`,
 * and user-event refuses a click through `pointer-events: none`. Mounting in
 * `act` renders it first. (A popover a click opens is placed inside Zag's
 * `flushSync`, so only one open at mount needs this.)
 */
async function uiOpen(node: React.ReactElement) {
    return await act(async () => ui(node));
}

/** Drive an Ark `Select` (the shared ClauseBuilder controls): open the
 *  labelled trigger, pick the named option from the portalled list. */
async function pickOption(user: ReturnType<typeof userEvent.setup>, triggerLabel: string, optionName: string) {
    await user.click(screen.getByLabelText(triggerLabel));
    await user.click(await screen.findByRole("option", { name: optionName }));
}

describe("Slice.Cohort — edits happen in the Slice.Edit popover (never inline)", () => {
    test("editOpen pre-opens the editor; adding a clause + Apply keeps both clauses", async () => {
        const slice = fakeSlice({
            cohorts: [{ id: "eu", name: "EU", filters: [variant("string", { fieldId: "region", op: variant("eq", "EU") })] }],
            activeCohorts: new Set(["eu"]),
        });
        const value: any = { slice, createdBy: none, lastEdited: none, reevaluateEvery: none, density: none, editOpen: some(true) };
        await uiOpen(<EastChakraSliceCohort value={value} />);

        expect(screen.getByText(/region = EU/)).toBeTruthy();   // existing clause shown in the popover

        const user = userEvent.setup();
        await pickOption(user, "Field", "Sessions");
        await pickOption(user, "Operator", "≥");
        // The value field is a typed IntegerInput (an Ark NumberInput
        // spinbutton). Paste the value in one event — per-key typing races
        // Zag's rAF state sync under jsdom and intermittently drops digits.
        await user.click(screen.getByRole("spinbutton"));
        await user.paste("30");
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
        await uiOpen(<EastChakraSliceCohort value={value} />);

        const user = userEvent.setup();
        fireEvent.change(screen.getByLabelText("Cohort name"), { target: { value: "Big EU" } });
        await pickOption(user, "Field", "Sessions");
        await pickOption(user, "Operator", "≥");
        await user.click(screen.getByRole("spinbutton"));
        await user.paste("30");
        fireEvent.click(screen.getByText("Add"));
        fireEvent.click(screen.getByText("Apply"));

        const cohorts = slice.read().cohorts;
        expect(cohorts.length).toBe(1);
        expect(cohorts[0].name).toBe("Big EU");
        expect(cohorts[0].filters.length).toBe(1);
        expect(cohorts[0].filters[0].value.op.value).toBe(30n);
    });

    // The harness's own guarantee: uiOpen returns with the popover placed, so a
    // click needs no task first. Mounted with plain `ui`, this click fails on
    // the positioner's `pointer-events: none` every time.
    test("a popover open at mount takes a click as soon as uiOpen returns", async () => {
        const slice = fakeSlice();
        const value: any = { slice, createdBy: none, lastEdited: none, reevaluateEvery: none, density: none, editOpen: some(true) };
        await uiOpen(<EastChakraSliceCohort value={value} />);
        const user = userEvent.setup({ delay: null });
        await pickOption(user, "Field", "Sessions");
        expect(screen.getByLabelText("Field").textContent).toContain("Sessions");
    });
});

describe("Slice.Filter — add-filter builder applies (in a Slice.Edit popover)", () => {
    test("editOpen opens the builder; filling it and clicking Add appends a predicate", async () => {
        const slice = fakeSlice();
        const value: any = { slice, unit: some("events"), density: none, editOpen: some(true) };
        await uiOpen(<EastChakraSliceFilter value={value} />);

        const user = userEvent.setup();
        await pickOption(user, "Field", "Sessions");
        await pickOption(user, "Operator", "≥");
        await user.click(screen.getByRole("spinbutton"));
        await user.paste("20");
        fireEvent.click(screen.getByText("Add"));

        const filters = slice.read().filters;
        expect(filters.length).toBe(1);
        expect(filters[0].type).toBe("integer");
        expect(filters[0].value.op.type).toBe("gte");
        expect(filters[0].value.op.value).toBe(20n);
    });

    // #164 — the add path gives feedback: Add is disabled (with a hint) while
    // the value is empty, a successful Add closes the popover (the new chip is
    // the confirmation; the lazy-mounted builder resets), and re-adding the
    // identical clause dedups instead of stacking a duplicate chip.
    test("Add disables on empty value, closes the popover on success, and an identical re-add dedups (#164)", async () => {
        const slice = fakeSlice();
        const value: any = { slice, unit: none, density: none, editOpen: some(true) };
        const first = await uiOpen(<EastChakraSliceFilter value={value} />);
        const user = userEvent.setup();

        // Fresh builder: string `contains` with an empty value — disabled + hint.
        expect((screen.getByText("Add") as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText("Enter a value.")).toBeTruthy();

        const buildSessionsGte20 = async () => {
            await pickOption(user, "Field", "Sessions");
            await pickOption(user, "Operator", "≥");
            await user.click(await screen.findByRole("spinbutton"));
            await user.paste("20");
            fireEvent.click(screen.getByText("Add"));
        };
        await buildSessionsGte20();
        expect(slice.read().filters.length).toBe(1);
        expect(screen.queryByLabelText("Field")).toBeNull();   // popover closed after Add

        // A fresh builder session over the SAME slice state (remount rather
        // than a trigger re-click — reopening through Zag's presence machine
        // is rAF-racy under jsdom) submits the identical clause: deduped.
        first.unmount();
        await uiOpen(<EastChakraSliceFilter value={{ ...value, editOpen: some(true) }} />);
        await buildSessionsGte20();
        expect(slice.read().filters.length).toBe(1);           // deduped, no second chip
    });

    // #166 — integer fields offer set-membership `in`: the TagsInput entries
    // parse to a Set<bigint>, dropping malformed ones (never a crash).
    test("builder offers integer 'in'; tags parse to a bigint set with malformed entries dropped (#166)", async () => {
        const slice = fakeSlice();
        const value: any = { slice, unit: none, density: none, editOpen: some(true) };
        await uiOpen(<EastChakraSliceFilter value={value} />);

        const user = userEvent.setup();
        await pickOption(user, "Field", "Sessions");
        await pickOption(user, "Operator", "in");
        // Commit one tag per paste+Enter, clearing between entries — per-key
        // typing (and back-to-back entries) race Zag's rAF input-clear under
        // jsdom and concatenate digits (cf. the spinbutton note above).
        const tags = screen.getByPlaceholderText("a, b, c");
        for (const entry of ["10", "20", "abc"]) {
            await user.click(tags);
            await user.clear(tags);
            await user.paste(entry);
            await user.keyboard("{Enter}");
        }
        fireEvent.click(screen.getByText("Add"));

        const filters = slice.read().filters;
        expect(filters.length).toBe(1);
        expect(filters[0].type).toBe("integer");
        expect(filters[0].value.op.type).toBe("in");
        const members = filters[0].value.op.value;
        expect(equalIntegerSets(members, new SortedSet([10n, 20n], compareIntegers))).toBe(true);  // "abc" dropped
        expect([...members]).toEqual([10n, 20n]);                                                   // in East's order
    });

    // Regression (crashed live in the showcase): OPENING the edit builder for
    // the new typed clauses must not blow up the eager validity check — an
    // integer in-set seeded bigints into `.trim()` (#164 + #166 interaction),
    // and a between seed fed `{from,to}` to a single date field.
    test("editing an integer 'in' clause seeds string tags and Apply round-trips back to a bigint set", async () => {
        const slice = fakeSlice({
            filters: [variant("integer", { fieldId: "sessions", op: variant("in", new Set([10n, 20n, 30n, 40n, 50n])) })],
        });
        const value: any = { slice, unit: none, density: none, editOpen: none };
        ui(<EastChakraSliceFilter value={value} />);

        const user = userEvent.setup();
        await user.click(screen.getByText(/sessions in 10, 20, 30 \+2/));   // ← threw "s.trim is not a function" pre-fix
        expect(await screen.findByText("Apply")).toBeTruthy();
        expect(screen.getByText("40")).toBeTruthy();                        // seeded as string tag entries

        fireEvent.click(screen.getByText("Apply"));
        const filters = slice.read().filters;
        expect(filters.length).toBe(1);
        expect(filters[0].value.op.type).toBe("in");
        const members = filters[0].value.op.value;
        expect(equalIntegerSets(members, new SortedSet([10n, 20n, 30n, 40n, 50n], compareIntegers))).toBe(true);  // typed again
        expect([...members]).toEqual([10n, 20n, 30n, 40n, 50n]);
    });

    test("editing a datetime 'between' clause seeds the min–max date pair without crashing", async () => {
        const from = new Date("2025-01-05T00:00:00Z");
        const to = new Date("2025-03-28T00:00:00Z");
        const slice = fakeSlice(
            { filters: [variant("datetime", { fieldId: "when", op: variant("between", { from, to }) })] },
            { fields: () => [
                { fieldId: "scenario", label: "Scenario", kind: "string" },
                { fieldId: "when", label: "When", kind: "datetime" },
            ] },
        );
        const value: any = { slice, unit: none, density: none, editOpen: none };
        ui(<EastChakraSliceFilter value={value} />);

        const user = userEvent.setup();
        await user.click(screen.getByText(/when between/));
        expect(await screen.findByText("Apply")).toBeTruthy();
        expect(screen.getAllByRole("spinbutton").length).toBeGreaterThanOrEqual(6);  // two date fields mounted

        fireEvent.click(screen.getByText("Apply"));                          // untouched seed applies as-is
        const filters = slice.read().filters;
        expect(filters.length).toBe(1);
        expect(filters[0].value.op.type).toBe("between");
        expect(filters[0].value.op.value.from.getTime()).toBe(from.getTime());
        expect(filters[0].value.op.value.to.getTime()).toBe(to.getTime());
    });

    // #171 — presence ops carry no comparison value: picking "is empty" hides
    // the value control (input:"none") and Add submits a NullType-armed op.
    test("builder offers 'is empty' with no value control and Add appends an isEmpty predicate (#171)", async () => {
        const slice = fakeSlice();
        const value: any = { slice, unit: none, density: none, editOpen: some(true) };
        await uiOpen(<EastChakraSliceFilter value={value} />);

        const user = userEvent.setup();
        expect(screen.queryByRole("textbox")).not.toBeNull();     // contains → string value control
        await pickOption(user, "Operator", "is empty");
        expect(screen.queryByRole("textbox")).toBeNull();         // presence op → no value control
        fireEvent.click(screen.getByText("Add"));

        const filters = slice.read().filters;
        expect(filters.length).toBe(1);
        expect(filters[0].type).toBe("string");
        expect(filters[0].value.fieldId).toBe("scenario");
        expect(filters[0].value.op.type).toBe("isEmpty");
        expect(filters[0].value.op.value).toBe(null);
    });

    // #161 — the Filter "Save as cohort" path must dedup the derived id against
    // the existing cohorts. Without the fix it re-derives an existing id (`eu`)
    // and `defineCohort` throws (the fake now mirrors that contract), dropping
    // the save. With the fix it yields a fresh `eu-2` and applies it.
    test("Save as cohort dedups a colliding id → eu-2, applies it, never throws (#161)", async () => {
        const slice = fakeSlice({
            // A pre-seeded cohort whose id `eu` collides with what "EU" slugifies to.
            cohorts: [{ id: "eu", name: "EU", filters: [variant("string", { fieldId: "region", op: variant("eq", "EU") })] }],
            // Two filters — "Save as cohort →" only surfaces at ≥2 clauses.
            filters: [
                variant("string", { fieldId: "region", op: variant("eq", "EU") }),
                variant("integer", { fieldId: "sessions", op: variant("gte", 20n) }),
            ],
        });
        const value: any = { slice, unit: none, density: some(variant("compact", null)), editOpen: none };

        // jsdom reports every element as 0×0, so the priority-plus overflow hook
        // never collapses anything and the "+N more" popover (which hosts "Save as
        // cohort") never appears. Give elements a non-zero offsetWidth against a
        // 0-width row so everything overflows and the popover renders.
        const owDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return 100; } });
        try {
            const user = userEvent.setup();
            ui(<EastChakraSliceFilter value={value} />);

            await user.click(screen.getByText("+2 more"));                                   // open the overflow popover
            await user.click(await screen.findByRole("button", { name: "Save as cohort →" })); // reveal the save form
            fireEvent.change(await screen.findByLabelText("Cohort name"), { target: { value: "EU" } });
            fireEvent.click(screen.getByRole("button", { name: "Save" }));                    // would throw pre-fix
        } finally {
            if (owDesc) Object.defineProperty(HTMLElement.prototype, "offsetWidth", owDesc);
            else delete (HTMLElement.prototype as any).offsetWidth;
        }

        const st = slice.read();
        expect([...st.cohorts].map((c: any) => c.id).sort()).toEqual(["eu", "eu-2"]); // fresh id, original kept
        const created = st.cohorts.find((c: any) => c.id === "eu-2");
        expect(created?.name).toBe("EU");
        expect(created?.filters.length).toBe(2);          // the active filter set was captured
        expect(st.activeCohorts.has("eu-2")).toBe(true);  // and the new cohort is applied
    });
});

describe("Slice.Cohort — chips toggle on/off; authoring demoted to the pencil (#163)", () => {
    const seeded = () => fakeSlice(
        {
            cohorts: [{ id: "eu", name: "EU", filters: [variant("string", { fieldId: "region", op: variant("eq", "EU") })] }],
            activeCohorts: new Set<string>(),
        },
        { cohortCounts: () => new Map([["eu", 1240n]]) },
    );
    const cohortValue = (slice: unknown, extra: Record<string, unknown> = {}): any =>
        ({ slice, createdBy: none, lastEdited: none, reevaluateEvery: none, density: none, editOpen: none, ...extra });

    test("primary chip click toggles the cohort ON and OFF — the deactivate path is live", () => {
        const slice = seeded();
        ui(<EastChakraSliceCohort value={cohortValue(slice)} />);

        const toggle = screen.getByRole("button", { name: "Toggle cohort EU" });
        expect(toggle.getAttribute("aria-pressed")).toBe("false");
        expect(screen.getByText(/1\.2K/)).toBeTruthy();          // live count on the chip, compact in the locale (#850)

        fireEvent.click(toggle);
        expect(slice.read().activeCohorts.has("eu")).toBe(true);  // ON
        fireEvent.click(toggle);
        expect(slice.read().activeCohorts.has("eu")).toBe(false); // OFF — not deletion
        expect(slice.read().cohorts.length).toBe(1);              // cohort survives
    });

    test("the pencil (not the chip) opens the editor, without toggling", async () => {
        const slice = seeded();
        ui(<EastChakraSliceCohort value={cohortValue(slice)} />);
        expect(screen.queryByText("Apply")).toBeNull();

        const user = userEvent.setup();
        await user.click(screen.getByLabelText("Edit cohort EU"));
        expect(await screen.findByText("Apply")).toBeTruthy();
        expect(slice.read().activeCohorts.has("eu")).toBe(false); // editing ≠ toggling
    });

    test("toggle mode renders a pure preset bar — no pencil, no + cohort pill", () => {
        const slice = seeded();
        ui(<EastChakraSliceCohort value={cohortValue(slice, { mode: some(variant("toggle", null)) })} />);
        expect(screen.getByRole("button", { name: "Toggle cohort EU" })).toBeTruthy();
        expect(screen.queryByLabelText("Edit cohort EU")).toBeNull();
        expect(screen.queryByText("cohort")).toBeNull();
    });

    test("Apply is disabled with a hint until the draft has a name and a clause (P1)", async () => {
        const slice = fakeSlice();
        await uiOpen(<EastChakraSliceCohort value={cohortValue(slice, { editOpen: some(true) })} />);

        expect((screen.getByText("Apply") as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText("Give the cohort a name.")).toBeTruthy();

        fireEvent.change(screen.getByLabelText("Cohort name"), { target: { value: "Big EU" } });
        expect(screen.getByText("Add at least one clause.")).toBeTruthy();
        expect((screen.getByText("Apply") as HTMLButtonElement).disabled).toBe(true);
    });
});

describe("Slice.Cohort — families (`group`): captioned runs of alternatives", () => {
    const familyCohorts = () => [
        { id: "mine",      name: "Mine",      group: none,           filters: [variant("string", { fieldId: "owner",  op: variant("eq", "me") })] },
        { id: "proposed",  name: "PROPOSED",  group: some("state"),  filters: [variant("string", { fieldId: "state",  op: variant("eq", "PROPOSED") })] },
        { id: "scheduled", name: "SCHEDULED", group: some("state"),  filters: [variant("string", { fieldId: "state",  op: variant("eq", "SCHEDULED") })] },
        { id: "ready",     name: "READY",     group: some("status"), filters: [variant("string", { fieldId: "status", op: variant("eq", "READY") })] },
    ];
    const familyValue = (slice: unknown, extra: Record<string, unknown> = {}): any =>
        ({ slice, createdBy: none, lastEdited: none, reevaluateEvery: none, density: none, editOpen: none, mode: some(variant("toggle", null)), group: none, ...extra });

    test("the standalone cohort leads the plain run; each family renders under its own caption, in first-seen order", () => {
        const slice = fakeSlice({ cohorts: familyCohorts() });
        ui(<EastChakraSliceCohort value={familyValue(slice)} />);
        const families = screen.getAllByRole("group").map(g => g.getAttribute("aria-label"));
        expect(families).toEqual(["state cohorts", "status cohorts"]);
        expect(screen.getByText("state")).toBeTruthy();       // the caption
        expect(screen.getByText("status")).toBeTruthy();
        // Mine sits outside every family; SCHEDULED sits inside the state family.
        expect(screen.getByRole("button", { name: "Toggle cohort Mine" }).closest("[role=group]")).toBeNull();
        expect(screen.getByRole("button", { name: "Toggle cohort SCHEDULED" }).closest("[role=group]")?.getAttribute("aria-label")).toBe("state cohorts");
    });

    test("the preset bar hides an empty family member unless it is on; standalone and manage-mode cohorts always show", () => {
        const counts = () => new Map([["mine", 0n], ["proposed", 0n], ["scheduled", 4n], ["ready", 0n]]);
        const first = ui(<EastChakraSliceCohort value={familyValue(fakeSlice({ cohorts: familyCohorts(), activeCohorts: new Set(["ready"]) }, { cohortCounts: counts }))} />);
        expect(screen.queryByRole("button", { name: "Toggle cohort PROPOSED" })).toBeNull();     // empty, off → hidden
        expect(screen.getByRole("button", { name: "Toggle cohort SCHEDULED" })).toBeTruthy();   // has rows
        expect(screen.getByRole("button", { name: "Toggle cohort READY" })).toBeTruthy();       // empty but ON → shown, so it can be turned off
        expect(screen.getByRole("button", { name: "Toggle cohort Mine" })).toBeTruthy();        // standalone → always shown
        first.unmount();
        // The authoring surface shows every member — an empty one is still editable.
        ui(<EastChakraSliceCohort value={familyValue(fakeSlice({ cohorts: familyCohorts() }, { cohortCounts: counts }), { mode: none })} />);
        expect(screen.getByRole("button", { name: "Toggle cohort PROPOSED" })).toBeTruthy();
    });

    test("group=<family> shows that family alone, uncaptioned — one surface per family", () => {
        const slice = fakeSlice({ cohorts: familyCohorts() });
        ui(<EastChakraSliceCohort value={familyValue(slice, { group: some("status") })} />);
        expect(screen.getByRole("button", { name: "Toggle cohort READY" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Toggle cohort SCHEDULED" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Toggle cohort Mine" })).toBeNull();
        expect(screen.queryByText("status")).toBeNull();      // the host names the family
    });

    test("authoring in manage mode stores the typed family as group: some(...) and a blank one as none", async () => {
        const slice = fakeSlice();
        await uiOpen(<EastChakraSliceCohort value={familyValue(slice, { mode: none, editOpen: some(true) })} />);
        const user = userEvent.setup();
        fireEvent.change(screen.getByLabelText("Cohort name"), { target: { value: "Late" } });
        fireEvent.change(screen.getByLabelText("Cohort family"), { target: { value: "risk" } });
        await pickOption(user, "Field", "Sessions");
        await pickOption(user, "Operator", "≥");
        await user.click(screen.getByRole("spinbutton"));
        await user.paste("30");
        fireEvent.click(screen.getByText("Add"));
        fireEvent.click(screen.getByText("Apply"));
        const cohorts = slice.read().cohorts;
        expect(cohorts.length).toBe(1);
        expect(cohorts[0].group).toEqual(some("risk"));
    });

    test("against the REAL store: members of one family OR; families AND with each other and with a standalone cohort", () => {
        initializeStore(new UIStore());
        const cfg = sliceConfig({
            state:  variant("string", { label: "State",  accessor: (r: { state: string }) => r.state, format: none }),
            status: variant("string", { label: "Status", accessor: (r: { status: string }) => r.status, format: none }),
            owner:  variant("string", { label: "Owner",  accessor: (r: { owner: string }) => r.owner, format: none }),
        });
        const initial = {
            range: none, compare: none, filters: [], cohorts: familyCohorts(), activeCohorts: new Set(["proposed", "scheduled"]),
            breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
        };
        const rows = [
            { state: "PROPOSED",  status: "READY", owner: "me" },
            { state: "SCHEDULED", status: "READY", owner: "me" },
            { state: "SCHEDULED", status: "HELD",  owner: "you" },
            { state: "DONE",      status: "READY", owner: "me" },
        ];
        const handle: any = buildSliceHandle("real.families", cfg, initial, rows, none);
        expect(handle.resultCount()).toBe(3n);                  // PROPOSED or SCHEDULED
        act(() => { handle.toggleCohort("ready"); });
        expect(handle.resultCount()).toBe(2n);                  // … and READY
        act(() => { handle.toggleCohort("mine"); });
        expect(handle.resultCount()).toBe(2n);                  // … and mine (both READY rows are mine)
        act(() => { handle.toggleCohort("proposed"); });
        expect(handle.resultCount()).toBe(1n);                  // SCHEDULED ∧ READY ∧ mine
    });
});

describe("Slice.Legend — the facet bar (#188): in-set multi-select over self-excluding options", () => {
    const legendGroups = () => [
        { key: "EU", count: 3n, color: "{colors.brand.600}" },
        { key: "NA", count: 2n, color: "{colors.brand.800}" },
        { key: "APAC", count: 1n, color: "{colors.status.warn}" },
    ];
    const facetSlice = () => fakeSlice(
        { breakdown: some({ fieldId: "region", limit: none }) },
        { facetGroups: legendGroups, groups: legendGroups },
    );

    test("clicks maintain ONE in-set filter — add, add, remove, empty drops it", () => {
        const slice = facetSlice();
        ui(<EastChakraSliceLegend value={{ slice } as any} />);

        fireEvent.click(screen.getByLabelText("Filter to EU"));
        let filters = slice.read().filters;
        expect(filters.length).toBe(1);
        expect(filters[0].value.op.type).toBe("in");
        expect(equalStringSets(filters[0].value.op.value, new SortedSet(["EU"], compareStrings))).toBe(true);

        // Second selection ORs within the field — never an impossible AND —
        // into an East Set, which iterates in East's order.
        fireEvent.click(screen.getByLabelText("Filter to NA"));
        filters = slice.read().filters;
        expect(filters.length).toBe(1);
        expect(equalStringSets(filters[0].value.op.value, new SortedSet(["EU", "NA"], compareStrings))).toBe(true);
        expect([...filters[0].value.op.value]).toEqual(["EU", "NA"]);

        // Un-clicking removes a member; the options never disappeared (facet
        // items come from facetGroups, still all rendered).
        expect(screen.getByLabelText("Filter to APAC")).toBeTruthy();
        fireEvent.click(screen.getByLabelText("Filter to EU"));
        expect(equalStringSets(slice.read().filters[0].value.op.value, new SortedSet(["NA"], compareStrings))).toBe(true);

        // Emptying the selection drops the managed filter entirely.
        fireEvent.click(screen.getByLabelText("Filter to NA"));
        expect(slice.read().filters.length).toBe(0);
    });

    test("filter mode renders NO eye; other-field filters pass through untouched", () => {
        const slice = fakeSlice(
            {
                breakdown: some({ fieldId: "region", limit: none }),
                filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })],
            },
            { facetGroups: legendGroups, groups: legendGroups },
        );
        ui(<EastChakraSliceLegend value={{ slice } as any} />);
        expect(screen.queryByLabelText(/Toggle visibility/)).toBeNull();   // no eye in filter mode

        fireEvent.click(screen.getByLabelText("Filter to EU"));
        const filters = slice.read().filters;
        expect(filters.length).toBe(2);                                    // sessions filter untouched
        expect(filters.some((f: any) => f.value.fieldId === "sessions")).toBe(true);
    });

    test("mode='visibility' is the classic eye rail — whitelist only, no filter gestures", () => {
        const slice = facetSlice();
        ui(<EastChakraSliceLegend value={{ slice, mode: some(variant("visibility", null)) } as any} />);

        expect(screen.queryByLabelText(/Filter to/)).toBeNull();
        fireEvent.click(screen.getByLabelText("Toggle visibility of EU"));
        expect(slice.read().filters.length).toBe(0);             // no narrowing
        expect(slice.read().visible.type).toBe("some");          // whitelist written
        expect([...slice.read().visible.value]).toEqual(["NA", "APAC"]);
    });

    test("the roll-up 'other' bucket renders as a plain label when a limit is active", () => {
        const slice = fakeSlice(
            { breakdown: some({ fieldId: "region", limit: some(1n) }) },
            { facetGroups: () => [
                { key: "EU", count: 3n, color: "{colors.brand.600}" },
                { key: "other", count: 2n, color: "{colors.gray.400}" },
            ] },
        );
        ui(<EastChakraSliceLegend value={{ slice } as any} />);

        expect(screen.queryByLabelText("Filter to EU")).not.toBeNull();
        expect(screen.queryByLabelText("Filter to other")).toBeNull();  // synthetic bucket — inert
        expect(screen.getByText("other")).toBeTruthy();                 // …but still shown
    });
});

describe("Slice.Breakdown — the roll-up limit is an East Integer, printed and read by East", () => {
    const equalBreakdowns = equalFor(OptionType(Slice.Types.Breakdown));

    test("the select shows the limit as East prints it; a pick writes the Integer East reads, and 'all' writes none", () => {
        const slice = fakeSlice({ breakdown: some({ fieldId: "region", limit: some(25n) }) });
        ui(<EastChakraSliceBreakdown value={{ slice, density: some(variant("focused", null)) } as never} />);

        const select = screen.getByLabelText("Roll-up limit") as HTMLSelectElement;
        expect(select.value).toBe("25");

        fireEvent.change(select, { target: { value: "10" } });
        expect(equalBreakdowns(slice.read().breakdown, some({ fieldId: "region", limit: some(10n) }))).toBe(true);

        fireEvent.change(select, { target: { value: "all" } });
        expect(equalBreakdowns(slice.read().breakdown, some({ fieldId: "region", limit: none }))).toBe(true);
    });
});

describe("N of M — the denominator renders wherever counts do (#169)", () => {
    test("the focused Filter footer shows SHOWING result OF total", () => {
        const slice = fakeSlice({}, { resultCount: () => 1284n, totalCount: () => 50000n });
        const value: any = { slice, unit: some("events"), density: none, editOpen: none };
        ui(<EastChakraSliceFilter value={value} />);
        expect(screen.getByText(/SHOWING 1.284 OF 50.000 events/)).toBeTruthy();
    });

    test("the Filter footer omits the denominator when no rows are bound (total 0)", () => {
        const slice = fakeSlice({}, { resultCount: () => 0n });   // fake default totalCount = 0n
        const value: any = { slice, unit: some("events"), density: none, editOpen: none };
        ui(<EastChakraSliceFilter value={value} />);
        expect(screen.getByText("SHOWING 0 events")).toBeTruthy();
    });

    test("Slice.Summary shows result of total", () => {
        const slice = fakeSlice({}, { resultCount: () => 3n, totalCount: () => 12n });
        const value: any = { slice };
        ui(<EastChakraSliceSummary value={value} />);
        expect(screen.getByText("of 12")).toBeTruthy();
        expect(screen.getByText("results")).toBeTruthy();
    });
});

describe("Slice.Rail — the legend is an explicit affordance, never implicit (#187)", () => {
    const legendGroups = () => [
        { key: "EU", count: 3n, color: "{colors.brand.600}" },
        { key: "NA", count: 2n, color: "{colors.brand.800}" },
    ];

    test("listing 'legend' renders the legend beneath the cluster; omitting it renders none", () => {
        const withLegend = fakeSlice({ breakdown: some({ fieldId: "region", limit: none }) }, { groups: legendGroups, facetGroups: legendGroups });
        const first = ui(<EastChakraSliceRail value={{
            slice: withLegend,
            affordances: [variant("filter", null), variant("legend", null)],
            persist: none,
            brush: none,
        } as any} />);
        expect(screen.getByText("EU")).toBeTruthy();          // legend item rendered
        expect(screen.getByLabelText("Filter to EU")).toBeTruthy();
        first.unmount();

        const without = fakeSlice({ breakdown: some({ fieldId: "region", limit: none }) }, { groups: legendGroups });
        ui(<EastChakraSliceRail value={{
            slice: without,
            affordances: [variant("filter", null)],
            persist: none,
            brush: none,
        } as any} />);
        expect(screen.queryByText("EU")).toBeNull();          // nothing mounts implicitly
    });
});

describe("Slice.Rail brush — formatted axis + count histogram, rich by default (#190)", () => {
    const brushInitial = {
        range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
    };
    const currencyCfg = sliceConfig({
        qty: variant("integer", { label: "Qty", accessor: (r: { qty: bigint }) => r.qty, format: some(variant("currency", { code: "USD", compact: true })) }),
    }, { rangeFieldId: some("qty") });
    const rows = [
        { qty: 0n }, { qty: 100n }, { qty: 150n }, { qty: 200n },
        { qty: 900n }, { qty: 950n }, { qty: 1000n },
    ];

    test("by default the strip shows currency-formatted axis labels and histogram bars", () => {
        initializeStore(new UIStore());
        const handle: any = buildSliceHandle("brush.rich", currencyCfg, brushInitial, rows, none);
        const { container } = ui(<EastChakraSliceRail value={{
            slice: handle,
            affordances: [variant("brush", null)],
            persist: none,
            brush: none,                                       // absent options = rich default
        } as any} />);

        // The field's declared currency format drives the axis (min … max).
        expect(screen.getAllByText(/\$/).length).toBeGreaterThanOrEqual(2);
        // The self-excluding count histogram renders behind the track.
        expect(container.querySelectorAll("[data-brush-bar]").length).toBeGreaterThan(0);
    });

    test("brush={{ axis: false, count: false }} restores the minimal bare track", () => {
        initializeStore(new UIStore());
        const handle: any = buildSliceHandle("brush.bare", currencyCfg, brushInitial, rows, none);
        const { container } = ui(<EastChakraSliceRail value={{
            slice: handle,
            affordances: [variant("brush", null)],
            persist: none,
            brush: some({ axis: some(false), count: some(false), buckets: none }),
        } as any} />);

        expect(screen.queryByText(/\$/)).toBeNull();
        expect(container.querySelectorAll("[data-brush-bar]").length).toBe(0);
    });
});

describe("Slice.Rail brush — the window's bounds follow the applied range's arm", () => {
    /** A range as the store holds it: decoded from East's own encoding. */
    const stored = (range: ValueTypeOf<typeof Slice.Types.Range>) =>
        decodeBeast2For(Slice.Types.Range)(encodeBeast2For(Slice.Types.Range)(range));

    test("a range of the field's kind gives its bounds on the domain's numbers", () => {
        const from = new Date("2025-03-01T00:00:00Z");
        const to = new Date("2025-03-28T00:00:00Z");
        expect(rangeBounds(stored(variant("datetime", { from, to })), "datetime")).toEqual({ from: from.getTime(), to: to.getTime() });
        expect(rangeBounds(stored(variant("integer", { from: 200n, to: 400n })), "integer")).toEqual({ from: 200, to: 400 });
        expect(rangeBounds(stored(variant("float", { from: 0.25, to: 0.75 })), "float")).toEqual({ from: 0.25, to: 0.75 });
    });

    test("a preset has no literal bounds, and an arm that is not the field's kind (inert in the engine) draws no window", () => {
        expect(rangeBounds(stored(variant("datetimePreset", variant("last7d", null))), "datetime")).toBeUndefined();
        expect(rangeBounds(stored(variant("integer", { from: 0n, to: 100n })), "datetime")).toBeUndefined();
        expect(rangeBounds(stored(variant("datetime", { from: new Date(0), to: new Date(1) })), "integer")).toBeUndefined();
    });

    test("a brushed window writes the range in the field's kind — an Integer field gets the whole Integers it spans", () => {
        const equalRanges = equalFor(Slice.Types.Range);
        const from = new Date("2025-03-01T00:00:00Z");
        const to = new Date("2025-03-28T00:00:00Z");
        expect(equalRanges(rangeOfWindow("datetime", from.getTime(), to.getTime()), stored(variant("datetime", { from, to })))).toBe(true);
        expect(equalRanges(rangeOfWindow("integer", 199.4, 400.2), stored(variant("integer", { from: 199n, to: 401n })))).toBe(true);
        expect(equalRanges(rangeOfWindow("float", 0.25, 0.75), stored(variant("float", { from: 0.25, to: 0.75 })))).toBe(true);
        // …and reads back as the window it spans.
        expect(rangeBounds(rangeOfWindow("integer", 200, 400), "integer")).toEqual({ from: 200, to: 400 });
    });
});

describe("Slice.Rail brush — slide + edge-resize the applied window (#192)", () => {
    const cfg = sliceConfig({
        qty: variant("integer", { label: "Qty", accessor: (r: { qty: bigint }) => r.qty, format: none }),
    }, { rangeFieldId: some("qty") });
    // Domain 0..1000 over a 1000px-wide mocked track → px === domain units.
    const rows = [{ qty: 0n }, { qty: 300n }, { qty: 600n }, { qty: 1000n }];
    const initial = {
        range: some(variant("integer", { from: 200n, to: 400n })),
        compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
    };

    const mount = (key: string) => {
        initializeStore(new UIStore());
        const handle: any = buildSliceHandle(key, cfg, initial, rows, none);
        const { container } = ui(<EastChakraSliceRail value={{
            slice: handle,
            affordances: [variant("brush", null)],
            persist: none,
            brush: some({ axis: some(false), count: some(false), buckets: none }),
        } as any} />);
        const track = container.querySelector("[data-brush-track]") as HTMLElement;
        Object.defineProperty(track, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, right: 1000, bottom: 18, width: 1000, height: 18, x: 0, y: 0, toJSON: () => ({}) }),
        });
        const appliedRange = () => {
            const r = handle.read().range;
            return r.type === "some" ? r.value.value as { from: bigint; to: bigint } : undefined;
        };
        return { container, track, appliedRange };
    };

    test("dragging the window body slides it — width preserved exactly", () => {
        const { container, track, appliedRange } = mount("brush.slide");
        // The applied window renders as the spec vocabulary: excluded-region
        // masks either side plus the two visible edge handles.
        expect(container.querySelectorAll("[data-brush-mask]").length).toBe(2);
        expect(container.querySelectorAll("[data-brush-handle]").length).toBe(2);

        fireEvent.pointerDown(track, { clientX: 300, pointerId: 1, buttons: 1 }); // inside 200..400
        fireEvent.pointerMove(track, { clientX: 400, pointerId: 1, buttons: 1 }); // +100
        fireEvent.pointerUp(track, { pointerId: 1 });
        expect(appliedRange()).toEqual({ from: 300n, to: 500n });
    });

    test("dragging an edge hot zone resizes only that bound", () => {
        const { track, appliedRange } = mount("brush.resize");
        fireEvent.pointerDown(track, { clientX: 200, pointerId: 1, buttons: 1 }); // on the lo edge
        fireEvent.pointerMove(track, { clientX: 100, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { pointerId: 1 });
        expect(appliedRange()).toEqual({ from: 100n, to: 400n });
    });

    test("dragging empty track still draws a fresh window (regression)", () => {
        const { track, appliedRange } = mount("brush.draw");
        fireEvent.pointerDown(track, { clientX: 600, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 800, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { pointerId: 1 });
        expect(appliedRange()).toEqual({ from: 600n, to: 800n });
    });

    test("a click outside the window clears; a click inside never nukes the selection", () => {
        const { track, appliedRange } = mount("brush.click");
        // Click ON the window: no-op.
        fireEvent.pointerDown(track, { clientX: 300, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { pointerId: 1 });
        expect(appliedRange()).toEqual({ from: 200n, to: 400n });
        // Click on empty track: clears (the established gesture).
        fireEvent.pointerDown(track, { clientX: 600, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { pointerId: 1 });
        expect(appliedRange()).toBeUndefined();
    });
});

describe("Slice.Range — presets anchor to the DATA's date range; All clears (#195)", () => {
    const cfg = sliceConfig({
        day: variant("datetime", { label: "Day", accessor: (r: { day: Date }) => r.day, format: none }),
    }, { rangeFieldId: some("day") });
    // Historical rows — wall-clock presets would miss every one of them.
    const rows = [
        { day: new Date("2025-03-01") }, { day: new Date("2025-03-10") },
        { day: new Date("2025-03-20") }, { day: new Date("2025-03-28") },
    ];
    const initial = {
        range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
    };
    const mountRange = async (key: string, seed: object = initial) => {
        initializeStore(new UIStore());
        const handle: any = buildSliceHandle(key, cfg, seed, rows, none);
        await uiOpen(<EastChakraSliceRange value={{ slice: handle, editOpen: some(true) } as any} />);
        return handle;
    };

    test("a preset click pins a window ending at the data's LAST day — rows actually match", async () => {
        const handle = await mountRange("range.anchor");
        const user = userEvent.setup();
        await user.click(screen.getByText("7d"));

        // Pinned — not a rolling preset tag — anchored to the data max, and exactly
        // 7 days: presets step UTC days, so no timezone's DST moves them (#850).
        expect(handle.read().range).toEqual(some(variant("datetime", { from: new Date("2025-03-21"), to: new Date("2025-03-28") })));
        // The window lands ON the data: [Mar 21, Mar 28] holds exactly the Mar 28 row.
        expect(Number(handle.resultCount())).toBe(1);
    });

    test("the anchored 'Today' relabels to 'Last day'; All clears the range and shows the data extent", async () => {
        const handle = await mountRange("range.all", {
            ...initial,
            range: some(variant("datetime", { from: new Date("2025-03-01"), to: new Date("2025-03-10") })),
        });
        const user = userEvent.setup();

        expect(screen.queryByText("Today")).toBeNull();
        expect(screen.getByText("Last day")).toBeTruthy();

        await user.click(screen.getByText("All"));
        expect((handle.read().range as { type: string }).type).toBe("none");
        expect(Number(handle.resultCount())).toBe(4);
        expect(screen.getByText(/All data ·/)).toBeTruthy();
    });

    // #850 — a preset's window is whole UTC days, and the pill names those
    // days, in any timezone. In Los Angeles the data's last instant (01:30 UTC
    // on 29 June) is still the 28th: read locally, "Last day" would start at
    // the 28th's midnight and keep the row from the evening before.
    describe("in a timezone west of UTC, a preset is whole UTC days (#850)", () => {
        const last = new Date("2026-06-29T01:30:00Z");
        beforeEach(() => { vi.stubEnv("TZ", "America/Los_Angeles"); });
        afterEach(() => { vi.unstubAllEnvs(); });
        const mountOver = async (key: string, days: ReadonlyArray<Date>) => {
            initializeStore(new UIStore());
            const handle: any = buildSliceHandle(key, cfg, initial, days.map(day => ({ day })), none);
            await uiOpen(<EastChakraSliceRange value={{ slice: handle, editOpen: some(true) } as any} />);
            return handle;
        };

        test("the process really is in Los Angeles (a local reading says the 28th)", () => {
            expect(new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(last)).toBe("28");
        });

        test("'Last day' pins the data's last UTC day, and the pill and the resolve line name it", async () => {
            const handle = await mountOver("range.utc.day", [new Date("2026-06-28T23:00:00Z"), last]);
            await userEvent.setup().click(screen.getByText("Last day"));
            const { from, to } = handle.read().range.value.value as { from: Date; to: Date };
            expect(from.toISOString()).toBe("2026-06-29T00:00:00.000Z");
            expect(to.getTime()).toBe(last.getTime());
            expect(Number(handle.resultCount())).toBe(1);            // the 23:00Z row is the day before
            // The range's own bounds, joined by an en dash (#949).
            expect(screen.getByText("JUN 29 – JUN 29")).toBeTruthy();
            expect(screen.getByText("Resolves to JUN 29, 2026")).toBeTruthy();
        });

        test("'YTD' starts on 1 January UTC, while it is still the old year in Los Angeles", async () => {
            const newYear = new Date("2026-01-01T01:30:00Z");
            const handle = await mountOver("range.utc.ytd", [new Date("2025-12-31T23:00:00Z"), newYear]);
            await userEvent.setup().click(screen.getByText("YTD"));
            const { from } = handle.read().range.value.value as { from: Date; to: Date };
            expect(from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
            expect(Number(handle.resultCount())).toBe(1);
            expect(screen.getByText("Resolves to JAN 1, 2026")).toBeTruthy();
        });
    });
});

describe("Slice.Range — Custom pins the resolved window and exposes from/to inputs (#167)", () => {
    test("clicking Custom… pins the ACTIVE preset's resolved window — not a hardwired 30d", async () => {
        const slice = fakeSlice({ range: some(variant("datetimePreset", variant("last7d", null))) });
        const value: any = { slice, editOpen: some(true) };
        await uiOpen(<EastChakraSliceRange value={value} />);

        const user = userEvent.setup();
        await user.click(screen.getByText("Custom…"));

        const range = slice.read().range;
        expect(range.type).toBe("some");
        expect(range.value.type).toBe("datetime");
        const { from, to } = range.value.value as { from: Date; to: Date };
        const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
        expect(days).toBe(7);   // last7d's resolved window, not 30
    });

    test("an active custom range renders editable from/to date fields", async () => {
        const slice = fakeSlice({
            range: some(variant("datetime", {
                from: new Date("2026-01-01T00:00:00Z"),
                to:   new Date("2026-03-31T00:00:00Z"),
            })),
        });
        const value: any = { slice, editOpen: some(true) };
        await uiOpen(<EastChakraSliceRange value={value} />);

        // Two react-aria date fields → month/day/year segments (spinbuttons).
        expect(screen.getAllByRole("spinbutton").length).toBeGreaterThanOrEqual(6);
    });

    test("a preset range renders NO date fields (the editor is custom-only)", async () => {
        const slice = fakeSlice({ range: some(variant("datetimePreset", variant("last30d", null))) });
        const value: any = { slice, editOpen: some(true) };
        await uiOpen(<EastChakraSliceRange value={value} />);
        expect(screen.queryAllByRole("spinbutton").length).toBe(0);
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

    // #1239 — a pick searches its id. Zag's default selection behaviour wrote the
    // picked item's label into the box, and the box's input handler then
    // committed the label, after the id the pick had committed. Over a REAL
    // slice handle: its store renders the search again as each query lands, as
    // an app's does. The fake renders nothing as its search changes, so the box
    // re-synced from it whenever another render came — after the pick, from the
    // query typed before it.
    const pickCfg = sliceConfig({
        name: variant("string", { label: "Name", accessor: (r: { sku: string; name: string }) => r.name, format: none }),
    }, { searchFieldIds: ["name"] });
    const skus = [{ sku: "SKU-1", name: "Oak board" }, { sku: "SKU-2", name: "Ash board" }];
    for (const density of ["compact", "focused"] as const) {
        test(`${density}: a suggestion picked searches its id, and the box shows the id — never its label (#1239)`, async () => {
            initializeStore(new UIStore());
            const handle: any = buildSliceHandle(`search.pick.${density}`, pickCfg, {
                range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
                breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
            }, skus, some((r: { sku: string; name: string }) => ({ id: r.sku, label: r.name, meta: none })));
            ui(<EastChakraSliceSearch value={{ slice: handle, recent: [], density: some(variant(density, null)) } as never} />);
            const user = userEvent.setup();
            const box = screen.getByPlaceholderText("Search…") as HTMLInputElement;
            await user.click(box);
            await user.paste("board");
            const item = (await screen.findByText("Ash board")).closest<HTMLElement>('[data-part="item"]')!;
            fireEvent.pointerDown(item, { pointerType: "mouse", button: 0 });
            fireEvent.click(item);
            // Every commit the pick queued has run: the last is what the slice searches, and the box says it.
            await waitFor(() => expect(handle.read().search).toEqual(some("SKU-2")));
            await waitFor(() => expect(box.value).toBe("SKU-2"));
        });
    }

    // #1228 — on a touch screen Zag hears no focus move outside an open list,
    // so the search hears it, as Zag does on a desktop, and closes its own; a
    // blur to nothing moves the focus nowhere, and closes nothing.
    describe("on a touch screen (#1228)", () => {
        beforeEach(() => { Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true }); });
        afterEach(() => { delete (navigator as { maxTouchPoints?: number }).maxTouchPoints; });

        const matches = () => [
            { id: "SKU-1", label: "Oak board", meta: none },
            { id: "SKU-2", label: "Ash board", meta: none },
        ];
        /** The list, while it is open. */
        const openContent = () => document.querySelector('[data-scope="combobox"][data-part="content"][data-state="open"]');
        /** Two animation frames: the search looks at a focus a frame after it moves, as Zag does. */
        const frames = () => act(() => new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }));

        /** The search — compact, or focused — beside a control outside it, its list open over two matches. */
        async function openSearch(density: "compact" | "focused") {
            const slice = fakeSlice({}, { matches });
            const value: any = { slice, recent: [], density: some(variant(density, null)) };
            ui(<><EastChakraSliceSearch value={value} /><button type="button">Elsewhere</button></>);
            const user = userEvent.setup();
            // Pasted in one event: the fake slice re-renders nothing as its search changes, so
            // the box, re-synced from it a render late, would drop a key typed between.
            await user.click(screen.getByPlaceholderText("Search…"));
            await user.paste("board");
            await Promise.resolve();
            expect(openContent()).not.toBeNull();
            // The list open a moment: Zag's own focus, into the box a frame after the list opens, has landed.
            await frames();
            return { slice, user };
        }

        for (const density of ["compact", "focused"] as const) {
            test(`${density}: a focus moved to a control outside the list closes it, the query kept and the focus where it went`, async () => {
                const { slice } = await openSearch(density);
                act(() => { screen.getByRole("button", { name: "Elsewhere" }).focus(); });
                await waitFor(() => expect(openContent()).toBeNull());
                expect((screen.getByPlaceholderText("Search…") as HTMLInputElement).value).toBe("board");
                expect(slice.read().search).toEqual(some("board"));
                // A close that put the focus back in the box would do so a frame later.
                await frames();
                expect(screen.getByRole("button", { name: "Elsewhere" })).toBe(document.activeElement);
            });
        }

        test("compact: the box blurred to nothing — the phone's keyboard dismissed — leaves the list open, the query kept; a focus moved outside after it closes the list", async () => {
            const { slice } = await openSearch("compact");
            act(() => { (screen.getByPlaceholderText("Search…") as HTMLInputElement).blur(); });
            await frames();
            expect(openContent()).not.toBeNull();
            expect((screen.getByPlaceholderText("Search…") as HTMLInputElement).value).toBe("board");
            expect(slice.read().search).toEqual(some("board"));
            act(() => { screen.getByRole("button", { name: "Elsewhere" }).focus(); });
            await waitFor(() => expect(openContent()).toBeNull());
            expect((screen.getByPlaceholderText("Search…") as HTMLInputElement).value).toBe("board");
            expect(slice.read().search).toEqual(some("board"));
        });

        test("a focus moved onto the combobox's trigger or into the list keeps it open; a suggestion tapped is still taken", async () => {
            const { slice } = await openSearch("focused");
            const setSearch = vi.spyOn(slice, "setSearch");
            act(() => { document.querySelector<HTMLElement>('[data-scope="combobox"][data-part="trigger"]')!.focus(); });
            await frames();
            expect(openContent()).not.toBeNull();
            const item = screen.getByText("Ash board").closest<HTMLElement>('[data-part="item"]')!;
            act(() => { item.focus(); });
            await frames();
            expect(openContent()).not.toBeNull();
            fireEvent.pointerDown(item, { pointerType: "touch", button: 0 });
            fireEvent.click(item);
            // The pick commits its id as the query.
            await waitFor(() => expect(setSearch).toHaveBeenCalledWith(some("SKU-2")));
            expect(openContent()).toBeNull();
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// #170 — the REAL path: render → compiled handle → UIStore (beast2) →
// useSliceReactivity → chip. Every suite above runs against the fake; a
// regression in the real primitives or the store subscription is invisible
// there. These mount EastChakraSliceFilter over a real Slice.bind handle.
// ═══════════════════════════════════════════════════════════════════════════

describe("Slice.Filter against the REAL store — round-trip + reactivity (#170)", () => {
    const realCfg = sliceConfig({
        scenario: variant("string",  { label: "Scenario", accessor: (r: { scenario: string }) => r.scenario, format: none }),
        sessions: variant("integer", { label: "Sessions", accessor: (r: { sessions: bigint }) => r.sessions, format: none }),
    }, { searchFieldIds: ["scenario"] });
    const realInitial = {
        range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
    };
    const rows = [
        { scenario: "v3", sessions: 42n },
        { scenario: "v3", sessions: 12n },
        { scenario: "v2", sessions: 55n },
    ];

    test("driving the builder writes the real store AND the chip + SHOWING count render from it", async () => {
        initializeStore(new UIStore());
        const handle: any = buildSliceHandle("real.filter", realCfg, realInitial, rows, none);
        const value: any = { slice: handle, unit: some("events"), density: none, editOpen: some(true) };
        await uiOpen(<EastChakraSliceFilter value={value} />);
        expect(screen.getByText(/SHOWING 3 OF 3 events/)).toBeTruthy();

        const user = userEvent.setup();
        await pickOption(user, "Field", "Sessions");
        await pickOption(user, "Operator", "≥");
        await user.click(await screen.findByRole("spinbutton"));
        await user.paste("20");
        fireEvent.click(screen.getByText("Add"));

        // The store round-tripped through the real primitives (beast2)…
        const stored = handle.read();
        expect(stored.filters.length).toBe(1);
        expect(stored.filters[0].value.op.value).toBe(20n);
        // …and the DOM re-rendered from it: chip + count footer.
        expect(await screen.findByText(/sessions ≥ 20/)).toBeTruthy();
        expect(screen.getByText(/SHOWING 2 OF 3 events/)).toBeTruthy();
    });

    test("the legend facet narrows the REAL store rows while its options never disappear (#188)", async () => {
        initializeStore(new UIStore());
        const bdCfg = sliceConfig({
            region:   variant("string",  { label: "Region",   accessor: (r: { region: string }) => r.region, format: none }),
            sessions: variant("integer", { label: "Sessions", accessor: (r: { sessions: bigint }) => r.sessions, format: none }),
        }, { breakdownFieldIds: ["region"] });
        const bdInitial = { ...realInitial, breakdown: some({ fieldId: "region", limit: none }) };
        const handle: any = buildSliceHandle("real.legend", bdCfg, bdInitial, [
            { region: "EU", sessions: 1n }, { region: "EU", sessions: 2n }, { region: "NA", sessions: 3n },
        ], none);
        const { rerender } = ui(<EastChakraSliceLegend value={{ slice: handle } as never} />);

        // Selecting EU narrows the row feed (what a sibling Table sees)…
        fireEvent.click(screen.getByLabelText("Filter to EU"));
        // The store holds East Sets (SortedSet), so compare membership rather
        // than the container: toEqual would demand a plain JS Set.
        expect([...handle.read().filters[0].value.op.value].sort()).toEqual(["EU"]);
        expect(handle.resultCount()).toBe(2n);
        // …but the facet options are SELF-EXCLUDING: NA is still offered.
        expect(handle.facetGroups().map((g: { key: string }) => g.key).sort()).toEqual(["EU", "NA"]);

        // Adding NA ORs within the field — both regions' rows return.
        rerender(<ChakraProvider value={system}><EastChakraSliceLegend value={{ slice: handle } as never} /></ChakraProvider>);
        fireEvent.click(screen.getByLabelText("Filter to NA"));
        expect([...handle.read().filters[0].value.op.value].sort()).toEqual(["EU", "NA"]);
        expect(handle.resultCount()).toBe(3n);
    });

    test("a handle mutation OUTSIDE React re-renders the mounted surface (useSliceReactivity)", async () => {
        initializeStore(new UIStore());
        const handle: any = buildSliceHandle("real.reactive", realCfg, realInitial, rows, none);
        const value: any = { slice: handle, unit: some("events"), density: none, editOpen: none };
        ui(<EastChakraSliceFilter value={value} />);
        expect(screen.getByText(/SHOWING 3 OF 3 events/)).toBeTruthy();
        expect(screen.queryByText(/sessions ≥ 20/)).toBeNull();

        // Not a React event — the raw compiled handle, as any consumer could call it.
        act(() => { handle.addFilter(variant("integer", { fieldId: "sessions", op: variant("gte", 20n) })); });

        expect(await screen.findByText(/sessions ≥ 20/)).toBeTruthy();   // chip appeared
        expect(screen.getByText(/SHOWING 2 OF 3 events/)).toBeTruthy();  // count updated
    });
});

// ============================================================================
// Rail affordance resolution + summary descriptors (#319)
// ============================================================================

describe("rail affordance resolution — presets IS the cohort surface (#319)", () => {
    const withCohorts = { cohorts: [{ id: "eu", name: "EU", filters: [] }] } as never;
    const noCohorts = { cohorts: [] } as never;

    test("appends a cohort surface when the slice has saved cohorts and none is listed", () => {
        expect(railAffordanceKinds(["filter", "search"], withCohorts)).toEqual(["filter", "search", "cohort"]);
    });
    test("does NOT append when a presets bar already IS the cohort surface", () => {
        expect(railAffordanceKinds(["presets"], withCohorts)).toEqual(["presets"]);
    });
    test("does NOT append when a cohort surface is already listed", () => {
        expect(railAffordanceKinds(["cohort"], withCohorts)).toEqual(["cohort"]);
    });
    test("appends nothing when there are no saved cohorts", () => {
        expect(railAffordanceKinds(["filter"], noCohorts)).toEqual(["filter"]);
    });

    test("a presets rail renders exactly one cohort surface — no duplicate authoring band", () => {
        const slice = fakeSlice({
            cohorts: [
                { id: "eu", name: "EU", filters: [variant("string", { fieldId: "region", op: variant("eq", "EU") })] },
                { id: "bulk", name: "Bulk", filters: [variant("integer", { fieldId: "qty", op: variant("gte", 20n) })] },
            ],
        });
        ui(<EastChakraSliceRail value={{ slice, affordances: [variant("presets", null)], persist: none, brush: none } as never} />);
        // Toggle presets render each preset once…
        expect(screen.getAllByText("EU")).toHaveLength(1);
        expect(screen.getAllByText("Bulk")).toHaveLength(1);
        // …and there is NO manage-mode "+ cohort" authoring pill from a second band.
        expect(screen.queryByText("cohort")).toBeNull();
    });
});

describe("rail summary descriptors — capability when idle, active when narrowing (#319)", () => {
    const base = {
        range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
    };
    const dims = [{ fieldId: "region", label: "Region" }] as never;

    test("filter: 'Filter' idle, 'N filters' active", () => {
        expect(affordanceDescriptor("filter", base as never, dims)).toMatchObject({ text: "Filter", active: false });
        expect(affordanceDescriptor("filter", { ...base, filters: [1, 2, 3] } as never, dims)).toMatchObject({ text: "3 filters", active: true });
    });
    test("cohort: available count idle, name(+N) active", () => {
        const avail = { ...base, cohorts: [{ id: "eu", name: "EU", filters: [] }, { id: "bulk", name: "Bulk", filters: [] }] } as never;
        expect(affordanceDescriptor("cohort", avail, dims)).toMatchObject({ text: "2 cohorts", active: false });
        const active = { ...(avail as object), activeCohorts: new Set(["eu", "bulk"]) } as never;
        expect(affordanceDescriptor("cohort", active, dims)).toMatchObject({ text: "EU +1", active: true });
    });
    test("cohort with families: the idle chip names the families, not the size of the bag", () => {
        const families = { ...base, cohorts: [
            { id: "p", name: "PROPOSED", group: some("state"), filters: [] },
            { id: "s", name: "SCHEDULED", group: some("state"), filters: [] },
            { id: "r", name: "READY", group: some("status"), filters: [] },
            { id: "mine", name: "Mine", group: none, filters: [] },
        ] } as never;
        expect(affordanceDescriptor("presets", families, dims)).toMatchObject({ text: "state · status", active: false });
    });
    test("search: 'Search' idle, quoted query active", () => {
        expect(affordanceDescriptor("search", base as never, dims)).toMatchObject({ text: "Search", active: false });
        expect(affordanceDescriptor("search", { ...base, search: some("proc") } as never, dims)).toMatchObject({ text: "\"proc\"", active: true });
    });
    test("breakdown: 'Split' idle, dimension label active", () => {
        expect(affordanceDescriptor("breakdown", base as never, dims)).toMatchObject({ text: "Split", active: false });
        expect(affordanceDescriptor("breakdown", { ...base, breakdown: some({ fieldId: "region" }) } as never, dims)).toMatchObject({ text: "Region", active: true });
    });
});

// ============================================================================
// #1231 — every compact trigger by the keyboard; a clause on a touch screen
// ============================================================================

/** Tab from the page's start until the focus is on `target`: whether it gets there. */
async function tabTo(user: ReturnType<typeof userEvent.setup>, target: Element): Promise<boolean> {
    for (let i = 0; i < 40 && document.activeElement !== target; i++) await user.tab();
    return document.activeElement === target;
}

/** The trigger a compact affordance's editor hangs from: the element carrying its popover's `aria-haspopup`. */
const triggerOf = (el: Element): HTMLElement => el.closest<HTMLElement>("[aria-haspopup]")!;

describe("the compact slice triggers — each a button the keyboard reaches and opens (#1231)", () => {
    const compact = some(variant("compact", null));
    const clause = variant("integer", { fieldId: "sessions", op: variant("gte", 20n) });

    // The `+N more` case lays every element out 100px wide against a 0-wide
    // row, so every clause folds — jsdom lays nothing out (see #161's test).
    let offsetWidth: PropertyDescriptor | undefined;
    afterEach(() => {
        if (offsetWidth === undefined) return;
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
        offsetWidth = undefined;
    });
    function foldEveryClause() {
        offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return 100; } });
    }

    /** The rail's cluster at its narrowest form — the icon — as the shared toolbar draws it. */
    function FoldedRail({ slice }: { slice: unknown }) {
        const forms = useSliceToolbarItems(slice as never, [{ key: "rail", kinds: ["filter", "search"] }])[0]!.forms;
        return <>{forms[forms.length - 1]}</>;
    }

    /** Each compact trigger, mounted: the element its editor hangs from. */
    const TRIGGERS: ReadonlyArray<{ name: string; mount: () => HTMLElement }> = [
        {
            name: "a filter's clause chip",
            mount: () => {
                ui(<EastChakraSliceFilter value={{ slice: fakeSlice({ filters: [clause] }), unit: none, density: compact, editOpen: none } as never} />);
                return triggerOf(screen.getByText(/sessions ≥ 20/));
            },
        },
        {
            name: "the filter's + filter",
            mount: () => {
                const { container } = ui(<EastChakraSliceFilter value={{ slice: fakeSlice(), unit: none, density: compact, editOpen: none } as never} />);
                return triggerOf(container.querySelector("[data-slice-add='filter']")!);
            },
        },
        {
            name: "the filter's +N more",
            mount: () => {
                foldEveryClause();
                const filters = [clause, variant("string", { fieldId: "region", op: variant("eq", "EU") })];
                ui(<EastChakraSliceFilter value={{ slice: fakeSlice({ filters }), unit: none, density: compact, editOpen: none } as never} />);
                return triggerOf(screen.getByText("+2 more"));
            },
        },
        {
            name: "the cohort's + cohort",
            mount: () => {
                ui(<EastChakraSliceCohort value={{ slice: fakeSlice(), createdBy: none, lastEdited: none, reevaluateEvery: none, density: none, editOpen: none } as never} />);
                return triggerOf(screen.getByText("cohort"));
            },
        },
        {
            name: "the breakdown's + dimension",
            mount: () => {
                ui(<EastChakraSliceBreakdown value={{ slice: fakeSlice(), density: compact } as never} />);
                return triggerOf(screen.getByText("dimension"));
            },
        },
        {
            name: "the range chip",
            mount: () => {
                const { container } = ui(<EastChakraSliceRange value={{ slice: fakeSlice(), editOpen: none } as never} />);
                return triggerOf(container.querySelector("[data-slice-range-label]")!);
            },
        },
        {
            name: "the rail's folded trigger",
            mount: () => {
                const { container } = ui(<FoldedRail slice={fakeSlice({ filters: [clause] })} />);
                return triggerOf(container.querySelector("[data-slot='railTrigger']")!);
            },
        },
    ];

    for (const { name, mount } of TRIGGERS) {
        test(`${name}: a tab stop, its editor opened by Enter`, async () => {
            const trigger = mount();
            const user = userEvent.setup();
            expect(await tabTo(user, trigger)).toBe(true);
            expect(screen.queryByRole("dialog")).toBeNull();
            await user.keyboard("{Enter}");
            expect(await screen.findByRole("dialog")).toBeTruthy();
        });

        test(`${name}: its editor opened by Space`, async () => {
            const trigger = mount();
            const user = userEvent.setup();
            expect(await tabTo(user, trigger)).toBe(true);
            await user.keyboard(" ");
            expect(await screen.findByRole("dialog")).toBeTruthy();
        });
    }
});

describe("a clause chip — removed by its × with a mouse, by Delete, by its editor's Remove filter, and on a touch screen by its editor alone (#1231)", () => {
    const cfg = sliceConfig({
        scenario: variant("string",  { label: "Scenario", accessor: (r: { scenario: string }) => r.scenario, format: none }),
        sessions: variant("integer", { label: "Sessions", accessor: (r: { sessions: bigint }) => r.sessions, format: none }),
    });
    const clauses = [
        variant("string", { fieldId: "scenario", op: variant("contains", "v") }),
        variant("integer", { fieldId: "sessions", op: variant("gte", 20n) }),
    ];
    const rows = [{ scenario: "v3", sessions: 42n }, { scenario: "v2", sessions: 12n }];

    /** The filter over a REAL slice handle — its store re-renders the chips as clauses go. */
    function mountClauses(key: string) {
        initializeStore(new UIStore());
        const handle: any = buildSliceHandle(key, cfg, {
            range: none, compare: none, filters: clauses, cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
        }, rows, none);
        const utils = ui(<EastChakraSliceFilter value={{ slice: handle, unit: none, density: some(variant("compact", null)), editOpen: none } as never} />);
        return { handle, ...utils };
    }
    /** A clause's chip, by its words. */
    const chip = (words: RegExp) => triggerOf(screen.getByText(words));

    test("a click on its × removes the clause and opens no editor — not the one of the clause that takes its place", async () => {
        const { handle } = mountClauses("clause.mouse");
        const user = userEvent.setup();
        await user.click(within(chip(/scenario contains v/)).getByText("×"));
        expect(handle.read().filters.length).toBe(1);
        expect(predEqual(handle.read().filters[0], clauses[1])).toBe(true);
        // A click that reached the chip would open the editor of the clause now in its place.
        await expect(screen.findByRole("dialog", undefined, { timeout: 300 })).rejects.toThrow();
    });

    test("Delete on a focused clause removes it, the focus on the clause that takes its place, then on + filter", async () => {
        const { handle, container } = mountClauses("clause.delete");
        const user = userEvent.setup();
        expect(await tabTo(user, chip(/scenario contains v/))).toBe(true);
        await user.keyboard("{Delete}");
        expect(handle.read().filters.length).toBe(1);
        expect(predEqual(handle.read().filters[0], clauses[1])).toBe(true);
        expect(document.activeElement).toBe(chip(/sessions ≥ 20/));
        await user.keyboard("{Delete}");
        expect(handle.read().filters.length).toBe(0);
        expect(document.activeElement).toBe(triggerOf(container.querySelector("[data-slice-add='filter']")!));
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("Remove filter in a clause's editor removes the clause and closes the editor", async () => {
        const { handle } = mountClauses("clause.editor");
        const user = userEvent.setup();
        await user.click(screen.getByText(/sessions ≥ 20/));
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: "Remove filter" }));
        expect(handle.read().filters.length).toBe(1);
        expect(predEqual(handle.read().filters[0], clauses[0])).toBe(true);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("with a mouse a clause chip draws its × beside its words; on a coarse pointer it draws none, and the chip opens its editor, Remove filter in its foot", async () => {
        const fine = mountClauses("clause.fine");
        expect(within(chip(/sessions ≥ 20/)).getByText("×")).toBeTruthy();
        fine.unmount();

        vi.stubGlobal("matchMedia", (query: string) => ({
            matches: query === "(pointer: coarse)", media: query, onchange: null,
            addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
        }));
        try {
            const { handle } = mountClauses("clause.coarse");
            expect(within(chip(/scenario contains v/)).queryByText("×")).toBeNull();
            expect(within(chip(/sessions ≥ 20/)).queryByText("×")).toBeNull();
            const user = userEvent.setup();
            await user.click(screen.getByText(/sessions ≥ 20/));
            const dialog = await screen.findByRole("dialog");
            await user.click(within(dialog).getByRole("button", { name: "Remove filter" }));
            expect(handle.read().filters.length).toBe(1);
            expect(predEqual(handle.read().filters[0], clauses[0])).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe("the rail's cluster, held by its open editor, keeps its forms (#1231)", () => {
    const cfg = sliceConfig({
        sessions: variant("integer", { label: "Sessions", accessor: (r: { sessions: bigint }) => r.sessions, format: none }),
    });

    test("a clause added in the open editor adds no fold step under the held form; closed, the cluster takes it", async () => {
        initializeStore(new UIStore());
        const handle: any = buildSliceHandle("rail.held", cfg, {
            range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
        }, [{ sessions: 42n }], none);
        const seen: { forms: number; held: boolean | undefined }[] = [];
        function Probe() {
            const item = useSliceToolbarItems(handle, [{ key: "rail", kinds: ["filter", "search"] }])[0]!;
            seen.push({ forms: item.forms.length, held: item.held });
            // The cluster at its narrowest: the icon, its editor's trigger.
            return <>{item.forms[item.forms.length - 1]}</>;
        }
        const { container } = ui(<Probe />);
        const atRest = seen[seen.length - 1]!;
        expect(atRest.held).toBe(false);
        const user = userEvent.setup();
        await user.click(container.querySelector("[data-slot='railTrigger']")!);
        expect(await screen.findByRole("dialog")).toBeTruthy();
        expect(seen[seen.length - 1]!.held).toBe(true);
        // A clause added while the editor is open: the held cluster's forms stay as they were.
        act(() => { handle.addFilter(variant("integer", { fieldId: "sessions", op: variant("gte", 20n) })); });
        expect(handle.read().filters.length).toBe(1);
        expect(seen[seen.length - 1]).toEqual({ forms: atRest.forms, held: true });
        // Closed, the cluster takes the clause's fold step.
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
        expect(seen[seen.length - 1]).toEqual({ forms: atRest.forms + 1, held: false });
    });
});

// ============================================================================
// #1253 — the cohort's and the breakdown's chips on a touch screen, and the
// sectioned editor's disclosures
// ============================================================================

/** A coarse primary pointer, as a touch screen reports it. */
function coarsePointer() {
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query === "(pointer: coarse)", media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    }));
}

describe("a cohort chip on a touch screen — one target opening its editor, On · Off in its foot (#1253)", () => {
    const cfg = sliceConfig({
        region:   variant("string",  { label: "Region",   accessor: (r: { region: string }) => r.region, format: none }),
        sessions: variant("integer", { label: "Sessions", accessor: (r: { sessions: bigint }) => r.sessions, format: none }),
    });
    const cohorts = [{ id: "eu", name: "EU", group: none, filters: [variant("string", { fieldId: "region", op: variant("eq", "EU") })] }];
    const rows = [{ region: "EU", sessions: 42n }, { region: "NA", sessions: 12n }];
    afterEach(() => { vi.unstubAllGlobals(); });

    /** The cohort surface over a REAL slice handle — its store re-renders the chip as the cohort turns on and off. */
    function mountCohorts(key: string, on: boolean, mode: "manage" | "toggle" = "manage") {
        initializeStore(new UIStore());
        const handle: any = buildSliceHandle(key, cfg, {
            range: none, compare: none, filters: [], cohorts, activeCohorts: new Set<string>(on ? ["eu"] : []),
            breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
        }, rows, none);
        ui(<EastChakraSliceCohort value={{ slice: handle, createdBy: none, lastEdited: none, reevaluateEvery: none, density: none, editOpen: none, mode: some(variant(mode, null)) } as never} />);
        return { handle, isOn: (): boolean => handle.read().activeCohorts.has("eu") };
    }

    test("with a mouse the chip holds its toggle and its pencil; on a touch screen it is one button, its words in it, whose tap opens the editor and toggles nothing", async () => {
        const fine = mountCohorts("cohort.fine", false);
        expect(screen.getByRole("button", { name: "Toggle cohort EU" }).hasAttribute("data-slice-cohort")).toBe(false);
        expect(screen.getByRole("button", { name: "Edit cohort EU" }).textContent).toBe("");
        expect(fine.isOn()).toBe(false);
        cleanup();

        coarsePointer();
        const { isOn } = mountCohorts("cohort.coarse", false);
        expect(screen.queryByRole("button", { name: "Toggle cohort EU" })).toBeNull();
        const chip = screen.getByRole("button", { name: "Edit cohort EU" });
        expect(chip.hasAttribute("data-slice-cohort")).toBe(true);    // the chip is the button
        expect(chip.textContent).toContain("EU");
        const user = userEvent.setup();
        await user.click(chip);
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByRole("button", { name: "Remove cohort" })).toBeTruthy();
        expect(isOn()).toBe(false);
    });

    test("On · Off in its editor's foot turns the cohort on and off at once, the editor still open, and says which it is", async () => {
        coarsePointer();
        const { isOn } = mountCohorts("cohort.onoff", false);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Edit cohort EU" }));
        const dialog = await screen.findByRole("dialog");
        const pressed = () => within(within(dialog).getByRole("group", { name: "Cohort state" })).getAllByRole("button")
            .map((b) => [b.textContent, b.getAttribute("aria-pressed")]);
        expect(pressed()).toEqual([["On", "false"], ["Off", "true"]]);
        await user.click(within(dialog).getByRole("button", { name: "On" }));
        expect(isOn()).toBe(true);
        await waitFor(() => expect(pressed()).toEqual([["On", "true"], ["Off", "false"]]));
        expect(screen.getByRole("dialog")).toBe(dialog);
        await user.click(within(dialog).getByRole("button", { name: "Off" }));
        expect(isOn()).toBe(false);
        await waitFor(() => expect(pressed()).toEqual([["On", "false"], ["Off", "true"]]));
    });

    test("Apply keeps the state On · Off set: a cohort turned off in its editor stays off", async () => {
        coarsePointer();
        const { isOn } = mountCohorts("cohort.apply", true);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Edit cohort EU" }));
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: "Off" }));
        expect(isOn()).toBe(false);
        await user.click(within(dialog).getByRole("button", { name: "Apply" }));
        // Apply commits through the store, which closes the editor as it re-renders.
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(isOn()).toBe(false);
    });

    test("with a mouse its editor has no On · Off, and Apply turns the cohort on, as it did", async () => {
        const { isOn } = mountCohorts("cohort.mouse.apply", false);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Edit cohort EU" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).queryByRole("group", { name: "Cohort state" })).toBeNull();
        await user.click(within(dialog).getByRole("button", { name: "Apply" }));
        expect(isOn()).toBe(true);
    });

    test("on a touch screen a preset bar's chip is one button that toggles the cohort", async () => {
        coarsePointer();
        const { isOn } = mountCohorts("cohort.preset", false, "toggle");
        const chip = screen.getByRole("button", { name: "Toggle cohort EU" });
        expect(chip.hasAttribute("data-slice-cohort")).toBe(true);
        expect(chip.getAttribute("aria-pressed")).toBe("false");
        await userEvent.setup().click(chip);
        expect(isOn()).toBe(true);
        await waitFor(() => expect(screen.getByRole("button", { name: "Toggle cohort EU" }).getAttribute("aria-pressed")).toBe("true"));
    });
});

describe("the breakdown's chip — a button opening its editor: its × and Delete with a mouse, its editor alone on a touch screen (#1253)", () => {
    const cfg = sliceConfig({
        region:  variant("string", { label: "Region",  accessor: (r: { region: string }) => r.region, format: none }),
        channel: variant("string", { label: "Channel", accessor: (r: { channel: string }) => r.channel, format: none }),
    }, { breakdownFieldIds: ["region", "channel"] });
    const rows = [{ region: "EU", channel: "web" }, { region: "NA", channel: "store" }];
    const equalBreakdowns = equalFor(OptionType(Slice.Types.Breakdown));
    afterEach(() => { vi.unstubAllGlobals(); });

    /** The breakdown, split by region, over a REAL slice handle. */
    function mountBreakdown(key: string, density: "compact" | "focused" = "compact") {
        initializeStore(new UIStore());
        const handle: any = buildSliceHandle(key, cfg, {
            range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: some({ fieldId: "region", limit: none }), search: none, visible: none, selectedIndex: none, resolution: none,
        }, rows, none);
        const utils = ui(<EastChakraSliceBreakdown value={{ slice: handle, density: some(variant(density, null)) } as never} />);
        return { ...utils, handle, splitBy: () => handle.read().breakdown };
    }
    const chip = (label: string) => screen.getByRole("button", { name: `Split by ${label}` });

    test("a click on its × clears the breakdown and opens no editor", async () => {
        const { splitBy } = mountBreakdown("breakdown.mouse");
        await userEvent.setup().click(within(chip("Region")).getByText("×"));
        expect(equalBreakdowns(splitBy(), none)).toBe(true);
        await expect(screen.findByRole("dialog", undefined, { timeout: 300 })).rejects.toThrow();
    });

    test("Delete on the focused chip clears the breakdown, the focus handed to + dimension", async () => {
        const { splitBy, container } = mountBreakdown("breakdown.delete");
        const user = userEvent.setup();
        expect(await tabTo(user, chip("Region"))).toBe(true);
        await user.keyboard("{Delete}");
        expect(equalBreakdowns(splitBy(), none)).toBe(true);
        await waitFor(() => expect(document.activeElement).toBe(triggerOf(container.querySelector("[data-slice-add='dimension']")!)));
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("its editor — opened by Enter, then by Space — switches the dimension, and its foot clears the breakdown", async () => {
        const { splitBy } = mountBreakdown("breakdown.editor");
        const user = userEvent.setup();
        expect(await tabTo(user, chip("Region"))).toBe(true);
        await user.keyboard("{Enter}");
        await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Channel" }));
        expect(equalBreakdowns(splitBy(), some({ fieldId: "channel", limit: none }))).toBe(true);
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(await tabTo(user, chip("Channel"))).toBe(true);
        await user.keyboard(" ");
        await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Clear breakdown" }));
        expect(equalBreakdowns(splitBy(), none)).toBe(true);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("the breakdown cleared from elsewhere while its editor is open takes the editor with it: the next split opens none", async () => {
        const { handle, splitBy } = mountBreakdown("breakdown.external");
        await userEvent.setup().click(chip("Region"));
        expect(await screen.findByRole("dialog")).toBeTruthy();
        act(() => { handle.setBreakdown(none); });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        act(() => { handle.setBreakdown(some({ fieldId: "channel", limit: none })); });
        expect(equalBreakdowns(splitBy(), some({ fieldId: "channel", limit: none }))).toBe(true);
        expect(await screen.findByRole("button", { name: "Split by Channel" })).toBeTruthy();
        await expect(screen.findByRole("dialog", undefined, { timeout: 300 })).rejects.toThrow();
    });

    test("on a touch screen the chip draws no ×, and its tap opens its editor, Clear breakdown in its foot", async () => {
        coarsePointer();
        const { splitBy } = mountBreakdown("breakdown.coarse");
        expect(within(chip("Region")).queryByText("×")).toBeNull();
        const user = userEvent.setup();
        await user.click(chip("Region"));
        await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Clear breakdown" }));
        expect(equalBreakdowns(splitBy(), none)).toBe(true);
    });

    test("focused, on a touch screen each dimension's chip is one button and none draws its ×: a tap on the active one clears it", async () => {
        const fine = mountBreakdown("breakdown.focused.fine", "focused");
        expect(screen.getByRole("button", { name: "Clear breakdown" })).toBeTruthy();
        fine.unmount();

        coarsePointer();
        const { splitBy } = mountBreakdown("breakdown.focused.coarse", "focused");
        expect(screen.queryByRole("button", { name: "Clear breakdown" })).toBeNull();
        const region = screen.getByRole("button", { name: "Region" });
        expect(region.getAttribute("aria-pressed")).toBe("true");
        expect(screen.getByRole("button", { name: "Channel" }).getAttribute("aria-pressed")).toBe("false");
        await userEvent.setup().click(region);
        expect(equalBreakdowns(splitBy(), none)).toBe(true);
    });
});

describe("the sectioned editor's disclosures — each trigger the button itself, saying it expands (#1253)", () => {
    test("a clause chip's disclosure: aria-expanded follows it, Enter opens it and Space closes it, aria-controls naming it while open", async () => {
        const slice = fakeSlice({ filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 20n) })] });
        const { container } = ui(
            <SliceDensityContext.Provider value="editor">
                <EastChakraSliceFilter value={{ slice, unit: none, density: none, editOpen: none } as never} />
            </SliceDensityContext.Provider>,
        );
        const chip = container.querySelector<HTMLElement>("[data-slice-clause='0']")!;
        expect(chip.tagName).toBe("BUTTON");
        expect(chip.getAttribute("aria-expanded")).toBe("false");
        expect(chip.hasAttribute("aria-controls")).toBe(false);
        const user = userEvent.setup();
        expect(await tabTo(user, chip)).toBe(true);
        await user.keyboard("{Enter}");
        await waitFor(() => expect(chip.getAttribute("aria-expanded")).toBe("true"));
        const region = document.getElementById(chip.getAttribute("aria-controls")!);
        expect(within(region!).getByRole("button", { name: "Remove filter" })).toBeTruthy();
        await user.keyboard(" ");
        await waitFor(() => expect(chip.getAttribute("aria-expanded")).toBe("false"));
        expect(within(container).queryByRole("button", { name: "Remove filter" })).toBeNull();
    });

    test("a trigger's own click is kept: it runs, and the disclosure opens", async () => {
        const own = vi.fn();
        function Host() {
            const [open, setOpen] = useState(false);
            return (
                <SliceDensityContext.Provider value="editor">
                    <SliceEditPopover open={open} onOpenChange={setOpen} label="Edit" trigger={<button type="button" onClick={own}>Trigger</button>}>
                        <span>Body</span>
                    </SliceEditPopover>
                </SliceDensityContext.Provider>
            );
        }
        ui(<Host />);
        await userEvent.setup().click(screen.getByRole("button", { name: "Trigger" }));
        expect(own).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("button", { name: "Trigger" }).getAttribute("aria-expanded")).toBe("true");
        expect(screen.getByText("Body")).toBeTruthy();
    });

    test("a click on a clause chip's × in the editor removes the clause and opens nothing", async () => {
        const slice = fakeSlice({ filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 20n) })] });
        const { container } = ui(
            <SliceDensityContext.Provider value="editor">
                <EastChakraSliceFilter value={{ slice, unit: none, density: none, editOpen: none } as never} />
            </SliceDensityContext.Provider>,
        );
        const chip = container.querySelector<HTMLElement>("[data-slice-clause='0']")!;
        await userEvent.setup().click(within(chip).getByText("×"));
        expect(slice.read().filters.length).toBe(0);
        expect(chip.getAttribute("aria-expanded")).toBe("false");
    });
});
