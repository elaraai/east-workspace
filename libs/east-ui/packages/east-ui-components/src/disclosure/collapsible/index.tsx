/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import { Collapsible as ChakraCollapsible, Box as ChakraBox, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Collapsible } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const collapsibleEqual = equalFor(Collapsible.Types.Collapsible);

export type CollapsibleValue = ValueTypeOf<typeof Collapsible.Types.Collapsible>;

export interface EastChakraCollapsibleProps {
    value: CollapsibleValue;
    storageKey?: string;
}

/**
 * Renders an East UI Collapsible using Chakra v3's Collapsible compound.
 */
export const EastChakraCollapsible = memo(function EastChakraCollapsible({ value, storageKey }: EastChakraCollapsibleProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const defaultOpen = getSomeorUndefined(value.defaultOpen);
    const onOpenChangeFn = useMemo(() => getSomeorUndefined(value.onOpenChange), [value.onOpenChange]);

    const handleOpenChange = useCallback((details: { open: boolean }) => {
        if (onOpenChangeFn) {
            queueMicrotask(() => onOpenChangeFn(details.open));
        }
    }, [onOpenChangeFn]);

    const styles = useSlotRecipe({ key: "collapsible" })();

    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const triggerColor = style ? getSomeorUndefined(style.triggerColor) : undefined;
    const contentColor = style ? getSomeorUndefined(style.contentColor) : undefined;

    return (
        <ChakraCollapsible.Root
            defaultOpen={defaultOpen}
            onOpenChange={handleOpenChange}
            {...(background !== undefined ? { bg: background } : {})}
            {...(borderColor !== undefined ? { borderColor } : {})}
        >
            <ChakraCollapsible.Trigger
                {...(triggerColor !== undefined ? { color: triggerColor } : {})}
            >
                <ChakraBox as="span" cursor="pointer" display="inline-flex" alignItems="center" gap="2">
                    <ChakraBox as="span" css={styles.indicator} data-collapsible-chevron="true">
                        <FontAwesomeIcon icon={faChevronDown} />
                    </ChakraBox>
                    <EastChakraComponent value={value.trigger} storageKey={`${storageKey ?? ""}.trigger`} />
                </ChakraBox>
            </ChakraCollapsible.Trigger>
            <ChakraCollapsible.Content
                {...(contentColor !== undefined ? { color: contentColor } : {})}
            >
                <EastChakraComponent value={value.content} storageKey={`${storageKey ?? ""}.content`} />
            </ChakraCollapsible.Content>
        </ChakraCollapsible.Root>
    );
}, (prev, next) => collapsibleEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
