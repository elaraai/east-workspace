/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Enforcement:
 *   - Marker glyphs (`check` / `dash` / `icon`): IR factory + this renderer.
 *     check / dash render real <FontAwesomeIcon role="img" aria-label="…" />
 *     (not CSS ::before characters) per §0.2 a11y contract.
 */

import { memo, useMemo, type ReactNode } from "react";
import { List as ChakraList, type ListRootProps, Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faMinus } from "@fortawesome/free-solid-svg-icons";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { List } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const listEqual = equalFor(List.Types.List);

/** East List value type */
export type ListValue = ValueTypeOf<typeof List.Types.List>;

type MarkerKind =
    | "disc"
    | "circle"
    | "square"
    | "decimal"
    | "none"
    | "check"
    | "dash"
    | "icon";

interface MarkerInfo {
    kind: MarkerKind;
    icon?: { prefix: IconPrefix; name: IconName; label: string };
}

export interface ListDispatchProps {
    as: "ol" | "ul";
    rootProps: ListRootProps;
    marker: MarkerInfo;
    markerColor: string | undefined;
    itemColor: string | undefined;
}

/**
 * Converts the container-level fields of a List value into Chakra props plus
 * the derived marker info consumed by the renderer. Pure function.
 */
export function toChakraList(value: ListValue): ListDispatchProps {
    const style = getSomeorUndefined(value.style);
    const variantTag = style ? getSomeorUndefined(style.variant)?.type : undefined;
    const padding = style ? getSomeorUndefined(style.padding) : undefined;
    const margin = style ? getSomeorUndefined(style.margin) : undefined;

    const markerVariant = style ? getSomeorUndefined(style.marker) : undefined;
    const markerKind = (markerVariant?.type as MarkerKind | undefined) ?? (variantTag === "ordered" ? "decimal" : "disc");

    let markerInfo: MarkerInfo;
    if (markerKind === "icon" && markerVariant?.type === "icon") {
        const iconValue = markerVariant.value as {
            prefix: string;
            name: string;
            style?: unknown;
        };
        // Best-effort label — for authors who've set up the icon with a label
        // field, fall back to the icon's `name` as a reasonable aria-label.
        markerInfo = {
            kind: "icon",
            icon: {
                prefix: iconValue.prefix as IconPrefix,
                name: iconValue.name as IconName,
                label: iconValue.name,
            },
        };
    } else if (markerKind === "check") {
        markerInfo = {
            kind: "check",
            icon: { prefix: "fas", name: "check", label: "completed" },
        };
    } else if (markerKind === "dash") {
        markerInfo = {
            kind: "dash",
            icon: { prefix: "fas", name: "minus", label: "issue" },
        };
    } else {
        markerInfo = { kind: markerKind };
    }

    const rootProps: ListRootProps = {
        gap: style ? getSomeorUndefined(style.gap) : undefined,
        colorPalette: style ? getSomeorUndefined(style.colorPalette) : undefined,
        ps: markerInfo.icon ? "0" : "5",
        listStyleType: markerInfo.icon ? "none" : undefined,
        overflow: style ? getSomeorUndefined(style.overflow)?.type : undefined,
        overflowX: style ? getSomeorUndefined(style.overflowX)?.type : undefined,
        overflowY: style ? getSomeorUndefined(style.overflowY)?.type : undefined,
        width: style ? getSomeorUndefined(style.width) : undefined,
        height: style ? getSomeorUndefined(style.height) : undefined,
        minWidth: style ? getSomeorUndefined(style.minWidth) : undefined,
        minHeight: style ? getSomeorUndefined(style.minHeight) : undefined,
        maxWidth: style ? getSomeorUndefined(style.maxWidth) : undefined,
        maxHeight: style ? getSomeorUndefined(style.maxHeight) : undefined,
        pt: padding ? getSomeorUndefined(padding.top) : undefined,
        pr: padding ? getSomeorUndefined(padding.right) : undefined,
        pb: padding ? getSomeorUndefined(padding.bottom) : undefined,
        pl: padding ? getSomeorUndefined(padding.left) : undefined,
        mt: margin ? getSomeorUndefined(margin.top) : undefined,
        mr: margin ? getSomeorUndefined(margin.right) : undefined,
        mb: margin ? getSomeorUndefined(margin.bottom) : undefined,
        ml: margin ? getSomeorUndefined(margin.left) : undefined,
        opacity: style ? getSomeorUndefined(style.opacity) : undefined,
    };

    return {
        as: variantTag === "ordered" ? "ol" : "ul",
        rootProps,
        marker: markerInfo,
        markerColor: style ? getSomeorUndefined(style.markerColor) : undefined,
        itemColor: style ? getSomeorUndefined(style.color) : undefined,
    };
}

export interface EastChakraListProps {
    value: ListValue;
    storageKey?: string;
}

/**
 * Renders an East UI List value using Chakra UI List component.
 *
 * Each item is a `UIComponentType` and is dispatched through
 * `EastChakraComponent`. Custom markers (`check` / `dash` / `icon`) render
 * real accessible SVG glyphs via `<FontAwesomeIcon role="img" aria-label="…">`
 * and bypass the native `list-style` — the renderer composes an HStack of
 * (icon, content) inside each `<li>`.
 */
export const EastChakraList = memo(function EastChakraList({ value, storageKey }: EastChakraListProps) {
    const props = useMemo(() => toChakraList(value), [value]);

    const renderItem = (child: ValueTypeOf<typeof List.Types.List>["items"][number], index: number): ReactNode => {
        const content = (
            <EastChakraComponent
                value={child}
                storageKey={`${storageKey ?? ""}.items.${index}`}
            />
        );

        if (!props.marker.icon) {
            return (
                <ChakraList.Item key={index} color={props.itemColor}>
                    {content}
                </ChakraList.Item>
            );
        }

        return (
            <ChakraList.Item
                key={index}
                display="flex"
                gap="2"
                alignItems="baseline"
                color={props.itemColor}
            >
                <Box
                    as="span"
                    color={props.markerColor}
                    display="inline-flex"
                    flexShrink={0}
                    aria-hidden={false}
                >
                    <FontAwesomeIcon
                        icon={[props.marker.icon.prefix, props.marker.icon.name] as [IconPrefix, IconName]}
                        role="img"
                        aria-label={props.marker.icon.label}
                    />
                </Box>
                <Box as="span" flex="1">{content}</Box>
            </ChakraList.Item>
        );
    };

    return (
        <ChakraList.Root as={props.as} {...props.rootProps}>
            {value.items.map(renderItem)}
        </ChakraList.Root>
    );
}, (prev, next) => listEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

// Re-export static helpers for convenience.
export const listMarkers = { check: faCheck, dash: faMinus };
