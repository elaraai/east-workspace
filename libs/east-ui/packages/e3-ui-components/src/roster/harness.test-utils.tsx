/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's examples on e3 itself (#1376): the warehouse's module deployed
 * to e3-web (`roster/roster`), each test a workspace of its own. The staff and
 * the activities are read a window at a time through their indexes, as e3
 * serves them; the weeks whole, or a week at a time, as an example binds them;
 * and every Save and Publish is a real commit through the weeks' patch door.
 * Another session's edit of the staff, the configuration or the proposals goes
 * in through their own doors (`h.patch`). The fit a Find fix asks is an
 * example's own `e3.function`, called by name on e3
 * (`shared/func/fit-calls.test-utils.ts`): what the Roster asked is its calls'
 * bodies, what e3 answered a tap's, and a fit held or failed a fault at the
 * harness's fetch. What a test counts it reads from the request log
 * (`h.requests`).
 *
 * Each test runs alone (#1280, `test-runs.test-utils.ts`): a test file takes
 * `act` from here, never from Testing Library.
 *
 * @packageDocumentation
 */

import { East, decodeBeast2For, encodeBeast2For, none, type ValueTypeOf } from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import { Data, Func, Record, Roster } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, currentHarness, e3Harness, settle, type E3Harness, type Example, type MountOptions } from "../e3-web-mount.test-utils.js";
import { fitCalls, type FitCalls } from "../shared/func/fit-calls.test-utils.js";
import "./index.js";
export { act, programOf, settle, slot, width } from "../e3-web-mount.test-utils.js";
export { searched } from "../e3-web.test-utils.js";

/** The warehouse's week, the one its examples open on. */
export const START = new Date("2028-03-05T00:00:00Z");
/** The week after it, which the weeks record does not hold. */
export const NEXT = new Date("2028-03-12T00:00:00Z");

/** A question to the Roster's fit, and its answer, decoded. */
export type FitRequest = ValueTypeOf<typeof Roster.Types.FitRequest>;
export type FitResult = ValueTypeOf<typeof Roster.Types.FitResult>;

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
    return Object.assign(h, { fits: fitCalls(h, { request: Roster.Types.FitRequest, result: Roster.Types.FitResult }) });
}

/**
 * The warehouse's Roster as `rosterWarehouse` mounts it — its staff,
 * configuration, forecast, proposals and activities, its rail over the staff
 * and the activities, its library and its inspector — over the weeks a test
 * needs, and asking the fit it needs: the warehouse's own weeks, or the weeks
 * it has locked, whose patch door refuses every change; the warehouse's own
 * fit, or the app's that warns past contract.
 *
 * @param options - Whether its weeks are the locked ones, and which fit it asks
 * @returns The example
 */
export function warehouseRoster(options: { readonly locked?: boolean; readonly fit?: "warehouse" | "contract" } = {}): Example {
    const locked = options.locked === true, contract = options.fit === "contract";
    return { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const weeks = $.let(locked ? Record.bind(ex.rosterLockedWeeks, [ex.rosterLockedWeeksPatch]) : Record.bind(ex.rosterWeeks, [ex.rosterWeeksPatch]));
        const staff = $.let(Data.bind(ex.rosterStaff));
        const configuration = $.let(Data.bind(ex.rosterConfiguration));
        const forecast = $.let(Data.bind(ex.rosterForecast));
        const proposals = $.let(Data.bind(ex.rosterProposals));
        const cfg = $.const(configuration.read());
        const acts = $.let(Data.bind(ex.rosterActivities));
        const people = $.let(Data.bindPaged(ex.rosterStaff, { indexes: [ex.rosterStaffByTeamName, ex.rosterStaffByPosition, ex.rosterStaffByTrainer, ex.rosterStaffByAgency, ex.rosterStaffBySkill, ex.rosterStaffByName] }));
        const activities = $.let(Data.bindPaged(ex.rosterActivities, { indexes: [ex.rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("test.warehouseRoster", {
            people: { source: people, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"],
                fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, position: { label: "Position", hints: ["lead", "deputy", "acting", "crew"] },
                    trainer: { label: "Trainer" }, agency: { label: "Agency" }, skills: { label: "Skill" }, name: { label: "Name" } } },
            activities: { source: activities, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group", hints: ["inbound", "picking", "dispatch", null] } } },
        }, { presets: [{ id: "leads", name: "Leads", where: { people: { position: ["lead", "deputy", "acting"] } } }] }));
        const fit = $.let(contract ? Func.bind(ex.rosterContractFit) : Func.bind(ex.rosterStaffFit));
        return Roster({
            id: "warehouseRoster", weeks, slice: { slice }, fit,
            people: Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual }),
            groups: cfg.groups, shifts: cfg.shifts,
            activities: Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order }),
            positions: cfg.positions.toArray((_$2, p) => p), agencies: cfg.agencies,
            rules: cfg.rules, costs: cfg.costs, forecast: forecast.read(), proposals: proposals.read(),
            week: { start: "sunday" }, view: { layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") },
            library: [Roster.library.people(), Roster.library.activities()], inspector: true,
        });
    }))) };
}

export const assignment = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-roster-assignment="${id}"]`)!;
export const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-roster-card="${id}"]`)!;

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
export async function narrow(store: UIStore, example: string, source: "people" | "activities", where: Where) {
    const key = `ex.${example}.${source}`;
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}
/** A source's narrowing as the store keeps it. */
export const narrowing = (store: UIStore, example: string, source: "people" | "activities"): Where =>
    decodeBeast2For(RecordSliceStateType)(store.read(`ex.${example}.${source}`)!).where;
