/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { East, FloatType, FunctionType, IntegerType, NullType, StringType, PatchType, variant, example } from "@elaraai/east";
import { Button, Input, Reactive, Slider, Stat, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data } from "@elaraai/e3-ui";
import * as e3 from "@elaraai/e3";

export const thresholdInput      = e3.input('threshold',       FloatType, 50.0);
export const thresholdPatchInput = e3.input('threshold_patch', PatchType(FloatType), variant("unchanged", null));
export const countInput          = e3.input('count', IntegerType, 0n);
export const nameInput           = e3.input('name',  StringType,  '');

export const dataBindFloat = example({
    keywords: ["Data", "bind", "Reactive", "Float", "dataset", "read"],
    description: "Bind to a Float dataset and display its current value",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const thresh = $.let(Data.bind([FloatType], thresholdInput.path));
            const value = $.let(thresh.read());
            return <Stat label="Threshold" value={value} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindSliderWriteback = example({
    keywords: ["Data", "bind", "Reactive", "Slider", "onChange", "write", "interactive"],
    description: "Slider whose value is bound to a dataset — onChange writes back",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const thresh = $.let(Data.bind([FloatType], thresholdInput.path));
            const value = $.let(thresh.read());
            return (
                <Slider
                    value={value}
                    min={0}
                    max={100}
                    onChangeEnd={thresh.writeAndStart}
                    disabled={thresh.status().hasTag('stale')}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindInteger = example({
    keywords: ["Data", "bind", "Integer", "Input", "write", "interactive"],
    description: "Integer dataset bound to a number input with writeback",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const count = $.let(Data.bind([IntegerType], countInput.path));
            const value = $.let(count.read());
            return <Input.Integer value={value} onChange={count.write} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindStringReset = example({
    keywords: ["Data", "bind", "String", "callback", "Button", "reset", "write"],
    description: "String dataset with a reset button that writes an empty string",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const name = $.let(Data.bind([StringType], nameInput.path));
            const value = $.let(name.read());
            const reset = $.const(East.function([], NullType, $ => {
                $(name.write(""));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Stat label="Name" value={value} />
                    <Button variant="outline" onClick={reset}>Reset</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindHasGuard = example({
    keywords: ["Data", "bind", "has", "guard", "conditional", "Reactive"],
    description: "Use has() to gate UI on whether a dataset has been written",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const thresh = $.let(Data.bind([FloatType], thresholdInput.path));
            const ready = $.let(thresh.has());
            const message = $.let("(no data)");
            $.if(ready, $ => {
                $.assign(message, East.print(thresh.read()));
            });
            return <Text>{message}</Text>;
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindStagedFloat = example({
    keywords: ["Data", "bindStaged", "Reactive", "Float", "buffered", "transactional"],
    description: "Stage edits to a Float dataset; read returns overlay (buffered or server)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const thresh = $.let(Data.bind([FloatType], thresholdInput.path, { mode: "staged" }));
            const value = $.let(thresh.read(), FloatType);
            return <Stat label="Threshold (live)" value={value} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindStagedSliderWrite = example({
    keywords: ["Data", "bindStaged", "Slider", "write", "buffer", "interactive"],
    description: "Slider whose onChange writes to the staged buffer instead of the server",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const thresh = $.let(Data.bind([FloatType], thresholdInput.path, { mode: "staged" }));
            const value = $.let(thresh.read(), FloatType);
            return <Slider value={value} min={0} max={100} onChange={thresh.write} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindStagedCommitDiscard = example({
    keywords: ["Data", "bindStaged", "commit", "discard", "pending", "transactional"],
    description: "Two buttons that commit or discard the staged buffer for a path",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const thresh = $.let(Data.bind([FloatType], thresholdInput.path, { mode: "staged" }));
            const commit = $.const(East.function([], NullType, $ => {
                $(thresh.commit());
            }), FunctionType([], NullType));
            const discard = $.const(East.function([], NullType, $ => {
                $(thresh.discard());
            }), FunctionType([], NullType));
            return (
                <VStack gap="3" align="stretch">
                    <Text>Pending edits</Text>
                    <Button onClick={commit}>Commit</Button>
                    <Button variant="outline" onClick={discard}>Discard</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindStagedOriginalVsRead = example({
    keywords: ["Data", "bindStaged", "original", "read", "overlay", "diff"],
    description: "Show server snapshot (original) and overlay (read) side by side",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const thresh = $.let(Data.bind([FloatType], thresholdInput.path, { mode: "staged", patch: thresholdPatchInput.path }));
            const live = $.let(thresh.read(), FloatType);
            const server = $.let(thresh.source(), FloatType);
            return (
                <VStack gap="3" align="stretch">
                    <Stat label="Server" value={server} />
                    <Stat label="Live (with stage)" value={live} />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
