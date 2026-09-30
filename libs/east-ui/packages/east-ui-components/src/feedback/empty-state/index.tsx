/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, type ReactNode } from "react";
import { EmptyState as ChakraEmptyState, Box as ChakraBox } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { EmptyState } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const emptyStateEqual = equivalentFor(EmptyState.Types.EmptyState);

export type EmptyStateValue = ValueTypeOf<typeof EmptyState.Types.EmptyState>;

export interface EastChakraEmptyStateProps {
    value: EmptyStateValue;
    storageKey?: string;
}

/**
 * Renders an East UI EmptyState — {@link EmptyStateView}, its `title`,
 * `description` and `actions` UIComponent slots dispatched through
 * `EastChakraComponent`.
 */
export const EastChakraEmptyState = memo(function EastChakraEmptyState({ value, storageKey }: EastChakraEmptyStateProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const icon = useMemo(() => getSomeorUndefined(value.icon), [value.icon]);
    const description = useMemo(() => getSomeorUndefined(value.description), [value.description]);
    const actions = useMemo(() => getSomeorUndefined(value.actions), [value.actions]);
    return (
        <EmptyStateView
            icon={icon}
            glyph={getSomeorUndefined(value.glyph)}
            size={style ? (getSomeorUndefined(style.size)?.type as "sm" | "md" | "lg" | undefined) : undefined}
            color={style ? getSomeorUndefined(style.color) : undefined}
            background={style ? getSomeorUndefined(style.background) : undefined}
            borderColor={style ? getSomeorUndefined(style.borderColor) : undefined}
            iconColor={style ? getSomeorUndefined(style.iconColor) : undefined}
            title={<EastChakraComponent value={value.title} storageKey={`${storageKey ?? ""}.title`} />}
            description={description ? <EastChakraComponent value={description} storageKey={`${storageKey ?? ""}.description`} /> : undefined}
            actions={actions ? <EastChakraComponent value={actions} storageKey={`${storageKey ?? ""}.actions`} /> : undefined}
        />
    );
}, (prev, next) => emptyStateEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link EmptyStateView}. */
export interface EmptyStateViewProps {
    /** Its title. */
    title: ReactNode;
    /** Its body, under the title. */
    description?: ReactNode;
    /** Its actions, under the body. */
    actions?: ReactNode;
    /** A Font Awesome icon, above the title. */
    icon?: { prefix: string; name: string } | undefined;
    /** A mono glyph above the title, in place of an icon. */
    glyph?: string | undefined;
    /** Its size preset. */
    size?: "sm" | "md" | "lg" | undefined;
    /** Its text colour. */
    color?: string | undefined;
    /** Its background. */
    background?: string | undefined;
    /** Its border colour, which draws its border. */
    borderColor?: string | undefined;
    /** The icon's or the glyph's colour. */
    iconColor?: string | undefined;
}

/**
 * The empty state as React — the EmptyState's renderer, and the empty state a
 * host renderer draws with words of its own: an icon or a glyph, a title, a
 * body and actions, on Chakra v3's EmptyState compound.
 *
 * @param props - What it says, and how ({@link EmptyStateViewProps})
 * @returns The empty state
 */
export function EmptyStateView({
    title, description, actions, icon, glyph, size, color, background, borderColor, iconColor,
}: EmptyStateViewProps) {
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
                        {title}
                    </ChakraEmptyState.Title>
                    {description !== undefined ? (
                        // A block, not Chakra's paragraph: the description is a
                        // component, and a Text is a paragraph of its own.
                        <ChakraEmptyState.Description as="div" fontSize="13.5px" color="fg.subtle">
                            {description}
                        </ChakraEmptyState.Description>
                    ) : null}
                </ChakraBox>
                {actions !== undefined ? (
                    <ChakraBox mt="4">{actions}</ChakraBox>
                ) : null}
            </ChakraEmptyState.Content>
        </ChakraEmptyState.Root>
    );
}
