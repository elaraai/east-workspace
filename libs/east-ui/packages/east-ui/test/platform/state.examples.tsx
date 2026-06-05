/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Reactive, Text, VStack } from "@elaraai/east-ui";

export const stateReactiveCounter = example({
    keywords: ["State", "bind", "Reactive", "counter", "increment", "read", "write"],
    description: "Reactive counter — State.bind exposes read / write closures and Reactive.Root re-renders on change",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const countBind = $.let(State.bind([IntegerType], "demo.counter", 0n));
            const count = $.let(countBind.read());
            const increment = $.const(East.function([], NullType, $ => {
                const current = $.let(countBind.read());
                $(countBind.write(current.add(1n)));
            }));
            return (
                <VStack gap="2" align="stretch">
                    <Text>{East.str`Count: ${count}`}</Text>
                    <Button onClick={increment}>+1</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
