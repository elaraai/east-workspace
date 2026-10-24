/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An item's card on the Schematic's canvas (#1387): its icon, its label and
 * its status's dot, its second line, its bar and its figure — while its
 * details row is read, a placeholder in each of their places (#1398) — placed
 * through the card layer's camera properties, so a camera move moves it with
 * no render. It renders again only as its item or how it stands moves —
 * selected, locked, dimmed by its layer, drawn as the narrowing's context, a
 * match's emphasis, a Connect's refused end, a drop's target — never as the
 * camera does (#1393): a pan where the items draw as cards works out no
 * card's styles again.
 *
 * @packageDocumentation
 */

import { memo } from "react";
import { Box, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { findIconDefinition, library, type IconName } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { PlaceholderShape } from "@elaraai/east-ui-components/internal";
import { cardTranslateCss, cardWidthCss } from "./camera";
import { statusUnread, type DrawnItem } from "./drawn";
import { itemTint, tintAttributes } from "./tints";
import type { SchematicNarrowedLook } from "../narrowing.js";

library.add(fas);

/** Whether an item's status shows as an open ring, as a tentative one does. */
function statusRing(status: DrawnItem["status"]): boolean {
    return status.type === "some" && status.value.ring;
}

/** Whether an item's card draws its dot: it has a status, or a colour of its own (D14). */
function hasDot(item: DrawnItem): boolean {
    return item.status.type === "some" || item.color.type === "some" || item.tone.type === "some";
}

/**
 * An item's placeholders' index, from its id (#1398): what keys their bars' widths, the same however the view moves, so
 * the pattern never crawls as cards come and go.
 */
function placeholderIndex(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 9973;
    return hash;
}

/** Props of {@link SchematicCard}: its item, and how it stands — each a value, so a card whose standing holds renders not. */
export interface SchematicCardProps {
    /** The item, as the canvas draws it: the same object while its rows read as they were. */
    readonly item: DrawnItem;
    /** The recipe's styles, resolved once a recipe. */
    readonly styles: Readonly<Record<string, SystemStyleObject>>;
    /** What hears the card's size as the page lays it out (#1403): a ref callback, the same one for every card. */
    readonly observe: (el: HTMLElement | null) => (() => void) | undefined;
    /** Whether it is selected, or a marquee in flight would select it. */
    readonly selected: boolean;
    /** Whether its layer is locked: it takes no pointer, and selects by no path (SC27). */
    readonly locked: boolean;
    /** Its layer's opacity, where its layer dims it. */
    readonly layerOpacity: number | undefined;
    /** Its opacity while it draws as the narrowing's context (#1392); `undefined` while it draws as itself. */
    readonly contextOpacity: number | undefined;
    /** Whether, drawn as context, it is greyed. */
    readonly desaturate: boolean;
    /** A match's emphasis, while it is a match the look rings. */
    readonly emphasis: SchematicNarrowedLook["emphasis"];
    /** Whether a Connect's draft would end on it, refused (SC9). */
    readonly forbidden: boolean;
    /** Whether a library card's drop lands on it (#1390). */
    readonly dropTarget: boolean;
}

/**
 * An item's card (see the module docs): no `onClick` and no `stopPropagation`, as a drag-pan can start on a card, and
 * the canvas resolves a tap on it as it lets go.
 */
export const SchematicCard = memo(function SchematicCard({
    item, styles, observe, selected, locked, layerOpacity, contextOpacity, desaturate, emphasis, forbidden, dropTarget,
}: SchematicCardProps) {
    const sublabel = getSomeorUndefined(item.sublabel);
    const icon = getSomeorUndefined(item.icon);
    const meter = getSomeorUndefined(item.meter);
    const metric = getSomeorUndefined(item.metric);
    const width = getSomeorUndefined(item.width);
    // While its details are read, each role they give holds its place: a placeholder, never a value (#1398).
    const pending = getSomeorUndefined(item.pending);
    const shape = pending === undefined ? 0 : placeholderIndex(item.key);
    const iconDef = icon !== undefined ? findIconDefinition({ prefix: "fas", iconName: icon as IconName }) : undefined;
    const context = contextOpacity !== undefined;
    return (
        <Box
            ref={observe}
            css={styles.item}
            data-card-key={item.key}
            // At its item's own width, a box in the world: the recipe holds it to no widest card (#1393).
            {...(width !== undefined ? { "data-boxed": "" } : {})}
            {...(selected ? { "data-selected": "" } : {})}
            {...(locked ? { "data-locked": "" } : {})}
            {...(context ? { "data-context": "", ...(desaturate ? { "data-desaturate": "" } : {}) } : {})}
            {...(emphasis !== undefined ? { "data-emphasis": emphasis } : {})}
            {...(forbidden ? { "data-forbidden": "" } : {})}
            {...(dropTarget ? { "data-drop-target": "" } : {})}
            style={{
                left: 0, top: 0,
                transform: `${cardTranslateCss(item.x, item.y)} translate(-50%, -50%)`,
                ...(width !== undefined ? { width: cardWidthCss(width) } : {}),
                ...(layerOpacity !== undefined ? { "--schematic-layer-opacity": String(layerOpacity) } : {}),
                ...(context ? { "--schematic-context-opacity": String(contextOpacity) } : {}),
            }}
        >
            <Box css={styles.itemHead}>
                {iconDef !== undefined && (
                    <Box as="span" css={styles.itemIcon}><FontAwesomeIcon icon={iconDef} /></Box>
                )}
                <Box as="span" css={styles.itemLabel} data-card-label="">{item.label}</Box>
                {/* Its colour: its colour token, else its tone, else its status's — its markers' on the canvas (D14, SC26);
                    its status unread, the dot's place a placeholder. */}
                {statusUnread(item)
                    ? <Box as="span" css={styles.statusDot} data-pending=""><PlaceholderShape kind="fill" index={shape} /></Box>
                    : hasDot(item) && <Box as="span" css={styles.statusDot} {...tintAttributes(itemTint(item))} {...(statusRing(item.status) ? { "data-ring": "" } : {})} />}
            </Box>
            {pending?.sublabel === true
                ? <Box css={styles.itemSublabel} data-pending=""><PlaceholderShape kind="text" index={shape} /></Box>
                : sublabel !== undefined && <Box css={styles.itemSublabel}>{sublabel}</Box>}
            {pending?.meter === true ? (
                <Box css={styles.meterTrack} data-meter="" data-pending=""><PlaceholderShape kind="fill" index={shape} /></Box>
            ) : meter !== undefined && (
                <Box css={styles.meterTrack} data-meter="">
                    <Box css={styles.meterFill} style={{ width: `${meter.max > 0 ? Math.min(100, (meter.value / meter.max) * 100) : 0}%` }} />
                </Box>
            )}
            {pending?.metric === true
                ? <Box css={styles.itemMetric} data-pending=""><PlaceholderShape kind="number" index={shape} /></Box>
                : metric !== undefined && <Box css={styles.itemMetric}>{metric}</Box>}
        </Box>
    );
});
