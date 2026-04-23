/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import { usePersistedState } from "../../hooks/usePersistedState";
import {
    Accordion as ChakraAccordion,
    type AccordionRootProps,
    type AccordionItemProps,
} from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Accordion } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const accordionEqual = equalFor(Accordion.Types.Accordion);
const accordionItemEqual = equalFor(Accordion.Types.Item);

/** East Accordion value type. */
export type AccordionValue = ValueTypeOf<typeof Accordion.Types.Accordion>;

/** East Accordion Item value type. */
export type AccordionItemValue = ValueTypeOf<typeof Accordion.Types.Item>;

/**
 * Derive visual Chakra props from the `style` sub-struct + main-level
 * config.  State (`value` / `defaultValue`) and behaviour (`onValueChange`)
 * are read from main in the component body.
 */
export function toChakraAccordionRoot(value: AccordionValue): AccordionRootProps {
    const style = getSomeorUndefined(value.style);
    return {
        multiple: getSomeorUndefined(value.multiple),
        collapsible: getSomeorUndefined(value.collapsible),
        variant: style ? getSomeorUndefined(style.variant)?.type : undefined,
        size: style ? (getSomeorUndefined(style.size)?.type as AccordionRootProps["size"]) : undefined,
    };
}

export function toChakraAccordionItem(value: AccordionItemValue): AccordionItemProps {
    return {
        value: value.value,
        disabled: getSomeorUndefined(value.disabled),
    };
}

export interface EastChakraAccordionItemProps {
    value: AccordionItemValue;
    storageKey: string;
    triggerBackground?: string | undefined;
    triggerHoverBackground?: string | undefined;
    contentBackground?: string | undefined;
    borderColor?: string | undefined;
}

/**
 * Renders an East UI Accordion Item. The rich `trigger` (UIComponentType)
 * is dispatched through `EastChakraComponent`.
 */
export const EastChakraAccordionItem = memo(function EastChakraAccordionItem({
    value,
    storageKey,
    triggerBackground,
    triggerHoverBackground,
    contentBackground,
    borderColor,
}: EastChakraAccordionItemProps) {
    const props = useMemo(() => toChakraAccordionItem(value), [value]);

    return (
        <ChakraAccordion.Item
            {...props}
            borderColor={borderColor}
        >
            <ChakraAccordion.ItemTrigger
                {...(triggerBackground !== undefined ? { bg: triggerBackground } : {})}
                {...(triggerHoverBackground !== undefined ? { _hover: { bg: triggerHoverBackground } } : {})}
            >
                <EastChakraComponent
                    value={value.trigger}
                    storageKey={`${storageKey}.trigger`}
                />
                <ChakraAccordion.ItemIndicator />
            </ChakraAccordion.ItemTrigger>
            <ChakraAccordion.ItemContent bg={contentBackground}>
                {value.content.map((child, index) => (
                    <EastChakraComponent
                        key={index}
                        value={child}
                        storageKey={`${storageKey}.${index}`}
                    />
                ))}
            </ChakraAccordion.ItemContent>
        </ChakraAccordion.Item>
    );
}, (prev, next) => accordionItemEqual(prev.value, next.value)
    && prev.storageKey === next.storageKey
    && prev.triggerBackground === next.triggerBackground
    && prev.triggerHoverBackground === next.triggerHoverBackground
    && prev.contentBackground === next.contentBackground
    && prev.borderColor === next.borderColor,
);

interface AccordionPersistedState {
    expandedValues: string[];
}

export interface EastChakraAccordionProps {
    value: AccordionValue;
    storageKey: string;
}

/**
 * Renders an East UI Accordion. `multiple` / `collapsible` (config),
 * `value` / `defaultValue` (state), and `onValueChange` (behaviour) come
 * from main; visual presets + colour slots come from `value.style`.
 */
export const EastChakraAccordion = memo(function EastChakraAccordion({ value, storageKey }: EastChakraAccordionProps) {
    const rootProps = useMemo(() => toChakraAccordionRoot(value), [value]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const onValueChangeFn = useMemo(
        () => getSomeorUndefined(value.onValueChange),
        [value.onValueChange],
    );

    const defaultValue = useMemo(() => {
        const dv = getSomeorUndefined(value.defaultValue);
        return dv ? [...dv] : undefined;
    }, [value.defaultValue]);

    const controlledValue = useMemo(() => {
        const cv = getSomeorUndefined(value.value);
        return cv ? [...cv] : undefined;
    }, [value.value]);

    const { state: persistedState, setState: setPersistedState } = usePersistedState<AccordionPersistedState>(
        storageKey,
        { expandedValues: defaultValue ?? [] },
    );

    const handleValueChange = useCallback((details: { value: string[] }) => {
        setPersistedState(prev => ({ ...prev, expandedValues: details.value }));
        if (onValueChangeFn) {
            queueMicrotask(() => onValueChangeFn(details.value));
        }
    }, [onValueChangeFn, setPersistedState]);

    const effectiveValue = controlledValue ?? persistedState.expandedValues;

    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const triggerBackground = style ? getSomeorUndefined(style.triggerBackground) : undefined;
    const triggerHoverBackground = style ? getSomeorUndefined(style.triggerHoverBackground) : undefined;
    const contentBackground = style ? getSomeorUndefined(style.contentBackground) : undefined;

    return (
        <ChakraAccordion.Root
            {...rootProps}
            value={effectiveValue}
            onValueChange={handleValueChange}
            bg={background}
        >
            {value.items.map((item, index) => (
                <EastChakraAccordionItem
                    key={item.value || index}
                    value={item}
                    storageKey={`${storageKey}.${index}`}
                    triggerBackground={triggerBackground}
                    triggerHoverBackground={triggerHoverBackground}
                    contentBackground={contentBackground}
                    borderColor={borderColor}
                />
            ))}
        </ChakraAccordion.Root>
    );
}, (prev, next) => accordionEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
