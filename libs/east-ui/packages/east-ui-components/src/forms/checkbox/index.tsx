/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState, useEffect } from "react";
import { Checkbox as ChakraCheckbox, type CheckboxCheckedChangeDetails, type CheckboxRootProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Checkbox } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

// Pre-define equality function at module level
const checkboxEqual = equalFor(Checkbox.Types.Checkbox);

/** East Checkbox value type */
export type CheckboxValue = ValueTypeOf<typeof Checkbox.Types.Checkbox>;

/**
 * Converts an East UI Checkbox value to Chakra UI Checkbox props.
 * Pure function - easy to test independently.
 */
export function toChakraCheckbox(value: CheckboxValue): CheckboxRootProps {
    const indeterminate = getSomeorUndefined(value.indeterminate);
    const style = getSomeorUndefined(value.style);
    const colorPalette = style ? getSomeorUndefined(style.colorPalette)?.type : undefined;
    const size = style ? getSomeorUndefined(style.size)?.type : undefined;

    return {
        checked: indeterminate ? "indeterminate" : value.checked,
        disabled: getSomeorUndefined(value.disabled),
        colorPalette,
        size,
    };
}

export interface EastChakraCheckboxProps {
    value: CheckboxValue;
}

/**
 * Renders an East UI Checkbox value using Chakra UI Checkbox component.
 */
export const EastChakraCheckbox = memo(function EastChakraCheckbox({ value }: EastChakraCheckboxProps) {
    const [props, setProps] = useState(toChakraCheckbox(value));
    const label = useMemo(() => getSomeorUndefined(value.label), [value.label]);
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);

    useEffect(() => {
        setProps(() => toChakraCheckbox(value));
    }, [value]);

    const handleCheckedChange = useCallback((e: CheckboxCheckedChangeDetails) => {
        setProps(prev => ({ ...prev, checked: e.checked }));
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(e.checked === true));
        }
    }, [onChangeFn]);

    return (
        <ChakraCheckbox.Root
            {...props}
            onCheckedChange={handleCheckedChange}
        >
            <ChakraCheckbox.HiddenInput />
            <ChakraCheckbox.Control />
            {label && <ChakraCheckbox.Label>{label}</ChakraCheckbox.Label>}
        </ChakraCheckbox.Root>
    );
}, (prev, next) => checkboxEqual(prev.value, next.value));
