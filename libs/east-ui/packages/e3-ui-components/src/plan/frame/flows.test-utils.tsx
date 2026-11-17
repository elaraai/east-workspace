/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Example 16's Plan as the link kinds' tests mount it (#1541, U10): the works'
 * centres, their four event kinds and the flows between them — a link kind
 * over a record — with its inspector, and the Plan's own `canConnect` where a
 * test gives one.
 */

import { East, OptionType, StringType, type ExprType, type FunctionType } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";

/** The works' four weeks. */
const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");

/** A Plan's veto over the link a Connect would draw. */
export type FlowsCanConnect = ExprType<FunctionType<[typeof Plan.Types.ConnectCandidate], OptionType<StringType>>>;

/**
 * Example 16's Plan, with its inspector.
 *
 * @param canConnect - The Plan's veto over a connection, built inside the Plan's own block; left out, none
 * @returns The program, for the harness's `mount`
 */
export function flowsPlan(canConnect?: () => FlowsCanConnect) {
    return { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const works = $.let(Record.bind(ex.planLinkWorks, []));
        const plates = $.let(Record.bind(ex.planLinkPlates));
        const jobs = $.let(Record.bind(ex.planLinkCaseJobs));
        const bindings = $.let(Record.bind(ex.planLinkBindings));
        const deliveries = $.let(Record.bind(ex.planLinkDeliveries));
        const links = $.let(Record.bind(ex.planLinkFlows));
        const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "week" }));
        return Plan({
            axis,
            data: works.read(),
            series: [
                Plan.series.resources(ex.PrintLinkCentre, { key: "setters", title: "Plate room", icon: "layer-group", match: (c) => c.what.hasTag("setter"), label: (c) => c.name }),
                Plan.series.resources(ex.PrintLinkCentre, { key: "presses", title: "Presses", icon: "print", match: (c) => c.what.hasTag("press"), label: (c) => c.name }),
                Plan.series.resources(ex.PrintLinkCentre, { key: "lines", title: "Bindery", icon: "book", match: (c) => c.what.hasTag("line"), label: (c) => c.name }),
                Plan.series.resources(ex.PrintLinkCentre, { key: "bays", title: "Dispatch", icon: "warehouse", match: (c) => c.what.hasTag("bay"), label: (c) => c.name }),
            ],
            events: {
                plate: Schedule.events(plates, { name: "Plates", icon: "clone", title: "title", at: "at", resource: { field: "setter", of: "setters" } }),
                job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                binding: Schedule.events(bindings, { name: "Bindery job", icon: "book-open", draw: "cards", title: "title", start: "start", end: "end", resource: { field: "line", of: "lines" } }),
                delivery: Schedule.events(deliveries, { name: "Delivery", icon: "truck", draw: "buckets", title: "title", at: "at", resource: { field: "bay", of: "bays" } }),
            },
            links: {
                flow: Plan.links(links, {
                    name: "Flow", icon: "arrow-right-long",
                    from: { field: "from", of: { plate: "plate", job: "job", binding: "binding" } },
                    to: { field: "to", of: { job: "job", binding: "binding", delivery: "delivery" } },
                    quantity: { field: "sheets", unit: "k sheets" },
                }),
            },
            ...(canConnect === undefined ? {} : { canConnect: $.const(canConnect()) }),
            inspector: true,
        });
    }))) };
}
