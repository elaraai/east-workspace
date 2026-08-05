/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, NullType, StringType, example, variant } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, Reactive, SegmentGroup, Status, Switch, Text } from "@elaraai/east-ui";
import { State } from "@elaraai/east-ui";

export const statusBasic = example({
    keywords: ["Status", "Root", "value", "paired icon"],
    description: "Each StatusValue side-by-side with default paired icon",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="3">
                <Status label="Up to date" value="success" />
                <Status label="Stale" value="warning" />
                <Status label="Failed" value="danger" />
                <Status label="Info" value="info" />
                <Status label="Idle" value="neutral" />
            </HStack>
        );
    }),
    inputs: [],
});

export const statusVariants = example({
    keywords: ["Status", "Root", "value", "success", "warning", "danger", "info", "neutral", "pulsing", "rich label", "custom icon", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Status configurator — a value axis plus pulsing, rich-label and custom-icon switches on one live status",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const values = $.const([
                variant("success", null), variant("warning", null), variant("danger", null),
                variant("info", null), variant("neutral", null),
            ], ArrayType(Status.Types.Value));

            const valueBind = $.let(State.bind([StringType], "status_value", "success"));
            const pulsingBind = $.let(State.bind([BooleanType], "status_pulsing", false));
            const richBind = $.let(State.bind([BooleanType], "status_rich", false));
            const iconBind = $.let(State.bind([BooleanType], "status_icon", false));

            const vKey = $.let(valueBind.read());
            const value = $.let(values.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
            const pulsingOn = $.let(pulsingBind.read());
            const richOn = $.let(richBind.read());
            const iconOn = $.let(iconBind.read());

            const onValue = $.const(East.function([StringType], NullType, ($, next) => { $(valueBind.write(next)); }));
            const onPulsing = $.const(East.function([BooleanType], NullType, ($, next) => { $(pulsingBind.write(next)); }));
            const onRich = $.const(East.function([BooleanType], NullType, ($, next) => { $(richBind.write(next)); }));
            const onIcon = $.const(East.function([BooleanType], NullType, ($, next) => { $(iconBind.write(next)); }));

            // The rich label is a UIComponent slot and the custom icon is
            // presence-typed, so those switches pick between prebuilt statuses;
            // value + pulsing stay live.
            const preview = $.const(richOn.ifElse(
                _$ => (
                    <Status
                        value={value}
                        pulsing={pulsingOn}
                        label={
                            <HStack gap="1">
                                <Text>Up to date</Text>
                                <Text color="fg.muted">· 14:32</Text>
                            </HStack>
                        }
                    />
                ),
                _$ => iconOn.ifElse(
                    _$ => <Status label="Syncing" value={value} pulsing={pulsingOn} icon={{ prefix: "fas", name: "rotate" }} />,
                    _$ => <Status label="Up to date" value={value} pulsing={pulsingOn} />,
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Value", vKey,
                            <SegmentGroup value={vKey} onChange={onValue} size="sm"
                                items={values.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Slot("Face",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={pulsingOn} label="Pulsing" onChange={onPulsing} />
                                <Switch checked={richOn} label="Rich label" onChange={onRich} />
                                <Switch checked={iconOn} label="Custom icon" onChange={onIcon} />
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Value", vKey),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
