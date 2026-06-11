/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState, useEffect } from "react";
import { SegmentGroup as ChakraSegmentGroup, type SegmentGroupRootProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { SegmentGroup } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const segmentGroupEqual = equalFor(SegmentGroup.Types.SegmentGroup);

export type SegmentGroupValue = ValueTypeOf<typeof SegmentGroup.Types.SegmentGroup>;

/**
 * Map main-level style presets to Chakra root props (value wired separately
 * via local state so the widget works uncontrolled).
 */
export function toChakraSegmentGroup(value: SegmentGroupValue): Omit<SegmentGroupRootProps, "value"> {
    const style = getSomeorUndefined(value.style);
    return {
        size: style ? getSomeorUndefined(style.size)?.type : undefined,
        colorPalette: style ? getSomeorUndefined(style.colorPalette)?.type : undefined,
        orientation: style ? getSomeorUndefined(style.orientation)?.type : undefined,
    };
}

export interface EastChakraSegmentGroupProps {
    value: SegmentGroupValue;
    storageKey?: string;
}

/**
 * Renders an East UI SegmentGroup using Chakra v3's compound primitive.
 *
 * @remarks
 * Item `label` is a UIComponentType dispatched through `EastChakraComponent`.
 * State (`value`) + behaviour (`onChange`) come from main; visual presets
 * + colour slots come from `value.style`.
 */
export const EastChakraSegmentGroup = memo(function EastChakraSegmentGroup({ value, storageKey }: EastChakraSegmentGroupProps) {
    const rootProps = useMemo(() => toChakraSegmentGroup(value), [value]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const [localValue, setLocalValue] = useState<string>(value.value);
    useEffect(() => { setLocalValue(value.value); }, [value.value]);

    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);

    const handleValueChange = useCallback((details: { value: string | null }) => {
        if (details.value === null) return;
        const next = details.value;
        setLocalValue(next);
        if (onChangeFn) queueMicrotask(() => onChangeFn(next));
    }, [onChangeFn]);

    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const activeBackground = style ? getSomeorUndefined(style.activeBackground) : undefined;
    const activeColor = style ? getSomeorUndefined(style.activeColor) : undefined;
    const inactiveColor = style ? getSomeorUndefined(style.inactiveColor) : undefined;

    return (
        <ChakraSegmentGroup.Root
            {...rootProps}
            value={localValue}
            onValueChange={handleValueChange}
            {...(background !== undefined ? { bg: background } : {})}
            {...(borderColor !== undefined ? { borderColor } : {})}
        >
            <ChakraSegmentGroup.Indicator
                {...(activeBackground !== undefined ? { bg: activeBackground } : {})}
            />
            {value.items.map((item, index) => (
                <ChakraSegmentGroup.Item
                    key={item.value}
                    value={item.value}
                    disabled={getSomeorUndefined(item.disabled)}
                    {...(inactiveColor !== undefined ? { color: inactiveColor } : {})}
                    {...(activeColor !== undefined ? { _checked: { color: activeColor } } : {})}
                >
                    <ChakraSegmentGroup.ItemText>
                        <EastChakraComponent
                            value={item.label}
                            storageKey={`${storageKey ?? ""}.items.${index}`}
                        />
                    </ChakraSegmentGroup.ItemText>
                    <ChakraSegmentGroup.ItemHiddenInput />
                </ChakraSegmentGroup.Item>
            ))}
        </ChakraSegmentGroup.Root>
    );
}, (prev, next) => segmentGroupEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
