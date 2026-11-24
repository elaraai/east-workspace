/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The foot of rows that page — the design system's footer band
 * (`parts-pagination`): where the page stands, at its start, and its page
 * buttons — the Pagination at the design system's small size, the band's
 * 24px — at its end. One foot for every host that pages rows: a Table's own
 * pager, a Studio visual's paged rows; and the page buttons alone
 * ({@link PageButtons}) for a host with a footer of its own — a sliced
 * Table's frame footer, beside its counts.
 *
 * Its words are its host's: the range line is the foot's child, drawn by a
 * host that words it its own way, and {@link PageRange} draws a line of words
 * in the band's range voice.
 *
 * @packageDocumentation
 */

import { useMemo, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { useSlotStyles } from "../../theme/slot-styles.js";
import { EastChakraPagination, type PaginationValue } from "./index.js";

/** The page buttons' style: the design system's small size, the footer band's 24px — nothing else declared. */
const PAGE_BUTTONS_STYLE: PaginationValue["style"] = some({
    size: some(variant("sm", null)), variant: none, color: none, background: none, activeBackground: none, activeColor: none, siblings: none, boundaries: none,
});

/** Props of {@link PageButtons}. */
export interface PageButtonsProps {
    /** How many rows there are. */
    readonly count: number;
    /** How many rows a page holds. */
    readonly pageSize: number;
    /** The page shown, by its index from 0. */
    readonly page: number;
    /** Shows another page, by its index from 0. Keep it by identity. */
    readonly onPage: (page: number) => void;
    /** Where the pager keeps its state. */
    readonly storageKey: string;
}

/**
 * The page buttons of rows that page: the Pagination at the design system's
 * small size — 24px, the footer band's — over them.
 *
 * @param props - How many rows there are, how many a page holds, the page shown, how to show another, and where the pager keeps its state
 * @returns The Pagination
 */
export function PageButtons({ count, pageSize, page, onPage, storageKey }: PageButtonsProps) {
    const value = useMemo((): PaginationValue => ({
        count: BigInt(count),
        pageSize: BigInt(pageSize),
        page: BigInt(page),
        onPageChange: (next: bigint) => {
            onPage(Number(next));
            return null;
        },
        style: PAGE_BUTTONS_STYLE,
    }), [count, pageSize, page, onPage]);
    return <EastChakraPagination value={value} storageKey={storageKey} />;
}

/**
 * A line of words in the footer band's range voice — `Showing 51–100 of
 * 1,482`: one line, ended in an ellipsis where its room is too narrow for it,
 * its whole on hover.
 *
 * @param props - Its words
 * @returns The line
 */
export function PageRange({ children }: { readonly children: string }) {
    const styles = useSlotStyles("pageFoot");
    return <Box as="span" css={styles.range} title={children} data-page-range="">{children}</Box>;
}

/** Props of {@link PageFoot}. */
export interface PageFootProps {
    /** Its page buttons; `undefined` draws none — rows that all stand on one page. */
    readonly pages?: PageButtonsProps | undefined;
    /** Its range line, in its host's words: where the page stands among the rows, or what the view holds of how many. */
    readonly children: ReactNode;
}

/**
 * The foot of rows that page, on one line: its range line at its start, and
 * its page buttons at its end — under 360px of room, a line each.
 *
 * @param props - Its page buttons and its range line
 * @returns The foot
 */
export function PageFoot({ pages, children }: PageFootProps) {
    const styles = useSlotStyles("pageFoot");
    return (
        <Box css={styles.root} data-page-foot="">
            {children}
            {pages !== undefined && <PageButtons {...pages} />}
        </Box>
    );
}
