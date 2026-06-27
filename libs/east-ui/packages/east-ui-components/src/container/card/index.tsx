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
import { Card } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { DensityProvider } from "../../contracts/density.js";

const cardEqual = equalFor(Card.Types.Card);

/** East Card value type. */
export type CardValue = ValueTypeOf<typeof Card.Types.Card>;

/**
 * Convert an East UI Card value's `style` sub-struct into Chakra CardRootProps.
 *
 * @remarks
 * Layout / dimension fields pass through via Chakra's style-prop system. Colour
 * slots (`background`, `borderColor`) and the accent stripe are spread onto the
 * root in the renderer body rather than here so they can coexist with
 * state-driven overrides (e.g. `disabled` opacity). The card has one shape —
 * no preset or shadow props.
 */
export function toChakraCard(value: CardValue): CardRootProps {
    const style = getSomeorUndefined(value.style);

    return {
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

    const localDensity = useMemo(() => getSomeorUndefined(value.density)?.type, [value.density]);

    const style = getSomeorUndefined(value.style);
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const headerBackground = style ? getSomeorUndefined(style.headerBackground) : undefined;
    const footerBackground = style ? getSomeorUndefined(style.footerBackground) : undefined;
    const accentColor = style ? getSomeorUndefined(style.accentColor) : undefined;
    // Body padding: `flush` ⇒ full-bleed (0) for Planner/Table/Chart/Map;
    // else explicit `bodyPadding`; else the default 18×20 (#132).
    const bodyPadding = style ? getSomeorUndefined(style.bodyPadding) : undefined;
    const flush = (style ? getSomeorUndefined(style.flush) : undefined) === true;

    const isDisabled = stateTag === "disabled";
    const isStale = stateTag === "stale";
    const hasFallbackBody = stateTag === "loading" || stateTag === "empty"
        || stateTag === "error" || stateTag === "permission-denied";

    // The one container shape: 1px subtle border, 10px radius, no shadow.
    const defaultBorderColor = borderColor ?? "border.subtle";

    const content = (
        <ChakraCard.Root
            {...props}
            borderRadius="10px"
            borderColor={defaultBorderColor}
            borderWidth="1px"
            overflow="hidden"
            {...(background !== undefined ? { bg: background } : {})}
            {...(accentColor !== undefined ? { borderLeftWidth: "3px", borderLeftColor: accentColor } : {})}
            aria-disabled={isDisabled || undefined}
            opacity={isDisabled ? 0.5 : undefined}
            position={isStale ? "relative" : undefined}
        >
            {/* Header — bsys eyebrow-row: paper-2 fill, 12×18, bottom hairline.
                Card.Header supplies the styled eyebrow / title / meta content. */}
            {header && (
                <ChakraCard.Header
                    paddingY="12px"
                    paddingX="18px"
                    borderBottomWidth="1px"
                    borderBottomColor={defaultBorderColor}
                    bg={headerBackground ?? "bg.canvas"}
                    display="flex"
                    flexDirection="column"
                    gap="1"
                    fontFamily="mono"
                    fontSize="11px"
                >
                    <EastChakraComponent value={header} storageKey={`${storageKey}.header`} />
                </ChakraCard.Header>
            )}
            {isStale && (
                <ChakraBox layerStyle="banner.stale" borderRadius="0" display="flex" alignItems="center" gap="2">
                    <ChakraBox as="span" color="fg.warning">
                        <FontAwesomeIcon icon={faClock} />
                    </ChakraBox>
                    <ChakraBox fontWeight="semibold" fontSize="sm">Stale data</ChakraBox>
                </ChakraBox>
            )}
            {/* Body — bsys Frame body: 18px padding, flex column so multiple
                children get breathing room rather than stacking flush. */}
            <ChakraCard.Body
                padding={flush ? "0" : (bodyPadding ?? "18px 20px")}
                display="flex"
                flexDirection="column"
                gap={flush ? "0" : "3"}
                opacity={isStale ? 0.6 : undefined}
            >
                {hasFallbackBody ? (
                    renderStateFallback(stateTag)
                ) : (
                    value.body.map((child, index) => (
                        <EastChakraComponent key={index} value={child} storageKey={`${storageKey}.${index}`} />
                    ))
                )}
            </ChakraCard.Body>
            {/* Footer — bsys Frame footer: 10×18, top hairline, paper-2 fill. */}
            {footer && (
                <ChakraCard.Footer
                    paddingY="10px"
                    paddingX="18px"
                    borderTopWidth="1px"
                    borderTopColor={defaultBorderColor}
                    bg={footerBackground ?? "bg.canvas"}
                    display="flex"
                    alignItems="center"
                    gap="3"
                >
                    <EastChakraComponent value={footer} storageKey={`${storageKey}.footer`} />
                </ChakraCard.Footer>
            )}
        </ChakraCard.Root>
    );

    return localDensity !== undefined
        ? <DensityProvider value={localDensity}>{content}</DensityProvider>
        : content;
}, (prev, next) => cardEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
