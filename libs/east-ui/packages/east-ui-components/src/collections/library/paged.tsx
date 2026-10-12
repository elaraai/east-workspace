/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** A bounded, virtual palette over a server-paged collection; cards remain Library cards. */
import { useCallback, useState } from "react";
import { Box, Skeleton, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { type option } from "@elaraai/east";
import { useTrackedEvaluation } from "../../reactive/index.js";
import { BannerView } from "../../feedback/banner/index.js";
import { EmptyStateView } from "../../feedback/empty-state/index.js";
import { VirtualRows } from "../virtual-rows.js";
import { planWindows } from "../paged-window-store.js";
import { LibraryCard, type LibraryItemValue } from "./index.js";

/** The reads a paged palette needs; its provider owns requests and its bounded cache. */
export interface LibraryPageSource<T> {
    readonly id: string;
    page(offset: bigint, limit: bigint): option<T[]>;
    total(): option<bigint>;
    revision(): option<string>;
}

/** @internal A paged palette reuses Library's card, empty state and theme. */
export interface PagedLibraryProps<T> {
    source: LibraryPageSource<T>;
    id: string;
    item(row: T): LibraryItemValue;
    onOpen(key: string): void;
}

const PAGE_SIZE = 32;
const estimateSize = () => 56;
const EMPTY_DIMS: string[] = [];
/**
 * Render only the visible rows and request their adjacent windows. Changing
 * query identity remounts the viewport; a revision replaces all its reads.
 * @param props - The paged source, card projection and opening action
 * @returns A virtualized palette with the standard Library cards
 * @internal
 */
export function PagedLibrary<T>(props: PagedLibraryProps<T>) {
    return <PagedLibraryBody key={props.source.id} {...props} />;
}

function PagedLibraryBody<T>({ source, id, item, onOpen }: PagedLibraryProps<T>) {
    const styles = useSlotRecipe({ key: "library" })() as Record<string, SystemStyleObject>;
    const [range, setRange] = useState({ start: 0, end: 12 });
    const read = useCallback(() => {
        const revision = source.revision();
        const total = source.total();
        const count = total.type === "some" ? Number(total.value) : undefined;
        const rows = new Map<number, T>();
        if (revision.type === "some" && count !== 0) {
            for (const window of planWindows(range, PAGE_SIZE, count).needed) {
                const offset = window * PAGE_SIZE;
                const page = source.page(BigInt(offset), BigInt(PAGE_SIZE));
                if (page.type === "some") page.value.forEach((row, i) => rows.set(offset + i, row));
            }
        }
        return { count, rows };
    }, [source, range]);
    const { result } = useTrackedEvaluation(read);
    const onRangeChange = useCallback((next: { startIndex: number; endIndex: number }, scrolling: boolean) => {
        if (scrolling) return;
        setRange(old => old.start === next.startIndex && old.end === next.endIndex + 1
            ? old : { start: next.startIndex, end: next.endIndex + 1 });
    }, []);
    if (!result.ok) return <BannerView status="error" title={result.error instanceof Error ? result.error.message : "The list could not be read"} />;
    const { count, rows } = result.value;
    return (
        <Box css={[styles.root, styles.pagedRoot]} data-library={id} data-library-paged="" data-scrollable="">
            {count === 0 ? <EmptyStateView title="No matches" description="Change or clear the filters to see more records." /> : (
                <VirtualRows height="fill" maxHeight={undefined} count={count ?? 8} estimateSize={estimateSize}
                    onRangeChange={onRangeChange}
                    renderRow={index => {
                        const row = rows.get(index);
                        return <Box css={styles.pagedRow} data-library-position={index}>
                            {row === undefined ? <Skeleton css={styles.pagedSkeleton} aria-label="Loading record" /> :
                                <LibraryCard libraryId={id} item={item(row)} dimOrder={EMPTY_DIMS} activeDims={EMPTY_DIMS}
                                    filtered={false} styles={styles} onCardClick={onOpen} onCardEnter={undefined} />
                            }
                        </Box>;
                    }} />
            )}
        </Box>
    );
}
