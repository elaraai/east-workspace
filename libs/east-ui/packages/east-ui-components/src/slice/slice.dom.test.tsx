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
import { variant, some, none, equalFor } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { EastChakraSliceCohort } from "./cohort/index.js";
import { EastChakraSliceFilter } from "./filter/index.js";
import { EastChakraSliceLegend } from "./legend/index.js";
import { EastChakraSliceRange } from "./range/index.js";
import { EastChakraSliceSearch } from "./search/index.js";

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
        clearFilters: () => set({ filters: [], activeCohorts: new Set<string>() }),
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
        ui(<EastChakraSliceFilter value={value} />);
        const user = userEvent.setup();

        // Fresh builder: string `contains` with an empty value — disabled + hint.
        expect((screen.getByText("Add") as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText("Enter a value.")).toBeTruthy();

        const buildSessionsGte20 = async () => {
            await pickOption(user, "Field", "Sessions");
            await pickOption(user, "Operator", "≥");
            await user.click(screen.getByRole("spinbutton"));
            await user.paste("20");
            fireEvent.click(screen.getByText("Add"));
        };
        await buildSessionsGte20();
        expect(slice.read().filters.length).toBe(1);
        expect(screen.queryByLabelText("Field")).toBeNull();   // popover closed after Add

        // Reopen the (freshly reset) builder and submit the identical clause.
        // (findBy waits out Zag's rAF-deferred popover mount under jsdom.)
        await user.click(screen.getByText("add filter"));
        expect(await screen.findByLabelText("Field")).toBeTruthy();
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

describe("Slice.Legend — the filter-to gesture toggles a real narrowing (#165)", () => {
    const legendGroups = () => [
        { key: "EU", count: 3n, color: "{colors.brand.600}" },
        { key: "NA", count: 2n, color: "{colors.brand.800}" },
    ];

    test("clicking the filter icon toggles an equality predicate on the breakdown field — on and off", () => {
        const slice = fakeSlice(
            { breakdown: some({ fieldId: "region", limit: none }) },
            { groups: legendGroups },
        );
        const value: any = { slice };
        ui(<EastChakraSliceLegend value={value} />);

        fireEvent.click(screen.getByLabelText("Filter to EU"));
        let filters = slice.read().filters;
        expect(filters.length).toBe(1);
        expect(filters[0].type).toBe("string");
        expect(filters[0].value.fieldId).toBe("region");
        expect(filters[0].value.op.type).toBe("eq");
        expect(filters[0].value.op.value).toBe("EU");

        // The same gesture removes the structurally-equal clause (idempotent).
        fireEvent.click(screen.getByLabelText("Filter to EU"));
        expect(slice.read().filters.length).toBe(0);
    });

    test("the visibility toggle stays distinct — it writes the whitelist, never a filter", () => {
        const slice = fakeSlice(
            { breakdown: some({ fieldId: "region", limit: none }) },
            { groups: legendGroups },
        );
        const value: any = { slice };
        ui(<EastChakraSliceLegend value={value} />);

        // The main legend item button (label EU) toggles series visibility.
        fireEvent.click(screen.getByText("EU"));
        expect(slice.read().filters.length).toBe(0);            // no narrowing
        expect(slice.read().visible.type).toBe("some");         // whitelist written
        expect([...slice.read().visible.value]).toEqual(["NA"]); // EU hidden
    });

    test("the roll-up 'other' bucket gets no filter gesture when a limit is active", () => {
        const slice = fakeSlice(
            { breakdown: some({ fieldId: "region", limit: some(1n) }) },
            { groups: () => [
                { key: "EU", count: 3n, color: "{colors.brand.600}" },
                { key: "other", count: 2n, color: "{colors.gray.400}" },
            ] },
        );
        const value: any = { slice };
        ui(<EastChakraSliceLegend value={value} />);

        expect(screen.queryByLabelText("Filter to EU")).not.toBeNull();
        expect(screen.queryByLabelText("Filter to other")).toBeNull();  // synthetic bucket
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
