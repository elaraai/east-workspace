/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useRef } from "react";
import {
    Box,
    IconButton,
    Pagination as ChakraPagination,
    useRecipe,
    useSlotRecipe,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight, faEllipsis } from "@fortawesome/free-solid-svg-icons";
import { equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { Pagination } from "@elaraai/east-ui/internal";
import { useContainerBelow } from "../../contracts/adaptive.js";
import { getSomeorUndefined } from "../../utils";

const paginationEqual = equivalentFor(Pagination.Types.Pagination);

/** East Pagination value type. */
export type PaginationValue = ValueTypeOf<typeof Pagination.Types.Pagination>;

export interface EastChakraPaginationProps {
    value: PaginationValue;
    storageKey: string;
}

/** The icon button's size a run of left-out pages is drawn at, for each size a pagination declares: a square of its height. */
const RUN_SIZE = { sm: "2xs", md: "md", lg: "lg" } as const;

/**
 * Renders an East UI Pagination value using Chakra v3's `Pagination`
 * compound, styled through the `pagination` slot recipe.
 *
 * @remarks
 * Page indices in the East IR are **0-based**. Chakra/Ark expose
 * 1-based indices; this renderer converts at the boundary:
 * `chakraPage = irPage + 1` on render, `irPage = chakraPage - 1` when
 * emitting `onPageChange`.
 *
 * Follows the controlled-component pattern — the renderer forwards the
 * `page` value directly (no local mirror) and queues
 * `onPageChange(newPage)` via `queueMicrotask` to avoid double-firing
 * under React StrictMode.
 *
 * A run of pages the strip leaves out is Chakra's icon button, as Chakra
 * draws it, holding Font Awesome's ellipsis (#1263) at the size Chakra's icon
 * took there (the `iconButtonMark` recipe).
 *
 * The size the pagination declares is the design system's — 24, 32 or 40
 * tall at `sm`, `md` and `lg` — its page chips, its triggers and its runs of
 * pages left out each that height (the `pagination` recipe's `size`, and the
 * icon button's square of it). One that declares none draws the recipe's
 * base look.
 *
 * Below 360px of room the page strip is a `page / total` readout (#351). The
 * room is the root's width, which the `pagination` recipe makes as wide as
 * the container leaves it whatever the pagination draws (#1268).
 */
export const EastChakraPagination = memo(function EastChakraPagination({ value, storageKey: _storageKey }: EastChakraPaginationProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const color = style ? getSomeorUndefined(style.color) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const activeBackground = style ? getSomeorUndefined(style.activeBackground) : undefined;
    const activeColor = style ? getSomeorUndefined(style.activeColor) : undefined;
    const siblings = style ? getSomeorUndefined(style.siblings) : undefined;
    const size = style ? getSomeorUndefined(style.size)?.type : undefined;

    const onPageChangeFn = value.onPageChange;

    const irPage = Number(value.page);
    const pageSize = Number(value.pageSize);
    const count = Number(value.count);

    const handleChange = useCallback((details: { page: number }) => {
        queueMicrotask(() => onPageChangeFn(BigInt(details.page - 1)));
    }, [onPageChangeFn]);

    const recipe = useSlotRecipe({ key: "pagination" });
    const styles = recipe(size === undefined ? {} : { size });
    const runSize = size === undefined ? undefined : RUN_SIZE[size];
    const ellipsisMark = useRecipe({ key: "iconButtonMark" })({ size: runSize ?? "md" });

    // Compact containers (#351): the page-number strip collapses to a
    // "page / total" readout between prev/next. The width read is the
    // root's — the room the container gives it, whichever form it draws —
    // never the bar's, which is as wide as its form and would hold the form
    // it has (#1268). Chakra types the root's ref as a div's; it draws a nav.
    const rootRef = useRef<HTMLDivElement | null>(null);
    const compact = useContainerBelow(rootRef, 360);
    const totalPages = Math.max(1, Math.ceil(count / Math.max(1, pageSize)));

    const triggerOverride = useMemo(() => ({
        ...(color !== undefined ? { color } : {}),
    }), [color]);

    const itemCss = useMemo(() => {
        const item = styles.item as Record<string, unknown>;
        const activeOverride = {
            ...(activeBackground !== undefined ? { background: activeBackground } : {}),
            ...(activeColor !== undefined ? { color: activeColor } : {}),
        };
        const hasActiveOverride = Object.keys(activeOverride).length > 0;
        return {
            ...item,
            ...(color !== undefined ? { color } : {}),
            ...(background !== undefined ? { background } : {}),
            ...(hasActiveOverride ? {
                _selected: { ...(item._selected as object), ...activeOverride },
                "&[data-selected]": { ...(item["&[data-selected]"] as object), ...activeOverride },
            } : {}),
        };
    }, [styles, color, background, activeBackground, activeColor]);

    return (
        <ChakraPagination.Root
            ref={rootRef}
            // The recipe's size for every part the Root's context styles — its chips and its runs of pages left out too.
            size={size}
            count={count}
            pageSize={pageSize}
            page={irPage + 1}
            siblingCount={siblings !== undefined ? Number(siblings) : undefined}
            onPageChange={handleChange}
        >
            <Box css={styles.bar}>
                <ChakraPagination.PrevTrigger asChild>
                    <Box as="button" aria-label="Previous page" css={{ ...styles.prevTrigger, ...triggerOverride }}>
                        <FontAwesomeIcon icon={faChevronLeft} />
                    </Box>
                </ChakraPagination.PrevTrigger>

                {compact ? (
                    <Box as="span" aria-live="polite" css={{ ...styles.ellipsis, ...triggerOverride }}>
                        {irPage + 1} / {totalPages}
                    </Box>
                ) : (
                    <ChakraPagination.Items
                        render={(page) => (
                            <Box as="button" aria-label={`Page ${page.value}`} css={itemCss}>{page.value}</Box>
                        )}
                        ellipsis={<IconButton as="span" size={runSize} css={ellipsisMark}><FontAwesomeIcon icon={faEllipsis} /></IconButton>}
                    />
                )}

                <ChakraPagination.NextTrigger asChild>
                    <Box as="button" aria-label="Next page" css={{ ...styles.nextTrigger, ...triggerOverride }}>
                        <FontAwesomeIcon icon={faChevronRight} />
                    </Box>
                </ChakraPagination.NextTrigger>
            </Box>
        </ChakraPagination.Root>
    );
}, (prev, next) => paginationEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
