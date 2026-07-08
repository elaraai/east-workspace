/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGripVertical, faThumbtack, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { equalFor, variant, some, none, type ValueTypeOf } from "@elaraai/east";
import { Blend } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useDragTarget, useDropCell, useDragEventChip, type DragEventValue, type DragMeta, type DragPayload } from "../../dnd/drag-layer";
import { useIRCanDrop, canDropAllows, type CanDropFn } from "../../dnd/ir-can-drop";

const blendEqual = equalFor(Blend.Types.Blend);

/** East Blend value type. */
export type BlendValue = ValueTypeOf<typeof Blend.Types.Blend>;

/** East Blend target value type. */
export type BlendTargetValue = ValueTypeOf<typeof Blend.Types.Target>;

/** East Blend allocation value type. */
export type BlendAllocationValue = ValueTypeOf<typeof Blend.Types.Allocation>;

export interface EastChakraBlendProps {
    value: BlendValue;
    storageKey: string;
}

type SlotStyles = Record<string, SystemStyleObject>;
type ActionKind = "reset" | "apply" | "discard";

function stateAttr(state: BlendAllocationValue["state"]): string {
    if (state.type !== "proposed") return state.type;
    return state.value.type;
}

function compact(n: number): string {
    if (Math.abs(n) >= 1000) return `${Math.round(n / 1000)}k`;
    return `${Math.round(n)}`;
}

// ============================================================================
// Allocation row
// ============================================================================

interface AllocationRowProps {
    surface: string;
    targetKey: string;
    alloc: BlendAllocationValue;
    unit: string;
    capacity: number;
    styles: SlotStyles;
    onAmount?: ((source: string, amount: number) => void) | undefined;
    onRemove?: ((source: string) => void) | undefined;
}

function AllocationRow({ surface, targetKey, alloc, unit, capacity, styles, onAmount, onRemove }: AllocationRowProps) {
    const state = stateAttr(alloc.state);
    const proposed = alloc.state.type === "proposed";
    const draggable = proposed && !alloc.pinned;
    const [draft, setDraft] = useState(String(alloc.amount));
    useEffect(() => { setDraft(String(alloc.amount)); }, [alloc.amount]);

    const from = useMemo(
        () => ({ surface, row: targetKey, slot: "alloc", event: alloc.source }),
        [surface, targetKey, alloc.source],
    );
    const ghost = useMemo(() => <Box css={styles.dragGhost}>{alloc.label}</Box>, [styles.dragGhost, alloc.label]);
    const onPointerDown = useDragEventChip(from, ghost, !draggable);

    const commitDraft = useCallback(() => {
        const next = Number(draft);
        if (Number.isFinite(next) && next >= 0 && next !== alloc.amount && onAmount) {
            onAmount(alloc.source, next);
        } else {
            setDraft(String(alloc.amount));
        }
    }, [draft, alloc.amount, alloc.source, onAmount]);

    const share = capacity > 0 ? Math.round((alloc.amount / capacity) * 100) : 0;
    const sublabel = getSomeorUndefined(alloc.sublabel);

    return (
        <Box
            css={styles.allocRow}
            data-state={state}
            onPointerDown={onPointerDown}
            {...(draggable && onPointerDown ? { "data-draggable": "" } : {})}
        >
            {draggable && onPointerDown && (
                <Box as="span" css={styles.allocGrip}><FontAwesomeIcon icon={faGripVertical} /></Box>
            )}
            <Box css={styles.allocBody}>
                <Box as="span" css={styles.allocLabel}>{alloc.label}</Box>
                {sublabel !== undefined && <Box as="span" css={styles.allocSublabel}>{sublabel}</Box>}
            </Box>
            {alloc.pinned && (
                <Box as="span" css={styles.pinBadge} title="Pinned — held fixed">
                    <FontAwesomeIcon icon={faThumbtack} />
                </Box>
            )}
            {proposed && onAmount ? (
                <Box
                    as="input"
                    css={styles.amountInput}
                    {...{
                        value: draft,
                        inputMode: "decimal",
                        onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
                        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
                        onBlur: commitDraft,
                        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); },
                    }}
                />
            ) : (
                <Box as="span" css={styles.amountText}>{compact(alloc.amount)}</Box>
            )}
            <Box as="span" css={styles.share}>{unit} · {share}%</Box>
            {draggable && onRemove && (
                <Box
                    as="button"
                    css={styles.allocAction}
                    aria-label="Remove allocation"
                    title="Remove allocation"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => onRemove(alloc.source)}
                >
                    <FontAwesomeIcon icon={faTrashCan} />
                </Box>
            )}
        </Box>
    );
}

// ============================================================================
// Target panel
// ============================================================================

interface TargetPanelProps {
    surface: string;
    target: BlendTargetValue;
    mode: "single" | "compare" | "portfolio";
    badge?: string | undefined;
    styles: SlotStyles;
    /** Per-cell veto builder from the root's IR `canDrop` (#261). */
    vetoFor?: ((coord: { surface: string; row: string; slot: string }) => (payload: DragPayload) => boolean) | undefined;
    onAmount?: ((source: string, amount: number) => void) | undefined;
    onRemove?: ((source: string) => void) | undefined;
    onAction?: ((action: ActionKind) => void) | undefined;
}

function TargetPanel({ surface, target, mode, badge, styles, vetoFor, onAmount, onRemove, onAction }: TargetPanelProps) {
    const coord = useMemo(() => ({ surface, row: target.key, slot: "alloc" }), [surface, target.key]);
    const veto = useMemo(() => vetoFor?.(coord), [vetoFor, coord]);
    const dropRef = useDropCell(coord, false, veto);

    const allocated = target.allocations.reduce((sum, a) => sum + a.amount, 0);
    const headroom = Math.max(0, target.capacity - allocated);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * target.capacity);
    const objective = getSomeorUndefined(target.objective);

    return (
        <Box ref={dropRef} css={styles.panel} data-mode={mode}>
            <Box css={styles.panelHead}>
                {badge !== undefined && <Box as="span" css={styles.panelBadge}>{badge}</Box>}
                <Box as="span" css={styles.panelTitle}>{target.label}</Box>
                <Box as="span" css={styles.panelCap}>
                    cap {compact(target.capacity)} {target.unit} · {compact(headroom)} headroom
                </Box>
            </Box>
            <Box css={styles.compositionBar}>
                {target.allocations.map(alloc => (
                    <Box
                        key={alloc.source}
                        css={styles.segment}
                        data-state={stateAttr(alloc.state)}
                        style={{ width: `${target.capacity > 0 ? (alloc.amount / target.capacity) * 100 : 0}%` }}
                        title={`${alloc.label} · ${compact(alloc.amount)} ${target.unit}`}
                    />
                ))}
                <Box css={styles.headroom} style={{ width: `${target.capacity > 0 ? (headroom / target.capacity) * 100 : 100}%` }} />
            </Box>
            <Box css={styles.axis}>
                {ticks.map(t => <Box key={t} as="span" css={styles.axisTick}>{compact(t)}</Box>)}
            </Box>
            <Box css={styles.allocList}>
                {target.allocations.map(alloc => (
                    <AllocationRow
                        key={alloc.source}
                        surface={surface}
                        targetKey={target.key}
                        alloc={alloc}
                        unit={target.unit}
                        capacity={target.capacity}
                        styles={styles}
                        onAmount={onAmount}
                        onRemove={onRemove}
                    />
                ))}
                <Box css={styles.dropArea}>drop a source here</Box>
            </Box>
            {target.metrics.length > 0 && (
                <Box css={styles.metricList}>
                    {target.metrics.map(m => {
                        const model = getSomeorUndefined(m.model);
                        const band = getSomeorUndefined(m.band);
                        return (
                            <Box key={m.key} css={styles.metricRow}>
                                <Box as="span" css={styles.metricLabel}>{m.label}</Box>
                                <Box as="span" css={styles.metricValue}>{m.value}</Box>
                                {model !== undefined && <Box as="span" css={styles.trustChip}>{model}</Box>}
                                {band !== undefined && (
                                    <Box as="span" css={styles.bandText}>band {band.min}–{band.max}</Box>
                                )}
                            </Box>
                        );
                    })}
                </Box>
            )}
            <Box css={styles.panelFoot}>
                {objective !== undefined && <Box as="span" css={styles.objective}>objective {objective}</Box>}
                {onAction && (
                    <Box css={styles.actions}>
                        <Box as="button" css={styles.actionButton} onClick={() => onAction("reset")}>Reset</Box>
                        {mode === "compare" && (
                            <Box as="button" css={styles.actionButton} data-danger="" onClick={() => onAction("discard")}>Discard</Box>
                        )}
                        <Box as="button" css={styles.actionPrimary} onClick={() => onAction("apply")}>Apply blend</Box>
                    </Box>
                )}
            </Box>
        </Box>
    );
}

// ============================================================================
// Blend
// ============================================================================

/**
 * Renders an East UI Blend value — the assembly surface. Registers as the
 * DnD target under `value.id` (`add` from declared Libraries, `remove`
 * back); drops, amount edits, and removals apply to local state first and
 * report through the typed callbacks. Render mode follows the target
 * count: single, compare (with the derived diff table), portfolio.
 */
export const EastChakraBlend = memo(function EastChakraBlend({ value }: EastChakraBlendProps) {
    const styles = useSlotRecipe({ key: "blend" })() as SlotStyles;
    const mode: "single" | "compare" | "portfolio" =
        value.targets.length <= 1 ? "single" : value.targets.length === 2 ? "compare" : "portfolio";

    const onDragFn = useMemo(() => getSomeorUndefined(value.onDrag), [value.onDrag]);
    const canDropFn = useMemo(() => getSomeorUndefined(value.canDrop) as CanDropFn | undefined, [value.canDrop]);
    const vetoFor = useIRCanDrop(canDropFn);
    const onAmountFn = useMemo(() => getSomeorUndefined(value.onAmountChange), [value.onAmountChange]);
    const onActionFn = useMemo(() => getSomeorUndefined(value.onAction), [value.onAction]);
    const verdict = getSomeorUndefined(value.verdict);

    // Interactive-state pattern: drops / edits / removals apply locally;
    // callbacks persist; the prop sync reconciles authoritative data.
    const [targets, setTargets] = useState<BlendTargetValue[]>(() => [...value.targets]);
    useEffect(() => { setTargets([...value.targets]); }, [value.targets]);

    const handleDrag = useCallback((event: DragEventValue, meta?: DragMeta) => {
        // Re-check the IR veto with the real event before mutating (the hover
        // veto already gated the ⊘ stage; sink removes are always valid).
        if (event.type === "add" && !canDropAllows(canDropFn, event)) return;
        let next = targets;
        if (event.type === "add") {
            const { from, into } = event.value;
            next = targets.map(t => t.key !== into.row ? t : {
                ...t,
                allocations: [...t.allocations, {
                    source: from.key,
                    label: meta?.label ?? from.key,
                    sublabel: none,
                    amount: 0,
                    pinned: false,
                    state: variant("proposed", variant("added", null)),
                }],
            });
        } else if (event.type === "remove") {
            const { from } = event.value;
            const source = from.event.type === "some" ? from.event.value : undefined;
            next = targets.map(t => t.key !== from.row ? t : {
                ...t,
                allocations: t.allocations.filter(a => a.source !== source),
            });
        }
        setTargets(next);
        if (onDragFn) queueMicrotask(() => onDragFn(event));
    }, [targets, onDragFn, canDropFn]);

    const targetConfig = useMemo(() => ({
        id: value.id,
        sources: [...value.sources],
        kinds: { add: true, remove: true },
        onDrag: handleDrag,
    }), [value.id, value.sources, handleDrag]);
    useDragTarget(targetConfig);

    const handleAmount = useCallback((targetKey: string) => (source: string, amount: number) => {
        setTargets(prev => prev.map(t => t.key !== targetKey ? t : {
            ...t,
            allocations: t.allocations.map(a => a.source === source ? { ...a, amount } : a),
        }));
        if (onAmountFn) queueMicrotask(() => onAmountFn({ target: targetKey, source, amount }));
    }, [onAmountFn]);

    const handleRemove = useCallback((targetKey: string) => (source: string) => {
        const event: DragEventValue = variant("remove", {
            from: { surface: value.id, row: targetKey, slot: "alloc", event: some(source) },
            to: variant("trash", null),
        });
        handleDrag(event);
    }, [value.id, handleDrag]);

    const handleAction = useCallback((targetKey: string) => (action: ActionKind) => {
        if (onActionFn) {
            queueMicrotask(() => onActionFn({ target: some(targetKey), action: variant(action, null) }));
        }
    }, [onActionFn]);

    // Compare diff: derived from the two targets' metrics by key.
    const diffRows = useMemo(() => {
        if (mode !== "compare") return [];
        const [a, b] = targets;
        if (a === undefined || b === undefined) return [];
        const keys = value.diff.length > 0 ? [...value.diff] : a.metrics.map(m => m.key);
        return keys.flatMap(key => {
            const ma = a.metrics.find(m => m.key === key);
            const mb = b.metrics.find(m => m.key === key);
            if (ma === undefined && mb === undefined) return [];
            const na = ma !== undefined ? getSomeorUndefined(ma.numeric) : undefined;
            const nb = mb !== undefined ? getSomeorUndefined(mb.numeric) : undefined;
            const delta = typeof na === "number" && typeof nb === "number"
                ? `${nb - na >= 0 ? "+" : ""}${Number((nb - na).toFixed(3))}`
                : "—";
            return [{
                key,
                label: ma?.label ?? mb?.label ?? key,
                a: ma?.value ?? "—",
                b: mb?.value ?? "—",
                delta,
            }];
        });
    }, [mode, targets, value.diff]);

    return (
        <Box css={styles.root} data-mode={mode}>
            <Box css={styles.targets} data-mode={mode}>
                {targets.map((target, i) => (
                    <TargetPanel
                        key={target.key}
                        surface={value.id}
                        target={target}
                        mode={mode}
                        badge={mode === "compare" ? (i === 0 ? "A" : "B") : undefined}
                        styles={styles}
                        vetoFor={vetoFor}
                        onAmount={handleAmount(target.key)}
                        onRemove={handleRemove(target.key)}
                        onAction={onActionFn ? handleAction(target.key) : undefined}
                    />
                ))}
            </Box>
            {mode === "compare" && diffRows.length > 0 && (
                <Box css={styles.diff}>
                    <Box css={styles.diffRow} data-head="">
                        <Box as="span">metric</Box>
                        <Box as="span">target A</Box>
                        <Box as="span">target B</Box>
                        <Box as="span">Δ (B−A)</Box>
                    </Box>
                    {diffRows.map(row => (
                        <Box key={row.key} css={styles.diffRow}>
                            <Box as="span">{row.label}</Box>
                            <Box as="span">{row.a}</Box>
                            <Box as="span">{row.b}</Box>
                            <Box as="span" data-delta="">{row.delta}</Box>
                        </Box>
                    ))}
                    {verdict !== undefined && <Box css={styles.verdict}>{verdict}</Box>}
                </Box>
            )}
        </Box>
    );
}, (prev, next) => blendEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
