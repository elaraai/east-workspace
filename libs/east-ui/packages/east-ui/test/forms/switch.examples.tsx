/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, Reactive, SegmentGroup, Switch, Text, VStack } from "@elaraai/east-ui";

export const switchBasic = example({
    keywords: ["Switch", "Root", "label", "toggle", "disabled"],
    description: "Toggle control for on/off states",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" align="flex-start">
                <Switch checked={false} label="Notifications" />
                <Switch checked={true} label="Dark mode" />
                <Switch checked={false} label="Feature flag" />
                <Switch checked={false} label="Disabled" disabled={true} />
            </VStack>
        );
    }),
    inputs: [],
});

export const switchVariants = example({
    keywords: ["Switch", "Root", "size", "sm", "md", "lg", "disabled", "Reactive", "State", "onChange", "interactive", "SegmentGroup", "Configurator", "configurator"],
    description: "Switch configurator — a size axis plus a disabled switch on one live State-bound toggle",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const sizes = $.const(["sm", "md", "lg"], ArrayType(StringType));

            const sizeBind = $.let(State.bind([StringType], "switch_size", "md"));
            const disabledBind = $.let(State.bind([BooleanType], "switch_disabled", false));
            const onBind = $.let(State.bind([BooleanType], "form_switch", false));

            const sKey = $.let(sizeBind.read());
            const disabledOn = $.let(disabledBind.read());
            const enabled = $.let(onBind.read());

            const onSize = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
            const onDisabled = $.const(East.function([BooleanType], NullType, ($, next) => { $(disabledBind.write(next)); }));
            const onChange = $.const(East.function([BooleanType], NullType, ($, next) => { $(onBind.write(next)); }));

            const preview = $.const(sKey.equal("sm").ifElse(
                _$ => <Switch checked={enabled} label="Auto-refresh" size="sm" disabled={disabledOn} onChange={onChange} />,
                _$ => sKey.equal("lg").ifElse(
                    _$ => <Switch checked={enabled} label="Auto-refresh" size="lg" disabled={disabledOn} onChange={onChange} />,
                    _$ => <Switch checked={enabled} label="Auto-refresh" size="md" disabled={disabledOn} onChange={onChange} />,
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizes.map((_$, v) => SegmentGroup.Item(v, <Text>{v.upperCase()}</Text>))} />),
                        Configurator.Slot("State",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={disabledOn} label="Disabled" onChange={onDisabled} />
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Checked", enabled.ifElse(_$ => "on", _$ => "off")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
