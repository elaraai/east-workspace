/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import {
    Card as ChakraCard,
    type CardRootProps,
    Box as ChakraBox,
    SkeletonText,
    Skeleton,
    EmptyState as ChakraEmptyState,
    Alert as ChakraAlert,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInbox, faTriangleExclamation, faLock, faClock } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Card } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const cardEqual = equalFor(Card.Types.Card);

/** East Card value type. */
export type CardValue = ValueTypeOf<typeof Card.Types.Card>;

/**
 * Convert an East UI Card value's `style` sub-struct into Chakra CardRootProps.
 *
 * @remarks
 * Visual presets (`variant` / `size`) map straight onto Chakra's root. Layout
 * / dimension fields pass through via Chakra's style-prop system. Colour
 * slots (`background`, `borderColor`) and the accent stripe are spread onto
 * the root in the renderer body rather than here so they can coexist with
 * state-driven overrides (e.g. `disabled` opacity).
 */
export function toChakraCard(value: CardValue): CardRootProps {
    const style = getSomeorUndefined(value.style);
    const size = style ? (getSomeorUndefined(style.size)?.type as CardRootProps["size"]) : undefined;

    return {
        variant: style ? getSomeorUndefined(style.variant)?.type : undefined,
        // Default to "sm" — modern enterprise UIs (Linear / Stripe / Notion) use
        // dense cards, not Chakra's generous "md" default. Callers can override
        // via `style.size`.
        size: size ?? "sm",
        height: style ? getSomeorUndefined(style.height) : undefined,
        minHeight: style ? getSomeorUndefined(style.minHeight) : undefined,
        maxHeight: style ? getSomeorUndefined(style.maxHeight) : undefined,
        width: style ? getSomeorUndefined(style.width) : undefined,
        minWidth: style ? getSomeorUndefined(style.minWidth) : undefined,
        maxWidth: style ? getSomeorUndefined(style.maxWidth) : undefined,
        flex: style ? getSomeorUndefined(style.flex) : undefined,
        overflow: style ? getSomeorUndefined(style.overflow)?.type : undefined,
    };
}

export interface EastChakraCardProps {
    value: CardValue;
    storageKey: string;
}

type StateTag = "ready" | "loading" | "empty" | "stale" | "error" | "disabled" | "permission-denied";

/**
 * Renders the fallback body that replaces the normal `value.body` when
 * `value.state` is anything other than `"ready"` per §0.1.
 */
function renderStateFallback(stateTag: StateTag): React.ReactElement | null {
    switch (stateTag) {
        case "loading":
            return (
                <ChakraBox p="3">
                    <Skeleton height="24px" width="60%" mb="3" />
                    <SkeletonText noOfLines={3} />
                </ChakraBox>
            );
        case "empty":
            return (
                <ChakraEmptyState.Root size="sm">
                    <ChakraEmptyState.Content>
                        <ChakraEmptyState.Indicator>
                            <FontAwesomeIcon icon={faInbox} />
                        </ChakraEmptyState.Indicator>
                        <ChakraBox>
                            <ChakraEmptyState.Title>No data</ChakraEmptyState.Title>
                            <ChakraEmptyState.Description>
                                There's nothing to show here yet.
                            </ChakraEmptyState.Description>
                        </ChakraBox>
                    </ChakraEmptyState.Content>
                </ChakraEmptyState.Root>
            );
        case "error":
            return (
                <ChakraAlert.Root status="error" variant="subtle" m="3">
                    <ChakraAlert.Indicator>
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                    </ChakraAlert.Indicator>
                    <ChakraAlert.Content>
                        <ChakraAlert.Title>Something went wrong</ChakraAlert.Title>
                        <ChakraAlert.Description>
                            This content failed to load.
                        </ChakraAlert.Description>
                    </ChakraAlert.Content>
                </ChakraAlert.Root>
            );
        case "permission-denied":
            return (
                <ChakraEmptyState.Root size="sm">
                    <ChakraEmptyState.Content>
                        <ChakraEmptyState.Indicator>
                            <FontAwesomeIcon icon={faLock} />
                        </ChakraEmptyState.Indicator>
                        <ChakraBox>
                            <ChakraEmptyState.Title>Access denied</ChakraEmptyState.Title>
                            <ChakraEmptyState.Description>
                                You don't have permission to view this content.
                            </ChakraEmptyState.Description>
                        </ChakraBox>
                    </ChakraEmptyState.Content>
                </ChakraEmptyState.Root>
            );
        default:
            return null;
    }
}

/**
 * Renders an East UI Card using Chakra v3's Card compound.
 *
 * @remarks
 * Dispatches on `value.state`:
 *
 * - `ready` (default) — renders `header` / `body` / `footer` normally.
 * - `loading` — Skeleton body; header still rendered when present.
 * - `empty` — Chakra `EmptyState` in the body; header still rendered.
 * - `error` — Chakra `Alert` (error status) in the body.
 * - `stale` — body renders at reduced opacity with a "Stale" banner above.
 * - `disabled` — body renders with `aria-disabled` + opacity 0.5.
 * - `permission-denied` — access-denied fallback in the body.
 *
 * Colour-slot escape hatches (`background` / `borderColor` /
 * `headerBackground` / `footerBackground` / `accentColor`) are applied
 * alongside the base Chakra variant.
 */
export const EastChakraCard = memo(function EastChakraCard({ value, storageKey }: EastChakraCardProps) {
    const props = useMemo(() => toChakraCard(value), [value]);
    const header = useMemo(() => getSomeorUndefined(value.header), [value.header]);
    const footer = useMemo(() => getSomeorUndefined(value.footer), [value.footer]);
    const state = getSomeorUndefined(value.state);
    const stateTag: StateTag = state?.type ?? "ready";

    const style = getSomeorUndefined(value.style);
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const headerBackground = style ? getSomeorUndefined(style.headerBackground) : undefined;
    const footerBackground = style ? getSomeorUndefined(style.footerBackground) : undefined;
    const accentColor = style ? getSomeorUndefined(style.accentColor) : undefined;
    const elevation = style ? getSomeorUndefined(style.elevation)?.type : undefined;

    const elevationShadowMap: Record<string, string | undefined> = {
        flat: "none",
        raised: "sm",
        overlay: "md",
        floating: "lg",
        modal: "xl",
    };
    const elevationShadow = elevation ? elevationShadowMap[elevation] : undefined;

    const isDisabled = stateTag === "disabled";
    const isStale = stateTag === "stale";
    const hasFallbackBody = stateTag === "loading" || stateTag === "empty"
        || stateTag === "error" || stateTag === "permission-denied";

    // Modern-enterprise defaults: always a subtle 1px border, subtle xs shadow
    // by default when no explicit elevation, snug header/body padding, hairline
    // separator between header and body.
    const defaultShadow = elevationShadow ?? "0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)";
    const defaultBorderColor = borderColor ?? "border.muted";

    return (
        <ChakraCard.Root
            {...props}
            borderColor={defaultBorderColor}
            borderWidth="1px"
            {...(background !== undefined ? { bg: background } : {})}
            boxShadow={defaultShadow}
            {...(accentColor !== undefined ? { borderLeftWidth: "3px", borderLeftColor: accentColor } : {})}
            aria-disabled={isDisabled || undefined}
            opacity={isDisabled ? 0.5 : undefined}
            position={isStale ? "relative" : undefined}
        >
            {header && (
                <ChakraCard.Header
                    py="2"
                    px="3"
                    borderBottomWidth="1px"
                    borderBottomColor={defaultBorderColor}
                    {...(headerBackground !== undefined ? { bg: headerBackground } : {})}
                >
                    <EastChakraComponent value={header} storageKey={`${storageKey}.header`} />
                </ChakraCard.Header>
            )}
            {isStale && (
                <ChakraAlert.Root status="warning" variant="subtle" borderRadius="0">
                    <ChakraAlert.Indicator>
                        <FontAwesomeIcon icon={faClock} />
                    </ChakraAlert.Indicator>
                    <ChakraAlert.Content>
                        <ChakraAlert.Title>Stale data</ChakraAlert.Title>
                    </ChakraAlert.Content>
                </ChakraAlert.Root>
            )}
            <ChakraCard.Body py="3" px="3" opacity={isStale ? 0.6 : undefined}>
                {hasFallbackBody ? (
                    renderStateFallback(stateTag)
                ) : (
                    value.body.map((child, index) => (
                        <EastChakraComponent key={index} value={child} storageKey={`${storageKey}.${index}`} />
                    ))
                )}
            </ChakraCard.Body>
            {footer && (
                <ChakraCard.Footer
                    py="2"
                    px="3"
                    borderTopWidth="1px"
                    borderTopColor={defaultBorderColor}
                    {...(footerBackground !== undefined ? { bg: footerBackground } : {})}
                >
                    <EastChakraComponent value={footer} storageKey={`${storageKey}.footer`} />
                </ChakraCard.Footer>
            )}
        </ChakraCard.Root>
    );
}, (prev, next) => cardEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
