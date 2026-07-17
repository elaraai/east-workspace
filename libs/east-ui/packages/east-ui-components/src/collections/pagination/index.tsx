/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useRef } from "react";
import {
    Box,
    Pagination as ChakraPagination,
    useSlotRecipe,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Pagination } from "@elaraai/east-ui/internal";
import { useContainerBelow } from "../../contracts/adaptive.js";
import { getSomeorUndefined } from "../../utils";

const paginationEqual = equalFor(Pagination.Types.Pagination);

/** East Pagination value type. */
export type PaginationValue = ValueTypeOf<typeof Pagination.Types.Pagination>;

export interface EastChakraPaginationProps {
    value: PaginationValue;
    storageKey: string;
}

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
 */
export const EastChakraPagination = memo(function EastChakraPagination({ value, storageKey: _storageKey }: EastChakraPaginationProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const color = style ? getSomeorUndefined(style.color) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const activeBackground = style ? getSomeorUndefined(style.activeBackground) : undefined;
    const activeColor = style ? getSomeorUndefined(style.activeColor) : undefined;
    const siblings = style ? getSomeorUndefined(style.siblings) : undefined;

    const onPageChangeFn = value.onPageChange;

    const irPage = Number(value.page);
    const pageSize = Number(value.pageSize);
    const count = Number(value.count);

    const handleChange = useCallback((details: { page: number }) => {
        queueMicrotask(() => onPageChangeFn(BigInt(details.page - 1)));
    }, [onPageChangeFn]);

    const recipe = useSlotRecipe({ key: "pagination" });
    const styles = recipe();

    // Compact containers (#351): the page-number strip collapses to a
    // "page / total" readout between prev/next.
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
            count={count}
            pageSize={pageSize}
            page={irPage + 1}
            siblingCount={siblings !== undefined ? Number(siblings) : undefined}
            onPageChange={handleChange}
        >
            <Box ref={rootRef} css={styles.root}>
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
