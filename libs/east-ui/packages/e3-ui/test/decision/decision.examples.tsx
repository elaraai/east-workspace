/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The DecisionQueue's examples (#1447, `Decision Queue Spec.md` §3.2, §3.3,
 * §11, §15): the smallest queue — a record of the model's proposals, each one
 * decision with no alternatives, whose change lands in the shop's work orders,
 * which the Sheet draws, or in the price list, which no builder draws — the
 * same queue read only, the full queue over the models' cases, every kind of
 * decision landing in the builder or the form that draws its record, the same
 * queue in a phone-width frame, the Routine band and its batch, a queue over
 * 20,000 cases read through the rail's indexes, and the previews gallery, a
 * case for each preview a builder draws and each of the Plan's marks. Each
 * pins `now` — 13:00 on Tuesday 10 March 2026, the mock's, but for the
 * gallery's own — so its sections stand as the example shows them whatever
 * the day.
 */
import { BooleanType, DictType, East, FloatType, FunctionType, NullType, OptionType, StringType, example, none, some, variant } from "@elaraai/east";
import { Box, Field, Fields, Format, Reactive, Slice, State, Style, UIComponentType, VStack } from "@elaraai/east-ui";
import { Allocation, Calendar, Data, DecisionQueue, Record, Roster, Schedule, Sheet } from "@elaraai/e3-ui";
import { arrivals, kilnBins, kilns, yardBays } from "../allocation/allocation.examples.js";
import { CalendarService, calendarJobs, calendarMachines, calendarServices } from "../calendar/calendar.examples.js";
import { planEventJobs, planPrintJobs, planPrintPresses } from "../plan/plan-events.examples.js";
import { rosterAgencies, rosterCover, rosterDuties, rosterPayRates, rosterShiftTimes, rosterStaff, rosterTeams } from "../roster/roster.examples.js";
import { WarehouseDuty } from "../roster/warehouse.js";
import { OptimiseWorkOrder, optimiseWorkOrders } from "../sheet/optimise.examples.js";
import { cureSettings, listPrices, opsCases, opsVerdicts, pressReadiness, proposalVerdicts, proposals, routineVerdicts, routines, stockLevels } from "./ops.js";
import { PreviewOption, previewCases, previewVerdicts } from "./previews.js";
import { chainStock, reorderVerdicts, reorders } from "./reorders.js";
import { catalogue, serviceAreas, stockOrders, storeStock } from "./supply.js";

// The example app's records (§3.1) and the records its cases change — the warehouse rota's, the print shop's, the
// workshop's, the kiln yard's, the shop's work orders and the records no builder draws — the routine queue's, the
// windowed queue's, and the previews gallery's, for the renderer's specs on e3 and the showcase's package of this area.
export * from "./ops.js";
export * from "./previews.js";
export * from "./reorders.js";
export * from "./supply.js";
export { arrivals, kilnBins, kilns, yardBays } from "../allocation/allocation.examples.js";
export { calendarJobs, calendarMachines, calendarServices } from "../calendar/calendar.examples.js";
export { planEventJobs, planPrintJobs, planPrintPresses } from "../plan/plan-events.examples.js";
export { rosterAgencies, rosterCover, rosterDuties, rosterPayRates, rosterShiftTimes, rosterStaff, rosterTeams } from "../roster/roster.examples.js";
export { OptimiseWorkOrder, optimiseWorkOrderRows, optimiseWorkOrders } from "../sheet/optimise.examples.js";

export const decisionQueueMinimal = example({
    inputs: [],
    description: "The smallest decision queue (§3.2): one record of the model's proposals, each its own one decision with no alternatives, read whole with Data.bind — every role an East function naming which of the app's own fields fills which part of the card. A proposal's `details` is a variant: its tag the kind of decision, its value a patch of the record that kind changes — `orders` the shop's work orders, drawn as the Sheet draws them, `pricing` the price list, a record no builder draws. Apply drafts the change into its record and the verdict into the app's verdicts record, one step of one history; Save writes each through its patch door.",
    keywords: ["DecisionQueue", "DecisionQueue.decisions", "DecisionQueue.verdicts", "DecisionQueue.change.sheet", "DecisionQueue.change.record", "proposals", "verdicts", "Data.bind", "Data.bindPaged", "Record.bind", "Sheet.column.text", "Sheet.column.date", "now"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const cases = $.let(Data.bind(proposals));
        const verdicts = $.let(Record.bind(proposalVerdicts));
        const verdictEntries = $.let(Data.bindPaged(proposalVerdicts));
        // The records the proposals change, each with its patch door.
        const workOrders = $.let(Record.bind(optimiseWorkOrders));
        const priceList = $.let(Record.bind(listPrices));
        return <Box height="640px">
            <DecisionQueue
                id="proposals"
                now={new Date("2026-03-10T13:00:00Z")}
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
    description: "The full decision queue (§3.3): one record of the models' cases, every kind of decision in it, narrowed by a rail over its indexes — the mock's cases, like for like, at 13:00 on Tuesday 10 March 2026. An option's change is a variant whose tag says where it lands — the warehouse rota's duties drawn as the Roster draws them, by people (`rota`) and by what they cost (`rotaCost`), the print shop's jobs as the Plan draws them, the workshop's machine maintenance as the Calendar does, beside the machines' jobs, the kiln yard's bins as the Allocation does, its loads on their way its Waiting row, the shop's work orders as the Sheet does, and the records no builder draws, each in a form of its own: the price list, the stock levels, the lines' cure settings, the rota's cover targets and the presses' readiness. Each target takes the same consts the builder's own tag takes — the duty kind, the people, the shifts, the warehouse's pay — so the card's preview draws the change as that builder would, Modify edits each changed row in the builder's own form — the maintenance in its kind's own Details, its technician and its notes, as the Calendar's inspector shows them — the preview following each edit, and Apply drafts the change through each record's patch door beside the verdict, one step of one history. The price list's `ready`, the app's check that a list price moves in 5¢ steps, holds Apply while an edit leaves one that doesn't, in its own words. The routine cases wait in the band at the end, applied together. The verdicts take every role — the option chosen, the answer to the case's question, an override's reason and a note — each case's figures print as money or as a count, and the host follows the open case with `onSelect`.",
    keywords: ["DecisionQueue", "DecisionQueue.decisions", "DecisionQueue.verdicts", "DecisionQueue.change.roster", "DecisionQueue.change.plan", "DecisionQueue.change.calendar", "DecisionQueue.change.allocation", "Allocation.arrivals", "DecisionQueue.change.sheet", "DecisionQueue.change.record", "options", "recommended", "routine", "format", "ifWrong", "confidence", "question", "warn", "refused", "knockOn", "guesses", "map", "cost", "pay", "Modify", "fields", "ready", "inspector", "Field.StringInput", "Slice.bindRecords", "Data.bindPaged", "Record.bind", "State.bind", "onSelect", "Fields.number", "Format.Currency", "now"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // The models' cases, narrowed by the rail, and the verdicts the queue writes.
        const cases = $.let(Data.bindPaged(opsCases));
        const indexed = $.let(Data.bindPaged(opsCases, { indexes: ["ops_cases_by_area", "ops_cases_by_scope"] }));
        const slice = $.let(Slice.bindRecords("ex.decisionQueueOps", {
            decisions: { source: indexed, icon: { prefix: "fas", name: "inbox" }, search: ["scope"],
                fields: { area: { label: "Area", hints: ["rota", "print", "yard", "stock", "workshop", "pricing", "trial", "orders", "cover", "ready"] },
                    scope: { label: "Scope" } } },
        }));
        const verdicts = $.let(Record.bind(opsVerdicts));
        const verdictEntries = $.let(Data.bindPaged(opsVerdicts));
        // The host's: the case open in the queue, which it follows.
        const open = $.let(State.bind([OptionType(StringType)], "ex.decisionQueueOps.open", none));
        const follow = $.const(East.function([OptionType(StringType)], NullType, ($2, key) => { $2(open.write(key)); }));

        // The records the cases change, and the kinds and lists their builders take: the same consts the app's own
        // <Roster>, <Plan>, <Calendar>, <Allocation> and <Sheet> are handed.

        // The Roster's, as `rosterOptimise` gives them, and the warehouse's pay.
        const duties = $.let(Record.bind(rosterDuties));
        const dutyEntries = $.let(Data.bindPaged(rosterDuties));
        const dutyWeek = $.let(Data.bindPaged(rosterDuties, { indexes: ["roster_duties_by_time"] }));
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
        const jobs = $.let(Record.bind(planEventJobs));
        const presses = $.let(Data.bind(planPrintPresses));
        const job = Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
            resource: { field: "press", of: "presses" }, state: "state" });
        const pressRows = Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name, group: p => p.hall });

        // The Calendar's, as `calendarOptimise` gives them; the Allocation's, as `allocationOptimise` does.
        const machineJobs = $.let(Record.bind(calendarJobs));
        const machines = $.let(Data.bind(calendarMachines));
        const machineJob = Calendar.events(machineJobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end",
            resource: { field: "machine", of: "machines" } });
        const services = $.let(Record.bind(calendarServices));
        // The maintenance's own Details, which the Calendar's inspector and Modify show in place of the form over the
        // fields its roles leave: who does it and what to do, each written back over the row as it stands.
        const serviceDetails = $.const(East.function([CalendarService, FunctionType([CalendarService], NullType)], UIComponentType, ($2, row, update) => {
            const assign = $2.const(East.function([StringType], NullType, ($3, technician) => {
                $3(update({ title: row.title, start: row.start, end: row.end, machine: row.machine, technician, notes: row.notes }));
            }));
            const note = $2.const(East.function([StringType], NullType, ($3, notes) => {
                $3(update({ title: row.title, start: row.start, end: row.end, machine: row.machine, technician: row.technician, notes }));
            }));
            return <VStack gap="3" align="stretch">
                <Field.StringInput label="Technician" value={row.technician} onChange={assign} />
                <Field.StringInput label="Notes" value={row.notes} placeholder="What to do" onChange={note} />
            </VStack>;
        }));
        const service = Calendar.events(services, { name: "Maintenance", icon: "screwdriver-wrench", title: "title", start: "start", end: "end",
            resource: { field: "machine", of: "machines" }, inspector: serviceDetails });
        const machineRows = Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: m => m.name });
        const bins = $.let(Record.bind(kilnBins));
        const binEntries = $.let(Data.bindPaged(kilnBins));
        const yardDayBins = $.let(Data.bindPaged(kilnBins, { indexes: ["kiln_bins_by_time"] }));
        const bays = $.let(Data.bind(yardBays));
        const kilnList = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bin = Schedule.events(bins, { name: "Bin", icon: "box", entries: binEntries, at: "at", resource: { field: "bay", of: "bays" },
            arrival: "load", quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec" });
        const bayRows = Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset });
        const kilnRows = Schedule.resources(kilnList.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
            min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges });
        // The loads on their way, as `allocationKilnYard` gives them: a bin a change books takes its load off the Waiting row.
        const loadRows = Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays),
            kind: l => some(l.spec), due: l => some(l.due), window: l => some({ from: l.from, to: l.to }) });

        // The Sheet's work orders, as `sheetOptimise` binds them.
        const workOrders = $.let(Record.bind(optimiseWorkOrders));

        // The records no builder draws, each changed in a form of its own: the price list, the stock levels, the lines'
        // cure settings and the presses' readiness; and the rota's cover targets, which the Roster edits in its own.
        const priceList = $.let(Record.bind(listPrices));
        const stock = $.let(Record.bind(stockLevels));
        const cures = $.let(Record.bind(cureSettings));
        const cover = $.let(Record.bind(rosterCover));
        const readiness = $.let(Record.bind(pressReadiness));

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
            events: { bin }, resources: { bays: bayRows, kilns: kilnRows }, arrivals: loadRows, source: yardDayBins });
        const orderChange = DecisionQueue.change.sheet(workOrders, { name: "Sheet", icon: "table-cells", columns: {
            reference: Sheet.column.text(OptimiseWorkOrder, { header: "Reference", width: "96px" }),
            status: Sheet.column.text(OptimiseWorkOrder, { header: "Status" }),
            due: Sheet.column.date(OptimiseWorkOrder, { header: "Due", width: "96px" }),
        } });
        // The price list's form, and the app's check on a price Modify leaves, which holds Apply: a list price moves in 5¢ steps.
        const pricingChange = DecisionQueue.change.record(priceList, { name: "Pricing", icon: "tag", label: r => r.region,
            fields: {
                price: Fields.number({ label: "List price", unit: "$ / unit", min: 10.0, max: 12.5, step: 0.05, help: "In 5¢ steps" }),
                demand: Fields.number({ label: "Demand / wk", unit: "units" }),
            },
            ready: r => r.price.subtract(East.Float.roundNearest(r.price, 0.05)).abs().greater(0.000001).ifElse(
                () => variant("invalid", [{ field: "price", message: "A list price moves in 5¢ steps" }]), () => variant("ready", null)) });
        // The stock levels' form: the units on order and the risk of running out.
        const stockChange = DecisionQueue.change.record(stock, { name: "Inventory", icon: "boxes-stacked", label: s => s.item,
            fields: {
                onOrder: Fields.number({ label: "On order", unit: "units", min: 0.0 }),
                risk: Fields.number({ label: "Stock-out risk · wk 11", unit: "%", min: 0.0, max: 100.0 }),
            } });
        // The lines' cure settings: a cure time, the bond it gives, and the batches on trial.
        const trialChange = DecisionQueue.change.record(cures, { name: "Experiment", icon: "flask", label: c => c.line,
            fields: {
                cure: Fields.number({ label: "Cure time", unit: "min" }),
                bond: Fields.number({ label: "Bond strength", unit: "MPa" }),
                trialBatches: Fields.number({ label: "Batches on trial", min: 0n }),
            } });
        // The rota's cover targets: the heads a team's shift needs on a day.
        const coverChange = DecisionQueue.change.record(cover, { name: "Capacity", icon: "gauge-high", label: c => East.str`${c.team} · ${c.shift}`,
            fields: { heads: Fields.number({ label: "Heads", min: 0n }) } });
        // The presses' readiness: the days the forecast gives, and whether a person confirmed them.
        const readyChange = DecisionQueue.change.record(readiness, { name: "Forecast", icon: "chart-line", label: r => r.press,
            fields: { days: Fields.number({ label: "Days to ready", unit: "days", min: 0.0 }) } });

        return <Box height="760px">
            <DecisionQueue
                id="opsQueue"
                slice={{ slice }}
                now={new Date("2026-03-10T13:00:00Z")}
                decisions={DecisionQueue.decisions(cases, {
                    scope: c => c.scope, due: c => c.due, routine: c => c.routine, unit: c => c.unit, model: c => c.model,
                    why: c => c.why, ifWrong: c => c.ifWrong, recommended: c => c.recommended,
                    // Money in dollars, a count as it is.
                    format: c => c.figure.match({
                        money: () => some(Format.Currency({ currency: "USD", compact: "short" })),
                        count: () => none,
                    }),
                    options: { from: c => c.options, label: o => o.label, title: o => o.title, summary: o => o.summary,
                        detail: o => o.detail, note: o => o.note, value: o => o.value, confidence: o => o.confidence,
                        question: o => o.question, warn: o => o.warn, refused: o => o.refused, knockOn: o => o.knockOn,
                        guesses: o => o.guesses,
                        change: { from: o => o.change, of: {
                            rota: rotaChange, rotaCost: rotaCostChange, print: printChange, workshop: workshopChange,
                            yard: yardChange, orders: orderChange, pricing: pricingChange,
                            stock: stockChange, trial: trialChange, cover: coverChange, ready: readyChange,
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
        const verdicts = $.let(Record.bind(proposalVerdicts));
        const verdictEntries = $.let(Data.bindPaged(proposalVerdicts));
        const workOrders = $.let(Record.bind(optimiseWorkOrders));
        const priceList = $.let(Record.bind(listPrices));
        return <Box height="640px">
            <DecisionQueue
                id="proposalsReadOnly"
                readOnly
                now={new Date("2026-03-10T13:00:00Z")}
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

export const decisionQueueRecordIndexes = example({
    inputs: [],
    description: "A queue over 20,000 cases (D4): a replenishment model's reorders across forty stores, an item at a store each and each its own one proposal (D15), read a page at a time through the rail's one source — Data.bindPaged over the record's indexes on the store and the range. Unnarrowed, the reorders are past the queue's 1,000, and its banner says how many and to narrow; choose a store and its 500 show, sectioned by when each is due. The verdicts are read by key, the keys of the cases read, never whole, and the stock rows a reorder changes are read by key through their entries, never the 20,000 whole. A verdict drafted on a case the rail then hides is kept by its key, and Save writes it.",
    keywords: ["DecisionQueue", "Slice.bindRecords", "decisions", "source", "Data.bindPaged", "indexes", "paging", "windowed", "banner", "entries", "by key", "DecisionQueue.change.record", "Fields.number", "Format.Currency", "now"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // The reorders, read a page at a time through the rail's one source over their indexes.
        const cases = $.let(Data.bindPaged(reorders));
        const slice = $.let(Slice.bindRecords("ex.decisionQueueRecordIndexes", {
            decisions: { source: Data.bindPaged(reorders, { indexes: ["reorders_by_store_range", "reorders_by_range"] }), icon: { prefix: "fas", name: "inbox" },
                fields: { store: { label: "Store" }, range: { label: "Range", hints: ["Envelopes", "Labels", "Folders", "Notebooks", "Cards"] } } },
        }));
        // The verdicts the queue writes, read by key beside their patch door.
        const verdicts = $.let(Record.bind(reorderVerdicts));
        const verdictEntries = $.let(Data.bindPaged(reorderVerdicts));
        // The chain's stock levels, which the reorders change: read by key through their entries.
        const stock = $.let(Record.bind(chainStock));
        const stockEntries = $.let(Data.bindPaged(chainStock));
        return <Box height="760px">
            <DecisionQueue
                id="reorders"
                slice={{ slice }}
                now={new Date("2026-03-10T13:00:00Z")}
                decisions={DecisionQueue.decisions(cases, {
                    scope: r => East.str`${r.store} · ${r.range}`, due: r => r.due, unit: () => "uplift", model: r => r.run, why: r => r.why,
                    format: () => some(Format.Currency({ currency: "USD", compact: "short" })),
                    title: r => r.title, summary: r => r.summary, detail: r => r.detail, value: r => r.uplift, confidence: r => some(r.confidence),
                    change: { from: r => r.change, of: {
                        stock: DecisionQueue.change.record(stock, { name: "Inventory", icon: "boxes-stacked", label: s => s.item, entries: stockEntries,
                            fields: {
                                onOrder: Fields.number({ label: "On order", unit: "units", min: 0.0 }),
                                risk: Fields.number({ label: "Stock-out risk", unit: "%", min: 0.0, max: 100.0 }),
                            } }),
                    } },
                })}
                verdicts={DecisionQueue.verdicts(verdicts, {
                    entries: verdictEntries,
                    verdict: { field: "verdict", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" },
                    note: "note",
                })}
            />
        </Box>;
    }}</Reactive>),
});

export const decisionQueuePhone = example({
    inputs: [],
    description: "The full queue of `decisionQueueOps` in a phone-width frame (§9.6, R30): the same records, rail and targets, its narrow layout following its own width, whatever holds it — the cards one under another, each opening in place with its preview drawn at the frame's width, its options, its question and its four answers, and the toolbar's rail and history item, Save among them.",
    keywords: ["DecisionQueue", "phone", "mobile", "narrow", "390px", "DecisionQueue.decisions", "DecisionQueue.verdicts", "DecisionQueue.change.roster", "DecisionQueue.change.plan", "DecisionQueue.change.calendar", "DecisionQueue.change.allocation", "DecisionQueue.change.sheet", "DecisionQueue.change.record", "Slice.bindRecords", "Data.bindPaged", "Record.bind", "State.bind", "onSelect", "now"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // The models' cases, narrowed by the rail, and the verdicts the queue writes.
        const cases = $.let(Data.bindPaged(opsCases));
        const indexed = $.let(Data.bindPaged(opsCases, { indexes: ["ops_cases_by_area", "ops_cases_by_scope"] }));
        const slice = $.let(Slice.bindRecords("ex.decisionQueuePhone", {
            decisions: { source: indexed, icon: { prefix: "fas", name: "inbox" }, search: ["scope"],
                fields: { area: { label: "Area", hints: ["rota", "print", "yard", "stock", "workshop", "pricing", "trial", "orders", "cover", "ready"] },
                    scope: { label: "Scope" } } },
        }));
        const verdicts = $.let(Record.bind(opsVerdicts));
        const verdictEntries = $.let(Data.bindPaged(opsVerdicts));
        // The host's: the case open in the queue, which it follows.
        const open = $.let(State.bind([OptionType(StringType)], "ex.decisionQueuePhone.open", none));
        const follow = $.const(East.function([OptionType(StringType)], NullType, ($2, key) => { $2(open.write(key)); }));

        // The Roster's, as `rosterOptimise` gives them, and the warehouse's pay.
        const duties = $.let(Record.bind(rosterDuties));
        const dutyEntries = $.let(Data.bindPaged(rosterDuties));
        const dutyWeek = $.let(Data.bindPaged(rosterDuties, { indexes: ["roster_duties_by_time"] }));
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
        // The warehouse's pay in its own codes: ordinary time to the contract, OT1 past it, an agency's hours at its rate.
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
        const jobs = $.let(Record.bind(planEventJobs));
        const presses = $.let(Data.bind(planPrintPresses));
        const job = Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
            resource: { field: "press", of: "presses" }, state: "state" });
        const pressRows = Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name, group: p => p.hall });

        // The Calendar's, as `calendarOptimise` gives them; the Allocation's, as `allocationOptimise` does.
        const machineJobs = $.let(Record.bind(calendarJobs));
        const machines = $.let(Data.bind(calendarMachines));
        const machineJob = Calendar.events(machineJobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end",
            resource: { field: "machine", of: "machines" } });
        const services = $.let(Record.bind(calendarServices));
        // The maintenance's own Details: who does it and what to do, each written back over the row as it stands.
        const serviceDetails = $.const(East.function([CalendarService, FunctionType([CalendarService], NullType)], UIComponentType, ($2, row, update) => {
            const assign = $2.const(East.function([StringType], NullType, ($3, technician) => {
                $3(update({ title: row.title, start: row.start, end: row.end, machine: row.machine, technician, notes: row.notes }));
            }));
            const note = $2.const(East.function([StringType], NullType, ($3, notes) => {
                $3(update({ title: row.title, start: row.start, end: row.end, machine: row.machine, technician: row.technician, notes }));
            }));
            return <VStack gap="3" align="stretch">
                <Field.StringInput label="Technician" value={row.technician} onChange={assign} />
                <Field.StringInput label="Notes" value={row.notes} placeholder="What to do" onChange={note} />
            </VStack>;
        }));
        const service = Calendar.events(services, { name: "Maintenance", icon: "screwdriver-wrench", title: "title", start: "start", end: "end",
            resource: { field: "machine", of: "machines" }, inspector: serviceDetails });
        const machineRows = Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: m => m.name });
        const bins = $.let(Record.bind(kilnBins));
        const binEntries = $.let(Data.bindPaged(kilnBins));
        const yardDayBins = $.let(Data.bindPaged(kilnBins, { indexes: ["kiln_bins_by_time"] }));
        const bays = $.let(Data.bind(yardBays));
        const kilnList = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bin = Schedule.events(bins, { name: "Bin", icon: "box", entries: binEntries, at: "at", resource: { field: "bay", of: "bays" },
            arrival: "load", quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec" });
        const bayRows = Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset });
        const kilnRows = Schedule.resources(kilnList.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
            min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges });
        const loadRows = Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays),
            kind: l => some(l.spec), due: l => some(l.due), window: l => some({ from: l.from, to: l.to }) });

        // The Sheet's work orders, as `sheetOptimise` binds them.
        const workOrders = $.let(Record.bind(optimiseWorkOrders));

        // The records no builder draws, each changed in a form of its own, and the rota's cover targets.
        const priceList = $.let(Record.bind(listPrices));
        const stock = $.let(Record.bind(stockLevels));
        const cures = $.let(Record.bind(cureSettings));
        const cover = $.let(Record.bind(rosterCover));
        const readiness = $.let(Record.bind(pressReadiness));

        // Where each kind of decision draws: a target for each tag of the options' change.
        const rotaChange = DecisionQueue.change.roster({ name: "Roster", icon: "users",
            events: { duty }, resources: { people, agencies }, shifts, groups, week: { start: "sunday" }, source: dutyWeek });
        const rotaCostChange = DecisionQueue.change.roster({ name: "Roster", icon: "users", map: "cost", pay, currency: "USD",
            events: { duty }, resources: { people, agencies }, shifts, groups, week: { start: "sunday" }, source: dutyWeek });
        const printChange = DecisionQueue.change.plan({ name: "Plan", icon: "bars-progress", events: { job }, resources: { presses: pressRows } });
        const workshopChange = DecisionQueue.change.calendar({ name: "Calendar", icon: "calendar-days",
            events: { job: machineJob, service }, event: "service", resources: { machines: machineRows } });
        const yardChange = DecisionQueue.change.allocation({ name: "Allocation", icon: "fire-flame-curved",
            events: { bin }, resources: { bays: bayRows, kilns: kilnRows }, arrivals: loadRows, source: yardDayBins });
        const orderChange = DecisionQueue.change.sheet(workOrders, { name: "Sheet", icon: "table-cells", columns: {
            reference: Sheet.column.text(OptimiseWorkOrder, { header: "Reference", width: "96px" }),
            status: Sheet.column.text(OptimiseWorkOrder, { header: "Status" }),
            due: Sheet.column.date(OptimiseWorkOrder, { header: "Due", width: "96px" }),
        } });
        const pricingChange = DecisionQueue.change.record(priceList, { name: "Pricing", icon: "tag", label: r => r.region,
            fields: {
                price: Fields.number({ label: "List price", unit: "$ / unit", min: 10.0, max: 12.5, step: 0.05, help: "In 5¢ steps" }),
                demand: Fields.number({ label: "Demand / wk", unit: "units" }),
            },
            ready: r => r.price.subtract(East.Float.roundNearest(r.price, 0.05)).abs().greater(0.000001).ifElse(
                () => variant("invalid", [{ field: "price", message: "A list price moves in 5¢ steps" }]), () => variant("ready", null)) });
        const stockChange = DecisionQueue.change.record(stock, { name: "Inventory", icon: "boxes-stacked", label: s => s.item,
            fields: {
                onOrder: Fields.number({ label: "On order", unit: "units", min: 0.0 }),
                risk: Fields.number({ label: "Stock-out risk · wk 11", unit: "%", min: 0.0, max: 100.0 }),
            } });
        const trialChange = DecisionQueue.change.record(cures, { name: "Experiment", icon: "flask", label: c => c.line,
            fields: {
                cure: Fields.number({ label: "Cure time", unit: "min" }),
                bond: Fields.number({ label: "Bond strength", unit: "MPa" }),
                trialBatches: Fields.number({ label: "Batches on trial", min: 0n }),
            } });
        const coverChange = DecisionQueue.change.record(cover, { name: "Capacity", icon: "gauge-high", label: c => East.str`${c.team} · ${c.shift}`,
            fields: { heads: Fields.number({ label: "Heads", min: 0n }) } });
        const readyChange = DecisionQueue.change.record(readiness, { name: "Forecast", icon: "chart-line", label: r => r.press,
            fields: { days: Fields.number({ label: "Days to ready", unit: "days", min: 0.0 }) } });

        // A phone's width: the frame's own, whatever the page around it.
        return <Box width="390px" maxWidth="100%" height="760px">
            <DecisionQueue
                id="opsQueuePhone"
                slice={{ slice }}
                now={new Date("2026-03-10T13:00:00Z")}
                decisions={DecisionQueue.decisions(cases, {
                    scope: c => c.scope, due: c => c.due, routine: c => c.routine, unit: c => c.unit, model: c => c.model,
                    why: c => c.why, ifWrong: c => c.ifWrong, recommended: c => c.recommended,
                    format: c => c.figure.match({
                        money: () => some(Format.Currency({ currency: "USD", compact: "short" })),
                        count: () => none,
                    }),
                    options: { from: c => c.options, label: o => o.label, title: o => o.title, summary: o => o.summary,
                        detail: o => o.detail, note: o => o.note, value: o => o.value, confidence: o => o.confidence,
                        question: o => o.question, warn: o => o.warn, refused: o => o.refused, knockOn: o => o.knockOn,
                        guesses: o => o.guesses,
                        change: { from: o => o.change, of: {
                            rota: rotaChange, rotaCost: rotaCostChange, print: printChange, workshop: workshopChange,
                            yard: yardChange, orders: orderChange, pricing: pricingChange,
                            stock: stockChange, trial: trialChange, cover: coverChange, ready: readyChange,
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

export const decisionQueueRoutine = example({
    inputs: [],
    description: "The Routine band and its batch (D5, R28): a record of the models' routine changes, each its own one proposal (D15), and every one routine — `routine` an East function answering true whatever the row. The band at the queue's end holds them, folded under its count and Apply all, a row a case unfolded, each with where its change lands and what it is worth. Apply all is one step of the session over every case whose Apply is on: each change drafted into its record — the trimmed duties through the Roster's duty kind, the cover target and the press's readiness through their records' own — beside each verdict; its banner's Undo is the history's while the step is the last, and Save writes each record through its patch door.",
    keywords: ["DecisionQueue", "routine", "Routine band", "Apply all", "batch", "D15", "DecisionQueue.decisions", "DecisionQueue.verdicts", "DecisionQueue.change.roster", "DecisionQueue.change.record", "Fields.number", "Format.Currency", "Data.bind", "Record.bind", "now"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const cases = $.let(Data.bind(routines));
        const verdicts = $.let(Record.bind(routineVerdicts));
        const verdictEntries = $.let(Data.bindPaged(routineVerdicts));
        // The Roster's, as `rosterOptimise` gives them: where a trimmed duty is written.
        const duties = $.let(Record.bind(rosterDuties));
        const dutyEntries = $.let(Data.bindPaged(rosterDuties));
        const dutyWeek = $.let(Data.bindPaged(rosterDuties, { indexes: ["roster_duties_by_time"] }));
        const staff = $.let(Data.bind(rosterStaff));
        const firms = $.let(Data.bind(rosterAgencies));
        const times = $.let(Data.bind(rosterShiftTimes));
        const teams = $.let(Data.bind(rosterTeams));
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
        // The rota's cover targets and the presses' readiness, each in a form of its own.
        const cover = $.let(Record.bind(rosterCover));
        const readiness = $.let(Record.bind(pressReadiness));
        return <Box height="480px">
            <DecisionQueue
                id="routines"
                now={new Date("2026-03-10T13:00:00Z")}
                decisions={DecisionQueue.decisions(cases, {
                    // Every one routine, and none due: the band holds them all.
                    scope: r => r.scope, due: () => none, routine: () => true, unit: r => r.unit, model: r => r.model, why: r => r.why,
                    format: r => r.figure.match({
                        money: () => some(Format.Currency({ currency: "USD", compact: "short" })),
                        count: () => none,
                    }),
                    title: r => r.title, summary: r => r.summary, detail: r => r.detail, value: r => r.value,
                    change: { from: r => r.change, of: {
                        rota: DecisionQueue.change.roster({ name: "Roster", icon: "users",
                            events: { duty }, resources: { people, agencies }, shifts, groups, week: { start: "sunday" }, source: dutyWeek }),
                        cover: DecisionQueue.change.record(cover, { name: "Capacity", icon: "gauge-high", label: c => East.str`${c.team} · ${c.shift}`,
                            fields: { heads: Fields.number({ label: "Heads", min: 0n }) } }),
                        ready: DecisionQueue.change.record(readiness, { name: "Forecast", icon: "chart-line", label: r => r.press,
                            fields: { days: Fields.number({ label: "Days to ready", unit: "days", min: 0.0 }) } }),
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

export const decisionQueuePreviews = example({
    inputs: [],
    description: "The previews gallery (§11): a case for each preview a builder draws, over the example app's records on the morning of Tuesday 20 October 2026 — the Roster's crop, three early shifts from one person to another with each one's hours before → after, its week's map, twenty of 69 people changing, and its map by what they cost, three shifts moved to people with spare hours, each pay code's cost before → after, read through the warehouse's own pay; the Plan's crop, a job off a press where it overlaps a confirmed one with the now line across it, the confirmed job locked — the target reading which jobs are confirmed (`locked`) — and its day's map, five jobs onto Thursday's presses with the day it changes as a strip; the Allocation's crop, a load off the Waiting row into a kiln; the Calendar's, a machine's maintenance off the day it overlaps a job; and the Sheet's, three due dates filled from history, one a guess. Then the previews of the records no builder draws: the price list's changed fields, a region's list price and demand before → after, in its form's own labels; the stock orders' projection, each option's forecast against the minimum; the service rounds' zones, six areas moving from one round to the other; the stores' stock as a mix, 12,000 units rebalanced across five stores; and the catalogue's minimums as groups, 1,240 items across five ranges, each range's items counted through the catalogue's index on it (`source`). Then a Plan crop for each of its other marks: a change the record moved under, stale; a job two cases place, shared; a job moved because of the change, a knock-on; and a breach, a job still overlapping another on its press. The Plan's target reads the print works' jobs through their interval index (`source`), as the Plan's own slice names it, its kind reading one job by its key through the record's entries.",
    keywords: ["DecisionQueue", "previews", "gallery", "crop", "map", "marks", "locked", "stale", "shared", "knockOn", "breach", "now", "cost", "pay", "fields", "projection", "zones", "mix", "groups", "measure", "group", "DecisionQueue.change.roster", "DecisionQueue.change.plan", "DecisionQueue.change.calendar", "DecisionQueue.change.allocation", "DecisionQueue.change.sheet", "DecisionQueue.change.record", "DecisionQueue.change.projection", "DecisionQueue.change.zones", "Fields.number", "Style.ColorToken", "Format.Percent", "source", "entries", "Data.bind", "Data.bindPaged", "Record.bind"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // The gallery's cases, read whole, and the verdicts the queue writes.
        const cases = $.let(Data.bind(previewCases));
        const verdicts = $.let(Record.bind(previewVerdicts));
        const verdictEntries = $.let(Data.bindPaged(previewVerdicts));

        // The Roster's, as `rosterOptimise` gives them, and the warehouse's pay.
        const duties = $.let(Record.bind(rosterDuties));
        const dutyEntries = $.let(Data.bindPaged(rosterDuties));
        const dutyWeek = $.let(Data.bindPaged(rosterDuties, { indexes: ["roster_duties_by_time"] }));
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
        // The warehouse's pay in its own codes: ordinary time to the contract, OT1 past it, an agency's hours at its rate.
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

        // The Plan's, as `planPrintWorks` gives them: the print works' jobs on its presses, read through the jobs'
        // interval index, one job by its key through the record's own entries.
        const jobs = $.let(Record.bind(planPrintJobs));
        const jobEntries = $.let(Data.bindPaged(planPrintJobs));
        const jobTimes = $.let(Data.bindPaged(planPrintJobs, { indexes: ["plan_print_jobs_by_time"] }));
        const presses = $.let(Data.bind(planPrintPresses));
        const job = Schedule.events(jobs, { name: "Print job", icon: "file-lines", entries: jobEntries, title: "title", start: "start", end: "end",
            resource: { field: "press", of: "presses" }, state: "state" });
        const pressRows = Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name, group: p => p.hall });

        // The Calendar's, as `calendarOptimise` gives them; the Allocation's, as `allocationOptimise` does.
        const machineJobs = $.let(Record.bind(calendarJobs));
        const machines = $.let(Data.bind(calendarMachines));
        const machineJob = Calendar.events(machineJobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end",
            resource: { field: "machine", of: "machines" } });
        const services = $.let(Record.bind(calendarServices));
        const service = Calendar.events(services, { name: "Maintenance", icon: "screwdriver-wrench", title: "title", start: "start", end: "end",
            resource: { field: "machine", of: "machines" } });
        const machineRows = Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: m => m.name });
        const bins = $.let(Record.bind(kilnBins));
        const binEntries = $.let(Data.bindPaged(kilnBins));
        const yardDayBins = $.let(Data.bindPaged(kilnBins, { indexes: ["kiln_bins_by_time"] }));
        const bays = $.let(Data.bind(yardBays));
        const kilnList = $.let(Data.bind(kilns));
        const loads = $.let(Data.bind(arrivals));
        const bin = Schedule.events(bins, { name: "Bin", icon: "box", entries: binEntries, at: "at", resource: { field: "bay", of: "bays" },
            arrival: "load", quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec" });
        const bayRows = Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset });
        const kilnRows = Schedule.resources(kilnList.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
            min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges });
        const loadRows = Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays),
            kind: l => some(l.spec), due: l => some(l.due), window: l => some({ from: l.from, to: l.to }) });

        // The Sheet's work orders, as `sheetOptimise` binds them, and the price list.
        const workOrders = $.let(Record.bind(optimiseWorkOrders));
        const priceList = $.let(Record.bind(listPrices));

        // The supply side's records, which no builder draws: the stock orders, which a projection reads by each option's
        // own forecast; the stores' stock, read as a mix; the catalogue, its minimums a rule whose ranges are counted
        // through its index on them, its rows read by key through its entries; and the service rounds' areas.
        const restocks = $.let(Record.bind(stockOrders));
        const storeUnits = $.let(Record.bind(storeStock));
        const items = $.let(Record.bind(catalogue));
        const itemEntries = $.let(Data.bindPaged(catalogue));
        const itemRanges = $.let(Data.bindPaged(catalogue, { indexes: ["catalogue_by_range"] }));
        const areas = $.let(Record.bind(serviceAreas));

        // Where each kind of decision draws: a target for each tag of the options' change. The Plan's reads the jobs
        // through their source and holds a confirmed job locked: the Locked mark.
        const rotaChange = DecisionQueue.change.roster({ name: "Roster", icon: "users",
            events: { duty }, resources: { people, agencies }, shifts, groups, week: { start: "sunday" }, source: dutyWeek });
        const rotaCostChange = DecisionQueue.change.roster({ name: "Roster", icon: "users", map: "cost", pay, currency: "USD",
            events: { duty }, resources: { people, agencies }, shifts, groups, week: { start: "sunday" }, source: dutyWeek });
        const printChange = DecisionQueue.change.plan({ name: "Plan", icon: "bars-progress", events: { job }, resources: { presses: pressRows },
            source: jobTimes, locked: j => j.state.hasTag("confirmed") });
        const workshopChange = DecisionQueue.change.calendar({ name: "Calendar", icon: "calendar-days",
            events: { job: machineJob, service }, event: "service", resources: { machines: machineRows } });
        const yardChange = DecisionQueue.change.allocation({ name: "Allocation", icon: "fire-flame-curved",
            events: { bin }, resources: { bays: bayRows, kilns: kilnRows }, arrivals: loadRows, source: yardDayBins });
        const orderChange = DecisionQueue.change.sheet(workOrders, { name: "Sheet", icon: "table-cells", columns: {
            reference: Sheet.column.text(OptimiseWorkOrder, { header: "Reference", width: "96px" }),
            status: Sheet.column.text(OptimiseWorkOrder, { header: "Status" }),
            due: Sheet.column.date(OptimiseWorkOrder, { header: "Due", width: "96px" }),
        } });
        const pricingChange = DecisionQueue.change.record(priceList, { name: "Pricing", icon: "tag", label: r => r.region,
            fields: {
                price: Fields.number({ label: "List price", unit: "$ / unit", min: 10.0, max: 12.5, step: 0.05, help: "In 5¢ steps" }),
                demand: Fields.number({ label: "Demand / wk", unit: "units" }),
            } });
        // The supply side's: a projection of each option's forecast against the minimum, the stores' stock as a mix, the
        // catalogue's minimums by range, and the rounds' areas in their zones.
        const restockChange = DecisionQueue.change.projection(restocks, { name: "Stock", icon: "boxes-stacked", option: PreviewOption,
            points: o => o.forecast, x: p => p.week, y: p => p.units, limit: { y: 400.0, label: "min" } });
        const splitChange = DecisionQueue.change.record(storeUnits, { name: "Stock", icon: "truck-ramp-box", label: s => s.store, measure: s => s.units });
        const minimumsChange = DecisionQueue.change.record(items, { name: "Catalogue", icon: "layer-group", label: i => i.name, measure: i => i.min,
            entries: itemEntries, group: "range", source: itemRanges });
        const roundsChange = DecisionQueue.change.zones(areas, { name: "Rounds", icon: "map-location-dot",
            zone: a => a.round, x: a => a.column, y: a => a.row, depot: a => a.depot,
            zones: [
                { key: "a", label: "Round A", color: Style.ColorToken("blue", "500") },
                { key: "b", label: "Round B", color: Style.ColorToken("purple", "500") },
            ] });

        return <Box height="760px">
            <DecisionQueue
                id="previewsQueue"
                now={new Date("2026-10-20T09:14:00Z")}
                decisions={DecisionQueue.decisions(cases, {
                    scope: c => c.scope, due: c => c.due, routine: c => c.routine, unit: c => c.unit, model: c => c.model,
                    why: c => c.why, ifWrong: c => c.ifWrong, recommended: c => c.recommended,
                    // Money in dollars, a share as a percent, a count as it is.
                    format: c => c.figure.match({
                        money: () => some(Format.Currency({ currency: "USD", compact: "short" })),
                        count: () => none,
                        percent: () => some(Format.Percent({ maximumFractionDigits: 0n })),
                    }),
                    options: { from: c => c.options, label: o => o.label, title: o => o.title, summary: o => o.summary,
                        detail: o => o.detail, note: o => o.note, value: o => o.value, confidence: o => o.confidence,
                        question: o => o.question, warn: o => o.warn, refused: o => o.refused, knockOn: o => o.knockOn,
                        guesses: o => o.guesses,
                        change: { from: o => o.change, of: {
                            rota: rotaChange, rotaCost: rotaCostChange, print: printChange, workshop: workshopChange,
                            yard: yardChange, orders: orderChange, pricing: pricingChange,
                            restock: restockChange, split: splitChange, minimums: minimumsChange, rounds: roundsChange,
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
            />
        </Box>;
    }}</Reactive>),
});
