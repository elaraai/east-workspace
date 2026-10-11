/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Calendar specialization of the shared record-backed builder harness. */
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { builderHarness, mount as mountBuilder } from "../shared/builder-harness.test-utils.js";
import { eventKey } from "./model.js";
import "./index.js";
export { act, settle, slot, width, programOf } from "../shared/builder-harness.test-utils.js";
export const WORKSPACE = "calendar-test";
export const RECORDS = [ex.calendarMachines, ex.calendarPeople, ex.calendarJobs, ex.calendarServices, ex.calendarShifts,
    ex.calendarJobTemplates, ex.calendarServiceTemplates, ex.calendarShiftTemplates, ex.calendarAppointments];
export const calendarHarness = () => builderHarness(WORKSPACE, RECORDS, "data-calendar-main");
export const mount = (example: Parameters<typeof mountBuilder>[0], storageKey = "calendar-test") => mountBuilder(example, storageKey);
export const event = (container: HTMLElement, kind: string, key: string) => container.querySelector<HTMLElement>(`[data-calendar-event=${JSON.stringify(eventKey({ kind, key }))}]`)!;
export const card = (container: HTMLElement, kind: string, key: string) => container.querySelector<HTMLElement>(`[data-calendar-card=${JSON.stringify(eventKey({ kind, key }))}]`)!;
