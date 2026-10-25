/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's examples on e3 itself (#1376, #1369): the warehouse's module
 * deployed to e3-web (`roster/roster`), each test a workspace of its own. The
 * Roster reads the warehouse's own records — its duties a week at a time
 * through the slice's duty source, an interval index over their times; its
 * weeks and its cover targets whole, or by key, as an example binds them; its
 * staff and activities a window at a time through their indexes, as e3 serves
 * them — and every Save and Publish is a real commit through each record's
 * patch door, a request a record. Another session's edit of a record goes in
 * through its own door (`h.patch`). The fit a Find fix asks is an example's
 * own `e3.function`, called by name on e3 (`shared/func/fit-calls.test-utils.ts`):
 * what the Roster asked is its calls' bodies, what e3 answered a tap's, and a
 * fit held or failed a fault at the harness's fetch. What a test counts it
 * reads from the request log (`h.requests`).
 *
 * Each test runs alone (#1280, `test-runs.test-utils.ts`): a test file takes
 * `act` from here, never from Testing Library.
 *
 * @packageDocumentation
 */

import { fireEvent, within } from "@testing-library/react";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, parseFor, printFor, some,
    variant, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import { pointAt } from "@elaraai/east-ui-components/testing";
import { Data, Func, Record, Roster, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, currentHarness, e3Harness, settle, slot, type E3Harness, type Example, type MountOptions } from "../e3-web-mount.test-utils.js";
import { fitCalls, type FitCalls } from "../shared/func/fit-calls.test-utils.js";
import "./index.js";
export { act, programOf, settle, slot, width } from "../e3-web-mount.test-utils.js";
export { searched } from "../e3-web.test-utils.js";

const parseInstant = parseFor(DateTimeType);
/**
 * An instant as East prints a DateTime (`2028-03-09T06:00:00`), read with East's parser.
 *
 * @param text - The instant's text
 * @returns The instant
 * @throws {Error} When the text is no instant
 */
export function at(text: string): Date {
    const read = parseInstant(text);
    if (!read.success) throw new Error(`${text} is no instant`);
    return read.value;
}
/** The warehouse's week, the one its examples open on. */
export const START = at("2028-03-05T00:00:00");
/** The week after it, which the weeks record holds no row of. */
export const NEXT = at("2028-03-12T00:00:00");
/** The week before it, published. */
export const PREVIOUS = at("2028-02-27T00:00:00");

/** A question to the Roster's fit over the warehouse's duties, and its answer, decoded. */
export const FitRequestType = Roster.Types.FitRequest(ex.WarehouseDuty);
export type FitRequest = ValueTypeOf<typeof FitRequestType>;
export type FitResult = ValueTypeOf<typeof Roster.Types.FitResult>;
/** One of the warehouse's duties, as its record holds it. */
export type Duty = ValueTypeOf<typeof ex.WarehouseDuty>;

/** The Roster's harness: e3 with the warehouse's module deployed, and the fit its Find fixes ask. */
export interface RosterHarness extends E3Harness {
    /** The fit, as the Roster asks it: the warehouse's, or another app's, by its `e3.function` name. */
    readonly fits: FitCalls<FitRequest, FitResult>;
}

/**
 * The Roster's records on e3: the warehouse's module's package deployed once
 * for the file, with any other module the file mounts, and a workspace of its
 * own for each test.
 *
 * @param modules - Other e3-ui example modules the file mounts, by their keys under e3-ui's `test/` (`roster/roster-records`)
 * @returns The harness
 */
export function rosterHarness(modules: Parameters<typeof e3Harness>[0] = {}): RosterHarness {
    const h = e3Harness({ "roster/roster": ex, ...modules }, { main: "data-roster-main" });
    return Object.assign(h, { fits: fitCalls(h, { request: FitRequestType, result: Roster.Types.FitResult }) });
}

/**
 * The warehouse's Roster as `rosterWarehouse` mounts it — its duties, weeks,
 * cover targets and suggestions, its staff and agencies, its lists, its pay
 * and its check, its rail over the week's duties, the staff and the
 * activities, its library and its inspector — over the duties a test needs,
 * and asking the fit it needs: the warehouse's own duties, or the duties it
 * has locked, whose patch door refuses every change; the warehouse's own fit,
 * or the app's that warns past contract.
 *
 * @param options - Whether its duties are the locked ones, and which fit it asks
 * @returns The example
 */
export function warehouseRoster(options: { readonly locked?: boolean; readonly fit?: "warehouse" | "contract" } = {}): Example {
    const locked = options.locked === true, contract = options.fit === "contract";
    return { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        // The duties a test needs, the warehouse's own or its locked ones, each read a week at a time through its interval index.
        const rota = $.let(locked ? Record.bind(ex.rosterLockedDuties, [ex.rosterLockedDutiesPatch]) : Record.bind(ex.rosterDuties, [ex.rosterDutiesPatch]));
        const entries = $.let(locked ? Data.bindPaged(ex.rosterLockedDuties) : Data.bindPaged(ex.rosterDuties));
        const weeks = $.let(Record.bind(ex.rosterWeeks, [ex.rosterWeeksPatch]));
        const cover = $.let(Record.bind(ex.rosterCover, [ex.rosterCoverPatch]));
        const people = $.let(Data.bind(ex.rosterStaff));
        const acts = $.let(Data.bind(ex.rosterActivities));
        const staffIndex = $.let(Data.bindPaged(ex.rosterStaff, { indexes: [ex.rosterStaffByTeamName, ex.rosterStaffByPosition, ex.rosterStaffByTrainer, ex.rosterStaffByAgency, ex.rosterStaffBySkill, ex.rosterStaffByName] }));
        const actIndex = $.let(Data.bindPaged(ex.rosterActivities, { indexes: [ex.rosterActivitiesByGroup] }));
        const narrowing = {
            people: { source: staffIndex, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"],
                fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, position: { label: "Position", hints: ["lead", "deputy", "acting", "crew"] },
                    trainer: { label: "Trainer" }, agency: { label: "Agency" }, skills: { label: "Skill" }, name: { label: "Name" } } },
            activities: { source: actIndex, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group", hints: ["inbound", "picking", "dispatch", null] } } },
        } as const;
        const presets = { presets: [{ id: "leads", name: "Leads", where: { people: { position: ["lead", "deputy", "acting"] } } }] };
        const slice = $.let(locked
            ? Slice.bindRecords("test.warehouseRoster", { duty: { source: Data.bindPaged(ex.rosterLockedDuties, { indexes: [ex.rosterLockedDutiesByTime] }), range: "start" }, ...narrowing }, presets)
            : Slice.bindRecords("test.warehouseRoster", { duty: { source: Data.bindPaged(ex.rosterDuties, { indexes: [ex.rosterDutiesByTime] }), range: "start" }, ...narrowing }, presets));
        const firms = $.let(Data.bind(ex.rosterAgencies));
        const times = $.let(Data.bind(ex.rosterShiftTimes));
        const teams = $.let(Data.bind(ex.rosterTeams));
        const roles = $.let(Data.bind(ex.rosterPositions));
        const ideas = $.let(Data.bind(ex.rosterSuggestions));
        const rateRows = $.let(Data.bind(ex.rosterPayRates));
        const rates = $.const(rateRows.read());
        const fit = $.let(contract ? Func.bind(ex.rosterContractFit) : Func.bind(ex.rosterStaffFit));
        // The warehouse's pay, as its example writes it: ordinary time to the contract, OT1 past it, an agency at its rate.
        const pay = $.const(East.function([Roster.Types.PayRequest(ex.WarehouseDuty)], Roster.Types.Pay, ($2, req) => {
            const out = $2.let(new Map(), Roster.Types.Pay);
            const zero = $2.const(0.0, FloatType);
            const agency = $2.let(true, BooleanType);
            const hours = $2.let(0.0, FloatType);
            $2.match(req.who, { person: ($3, key) => {
                $3.if(req.context.people.has(key), ($4) => {
                    const person = $4.const(req.context.people.get(key));
                    $4.assign(agency, person.agency);
                    $4.assign(hours, person.contract);
                });
            } });
            const worked = $2.let(0.0, FloatType);
            const ordered = $2.const(req.duties.toArray(($3, duty, key) => ({ key, duty })).sort(($3, d) => d.duty.start));
            $2.for(ordered, ($3, d) => {
                const costs = $3.let(new Map(), DictType(StringType, FloatType));
                $3.if(agency, ($4) => {
                    $4(costs.insert("AGENCY", d.duty.hours.multiply(rates.get("AGENCY", () => 0.0))));
                }).else(($4) => {
                    const ordinary = $4.const(East.max(East.min(d.duty.hours, hours.subtract(worked)), zero));
                    const over = $4.const(d.duty.hours.subtract(ordinary));
                    $4(costs.insert("ORD", ordinary.multiply(rates.get("ORD", () => 0.0))));
                    $4.if(East.greater(over, 0.0), ($5) => { $5(costs.insert("OT1", over.multiply(rates.get("OT1", () => 0.0)))); });
                });
                $3.assign(worked, worked.add(d.duty.hours));
                $3(out.insert(d.key, costs));
            });
            return out;
        }));
        const check = $.const(East.function([Roster.Types.CheckContext(ex.WarehouseDuty)], ArrayType(Roster.Types.Issue), ($2, cx) => {
            const issues = $2.let([], ArrayType(Roster.Types.Issue));
            $2.for(cx.week.assignments, ($3, a, id) => {
                const costs = $3.const(cx.pay.get(id, () => East.value(new Map(), DictType(StringType, FloatType))));
                $3.if(costs.has("OT1").and(() => East.notEqual(a.row.agreed, some(true))), ($4) => {
                    $4(issues.pushLast({ kind: variant("breach", null), tone: variant("info", null),
                        title: "Overtime not agreed", detail: East.str`${a.row.team} · ${a.row.shift}`,
                        slot: some(a.slot), assignment: some(id), flag: some("OT"), fix: none }));
                });
            });
            return issues;
        }));
        return Roster({
            id: "warehouseRoster", slice: { slice }, fit, pay, currency: "AUD", check, inspector: true,
            week: { start: "sunday" }, view: { layout: "shifts", period: "day", date: at("2028-03-09T00:00:00") },
            events: { duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock", entries,
                start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", position: "role", activity: "task",
                hours: d => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
                fields: { unpaidBreak: Schedule.field.number({ label: "Unpaid break", unit: "min", step: 15.0, min: 0.0 }),
                    costCentre: Schedule.field.text({ label: "Cost centre" }), note: Schedule.field.text({ label: "Note" }) },
            }) },
            resources: {
                people: Schedule.resources(people.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team,
                    position: p => p.position, skills: p => p.skills, contract: p => p.contract, agency: p => p.agency,
                    trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual }),
                agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
            },
            periods: Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed" }),
            targets: Roster.targets(cover, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" }),
            shifts: Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order }),
            groups: Roster.groups(teams.read(), { label: t => t.label, order: t => t.order }),
            positions: Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order }),
            activities: Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order }),
            proposals: Roster.proposals(ideas.read(), { person: s => s.person, day: s => s.day, group: s => s.team, shift: s => s.shift, reason: s => s.why }),
            rules: { rest: 10.0 },
            library: [Roster.library.people(), Roster.library.activities(), Roster.library.tab(roles.read(), {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code),
                drop: (_p, key) => Schedule.patch(ex.WarehouseDuty, { role: key }),
            })],
        });
    }))) };
}

export const assignment = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-roster-assignment="${id}"]`)!;
export const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-roster-card="${id}"]`)!;

const byString = compareFor(StringType);
const byDate = compareFor(DateTimeType);

/**
 * The warehouse's duties of a week, as its record holds them: each one whose
 * start falls in the week, by key. Every seeded duty starts its shift on its
 * own day, so its start is in the week its day is in.
 *
 * @param duties - The duties record, read whole
 * @param start - The week's first day
 * @returns The week's duties, by key
 */
export function weekDuties(duties: ReadonlyMap<string, Duty>, start: Date): Map<string, Duty> {
    const end = weekAfter(start);
    return new Map([...duties].filter(([, duty]) => byDate(duty.start, start) >= 0 && byDate(duty.start, end) < 0)
        .sort(([a], [b]) => byString(a, b)));
}
/** The first day of the week after a week's, by East's own arithmetic. */
const weekAfter = East.compile(East.function([DateTimeType], DateTimeType, (_$, start) => start.addDays(7n)), []);

/** A source's narrowing: each field's choice, as the rail writes it. */
export type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];
/** One field's choice. */
export type Choice = Where extends Map<string, infer C> ? C : never;
/**
 * An example mounted over a store of its own, where each source's narrowing is kept.
 *
 * @param example - The example
 * @param options - A program in its place, where its sessions are kept
 * @returns Its container, its store and its unmount
 */
export async function open(example: Example, options: MountOptions = {}) {
    const store = new UIStore(); StateRuntime.initializeStore(store);
    const mounted = await currentHarness().mount(example, options);
    return { container: mounted.container, store, unmount: mounted.unmount };
}
/**
 * A source's narrowing written whole, as the rail writes it: any choices one index answers.
 *
 * @param store - The example's store
 * @param example - The example's name (`rosterWarehouse`)
 * @param source - The source (`people`)
 * @param where - Each field's choice
 */
export async function narrow(store: UIStore, example: string, source: "people" | "activities" | "patterns", where: Where) {
    const key = `ex.${example}.${source}`;
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}
/** A source's narrowing as the store keeps it. */
export const narrowing = (store: UIStore, example: string, source: "people" | "activities" | "patterns"): Where =>
    decodeBeast2For(RecordSliceStateType)(store.read(`ex.${example}.${source}`)!).where;

/**
 * Presses a control, and settles.
 *
 * @param node - The control
 * @throws {Error} When there is no control to press
 */
export async function press(node: Element | null | undefined): Promise<void> {
    if (node === null || node === undefined) throw new Error("there is no control to press");
    await act(async () => { fireEvent.click(node); });
    await settle();
}
/** The history item's control in the toolbar, by its words: Save, Undo, Redo, Discard, Publish. */
export const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")).getByRole("button", { name });
/** A slot's text, as the grid's cells carry it. */
const slotText = printFor(Roster.Types.Slot);
/**
 * A slot's cell on the board.
 *
 * @param c - What the example rendered into
 * @param day - The day of the week, from zero
 * @param group - The group's key
 * @param shift - The shift's key
 * @returns Its cell
 * @throws {Error} When the board draws no such cell
 */
export function cell(c: HTMLElement, day: number, group: string, shift: string): HTMLElement {
    const key = slotText({ day: BigInt(day), group, shift });
    const found = [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-slot]")].find(el => el.getAttribute("data-roster-slot") === key);
    if (found === undefined) throw new Error(`the board draws no cell for ${key}`);
    return found;
}
/**
 * A card of the open Library tab, found by its tab's search.
 *
 * @param c - What the example rendered into
 * @param name - What the card's text holds
 * @returns The card
 * @throws {Error} When the tab shows no such card
 */
export async function libraryCard(c: HTMLElement, name: string): Promise<HTMLElement> {
    const search = within(slot(c, "start")).getByRole("textbox", { name: "Search library" });
    await act(async () => { fireEvent.change(search, { target: { value: name } }); });
    await settle();
    const found = [...slot(c, "start").querySelectorAll<HTMLElement>("[data-library-item]")].find(el => el.textContent?.includes(name));
    if (found === undefined) throw new Error(`the Library shows no card of ${name}`);
    return found;
}
/** Starts a pointer drag of one element and rests it over another, settling at each step. */
export async function hover(from: Element, into: Element): Promise<void> {
    await act(async () => { pointAt(from); fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 0 }); pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 }); });
    await settle();
    await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); });
    await settle();
}
/** Lets the drag go where it rests. */
export async function release(): Promise<void> {
    await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); });
    await settle();
}
/** Drags one element onto another. */
export async function drop(from: Element, into: Element): Promise<void> { await hover(from, into); await release(); }
