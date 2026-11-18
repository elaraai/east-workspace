/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * An event its kind's `locked` holds where it is (#1541, U9), on a Calendar:
 * the lock is the kind's own rule, which the shared recorder of every
 * builder's gestures holds to — no gesture changes or removes the event,
 * whichever builder draws it.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { East } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Calendar, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { act, calendarHarness, event, settle } from "./harness.test-utils.js";

const h = calendarHarness();

/** The conflicts example's jobs on their machines, the first job held where it is by its key. */
const locked = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const machines = $.let(Record.bind(ex.calendarMachines, []));
    const jobs = $.let(Record.bind(ex.calendarConflictJobs, ["patch"]));
    return Calendar({
        id: "locked", view: { period: "week", date: new Date("2026-10-01T00:00:00Z") }, now: new Date("2026-10-01T10:15:00Z"),
        resources: { machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: (row) => row.name }) },
        events: { job: Calendar.events(jobs, {
            name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
            locked: (_job, key) => key.equal("job1"),
        }) },
    });
}))) };

/** Presses a key on an element and settles. */
async function key(at: HTMLElement, name: string) {
    await act(async () => { fireEvent.keyDown(at, { key: name }); });
    await settle();
}

test("Delete leaves an event its kind's `locked` holds where it is, and e3 holds it still; an event the rule lets go is removed", async () => {
    const { container: c } = await h.open(locked);
    await waitFor(() => expect(event(c, "job", "job1")).not.toBeNull());
    await settle();
    await key(event(c, "job", "job1"), "Enter");
    await key(event(c, "job", "job1"), "Delete");
    // Held where it is: drawn still.
    expect(event(c, "job", "job1")).not.toBeNull();
    // The second job, which the rule does not hold, goes.
    await key(event(c, "job", "job2"), "Enter");
    await key(event(c, "job", "job2"), "Delete");
    expect(event(c, "job", "job2")).toBeNull();
    expect(event(c, "job", "job1")).not.toBeNull();
});
