/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, IntegerType, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, Reactive, SegmentGroup, Text, Textarea } from "@elaraai/east-ui";

export const textareaBasic = example({
    keywords: ["Textarea", "Root", "placeholder", "rows", "resize"],
    description: "Multi-line text input",
    fn: East.function([], UIComponentType, (_$) => {
        return <Textarea value="" placeholder="Enter your message..." rows={4} resize="vertical" />;
    }),
    inputs: [],
});

export const textareaVariants = example({
    keywords: ["Textarea", "Root", "rows", "resize", "Reactive", "State", "onChange", "onFocus", "onBlur", "onValidate", "interactive", "SegmentGroup", "Configurator", "configurator"],
    description: "Textarea configurator — rows and resize axes on one live State-bound textarea; the aside counts chars, focus, blur and validations",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const rowCounts = $.const(["3", "5", "8"], ArrayType(StringType));
            const resizes = $.const(["none", "vertical", "both"], ArrayType(StringType));

            const rowsBind = $.let(State.bind([StringType], "textarea_rows", "3"));
            const resizeBind = $.let(State.bind([StringType], "textarea_resize", "vertical"));
            const textBind = $.let(State.bind([StringType], "form_textarea", ""));
            const focusBind = $.let(State.bind([IntegerType], "textarea_focus_count", 0n));
            const blurBind = $.let(State.bind([IntegerType], "textarea_blur_count", 0n));
            const validBind = $.let(State.bind([StringType], "textarea_validated", ""));

            const rKey = $.let(rowsBind.read());
            const zKey = $.let(resizeBind.read());
            const text = $.let(textBind.read());
            const focusCount = $.let(focusBind.read());
            const blurCount = $.let(blurBind.read());
            const lastValid = $.let(validBind.read());

            const onRows = $.const(East.function([StringType], NullType, ($, next) => { $(rowsBind.write(next)); }));
            const onResize = $.const(East.function([StringType], NullType, ($, next) => { $(resizeBind.write(next)); }));
            const onChange = $.const(East.function([StringType], NullType, ($, next) => { $(textBind.write(next)); }));
            const onFocus = $.const(East.function([], NullType, $ => {
                const cur = $.let(focusBind.read());
                $(focusBind.write(cur.add(1n)));
            }));
            const onBlur = $.const(East.function([], NullType, $ => {
                const cur = $.let(blurBind.read());
                $(blurBind.write(cur.add(1n)));
            }));
            const onValidate = $.const(East.function([StringType], NullType, ($, val) => {
                $(validBind.write(val));
            }));

            // rows / resize are build-time numerics/enums, so the axes pick
            // between prebuilt textareas; the binding + callbacks are shared.
            const preview = $.const(rKey.equal("5").ifElse(
                _$ => zKey.equal("none").ifElse(
                    _$ => <Textarea value={text} placeholder="Write something..." rows={5} resize="none" onChange={onChange} onFocus={onFocus} onBlur={onBlur} onValidate={onValidate} />,
                    _$ => zKey.equal("both").ifElse(
                        _$ => <Textarea value={text} placeholder="Write something..." rows={5} resize="both" onChange={onChange} onFocus={onFocus} onBlur={onBlur} onValidate={onValidate} />,
                        _$ => <Textarea value={text} placeholder="Write something..." rows={5} resize="vertical" onChange={onChange} onFocus={onFocus} onBlur={onBlur} onValidate={onValidate} />,
                    ),
                ),
                _$ => rKey.equal("8").ifElse(
                    _$ => zKey.equal("none").ifElse(
                        _$ => <Textarea value={text} placeholder="Write something..." rows={8} resize="none" onChange={onChange} onFocus={onFocus} onBlur={onBlur} onValidate={onValidate} />,
                        _$ => zKey.equal("both").ifElse(
                            _$ => <Textarea value={text} placeholder="Write something..." rows={8} resize="both" onChange={onChange} onFocus={onFocus} onBlur={onBlur} onValidate={onValidate} />,
                            _$ => <Textarea value={text} placeholder="Write something..." rows={8} resize="vertical" onChange={onChange} onFocus={onFocus} onBlur={onBlur} onValidate={onValidate} />,
                        ),
                    ),
                    _$ => zKey.equal("none").ifElse(
                        _$ => <Textarea value={text} placeholder="Write something..." rows={3} resize="none" onChange={onChange} onFocus={onFocus} onBlur={onBlur} onValidate={onValidate} />,
                        _$ => zKey.equal("both").ifElse(
                            _$ => <Textarea value={text} placeholder="Write something..." rows={3} resize="both" onChange={onChange} onFocus={onFocus} onBlur={onBlur} onValidate={onValidate} />,
                            _$ => <Textarea value={text} placeholder="Write something..." rows={3} resize="vertical" onChange={onChange} onFocus={onFocus} onBlur={onBlur} onValidate={onValidate} />,
                        ),
                    ),
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Rows", rKey,
                            <SegmentGroup value={rKey} onChange={onRows} size="sm"
                                items={rowCounts.map((_$, r) => SegmentGroup.Item(r, <Text>{r}</Text>))} />),
                        Configurator.Control("Resize", zKey,
                            <SegmentGroup value={zKey} onChange={onResize} size="sm"
                                items={resizes.map((_$, z) => SegmentGroup.Item(z, <Text>{z.upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    aside={{
                        label: "Callbacks · Reactive",
                        body: (
                            <HStack gap="4" align="center">
                                <Text.MonoLabel>{East.str`${text.length()} CHARS`}</Text.MonoLabel>
                                <Text.MonoLabel>{East.str`FOCUS · ${focusCount}`}</Text.MonoLabel>
                                <Text.MonoLabel>{East.str`BLUR · ${blurCount}`}</Text.MonoLabel>
                                <Text.MonoLabel>{East.str`VALID · ${lastValid.length()}`}</Text.MonoLabel>
                            </HStack>
                        ),
                    }}
                    spec={[
                        Configurator.Spec("Rows", rKey),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
