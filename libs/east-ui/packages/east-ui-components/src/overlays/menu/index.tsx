/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Box as ChakraBox, Menu as ChakraMenu, Portal, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { type IconName } from "@fortawesome/fontawesome-svg-core";
import { equalFor, match, type ValueTypeOf } from "@elaraai/east";
import { Menu } from "@elaraai/east-ui/internal";
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
    const menuStyles = useSlotRecipe({ key: "menu" })();

    return (
        <ChakraMenu.Root positioning={placement ? { placement } : undefined}>
            <ChakraMenu.Trigger asChild>
                <span style={{ display: "inline-flex" }}>
                    <EastChakraComponent value={value.trigger} storageKey={`${storageKey}.trigger`} />
                </span>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        {value.items.map((item, index) =>
                            match(item, {
                                Item: (v) => {
                                    const icon = getSomeorUndefined(v.icon);
                                    const command = getSomeorUndefined(v.command);
                                    const destructive = getSomeorUndefined(v.destructive);
                                    return (
                                        <ChakraMenu.Item
                                            key={index}
                                            value={v.value}
                                            disabled={getSomeorUndefined(v.disabled)}
                                            {...(destructive ? { "data-destructive": "" } : {})}
                                        >
                                            {icon && (
                                                <ChakraBox as="span" css={menuStyles.itemIndicator}>
                                                    <FontAwesomeIcon icon={["fas", icon as IconName]} />
                                                </ChakraBox>
                                            )}
                                            {v.label}
                                            {/* Chakra's Menu.ItemCommand renders a Kbd pill; the
                                                spec wants plain right-aligned mono text. */}
                                            {command && <ChakraBox as="span" css={menuStyles.itemCommand}>{command}</ChakraBox>}
                                        </ChakraMenu.Item>
                                    );
                                },
                                // Ark's Menu.ItemGroupLabel requires an ItemGroup
                                // ancestor; flat group headings take the recipe
                                // slot styles directly instead.
                                GroupLabel: (v) => (
                                    <ChakraBox key={index} css={menuStyles.itemGroupLabel}>
                                        {v.label}
                                    </ChakraBox>
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
