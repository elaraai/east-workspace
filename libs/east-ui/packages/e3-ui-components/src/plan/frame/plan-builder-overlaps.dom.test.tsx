/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Plan>`'s overlaps (#1198, `Plan Builder Spec.md` §8, §9.10, PB51–PB53):
 * two events of a kind that warns of them, on one resource at once, are a
 * pair, and both wear the warn ring; the toolbar's chip counts the pairs, and
 * a click selects the first, earliest first, and brings it into view — on a
 * phone too; the inspector's banner lists what the selected event overlaps,
 * and a row's view its pairs, a click on one selecting it. Overlaps never
 * block Save: they raise no issue and no banner of the sessions', and a draft
 * beside them saves (#1194). The print works' jobs overlap once, on Press B2
 * on the 20th; a test commits others.
 */

import { describe, test, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East, some, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { rowKeyOf, type PlanRowId } from "../model.js";
import { el, elementKey, entry, mount, planHarness, programOf, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness();

type Job = ValueTypeOf<typeof ex.PrintJob>;
type Jobs = ValueTypeOf<typeof ex.planPrintJobs.type>;
type Press = ValueTypeOf<typeof ex.PrintPress>;
type Presses = ValueTypeOf<typeof ex.planPrintPresses.type>;
const at = (text: string) => new Date(text);

/** The print works' jobs, with each one named changed as given — or added, after the first job. */
function jobsWith(changes: { readonly [key: string]: Partial<Job> }): Jobs {
    const jobs = new Map(ex.planPrintJobs.default as ReadonlyMap<string, Job>);
    const first = jobs.get("J-1001")!;
    for (const [key, change] of Object.entries(changes)) jobs.set(key, { ...(jobs.get(key) ?? first), ...change });
    return jobs as unknown as Jobs;
}

/** Press B2's and Press A1's bars, under their halls. */
const B2 = entry("presses.span", "Hall B", "b2");
const A1 = entry("presses.span", "Hall A", "a1");
const A2 = entry("presses.span", "Hall A", "a2");

/** A job's bar on a press's row. */
const bar = (c: HTMLElement, row: PlanRowId, key: string) => c.querySelector<HTMLElement>(`${rowAt(row)} ${el("data-run", "job", key)}`);
/** An element's key: its event, as East prints a `Schedule.Types.EventRef`. */
const keyOf = (node: Element) => node.getAttribute("data-run") ?? node.getAttribute("data-chip") ?? node.getAttribute("data-event") ?? node.getAttribute("data-mark");
/** The elements wearing the warn ring, by their keys. */
const ringed = (c: HTMLElement) => new Set([...slot(c, "main")!.querySelectorAll("[data-overlap]")].map(keyOf));
/** The events drawn selected, by their keys. */
const pressed = (c: HTMLElement) => new Set([...slot(c, "main")!.querySelectorAll("[aria-pressed='true']")].map(keyOf));
/** The toolbar's overlaps chip, if it draws one. */
const chip = (c: HTMLElement) => slot(c, "toolbar")?.querySelector<HTMLElement>("[data-plan-overlaps]") ?? null;
/** The selected row, by its id's text. */
const selectedRow = (c: HTMLElement) => slot(c, "main")!.querySelector("[data-plan-row][aria-selected='true']")?.getAttribute("data-plan-row") ?? null;
/** What the canvas's live region said last. */
const announced = (c: HTMLElement) => c.querySelector("[data-plan-announce]")!.textContent;
/** The inspector pane. */
const pane = (c: HTMLElement) => slot(c, "end")!;
/** The inspector's overlaps banner, if it shows one. */
const banner = (c: HTMLElement) => pane(c).querySelector<HTMLElement>("[data-inspector-overlaps]");
/** The banner's lines: what each selects, and its words. */
const lines = (c: HTMLElement) => [...banner(c)!.querySelectorAll<HTMLElement>("[data-inspector-overlap]")]
    .map((line) => ({ selects: line.getAttribute("data-inspector-overlap"), text: line.textContent }));

const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");

/** The presses and their jobs, the jobs' overlaps warned of. */
const warnedByPress = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
    return Plan({
        axis,
        resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, overlaps: "warn",
            }),
        },
    });
}))), getRegisteredPlatformImplementations());

/** The same, the jobs' overlaps allowed: they run in parallel. */
const allowedByPress = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
    return Plan({
        axis,
        resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, overlaps: "allow",
            }),
        },
    });
}))), getRegisteredPlatformImplementations());

/** The jobs drawn three more ways — as chips, as tiles and as marks — each way a kind of its own that warns of its overlaps. */
const drawnThreeWays = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
    return Plan({
        axis,
        resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
        events: {
            chips: Schedule.events(jobs, {
                name: "Job chip", icon: "file-lines", draw: "cards", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
            }),
            tiles: Schedule.events(jobs, {
                name: "Job tile", icon: "file-lines", draw: "buckets", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
            }),
            marks: Schedule.events(jobs, {
                name: "Job mark", icon: "file-lines", draw: "marks", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
            }),
        },
    });
}))), getRegisteredPlatformImplementations());

describe("an overlap pair (#1198, PB51)", () => {
    test("each way an event draws wears the ring: a chip, a tile and a mark of a pair; the rest none", async () => {
        const { container } = mount(drawnThreeWays);
        await settle();
        const ring = (selector: string) => container.querySelector(selector)!.hasAttribute("data-overlap");
        for (const [attr, kind] of [["data-chip", "chips"], ["data-event", "tiles"], ["data-mark", "marks"]] as const) {
            expect(ring(`${el(attr, kind, "J-1018")}[role="button"]`), `${kind}: the posters`).toBe(true);
            expect(ring(`${el(attr, kind, "J-1019")}[role="button"]`), `${kind}: the loyalty cards`).toBe(true);
            expect(ring(`${el(attr, kind, "J-1017")}[role="button"]`), `${kind}: the timetables, in no pair`).toBe(false);
        }
        // Three kinds, a pair each.
        expect(chip(container)!.textContent).toBe("3 overlaps");
    });

    test("two jobs on one press at once are a pair: both wear the warn ring, and the toolbar's chip counts it", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        expect(ringed(container)).toEqual(new Set([elementKey("job", "J-1018"), elementKey("job", "J-1019")]));
        expect(bar(container, B2, "J-1018")!.hasAttribute("data-overlap")).toBe(true);
        expect(bar(container, B2, "J-1019")!.hasAttribute("data-overlap")).toBe(true);
        expect(chip(container)!.textContent).toBe("1 overlap");
        expect(chip(container)!.getAttribute("aria-label")).toBe("1 overlap — select the first pair");
    });

    test("not a pair: two jobs of a kind that allows overlaps, two jobs on two presses, and two that only meet", async () => {
        // The same jobs, warned of, and allowed.
        const warned = mount(warnedByPress);
        await settle();
        expect(ringed(warned.container)).toEqual(new Set([elementKey("job", "J-1018"), elementKey("job", "J-1019")]));
        warned.unmount();
        const allowed = mount(allowedByPress);
        await settle();
        expect(bar(allowed.container, entry("presses.span", "b2"), "J-1019")).not.toBeNull();
        expect(ringed(allowed.container)).toEqual(new Set());
        expect(chip(allowed.container)).toBeNull();
        allowed.unmount();
        // The loyalty cards on Press B1, which prints nothing on the 20th.
        await h.commit(ex.planPrintJobs, jobsWith({ "J-1019": { press: some("b1") } }));
        const apart = mount(programOf(ex.planPrintWorks));
        await settle();
        expect(ringed(apart.container)).toEqual(new Set());
        expect(chip(apart.container)).toBeNull();
        apart.unmount();
        // The loyalty cards starting as the posters end: they only meet.
        await h.commit(ex.planPrintJobs, jobsWith({ "J-1019": { start: some(at("2026-10-20T12:00:00Z")) } }));
        const meeting = mount(programOf(ex.planPrintWorks));
        await settle();
        expect(ringed(meeting.container)).toEqual(new Set());
        expect(chip(meeting.container)).toBeNull();
    });
});

describe("the overlaps chip (#1198, PB52)", () => {
    test("a click selects the first pair, earliest first, and brings it into view — out of a folded grain", async () => {
        // Another job on Press A1 on the 5th, during the catalogue: the earlier pair.
        await h.commit(ex.planPrintJobs, jobsWith({
            "J-1031": { title: "Proof run", start: some(at("2026-10-05T10:00:00Z")), end: some(at("2026-10-05T12:00:00Z")), press: some("a1") },
        }));
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        expect(chip(container)!.textContent).toBe("2 overlaps");
        // GROUP folds each hall to its strip: Press A1's row leaves the canvas.
        const group = [...slot(container, "toolbar")!.querySelectorAll<HTMLElement>("[data-plan-seg='grain'] [role='radio']")]
            .find((radio) => radio.textContent === "GROUP")!;
        fireEvent.click(group);
        await settle();
        expect(container.querySelector(rowAt(A1))).toBeNull();
        fireEvent.click(chip(container)!);
        await settle();
        expect(pressed(container)).toEqual(new Set([elementKey("job", "J-1001"), elementKey("job", "J-1031")]));
        expect(bar(container, A1, "J-1031")!.getAttribute("aria-pressed")).toBe("true");
        expect(selectedRow(container)).toBe(rowKeyOf(A1));
        expect(announced(container)).toBe("2 events selected");
        // The grain gave way to show the row; the inspector shows the two.
        const resource = [...slot(container, "toolbar")!.querySelectorAll<HTMLElement>("[data-plan-seg='grain'] [role='radio']")]
            .find((radio) => radio.textContent === "RESOURCE")!;
        expect(resource.getAttribute("aria-checked")).toBe("true");
        expect(pane(container).querySelector("[data-inspector-several]")!.textContent).toBe("2 events");
    });

    test("on a phone, a click opens the pair's hall in the Rows tab and scrolls its press's card into view", async () => {
        const { scrolled, restore } = onAPhone();
        try {
            const { container } = mount(programOf(ex.planPrintWorks));
            await settle();
            expect(container.querySelector("[data-plan-narrow]")).not.toBeNull();
            fireEvent.click(chip(container)!);
            await settle();
            const card = container.querySelector(`[data-plan-card=${JSON.stringify(rowKeyOf(B2))}]`);
            expect(card).not.toBeNull();
            expect(container.querySelector("[data-plan-tab='rows']")!.getAttribute("aria-selected")).toBe("true");
            expect(container.querySelector("[data-slot='narrowScope']")!.textContent).toContain("Hall B");
            expect(scrolled).toEqual([card]);
            expect(card!.hasAttribute("data-selected")).toBe(true);
        } finally {
            restore();
        }
    });

    test("on a phone, a pair on a press past the Rows tab's first page shows: the page it is on comes, and its card scrolls into view", async () => {
        // Nine more presses, and the pair on the last of them: Press B9, the
        // fifteenth of the presses by key, past the tab's first eight rows.
        const presses = new Map(ex.planPrintPresses.default as ReadonlyMap<string, Press>);
        for (let n = 4; n <= 12; n++) presses.set(`b${n}`, { name: `Press B${n}`, hall: "Hall B", sheets_per_hour: 6000.0 });
        await h.commit(ex.planPrintPresses, presses as unknown as Presses);
        await h.commit(ex.planPrintJobs, jobsWith({ "J-1018": { press: some("b9") }, "J-1019": { press: some("b9") } }));
        const { scrolled, restore } = onAPhone();
        try {
            const { container } = mount(warnedByPress);
            await settle();
            const B9 = `[data-plan-card=${JSON.stringify(rowKeyOf(entry("presses.span", "b9")))}]`;
            expect(container.querySelector(B9)).toBeNull();
            fireEvent.click(chip(container)!);
            await settle();
            const card = container.querySelector(B9);
            expect(card).not.toBeNull();
            expect(scrolled).toEqual([card]);
            expect(card!.hasAttribute("data-selected")).toBe(true);
        } finally {
            restore();
        }
    });
});

/** A phone: every box 360px wide, and each `scrollIntoView` heard — undone by `restore`. */
function onAPhone(): { scrolled: Element[]; restore: () => void } {
    const realRect = Element.prototype.getBoundingClientRect;
    const realScroll = Element.prototype.scrollIntoView;
    const scrolled: Element[] = [];
    Element.prototype.getBoundingClientRect = function () {
        return { x: 0, y: 0, left: 0, top: 0, width: 360, height: 640, right: 360, bottom: 640, toJSON() { return {}; } } as DOMRect;
    };
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this); });
    return {
        scrolled,
        restore: () => {
            Element.prototype.getBoundingClientRect = realRect;
            Element.prototype.scrollIntoView = realScroll;
        },
    };
}

describe("the inspector's overlaps (#1198, PB53, PB40)", () => {
    test("one event's banner lists what it overlaps, under its head; a click on one selects it; an event in no pair has none", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        fireEvent.click(bar(container, B2, "J-1018")!);
        await settle();
        expect(banner(container)!.textContent).toContain("Overlaps 1 event on Press B2");
        expect(lines(container)).toEqual([{ selects: elementKey("job", "J-1019"), text: "Tue, Oct 20, 2026 · 10:00–13:00Loyalty cards" }]);
        // The banner is not an edit: it sits outside the fieldset the edits are disabled in.
        expect(banner(container)!.closest("fieldset")).toBeNull();
        fireEvent.click(banner(container)!.querySelector("[data-inspector-overlap]")!);
        await settle();
        expect(pressed(container)).toEqual(new Set([elementKey("job", "J-1019")]));
        expect(pane(container).querySelector("[data-inspector-title]")!.textContent).toBe("Loyalty cards");
        expect(lines(container)).toEqual([{ selects: elementKey("job", "J-1018"), text: "Tue, Oct 20, 2026 · 06:00–12:00Market posters" }]);
        fireEvent.click(bar(container, A1, "J-1001")!);
        await settle();
        expect(banner(container)).toBeNull();
    });

    test("a press's view lists its pairs, each over when they overlap; a click selects the pair; a press with none shows none", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        fireEvent.click(container.querySelector(`${rowAt(B2)} [role="rowheader"]`)!);
        await settle();
        expect(banner(container)!.textContent).toContain("1 overlap");
        const pair = [elementKey("job", "J-1018"), elementKey("job", "J-1019")].join(" ");
        expect(lines(container)).toEqual([{ selects: pair, text: "Tue, Oct 20, 2026 · 10:00–12:00Market posters · Loyalty cards" }]);
        fireEvent.click(banner(container)!.querySelector("[data-inspector-overlap]")!);
        await settle();
        expect(pressed(container)).toEqual(new Set([elementKey("job", "J-1018"), elementKey("job", "J-1019")]));
        fireEvent.click(container.querySelector(`${rowAt(A2)} [role="rowheader"]`)!);
        await settle();
        expect(banner(container)).toBeNull();
    });
});

describe("overlaps never block Save (#1198, PB53)", () => {
    test("they raise no issue and no banner of the sessions': a warning on the canvas alone — and a draft beside them saves (#1194)", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        expect(chip(container)).not.toBeNull();
        expect(slot(container, "banners")!.querySelector("[data-session-banner]")).toBeNull();
        expect(container.querySelector("[role='alert']")).toBeNull();
        // A draft of one of the pair — its customer, in the inspector's form: Save is on, the overlap no issue of the history's.
        fireEvent.click(bar(container, B2, "J-1018")!);
        await settle();
        const user = userEvent.setup();
        const input = pane(container).querySelector<HTMLInputElement>("[data-inspector-fields='form'] [data-field='customer'] input")!;
        await user.clear(input);
        await user.type(input, "Orchard Street Market Co");
        await user.keyboard("{Enter}");
        await settle();
        const history = slot(container, "toolbar")!.querySelector("[data-slot='history']")!;
        const save = [...history.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === editingMessages.apply())!;
        expect(save.disabled).toBe(false);
        expect(history.querySelector("[data-slot='historyIssues']")!.hasAttribute("data-empty")).toBe(true);
        expect(chip(container)).not.toBeNull();
    });
});
