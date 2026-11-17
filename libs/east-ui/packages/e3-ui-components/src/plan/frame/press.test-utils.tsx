/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The press tasks' Plan as the tests of an event kind's `child` mount it
 * (#1541, U1): the works' machines read whole, each press with the kinds of
 * task it takes as rows beneath it, and the tasks' one event kind landing on
 * those rows — by its press and its kind — in its half's lane, with its
 * inspector.
 */

import { East, printFor, variant } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";

/** The tasks' four weeks, a day a bucket. */
const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");

const printKind = printFor(ex.PressTaskKind);

/**
 * A kind of task as its row's path ends in it: the kind's key as East prints it.
 *
 * @param kind - The kind's case
 * @returns The path's last step
 */
export const pressKindStep = (kind: keyof typeof ex.PressTaskKind.cases): string => printKind(variant(kind, null));

/** What a test asks of the press tasks' Plan. */
export interface PressPlanOptions {
    /** Whether a press's own row is drawn; left out, it is. */
    pressRow?: boolean;
}

/**
 * The press tasks' Plan, with its inspector.
 *
 * @param options - Whether a press's own row is drawn
 * @returns The program, for the harness's `mount`
 */
export function pressPlan({ pressRow = true }: PressPlanOptions = {}) {
    return { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const machines = $.let(Record.bind(ex.planPressMachines, []));
        const tasks = $.let(Record.bind(ex.planPressTaskRows));
        const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
        // A row per kind of task a press takes, each day in AM and PM lanes, in this order: the rows the tasks land on.
        const kindRows = Plan.series.resources(ex.PressTaskKindRow, {
            key: "kinds", title: "Tasks", icon: "list-check", keyType: ex.PressTaskKind, label: (kind) => kind.name,
            lanes: () => [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm", label: "PM" })],
        });
        return Plan({
            id: "machines",
            axis,
            data: machines.read(),
            series: [Plan.series.kinds(ex.PressMachine, "what", {
                // Beneath a press, the kinds of task it takes: its own child rows.
                press: pressRow
                    ? { title: "Presses", icon: "print", label: (press) => press.name, children: Plan.children("kinds", [kindRows]) }
                    : { title: "Presses", icon: "print", row: false, children: Plan.children("kinds", [kindRows]) },
                folder: { title: "Folders", icon: "layer-group", label: (folder) => folder.name },
            })],
            events: {
                task: Schedule.events(tasks, {
                    name: "Press task", icon: "list-check", draw: "buckets", title: "title", at: "day", state: "state",
                    resource: { field: "press", of: "press" },
                    child: { field: "kind", of: "kinds" },
                    lane: "half",
                }),
            },
            inspector: true,
        });
    }))), inputs: [] as [] };
}
