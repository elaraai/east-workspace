/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Calendar's hidden pick (#1398) on e3 itself, over the indexed Calendar's
 * jobs, its rail choosing Ready: an event Search Records finds that its kind's
 * choices hide is named by the choices that hide it, each as the rail words it
 * — never by its window, which the Calendar's navigation writes and a pick
 * steps to — asked of e3 through the kind's source: which of the events the box
 * lists its choices hide, in one request over the page the box read them from,
 * which also answers the Status alone — the one choice beside the window — and
 * nothing again at the same revision and narrowing, whatever the window. The
 * lines follow the choices as they move. A pick of it clears just those
 * choices, its window kept, and goes to the event, selected and given the
 * keyboard once the narrowing it leaves draws it.
 *
 * Over the operations' calendar, where the view lays resources out — the
 * timeline's rows — an event whose resource its resource kind's source hides
 * is drawn nowhere: its line names that source's choices beside its kind's
 * own, asked of e3 of the resources the lines stand on that the source hides,
 * and a pick clears them all. The time grid narrows no event by its resource,
 * and names none.
 */
import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ops from "@elaraai/e3-ui/examples/calendar/calendar";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar-records";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { eventKey } from "./model.js";
import "./index.js";

const h = e3Harness({ "calendar/calendar-records": ex, "calendar/calendar": ops }, { main: "data-calendar-main" });
/** The jobs' record, as its dataset's requests name it. */
const EVENTS = "records.indexed_calendar_events";
/** Where the rail keeps the jobs' source's narrowing. */
const SOURCE = "ex.calendarRecordIndexes.job";
/** What hides a job its kind's Status choice leaves out. */
const BY_STATUS = "hidden by Status: Ready — picking it clears that filter";
const decodeState = decodeBeast2For(RecordSliceStateType);
const encodeState = encodeBeast2For(RecordSliceStateType);
const printString = printFor(StringType);

/** The calendar mounted over a store of its own, its jobs drawn. */
async function open() {
    const store = new UIStore();
    StateRuntime.initializeStore(store);
    const { container } = await h.mount(ex.calendarRecordIndexes, { storageKey: "calendar-hidden-pick" });
    await waitFor(() => expect(event(container, "job")).not.toBeNull());
    await settle();
    return { c: container, store };
}
const event = (c: HTMLElement, key: string, kind = "job") => c.querySelector<HTMLElement>(`[data-calendar-event=${JSON.stringify(eventKey({ kind, key }))}]`);
/** A source's narrowing, as the store holds it: the jobs' unless another is named. */
const whereOf = (store: UIStore, source = SOURCE) => decodeState(store.read(source)!).where;
/** A field of a source chosen, as the rail's chip writes it: the source's other choices — its window among them — kept. */
async function choose(store: UIStore, source: string, field: string, value: string) {
    const state = decodeState(store.read(source)!);
    const where = new SortedMap([...state.where], compareFor(StringType));
    where.set(field, variant("values", [printString(value)]));
    await act(async () => { store.write(source, encodeState({ ...state, preset: none, where })); });
    await settle();
}
/** The jobs' Status chosen, as the rail's chip writes it: the window kept. */
const chooseStatus = (store: UIStore, status: string) => choose(store, SOURCE, "status", status);

/** Search Records' box, in the toolbar's row. */
const searchBox = (c: HTMLElement) => slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;
async function typeIntoSearch(c: HTMLElement, typed: string) {
    const input = searchBox(c).querySelector<HTMLInputElement>("input")!;
    for (const key of typed) {
        const now = input.value + key;
        await userEvent.type(input, key);
        await waitFor(() => expect(input.value).toBe(now));
    }
}
/**
 * A query put in the box at once, as a paste is: one input event, with no keystrokes of user-event's. User-event sends a
 * `change` of its own as an input it typed into loses the focus, inside an `act` of its own, and a pick's hand-off moves
 * the focus from the box inside React's commit — one that lands while no `act` is open, between a settle's turns, would
 * have that `act` flush React's work inside the commit.
 */
async function pasteIntoSearch(c: HTMLElement, typed: string) {
    const input = searchBox(c).querySelector<HTMLInputElement>("input")!;
    await act(async () => { input.focus(); fireEvent.input(input, { target: { value: typed } }); });
    await settle();
}
async function clearSearch(c: HTMLElement) {
    await act(async () => { fireEvent.click(searchBox(c).querySelector("button[aria-label='Clear search']")!); });
    await settle();
}
/** The box's list — the listbox its input controls — its lines as they read. */
const lines = (c: HTMLElement) => {
    const list = document.getElementById(searchBox(c).querySelector("input")!.getAttribute("aria-controls") ?? "");
    return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map(option => option.textContent ?? "");
};
/** Enter in the box: it picks the first match. */
async function enter(c: HTMLElement) {
    await act(async () => { fireEvent.keyDown(searchBox(c).querySelector("input")!, { key: "Enter" }); });
    await settle();
}
/** A membership read's body: the index whose runs it asks of, and the entry keys `(ik=…, k=…)` it asks. */
const withinOf = (request: E3Request) => JSON.parse(new TextDecoder().decode(request.body)) as { index: string; keys: string[] };
/** The job an entry key names: its record key. */
const rowOf = (entry: string) => /k="([^"]+)"\)$/.exec(entry)![1]!;
/** The jobs `production-10000` to `production-10009`, as a query of `production-1000` lists them: every third Done. */
const TEN = Array.from({ length: 10 }, (_, n) => `production-1000${n}`);
const DONE = ["production-10000", "production-10003", "production-10006", "production-10009"];

test("Search Records names the choice that hides a job as the rail words it — its kind's Status: Ready — never its window: e3 is asked which of the jobs the box lists the choices hide, each job once, which answers the Status alone too, and nothing is asked again, a step of the dates included", async () => {
    const { c } = await open();
    const before = h.requests("within", EVENTS).length;
    await typeIntoSearch(c, "production-1000");
    await waitFor(() => expect(lines(c).filter(line => line.endsWith(` · ${BY_STATUS}`))).toHaveLength(DONE.length), { timeout: 10_000 });
    await settle();
    expect(lines(c).map(line => line.split(" · ")[0])).toEqual(TEN);
    expect(lines(c).filter(line => line.includes("hidden by")).map(line => line.split(" · ")[0])).toEqual(DONE);
    // Which of the jobs the box lists the choices hide, through the index by status: a request for the jobs of each page it
    // listed as the query was typed that no request before asked of — each job asked of once, the ten among them. The
    // Status alone is that same narrowing — the one choice beside the window — so its answers name the four Done with
    // nothing more asked.
    const reads = h.requests("within", EVENTS).slice(before).map(withinOf);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(read => read.index === "calendar_by_status_time")).toBe(true);
    const asked = reads.flatMap(read => [...new Set(read.keys.map(rowOf))]);
    expect(asked).toHaveLength(new Set(asked).size);
    expect(TEN.filter(key => !asked.includes(key))).toEqual([]);
    const listed = h.requests("within", EVENTS).length;
    // Listed again, one of the four alone: named at once, nothing asked of e3 again.
    await clearSearch(c);
    await typeIntoSearch(c, "production-10003");
    await waitFor(() => expect(lines(c)).toEqual([`production-10003 · Production job 10003 · Job · Wed, Apr 22, 2026 09:00 · ${BY_STATUS}`]), { timeout: 10_000 });
    await settle();
    expect(h.requests("within", EVENTS).length).toBe(listed);
    // A job of another day the window leaves out is hidden by nothing: the window is the Calendar's to step, never a choice.
    await clearSearch(c);
    await typeIntoSearch(c, "next");
    await waitFor(() => expect(lines(c)).toEqual(["next · Weekend catalogue · Job · Sat, Oct 3, 2026 09:00"]), { timeout: 10_000 });
    // A step of the dates moves the window alone: listed after it, the Done job is named at once, nothing asked again.
    await clearSearch(c);
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole("button", { name: "Next day" })); });
    await settle();
    await typeIntoSearch(c, "production-10003");
    await waitFor(() => expect(lines(c)).toEqual([`production-10003 · Production job 10003 · Job · Wed, Apr 22, 2026 09:00 · ${BY_STATUS}`]), { timeout: 10_000 });
    await settle();
    expect(h.requests("within", EVENTS).length).toBe(listed);
});

test("a pick of a job its kind's choices hide clears just them — its window kept — and goes to the job: drawn, selected and given the keyboard once the narrowing it leaves draws it", async () => {
    const { c, store } = await open();
    expect(event(c, "done")).toBeNull();
    const window = whereOf(store).get("start");
    expect(window?.type).toBe("range");
    await pasteIntoSearch(c, "done");
    await waitFor(() => expect(lines(c)).toEqual([`done · Completed proof · Job · Fri, Oct 2, 2026 08:00 · ${BY_STATUS}`]), { timeout: 10_000 });
    await enter(c);
    await waitFor(() => expect(event(c, "done")?.getAttribute("aria-pressed")).toBe("true"), { timeout: 10_000 });
    await waitFor(() => expect(document.activeElement).toBe(event(c, "done")));
    // The Status cleared, the window as it was: the day the job is on.
    const where = whereOf(store);
    expect([...where.keys()]).toEqual(["start"]);
    expect(where.get("start")).toEqual(window);
});

test("the lines follow the choices: a Status chosen while the box lists the jobs names the ones it hides now, and the ones it shows plainly", async () => {
    const { c, store } = await open();
    await typeIntoSearch(c, "production-1000");
    await waitFor(() => expect(lines(c).filter(line => line.endsWith(` · ${BY_STATUS}`))).toHaveLength(DONE.length), { timeout: 10_000 });
    // Done chosen in place of Ready, the window kept: the six Ready jobs are hidden by it now, the four Done shown.
    await chooseStatus(store, "Done");
    const byDone = "hidden by Status: Done — picking it clears that filter";
    await waitFor(() => expect(lines(c).filter(line => line.endsWith(` · ${byDone}`)).map(line => line.split(" · ")[0]))
        .toEqual(TEN.filter(key => !DONE.includes(key))), { timeout: 10_000 });
    expect(lines(c).filter(line => !line.includes("hidden by")).map(line => line.split(" · ")[0])).toEqual(DONE);
});

/** Where the rail keeps the operations' maintenance's source's narrowing, and the machines'. */
const SERVICES = "ex.calendarOperations.service";
const MACHINES = "ex.calendarOperations.machines";
/** The machines' record, as its dataset's requests name it. */
const MACHINE_ROWS = "records.calendar_machines";

test("where the view lays resources out, an event its resource's source hides is named by that source's choices beside its kind's own — Machine: press1; Area: Press shop — asked of e3 of the machines the source hides alone; a pick clears them all, the window kept, and goes to it; the time grid, which narrows no event by its resource, names its kind's alone", async () => {
    const store = new UIStore();
    StateRuntime.initializeStore(store);
    const { container: c } = await h.mount(ops.calendarOperations, { storageKey: "calendar-hidden-resource" });
    await waitFor(() => expect(event(c, "service2", "service")).not.toBeNull());
    await settle();
    // The calibration is on Lathe 1, in the Machine shop: the maintenance narrowed to Press 1's, and the machines to the
    // Press shop's, each as the rail's chip writes it.
    await choose(store, SERVICES, "machine", "press1");
    await choose(store, MACHINES, "area", "Press shop");
    expect(event(c, "service2", "service")).toBeNull();
    // The week's time grid narrows no event by its machine: the calibration is named by its kind's choice alone, and
    // nothing is asked of the machines.
    const before = h.requests("within", MACHINE_ROWS).length;
    await pasteIntoSearch(c, "service2");
    await waitFor(() => expect(lines(c)).toEqual(["service2 · Calibration · Maintenance · Fri, Oct 2, 2026 13:00 · hidden by Machine: press1 — picking it clears that filter"]),
        { timeout: 10_000 });
    expect(h.requests("within", MACHINE_ROWS).length).toBe(before);
    await clearSearch(c);
    // The timeline lays the machines out, Lathe 1's row hidden: the calibration is named by the Area that hides its
    // machine too. What hides the machines its lines stand on is asked of e3 through the machines' index by area, of the
    // Machine shop's alone — the Area hides them, as what it shows says — never of a machine it shows.
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole("radio", { name: "Timeline" })); });
    await settle();
    await pasteIntoSearch(c, "service2");
    await waitFor(() => expect(lines(c)).toEqual([
        "service2 · Calibration · Maintenance · Fri, Oct 2, 2026 13:00 · hidden by Machine: press1; Area: Press shop — picking it clears those filters",
    ]), { timeout: 10_000 });
    const reads = h.requests("within", MACHINE_ROWS).slice(before).map(withinOf);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter(read => read.index !== "calendar_machines_by_area" || read.keys.some(entry => !["lathe1", "lathe2"].includes(rowOf(entry))))).toEqual([]);
    // Picked: the maintenance's Machine and the machines' Area cleared — its window, the timeline's, kept — and the
    // calibration drawn on Lathe 1's row, selected and given the keyboard.
    const window = whereOf(store, SERVICES).get("start");
    expect(window?.type).toBe("range");
    await enter(c);
    await waitFor(() => expect(event(c, "service2", "service")?.getAttribute("aria-pressed")).toBe("true"), { timeout: 10_000 });
    await waitFor(() => expect(document.activeElement).toBe(event(c, "service2", "service")));
    expect([...whereOf(store, SERVICES).keys()]).toEqual(["start"]);
    expect(whereOf(store, SERVICES).get("start")).toEqual(window);
    expect(whereOf(store, MACHINES).size).toBe(0);
});

test("an event waiting in the Backlog, which no layout lays on a resource, is hidden by no resource kind's source: on the timeline a job on Press 1 the machines' Area hides is named by it, and the Backlog's job on Press 1 by nothing", async () => {
    const store = new UIStore();
    StateRuntime.initializeStore(store);
    const { container: c } = await h.mount(ops.calendarOperations, { storageKey: "calendar-hidden-backlog" });
    await waitFor(() => expect(event(c, "job1")).not.toBeNull());
    await settle();
    // The machines narrowed to the Machine shop's, Press 1 hidden, and the timeline laying them out.
    await choose(store, MACHINES, "area", "Machine shop");
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole("radio", { name: "Timeline" })); });
    await settle();
    expect(event(c, "job1")).toBeNull();
    // The brackets, on Press 1's row, are drawn nowhere: named by the Area.
    await pasteIntoSearch(c, "job1");
    await waitFor(() => expect(lines(c)).toEqual([
        "job1 · Mounting brackets · batch 42 · Production · Thu, Oct 1, 2026 06:00 · hidden by Area: Machine shop — picking it clears that filter",
    ]), { timeout: 10_000 });
    // The torque-test fixtures wait in the Backlog, on Press 1 too: a card of the Backlog, which no Area narrows.
    await clearSearch(c);
    await pasteIntoSearch(c, "backlog1");
    await waitFor(() => expect(lines(c)).toEqual(["backlog1 · Torque-test fixtures · Production · backlog"]), { timeout: 10_000 });
    await settle();
    expect(lines(c)).toEqual(["backlog1 · Torque-test fixtures · Production · backlog"]);
});
