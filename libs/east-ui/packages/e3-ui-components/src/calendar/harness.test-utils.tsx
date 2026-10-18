/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Calendar specialization of the shared record-backed builder harness. */
import { afterEach, beforeEach } from "vitest";
import { decodeBeast2For, encodeBeast2For, none, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { clearPagedApi, initializePagedApi, initializeRecordApi, type PagedApi } from "../platform/index.js";
import { countWholeReads, recordPaging, servedIndex, type WholeReads } from "../platform/record-paging.test-utils.js";
import { act, builderHarness, mount as mountBuilder, settle } from "../shared/builder-harness.test-utils.js";
import { eventKey } from "./model.js";
import "./index.js";
export { act, settle, slot, width, programOf } from "../shared/builder-harness.test-utils.js";
export const WORKSPACE = "calendar-test";
export const RECORDS = [ex.calendarMachines, ex.calendarPeople, ex.calendarJobs, ex.calendarServices, ex.calendarShifts,
    ex.calendarJobTemplates, ex.calendarServiceTemplates, ex.calendarShiftTemplates, ex.calendarAppointments];
/** Each record the examples page, with every index they read it through (#1343). */
const PAGED = [
    { record: ex.calendarJobs, indexes: [ex.calendarJobsByTime, ex.calendarJobsByStatusTime, ex.calendarJobsByMachineTime, ex.calendarJobsByDay, ex.calendarJobsUnscheduled] },
    { record: ex.calendarServices, indexes: [ex.calendarServicesByTime, ex.calendarServicesByMachineTime] },
    { record: ex.calendarShifts, indexes: [ex.calendarShiftsByTime, ex.calendarShiftsByPersonTime] },
    { record: ex.calendarMachines, indexes: [ex.calendarMachinesByArea] },
    { record: ex.calendarPeople, indexes: [ex.calendarPeopleByTeam] },
    { record: ex.calendarJobTemplates, indexes: [ex.calendarJobTemplatesByGroup] },
    { record: ex.calendarServiceTemplates, indexes: [ex.calendarServiceTemplatesByGroup] },
    { record: ex.calendarShiftTemplates, indexes: [ex.calendarShiftTemplatesByGroup] },
] as const;

/**
 * The Calendar's records under the shared builder harness, each one the
 * examples page read a window at a time through the stand-in paging service,
 * as e3 serves it, with every index they declare; `paging.reads` counts what
 * is read whole, and `paging.requests` names each request.
 */
export function calendarHarness() {
    const h = builderHarness(WORKSPACE, RECORDS, "data-calendar-main");
    const paging = {} as { reads: WholeReads; requests: string[]; api: PagedApi };
    beforeEach(() => {
        paging.reads = countWholeReads(h.cache);
        initializeRecordApi(paging.reads.serve(h.memory), h.cache, WORKSPACE);
        const service = recordPaging(h.cache, paging.reads.raw, PAGED.map(({ record, indexes }) => ({ path: record.path, type: record.type, indexes: indexes.map(servedIndex) })));
        paging.requests = service.requests;
        paging.api = service.api;
        initializePagedApi(service.api, WORKSPACE);
    });
    afterEach(() => { clearPagedApi(); });
    return Object.assign(h, { paging });
}
export const mount = (example: Parameters<typeof mountBuilder>[0], storageKey = "calendar-test") => mountBuilder(example, storageKey);
export const event = (container: HTMLElement, kind: string, key: string) => container.querySelector<HTMLElement>(`[data-calendar-event=${JSON.stringify(eventKey({ kind, key }))}]`)!;
export const card = (container: HTMLElement, kind: string, key: string) => container.querySelector<HTMLElement>(`[data-calendar-card=${JSON.stringify(eventKey({ kind, key }))}]`)!;

/** A source's narrowing: each field's choice, as the rail writes it. */
export type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];
/**
 * An example mounted over a store of its own, where each source's narrowing is kept.
 *
 * @param example - The example
 * @param storageKey - Where its view and sessions are kept
 * @returns Its container, its store and its unmount
 */
export async function open(example: Parameters<typeof mountBuilder>[0], storageKey = "calendar-test") {
    const store = new UIStore(); StateRuntime.initializeStore(store);
    const mounted = mount(example, storageKey); await settle();
    return { container: mounted.container, store, unmount: mounted.unmount };
}
/**
 * A source's narrowing as the store keeps it.
 *
 * @param store - The example's store
 * @param example - The example's name (`calendarOperations`)
 * @param source - The source (`job`)
 * @returns Each field's choice
 */
export const narrowing = (store: UIStore, example: string, source: string): Where =>
    decodeBeast2For(RecordSliceStateType)(store.read(`ex.${example}.${source}`)!).where;
/**
 * A source's narrowing written whole, as the rail writes it.
 *
 * @param store - The example's store
 * @param example - The example's name
 * @param source - The source
 * @param where - Each field's choice
 */
export async function narrow(store: UIStore, example: string, source: string, where: Where) {
    const key = `ex.${example}.${source}`;
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}
