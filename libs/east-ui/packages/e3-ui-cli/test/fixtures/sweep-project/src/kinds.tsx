/** @jsxImportSource @elaraai/east-ui */
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Sweep/detect fixture: one export per classification outcome. Consumed by
// detect/sweep specs via esbuild (NOT compiled by the package tsc).
import { East, IntegerType, StringType, example } from "@elaraai/east";
import { UIComponentType, State, VStack, Text, Badge } from "@elaraai/east-ui";

/** Renderable: a bare zero-input East fn returning UIComponentType. */
export const surface = East.function([], UIComponentType, (_$) => (
    <VStack gap="3" align="stretch">
        <Text fontWeight="bold">Sweep fixture</Text>
        <Badge colorPalette="success">ok</Badge>
    </VStack>
));

/** Renderable: an example() def wrapping a UI fn. */
export const chipExample = example({
    keywords: ["fixture"],
    description: "sweep fixture example",
    fn: East.function([], UIComponentType, (_$) => <Badge colorPalette="brand">chip</Badge>),
    inputs: [],
});

/** Skipped (wrong-output): an example() whose fn returns an Integer. */
export const sumExample = example({
    keywords: ["fixture"],
    description: "non-UI example",
    fn: East.function([], IntegerType, ($) => $.const(3n, IntegerType)),
    inputs: [],
    returns: 3n,
});

/** Skipped (has-inputs): a UI fn that needs a compute-time argument. */
export const withInputs = East.function([IntegerType], UIComponentType, (_$, _n) => (
    <Text>parameterized</Text>
));

/** Renderable: browser-local State platform calls render at initial state. */
export const stateBound = East.function([], UIComponentType, (_$) => {
    const label = State.bind([StringType], "sweep.fixture", "hello");
    return <Text>{label.read()}</Text>;
});

/** Skipped (workspace-bound): calls a `data_*` platform — needs a live e3 workspace. */
const workspaceRead = East.platform("data_read", [StringType], StringType);
export const workspaceBound = East.function([], UIComponentType, (_$) => (
    <Text>{workspaceRead("k")}</Text>
));

/** Not East at all — never reported, pure noise suppression. */
export const columns = ["a", "b", "c"];
