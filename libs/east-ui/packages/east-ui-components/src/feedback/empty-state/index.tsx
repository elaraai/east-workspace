/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { EmptyState as ChakraEmptyState, Box as ChakraBox } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { EmptyState } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const emptyStateEqual = equalFor(EmptyState.Types.EmptyState);

export type EmptyStateValue = ValueTypeOf<typeof EmptyState.Types.EmptyState>;

export interface EastChakraEmptyStateProps {
    value: EmptyStateValue;
    storageKey?: string;
}

/**
 * Renders an East UI EmptyState using Chakra v3's EmptyState compound.
 *
 * @remarks
 * Leading `icon` renders via FontAwesome. `title` / `description` / `actions`
 * are UIComp slots dispatched through `EastChakraComponent`.
 */
export const EastChakraEmptyState = memo(function EastChakraEmptyState({ value, storageKey }: EastChakraEmptyStateProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const icon = useMemo(() => getSomeorUndefined(value.icon), [value.icon]);
    const glyph = useMemo(() => getSomeorUndefined(value.glyph), [value.glyph]);
    const description = useMemo(() => getSomeorUndefined(value.description), [value.description]);
    const actions = useMemo(() => getSomeorUndefined(value.actions), [value.actions]);

    const size = style ? (getSomeorUndefined(style.size)?.type as "sm" | "md" | "lg" | undefined) : undefined;
    const color = style ? getSomeorUndefined(style.color) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const iconColor = style ? getSomeorUndefined(style.iconColor) : undefined;

    return (
        <ChakraEmptyState.Root
            {...(size !== undefined ? { size } : {})}
            {...(color !== undefined ? { color } : {})}
            {...(background !== undefined ? { bg: background } : {})}
            {...(borderColor !== undefined ? { borderColor, borderWidth: "1px" } : {})}
            colorPalette="brand"
            paddingInline="28px"
            paddingBlock="36px"
        >
            <ChakraEmptyState.Content>
                {glyph !== undefined ? (
                    <ChakraBox
                        fontFamily="mono"
                        fontSize="36px"
                        letterSpacing="0.1em"
                        color={iconColor ?? "border.strong"}
                        mb="3"
                        lineHeight="1"
                    >
                        {glyph}
                    </ChakraBox>
                ) : icon ? (
                    <ChakraEmptyState.Indicator
                        {...(iconColor !== undefined ? { color: iconColor } : {})}
                    >
                        <FontAwesomeIcon
                            icon={[icon.prefix as IconPrefix, icon.name as IconName]}
                        />
                    </ChakraEmptyState.Indicator>
                ) : null}
                <ChakraBox>
                    <ChakraEmptyState.Title fontSize="15px" fontWeight="semibold">
                        <EastChakraComponent
                            value={value.title}
                            storageKey={`${storageKey ?? ""}.title`}
                        />
                    </ChakraEmptyState.Title>
                    {description ? (
                        <ChakraEmptyState.Description fontSize="13.5px" color="fg.subtle">
                            <EastChakraComponent
                                value={description}
                                storageKey={`${storageKey ?? ""}.description`}
                            />
                        </ChakraEmptyState.Description>
                    ) : null}
                </ChakraBox>
                {actions ? (
                    <ChakraBox mt="4">
                        <EastChakraComponent
                            value={actions}
                            storageKey={`${storageKey ?? ""}.actions`}
                        />
                    </ChakraBox>
                ) : null}
            </ChakraEmptyState.Content>
        </ChakraEmptyState.Root>
    );
}, (prev, next) => emptyStateEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
