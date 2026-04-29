/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useMemo } from "react";
import { Box, Flex, Text } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { NavList } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

const navListEqual = equalFor(NavList.Types.NavList);

export type NavListValue = ValueTypeOf<typeof NavList.Types.NavList>;

export interface EastChakraNavListProps {
    value: NavListValue;
}

/**
 * Renders an East UI NavList — grouped section nav with optional
 * section labels, per-item icon and badge, active highlighting.
 */
export const EastChakraNavList = memo(function EastChakraNavList({ value }: EastChakraNavListProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const orientationTag = style ? getSomeorUndefined(style.orientation)?.type : undefined;
    const isHorizontal = orientationTag === "horizontal";

    const sectionLabelColor = style ? getSomeorUndefined(style.sectionLabelColor) : undefined;
    const itemColor = style ? getSomeorUndefined(style.itemColor) : undefined;
    const itemHoverBackground = style ? getSomeorUndefined(style.itemHoverBackground) : undefined;
    const activeColor = style ? getSomeorUndefined(style.activeColor) : undefined;
    const activeBackground = style ? getSomeorUndefined(style.activeBackground) : undefined;
    const activeIndicatorColor = style ? getSomeorUndefined(style.activeIndicatorColor) : undefined;
    const badgeBackground = style ? getSomeorUndefined(style.badgeBackground) : undefined;
    const badgeColor = style ? getSomeorUndefined(style.badgeColor) : undefined;

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
                align="center"
                gap="2"
                px="3"
                py="2"
                width={isHorizontal ? "auto" : "full"}
                borderRadius="sm"
                bg={active ? (activeBackground ?? "bg.subtle") : "transparent"}
                color={active ? activeColor : itemColor}
                fontSize="sm"
                fontWeight={active ? "medium" : "normal"}
                cursor="pointer"
                position="relative"
                transition="background 120ms ease"
                _hover={{ bg: active ? (activeBackground ?? "bg.subtle") : (itemHoverBackground ?? "bg.subtle") }}
                aria-current={active ? "page" : undefined}
            >
                {active && activeIndicatorColor && !isHorizontal && (
                    <Box
                        position="absolute"
                        left="0"
                        top="1"
                        bottom="1"
                        width="2px"
                        bg={activeIndicatorColor}
                        borderRadius="sm"
                    />
                )}
                {icon && (
                    <Box as="span" display="inline-flex" alignItems="center" justifyContent="center" width="4" height="4">
                        <i className={`${icon.prefix} fa-${icon.name}`} />
                    </Box>
                )}
                <Text flex="1" textAlign="left" lineClamp={1}>{item.label}</Text>
                {badge && (
                    <Box
                        as="span"
                        bg={badgeBackground ?? "bg.muted"}
                        color={badgeColor ?? "fg.muted"}
                        fontSize="xs"
                        fontWeight="medium"
                        borderRadius="full"
                        px="2"
                        py="0.5"
                        minWidth="5"
                        textAlign="center"
                    >
                        {badge}
                    </Box>
                )}
            </Flex>
        );
    };

    const Container = isHorizontal ? Flex : Box;
    const containerProps = isHorizontal
        ? { gap: "1" as const, flexWrap: "wrap" as const }
        : {};

    return (
        <Container {...containerProps} role="navigation" width={isHorizontal ? "auto" : "full"}>
            {value.sections.map((section, sectionIdx) => {
                const label = getSomeorUndefined(section.label);
                return (
                    <Box key={`${label ?? "_"}-${sectionIdx}`} mb={isHorizontal ? "0" : "3"}>
                        {label && !isHorizontal && (
                            <Text
                                fontSize="xs"
                                fontWeight="medium"
                                color={sectionLabelColor ?? "fg.muted"}
                                px="3"
                                py="1"
                                textTransform="uppercase"
                                letterSpacing="wide"
                            >
                                {label}
                            </Text>
                        )}
                        {isHorizontal ? (
                            <Flex gap="1" flexWrap="wrap">
                                {section.items.map(renderItem)}
                            </Flex>
                        ) : (
                            <Box>
                                {section.items.map(renderItem)}
                            </Box>
                        )}
                    </Box>
                );
            })}
        </Container>
    );
}, (prev, next) => navListEqual(prev.value, next.value));
