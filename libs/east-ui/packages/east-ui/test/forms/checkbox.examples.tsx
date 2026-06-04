/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Checkbox, Status, VStack, HStack, Reactive } from "@elaraai/east-ui/jsx";

export const checkboxBasic = example({
    keywords: ["Checkbox", "Root", "label", "indeterminate", "disabled"],
    description: "Boolean selection control",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" align="flex-start">
                <Checkbox checked={false} label="Accept terms" />
                <Checkbox checked={true} label="Checked option" />
                <Checkbox checked={false} label="Indeterminate" indeterminate={true} />
                <Checkbox checked={false} label="Disabled" disabled={true} />
            </VStack>
        );
    }),
    inputs: [],
});

export const checkboxSizes = example({
    keywords: ["Checkbox", "Root", "size", "sm", "md", "lg"],
    description: "Size variations: sm, md, lg",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Checkbox checked={true} label="Small" size="sm" />
                <Checkbox checked={true} label="Medium" size="md" />
                <Checkbox checked={true} label="Large" size="lg" />
            </HStack>
        );
    }),
    inputs: [],
});

export const checkboxInteractive = example({
    keywords: ["Checkbox", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Toggle to see state changes via onChange",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const checkBind = $.let(State.bind([BooleanType], "form_checkbox", false));
            const checked = $.let(checkBind.read());
            const onChange = $.const(East.function([BooleanType], NullType, ($, newValue) => {
                $(checkBind.write(newValue));
            }));
            return (
                <VStack gap="3" align="flex-start">
                    <Checkbox checked={checked} label="Click me!" onChange={onChange} />
                    {checked.ifElse(
                        _$ => <Status label="Checked" value="success" />,
                        _$ => <Status label="Unchecked" value="neutral" />,
                    )}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
