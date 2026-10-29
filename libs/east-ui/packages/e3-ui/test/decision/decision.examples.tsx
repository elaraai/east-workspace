/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The DecisionQueue's examples (#1447, `Decision Queue Spec.md` §3.2, §15):
 * the smallest queue — a record of the model's proposals, each one decision
 * with no alternatives, whose change lands in the shop's work orders, which the
 * Sheet draws, or in the price list, which no builder draws — and the same
 * queue read only. Each pins `now`, so its sections stand as the example shows
 * them whatever the day.
 */
import { East, example } from "@elaraai/east";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, DecisionQueue, Record, Sheet } from "@elaraai/e3-ui";
import { OptimiseWorkOrder, optimiseWorkOrders, optimiseWorkOrdersPatch } from "../sheet/optimise.examples.js";
import { listPrices, listPricesPatch, proposalVerdicts, proposalVerdictsPatch, proposals } from "./ops.js";

// The example app's records (§3.1) and the shop's work orders the proposals change, for the renderer's specs on e3 and
// the showcase's package of this area.
export * from "./ops.js";
export { OptimiseWorkOrder, optimiseWorkOrderRows, optimiseWorkOrders, optimiseWorkOrdersPatch } from "../sheet/optimise.examples.js";

export const decisionQueueMinimal = example({
    inputs: [],
    description: "The smallest decision queue (§3.2): one record of the model's proposals, each its own one decision with no alternatives, read whole with Data.bind — every role an East function naming which of the app's own fields fills which part of the card. A proposal's `details` is a variant: its tag the kind of decision, its value a patch of the record that kind changes — `orders` the shop's work orders, drawn as the Sheet draws them, `pricing` the price list, a record no builder draws. Apply drafts the change into its record and the verdict into the app's verdicts record, one step of one history; Save writes each through its patch door.",
    keywords: ["DecisionQueue", "DecisionQueue.decisions", "DecisionQueue.verdicts", "DecisionQueue.change.sheet", "DecisionQueue.change.record", "proposals", "verdicts", "Data.bind", "Data.bindPaged", "Record.bind", "Sheet.column.text", "Sheet.column.date", "now"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const cases = $.let(Data.bind(proposals));
        const verdicts = $.let(Record.bind(proposalVerdicts, [proposalVerdictsPatch]));
        const verdictEntries = $.let(Data.bindPaged(proposalVerdicts));
        // The records the proposals change, each with its patch door.
        const workOrders = $.let(Record.bind(optimiseWorkOrders, [optimiseWorkOrdersPatch]));
        const priceList = $.let(Record.bind(listPrices, [listPricesPatch]));
        return <Box height="640px">
            <DecisionQueue
                id="proposals"
                now={new Date("2028-03-08T15:00:00Z")}
                decisions={DecisionQueue.decisions(cases, {
                    // Each role: the part of the card on the left, an East function reading it from the proposal on the right.
                    scope: p => p.site, due: p => p.deadline, unit: p => p.metric, model: p => p.run, why: p => p.rationale,
                    // No `options`: each proposal is its own one option, the option's roles read from the proposal (D15).
                    title: p => p.headline, summary: p => p.brief, detail: p => p.description, value: p => p.saving,
                    change: { from: p => p.details, of: {
                        orders: DecisionQueue.change.sheet(workOrders, { name: "Sheet", icon: "table-cells", columns: {
                            reference: Sheet.column.text(OptimiseWorkOrder, { header: "Reference" }),
                            status: Sheet.column.text(OptimiseWorkOrder, { header: "Status" }),
                            due: Sheet.column.date(OptimiseWorkOrder, { header: "Due" }),
                        } }),
                        pricing: DecisionQueue.change.record(priceList, { name: "Pricing", icon: "tag", label: r => r.region }),
                    } },
                })}
                verdicts={DecisionQueue.verdicts(verdicts, {
                    entries: verdictEntries,
                    verdict: { field: "verdict", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" },
                })}
            />
        </Box>;
    }}</Reactive>),
});

export const decisionQueueReadOnly = example({
    inputs: [],
    description: "The smallest decision queue read only (§4, R22): under `readOnly` a card opens and shows all of it — the change, Why, the figures — and takes no choice, no answer and no action; the toolbar holds no history item. The records are bound as for the editable queue, the verdicts with their patch door, which nothing writes through.",
    keywords: ["DecisionQueue", "readOnly", "read only", "DecisionQueue.decisions", "DecisionQueue.verdicts", "DecisionQueue.change.sheet", "DecisionQueue.change.record", "Data.bind", "Record.bind", "now"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const cases = $.let(Data.bind(proposals));
        const verdicts = $.let(Record.bind(proposalVerdicts, [proposalVerdictsPatch]));
        const verdictEntries = $.let(Data.bindPaged(proposalVerdicts));
        const workOrders = $.let(Record.bind(optimiseWorkOrders, [optimiseWorkOrdersPatch]));
        const priceList = $.let(Record.bind(listPrices, [listPricesPatch]));
        return <Box height="640px">
            <DecisionQueue
                id="proposalsReadOnly"
                readOnly
                now={new Date("2028-03-08T15:00:00Z")}
                decisions={DecisionQueue.decisions(cases, {
                    scope: p => p.site, due: p => p.deadline, unit: p => p.metric, model: p => p.run, why: p => p.rationale,
                    title: p => p.headline, summary: p => p.brief, detail: p => p.description, value: p => p.saving,
                    change: { from: p => p.details, of: {
                        orders: DecisionQueue.change.sheet(workOrders, { name: "Sheet", icon: "table-cells", columns: {
                            reference: Sheet.column.text(OptimiseWorkOrder, { header: "Reference" }),
                            status: Sheet.column.text(OptimiseWorkOrder, { header: "Status" }),
                            due: Sheet.column.date(OptimiseWorkOrder, { header: "Due" }),
                        } }),
                        pricing: DecisionQueue.change.record(priceList, { name: "Pricing", icon: "tag", label: r => r.region }),
                    } },
                })}
                verdicts={DecisionQueue.verdicts(verdicts, {
                    entries: verdictEntries,
                    verdict: { field: "verdict", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" },
                })}
            />
        </Box>;
    }}</Reactive>),
});
