/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Plan>`'s editing, undo and Save (#1194, `Plan Builder Spec.md` §9.9,
 * PB42–PB48, PB50, PB60's `update`), over the print works' three event kinds —
 * its jobs, its stops and its crews' shifts, each a record on e3 with its
 * patch door (`harness.test-utils.tsx`, #1375): every gesture one transaction of its
 * kind's session — the ones with no control yet (a move, a resize, a drop, a
 * schedule, an unschedule) through the kinds' own `write`, and the
 * inspector's (a field of the form, tinted while the record holds it
 * otherwise, an author's `update`, Duplicate, Delete, the bulk state, resource
 * and shift); one history across the kinds, Undo and Redo in gesture order
 * from the history item and the keys, never while typing; Discard of every
 * kind; Save per kind, each its own commit, one kind's conflict or refusal
 * leaving the others committed, a write with no answer retried under its own
 * request id, a kind out of date discarded from its banner alone; auto mode;
 * and the drafts outliving a remount. Every word read from the history item
 * and the banners is the shared messages', never written out. And `data`'s
 * rows over a record of their own (#1436, `planRowDrop`): a run moved along
 * its row, resized, carried to another row, a card dropped under the id the
 * canvas mints, and a move onto a row holding the id refused — each saved as
 * one commit and read back by id.
 */

import { describe, test, expect } from "vitest";
import { fireEvent, renderHook, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTimeType, East, equalFor, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages, fieldFormMessages, getRegisteredPlatformImplementations, type EditHistoryJoined } from "@elaraai/east-ui-components";
import { Data, Plan, PlanPayloadType, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import * as rowDrop from "@elaraai/e3-ui/examples/plan/plan";
import { announced, pointAt } from "@elaraai/east-ui-components/testing";
import { usePlanEventEditing, type PlanEventChange } from "../edit/events.js";
import type { PlanEntryRef } from "../use-plan-editing.js";
import { carrySaid, keyOn } from "../plan-move.test-utils.js";
import { boundFrame } from "../../sheet/frame.test-utils.js";
import { offering } from "../../shared/schedule/keys.test-utils.js";
import { act, el, elementKey, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";
import { conflictCards } from "../../e3-web-mount.test-utils.js";

const h = planHarness({ "plan/plan-events": ex, "plan/plan": rowDrop });
// A select scrolls its open listbox to the chosen option; jsdom does not scroll.
Element.prototype.scrollTo ??= function scrollTo() { /* jsdom lays nothing out */ };

// ── The print works' records ──────────────────────────────────────────────────

type Job = ValueTypeOf<typeof ex.PrintJob>;

/** A record as e3 holds it now, read as another planner would. */
const readJobs = () => h.read(ex.planPrintJobs);
const readStops = () => h.read(ex.planPrintStops);

/** One job changed in the jobs given: what another planner's write commits. */
function jobWith(jobs: ReadonlyMap<string, Job>, key: string, change: Partial<Job>) {
    const next = new Map(jobs);
    next.set(key, { ...next.get(key)!, ...change });
    return next;
}
/** One job changed in the jobs e3 holds now. */
const jobChanged = async (key: string, change: Partial<Job>) => jobWith(await readJobs(), key, change);

/** A record's commits, newest first, by the mutation that made each. */
async function commits(name: string): Promise<string[]> {
    return (await h.history({ name })).commits.map((c) => c.mutation);
}

// ── The print works on the canvas ─────────────────────────────────────────────

/** Press A1's bars and marks, Press A2's bars, Crew 1's chips. */
const A1 = entry("presses.span", "Hall A", "a1");
const A1_MARKS = entry("presses.marks", "Hall A", "a1");
const A2 = entry("presses.span", "Hall A", "a2");
const C1 = entry("crews.cards", "Hall A", "c1");

/** A job's bar on a press's row. */
const bar = (c: HTMLElement, key: string, row = A1) => c.querySelector<HTMLElement>(`${rowAt(row)} ${el("data-run", "job", key)}`);
/** A stop's glyph on Press A1. */
const stop = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`${rowAt(A1_MARKS)} [role="button"]${el("data-mark", "stop", key)}`);
/** A shift's chip on Crew 1. */
const shift = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`${rowAt(C1)} ${el("data-chip", "shift", key)}`);
/** The titles of the jobs drawn on a press's row, in order. */
const jobsOn = (c: HTMLElement, row = A1) => [...c.querySelectorAll(`${rowAt(row)} [data-run]`)].map((node) => node.getAttribute("data-run"));

/** The inspector pane. */
const pane = (c: HTMLElement) => slot(c, "end")!;
/** One field of the inspector's form. */
const field = (c: HTMLElement, key: string) => pane(c).querySelector<HTMLElement>(`[data-inspector-fields='form'] [data-field=${JSON.stringify(key)}]`)!;
/** One of the inspector's facts: its value's words. */
const fact = (c: HTMLElement, name: string) => pane(c).querySelector(`[data-fact=${JSON.stringify(name)}]`)?.textContent ?? null;
/** An inspector's gesture button. */
const action = (c: HTMLElement, name: string) => pane(c).querySelector<HTMLButtonElement>(`[data-inspector-action=${JSON.stringify(name)}]`)!;
/** The edits' fieldset. */
const edits = (c: HTMLElement) => pane(c).querySelector<HTMLFieldSetElement>("fieldset[data-inspector-edits]")!;

/** The history item's buttons, by the shared messages' words. */
const SAVE = editingMessages.apply();
const UNDO = editingMessages.undo();
const REDO = editingMessages.redo();
const DISCARD = editingMessages.discard();
const RETRY = editingMessages.retryRequest();
const historyButton = (c: HTMLElement, name: string) => within(slot(c, "toolbar")!).getByRole("button", { name }) as HTMLButtonElement;
/** The history item's status line, if it shows one. */
const statusLine = (c: HTMLElement) => slot(c, "toolbar")!.querySelector('[data-slot="history"] [role="status"]')?.textContent;
/** The banners shown, each its kind and its title, in order. */
const banners = (c: HTMLElement) => [...(slot(c, "banners")?.querySelectorAll<HTMLElement>("[data-session-banner]") ?? [])]
    .map((node) => ({ kind: node.getAttribute("data-session-banner"), text: node.textContent ?? "" }));
/** A banner's title naming its kind, in the shared messages' words. */
const titled = (kind: string, title: string) => editingMessages.bannerSource({ source: kind, title });
/** The footer's count of the changes waiting on Save. */
const pending = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="pending"]')?.textContent ?? null;
/** The footer's count of the events in the window, the drafts in place. */
const counted = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="events"]')?.textContent ?? null;

/** Clicks a control, as a pointer does, and lets what it starts settle. */
async function press(node: Element) {
    await act(async () => {
        fireEvent.mouseDown(node, { button: 0 });
        fireEvent.click(node);
    });
    await settle();
}

/** Selects an event's element; Shift adds it. */
async function select(node: Element, add = false) {
    fireEvent.click(node, { shiftKey: add });
    await settle();
}

/** Types a field's new text in the inspector's form, committed with Enter. */
async function typeInto(c: HTMLElement, key: string, text: string) {
    const user = userEvent.setup();
    const input = within(field(c, key)).getByRole("textbox");
    await user.clear(input);
    await user.type(input, text);
    await user.keyboard("{Enter}");
    await settle();
}

/** Picks a choice of a select in the inspector, by its field and its words — in the listbox its trigger controls. */
async function choose(c: HTMLElement, key: string, name: string) {
    const trigger = pane(c).querySelector<HTMLElement>(`[data-field=${JSON.stringify(key)}] [data-scope=select][data-part=trigger]`)!;
    await act(async () => { fireEvent.click(trigger); });
    const listbox = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    await act(async () => { fireEvent.click(within(listbox).getByRole("option", { name })); });
    await settle();
}

/** A key with ⌘ held, pressed on an element. */
async function command(node: Element, key: string, shiftKey = false) {
    await act(async () => { fireEvent.keyDown(node, { key, metaKey: true, shiftKey }); });
    await settle();
}

/** The customer field's text, as the inspector's form shows it. */
const customer = (c: HTMLElement) => (within(field(c, "customer")).getByRole("textbox") as HTMLInputElement).value;

// ============================================================================
// Every gesture one transaction (PB42, PB43, PB60)
// ============================================================================

const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");
const NO_JOINED: readonly EditHistoryJoined<PlanEntryRef>[] = [];

/**
 * The print works' three kinds alone — its jobs, stops and shifts — as the
 * payload carries them, the stops' templates a record of their own following
 * their source of the Plan's one rail (#1344).
 */
const printKindsFn = East.function([], PlanPayloadType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const crews = $.let(Record.bind(ex.planPrintCrews, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
    const stops = $.let(Record.bind(ex.planPrintStops, ["patch"]));
    const shifts = $.let(Record.bind(ex.planPrintShifts, ["patch"]));
    const stopTemplates = $.let(Data.bind(ex.planPrintStopTemplates));
    const slice = $.let(Slice.bindRecords("plan.editing.kinds", {
        stopTemplates: { source: Data.bindPaged(ex.planPrintStopTemplates, { indexes: ["plan_print_stop_templates_by_group"] }) },
    }));
    const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
    return Plan.Payload({
        axis, slice: { slice },
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }),
            crews: Schedule.resources(crews.read(), { name: "Crews", icon: "user-group", label: (c) => c.name }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
            }),
            stop: Schedule.events(stops, {
                name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" },
                // A stop is one instant: its templates give no duration.
                templates: Schedule.templates(stopTemplates.read(), { name: (t) => t.name, group: (t) => some(t.group), values: (t) => t.values, source: "stopTemplates" }),
            }),
            shift: Schedule.events(shifts, {
                name: "Crew shift", icon: "user-clock", draw: "cards", title: "title", start: "start", end: "end",
                resource: { field: "crew", of: "crews" }, state: "state",
            }),
        },
    });
});
const printKinds = East.compile(printKindsFn, getRegisteredPlatformImplementations());

const at = (text: string) => new Date(text);
/** An instant as East prints it. */
const printInstant = printFor(DateTimeType);

describe("every gesture is one transaction (PB43)", () => {
    test("a move, a resize, a drop, a schedule and an unschedule — each the kind's own write, one transaction — undone one at a time, in the order they were made, across kinds", async () => {
        // The kinds read their records through the runtimes a mounted Plan installs, their records loaded.
        await h.install({ fn: printKindsFn });
        const payload = printKinds();
        const kinds = new Map(payload.events.map((kind) => [kind.key, kind] as const));
        const { result } = renderHook(() => usePlanEventEditing({ kinds: payload.events, applyMode: "batch", storageKey: "plan-gestures", joined: NO_JOINED }));
        await settle();
        const editing = () => result.current;
        /** An event as Plan draws it, the drafts in place: when it runs, and where. */
        const where = (kind: string, id: string) => {
            // Each kind reads its record whole: the range it would look in first (#1199) is its axis's.
            const read = kinds.get(kind)!.planEvent(id, editing().draftsOf(kind), FIRST, LAST, none);
            if (read.type === "none") return undefined;
            const item = read.value.item;
            const time = (t: typeof item.start) => (t.type === "some" ? printInstant(t.value) : "-");
            return `${time(item.start)} ${time(item.end)} ${item.resource.type === "some" ? item.resource.value.key : "-"}`;
        };
        const record = (changes: readonly PlanEventChange[], origin: Parameters<ReturnType<typeof editing>["record"]>[1], label: string) => {
            let done = false;
            act(() => { done = editing().record(changes, origin, label); });
            return done;
        };
        const placed = (start: string, end: string, kind: string, key: string) =>
            variant("place", { start: at(start), end: at(end), resource: some({ kind, key }) });
        const before = {
            job: where("job", "J-1001"), shift: where("shift", "SH-01"), backlog: where("job", "J-1023"), unscheduled: where("job", "J-1002"),
        };
        expect(before).toEqual({
            job: "2026-10-05T06:00:00.000 2026-10-05T14:00:00.000 a1",
            shift: "2026-10-05T06:00:00.000 2026-10-05T14:00:00.000 c1",
            backlog: "- - -",
            unscheduled: "2026-10-07T06:00:00.000 2026-10-07T12:00:00.000 a1",
        });
        // A move: the catalogue a day on, onto Press B1.
        expect(record([{ kind: "job", id: "J-1001", gesture: placed("2026-10-06T06:00:00Z", "2026-10-06T14:00:00Z", "presses", "b1") }], "move", "Move")).toBe(true);
        // A resize: Crew 1's early shift two hours longer.
        expect(record([{ kind: "shift", id: "SH-01", gesture: placed("2026-10-05T06:00:00Z", "2026-10-05T16:00:00Z", "crews", "c1") }], "resize", "Resize")).toBe(true);
        // A drop: a plate change from its template, on Press A2 — a new stop under a new key.
        const plates = editing().mint("stop", "plates", new Set())!;
        expect(plates).toBe("plates-2");
        expect(record([{ kind: "stop", id: plates, gesture: variant("create", { template: "plates", start: at("2026-10-08T10:00:00Z"), end: at("2026-10-08T10:00:00Z"), resource: some({ kind: "presses", key: "a2" }) }) }], "drop", "Drop")).toBe(true);
        // A schedule: the guide reprint, out of the backlog onto Press A3.
        expect(record([{ kind: "job", id: "J-1023", gesture: placed("2026-10-09T06:00:00Z", "2026-10-09T09:00:00Z", "presses", "a3") }], "drop", "Schedule")).toBe(true);
        // An unschedule: the museum guide, back to the backlog.
        expect(record([{ kind: "job", id: "J-1002", gesture: variant("unplace", null) }], "move", "Unschedule")).toBe(true);
        const after = { job: where("job", "J-1001"), shift: where("shift", "SH-01"), plates: where("stop", plates), backlog: where("job", "J-1023"), unscheduled: where("job", "J-1002") };
        expect(after).toEqual({
            job: "2026-10-06T06:00:00.000 2026-10-06T14:00:00.000 b1",
            shift: "2026-10-05T06:00:00.000 2026-10-05T16:00:00.000 c1",
            plates: "2026-10-08T10:00:00.000 2026-10-08T10:00:00.000 a2",
            backlog: "2026-10-09T06:00:00.000 2026-10-09T09:00:00.000 a3",
            // Unscheduled, its times are none; the press it was on it keeps.
            unscheduled: "- - a1",
        });
        // Five gestures, five changes waiting, none of them written.
        expect(editing().history.pending).toBe(5);
        expect((await readJobs()).get("J-1001")!.press).toEqual(some("a1"));
        // Back, a gesture at a time, the last first — whatever its kind.
        const history = () => editing().history;
        act(() => { history().undo(); });
        expect(where("job", "J-1002")).toBe(before.unscheduled);
        act(() => { history().undo(); });
        expect(where("job", "J-1023")).toBe(before.backlog);
        act(() => { history().undo(); });
        expect(where("stop", plates)).toBeUndefined();
        act(() => { history().undo(); });
        expect(where("shift", "SH-01")).toBe(before.shift);
        expect(where("job", "J-1001")).toBe(after.job);
        act(() => { history().undo(); });
        expect(where("job", "J-1001")).toBe(before.job);
        expect(history().canUndo).toBe(false);
        expect(history().pending).toBe(0);
        // A gesture a kind refuses records nothing: a stop on a crew.
        expect(record([{ kind: "stop", id: "S-01", gesture: placed("2026-10-07T12:00:00Z", "2026-10-07T12:00:00Z", "crews", "c1") }], "move", "Refused")).toBe(false);
        expect(history().canUndo).toBe(false);
    });

    test("in the inspector, a field of the kind's form is one transaction, tinted while the record holds it otherwise; Undo takes it back, and its tint (PB42)", async () => {
        const { container } = await h.mount(ex.planPrintWorks);
        await settle();
        await select(bar(container, "J-1001")!);
        // The edits are on: the kind takes a gesture.
        expect(edits(container).disabled).toBe(false);
        expect(customer(container)).toBe("Alder & Finch");
        expect(field(container, "customer").hasAttribute("data-dirty")).toBe(false);
        await typeInto(container, "customer", "Alder & Finch Ltd");
        expect(customer(container)).toBe("Alder & Finch Ltd");
        expect(field(container, "customer").hasAttribute("data-dirty")).toBe(true);
        // One change waiting; the record holds none of it.
        expect(pending(container)).toBe("1 pending");
        expect((await readJobs()).get("J-1001")!.customer).toBe("Alder & Finch");
        await press(historyButton(container, UNDO));
        expect(customer(container)).toBe("Alder & Finch");
        expect(field(container, "customer").hasAttribute("data-dirty")).toBe(false);
        expect(pending(container)).toBe("0 pending");
        expect(historyButton(container, UNDO).disabled).toBe(true);
        await press(historyButton(container, REDO));
        expect(customer(container)).toBe("Alder & Finch Ltd");
        expect(field(container, "customer").hasAttribute("data-dirty")).toBe(true);
    });

    test("a kind's own inspector's update is one transaction: the stop's kind chosen on its segment, undone whole (PB60)", async () => {
        const { container } = await h.mount(ex.planPrintWorks);
        await settle();
        await select(stop(container, "S-01")!);
        const own = () => pane(container).querySelector<HTMLElement>("[data-inspector-fields='custom']")!;
        expect(own().querySelector<HTMLInputElement>("input[value='plate_change']")!.checked).toBe(true);
        expect(edits(container).disabled).toBe(false);
        await act(async () => { fireEvent.click(own().querySelector<HTMLInputElement>("input[value='service']")!); });
        await settle();
        expect(own().querySelector<HTMLInputElement>("input[value='service']")!.checked).toBe(true);
        expect(pending(container)).toBe("1 pending");
        expect((await readStops()).get("S-01")!.kind.type).toBe("plate_change");
        await press(historyButton(container, UNDO));
        expect(own().querySelector<HTMLInputElement>("input[value='plate_change']")!.checked).toBe(true);
        expect(historyButton(container, UNDO).disabled).toBe(true);
    });

    test("Duplicate is one transaction: a copy under a new key, its row the event's, then selected; Delete is one, the copy gone (PB43)", async () => {
        const { container } = await h.mount(ex.planPrintWorks);
        await settle();
        await select(bar(container, "J-1001")!);
        const initialCount = Number.parseInt(counted(container)!, 10);
        expect(initialCount).toBeGreaterThan(0);
        await press(action(container, "duplicate"));
        // The footer counts the copy: its counts read the drafts (PB23).
        expect(counted(container)).toBe(`${initialCount + 1} events`);
        // The copy draws beside the catalogue, keyed past the record's keys, and is what the inspector shows now.
        expect(jobsOn(container)).toContain(elementKey("job", "J-1001-2"));
        expect(bar(container, "J-1001-2")!.getAttribute("aria-pressed")).toBe("true");
        expect(pane(container).querySelector("[data-inspector-title]")!.textContent).toBe("Spring catalogue");
        expect(fact(container, "start")).toBe("Oct 5, 2026, 06:00");
        expect(pending(container)).toBe("1 pending");
        // A copy is new: every field its form has is tinted.
        expect(field(container, "customer").hasAttribute("data-dirty")).toBe(true);
        await press(action(container, "delete"));
        expect(bar(container, "J-1001-2")).toBeNull();
        expect(pending(container)).toBe("0 pending");
        expect(counted(container)).toBe(`${initialCount} events`);
        // Undo brings the copy back; again, takes it away; the record never held it.
        await press(historyButton(container, UNDO));
        expect(bar(container, "J-1001-2")).not.toBeNull();
        await press(historyButton(container, UNDO));
        expect(bar(container, "J-1001-2")).toBeNull();
        expect((await readJobs()).has("J-1001-2")).toBe(false);
        // Delete of the record's own job: its bar goes, and the record still holds it.
        await select(bar(container, "J-1001")!);
        await press(action(container, "delete"));
        expect(bar(container, "J-1001")).toBeNull();
        expect((await readJobs()).has("J-1001")).toBe(true);
        await press(historyButton(container, UNDO));
        expect(bar(container, "J-1001")).not.toBeNull();
    });

    test("the bulk edit over events of three kinds: a shift in time, the state and the resource — each one transaction across the kinds, one Undo taking each back whole (PB39, PB43)", async () => {
        const { container } = await h.mount(ex.planPrintWorks);
        await settle();
        await select(bar(container, "J-1001")!);
        await select(shift(container, "SH-01")!, true);
        await select(stop(container, "S-01")!, true);
        expect(pane(container).querySelector("[data-inspector-several]")!.textContent).toBe("3 events");
        expect(edits(container).disabled).toBe(false);
        const whenOf = () => [...pane(container).querySelectorAll("[data-inspector-event]")].map((item) => item.querySelectorAll("span")[1]!.textContent);
        const was = whenOf();
        expect(was).toEqual(["Mon, Oct 5, 2026 · 06:00–14:00", "Mon, Oct 5, 2026 · 06:00–14:00", "Wed, Oct 7, 2026 · 12:00"]);
        // +1 h: every event of the three, an hour on, as one transaction.
        await press(action(container, "shift:1hour"));
        expect(whenOf()).toEqual(["Mon, Oct 5, 2026 · 07:00–15:00", "Mon, Oct 5, 2026 · 07:00–15:00", "Wed, Oct 7, 2026 · 13:00"]);
        expect(pending(container)).toBe("3 pending");
        await press(historyButton(container, UNDO));
        expect(whenOf()).toEqual(was);
        expect(pending(container)).toBe("0 pending");
        // The state: written into the job (actual) and the shift (confirmed), the kinds that read one; the stop has none.
        const stateTrigger = () => pane(container).querySelector("[data-field='state'] [data-scope=select][data-part=trigger]")!.textContent;
        // They share none yet: the select is Not set.
        expect(stateTrigger()).toBe(fieldFormMessages.notSet());
        await choose(container, "state", "estimated");
        expect(pending(container)).toBe("2 pending");
        // Both now hold it: the form shows the state they share.
        expect(stateTrigger()).toBe("estimated");
        await press(historyButton(container, UNDO));
        expect(pending(container)).toBe("0 pending");
        // The resource: Press A2 — the job and the stop, both placed on presses, move onto it; the shift's kind is placed on crews, and keeps its crew.
        const stopOnA2 = () => container.querySelector(`${rowAt(entry("presses.marks", "Hall A", "a2"))} [role="button"]${el("data-mark", "stop", "S-01")}`);
        await choose(container, "resource", "Press A2");
        expect(bar(container, "J-1001", A2)).not.toBeNull();
        expect(bar(container, "J-1001")).toBeNull();
        expect(stopOnA2()).not.toBeNull();
        expect(stop(container, "S-01")).toBeNull();
        expect(shift(container, "SH-01")).not.toBeNull();
        expect(pending(container)).toBe("2 pending");
        await press(historyButton(container, UNDO));
        expect([bar(container, "J-1001") !== null, stop(container, "S-01") !== null, stopOnA2()]).toEqual([true, true, null]);
        // Duplicate and Delete over the three: each one transaction across the kinds — the copies then selected.
        await press(action(container, "duplicate"));
        expect(pending(container)).toBe("3 pending");
        const copies = [bar(container, "J-1001-2"), shift(container, "SH-01-2"), stop(container, "S-01-2")];
        expect(copies.every((node) => node !== null)).toBe(true);
        expect(copies.map((node) => node!.getAttribute("aria-pressed"))).toEqual(["true", "true", "true"]);
        await press(historyButton(container, UNDO));
        expect(pending(container)).toBe("0 pending");
        await select(bar(container, "J-1001")!);
        await select(shift(container, "SH-01")!, true);
        await select(stop(container, "S-01")!, true);
        await press(action(container, "delete"));
        expect([bar(container, "J-1001"), shift(container, "SH-01"), stop(container, "S-01")]).toEqual([null, null, null]);
        await press(historyButton(container, UNDO));
        expect([bar(container, "J-1001"), shift(container, "SH-01"), stop(container, "S-01")].every((node) => node !== null)).toBe(true);
    });

    test("the bulk edit over events sharing their state and their resource shows both, and stands as they change together (PB39)", async () => {
        const { container } = await h.mount(ex.planPrintWorks);
        await settle();
        await select(bar(container, "J-1001")!);
        await select(bar(container, "J-1002")!, true);
        const trigger = (key: string) => pane(container).querySelector(`[data-field='${key}'] [data-scope=select][data-part=trigger]`)?.textContent ?? null;
        // Both actual, both on Press A1: the form shows what they share.
        expect([trigger("state"), trigger("resource")]).toEqual(["actual", "Press A1"]);
        // An hour on, together: the form reads them again and still shows it — each field an Option, compared as one.
        await press(action(container, "shift:1hour"));
        expect(pending(container)).toBe("2 pending");
        expect([trigger("state"), trigger("resource")]).toEqual(["actual", "Press A1"]);
    });
});

// ============================================================================
// One history across kinds (PB44)
// ============================================================================

/** A gesture on each kind: the catalogue's customer, the plate change a service, Crew 1's early shift deleted. */
async function oneOfEach(c: HTMLElement) {
    await select(bar(c, "J-1001")!);
    await typeInto(c, "customer", "Alder & Finch Ltd");
    await select(stop(c, "S-01")!);
    await act(async () => { fireEvent.click(pane(c).querySelector<HTMLInputElement>("[data-inspector-fields='custom'] input[value='service']")!); });
    await settle();
    await select(shift(c, "SH-01")!);
    await press(action(c, "delete"));
}

/**
 * Where the three gestures stand, as the Plan draws the drafts: the
 * catalogue's customer and the plate change's kind, each read in the
 * inspector, and whether Crew 1's early shift draws.
 */
async function threeKinds(c: HTMLElement) {
    await select(bar(c, "J-1001")!);
    const job = customer(c);
    await select(stop(c, "S-01")!);
    const kind = pane(c).querySelector<HTMLInputElement>("[data-inspector-fields='custom'] input[value='service']")!.checked ? "service" : "plate_change";
    return { customer: job, stop: kind, shift: shift(c, "SH-01") !== null };
}

describe("one history across kinds (PB44)", () => {
    test("Undo and Redo step through the gestures in the order they were made, whatever their kind; Discard drops every kind's drafts", async () => {
        const { container } = await h.mount(ex.planPrintWorks);
        await settle();
        const kinds = () => Promise.all([commits(ex.planPrintJobs.name), commits(ex.planPrintStops.name), commits(ex.planPrintShifts.name)]);
        const deployed = await kinds();
        await oneOfEach(container);
        const now = () => threeKinds(container);
        expect(await now()).toEqual({ customer: "Alder & Finch Ltd", stop: "service", shift: false });
        expect(pending(container)).toBe("3 pending");
        await press(historyButton(container, UNDO));
        expect(await now()).toEqual({ customer: "Alder & Finch Ltd", stop: "service", shift: true });
        await press(historyButton(container, UNDO));
        expect(await now()).toEqual({ customer: "Alder & Finch Ltd", stop: "plate_change", shift: true });
        await press(historyButton(container, UNDO));
        expect(await now()).toEqual({ customer: "Alder & Finch", stop: "plate_change", shift: true });
        expect(historyButton(container, UNDO).disabled).toBe(true);
        await press(historyButton(container, REDO));
        await press(historyButton(container, REDO));
        expect(await now()).toEqual({ customer: "Alder & Finch Ltd", stop: "service", shift: true });
        await press(historyButton(container, REDO));
        expect(await now()).toEqual({ customer: "Alder & Finch Ltd", stop: "service", shift: false });
        // Discard: every kind's drafts, none of them ever written.
        await press(historyButton(container, DISCARD));
        expect(await now()).toEqual({ customer: "Alder & Finch", stop: "plate_change", shift: true });
        expect(pending(container)).toBe("0 pending");
        expect([historyButton(container, UNDO).disabled, historyButton(container, REDO).disabled]).toEqual([true, true]);
        expect(await kinds()).toEqual(deployed);
    });

    test("⌘Z undoes and ⇧⌘Z or ⌘Y redoes from anywhere in the frame — a pane's tab, the canvas — never while typing in the inspector's field", async () => {
        const { container } = await h.mount(ex.planPrintWorks);
        await settle();
        await select(bar(container, "J-1001")!);
        await typeInto(container, "customer", "Alder & Finch Ltd");
        // In the field being typed into: the field's own undo; the draft stands.
        const input = within(field(container, "customer")).getByRole("textbox");
        input.focus();
        await command(input, "z");
        expect(pending(container)).toBe("1 pending");
        // On the library's tab: the history's.
        const tab = slot(container, "start")!.querySelector('[role="tab"]')!;
        await command(tab, "z");
        expect(pending(container)).toBe("0 pending");
        expect(customer(container)).toBe("Alder & Finch");
        // ⇧⌘Z on the canvas's row; then ⌘Z, and Ctrl+Y, on the inspector's tab bar.
        await command(container.querySelector(rowAt(A1))!, "Z", true);
        expect(customer(container)).toBe("Alder & Finch Ltd");
        await command(pane(container).querySelector("[data-plan-inspector]")!, "z");
        expect(customer(container)).toBe("Alder & Finch");
        await act(async () => { fireEvent.keyDown(pane(container).querySelector("[data-plan-inspector]")!, { key: "y", ctrlKey: true }); });
        await settle();
        expect(customer(container)).toBe("Alder & Finch Ltd");
    });
});

// ============================================================================
// Save per kind (PB45–PB48)
// ============================================================================

describe("Save per kind (PB45–PB48)", () => {
    test("Save commits each kind with drafts once, through its record's patch mutation — saving, then saved — and the drafts retire as each reads back (PB45, PB48)", async () => {
        const { container } = await h.mount(ex.planPrintWorks);
        await settle();
        const deployed = { jobs: await commits(ex.planPrintJobs.name), stops: await commits(ex.planPrintStops.name), shifts: await commits(ex.planPrintShifts.name) };
        expect(historyButton(container, SAVE).disabled).toBe(true);
        await select(bar(container, "J-1001")!);
        await typeInto(container, "customer", "Alder & Finch Ltd");
        await select(stop(container, "S-01")!);
        await act(async () => { fireEvent.click(pane(container).querySelector<HTMLInputElement>("[data-inspector-fields='custom'] input[value='service']")!); });
        await settle();
        expect(historyButton(container, SAVE).disabled).toBe(false);
        // The writes held on their way to e3: saving.
        const writes = h.e3.hold((request) => request.kind === "mutate");
        await press(historyButton(container, SAVE));
        await writes.holding;
        expect(statusLine(container)).toBe(editingMessages.historyStatus({ status: "applying" }));
        // While the stop's write is out its kind takes no gesture: the selected stop's edits are off.
        expect(edits(container).disabled).toBe(true);
        await act(async () => { writes.release(); });
        await settle();
        expect(edits(container).disabled).toBe(false);
        // One commit to each kind that changed, none to the shifts.
        expect(await commits(ex.planPrintJobs.name)).toEqual(["patch", ...deployed.jobs]);
        expect(await commits(ex.planPrintStops.name)).toEqual(["patch", ...deployed.stops]);
        expect(await commits(ex.planPrintShifts.name)).toEqual(deployed.shifts);
        expect((await readJobs()).get("J-1001")!.customer).toBe("Alder & Finch Ltd");
        expect((await readStops()).get("S-01")!.kind.type).toBe("service");
        // Read back as the commits left them: no draft, no status, Save off.
        expect(statusLine(container)).toBeUndefined();
        expect(pending(container)).toBe("0 pending");
        expect(historyButton(container, SAVE).disabled).toBe(true);
        expect(banners(container)).toEqual([]);
        await select(bar(container, "J-1001")!);
        expect(customer(container)).toBe("Alder & Finch Ltd");
        expect(field(container, "customer").hasAttribute("data-dirty")).toBe(false);
    });

    test("a kind whose record moved since carries its drafts over: the customer both changed waits in the conflicts, named by the event and who changed the record last — and the other kinds commit (PB46)", async () => {
        const { container } = await h.mount(ex.planPrintWorks);
        await settle();
        const deployed = await commits(ex.planPrintStops.name);
        await select(bar(container, "J-1001")!);
        await typeInto(container, "customer", "Alder & Finch Ltd");
        await select(stop(container, "S-01")!);
        await act(async () => { fireEvent.click(pane(container).querySelector<HTMLInputElement>("[data-inspector-fields='custom'] input[value='service']")!); });
        await settle();
        // Another planner changes the same job just as Save goes: the jobs' write reaches e3 after theirs.
        await h.race(ex.planPrintJobs, () => {
            fireEvent.mouseDown(historyButton(container, SAVE), { button: 0 });
            fireEvent.click(historyButton(container, SAVE));
        }, (jobs) => jobWith(jobs, "J-1001", { customer: "Alder & Finch Group" }));
        // The job's draft is carried over to the jobs as the other planner left them: nothing is out of date, and the
        // customer both changed waits to be chosen — named as the Plan names the event, with who changed the record last.
        await waitFor(() => {
            expect(banners(container).map((b) => b.kind)).toEqual(["conflicts"]);
            expect(statusLine(container)).toBeUndefined();
        });
        expect(banners(container)[0]!.text).toContain(titled("Print job", editingMessages.bannerConflicts({ n: 1, count: "1" })));
        const [card, ...more] = await conflictCards(container);
        expect(more).toEqual([]);
        expect([card!.item, card!.yours]).toEqual(["Spring catalogue", "Yours, Alder & Finch Ltd"]);
        expect(card!.theirs).toBe("Theirs, Alder & Finch Group, Changed since this edit began — last changed by another session · was Alder & Finch");
        // The stop committed; the job did not, and its draft stands over the other planner's, waiting to be chosen.
        expect(await commits(ex.planPrintStops.name)).toEqual(["patch", ...deployed]);
        expect((await readStops()).get("S-01")!.kind.type).toBe("service");
        expect((await readJobs()).get("J-1001")!.customer).toBe("Alder & Finch Group");
        await select(bar(container, "J-1001")!);
        expect(customer(container)).toBe("Alder & Finch Ltd");
        expect(pending(container)).toBe("1 pending");
        expect(historyButton(container, SAVE).disabled).toBe(true);
    });

    test("a refused write is a banner with its reason, its kind's drafts kept; the other kinds commit (PB46)", async () => {
        // The crew roster is locked for the week: its patch door refuses to take a shift off it.
        const { container } = await h.mount(lockedRoster);
        await settle();
        await select(bar(container, "J-1001")!);
        await typeInto(container, "customer", "Alder & Finch Ltd");
        await select(shift(container, "SH-01")!);
        await press(action(container, "delete"));
        await press(historyButton(container, SAVE));
        expect(banners(container).map((b) => b.kind)).toEqual(["rejected"]);
        expect(banners(container)[0]!.text).toContain(titled("Crew shift", editingMessages.bannerRejected()));
        expect(banners(container)[0]!.text).toContain("The write failed: ");
        expect(banners(container)[0]!.text).toContain("the crew roster is locked for the week");
        expect((await readJobs()).get("J-1001")!.customer).toBe("Alder & Finch Ltd");
        expect((await h.read(ex.planLockedShifts)).has("SH-01")).toBe(true);
        expect(shift(container, "SH-01")).toBeNull();
        expect(pending(container)).toBe("1 pending");
    });

    test("a write with no answer leaves its kind unknown: Save is Retry, which resends that kind's request, its id unchanged — the other kind's commit standing, never written twice (PB47)", async () => {
        const { container } = await h.mount(ex.planPrintWorks);
        await settle();
        const deployed = { jobs: await commits(ex.planPrintJobs.name), stops: await commits(ex.planPrintStops.name) };
        await select(bar(container, "J-1001")!);
        await typeInto(container, "customer", "Alder & Finch Ltd");
        await select(stop(container, "S-01")!);
        await act(async () => { fireEvent.click(pane(container).querySelector<HTMLInputElement>("[data-inspector-fields='custom'] input[value='service']")!); });
        await settle();
        // The jobs' write lands on e3, and every answer to it is lost on the way back: the client tries again under
        // the same id until it gives up, which leaves the write unknown.
        const losing = h.e3.fail((request) => request.kind === "mutate" && request.record === ex.planPrintJobs.name, "lost");
        await act(async () => {
            fireEvent.mouseDown(historyButton(container, SAVE), { button: 0 });
            fireEvent.click(historyButton(container, SAVE));
        });
        await waitFor(() => expect(banners(container).map((b) => b.kind)).toEqual(["unknown"]), { timeout: 15_000 });
        expect(banners(container)[0]!.text).toContain(titled("Print job", editingMessages.bannerUnknown()));
        expect(statusLine(container)).toBe(editingMessages.historyStatus({ status: "unknown" }));
        expect(within(slot(container, "toolbar")!).queryByRole("button", { name: SAVE })).toBeNull();
        // The stop's commit stands.
        expect(await commits(ex.planPrintStops.name)).toEqual(["patch", ...deployed.stops]);
        losing();
        await press(historyButton(container, RETRY));
        const keys = h.requests("mutate", ex.planPrintJobs.name).map((request) => request.idempotencyKey);
        expect(keys.length).toBeGreaterThan(1);
        expect(keys[0]).toBeDefined();
        expect(new Set(keys).size).toBe(1);
        expect(await commits(ex.planPrintJobs.name)).toEqual(["patch", ...deployed.jobs]);
        expect(await commits(ex.planPrintStops.name)).toEqual(["patch", ...deployed.stops]);
        expect(banners(container)).toEqual([]);
        expect(pending(container)).toBe("0 pending");
    });

    test("a kind's record moving under its pending drafts carries them over: another job's change stands beside them, and Save sends every kind's (PB48)", async () => {
        const { container } = await h.mount(ex.planPrintWorks);
        await settle();
        await select(bar(container, "J-1001")!);
        await typeInto(container, "customer", "Alder & Finch Ltd");
        await select(stop(container, "S-01")!);
        await act(async () => { fireEvent.click(pane(container).querySelector<HTMLInputElement>("[data-inspector-fields='custom'] input[value='service']")!); });
        await settle();
        // Another planner's write to another job.
        await h.commit(ex.planPrintJobs, await jobChanged("J-1005", { customer: "Copperleaf Cafe & Bakery" }));
        // The job's draft is carried over to the jobs as the planner left them: nothing is out of date, and Save is on.
        await waitFor(() => expect(historyButton(container, SAVE).disabled).toBe(false));
        expect(banners(container)).toEqual([]);
        expect(statusLine(container)).toBeUndefined();
        expect(pending(container)).toBe("2 pending");
        await select(bar(container, "J-1001")!);
        expect(customer(container)).toBe("Alder & Finch Ltd");
        // Save sends both kinds' drafts; the other planner's change stands beside them.
        await press(historyButton(container, SAVE));
        expect((await readJobs()).get("J-1001")!.customer).toBe("Alder & Finch Ltd");
        expect((await readJobs()).get("J-1005")!.customer).toBe("Copperleaf Cafe & Bakery");
        expect((await readStops()).get("S-01")!.kind.type).toBe("service");
        expect(pending(container)).toBe("0 pending");
    });
});

/**
 * The print works' jobs beside a crew roster the works has locked for the
 * week: its patch door refuses a Save that takes a shift off it.
 */
const lockedRoster = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const crews = $.let(Record.bind(ex.planPrintCrews, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
    const shifts = $.let(Record.bind(ex.planLockedShifts, ["patch"]));
    const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
    return Plan({
        axis, inspector: true,
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.hall }),
            crews: Schedule.resources(crews.read(), { name: "Crews", icon: "user-group", label: (c) => c.name, group: (c) => c.hall }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", draw: "span", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state", fields: { customer: Schedule.field.text({ label: "Customer" }) },
            }),
            shift: Schedule.events(shifts, {
                name: "Crew shift", icon: "user-clock", draw: "cards", title: "title", start: "start", end: "end",
                resource: { field: "crew", of: "crews" }, state: "state",
            }),
        },
    });
}))) };

// ============================================================================
// Auto mode, and drafts outliving a remount (PB50)
// ============================================================================

/** The jobs on the presses, sent as each gesture lands, with the inspector and the jobs' customer in its form. */
const autoJobs = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
    const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
    return Plan({
        axis, applyMode: "auto", inspector: true,
        resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, fields: { customer: Schedule.field.text({ label: "Customer" }) },
            }),
        },
    });
}))) };

describe("auto mode, and a remount (PB50)", () => {
    test("applyMode auto sends each ready gesture as it lands, through the same protocol; Undo sends the inverse", async () => {
        const { container } = await h.mount(autoJobs);
        await settle();
        const deployed = await commits(ex.planPrintJobs.name);
        await select(container.querySelector<HTMLElement>(`${rowAt(entry("presses.span", "a1"))} ${el("data-run", "job", "J-1001")}`)!);
        await typeInto(container, "customer", "Alder & Finch Ltd");
        expect((await readJobs()).get("J-1001")!.customer).toBe("Alder & Finch Ltd");
        expect(pending(container)).toBe("0 pending");
        await press(historyButton(container, UNDO));
        expect((await readJobs()).get("J-1001")!.customer).toBe("Alder & Finch");
        expect(await commits(ex.planPrintJobs.name)).toEqual(["patch", "patch", ...deployed]);
        expect(customer(container)).toBe("Alder & Finch");
    });

    test("the drafts and their history outlive a remount, kept per record: the remounted Plan shows them, and undoes them", async () => {
        const first = await h.mount(ex.planPrintWorks);
        await settle();
        await oneOfEach(first.container);
        expect(pending(first.container)).toBe("3 pending");
        first.unmount();
        const again = await h.mount(ex.planPrintWorks);
        await settle();
        expect(pending(again.container)).toBe("3 pending");
        expect(shift(again.container, "SH-01")).toBeNull();
        // The history as it was: the shift's deletion is the last gesture.
        await press(historyButton(again.container, UNDO));
        expect(shift(again.container, "SH-01")).not.toBeNull();
        expect(pending(again.container)).toBe("2 pending");
    });
});

// ============================================================================
// `data`'s rows, their items written by id (#1436)
// ============================================================================

type DropJob = ValueTypeOf<typeof rowDrop.DropJob>;
const sameJob = equalFor(rowDrop.DropJob);

/** The ops record as e3 holds it now. */
const readOps = () => h.read(rowDrop.planDropOps);
/** A press's jobs as e3 holds them now. */
const jobsOf = async (press: string) => (await readOps()).get(press)!.jobs;
/** Whether `jobs` hold `job` under `id`, field for field. */
const holds = (jobs: ReadonlyMap<string, DropJob>, id: string, job: DropJob) => jobs.has(id) && sameJob(jobs.get(id)!, job);
/** A press's run, by its job's id. */
const runOf = (c: HTMLElement, press: string, id: string) => c.querySelector<HTMLElement>(`${rowAt(entry("press", press))} [data-run=${JSON.stringify(id)}]`);
/** A press's row. */
const pressRow = (c: HTMLElement, press: string) => c.querySelector<HTMLElement>(rowAt(entry("press", press)))!;
/** The Save requests the ops record was sent. */
const opsWrites = () => h.requests("mutate", rowDrop.planDropOps.name);
/** A palette card in the Plan's own library panel, by its key. */
const paletteCard = (c: HTMLElement, key: string) =>
    slot(c, "start")!.querySelector<HTMLElement>(`[role="tabpanel"]:not([hidden]) [data-library-item=${JSON.stringify(key)}]`)!;
/** Picks a run up by the keyboard, presses the keys given, and puts it down. */
async function carryRun(run: HTMLElement, ...keys: { key: string; shiftKey?: boolean }[]) {
    run.focus();
    await keyOn({ key: " " });
    for (const key of keys) await keyOn(key);
    await keyOn({ key: " " });
}

describe("data's rows, their items written by id (#1436)", () => {
    test("a run moved along its row, resized by its end and another carried to another row: Save sends one write, and each job reads back under its id", async () => {
        // Its canvas is bounded: laid out, its rows mount.
        const restore = boundFrame(2000);
        try {
            const { container: c } = await h.mount(rowDrop.planRowDrop, { drag: true });
            await settle();
            const deployed = await commits(rowDrop.planDropOps.name);
            const j4642 = (await jobsOf("p03")).get("j4642")!;
            const j4624 = (await jobsOf("p04")).get("j4624")!;
            // J-4642 a week on along H1-P03, then its end a week further.
            await carryRun(runOf(c, "p03", "j4642")!, { key: "ArrowRight" });
            expect(carrySaid(c)).toMatch(/^Dropped RUN · J-4642 on H1-P03/);
            await carryRun(runOf(c, "p03", "j4642")!, { key: "ArrowRight", shiftKey: true });
            // J-4624 carried up from H1-P04 onto H1-P03, its weeks as they were.
            await carryRun(runOf(c, "p04", "j4624")!, { key: "ArrowUp" });
            expect(runOf(c, "p03", "j4624")).not.toBeNull();
            expect(runOf(c, "p04", "j4624")).toBeNull();
            expect(pressRow(c, "p03").hasAttribute("data-draft")).toBe(true);
            expect(pressRow(c, "p04").hasAttribute("data-draft")).toBe(true);
            // Nothing written yet: the gestures are drafts.
            expect(opsWrites()).toEqual([]);

            await press(historyButton(c, SAVE));
            await settle();
            // One request, one commit through the record's patch door, for the three gestures.
            expect(opsWrites()).toHaveLength(1);
            expect(await commits(rowDrop.planDropOps.name)).toEqual(["patch", ...deployed]);
            expect(pending(c)).toBe("0 pending");
            // Read back by id: J-4642 a week on, its end a week further still; J-4624 under its
            // own id on H1-P03 and gone from H1-P04 — each job's other fields as they were.
            const p03 = await jobsOf("p03");
            const p04 = await jobsOf("p04");
            expect([...p03.keys()]).toEqual(["j4624", "j4642"]);
            expect(holds(p03, "j4642", { ...j4642, start: at("2026-07-13T00:00:00Z"), end: at("2026-08-10T00:00:00Z") })).toBe(true);
            expect(holds(p03, "j4624", j4624)).toBe(true);
            expect([...p04.keys()]).toEqual([]);
        } finally {
            restore();
        }
    });

    test("a card dropped on a press joins its jobs under the id the canvas mints: Save sends one write, and the job reads back under it", async () => {
        const restore = boundFrame(2000);
        try {
            const { container: c } = await h.mount(rowDrop.planRowDrop, { drag: true });
            await settle();
            const deployed = await commits(rowDrop.planDropOps.name);
            fireEvent.pointerDown(paletteCard(c, "job-poster"), { clientX: 0, clientY: 0 });
            pointAt(pressRow(c, "p04").querySelector("[data-drag-cell]"));
            fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
            // The new job's id is the Plan's to mint: offered one.
            offering(["job-minted"]);
            fireEvent.pointerUp(document, { clientX: 10, clientY: 10 });
            await settle();
            // jsdom's zero-width rect puts the pointer in the first week.
            expect(announced()).toBe("Poster run was dropped on H1-P04, Week of Jun 29, 2026.");
            expect(runOf(c, "p04", "job-minted")).not.toBeNull();

            await press(historyButton(c, SAVE));
            await settle();
            expect(opsWrites()).toHaveLength(1);
            expect(await commits(rowDrop.planDropOps.name)).toEqual(["patch", ...deployed]);
            const p04 = await jobsOf("p04");
            expect([...p04.keys()]).toEqual(["j4624", "job-minted"]);
            // `create`'s item, a fortnight from the week it landed in, proposed.
            expect(holds(p04, "job-minted", {
                label: "Poster run", start: at("2026-06-29T00:00:00Z"), end: at("2026-07-13T00:00:00Z"), state: variant("proposed", variant("added", null)),
            })).toBe(true);
        } finally {
            restore();
        }
    });

    test("a run carried onto a row whose jobs hold its id is refused — said, nothing drafted, nothing written", async () => {
        // Another planner puts a job under J-4642's id on H1-P04: another job, the same id.
        const ops = await readOps();
        const p04 = ops.get("p04")!;
        const other: DropJob = { label: "RUN · J-4642 (H1-P04)", start: at("2026-08-03T00:00:00Z"), end: at("2026-08-17T00:00:00Z"), state: variant("confirmed", null) };
        await h.commit(rowDrop.planDropOps, new Map([...ops, ["p04", { ...p04, jobs: new Map([...p04.jobs, ["j4642", other]]) }]]));
        const restore = boundFrame(2000);
        try {
            const { container: c } = await h.mount(rowDrop.planRowDrop, { drag: true });
            await settle();
            const deployed = await commits(rowDrop.planDropOps.name);
            runOf(c, "p03", "j4642")!.focus();
            await keyOn({ key: " " });
            await keyOn({ key: "ArrowDown" });
            // H1-P04's jobs keep their ids unique: the row refuses it, and the carry goes on.
            expect(carrySaid(c)).toBe("RUN · J-4642 cannot be dropped on H1-P04, Jul 6, 2026 – Jul 27, 2026");
            await keyOn({ key: " " });
            await keyOn({ key: "Escape" });
            expect(pressRow(c, "p03").hasAttribute("data-draft")).toBe(false);
            expect(pressRow(c, "p04").hasAttribute("data-draft")).toBe(false);
            expect(historyButton(c, SAVE).disabled).toBe(true);
            expect(opsWrites()).toEqual([]);
            expect(await commits(rowDrop.planDropOps.name)).toEqual(deployed);
            // Each press holds its own J-4642 still.
            expect(holds(await jobsOf("p04"), "j4642", other)).toBe(true);
            expect((await jobsOf("p03")).has("j4642")).toBe(true);
        } finally {
            restore();
        }
    });
});
