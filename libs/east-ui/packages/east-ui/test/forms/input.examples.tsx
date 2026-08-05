/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, DateTimeType, FloatType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, Input, SegmentGroup, Select, Status, Style, Switch, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Input — live configurator over every input axis
// ============================================================================

export const inputStyles = example({
    keywords: ["Input", "String", "placeholder", "variant", "outline", "Integer", "min", "max", "step", "Float", "precision", "DateTime", "date", "time", "size", "xs", "sm", "md", "lg", "subtle", "flushed", "autoFocus", "focus", "ring", "Reactive", "State", "onChange", "onFocus", "onBlur", "interactive", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Input configurator — type, size and variant axes plus an autoFocus switch driving one live State-bound input; the aside reads the bound value back per type",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const variants = $.const([
                    variant("outline", null), variant("subtle", null), variant("flushed", null),
                ], ArrayType(Input.Types.Variant));

                const sizes = $.const([
                    variant("xs", null), variant("sm", null), variant("md", null), variant("lg", null),
                ], ArrayType(Style.Types.Size));

                const typeBind    = $.let(State.bind([StringType], "input_type", "string"));
                const sizeBind    = $.let(State.bind([StringType], "input_size", "md"));
                const variantBind = $.let(State.bind([StringType], "input_variant", "outline"));
                const focusBind   = $.let(State.bind([BooleanType], "input_autofocus", false));

                // The preview is a live control, so every input type keeps its
                // own State-bound value — the old reactive rows, one bind each.
                const textBind      = $.let(State.bind([StringType], "input_string", "hello"));
                const intBind       = $.let(State.bind([IntegerType], "input_integer", 0n));
                const floatBind     = $.let(State.bind([FloatType], "input_float", 0.0));
                const dateBind      = $.let(State.bind([DateTimeType], "input_datetime", new Date()));
                const focusCountBind = $.let(State.bind([IntegerType], "input_focus_count", 0n));
                const blurCountBind  = $.let(State.bind([IntegerType], "input_blur_count", 0n));

                const tKey  = $.let(typeBind.read());
                const sKey  = $.let(sizeBind.read());
                const vKey  = $.let(variantBind.read());
                const focus = $.let(focusBind.read());
                const text  = $.let(textBind.read());
                const int   = $.let(intBind.read());
                const flt   = $.let(floatBind.read());
                const dt    = $.let(dateBind.read());
                const focusCount = $.let(focusCountBind.read());
                const blurCount  = $.let(blurCountBind.read());

                const onType    = $.const(East.function([StringType], NullType, ($, next) => { $(typeBind.write(next)); }));
                const onSize    = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onAutoFocus = $.const(East.function([BooleanType], NullType, ($, next) => { $(focusBind.write(next)); }));
                const onText    = $.const(East.function([StringType], NullType, ($, next) => { $(textBind.write(next)); }));
                const onInt     = $.const(East.function([IntegerType], NullType, ($, next) => { $(intBind.write(next)); }));
                const onFloat   = $.const(East.function([FloatType], NullType, ($, next) => { $(floatBind.write(next)); }));
                const onDate    = $.const(East.function([DateTimeType], NullType, ($, next) => { $(dateBind.write(next)); }));
                const onFocus   = $.const(East.function([], NullType, $ => {
                    const current = $.let(focusCountBind.read());
                    $(focusCountBind.write(current.add(1n)));
                }));
                const onBlur    = $.const(East.function([], NullType, $ => {
                    const current = $.let(blurCountBind.read());
                    $(blurCountBind.write(current.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const inputVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));

                // The type axis swaps the whole live control: each East value
                // type is a different factory over a different State bind, so
                // each row holds the built input, the readout that mirrors it,
                // and the constraints the row demonstrates. All four stay bound
                // — switching type never loses a value.
                const types = $.const([
                    {
                        label: "string",
                        constraints: "placeholder · onFocus · onBlur",
                        input: <Input.String value={text} placeholder="Type something..." size={size} variant={inputVariant} autoFocus={focus} onChange={onText} onFocus={onFocus} onBlur={onBlur} />,
                        readout: (
                            <VStack gap="3" align="stretch">
                                <Text>{East.str`You typed: ${text}`}</Text>
                                <Text>{East.str`Length: ${text.length()}`}</Text>
                                <HStack gap="4">
                                    <Text.MonoLabel>{East.str`FOCUS · ${focusCount}`}</Text.MonoLabel>
                                    <Text.MonoLabel>{East.str`BLUR · ${blurCount}`}</Text.MonoLabel>
                                </HStack>
                            </VStack>
                        ),
                    },
                    {
                        label: "integer",
                        constraints: "min 0 · max 1000 · step 1",
                        input: <Input.Integer value={int} min={0n} max={1000n} step={1n} size={size} variant={inputVariant} autoFocus={focus} onChange={onInt} />,
                        readout: (
                            <VStack gap="3" align="stretch">
                                <Text>{East.str`Value: ${int}`}</Text>
                                {East.equal(int.remainder(2n), 0n).ifElse(
                                    _$ => <Status label="Even" value="info" />,
                                    _$ => <Status label="Odd" value="neutral" />,
                                )}
                            </VStack>
                        ),
                    },
                    {
                        label: "float",
                        constraints: "min 0 · max 100 · step 0.1 · precision 2",
                        input: <Input.Float value={flt} min={0} max={100} step={0.1} precision={2n} size={size} variant={inputVariant} autoFocus={focus} onChange={onFloat} />,
                        readout: <Text>{East.str`Value: ${East.print(flt)}`}</Text>,
                    },
                    {
                        label: "datetime",
                        constraints: "precision datetime",
                        input: <Input.DateTime value={dt} precision="datetime" size={size} variant={inputVariant} autoFocus={focus} onChange={onDate} />,
                        readout: (
                            <VStack gap="3" align="stretch">
                                <Text>{East.str`Year: ${dt.getYear()}`}</Text>
                                <Text>{East.str`Month: ${dt.getMonth()}`}</Text>
                                <Text>{East.str`Day: ${dt.getDayOfMonth()}`}</Text>
                            </VStack>
                        ),
                    },
                ], ArrayType(StructType({ label: StringType, constraints: StringType, input: UIComponentType, readout: UIComponentType })));

                const sel = $.let(types.filter((_$, o) => o.label.equal(tKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Type", tKey,
                                <Select value={tKey} onChange={onType} size="sm"
                                    items={types.map((_$, o) => Select.Item(o.label, o.label))} />),
                            Configurator.Control("Size", sKey,
                                <Select value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Autofocus spec row below rather than as one value.
                            Configurator.Slot("Focus",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={focus} label="Autofocus" onChange={onAutoFocus} />
                                </HStack>),
                        ]}
                        preview={sel.input}
                        aside={{
                            label: "Value · Reactive",
                            body: sel.readout,
                        }}
                        spec={[
                            Configurator.Spec("Constraints", sel.constraints),
                            Configurator.Spec("Autofocus", focus.ifElse(_$ => "on mount", _$ => "off")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
