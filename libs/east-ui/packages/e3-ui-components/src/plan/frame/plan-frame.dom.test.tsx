/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Plan>`'s frame (#1193, `Plan Builder Spec.md` §7, PB19–PB25): the one
 * Plan is a `BuilderFrame` — its toolbar the frame's one row, the session's
 * banners under it, the canvas in main, the footer's counts — with no pane it
 * is not given. Plans of event kinds are built by the e3-ui factory over the
 * print works' records, held in memory under the record runtime a surface
 * installs; Plans that edit are the editing canvas the #880 tests mount.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { UIStore, formatters, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { EastChakraPlan, usePlanCanvas, type PlanRootValue } from "../index.js";
import { PlanFooter } from "../shell/Footer.js";
import { scheduleOverlaps } from "../../shared/schedule/overlaps.js";
import { oneBlock, rowId } from "../plan.test-utils.js";
import {
    SEED, banner, dropJob, history, historyButton, jobsDrawn, mountCanvas, releaseCanvases, statusLine,
} from "../plan-editing.test-utils.js";
import { act, mount, planHarness, settle, slot } from "./harness.test-utils.js";

const h = planHarness();
// The canvases the #880 tests mount go after the DOM they drew.
afterEach(() => {
    cleanup();
    releaseCanvases();
});

const WORDS = formatters("en-US");

/** A footer count's words, if the footer says it. */
const count = (c: HTMLElement, key: string) => slot(c, "footer")?.querySelector(`[data-plan-count="${key}"]`)?.textContent ?? null;

// ── The print works' jobs, as a test commits them ───────────────────────────

type Jobs = ValueTypeOf<typeof ex.planPrintJobs.type>;
type Job = ValueTypeOf<typeof ex.PrintJob>;
const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");
const at = (text: string) => new Date(text);

/** A job on a press, or in the backlog with no press and no times. */
function job(title: string, opts: { start?: string; end?: string; press?: string } = {}): Job {
    return {
        title,
        start: opts.start !== undefined ? some(at(opts.start)) : none,
        end: opts.end !== undefined ? some(at(opts.end)) : none,
        press: opts.press !== undefined ? some(opts.press) : none,
        state: variant("confirmed", null),
        sheets: 16000.0,
        customer: "",
        stock: variant("coated", null),
        due: none,
    } as Job;
}

/** Two jobs in the window, one after it, one in the backlog. */
const COUNTED = new Map<string, Job>([
    ["J-1", job("Leaflets", { start: "2026-10-06T08:00:00Z", end: "2026-10-06T16:00:00Z", press: "a1" })],
    ["J-2", job("Catalogue", { start: "2026-10-07T08:00:00Z", end: "2026-10-08T16:00:00Z", press: "a2" })],
    ["J-3", job("Posters", { start: "2026-12-01T08:00:00Z", end: "2026-12-01T16:00:00Z", press: "a3" })],
    ["J-4", job("Labels")],
]) as unknown as Jobs;

/** A Plan of the presses and their jobs, with a backlog — given no `library` and no `inspector`, so no pane. */
const bareJobs = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
    return Plan({
        axis,
        resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
            }),
        },
    });
}))), getRegisteredPlatformImplementations());

// ── A hand-built canvas ──────────────────────────────────────────────────────

/** A canvas of `n` span rows, declaring the bound given. */
function canvasOf(n: number, style?: { height?: string; maxHeight?: string }): PlanRootValue {
    const rows = Array.from({ length: n }, (_u, i) => ({
        id: rowId(`r${i}`), parent: none,
        gutter: { label: `Row ${i}`, id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind: variant("span", { runs: [], decisions: [], ports: [], rollup: none }),
        collapsed: false, pinned: false, height: none, status: none, expand: none,
    }));
    return {
        rows: variant("inline", oneBlock(rows as never)),
        links: [],
        axis: variant("time", { window: some({ min: FIRST, max: LAST }), resolution: variant("week", null), resolutions: [], now: none, format: none }),
        grain: none, popover: none, hover: none, expandRender: none, expandGutter: none, pick: none, slice: none, footer: [],
        id: none, sources: [], editing: none, canDrop: none, onSelect: none, onElementClick: none, onGroupToggle: none, onGrainChange: none, ui: none,
        style: style !== undefined
            ? some({
                height: style.height !== undefined ? some(style.height) : none,
                maxHeight: style.maxHeight !== undefined ? some(style.maxHeight) : none,
                density: none, gutterWidth: none,
            })
            : none,
    } as unknown as PlanRootValue;
}

function renderCanvas(value: PlanRootValue, key: string) {
    initializeStore(new UIStore());
    return render(
        <ChakraProvider value={system}>
            <EastChakraPlan value={value} storageKey={key} />
        </ChakraProvider>,
    );
}

// ============================================================================

describe("the Plan is its BuilderFrame (PB19, PB22)", () => {
    test("main holds the canvas; the footer is the frame's; a Plan of event kinds' toolbar holds the history item alone, and there is none of the panes it is not given", async () => {
        // The jobs with Press B2's overlap on the 20th moved apart: no overlaps chip either (#1198).
        const jobs = new Map(ex.planPrintJobs.default as ReadonlyMap<string, Job>);
        jobs.set("J-1019", { ...jobs.get("J-1019")!, start: some(at("2026-10-20T13:00:00Z")), end: some(at("2026-10-20T16:00:00Z")) });
        await h.commit(ex.planPrintJobs, jobs);
        const { container } = mount(bareJobs);
        await settle();
        const frame = container.querySelector("[data-builder-frame]");
        expect(frame).not.toBeNull();
        // Main is the canvas, whole: its header, its grid, its rows.
        const main = slot(container, "main")!;
        expect(main.querySelector(":scope > [data-plan-body] [role='treegrid']")).not.toBeNull();
        expect(main.querySelector("[data-plan-header] [data-slot='ruler']")).not.toBeNull();
        // The canvas draws no toolbar or footer of its own.
        expect(main.querySelector("[data-toolbar], [data-slot='footer']")).toBeNull();
        // No slice, no search, no group to fold, no overlaps: the event kinds' history is all the toolbar holds (#1194).
        expect([...slot(container, "toolbar")!.querySelectorAll("[data-toolbar-item]")].map((item) => item.getAttribute("data-toolbar-item"))).toEqual(["history"]);
        // No `library`, no `inspector`: no pane (#1195, #1197).
        expect(slot(container, "start")).toBeNull();
        expect(slot(container, "end")).toBeNull();
        // Nothing to say: no banner.
        expect(slot(container, "banners")?.querySelector("[data-session-banner]") ?? null).toBeNull();
        expect(slot(container, "footer")!.querySelector("[data-slot='footer']")).not.toBeNull();
    });

    test("a Plan with nothing to control — read-only rows, no slice, no group to fold, nothing that edits — has no toolbar and no banners", () => {
        const { container } = renderCanvas(canvasOf(3), "plan-frame-bare");
        expect(slot(container, "toolbar")).toBeNull();
        expect(slot(container, "banners")).toBeNull();
    });

    test("a declared height is the whole Plan's: the frame takes it, and the canvas fills main and scrolls its own rows", () => {
        const bounded = renderCanvas(canvasOf(60, { height: "400px" }), "plan-frame-bound");
        const wrapper = bounded.container.querySelector<HTMLElement>("[data-plan-frame]")!;
        expect(wrapper.hasAttribute("data-plan-bound")).toBe(true);
        expect(wrapper.style.height).toBe("400px");
        expect(wrapper.querySelector(":scope > [data-builder-frame]")).not.toBeNull();
        expect(slot(bounded.container, "main")!.querySelector("[data-plan-body]")!.hasAttribute("data-plan-bounded")).toBe(true);
        expect(bounded.container.querySelector("[data-virtual-rows='bounded']")).not.toBeNull();
        cleanup();
        // None declared: the Plan adds no box of its own, and its canvas grows with its rows.
        const grown = renderCanvas(canvasOf(60), "plan-frame-grown");
        const bare = grown.container.querySelector<HTMLElement>("[data-plan-frame]")!;
        expect(bare.hasAttribute("data-plan-bound")).toBe(false);
        expect(bare.style.height).toBe("");
        expect(grown.container.querySelector("[data-plan-body]")!.hasAttribute("data-plan-bounded")).toBe(false);
        expect(grown.container.querySelectorAll("[data-plan-row]")).toHaveLength(60);
    });

    test("a host that gives the frame a height bounds the canvas: once it is taller than main, it fills main and scrolls its own rows", () => {
        // jsdom lays nothing out: the canvas as tall as its sixty rows, main as tall as the host lets it be.
        const realOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
        const realClient = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!;
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
            configurable: true, get(this: HTMLElement) { return this.hasAttribute("data-plan-body") ? 60 * 32 : 0; },
        });
        Object.defineProperty(Element.prototype, "clientHeight", {
            configurable: true, get(this: Element) { return this.getAttribute("data-frame-slot") === "main" ? 400 : 0; },
        });
        try {
            const { container } = renderCanvas(canvasOf(60), "plan-frame-host");
            const body = container.querySelector("[data-plan-body]")!;
            expect(body.hasAttribute("data-plan-bounded")).toBe(true);
            expect(container.querySelector("[data-virtual-rows='bounded']")).not.toBeNull();
            // The bound is the host's: the Plan declares none, and adds no box.
            expect(container.querySelector("[data-plan-frame]")!.hasAttribute("data-plan-bound")).toBe(false);
        } finally {
            Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffset);
            Object.defineProperty(Element.prototype, "clientHeight", realClient);
        }
    });
});

describe("the footer (PB23)", () => {
    test("it counts the event kinds' events in the window and their backlog, and says when a record was last saved; a commit moves the counts", async () => {
        await h.commit(ex.planPrintJobs, COUNTED);
        const { container } = mount(bareJobs);
        await settle();
        expect(count(container, "events")).toBe("2 events");
        expect(count(container, "backlog")).toBe("1 in backlog");
        // A Plan approves and rejects nothing (#1260): there is nothing to review.
        expect(count(container, "review")).toBeNull();
        // The records in memory commit at the epoch.
        expect(count(container, "saved")).toBe(`saved ${WORDS.dateTime(new Date(0))}`);
        // The event kinds edit (#1194): nothing pending yet.
        expect(count(container, "pending")).toBe("0 pending");
        // The posters come into the window; the labels are scheduled.
        const next = new Map(COUNTED as unknown as Map<string, Job>);
        next.set("J-3", job("Posters", { start: "2026-10-12T08:00:00Z", end: "2026-10-12T16:00:00Z", press: "a3" }));
        next.set("J-4", job("Labels", { start: "2026-10-13T08:00:00Z", end: "2026-10-13T12:00:00Z", press: "a1" }));
        await h.commit(ex.planPrintJobs, next);
        expect(count(container, "events")).toBe("4 events");
        expect(count(container, "backlog")).toBe("0 in backlog");
    });

    test("the last save reads as its time when it was made today, and as its date and time before", () => {
        // A clock that stands still, so "today" is one day whenever the test runs.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
        try {
            const footer = (saved: Date) => render(
                <ChakraProvider value={system}>
                    <PlanFooter styles={{}} items={[]} counts={{ events: 0, minutes: 0, backlog: undefined, saved, overlaps: scheduleOverlaps([]) }} />
                </ChakraProvider>,
            ).container;
            const earlier = new Date("2026-10-06T09:15:00Z");
            expect(footer(earlier).querySelector('[data-plan-count="saved"]')!.textContent).toBe(`saved ${WORDS.time(earlier)}`);
            cleanup();
            const before = new Date("2026-10-04T09:15:00Z");
            expect(footer(before).querySelector('[data-plan-count="saved"]')!.textContent).toBe(`saved ${WORDS.dateTime(before)}`);
        } finally {
            vi.useRealTimers();
        }
    });

    test("a Plan that edits counts its changes waiting on Save; one of no event kinds counts no events", async () => {
        const canvas = await mountCanvas({ arm: "inline" });
        const c = canvas.container;
        expect(count(c, "pending")).toBe("0 pending");
        expect(count(c, "events")).toBeNull();
        await dropJob(canvas, "job-1", "p1");
        await dropJob(canvas, "job-2", "p2");
        expect(count(c, "pending")).toBe("2 pending");
        await history(canvas, "Undo");
        expect(count(c, "pending")).toBe("1 pending");
    });
});

describe("the banners and the keys (PB20, PB24)", () => {
    test("a Save that meets another writer's commit is a conflict banner, the toolbar's line kept to one row — and it leaves with the drafts", async () => {
        const canvas = await mountCanvas({ arm: "paged" });
        const c = canvas.container;
        await dropJob(canvas, "job-1", "p1");
        expect(banner(c, "conflict")).toBeNull();
        // Another writer puts a job on Press 1, and the canvas does not see it before Save.
        canvas.race(new Map([...SEED, ["p1", { ...SEED.get("p1")!, jobs: [{ key: "job-9", at: variant("time", new Date("2026-07-06T00:00:00Z")) }] }]]));
        await history(canvas, "Save");
        expect(banner(c, "conflict")!.textContent).toContain("Save stopped — 1 conflict with the source");
        expect(slot(c, "toolbar")!.querySelector('[role="alert"]')).toBeNull();
        expect(statusLine(canvas)).not.toBeNull();
        await history(canvas, "Discard");
        expect(banner(c, "conflict")).toBeNull();
    });

    test("a banner names an issue where the reader sees it: its entry's first row, by its label", () => {
        const { result } = renderHook(() => usePlanCanvas({ value: canvasOf(3), storageKey: "plan-frame-where" }), {
            wrapper: ({ children }: { children: ReactNode }) => <ChakraProvider value={system}>{children}</ChakraProvider>,
        });
        const where = result.current.chrome!.where;
        const issue = (entry: string) => ({ entry, row: none, field: none, message: "Changed since this edit began" });
        expect(where(issue("r1"))).toBe("Row 1");
        // An entry the canvas draws no row of keeps its key; the source as a whole, its empty place.
        expect(where(issue("zz"))).toBe("zz");
        expect(where(issue(""))).toBe("");
    });

    test("a field typed into keeps its own undo: ⌘Z in it leaves the drafts as they are", async () => {
        const canvas = await mountCanvas({ arm: "inline" });
        const c = canvas.container;
        await dropJob(canvas, "job-1", "p1");
        // A field in the frame, as the key search's box or a pane's form is.
        const field = document.createElement("input");
        slot(c, "toolbar")!.appendChild(field);
        try {
            await act(async () => { fireEvent.keyDown(field, { key: "z", metaKey: true }); });
            await settle();
            expect(jobsDrawn(c, "p1")).toEqual(["job-1"]);
        } finally {
            field.remove();
        }
    });

    test("⌘Z and ⇧⌘Z from anywhere in the frame — a toolbar control's included — do what the history item does", async () => {
        const canvas = await mountCanvas({ arm: "inline" });
        const c = canvas.container;
        await dropJob(canvas, "job-1", "p1");
        expect(jobsDrawn(c, "p1")).toEqual(["job-1"]);
        // The keys on the history item's buttons, in the frame's toolbar, outside the canvas: Discard, then Redo.
        await act(async () => { fireEvent.keyDown(historyButton(canvas, "Discard"), { key: "z", metaKey: true }); });
        await settle();
        expect(jobsDrawn(c, "p1")).toEqual([]);
        await act(async () => { fireEvent.keyDown(historyButton(canvas, "Redo"), { key: "z", metaKey: true, shiftKey: true }); });
        await settle();
        expect(jobsDrawn(c, "p1")).toEqual(["job-1"]);
    });
});
