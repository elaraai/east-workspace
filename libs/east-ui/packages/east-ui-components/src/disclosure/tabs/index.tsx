/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import { usePersistedState } from "../../hooks/usePersistedState";
import {
    Tabs as ChakraTabs,
    type TabsRootProps,
    type TabsTriggerProps,
    type TabsContentProps,
} from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Tabs } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const tabsEqual = equalFor(Tabs.Types.Tabs);
const tabsItemEqual = equalFor(Tabs.Types.Item);

/** East Tabs value type. */
export type TabsValue = ValueTypeOf<typeof Tabs.Types.Tabs>;

/** East Tabs Item value type. */
export type TabsItemValue = ValueTypeOf<typeof Tabs.Types.Item>;

/**
 * Derive visual Chakra props from the `style` sub-struct. State (`value` /
 * `defaultValue`) comes from main elsewhere.
 */
export function toChakraTabsRoot(value: TabsValue): TabsRootProps {
    const style = getSomeorUndefined(value.style);
    return {
        defaultValue: getSomeorUndefined(value.defaultValue),
        value: getSomeorUndefined(value.value),
        variant: style ? getSomeorUndefined(style.variant)?.type : undefined,
        size: style ? getSomeorUndefined(style.size)?.type : undefined,
        orientation: style ? getSomeorUndefined(style.orientation)?.type : undefined,
        activationMode: style ? getSomeorUndefined(style.activationMode)?.type : undefined,
        fitted: style ? getSomeorUndefined(style.fitted) : undefined,
        justify: style ? getSomeorUndefined(style.justify)?.type : undefined,
        lazyMount: style ? getSomeorUndefined(style.lazyMount) : undefined,
        unmountOnExit: style ? getSomeorUndefined(style.unmountOnExit) : undefined,
        colorPalette: style ? getSomeorUndefined(style.colorPalette)?.type : undefined,
    };
}

export function toChakraTabsTrigger(value: TabsItemValue): TabsTriggerProps {
    return {
        value: value.value,
        disabled: getSomeorUndefined(value.disabled),
    };
}

export function toChakraTabsContent(value: TabsItemValue): TabsContentProps {
    return { value: value.value };
}

export interface EastChakraTabsItemProps {
    value: TabsItemValue;
    storageKey: string;
    activeTriggerColor?: string | undefined;
    inactiveTriggerColor?: string | undefined;
    contentBackground?: string | undefined;
}

/**
 * Renders an East UI Tabs trigger. The rich `trigger` (UIComponentType) is
 * dispatched through `EastChakraComponent`.
 */
export const EastChakraTabsTrigger = memo(function EastChakraTabsTrigger({
    value,
    storageKey,
    activeTriggerColor,
    inactiveTriggerColor,
}: EastChakraTabsItemProps) {
    const props = useMemo(() => toChakraTabsTrigger(value), [value]);
    return (
        <ChakraTabs.Trigger
            {...props}
            {...(inactiveTriggerColor !== undefined ? { color: inactiveTriggerColor } : {})}
            {...(activeTriggerColor !== undefined ? { _selected: { color: activeTriggerColor } } : {})}
        >
            <EastChakraComponent
                value={value.trigger}
                storageKey={`${storageKey}.trigger`}
            />
        </ChakraTabs.Trigger>
    );
}, (prev, next) => tabsItemEqual(prev.value, next.value)
    && prev.storageKey === next.storageKey
    && prev.activeTriggerColor === next.activeTriggerColor
    && prev.inactiveTriggerColor === next.inactiveTriggerColor,
);

/**
 * Renders an East UI Tabs content.
 */
export const EastChakraTabsContent = memo(function EastChakraTabsContent({
    value,
    storageKey,
    contentBackground,
}: EastChakraTabsItemProps) {
    const props = useMemo(() => toChakraTabsContent(value), [value]);
    return (
        <ChakraTabs.Content
            {...props}
            {...(contentBackground !== undefined ? { bg: contentBackground } : {})}
        >
            {value.content.map((child, index) => (
                <EastChakraComponent key={index} value={child} storageKey={`${storageKey}.${index}`} />
            ))}
        </ChakraTabs.Content>
    );
}, (prev, next) => tabsItemEqual(prev.value, next.value)
    && prev.storageKey === next.storageKey
    && prev.contentBackground === next.contentBackground,
);

interface TabsPersistedState {
    selectedValue: string | undefined;
}

export interface EastChakraTabsProps {
    value: TabsValue;
    storageKey: string;
}

/**
 * Renders an East UI Tabs. `value` / `defaultValue` (state) and
 * `onValueChange` (behaviour) come from main; visual presets + colour
 * slots come from `value.style`.
 */
export const EastChakraTabs = memo(function EastChakraTabs({ value, storageKey }: EastChakraTabsProps) {
    const rootProps = useMemo(() => toChakraTabsRoot(value), [value]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const onValueChangeFn = useMemo(
        () => getSomeorUndefined(value.onValueChange),
        [value.onValueChange],
    );

    const defaultValue = useMemo(() => getSomeorUndefined(value.defaultValue), [value.defaultValue]);
    const controlledValue = useMemo(() => getSomeorUndefined(value.value), [value.value]);

    const { state: persistedState, setState: setPersistedState } = usePersistedState<TabsPersistedState>(
        storageKey,
        { selectedValue: defaultValue },
    );

    const handleValueChange = useCallback((details: { value: string }) => {
        setPersistedState(prev => ({ ...prev, selectedValue: details.value }));
        if (onValueChangeFn) {
            queueMicrotask(() => onValueChangeFn(details.value));
        }
    }, [onValueChangeFn, setPersistedState]);

    const effectiveValue = controlledValue ?? persistedState.selectedValue;

    const listBackground = style ? getSomeorUndefined(style.listBackground) : undefined;
    const indicatorColor = style ? getSomeorUndefined(style.indicatorColor) : undefined;
    const activeTriggerColor = style ? getSomeorUndefined(style.activeTriggerColor) : undefined;
    const inactiveTriggerColor = style ? getSomeorUndefined(style.inactiveTriggerColor) : undefined;
    const contentBackground = style ? getSomeorUndefined(style.contentBackground) : undefined;

    return (
        <ChakraTabs.Root
            {...rootProps}
            value={effectiveValue}
            onValueChange={handleValueChange}
        >
            <ChakraTabs.List
                {...(listBackground !== undefined ? { bg: listBackground } : {})}
            >
                {value.items.map((item, index) => (
                    <EastChakraTabsTrigger
                        key={item.value}
                        value={item}
                        storageKey={`${storageKey}.${index}`}
                        activeTriggerColor={activeTriggerColor}
                        inactiveTriggerColor={inactiveTriggerColor}
                    />
                ))}
                {indicatorColor !== undefined && (
                    <ChakraTabs.Indicator bg={indicatorColor} />
                )}
            </ChakraTabs.List>
            {value.items.map((item, index) => (
                <EastChakraTabsContent
                    key={item.value}
                    value={item}
                    storageKey={`${storageKey}.${index}`}
                    contentBackground={contentBackground}
                />
            ))}
        </ChakraTabs.Root>
    );
}, (prev, next) => tabsEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
