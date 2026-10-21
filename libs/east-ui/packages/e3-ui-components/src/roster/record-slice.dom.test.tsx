/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { decodeBeast2For, encodeBeast2For, none, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/roster/roster-records";
import { act, assignment, open, press, rosterHarness, settle, slot, START, weekDuties, width } from "./harness.test-utils.js";

// The indexed examples read the warehouse's activities, cover targets and suggestions beside their own records.
const h = rosterHarness({ "roster/roster-records": ex });
/** The indexed staff's, weeks' and duties' records, as the request log names their datasets. */
const STAFF = "records.indexed_roster_staff", WEEKS = "records.indexed_roster_weeks", DUTIES = "records.indexed_roster_duties";

test("indexed staff visibility replaces atomically without narrowing coverage, and hidden edits Save the original duty on mobile", async () => {
    const { container, store, unmount } = await open(ex.rosterRecordIndexes);
    await waitFor(() => expect(assignment(container, "s37")).not.toBeNull());
    await settle();
    // The rail opens on Inbound: the staff are read through their group-then-name index.
    expect(h.requests(undefined, STAFF).some(request => request.query.get("index") === ex.rosterStaffByTeam.name)).toBe(true);
    const marks = () => [...slot(container, "main").querySelectorAll('[role="img"][aria-label]')].map(el => el.getAttribute("aria-label"));
    await act(async () => { fireEvent.click(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" })); });
    await settle();
    const coverage = marks();
    const drafted = assignment(container, "s37");
    expect(drafted.hasAttribute("data-removed")).toBe(true);
    const key = "ex.rosterRecordIndexes.people";
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    // The staff's key searches held on their way to e3: the new narrowing stays pending.
    const searching = h.e3.hold(request => request.kind === "find" && request.dataset === STAFF);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, where: new Map([["name", variant("prefix", "Z. Nobody")]]), preset: none })); });
    await settle();
    expect(assignment(container, "s37")).toBe(drafted);
    expect(slot(container, "main").querySelector("[data-roster-main]")?.hasAttribute("inert") ?? slot(container, "main").hasAttribute("inert")).toBe(true);
    await act(async () => { searching.release(); });
    await waitFor(() => expect(assignment(container, "s37")).toBeNull());
    expect(marks()).toEqual(coverage);
    unmount();
    const again = await h.mount(ex.rosterRecordIndexes); await width(390);
    const save = within(slot(again.container, "toolbar")).getByRole("button", { name: "Save" });
    expect(save).toHaveProperty("disabled", false);
    // Save runs to its end — the narrowing's notice read, the commit, and its confirmation — and leaves nothing to save.
    await press(save);
    expect(within(slot(again.container, "toolbar")).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    const committed = await h.read(ex.indexedRosterDuties);
    expect(committed.has("s37")).toBe(false);
    expect(weekDuties(committed, START).size).toBe(315);
    // A year of duties and of weeks, and neither read whole.
    expect([h.requests("read", WEEKS), h.requests("read", DUTIES)]).toEqual([[], []]);
});
