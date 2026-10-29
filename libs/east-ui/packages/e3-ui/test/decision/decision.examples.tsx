/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The DecisionQueue's examples (#1447, `Decision Queue Spec.md` §3.2, §3.3,
 * §15): the smallest queue — a record of the model's proposals, each one
 * decision with no alternatives, whose change lands in the shop's work orders,
 * which the Sheet draws, or in the price list, which no builder draws — the
 * same queue read only, and the full queue over the models' cases, every kind
 * of decision landing in the builder that draws its record. Each pins `now`, so
 * its sections stand as the example shows them whatever the day.
 */
import { BooleanType, DictType, East, FloatType, NullType, OptionType, StringType, example, none, some, variant } from "@elaraai/east";
import { Box, Fields, Format, Reactive, Slice, State, UIComponentType } from "@elaraai/east-ui";
import { Calendar, Data, DecisionQueue, Record, Roster, Schedule, Sheet } from "@elaraai/e3-ui";
import { kilnBins, kilnBinsByTime, kilnBinsPatch, kilns, yardBays } from "../allocation/allocation.examples.js";
import { calendarJobs, calendarJobsPatch, calendarMachines, calendarServices, calendarServicesPatch } from "../calendar/calendar.examples.js";
import { planEventJobs, planEventJobsPatch, planPrintPresses } from "../plan/plan-events.examples.js";
import {
    rosterAgencies, rosterDuties, rosterDutiesByTime, rosterDutiesPatch, rosterPayRates, rosterShiftTimes, rosterStaff, rosterTeams,
} from "../roster/roster.examples.js";
import { WarehouseDuty } from "../roster/warehouse.js";
import { OptimiseWorkOrder, optimiseWorkOrders, optimiseWorkOrdersPatch } from "../sheet/optimise.examples.js";
import {
    listPrices, listPricesPatch, opsCases, opsCasesByArea, opsCasesByScope, opsVerdicts, opsVerdictsPatch, proposalVerdicts,
    proposalVerdictsPatch, proposals,
} from "./ops.js";

// The example app's records (§3.1) and the records its cases change — the warehouse rota's, the print shop's, the
// workshop's, the kiln yard's and the shop's work orders — for the renderer's specs on e3 and the showcase's package of
// this area.
export * from "./ops.js";
export { kilnBins, kilnBinsByTime, kilnBinsPatch, kilns, yardBays } from "../allocation/allocation.examples.js";
export { calendarJobs, calendarJobsPatch, calendarMachines, calendarServices, calendarServicesPatch } from "../calendar/calendar.examples.js";
export { planEventJobs, planEventJobsPatch, planPrintPresses } from "../plan/plan-events.examples.js";
export {
    rosterAgencies, rosterDuties, rosterDutiesByTime, rosterDutiesPatch, rosterPayRates, rosterShiftTimes, rosterStaff, rosterTeams,
} from "../roster/roster.examples.js";
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

export const decisionQueueOps = example({
    inputs: [],
    description: "The full decision queue (§3.3): one record of the models' cases, every kind of decision in it, narrowed by a rail over its indexes. An option's change is a variant whose tag says where it lands — the warehouse rota's duties drawn as the Roster draws them, by people (`rota`) and by what they cost (`rotaCost`), the print shop's jobs as the Plan draws them, the workshop's machine maintenance as the Calendar does, beside the machines' jobs, the kiln yard's bins as the Allocation does, the shop's work orders as the Sheet does, and the price list, a record no builder draws, in a form of its own. Each target takes the same consts the builder's own tag takes — the duty kind, the people, the shifts, the warehouse's pay — so the card's preview draws the change as that builder would, Modify edits a row in the builder's own form, and Apply drafts the change through each record's patch door beside the verdict, one step of one history. The verdicts take every role — the option chosen, the answer to the case's question, an override's reason and a note — each case's figures print as money or as a count, and the host follows the open case with `onSelect`.",
    keywords: ["DecisionQueue", "DecisionQueue.decisions", "DecisionQueue.verdicts", "DecisionQueue.change.roster", "DecisionQueue.change.plan", "DecisionQueue.change.calendar", "DecisionQueue.change.allocation", "DecisionQueue.change.sheet", "DecisionQueue.change.record", "options", "recommended", "routine", "format", "ifWrong", "confidence", "question", "warn", "refused", "knockOn", "guesses", "map", "cost", "pay", "Slice.bindRecords", "Data.bindPaged", "Record.bind", "State.bind", "onSelect", "Fields.number", "Format.Currency", "now"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // The models' cases, narrowed by the rail, and the verdicts the queue writes.
        const cases = $.let(Data.bindPaged(opsCases));
        const indexed = $.let(Data.bindPaged(opsCases, { indexes: [opsCasesByArea, opsCasesByScope] }));
        const slice = $.let(Slice.bindRecords("ex.decisionQueueOps", {
            decisions: { source: indexed, icon: { prefix: "fas", name: "inbox" }, search: ["scope"],
                fields: { area: { label: "Area", hints: ["rota", "print", "workshop", "yard", "orders", "pricing"] }, scope: { label: "Scope" } } },
        }));
        const verdicts = $.let(Record.bind(opsVerdicts, [opsVerdictsPatch]));
        const verdictEntries = $.let(Data.bindPaged(opsVerdicts));
        // The host's: the case open in the queue, which it follows.
        const open = $.let(State.bind([OptionType(StringType)], "ex.decisionQueueOps.open", none));
        const follow = $.const(East.function([OptionType(StringType)], NullType, ($2, key) => { $2(open.write(key)); }));

        // The records the cases change, and the kinds and lists their builders take: the same consts the app's own
        // <Roster>, <Plan>, <Calendar>, <Allocation> and <Sheet> are handed.

        // The Roster's, as `rosterOptimise` gives them, and the warehouse's pay.
        const duties = $.let(Record.bind(rosterDuties, [rosterDutiesPatch]));
        const dutyEntries = $.let(Data.bindPaged(rosterDuties));
        const dutyWeek = $.let(Data.bindPaged(rosterDuties, { indexes: [rosterDutiesByTime] }));
        const staff = $.let(Data.bind(rosterStaff));
        const firms = $.let(Data.bind(rosterAgencies));
        const times = $.let(Data.bind(rosterShiftTimes));
        const teams = $.let(Data.bind(rosterTeams));
        const rateRows = $.let(Data.bind(rosterPayRates));
        const rates = $.const(rateRows.read());
        const duty = Schedule.events(duties, {
            name: "Duty", icon: "user-clock", entries: dutyEntries,
            start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
            shift: "shift", group: "team", position: "role", activity: "task",
            hours: d => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
        });
        const people = Schedule.resources(staff.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team, contract: p => p.contract });
        const agencies = Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name });
        const shifts = Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order, color: s => s.colour });
        const groups = Roster.groups(teams.read(), { label: t => t.label, order: t => t.order });
        // The warehouse's pay in its own codes, as `rosterWarehouse` builds it for its <Roster pay={pay}>: ordinary time to
        // the contract, OT1 past it, an agency's hours at its rate.
        const pay = $.const(East.function([Roster.Types.PayRequest(WarehouseDuty)], Roster.Types.Pay, ($2, req) => {
            const out = $2.let(new Map(), Roster.Types.Pay);
            const zero = $2.const(0.0, FloatType);
            const agency = $2.let(true, BooleanType);
            const contract = $2.let(0.0, FloatType);
            $2.match(req.who, { person: ($3, key) => {
                $3.if(req.context.people.has(key), ($4) => {
                    const person = $4.const(req.context.people.get(key));
                    $4.assign(agency, person.agency);
                    $4.assign(contract, person.contract);
                });
            } });
            const worked = $2.let(0.0, FloatType);
            // The week's duties in time order, so the contract's hours run out where they do.
            const ordered = $2.const(req.duties.toArray(($3, row, key) => ({ key, duty: row })).sort(($3, d) => d.duty.start));
            $2.for(ordered, ($3, d) => {
                const costs = $3.let(new Map(), DictType(StringType, FloatType));
                $3.if(agency, ($4) => {
                    $4(costs.insert("AGENCY", d.duty.hours.multiply(rates.get("AGENCY", () => 0.0))));
                }).else(($4) => {
                    const ordinary = $4.const(East.max(East.min(d.duty.hours, contract.subtract(worked)), zero));
                    const over = $4.const(d.duty.hours.subtract(ordinary));
                    $4(costs.insert("ORD", ordinary.multiply(rates.get("ORD", () => 0.0))));
                    $4.if(East.greater(over, 0.0), ($5) => { $5(costs.insert("OT1", over.multiply(rates.get("OT1", () => 0.0)))); });
                });
                $3.assign(worked, worked.add(d.duty.hours));
                $3(out.insert(d.key, costs));
            });
            return out;
        }));

        // The Plan's, as `planOptimise` gives them.
        const jobs = $.let(Record.bind(planEventJobs, [planEventJobsPatch]));
        const presses = $.let(Data.bind(planPrintPresses));
        const job = Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
            resource: { field: "press", of: "presses" }, state: "state" });
        const pressRows = Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name, group: p => p.hall });

        // The Calendar's, as `calendarOptimise` gives them; the Allocation's, as `allocationOptimise` does.
        const machineJobs = $.let(Record.bind(calendarJobs, [calendarJobsPatch]));
        const machines = $.let(Data.bind(calendarMachines));
        const machineJob = Calendar.events(machineJobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end",
            resource: { field: "machine", of: "machines" } });
        const services = $.let(Record.bind(calendarServices, [calendarServicesPatch]));
        const service = Calendar.events(services, { name: "Maintenance", icon: "screwdriver-wrench", title: "title", start: "start", end: "end",
            resource: { field: "machine", of: "machines" } });
        const machineRows = Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: m => m.name });
        const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
        const binEntries = $.let(Data.bindPaged(kilnBins));
        const yardDayBins = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));
        const bays = $.let(Data.bind(yardBays));
        const kilnList = $.let(Data.bind(kilns));
        const bin = Schedule.events(bins, { name: "Bin", icon: "box", entries: binEntries, at: "at", resource: { field: "bay", of: "bays" },
            arrival: "load", quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec" });
        const bayRows = Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset });
        const kilnRows = Schedule.resources(kilnList.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
            min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges });

        // The Sheet's work orders, as `sheetOptimise` binds them, and the price list.
        const workOrders = $.let(Record.bind(optimiseWorkOrders, [optimiseWorkOrdersPatch]));
        const priceList = $.let(Record.bind(listPrices, [listPricesPatch]));

        // Where each kind of decision draws: a target for each tag of the options' change.
        const rotaChange = DecisionQueue.change.roster({ name: "Roster", icon: "users",
            events: { duty }, resources: { people, agencies }, shifts, groups, week: { start: "sunday" }, source: dutyWeek });
        const rotaCostChange = DecisionQueue.change.roster({ name: "Roster", icon: "users", map: "cost", pay, currency: "USD",
            events: { duty }, resources: { people, agencies }, shifts, groups, week: { start: "sunday" }, source: dutyWeek });
        const printChange = DecisionQueue.change.plan({ name: "Plan", icon: "bars-progress", events: { job }, resources: { presses: pressRows } });
        // The maintenance the tags patch, named by `event`, beside the jobs its days' overlaps count.
        const workshopChange = DecisionQueue.change.calendar({ name: "Calendar", icon: "calendar-days",
            events: { job: machineJob, service }, event: "service", resources: { machines: machineRows } });
        const yardChange = DecisionQueue.change.allocation({ name: "Allocation", icon: "fire-flame-curved",
            events: { bin }, resources: { bays: bayRows, kilns: kilnRows }, source: yardDayBins });
        const orderChange = DecisionQueue.change.sheet(workOrders, { name: "Sheet", icon: "table-cells", columns: {
            reference: Sheet.column.text(OptimiseWorkOrder, { header: "Reference", width: "96px" }),
            status: Sheet.column.text(OptimiseWorkOrder, { header: "Status" }),
            due: Sheet.column.date(OptimiseWorkOrder, { header: "Due", width: "96px" }),
        } });
        const pricingChange = DecisionQueue.change.record(priceList, { name: "Pricing", icon: "tag", label: r => r.region,
            fields: { price: Fields.number({ label: "List price", unit: "$ / unit", min: 10.0, max: 12.5, step: 0.05, help: "In 5¢ steps" }) } });

        return <Box height="760px">
            <DecisionQueue
                id="opsQueue"
                slice={{ slice }}
                now={new Date("2028-03-08T15:00:00Z")}
                decisions={DecisionQueue.decisions(cases, {
                    scope: c => c.scope, due: c => c.due, routine: c => c.routine, unit: c => c.unit, model: c => c.model,
                    why: c => c.why, ifWrong: c => c.ifWrong, recommended: c => c.recommended,
                    // Money in dollars, a count as it is.
                    format: c => c.money.ifElse(() => some(Format.Currency({ currency: "USD", compact: "short" })), () => none),
                    options: { from: c => c.options, label: o => o.label, title: o => o.title, summary: o => o.summary,
                        detail: o => o.detail, note: o => o.note, value: o => o.value, confidence: o => o.confidence,
                        question: o => o.question, warn: o => o.warn, refused: o => o.refused, knockOn: o => o.knockOn,
                        guesses: o => o.guesses,
                        change: { from: o => o.change, of: {
                            rota: rotaChange, rotaCost: rotaCostChange, print: printChange, workshop: workshopChange,
                            yard: yardChange, orders: orderChange, pricing: pricingChange,
                        } } },
                })}
                verdicts={DecisionQueue.verdicts(verdicts, {
                    entries: verdictEntries,
                    verdict: { field: "verdict", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" },
                    option: "option",
                    answer: { field: "answer", yes: "yes", no: "no", unsure: "unsure" },
                    reason: { field: "reason", context: "context", data: "data", priorities: "priorities", other: "other" },
                    note: "note",
                })}
                onSelect={follow}
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
