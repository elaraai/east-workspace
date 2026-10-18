/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { afterEach, beforeEach } from "vitest";
import { East, decodeBeast2For, encodeBeast2For, none, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { clearPagedApi, initializePagedApi, initializeRecordApi, type PagedApi } from "../platform/index.js";
import { countWholeReads, pathText, recordPaging, type WholeReads } from "../platform/record-paging.test-utils.js";
import { act, builderHarness, mount, settle } from "../shared/builder-harness.test-utils.js";
import "./index.js";
export { act, mount, programOf, settle, slot, width } from "../shared/builder-harness.test-utils.js";
export const WORKSPACE = "roster-test";
export const START = new Date("2028-03-05T00:00:00Z");
export const NEXT = new Date("2028-03-12T00:00:00Z");

/** Each index served as e3 serves it: its own key function over each entry, a Set field fanning out. */
type Index = { name: string; keyType: Parameters<typeof recordPaging>[2][number]["indexes"] extends readonly (infer I)[] | undefined ? I extends { keyType: infer K } ? K : never : never; keyFn: unknown; multi: boolean };
const served = (index: Index) => {
    const keys = East.compile(index.keyFn as never, []) as (key: unknown, row: unknown) => unknown;
    return { name: index.name, keyType: index.keyType, keys: (key: unknown, row: unknown) => index.multi ? keys(key, row) as Iterable<unknown> : [keys(key, row)] };
};

/**
 * The warehouse's records under the shared builder harness, the staff and the
 * activities read a window at a time through the stand-in paging service as e3
 * serves them — the staff with their group-then-name, position, trainer,
 * agency, skill and name indexes, the activities with their group index — and
 * the weeks with none; `paging.failing` names the records whose reads fail,
 * and `paging.api` is the service a test may wrap.
 */
export function rosterHarness() {
    const h = builderHarness(WORKSPACE, [ex.rosterWeeks, ex.rosterStaff, ex.rosterActivities, ex.rosterConfiguration, ex.rosterForecast, ex.rosterProposals], "data-roster-main");
    const paging = { failing: new Set<string>() } as { reads: WholeReads; requests: string[]; failing: Set<string>; api: PagedApi };
    beforeEach(() => {
        paging.reads = countWholeReads(h.cache);
        initializeRecordApi(paging.reads.serve(h.memory), h.cache, WORKSPACE);
        const service = recordPaging(h.cache, paging.reads.raw, [
            { path: ex.rosterWeeks.path, type: ex.rosterWeeks.type },
            { path: ex.rosterStaff.path, type: ex.rosterStaff.type, indexes: [ex.rosterStaffByTeamName, ex.rosterStaffByPosition, ex.rosterStaffByTrainer,
                ex.rosterStaffByAgency, ex.rosterStaffBySkill, ex.rosterStaffByName].map(index => served(index as Index)) },
            { path: ex.rosterActivities.path, type: ex.rosterActivities.type, indexes: [served(ex.rosterActivitiesByGroup as Index)] },
        ]);
        paging.requests = service.requests;
        paging.failing.clear();
        const fails = (path: Parameters<typeof service.api.getPage>[1]) => {
            if (paging.failing.has(pathText(path))) throw new Error(`${pathText(path)} is unavailable`);
        };
        paging.api = { ...service.api,
            getPage: async (workspace, path, window) => { fails(path); return service.api.getPage(workspace, path, window); },
            findKey: async (workspace, path, query) => { fails(path); return service.api.findKey(workspace, path, query); },
        };
        initializePagedApi(paging.api, WORKSPACE);
    });
    afterEach(() => { clearPagedApi(); });
    return Object.assign(h, { paging });
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
 * @returns Its container, its store and its unmount
 */
export async function open(example: { fn: { toIR(): unknown } }) {
    const store = new UIStore(); StateRuntime.initializeStore(store);
    const mounted = mount(example); await settle();
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
