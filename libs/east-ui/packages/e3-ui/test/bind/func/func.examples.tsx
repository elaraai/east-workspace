/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, East, FloatType, IntegerType, NullType, RecursiveType, StringType, StructType, example } from "@elaraai/east";
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

