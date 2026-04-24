/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import {
    Pagination as ChakraPagination,
    ButtonGroup,
    IconButton,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Pagination } from "@elaraai/east-ui";
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
 * compound.
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

    const sizeTag = style ? getSomeorUndefined(style.size)?.type : undefined;
    const variantTag = style ? getSomeorUndefined(style.variant)?.type : undefined;
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

    const triggerCss = useMemo(() => {
        const base: Record<string, unknown> = {};
        if (color !== undefined) base.color = color;
        if (background !== undefined) base.background = background;
        return base;
    }, [color, background]);

    const activeCss = useMemo(() => {
        const base: Record<string, unknown> = {};
        if (activeBackground !== undefined) base.background = activeBackground;
        if (activeColor !== undefined) base.color = activeColor;
        return base;
    }, [activeBackground, activeColor]);

    return (
        <ChakraPagination.Root
            count={count}
            pageSize={pageSize}
            page={irPage + 1}
            siblingCount={siblings !== undefined ? Number(siblings) : undefined}
            onPageChange={handleChange}
        >
            <ButtonGroup variant="ghost" size={sizeTag ?? "md"}>
                <ChakraPagination.PrevTrigger asChild>
                    <IconButton aria-label="Previous page" css={triggerCss}>
                        <FontAwesomeIcon icon={faChevronLeft} />
                    </IconButton>
                </ChakraPagination.PrevTrigger>

                <ChakraPagination.Items
                    render={(page) => (
                        <IconButton
                            variant={variantTag === "outline" ? "outline" : "ghost"}
                            aria-label={`Page ${page.value}`}
                            css={{
                                ...triggerCss,
                                "&[data-selected]": activeCss,
                            }}
                        >
                            {page.value}
                        </IconButton>
                    )}
                />

                <ChakraPagination.NextTrigger asChild>
                    <IconButton aria-label="Next page" css={triggerCss}>
                        <FontAwesomeIcon icon={faChevronRight} />
                    </IconButton>
                </ChakraPagination.NextTrigger>
            </ButtonGroup>
        </ChakraPagination.Root>
    );
}, (prev, next) => paginationEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
