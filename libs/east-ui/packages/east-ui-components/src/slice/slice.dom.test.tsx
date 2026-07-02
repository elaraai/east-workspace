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

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none, equalFor } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { buildSliceHandle } from "../platform/slice/index.js";
import { initializeStore } from "../platform/state-runtime.js";
import { UIStore } from "../platform/state-store.js";
import { system } from "../theme/index.js";
import { EastChakraSliceCohort } from "./cohort/index.js";
import { EastChakraSliceFilter } from "./filter/index.js";
import { EastChakraSliceLegend } from "./legend/index.js";
import { EastChakraSliceRail } from "./rail/index.js";
import { EastChakraSliceRange } from "./range/index.js";
import { EastChakraSliceSearch } from "./search/index.js";
import { EastChakraSliceSummary } from "./summary/index.js";

/** Structural predicate equality — the same comparator the real impl uses. */
const predEqual = equalFor(Slice.Types.Predicate) as (x: unknown, y: unknown) => boolean;

/** Minimal `SliceBind` closure over mutable JS state — mirrors the runtime
 *  impl. `derived` overrides the data-derived stubs (groups, fields, …) for
 *  tests that need non-empty platform-computed results. */
function fakeSlice(init: Record<string, unknown> = {}, derived: Record<string, unknown> = {}) {
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
        ui(<EastChakraSliceCohort value={value} />);

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
        ui(<EastChakraSliceCohort value={value} />);

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
});

describe("Slice.Filter — add-filter builder applies (in a Slice.Edit popover)", () => {
    test("editOpen opens the builder; filling it and clicking Add appends a predicate", async () => {
        const slice = fakeSlice();
        const value: any = { slice, unit: some("events"), density: none, editOpen: some(true) };
        ui(<EastChakraSliceFilter value={value} />);

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
        const first = ui(<EastChakraSliceFilter value={value} />);
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
        ui(<EastChakraSliceFilter value={{ ...value, editOpen: some(true) }} />);
        await buildSessionsGte20();
        expect(slice.read().filters.length).toBe(1);           // deduped, no second chip
    });

    // #166 — integer fields offer set-membership `in`: the TagsInput entries
    // parse to a Set<bigint>, dropping malformed ones (never a crash).
    test("builder offers integer 'in'; tags parse to a bigint set with malformed entries dropped (#166)", async () => {
        const slice = fakeSlice();
        const value: any = { slice, unit: none, density: none, editOpen: some(true) };
        ui(<EastChakraSliceFilter value={value} />);

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
        expect(filters[0].value.op.value).toEqual(new Set([10n, 20n]));  // "abc" dropped
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
        expect(filters[0].value.op.value).toEqual(new Set([10n, 20n, 30n, 40n, 50n]));  // typed again
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
        ui(<EastChakraSliceFilter value={value} />);

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

    test("remove chip calls removeFilter", () => {
        const slice = fakeSlice({ filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 20n) })] });
        const value: any = { slice, unit: none, density: none, editOpen: none };
        ui(<EastChakraSliceFilter value={value} />);

        fireEvent.click(screen.getByLabelText("Remove filter"));
        expect(slice.read().filters.length).toBe(0);
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
        expect(screen.getByText(/1\.2k/)).toBeTruthy();          // live count on the chip

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

    test("Apply is disabled with a hint until the draft has a name and a clause (P1)", () => {
        const slice = fakeSlice();
        ui(<EastChakraSliceCohort value={cohortValue(slice, { editOpen: some(true) })} />);

        expect((screen.getByText("Apply") as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText("Give the cohort a name.")).toBeTruthy();

        fireEvent.change(screen.getByLabelText("Cohort name"), { target: { value: "Big EU" } });
        expect(screen.getByText("Add at least one clause.")).toBeTruthy();
        expect((screen.getByText("Apply") as HTMLButtonElement).disabled).toBe(true);
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
        expect(filters[0].value.op.value).toEqual(new Set(["EU"]));

        // Second selection ORs within the field — never an impossible AND.
        fireEvent.click(screen.getByLabelText("Filter to NA"));
        filters = slice.read().filters;
        expect(filters.length).toBe(1);
        expect(filters[0].value.op.value).toEqual(new Set(["EU", "NA"]));

        // Un-clicking removes a member; the options never disappeared (facet
        // items come from facetGroups, still all rendered).
        expect(screen.getByLabelText("Filter to APAC")).toBeTruthy();
        fireEvent.click(screen.getByLabelText("Filter to EU"));
        expect(slice.read().filters[0].value.op.value).toEqual(new Set(["NA"]));

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
        breakdown: none, search: none, visible: none, selectedIndex: none,
    };
    const currencyCfg = {
        fields: new Map<string, unknown>([
            ["qty", { type: "integer", value: { label: "Qty", accessor: (r: { qty: bigint }) => r.qty, format: some(variant("currency", { code: "USD", compact: true })) } }],
        ]),
        rangeFieldId: some("qty"), searchFieldIds: [], breakdownFieldIds: [],
    };
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

describe("Slice.Range — Custom pins the resolved window and exposes from/to inputs (#167)", () => {
    test("clicking Custom… pins the ACTIVE preset's resolved window — not a hardwired 30d", async () => {
        const slice = fakeSlice({ range: some(variant("datetimePreset", variant("last7d", null))) });
        const value: any = { slice, editOpen: some(true) };
        ui(<EastChakraSliceRange value={value} />);

        const user = userEvent.setup();
        await user.click(screen.getByText("Custom…"));

        const range = slice.read().range;
        expect(range.type).toBe("some");
        expect(range.value.type).toBe("datetime");
        const { from, to } = range.value.value as { from: Date; to: Date };
        const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
        expect(days).toBe(7);   // last7d's resolved window, not 30
    });

    test("an active custom range renders editable from/to date fields", () => {
        const slice = fakeSlice({
            range: some(variant("datetime", {
                from: new Date("2026-01-01T00:00:00Z"),
                to:   new Date("2026-03-31T00:00:00Z"),
            })),
        });
        const value: any = { slice, editOpen: some(true) };
        ui(<EastChakraSliceRange value={value} />);

        // Two react-aria date fields → month/day/year segments (spinbuttons).
        expect(screen.getAllByRole("spinbutton").length).toBeGreaterThanOrEqual(6);
    });

    test("a preset range renders NO date fields (the editor is custom-only)", () => {
        const slice = fakeSlice({ range: some(variant("datetimePreset", variant("last30d", null))) });
        const value: any = { slice, editOpen: some(true) };
        ui(<EastChakraSliceRange value={value} />);
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
});

// ═══════════════════════════════════════════════════════════════════════════
// #170 — the REAL path: render → compiled handle → UIStore (beast2) →
// useSliceReactivity → chip. Every suite above runs against the fake; a
// regression in the real primitives or the store subscription is invisible
// there. These mount EastChakraSliceFilter over a real Slice.bind handle.
// ═══════════════════════════════════════════════════════════════════════════

describe("Slice.Filter against the REAL store — round-trip + reactivity (#170)", () => {
    const realCfg = {
        fields: new Map<string, unknown>([
            ["scenario", { type: "string",  value: { label: "Scenario", accessor: (r: { scenario: string }) => r.scenario } }],
            ["sessions", { type: "integer", value: { label: "Sessions", accessor: (r: { sessions: bigint }) => r.sessions } }],
        ]),
        rangeFieldId: none, searchFieldIds: ["scenario"], breakdownFieldIds: [],
    };
    const realInitial = {
        range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none,
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
        ui(<EastChakraSliceFilter value={value} />);
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
        const bdCfg = {
            fields: new Map<string, unknown>([
                ["region",   { type: "string",  value: { label: "Region",   accessor: (r: { region: string }) => r.region } }],
                ["sessions", { type: "integer", value: { label: "Sessions", accessor: (r: { sessions: bigint }) => r.sessions } }],
            ]),
            rangeFieldId: none, searchFieldIds: [], breakdownFieldIds: ["region"],
        };
        const bdInitial = { ...realInitial, breakdown: some({ fieldId: "region", limit: none }) };
        const handle: any = buildSliceHandle("real.legend", bdCfg, bdInitial, [
            { region: "EU", sessions: 1n }, { region: "EU", sessions: 2n }, { region: "NA", sessions: 3n },
        ], none);
        const { rerender } = ui(<EastChakraSliceLegend value={{ slice: handle } as never} />);

        // Selecting EU narrows the row feed (what a sibling Table sees)…
        fireEvent.click(screen.getByLabelText("Filter to EU"));
        expect(handle.read().filters[0].value.op.value).toEqual(new Set(["EU"]));
        expect(handle.resultCount()).toBe(2n);
        // …but the facet options are SELF-EXCLUDING: NA is still offered.
        expect(handle.facetGroups().map((g: { key: string }) => g.key).sort()).toEqual(["EU", "NA"]);

        // Adding NA ORs within the field — both regions' rows return.
        rerender(<ChakraProvider value={system}><EastChakraSliceLegend value={{ slice: handle } as never} /></ChakraProvider>);
        fireEvent.click(screen.getByLabelText("Filter to NA"));
        expect(handle.read().filters[0].value.op.value).toEqual(new Set(["EU", "NA"]));
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
