/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, FloatType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Slider, Text, VStack, Reactive } from "@elaraai/east-ui";

export const sliderBasic = example({
    keywords: ["Slider", "Root", "min", "max", "step"],
    description: "Numeric range selection",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch" width="100%">
                <Slider value={50.0} min={0} max={100} />
                <Slider value={25.0} min={0} max={100} step={25} />
                <Slider value={75.0} min={0} max={100} disabled={true} />
            </VStack>
        );
    }),
    inputs: [],
});

export const sliderInteractive = example({
    keywords: ["Slider", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Drag to see live value updates — paired with mono tabular readout",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const sliderBind = $.let(State.bind([FloatType], "form_slider", 50.0));
            const value = $.let(sliderBind.read());
            const onChange = $.const(East.function([FloatType], NullType, ($, newValue) => {
                $(sliderBind.write(newValue));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Slider value={value} min={0} max={100} onChange={onChange} />
                    {<Text.MonoKpi>{East.str`${East.print(value)} %`}</Text.MonoKpi>}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const sliderOnChangeEnd = example({
    keywords: ["Slider", "Reactive", "State", "onChangeEnd", "commit", "interactive"],
    description: "Slider that only commits on release via onChangeEnd",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([FloatType], "form_slider_commit", 50.0));
            const value = $.let(bind.read());
            const onChangeEnd = $.const(East.function([FloatType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Slider value={value} min={0} max={100} onChangeEnd={onChangeEnd} />
                    {<Text.MonoLabel>{East.str`COMMITTED · ${East.print(value)}`}</Text.MonoLabel>}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
