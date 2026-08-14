/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, DateTimeType, East, FloatType, FunctionType, IntegerType, NullType, StringType, PatchType, StructType, variant, example } from "@elaraai/east";
import { Button, EventStateType, Input, Plan, Reactive, Separator, Slider, Stat, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data } from "@elaraai/e3-ui";
import * as e3 from "@elaraai/e3";

export const thresholdInput      = e3.input('threshold',       FloatType, 50.0);
export const thresholdPatchInput = e3.input('threshold_patch', PatchType(FloatType), variant("unchanged", null));
export const countInput          = e3.input('count', IntegerType, 0n);
export const nameInput           = e3.input('name',  StringType,  '');

/** The RAW ops row — one scheduled job per machine, as an ops dataset stores
 *  it (batch / window / tonnage / lifecycle). Big enough in production that it
 *  is read by window, never whole. */
export const OpsRow = StructType({
    id:     StringType,
    line:   StringType,
    batch:  StringType,
    start:  DateTimeType,
    end:    DateTimeType,
    tonnes: FloatType,
    state:  EventStateType,
});
export const opsInput = e3.input('ops', ArrayType(OpsRow), []);

export const dataBindFloat = example({
    keywords: ["Data", "bind", "Reactive", "Float", "dataset", "read"],
    description: "Bind to a Float dataset and display its current value",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const thresh = $.let(Data.bind(thresholdInput));
            const value = $.let(thresh.read());
            return <Stat label="Threshold" value={value} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindVariants = example({
    keywords: ["Data", "bind", "Reactive", "Slider", "onChange", "write", "interactive", "Integer", "Input", "String", "callback", "Button", "reset", "has", "guard", "conditional"],
    description: "Direct-bind variant panel — SLIDER WRITEBACK: a Slider whose value is bound to a dataset, onChange writes back; INTEGER: an Integer dataset bound to a number input with writeback; STRING RESET: a String dataset with a reset button that writes an empty string; HAS GUARD: has() gates UI on whether a dataset has been written",
    fn: East.function([], UIComponentType, (_$) => (
        <VStack gap="4" align="stretch">
            <Separator label="SLIDER WRITEBACK" align="start" />
            <Reactive>{$ => {
                const thresh = $.let(Data.bind(thresholdInput));
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
            <Separator label="INTEGER" align="start" />
            <Reactive>{$ => {
                const count = $.let(Data.bind(countInput));
                const value = $.let(count.read());
                return <Input.Integer value={value} onChange={count.write} />;
            }}</Reactive>
            <Separator label="STRING RESET" align="start" />
            <Reactive>{$ => {
                const name = $.let(Data.bind(nameInput));
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
            <Separator label="HAS GUARD" align="start" />
            <Reactive>{$ => {
                const thresh = $.let(Data.bind(thresholdInput));
                const ready = $.let(thresh.has());
                const message = $.let("(no data)");
                $.if(ready, $ => {
                    $.assign(message, East.print(thresh.read()));
                });
                return <Text>{message}</Text>;
            }}</Reactive>
        </VStack>
    )),
    inputs: [],
});

export const dataBindStagedFloat = example({
    keywords: ["Data", "bindStaged", "Reactive", "Float", "buffered", "transactional"],
    description: "Stage edits to a Float dataset; read returns overlay (buffered or server)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const thresh = $.let(Data.bind(thresholdInput, { mode: "staged" }));
            const value = $.let(thresh.read(), FloatType);
            return <Stat label="Threshold (live)" value={value} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindStagedVariants = example({
    keywords: ["Data", "bindStaged", "Slider", "write", "buffer", "interactive", "commit", "discard", "pending", "transactional", "original", "read", "overlay", "diff"],
    description: "Staged-bind variant panel — STAGED SLIDER WRITE: a Slider whose onChange writes to the staged buffer instead of the server; STAGED COMMIT DISCARD: two buttons that commit or discard the staged buffer for a path; STAGED ORIGINAL VS READ: the server snapshot (original) and the overlay (read) side by side",
    fn: East.function([], UIComponentType, (_$) => (
        <VStack gap="4" align="stretch">
            <Separator label="STAGED SLIDER WRITE" align="start" />
            <Reactive>{$ => {
                const thresh = $.let(Data.bind(thresholdInput, { mode: "staged" }));
                const value = $.let(thresh.read(), FloatType);
                return <Slider value={value} min={0} max={100} onChange={thresh.write} />;
            }}</Reactive>
            <Separator label="STAGED COMMIT DISCARD" align="start" />
            <Reactive>{$ => {
                const thresh = $.let(Data.bind(thresholdInput, { mode: "staged" }));
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
            <Separator label="STAGED ORIGINAL VS READ" align="start" />
            <Reactive>{$ => {
                const thresh = $.let(Data.bind(thresholdInput, { mode: "staged", patch: thresholdPatchInput }));
                const live = $.let(thresh.read(), FloatType);
                const server = $.let(thresh.source(), FloatType);
                return (
                    <VStack gap="3" align="stretch">
                        <Stat label="Server" value={server} />
                        <Stat label="Live (with stage)" value={live} />
                    </VStack>
                );
            }}</Reactive>
        </VStack>
    )),
    inputs: [],
});

export const dataBindPagedPlan = example({
    keywords: [
        "Data", "bindPaged", "paged", "page", "total", "window", "windows", "Plan",
        "canvas", "series", "collection", "large", "dataset", "Reactive", "stream",
    ],
    description: "Bind a collection dataset BY WINDOW and hand it straight to a Plan — `Data.bindPaged(ops)` returns a `{ page, total }` handle that the canvas consumes structurally: the factory wraps `page` with the series' row-building functions, so each window's RAW rows become canvas rows client-side and the renderer streams them in as a prefix. The dataset is never fetched whole, and nothing in the UI code touches bytes, offsets or beast2",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The paged handle — the dataset's element type comes from the def,
            // so `page(offset, limit)` is typed Option<Array<OpsRow>> with no
            // decode step to write.
            const paged = $.let(Data.bindPaged(opsInput));
            // The series read the RAW row fields and derive the canvas
            // vocabulary; they run over every window the handle serves.
            const series = $.const([
                Plan.series.span(OpsRow, {
                    key: r => r.id, label: r => r.id, id: true,
                    runs: r => [Plan.run({
                        key: r.batch, start: r.start, end: r.end,
                        label: East.str`RUN · ${r.batch}`,
                        quantity: East.str`${East.Float.printFixed(r.tonnes, 0n)} t`,
                        qty: r.tonnes, state: r.state,
                    })],
                    groupBy: [r => r.line], rollup: "union", unit: "t",
                }),
            ], ArrayType(Plan.Types.Series(OpsRow)));
            const axis = $.const(Plan.axis({ resolution: "week", resolutions: ["month", "week", "day"] }));
            return <Plan axis={axis} data={paged} series={series} />;
        }}</Reactive>
    )),
    inputs: [],
});
