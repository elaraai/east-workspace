/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's card layer (#1387, #1393, #1403): the layer the cards draw in —
 * an item drawn as a card a component of its own (`card.tsx`), told how it
 * stands in values (invariant 13) — and with them a Move's preview and a
 * refused connection's caption under the item it would end at, in the shared
 * drag caption (invariant 6). It holds the live camera's custom properties the
 * apply writes, so a camera move is three property writes on it and never a
 * card's re-layout, and the widest card, which the recipe reads. Each card's
 * size as the page lays it out is heard by a ResizeObserver, for a link's end
 * to meet (invariant 9).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { Box } from "@chakra-ui/react";
import { StringType, equalFor } from "@elaraai/east";
import type { SchematicDropMark } from "../drop.js";
import type { SchematicNarrowedLook } from "../narrowing.js";
import { cardTranslateCss } from "./camera";
import { SchematicCard, type SchematicCardProps } from "./card";
import type { DrawnItem } from "./drawn";
import { SCHEMATIC_CARD_MAX_PX, type LodTier } from "./model";
import type { GestureState } from "./use-gestures";

const stringEqual = equalFor(StringType);

/** The card layer's widest card (#1393): what the recipe holds a card to, but one at its item's own width — the figure `tierSize` and the area read reckon with. */
const CARD_LAYER_STYLE = { "--schematic-card-max": `${SCHEMATIC_CARD_MAX_PX}px` } as CSSProperties;

/** Props of {@link SchematicCardLayer}. */
export interface SchematicCardLayerProps {
    /** The layer's element: what the apply writes the live camera's custom properties to. */
    readonly cardLayerRef: RefObject<HTMLDivElement | null>;
    /** The recipe's styles, resolved once a recipe. */
    readonly styles: SchematicCardProps["styles"];
    /** The items in view: those drawn as cards draw here. */
    readonly visibleItems: readonly DrawnItem[];
    /** What each item in view draws as at the zoom. */
    readonly tiers: ReadonlyMap<string, LodTier>;
    /** The tier the zoom's band draws its items at. */
    readonly lod: LodTier;
    /** What draws as the narrowing's context (#1392). */
    readonly context: ReadonlySet<string>;
    /** How context draws, and what the matches take. */
    readonly look: SchematicNarrowedLook;
    /** The narrowing's matches, by id. */
    readonly matches: ReadonlySet<string>;
    /** What draws selected: the selection, or what a marquee in flight would select. */
    readonly renderSelected: ReadonlySet<string>;
    /** What a locked layer holds, by id. */
    readonly lockedKeys: ReadonlySet<string>;
    /** Each dimmed entity's opacity, by id. */
    readonly layerAlpha: ReadonlyMap<string, number>;
    /** Connect's draft: the item it would end at, refused, and why (SC9). */
    readonly connectDraft: GestureState["connectDraft"];
    /** Where a library card's drop lands while its drag rests there (#1390). */
    readonly dropMark: SchematicDropMark | undefined;
    /** Each item drawn's centre, by its id: where a refusal's caption stands. */
    readonly centers: ReadonlyMap<string, { x: number; y: number }>;
    /** Each card's size as the page lays it out, by its item's id (#1403): what the observer writes. */
    readonly cardSizesRef: RefObject<ReadonlyMap<string, { w: number; h: number }>>;
    /** The apply (`use-paint.ts`): the paint draws again as a card's size moves. */
    readonly applyCamera: () => void;
}

/**
 * The card layer (see the module docs).
 *
 * @param props - The layer's element and the recipe's styles, the items in view and what each draws as, how each card
 *   stands, Connect's draft, the drop's mark, the items' centres, and each card's size and the apply
 * @returns The layer
 */
export function SchematicCardLayer({
    cardLayerRef, styles, visibleItems, tiers, lod, context, look, matches, renderSelected, lockedKeys, layerAlpha, connectDraft, dropMark, centers,
    cardSizesRef, applyCamera,
}: SchematicCardLayerProps) {
    // Each card's size as the page lays it out (#1403): a ResizeObserver hears each card as it is laid out and as its box
    // changes — a card with an explicit width grows with the zoom — and the paint draws again over a fresh map. Made as
    // the first card is laid out, and let go with the canvas.
    const cardObserverRef = useRef<ResizeObserver | null>(null);
    const observeCard = useCallback((el: HTMLElement | null) => {
        if (el === null || typeof ResizeObserver === "undefined") return undefined;
        cardObserverRef.current ??= new ResizeObserver((entries) => {
            let next: Map<string, { w: number; h: number }> | undefined;
            for (const entry of entries) {
                const key = entry.target.getAttribute("data-card-key");
                const box = entry.borderBoxSize[0];
                if (key === null || box === undefined || !(box.inlineSize > 0 && box.blockSize > 0)) continue;
                const was = (next ?? cardSizesRef.current).get(key);
                if (was !== undefined && was.w === box.inlineSize && was.h === box.blockSize) continue;
                next ??= new Map(cardSizesRef.current);
                next.set(key, { w: box.inlineSize, h: box.blockSize });
            }
            if (next === undefined) return;
            cardSizesRef.current = next;
            applyCamera();
        });
        const observer = cardObserverRef.current;
        observer.observe(el);
        return () => observer.unobserve(el);
    }, [applyCamera, cardSizesRef]);
    useEffect(() => () => { cardObserverRef.current?.disconnect(); cardObserverRef.current = null; }, []);
    return (
        <Box ref={cardLayerRef} css={styles.cardLayer} data-schematic-cards="" style={CARD_LAYER_STYLE}>
            {visibleItems.map(item => {
                // Rich cards are DOM; dots / pins / footprints / zones /
                // links are painted on the canvas above.
                if ((tiers.get(item.key) ?? lod) !== "card") return null;
                // The narrowing's (#1392): context fades — greyed, as the look says — and takes no pointer, as
                // a locked card; a match wears its emphasis's ring. Each card a component of its own, told how it
                // stands in values, so a frame the camera moves renders none whose standing holds (#1393).
                const isContextCard = context.has(item.key);
                return (
                    <SchematicCard
                        key={item.key}
                        item={item}
                        styles={styles}
                        observe={observeCard}
                        selected={renderSelected.has(item.key)}
                        // Layer treatment: dim + lock (non-selectable — clicks fall
                        // through to entities beneath, matching the pickAt lock skip).
                        locked={lockedKeys.has(item.key)}
                        layerOpacity={layerAlpha.get(item.key)}
                        contextOpacity={isContextCard ? look.opacity : undefined}
                        desaturate={isContextCard && look.desaturate}
                        emphasis={look.emphasis !== undefined && matches.has(item.key) ? look.emphasis : undefined}
                        forbidden={connectDraft?.forbidden === item.key}
                        dropTarget={dropMark?.kind === "entity" && stringEqual(dropMark.id, item.key)}
                    />
                );
            })}
            {/* A refused connection's words under the item its draft would end at (SC9), in the shared
                drag caption, moving with the camera as the cards do. */}
            {connectDraft?.forbidden !== undefined && connectDraft.reason !== undefined && centers.has(connectDraft.forbidden) && (
                <Box css={styles.draftCaption} data-schematic-refusal=""
                    style={{ transform: cardTranslateCss(centers.get(connectDraft.forbidden)!.x, centers.get(connectDraft.forbidden)!.y) }}>
                    <div data-drag-caption="" data-refused="">{connectDraft.reason}</div>
                </Box>
            )}
        </Box>
    );
}
