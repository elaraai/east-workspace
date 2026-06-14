/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Button, HStack, Reactive, Stat, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// The package-side record + mutation definitions. `Record.bind` takes the
// record def + its mutations — the state type, mutation names and arg types
// all come from them, so the binding can never drift from the deployed record.
export const counter = e3.record("counter", IntegerType, 0n);
export const increment = e3.mutation("increment", counter,
    East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by)));
export const reset = e3.mutation("reset", counter,
    East.function([IntegerType], IntegerType, (_$, _state) => 0n));

export const recordBindMutate = example({
    keywords: ["Record", "bind", "mutate", "Reactive", "Button", "read", "pending", "status", "system of record"],
    description: "Bind an e3.record + its mutations; buttons apply typed mutations, a stat shows the current state, and the mutate lifecycle status is rendered",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const r = $.let(Record.bind(counter, [increment, reset]));
            const status = $.let(r.mutate.status().getTag().upperCase());
            const bump = $.const(East.function([], NullType, $ => {
                $(r.mutate.increment(1n));
            }));
            const clear = $.const(East.function([], NullType, $ => {
                $(r.mutate.reset());
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Stat label="Counter" value={East.print(r.read())} />
                    <HStack gap="2">
                        <Button onClick={bump} loading={r.mutate.pending()}>Increment</Button>
                        <Button variant="outline" onClick={clear}>Reset</Button>
                    </HStack>
                    <Text.MonoLabel>{status}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const recordBindStatus = example({
    keywords: ["Record", "bind", "status", "error", "lifecycle", "mutate"],
    description: "Render the mutation lifecycle (idle / running / committed / failed / cancelled) and any failure",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const r = $.let(Record.bind(counter, [increment]));
            const bump = $.const(East.function([], NullType, $ => { $(r.mutate.increment(1n)); }));
            const statusLine = $.let(r.mutate.status().getTag().upperCase());
            const detail = $.let(r.mutate.error().match({
                some: (_$, e) => e.message,
                none: _$ => East.print(r.read()),
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Button onClick={bump} loading={r.mutate.pending()}>Increment</Button>
                    <Text.MonoLabel>{statusLine}</Text.MonoLabel>
                    <Text color="fg.muted">{detail}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const recordBindHistory = example({
    keywords: ["Record", "bind", "history", "audit", "commit", "chain"],
    description: "Read the record's commit history (the audit trail) alongside its current value",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const r = $.let(Record.bind(counter, [increment]));
            const count = $.let(r.history().match({
                some: (_$, commits) => commits.size(),
                none: _$ => 0n,
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Stat label="Counter" value={East.print(r.read())} />
                    <Text.MonoLabel>{East.str`${count} COMMITS`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
