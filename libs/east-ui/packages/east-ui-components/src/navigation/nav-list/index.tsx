/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useMemo } from "react";
import { Box, Flex, Text, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library, type IconName, type IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { far } from "@fortawesome/free-regular-svg-icons";
import { fab } from "@fortawesome/free-brands-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { NavList } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

library.add(fas, far, fab);

const navListEqual = equalFor(NavList.Types.NavList);

export type NavListValue = ValueTypeOf<typeof NavList.Types.NavList>;

export interface EastChakraNavListProps {
    value: NavListValue;
}

/**
 * Renders an East UI NavList as the bsys Sidebar recipe — mono uppercase
 * rows, brand-tint active state with a 3 px brand-d left rule, paper-2
 * card chrome.
 */
export const EastChakraNavList = memo(function EastChakraNavList({ value }: EastChakraNavListProps) {
    const recipe = useSlotRecipe({ key: "navList" });
    const styles = recipe();

    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);

    const handleSelect = useCallback((key: string) => {
        if (onSelectFn) {
            queueMicrotask(() => onSelectFn(key));
        }
    }, [onSelectFn]);

    const renderItem = (item: NavListValue["sections"][number]["items"][number]) => {
        const active = getSomeorUndefined(item.active) ?? false;
        const icon = getSomeorUndefined(item.icon);
        const badge = getSomeorUndefined(item.badge);

        return (
            <Flex
                key={item.key}
                as="button"
                role="button"
                onClick={() => handleSelect(item.key)}
                css={styles.item}
                aria-current={active ? "page" : undefined}
            >
                {icon && (
                    <Box as="span" css={styles.itemIcon}>
                        <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} />
                    </Box>
                )}
                <Text as="span" css={styles.itemText}>{item.label}</Text>
                {badge && (
                    <Box as="span" css={styles.badge}>{badge}</Box>
                )}
            </Flex>
        );
    };

    return (
        <Box css={styles.root} role="navigation">
            {value.sections.map((section, sectionIdx) => {
                const label = getSomeorUndefined(section.label);
                return (
                    <Box key={`${label ?? "_"}-${sectionIdx}`} css={styles.group}>
                        {label && (
                            <Text as="div" css={styles.groupLabel}>{label}</Text>
                        )}
                        {section.items.map(renderItem)}
                    </Box>
                );
            })}
        </Box>
    );
}, (prev, next) => navListEqual(prev.value, next.value));
