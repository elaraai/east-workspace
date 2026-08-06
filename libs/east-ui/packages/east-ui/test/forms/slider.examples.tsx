/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { BooleanType, East, FloatType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, Input, HStack, Reactive, Slider, Switch, Text, VStack } from "@elaraai/east-ui";

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

export const sliderVariants = example({
    keywords: ["Slider", "Root", "step", "disabled", "Reactive", "State", "onChange", "onChangeEnd", "commit", "interactive", "Input", "Float", "Switch", "Configurator", "configurator"],
    description: "Slider configurator — a step axis plus disabled and commit-on-release switches on one live State-bound slider with a mono readout",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const stepBind = $.let(State.bind([FloatType], "slider_step", 1.0));
            const disabledBind = $.let(State.bind([BooleanType], "slider_disabled", false));
            const valueBind = $.let(State.bind([FloatType], "form_slider", 50.0));

            const stepN = $.let(stepBind.read());
            const disabledOn = $.let(disabledBind.read());
            const value = $.let(valueBind.read());

            const onStep = $.const(East.function([FloatType], NullType, ($, next) => { $(stepBind.write(next)); }));
            const onDisabled = $.const(East.function([BooleanType], NullType, ($, next) => { $(disabledBind.write(next)); }));
            const onChange = $.const(East.function([FloatType], NullType, ($, next) => { $(valueBind.write(next)); }));

            // BOTH callbacks stay attached on the ONE slider — onChange fires
            // live, onChangeEnd on release; the readout tracks either.
            const preview = $.const(
                <Slider value={value} min={0} max={100} step={stepN} disabled={disabledOn} onChange={onChange} onChangeEnd={onChange} />,
            );

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Step", East.print(stepN.toInteger()),
                            <Input.Float value={stepN} min={1.0} max={25.0} step={1.0} size="sm" onChange={onStep} />),
                        Configurator.Slot("Behaviour",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={disabledOn} label="Disabled" onChange={onDisabled} />
                            </HStack>),
                    ]}
                    preview={preview}
                    aside={{
                        label: "Value · Reactive",
                        body: <Text.MonoKpi>{East.str`${East.print(value)} %`}</Text.MonoKpi>,
                    }}
                    spec={[
                        Configurator.Spec("Callbacks", "onChange · onChangeEnd"),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
