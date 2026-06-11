/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState, useEffect } from "react";
import { Switch as ChakraSwitch, type SwitchCheckedChangeDetails, type SwitchRootProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Switch } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";

// Pre-define equality function at module level
const switchEqual = equalFor(Switch.Types.Switch);

/** East Switch value type */
export type SwitchValue = ValueTypeOf<typeof Switch.Types.Switch>;

/**
 * Converts an East UI Switch value to Chakra UI Switch props.
 * Pure function - easy to test independently.
 */
export function toChakraSwitch(value: SwitchValue): SwitchRootProps {
    const style = getSomeorUndefined(value.style);
    const colorPalette = style ? getSomeorUndefined(style.colorPalette)?.type : undefined;
    const size = style ? getSomeorUndefined(style.size)?.type : undefined;

    return {
        checked: value.checked,
        disabled: getSomeorUndefined(value.disabled),
        colorPalette: colorPalette ?? "brand",
        size,
    };
}

export interface EastChakraSwitchProps {
    value: SwitchValue;
}

/**
 * Renders an East UI Switch value using Chakra UI Switch component.
 */
export const EastChakraSwitch = memo(function EastChakraSwitch({ value }: EastChakraSwitchProps) {
    const [props, setProps] = useState(toChakraSwitch(value));
    const label = useMemo(() => getSomeorUndefined(value.label), [value.label]);
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);

    useEffect(() => {
        setProps(() => toChakraSwitch(value));
    }, [value]);

    const handleCheckedChange = useCallback((e: SwitchCheckedChangeDetails) => {
        setProps(prev => ({ ...prev, checked: e.checked }));
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(e.checked));
        }
    }, [onChangeFn]);

    return (
        <ChakraSwitch.Root
            {...props}
            onCheckedChange={handleCheckedChange}
        >
            <ChakraSwitch.HiddenInput />
            <ChakraSwitch.Control />
            {label && <ChakraSwitch.Label>{label}</ChakraSwitch.Label>}
        </ChakraSwitch.Root>
    );
}, (prev, next) => switchEqual(prev.value, next.value));
