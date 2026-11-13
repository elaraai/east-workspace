/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, DictType, East, FloatType, IntegerType, NullType, RecursiveType, StringType, StructType, example, variant } from "@elaraai/east";
import { Button, HStack, Reactive, Stat, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Func } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// The package-side function definitions. `Func.bind` takes the def itself —
// name, parameter types and return type all come from it, so the binding
// can never drift from the deployed signature. Exported, as every e3 def an
// example binds is: the package these examples deploy in carries them.
export const forecastFn = e3.function("forecast", East.function([IntegerType, FloatType], FloatType, (_$, _periods, growth) => growth));
export const rebalanceFn = e3.function("rebalance", East.function([FloatType], FloatType, (_$, target) => target));

// What the function runtime's specs call beside them (#1378): a forecast that
// refuses a negative growth, so a call fails as a runner's program does; and a
// count over a recursive tree, whose type the deployed list names with its
// wrappers numbered as it reads them off the wire.
export const checkedForecastFn = e3.function("checked_forecast", East.function([IntegerType, FloatType], FloatType, (_$, periods, growth) =>
    East.less(growth, 0.0).ifElse(() => East.error("growth must not be negative"), () => growth.multiply(periods.toFloat()))));
export const TreeType = RecursiveType(self => StructType({ label: StringType, children: ArrayType(self) }));
export const countTreeFn = e3.function("count_tree", East.function([TreeType], IntegerType, (_$, tree) => tree.unwrap().children.size().add(1n)));

// A function that reads the workspace (#1514): its inputs — the price list and
// the stock — are read as stored at each call, and its caller passes the order
// alone. The page binds neither dataset.
export const OrderLineType = StructType({ sku: StringType, quantity: IntegerType });
export const QuoteType = StructType({ total: FloatType, short: ArrayType(StringType) });
export const unitPrices = e3.input("unit_prices", DictType(StringType, FloatType), variant("value", new Map([["bolt", 0.25], ["nut", 0.1]])));
export const stockOnHand = e3.input("stock_on_hand", DictType(StringType, IntegerType), variant("value", new Map([["bolt", 500n], ["nut", 40n]])));
export const quoteFn = e3.function("quote", {
    inputs: [unitPrices, stockOnHand],
    args: [ArrayType(OrderLineType)],
    output: QuoteType,
}, ($, prices, stock, lines) => {
    const total = $.let(0.0);
    const short = $.let([], ArrayType(StringType));
    $.for(lines, ($, line) => {
        $.assign(total, total.add(prices.get(line.sku, () => 0.0).multiply(line.quantity.toFloat())));
        $.if(East.less(stock.get(line.sku, () => 0n), line.quantity), $ => {
            $(short.pushLast(line.sku));
        });
    });
    return { total, short };
});

// Functions a page calls over its unsaved edits (#1620). Each lists, in
// `drafts`, the records a call may lay edits over: a call that passes drafts
// reads those records as a Save of the drafts would leave them, and saves
// nothing. The print shop's jobs take a patch — what a builder's Save commits,
// and so what its draft holds — and a move of one job to another press, which
// refuses a job the shop does not hold; its presses take a patch.
export const PressJobType = StructType({ press: StringType, hours: IntegerType });
export const PressJobsType = DictType(StringType, PressJobType);
export const pressJobs = e3.record("press_jobs", PressJobsType, {
    initial: new Map([
        ["j1", { press: "P1", hours: 4n }],
        ["j2", { press: "P1", hours: 2n }],
        ["j3", { press: "P2", hours: 6n }],
    ]),
    mutations: (mutation) => ({
        patch: mutation.patch(),
        move: mutation.edit(East.function([PressJobsType, StringType, StringType, e3.mutation.editType(PressJobsType)], NullType,
            ($, jobs, job, press, edit) => {
                $.if(jobs.has(job).not(), $ => {
                    $.error(East.str`the shop holds no job ${job}`);
                });
                $(edit.set(job, { press, hours: jobs.get(job).hours }));
            })),
    }),
});
export const PressType = StructType({ name: StringType, hoursPerDay: IntegerType });
export const PressesType = DictType(StringType, PressType);
export const presses = e3.record("presses", PressesType, {
    initial: new Map([
        ["P1", { name: "Offset", hoursPerDay: 8n }],
        ["P2", { name: "Digital", hoursPerDay: 8n }],
    ]),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
// How many jobs a press holds: it reads the jobs, and lists them, so a call
// may lay a page's edits of them over what it reads.
export const jobsOnFn = e3.function("jobs_on", {
    inputs: [pressJobs],
    drafts: [pressJobs],
    args: [StringType],
    output: IntegerType,
}, ($, jobs, press) => {
    const found = $.let(0n);
    $.for(jobs, ($, job) => {
        $.if(East.equal(job.press, press), $ => {
            $.assign(found, found.add(1n));
        });
    });
    return found;
});
// A press's load against its day: it reads the jobs and the presses, and lists
// both, so one call may lay edits of each.
export const PressLoadType = StructType({ jobs: ArrayType(StringType), hours: IntegerType, capacity: IntegerType });
export const pressLoadFn = e3.function("press_load", {
    inputs: [pressJobs, presses],
    drafts: [pressJobs, presses],
    args: [StringType],
    output: PressLoadType,
}, ($, jobs, shop, press) => {
    const held = $.let([], ArrayType(StringType));
    const hours = $.let(0n);
    $.for(jobs, ($, job, key) => {
        $.if(East.equal(job.press, press), $ => {
            $(held.pushLast(key));
            $.assign(hours, hours.add(job.hours));
        });
    });
    const capacity = $.let(0n);
    $.match(shop.tryGet(press), {
        some: ($, found) => { $.assign(capacity, found.hoursPerDay); },
    });
    return { jobs: held, hours, capacity };
});

export const funcBindCall = example({
    keywords: ["Func", "bind", "call", "Reactive", "Button", "pending", "read", "RPC", "FunctionDef"],
    description: "Bind an e3.function def; a button launches it and a stat shows the result",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const forecast = $.let(Func.bind(forecastFn));
            const run = $.const(East.function([], NullType, $ => {
                $(forecast.call(12n, 1.05));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Button onClick={run} loading={forecast.pending()}>Run forecast</Button>
                    <Stat label="Forecast" value={East.print(forecast.read())} />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const funcBindInputs = example({
    keywords: ["Func", "bind", "call", "inputs", "args", "e3.function", "workspace", "quote", "reads datasets"],
    description: "Bind an e3.function that reads the workspace: its call takes the order alone, and each call reads the prices and stock as stored",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const quoting = $.let(Func.bind(quoteFn));
            const draft = $.let([{ sku: "bolt", quantity: 120n }, { sku: "nut", quantity: 60n }], ArrayType(OrderLineType));
            const run = $.const(East.function([], NullType, $ => {
                $(quoting.call(draft));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Button onClick={run} loading={quoting.pending()}>Quote order</Button>
                    <Stat label="Quote" value={East.print(quoting.read())} />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const funcBindStatus = example({
    keywords: ["Func", "bind", "status", "getTag", "error", "lifecycle"],
    description: "Render the call lifecycle (idle / running / succeeded / failed / cancelled) and the failure message",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const forecast = $.let(Func.bind(forecastFn));
            const run = $.const(East.function([], NullType, $ => {
                $(forecast.call(12n, 1.05));
            }));
            // The status tag doubles as the display string.
            const statusLine = $.let(forecast.status().getTag().upperCase());
            const detail = $.let(forecast.error().match({
                some: (_$, e) => e.message,
                none: _$ => East.print(forecast.read()),
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Button onClick={run} loading={forecast.pending()}>Run forecast</Button>
                    <Text.MonoLabel>{statusLine}</Text.MonoLabel>
                    <Text color="fg.muted">{detail}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const funcBindCancel = example({
    keywords: ["Func", "bind", "cancel", "pending", "abort"],
    description: "Cancel stops waiting for the in-flight call (the server still finishes it)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const rebalance = $.let(Func.bind(rebalanceFn));
            const run = $.const(East.function([], NullType, $ => {
                $(rebalance.call(0.5));
            }));
            return (
                <HStack gap="3">
                    <Button onClick={run} loading={rebalance.pending()}>Rebalance</Button>
                    <Button variant="outline" onClick={rebalance.cancel}
                            disabled={rebalance.pending().not()}>
                        Cancel
                    </Button>
                </HStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const funcBindSharedChannel = example({
    keywords: ["Func", "bind", "shared", "channel", "binding", "name"],
    description: "Handles bound to the same function share one channel: one launches, another observes",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Two independent binds of the same function observe the same
            // tracked call — `binding.name` is the channel key.
            const launcher = $.let(Func.bind(forecastFn));
            const observer = $.let(Func.bind(forecastFn));
            const run = $.const(East.function([], NullType, $ => {
                $(launcher.call(12n, 1.05));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Button onClick={run} loading={launcher.pending()}>Run forecast</Button>
                    <Stat label={East.str`Result of ${observer.binding.name}`}
                          value={East.print(observer.read())} />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

