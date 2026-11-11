/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Where a Plan's Autosave begins is its author's (`autosave`, ruled 11 Nov
 * 2026), on e3 itself: a Plan that says nothing begins off, and one given
 * `autosave` begins on — the switch in Save's menu of its one history, with
 * nothing kept for the viewer.
 */

import { describe, expect, test } from "vitest";
import { East } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { planHarness, settle, slot } from "./harness.test-utils.js";

const h = planHarness();
const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");

/** The print works' jobs on its presses, as a Plan whose author says where its Autosave begins — or says nothing. */
const works = (autosave: boolean | undefined) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
    const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
    return Plan({
        axis,
        resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.hall }) },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", draw: "span", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
            }),
        },
        ...(autosave === undefined ? {} : { autosave }),
    });
}))) });

/** Whether Save's chevron says the Plan's changes are saved by themselves. */
const autosaves = (container: HTMLElement) => slot(container, "toolbar")!.querySelector<HTMLElement>("[data-history-autosave]")!.hasAttribute("data-on");

describe("where a Plan's Autosave begins is its author's (`autosave`)", () => {
    test("said nothing, it begins off", async () => {
        const { container } = await h.mount(works(undefined), { storageKey: "plan-autosave-silent" });
        await settle();
        expect(autosaves(container)).toBe(false);
    });

    test("given `autosave`, it begins on", async () => {
        const { container } = await h.mount(works(true), { storageKey: "plan-autosave-on" });
        await settle();
        expect(autosaves(container)).toBe(true);
    });
});
