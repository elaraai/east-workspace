/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { DateTimeType, East, NullType, StringType, equalFor, some, variant } from "@elaraai/east";
import { SliceBindPrimitives } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { clearPagedApi, initializePagedApi, initializeRecordApi } from "../platform/index.js";
import { countWholeReads, recordPaging } from "../platform/record-paging.test-utils.js";
import { act, assignment, mount, NEXT, rosterHarness, settle, slot, START, WORKSPACE } from "./harness.test-utils.js";
const h = rosterHarness();
const platforms = getRegisteredPlatformImplementations();
const search = East.compile(East.function([StringType], NullType, ($, text) => { $(SliceBindPrimitives.setSearch("ex.rosterWarehouse.scope", some(text))); }), platforms);
const range = East.compile(East.function([DateTimeType, DateTimeType], NullType, ($, from, to) => { $(SliceBindPrimitives.setRange("ex.rosterWindowed.weeks", some(variant("datetime", { from, to })))); }), platforms);
const readRange = East.compile(East.function([], DateTimeType, _$ => SliceBindPrimitives.read("ex.rosterWindowed.weeks").range.unwrap("some").unwrap("datetime").from), platforms);
afterEach(() => clearPagedApi());
test("external staff Slice and toolbar share the original keys without narrowing coverage", async () => {
    const { container } = mount(ex.rosterWarehouse); await settle();
    const total = [...slot(container, "main").querySelectorAll('[role="img"][aria-label]')].map(e => e.getAttribute('aria-label'));
    await act(async () => { search("Clover"); }); await settle();
    expect(within(slot(container, "toolbar")).getByPlaceholderText("Search…")).toHaveProperty("value", "Clover");
    expect(assignment(container, "s37")).not.toBeNull();
    expect(container.querySelectorAll('[data-roster-assignment]:not([data-request])')).toHaveLength(1);
    expect([...slot(container, "main").querySelectorAll('[role="img"][aria-label]')].map(e => e.getAttribute('aria-label'))).toEqual(total);
});
test("the author-bound range and week navigation seek the same keys without whole-record reads", async () => {
    const reads = countWholeReads(h.cache); initializeRecordApi(reads.serve(h.memory), h.cache, WORKSPACE);
    const service = recordPaging(h.cache, reads.raw, [{ path: [variant("field", "records"), variant("field", ex.rosterWeeks.name)], type: ex.rosterWeeks.type }]);
    initializePagedApi(service.api, WORKSPACE);
    const { container } = mount(ex.rosterWindowed); await settle();
    expect(service.requests.some(r => r.includes('seek 2028-03-12'))).toBe(true);
    await act(async () => { range(START, new Date("2028-03-11T23:59:59.999Z")); }); await settle();
    expect(service.requests.some(r => r.includes('seek 2028-03-05'))).toBe(true);
    expect(container.querySelector('[data-roster-status]')?.textContent).toBe('Draft');
    await act(async () => { fireEvent.keyDown(slot(container, 'main'), { key: ']' }); }); await settle();
    expect(equalFor(DateTimeType)(readRange(), NEXT)).toBe(true);
    expect(reads.paths.filter(p => p === 'records.roster_weeks')).toEqual([]);
});
