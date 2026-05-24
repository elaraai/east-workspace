/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Menu as ChakraMenu, Portal } from "@chakra-ui/react";
import { equalFor, match, type ValueTypeOf } from "@elaraai/east";
import { Menu } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

// Pre-define equality function at module level
const menuEqual = equalFor(Menu.Types.Menu);

/** East Menu value type */
export type MenuValue = ValueTypeOf<typeof Menu.Types.Menu>;

/** East MenuItem value type */
export type MenuItemValue = ValueTypeOf<typeof Menu.Types.Item>;

export interface EastChakraMenuProps {
    value: MenuValue;
    storageKey: string;
}

/**
 * Renders an East UI Menu value using Chakra UI Menu component.
 */
export const EastChakraMenu = memo(function EastChakraMenu({ value, storageKey }: EastChakraMenuProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const placement = useMemo(
        () => (style ? getSomeorUndefined(style.placement)?.type : undefined),
        [style],
    );

    return (
        <ChakraMenu.Root positioning={placement ? { placement } : undefined}>
            <ChakraMenu.Trigger asChild>
                <span style={{ display: "inline-flex" }}>
                    <EastChakraComponent value={value.trigger} storageKey={`${storageKey}.trigger`} />
                </span>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content minW="220px" padding="4px" fontSize="13px">
                        {value.items.map((item, index) =>
                            match(item, {
                                Item: (v) => (
                                    <ChakraMenu.Item
                                        key={index}
                                        value={v.value}
                                        disabled={getSomeorUndefined(v.disabled)}
                                    >
                                        {v.label}
                                    </ChakraMenu.Item>
                                ),
                                Separator: () => <ChakraMenu.Separator key={index} />,
                            })
                        )}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}, (prev, next) => menuEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
