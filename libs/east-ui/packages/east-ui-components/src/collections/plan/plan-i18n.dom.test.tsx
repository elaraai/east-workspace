/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The localizable canvas (#820): every word the Plan says itself comes from
 * ONE message table, every number and date it prints is in the locale
 * react-aria's `I18nProvider` sets, and `PlanMessagesProvider` overrides the
 * words for a subtree.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import { none, some, variant } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { registerReactiveTracker, type ReactiveTracker } from "../../reactive/tracker.js";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanWireRow } from "./model.js";
import { blocksSource, itemSel, oneBlock, rowId, rowSel } from "./plan.test-utils.js";
import { PlanMessagesProvider, planMessages, type PlanMessages } from "./messages.js";
import { PLAN_PAGE_SIZE } from "./use-plan-paging.js";
import type { PlanInstantValue } from "./instant.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const cleanups: (() => void)[] = [];
beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    while (cleanups.length > 0) cleanups.pop()!();
    localStorage.clear();
});

// ── Fixtures ──────────────────────────────────────────────────────────────
const W27 = new Date("2026-06-29T00:00:00Z");           // Monday, ISO week 27
const W39 = new Date("2026-09-21T00:00:00Z");
const NOW = new Date("2026-07-13T00:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const t = (d: Date): PlanInstantValue => variant("time", d) as PlanInstantValue;

/** One WIRE row, as the source serves it — named by its test key (#822). */
function planRow(key: string, kind: unknown, opts?: { parent?: string; label?: string; status?: string }): PlanWireRow {
    return {
        id: rowId(key),
        parent: opts?.parent !== undefined ? some(rowId(opts.parent)) : none,
        gutter: { label: opts?.label ?? key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind,
        collapsed: none, pinned: none, height: none,
        status: opts?.status !== undefined ? some(variant(opts.status, null)) : none,
        approval: none, expand: none,
    } as unknown as PlanWireRow;
}
const group = () => variant("group", { summary: none, summaryAggregate: none });
function run(key: string, start: PlanInstantValue, end: PlanInstantValue, opts?: { qty?: number; moved?: bigint }) {
    return {
        key, start, end, label: key.toUpperCase(), quantity: none,
        qty: opts?.qty !== undefined ? some(opts.qty) : none,
        state: variant("actual", null), status: none,
        moved: opts?.moved !== undefined ? some(opts.moved) : none, icon: none,
    };
}
const span = (runs: unknown[], rollup?: { mode: string; unit: string }) => variant("span", {
    runs, decisions: [], ports: [],
    rollup: rollup !== undefined ? some(variant(rollup.mode, null)) : none,
    unit: rollup !== undefined ? some(rollup.unit) : none,
});
const heat = (cells: [Date, number][], aggregate?: string) => variant("heat", {
    cells: variant("heat", {
        cells: cells.map(([d, v]) => ({ at: t(d), value: some(v), label: none })),
        min: some(0), max: some(100), warnAt: none,
    }),
    aggregate: aggregate !== undefined ? some(variant(aggregate, null)) : none,
});

function planRoot(rows: PlanWireRow[], opts: {
    source?: unknown; resolution?: string; window?: { min: Date; max: Date } | null; links?: unknown[]; review?: unknown;
} = {}): PlanRootValue {
    const window = opts.window === null ? none : some(opts.window ?? { min: W27, max: W39 });
    return {
        rows: opts.source !== undefined ? variant("paged", blocksSource(opts.source)) : variant("inline", oneBlock(rows)),
        links: opts.links ?? [],
        axis: variant("time", {
            window, resolution: variant(opts.resolution ?? "week", null),
            resolutions: [], now: some(NOW), format: none,
        }),
        grain: none, popover: none, hover: none, expandRender: none, expandGutter: none,
        review: opts.review !== undefined ? some(opts.review) : none, pick: none, slice: none, footer: [],
        id: "", sources: [], onDrag: none, canDrop: none, onSelect: none,
        onRunClick: none, onEventClick: none, onMarkClick: none, onChipClick: none, onCellClick: none,
        onGroupToggle: none, onGrainChange: none, style: none,
    } as unknown as PlanRootValue;
}

function renderPlan(value: PlanRootValue, key: string, wrap: (plan: ReactNode) => ReactNode = (p) => p) {
    const tree = (v: PlanRootValue) => (
        <ChakraProvider value={system}>
            {wrap(<EastChakraPlan value={v} storageKey={key} />)}
        </ChakraProvider>
    );
    const result = render(tree(value));
    return { ...result, rerenderWith: (next: (plan: ReactNode) => ReactNode) => {
        wrap = next;
        result.rerender(tree(value));
    } };
}

/** A paged source whose windows past `openUpTo` stay in flight until opened
 *  and their channel fired (the #815 tests' held source). */
function heldSource(windows: number, rowsPer: number, openUpTo = 0) {
    const subs = new Map<string, Set<() => void>>();
    let recording: string[] | null = null;
    const tracker: ReactiveTracker = {
        id: "plan-820-channels",
        enableTracking() { recording = []; },
        disableTracking() { const r = recording ?? []; recording = null; return r; },
        getStore: () => ({
            subscribe(key, cb) {
                const set = subs.get(key) ?? new Set<() => void>();
                set.add(cb);
                subs.set(key, set);
                return () => { set.delete(cb); };
            },
            getKeyVersion: () => 0,
        }),
    };
    const state = { openUpTo };
    const source = {
        id: "plan-820-held",
        page: (offset: bigint) => {
            const w = Number(offset) / PLAN_PAGE_SIZE;
            recording?.push(`w${w}`);
            if (w > state.openUpTo) return none;
            return some(Array.from({ length: rowsPer }, (_u, i) => planRow(`w${w}r${String(i).padStart(2, "0")}`, span([]))));
        },
        total: () => some(BigInt(windows * PLAN_PAGE_SIZE)),
        seek: none,
        revision: () => none,
        refresh: () => null,
    };
    cleanups.push(registerReactiveTracker(tracker));
    return { source, state };
}

/** Every text node under `root` that says something — a separator (` · `) or
 *  whitespace between words is structure, not a word. */
function words(root: Element): string[] {
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        const s = n.textContent ?? "";
        if (/[\p{L}\p{N}]/u.test(s)) out.push(s.trim());
    }
    return out;
}

/** The English table with every message marked `⟦` — a word the canvas says
 *  without the mark did not come from the table. */
const MARKED = Object.fromEntries(Object.entries(planMessages).map(([k, f]) =>
    [k, (p: never) => `⟦${(f as (p: never) => string)(p)}`])) as unknown as PlanMessages;
const marked = (plan: ReactNode) => <PlanMessagesProvider messages={MARKED}>{plan}</PlanMessagesProvider>;

const allMarked = (texts: readonly string[]) => {
    expect(texts.length).toBeGreaterThan(0);
    for (const s of texts) expect(s.startsWith("⟦"), `"${s}" is not the table's`).toBe(true);
};

// ── Every chrome word is the table's ──────────────────────────────────────
describe("one message table (#820)", () => {
    test("desktop: the toolbar, the ruler, a group's meta, a diagnostic row, a run's counter and a links focus all speak it", () => {
        const links = [{ fromRow: rowId("s"), fromRun: "r1", toRow: rowId("u"), toRun: "ru", quantity: 1, label: "1 t" }];
        const { container } = renderPlan(planRoot([
            planRow("G", group(), { label: "Line 1" }),
            planRow("s", span([run("r1", t(W27), t(day("2026-07-13")), { moved: 2n })]), { parent: "G" }),
            planRow("u", span([run("ru", t(day("2026-07-13")), t(day("2026-07-27")))]), { parent: "G" }),
            // Number instants on a time axis: a diagnostic row, and a toolbar chip.
            planRow("x", span([run("n1", variant("number", 1) as PlanInstantValue, variant("number", 2) as PlanInstantValue)]),
                { parent: "G" }),
        ], { links }), "plan-820-desktop", marked);
        // The toolbar: the grain segment and the diagnostics chip.
        const toolbar = container.querySelector("[data-slot='toolbar']")!;
        allMarked(words(toolbar));
        expect(words(toolbar)).toEqual(["⟦GROUP", "⟦RESOURCE", "⟦1 row skipped"]);
        expect(toolbar.querySelector("[data-plan-seg='grain']")!.getAttribute("aria-label")).toBe("⟦Grain");
        // The ruler: its caption, every tick, the now chip.
        const ruler = container.querySelector("[data-slot='ruler']")!;
        allMarked(words(ruler));
        expect(words(ruler)).toContain("⟦W27");
        expect(words(ruler)).toContain("⟦NOW");
        // A group band: the author's label, then the derived meta.
        expect(words(container.querySelector(`${rowSel("G", "data-plan-group")} [role='rowheader']`)!)).toEqual(["Line 1", "⟦3 rs"]);
        // A diagnostic row's reason.
        allMarked(words(container.querySelector("[data-plan-diagnostic]")!));
        // A run bar: the author's label, then the churn counter.
        expect(words(container.querySelector("[data-run='r1']")!)).toEqual(["R1", "⟦moved ×2"]);
        // The grid's name, and every accessible name the canvas composes.
        expect(container.querySelector("[role='treegrid']")!.getAttribute("aria-label")).toBe("⟦Plan");
        expect(container.querySelector("[data-run='r1']")!.getAttribute("aria-label")).toMatch(/^⟦/u);
        // A links focus: the control's name, the way back, the caption, and
        // the family tag each related row wears.
        const control = container.querySelector(`${itemSel("s")} [data-plan-control='links']`)!;
        expect(control.getAttribute("aria-label")).toBe("⟦Focus linked rows");
        fireEvent.click(control);
        allMarked(words(container.querySelector("[data-plan-focusbar]")!));
        const tags = [...container.querySelectorAll("[data-plan-focustag]")];
        expect(tags.length).toBeGreaterThan(0);
        allMarked(tags.flatMap(words));
    });

    test("paged: a failed window's reason and its Retry", async () => {
        const state = { failing: true };
        const source = {
            id: "plan-820-failing",
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                if (w === 1 && state.failing) throw new Error("fetch failed: 503");
                return some(Array.from({ length: 2 }, (_u, i) => planRow(`w${w}r${i}`, span([]))));
            },
            total: () => some(BigInt(3 * PLAN_PAGE_SIZE)),
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { container } = renderPlan(planRoot([], { source }), "plan-820-failed", marked);
            await waitFor(() => expect(container.querySelector("[data-plan-failed='1']")).toBeTruthy());
            const band = container.querySelector("[data-plan-failed='1']")!;
            expect(words(band)).toEqual(["⟦Elements 201–400 could not be read — fetch failed: 503", "⟦Retry"]);
        } finally {
            err.mockRestore();
        }
    });

    test("paged: the footer's transport line, the unloaded band, and what the live region says", async () => {
        const held = heldSource(5, 16);
        const { container } = renderPlan(planRoot([], { source: held.source }), "plan-820-paged", marked);
        await waitFor(() => expect(container.querySelector(itemSel("w0r15"))).toBeTruthy());
        allMarked(words(container.querySelector("[data-slot='footerTransport']")!));
        allMarked(words(container.querySelector("[data-plan-window-band]")!));
        // The controller speaks the table too — the landing it announced.
        allMarked(words(container.querySelector("[data-plan-announce]")!));
    });

    test("review: a row's Approve and Reject, and the batch foot's", () => {
        const verb = some(() => undefined);
        const review = {
            columnLabel: "Decision", summary: none,
            onApprove: verb, onReject: verb, onApproveAll: verb, onRejectAll: verb, onRerun: none,
            rerunLabel: "Rerun",
        };
        const { container } = renderPlan(planRoot([planRow("m", span([]))], { review }), "plan-820-review", marked);
        expect(words(container.querySelector("[data-slot='decisionCell']")!)).toEqual(["⟦Approve", "⟦Reject"]);
        expect(words(container.querySelector("[data-slot='reviewFoot']")!)).toEqual(["⟦Reject all", "⟦Approve all"]);
    });

    test("the empty state — a canvas with no window", () => {
        const { container } = renderPlan(planRoot([], { window: null }), "plan-820-empty", marked);
        expect(words(container.querySelector("[data-plan-empty]")!))
            .toEqual(["⟦NO WINDOW — declare an axis window, or bind a slice whose range supplies it"]);
    });

    describe("narrow (§10)", () => {
        const realRect = Element.prototype.getBoundingClientRect;
        beforeEach(() => {
            Element.prototype.getBoundingClientRect = function () {
                return { left: 0, top: 0, right: 360, bottom: 600, width: 360, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
            };
        });
        afterEach(() => { Element.prototype.getBoundingClientRect = realRect; });

        test("the tabs and their counts, the section heads, the way back and an empty list", () => {
            const { container } = renderPlan(planRoot([
                planRow("G", group(), { label: "Line 1" }),
                planRow("m", span([]), { parent: "G" }),
                planRow("dock", span([])),
            ]), "plan-820-narrow", marked);
            expect(container.querySelector("[data-plan-narrow]")).toBeTruthy();
            const tabs = container.querySelector("[data-slot='narrowTabs']")!;
            allMarked(words(tabs));
            expect(words(tabs)).toEqual(["⟦Groups", "⟦1", "⟦Rows", "⟦2"]);
            // A group's section head: its label, then its meta; the rows in
            // no group, under the table's own heading.
            expect(words(container.querySelector(rowSel("G", "data-plan-section"))!)).toEqual(["Line 1", "⟦1 rs"]);
            allMarked(words(container.querySelector("[data-plan-section='other']")!));
            // Scoped to the group: the way back is the table's.
            fireEvent.click(container.querySelector(rowSel("G", "data-plan-section"))!);
            allMarked(words(container.querySelector("[data-plan-back]")!));
            cleanup();
            // A plan with nothing to list says so in the table's words.
            const empty = renderPlan(planRoot([planRow("G", group(), { label: "Line 1" })]), "plan-820-narrow-empty", marked);
            expect(words(empty.container.querySelector("[data-slot='narrowList']")!)).toContain("⟦No rows");
        });
    });
});

// ── The locale ────────────────────────────────────────────────────────────
describe("the locale (#820)", () => {
    const rows = () => [
        // A rollup parent over two overlapping runs: `×2 · 2,234.5 t`.
        planRow("P", span([], { mode: "union", unit: "t" }), { label: "Parent" }),
        planRow("a", span([run("ra", t(W27), t(day("2026-07-03")), { qty: 1234.25 })]), { parent: "P" }),
        planRow("b", span([run("rb", t(day("2026-07-01")), t(day("2026-07-05")), { qty: 1000.25 })]), { parent: "P" }),
        // A mean over two heat rows: 72.5.
        planRow("H", heat([], "mean"), { label: "Mean" }),
        planRow("h1", heat([[W27, 80]]), { parent: "H" }),
        planRow("h2", heat([[W27, 65]]), { parent: "H" }),
    ];
    const week = { min: W27, max: day("2026-07-06") };
    const german = (plan: ReactNode) => <I18nProvider locale="de-DE">{plan}</I18nProvider>;
    const ticks = (c: HTMLElement) => [...c.querySelectorAll("[data-slot='rulerTick']")].map((x) => x.textContent);
    const heatLabel = (c: HTMLElement) => c.querySelector(`${rowSel("H")} [data-plan-bucket] > span`)!.textContent;

    test("under I18nProvider de-DE, derived numbers and ruler dates are German", () => {
        const { container, getByText } = renderPlan(planRoot(rows(), { resolution: "day", window: week }), "plan-820-de", german);
        expect(ticks(container)).toEqual(["MO", "DI", "MI", "DO", "FR", "SA", "SO"]);
        // The rollup's summed quantity and the aggregated cell.
        expect(getByText("×2 · 2.234,5 t")).toBeTruthy();
        expect(heatLabel(container)).toBe("72,5");
        // What a bar is called speaks the locale's dates.
        expect(container.querySelector("[data-run='ra']")!.getAttribute("aria-label"))
            .toBe("RA, 29. Juni 2026 – 3. Juli 2026, actual");
    });

    test("a locale change re-derives every word — the memoized rows included", () => {
        const { container, getByText, rerenderWith } = renderPlan(planRoot(rows(), { resolution: "day", window: week }), "plan-820-switch", german);
        expect(heatLabel(container)).toBe("72,5");
        rerenderWith((plan) => <I18nProvider locale="en-US">{plan}</I18nProvider>);
        expect(ticks(container)).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
        expect(getByText("×2 · 2,234.5 t")).toBeTruthy();
        expect(heatLabel(container)).toBe("72.5");
        expect(container.querySelector("[data-run='ra']")!.getAttribute("aria-label"))
            .toBe("RA, Jun 29, 2026 – Jul 3, 2026, actual");
    });

    describe("under a timezone west of UTC (#850)", () => {
        beforeEach(() => { vi.stubEnv("TZ", "America/Los_Angeles"); });
        afterEach(() => { vi.unstubAllEnvs(); });

        test("the ruler's days and a run's dates are the UTC ones", () => {
            // Read in local time, W27's UTC midnight is Sunday the 28th here.
            expect(new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(W27)).toBe("28");
            const { container } = renderPlan(planRoot(rows(), { resolution: "day", window: week }), "plan-850-tz", german);
            expect(ticks(container)).toEqual(["MO", "DI", "MI", "DO", "FR", "SA", "SO"]);
            expect(container.querySelector("[data-run='ra']")!.getAttribute("aria-label"))
                .toBe("RA, 29. Juni 2026 – 3. Juli 2026, actual");
        });
    });
});

// ── Overrides ─────────────────────────────────────────────────────────────
describe("PlanMessagesProvider (#820)", () => {
    const fixture = () => planRoot([
        planRow("G", group(), { label: "Line 1" }),
        planRow("s", span([]), { parent: "G", label: "Mill 3", status: "warning" }),
        planRow("m", span([]), { parent: "G" }),
    ]);
    const OUTER: Partial<PlanMessages> = {
        groupMeta: ({ count }) => `${count} Zeilen`,
        grainName: ({ grain }) => (grain === "group" ? "GRUPPE" : "RESSOURCE"),
    };
    const INNER: Partial<PlanMessages> = {
        announceSelected: ({ label }) => `Ausgewählt: ${label}`,
    };

    test("overrides take effect, nested providers compose, and the rest stays English", () => {
        const { container } = renderPlan(fixture(), "plan-820-override", (plan) => (
            <PlanMessagesProvider messages={OUTER}>
                <PlanMessagesProvider messages={INNER}>{plan}</PlanMessagesProvider>
            </PlanMessagesProvider>
        ));
        expect(words(container.querySelector(`${rowSel("G", "data-plan-group")} [role='rowheader']`)!)).toEqual(["Line 1", "2 Zeilen"]);
        expect(words(container.querySelector("[data-plan-seg='grain']")!)).toEqual(["GRUPPE", "RESSOURCE"]);
        expect(words(container.querySelector("[data-slot='ruler']")!)[0]).toBe("RESSOURCE");
        // The inner table reaches the controller: the live region speaks it.
        fireEvent.click(container.querySelector(itemSel("s"))!);
        expect(container.querySelector("[data-plan-announce]")!.textContent).toBe("Ausgewählt: Mill 3");
        // Whatever neither overrides is the default table's.
        expect(container.querySelector(`${itemSel("s")} [role='rowheader'] [role='img']`)!.getAttribute("aria-label"))
            .toBe("Status: warning");
        expect(container.querySelector("[role='treegrid']")!.getAttribute("aria-label")).toBe("Plan");
    });

    test("a new table takes effect without a remount", () => {
        const { container, rerenderWith } = renderPlan(fixture(), "plan-820-swap",
            (plan) => <PlanMessagesProvider messages={OUTER}>{plan}</PlanMessagesProvider>);
        expect(words(container.querySelector(`${rowSel("G", "data-plan-group")} [role='rowheader']`)!)).toEqual(["Line 1", "2 Zeilen"]);
        fireEvent.click(container.querySelector(itemSel("m"))!);
        expect(container.querySelector("[data-plan-announce]")!.textContent).toBe("Selected m");
        const french: Partial<PlanMessages> = {
            groupMeta: ({ count }) => `${count} lignes`,
            announceSelected: ({ label }) => `Sélectionné : ${label}`,
        };
        rerenderWith((plan) => <PlanMessagesProvider messages={french}>{plan}</PlanMessagesProvider>);
        expect(words(container.querySelector(`${rowSel("G", "data-plan-group")} [role='rowheader']`)!)).toEqual(["Line 1", "2 lignes"]);
        // The controller hears the new table too.
        fireEvent.click(container.querySelector(itemSel("s"))!);
        expect(container.querySelector("[data-plan-announce]")!.textContent).toBe("Sélectionné : Mill 3");
    });
});
