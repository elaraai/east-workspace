/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useMemo, useState } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGripVertical } from "@fortawesome/free-solid-svg-icons";
import { type IconName } from "@fortawesome/fontawesome-svg-core";
import { equalFor, match, type ValueTypeOf } from "@elaraai/east";
import { Library } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { usePersistedState } from "../../hooks/usePersistedState";
import { useDragSourceItem, useDropSink, useDragLayerOptional } from "../../dnd/drag-layer";

const libraryEqual = equalFor(Library.Types.Library);

/** East Library value type. */
export type LibraryValue = ValueTypeOf<typeof Library.Types.Library>;

/** East Library item value type. */
export type LibraryItemValue = ValueTypeOf<typeof Library.Types.Item>;

export interface EastChakraLibraryProps {
    value: LibraryValue;
    storageKey: string;
}

type SlotStyles = Record<string, SystemStyleObject>;

interface LibraryToolbarState {
    groupKey: string | null;
    activeDims: string[];
}

function itemSearchText(item: LibraryItemValue): string {
    return (getSomeorUndefined(item.search) ?? item.label).toLowerCase();
}

// ============================================================================
// Card
// ============================================================================

interface LibraryCardProps {
    libraryId: string;
    item: LibraryItemValue;
    dimOrder: string[];
    activeDims: string[];
    filtered: boolean;
    styles: SlotStyles;
}

function LibraryCard({ libraryId, item, dimOrder, activeDims, filtered, styles }: LibraryCardProps) {
    const status = getSomeorUndefined(item.status);
    const sublabel = getSomeorUndefined(item.sublabel);
    const icon = getSomeorUndefined(item.icon);
    const draggable = item.draggable && !filtered;
    const visibleDims = dimOrder.filter(k => activeDims.includes(k) && item.dims.get(k) !== undefined);
    const compact = sublabel === undefined && visibleDims.length === 0;

    const from = useMemo(() => ({ library: libraryId, key: item.key, label: item.label }), [libraryId, item.key, item.label]);
    const ghost = useMemo(() => (
        <Box css={styles.ghost}>{item.label}</Box>
    ), [styles.ghost, item.label]);
    const onPointerDown = useDragSourceItem(from, ghost, !draggable);

    return (
        <Box
            css={styles.card}
            onPointerDown={onPointerDown}
            {...(filtered ? { "data-filtered": "" } : {})}
            {...(draggable && onPointerDown ? { "data-draggable": "" } : {})}
            {...(compact ? { "data-compact": "" } : {})}
        >
            {draggable && onPointerDown && (
                <Box as="span" css={styles.grip}>
                    <FontAwesomeIcon icon={faGripVertical} />
                </Box>
            )}
            {icon && (
                <Box css={styles.iconTile}>
                    <FontAwesomeIcon icon={["fas", icon as IconName]} />
                </Box>
            )}
            <Box css={styles.cardBody}>
                <Box css={styles.cardHead}>
                    <Box as="span" css={styles.cardLabel}>{item.label}</Box>
                    {status && (
                        <Box as="span" css={styles.statusPill} data-tone={status.tone.type}>
                            {status.label}
                        </Box>
                    )}
                </Box>
                {sublabel && <Box css={styles.cardSublabel}>{sublabel}</Box>}
                {visibleDims.map(key => {
                    const dim = item.dims.get(key)!;
                    return match(dim, {
                        meter: (m) => (
                            <Box key={key} css={styles.meter}>
                                <Box css={styles.meterTrack}>
                                    <Box
                                        css={styles.meterFill}
                                        width={`${Math.max(0, Math.min(100, m.max > 0 ? (m.value / m.max) * 100 : 0))}%`}
                                    />
                                </Box>
                                {getSomeorUndefined(m.text) !== undefined && (
                                    <Box as="span" css={styles.meterText}>{getSomeorUndefined(m.text)}</Box>
                                )}
                            </Box>
                        ),
                        chips: (chips) => (
                            <Box key={key} css={styles.chips}>
                                {chips.map((chip, i) => (
                                    <Box as="span" key={i} css={styles.chip}>{chip}</Box>
                                ))}
                            </Box>
                        ),
                        text: (text) => (
                            <Box key={key} css={styles.dimText}>{text}</Box>
                        ),
                    });
                })}
            </Box>
        </Box>
    );
}

// ============================================================================
// Library
// ============================================================================

/**
 * Renders an East UI Library value — a draggable palette of assignable
 * items. Registers as the DnD **source** under `value.id` (cards start
 * `add` drags; the frame is the return-to-palette sink). Filtering dims
 * cards instead of removing them.
 */
export const EastChakraLibrary = memo(function EastChakraLibrary({ value, storageKey }: EastChakraLibraryProps) {
    const styles = useSlotRecipe({ key: "library" })() as SlotStyles;
    const dragLayer = useDragLayerOptional();

    const groupOptions = value.groupOptions;
    const dimOptions = value.dimOptions;
    const dimOrder = useMemo(() => dimOptions.map(d => d.key), [dimOptions]);

    const { state: toolbar, setState: setToolbar } = usePersistedState<LibraryToolbarState>(`${storageKey}.toolbar`, {
        groupKey: groupOptions[0]?.key ?? null,
        activeDims: [...value.defaultDimensions],
    });
    const [query, setQuery] = useState("");

    const frameSink = useDropSink("library", value.id);

    const setGroup = useCallback((key: string | null) => {
        setToolbar(prev => ({ ...prev, groupKey: key }));
    }, [setToolbar]);
    const toggleDim = useCallback((key: string) => {
        setToolbar(prev => ({
            ...prev,
            activeDims: prev.activeDims.includes(key)
                ? prev.activeDims.filter(k => k !== key)
                : [...prev.activeDims, key],
        }));
    }, [setToolbar]);

    const lowerQuery = query.trim().toLowerCase();
    const isFiltered = useCallback(
        (item: LibraryItemValue) => lowerQuery !== "" && !itemSearchText(item).includes(lowerQuery),
        [lowerQuery],
    );

    // Group items preserving first-appearance order; null group key = flat.
    const groups = useMemo(() => {
        const groupKey = toolbar.groupKey;
        const out = new Map<string, { summary?: string; items: LibraryItemValue[] }>();
        for (const item of value.items) {
            const placement = groupKey !== null ? item.groups.get(groupKey) : undefined;
            const label = placement?.value ?? "";
            if (!out.has(label)) {
                const entry: { summary?: string; items: LibraryItemValue[] } = { items: [] };
                const summary = placement !== undefined ? getSomeorUndefined(placement.summary) : undefined;
                if (summary !== undefined) entry.summary = summary;
                out.set(label, entry);
            }
            out.get(label)!.items.push(item);
        }
        return out;
    }, [value.items, toolbar.groupKey]);

    const hiddenCount = useMemo(
        () => value.items.filter(isFiltered).length,
        [value.items, isFiltered],
    );
    const visibleCount = value.items.length - hiddenCount;

    const hint = getSomeorUndefined(value.hint)
        ?? (dragLayer !== null ? "drag to assign · ⌥-drag duplicate" : undefined);
    const addLabel = getSomeorUndefined(value.addLabel);
    const onAddFn = useMemo(() => getSomeorUndefined(value.onAdd), [value.onAdd]);
    const handleAdd = useCallback(() => {
        if (onAddFn) queueMicrotask(() => onAddFn());
    }, [onAddFn]);

    return (
        <Box css={styles.root} ref={frameSink} data-library={value.id}>
            {(lowerQuery !== "" || hint !== undefined) && (
                <Box css={styles.header}>
                    {lowerQuery !== "" && (
                        <Box as="span" css={styles.title}>
                            {visibleCount} of {value.items.length} visible
                        </Box>
                    )}
                    {hint && <Box as="span" css={styles.hint}>{hint}</Box>}
                </Box>
            )}
            {(value.searchable || groupOptions.length > 0 || dimOptions.length > 0) && (
                <Box css={styles.toolbar}>
                    {value.searchable && (
                        <Box
                            as="input"
                            css={styles.search}
                            // @ts-expect-error chakra polymorphic input props
                            placeholder="Search…"
                            value={query}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                        />
                    )}
                    {groupOptions.length > 0 && (
                        <Box css={styles.segGroup}>
                            <Box as="span" css={styles.segLabel}>Group by</Box>
                            {groupOptions.map(g => (
                                <Box
                                    as="button"
                                    key={g.key}
                                    css={styles.segItem}
                                    {...(toolbar.groupKey === g.key ? { "data-active": "" } : {})}
                                    onClick={() => setGroup(g.key)}
                                >
                                    {g.label}
                                </Box>
                            ))}
                            <Box
                                as="button"
                                css={styles.segItem}
                                {...(toolbar.groupKey === null ? { "data-active": "" } : {})}
                                onClick={() => setGroup(null)}
                            >
                                None
                            </Box>
                        </Box>
                    )}
                    {dimOptions.length > 0 && (
                        <Box css={styles.segGroup} marginLeft="auto">
                            <Box as="span" css={styles.segLabel}>Secondary</Box>
                            {dimOptions.map(d => (
                                <Box
                                    as="button"
                                    key={d.key}
                                    css={styles.segItem}
                                    {...(toolbar.activeDims.includes(d.key) ? { "data-active": "" } : {})}
                                    onClick={() => toggleDim(d.key)}
                                >
                                    {d.label}
                                </Box>
                            ))}
                        </Box>
                    )}
                </Box>
            )}
            {[...groups.entries()].map(([label, group]) => (
                <Box key={label || "_flat"} css={styles.group}>
                    {label !== "" && (
                        <Box css={styles.groupHead}>
                            <Box as="span" css={styles.groupLabel}>{label} · {group.items.length}</Box>
                            {group.summary !== undefined && (
                                <Box as="span" css={styles.groupSummary}>{group.summary}</Box>
                            )}
                        </Box>
                    )}
                    <Box css={styles.grid}>
                        {group.items.map(item => (
                            <LibraryCard
                                key={item.key}
                                libraryId={value.id}
                                item={item}
                                dimOrder={dimOrder}
                                activeDims={toolbar.activeDims}
                                filtered={isFiltered(item)}
                                styles={styles}
                            />
                        ))}
                    </Box>
                </Box>
            ))}
            {(hiddenCount > 0 || addLabel !== undefined) && (
                <Box css={styles.footer}>
                    {hiddenCount > 0 && (
                        <Box as="span" css={styles.hiddenNote}>
                            {hiddenCount} hidden by filter ·{" "}
                            <Box as="button" css={styles.showAll} onClick={() => setQuery("")}>Show all</Box>
                        </Box>
                    )}
                    {addLabel !== undefined && (
                        <Box as="button" css={styles.addAction} marginLeft="auto" onClick={handleAdd}>
                            + {addLabel}
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}, (prev, next) => libraryEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
