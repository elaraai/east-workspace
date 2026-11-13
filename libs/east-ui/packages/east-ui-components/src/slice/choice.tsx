/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { createContext, forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Box, Button, Skeleton, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faCheck, faXmark } from "@fortawesome/free-solid-svg-icons";
import { useCoarsePointer } from "../contracts/adaptive.js";
import { useFormatters } from "../format/index.js";
import { useSlotStyles } from "../theme/slot-styles.js";

/** Shared field chip. The enclosing editor owns focus transfer after removal. */
export const SliceFieldChip = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> & {
    label: string; active: boolean; caret?: boolean; removeLabel?: string; onRemove?: () => void;
}>(function SliceFieldChip({ label, active, caret = false, removeLabel = "Remove filter", onRemove, onKeyDown, ...props }, ref) {
    const chip = useRecipe({ key: "chip" });
    const frame = useSlotRecipe({ key: "sliceFrame" })();
    const coarse = useCoarsePointer();
    return <chakra.button {...props} ref={ref} type="button" title={label}
        css={[frame.railTrigger, chip({ tone: active ? "brand" : "neutral" })]}
        onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented && event.key === "Delete" && onRemove !== undefined) { event.preventDefault(); onRemove(); } }}>
        <Box as="span">{label}</Box>
        {caret && <FontAwesomeIcon icon={faCaretDown} data-chip-caret="" />}
        {onRemove !== undefined && !coarse && <Box as="span" data-chip-remove="" aria-hidden="true" title={removeLabel}
            onClick={event => { event.preventDefault(); event.stopPropagation(); onRemove(); }}><FontAwesomeIcon icon={faXmark} /></Box>}
    </chakra.button>;
});

/** One known value or preset. Null count means pending; absent count is hidden. */
export interface SliceChoice {
    id: string; label: string; active: boolean; dashed?: boolean; disabled?: boolean;
    count?: bigint | null; error?: string; hint?: string;
}
/**
 * Whether a Slice's editor is drawn in a phone's Filters view (`Mobile Filters Spec.md` SL7): its known values then as
 * 44px rows, each a checkbox, its label and its count.
 */
export const SliceFiltersViewContext = createContext(false);

/**
 * Render the shared choice chips, including authoritative async count states — or, as `rows`, one 44px row a choice:
 * a checkbox, its label (and its hint under it), its count at the end (`…` while it is read, none while it cannot be
 * picked), as a phone's Filters view draws a field's values (`Mobile Filters Spec.md` SL7, SL9.3–SL9.5).
 */
export function SliceChoiceGroup({ choices, onPick, onRetry, rows = false }: {
    choices: readonly SliceChoice[]; onPick: (id: string) => void; onRetry?: () => void; rows?: boolean;
}) {
    const chip = useRecipe({ key: "chip" });
    const frame = useSlotRecipe({ key: "sliceFrame" })();
    const styles = useSlotRecipe({ key: "sliceEdit" })();
    const view = useSlotStyles("sliceFiltersView");
    const words = useFormatters();
    if (rows) {
        return <Box css={view.choices} data-slice-choice-rows="">{choices.map(choice => <Box key={choice.id}>
            <chakra.button type="button" role="checkbox" css={view.choice} aria-checked={choice.active} disabled={choice.disabled}
                data-slice-choice={choice.id} onClick={() => onPick(choice.id)}>
                <Box as="span" css={view.choiceBox} aria-hidden="true">{choice.active && <FontAwesomeIcon icon={faCheck} />}</Box>
                <Box as="span" css={view.choiceText}>
                    <Box as="span" css={view.choiceLabel}>{choice.label}</Box>
                    {choice.hint && <Box as="span" css={view.choiceHint}>{choice.hint}</Box>}
                </Box>
                {choice.count !== undefined && !choice.error && <Box as="span" css={view.choiceCount}>
                    {choice.count === null ? <Box as="span" role="status" aria-busy="true" aria-label="Count loading">…</Box> : words.number(choice.count)}
                </Box>}
            </chakra.button>
            {choice.error && <Box css={[styles.hintRow, view.choiceError]} role="alert"><Box as="span" css={styles.hintError}>{choice.error}</Box>
                {onRetry && <Button size="xs" variant="ghost" onClick={onRetry}>Retry</Button>}</Box>}
        </Box>)}</Box>;
    }
    return <Box css={styles.controlRow}>{choices.map(choice => <Box key={choice.id} css={styles.choiceList}>
        <chakra.button type="button" css={[frame.railTrigger, chip({ tone: choice.active ? "brand" : choice.dashed ? "dashed" : "neutral" })]}
            aria-pressed={choice.active} disabled={choice.disabled} title={choice.hint} onClick={() => onPick(choice.id)}>
            <Box as="span">{choice.label}</Box>{" "}
            {choice.count !== undefined && !choice.error && <Box as="span" css={styles.choiceCount}>
                {choice.count === null ? <Skeleton as="span" css={styles.choicePending} aria-label="Count loading" /> : words.number(choice.count)}
            </Box>}
        </chakra.button>
        {choice.hint && <Box css={styles.hint}>{choice.hint}</Box>}
        {choice.error && <Box css={styles.hintRow} role="alert"><Box as="span" css={styles.hintError}>{choice.error}</Box>
            {onRetry && <Button size="xs" variant="ghost" onClick={onRetry}>Retry</Button>}</Box>}
    </Box>)}</Box>;
}

/** Reset has one quiet action style, distinct from selectable value chips. */
export function SliceClearButton({ label, onClick, disabled }: {
    label: string; onClick: () => void; disabled?: boolean;
}) {
    return <Button size="xs" variant="ghost" disabled={disabled} onClick={onClick}>
        <FontAwesomeIcon icon={faXmark} />{label}
    </Button>;
}

/** One action row for immediate choices and draft ranges: reset left, apply right. */
export function SliceFieldActions({ label, onClear, clearDisabled, onApply, applyDisabled }: {
    label: string; onClear?: () => void; clearDisabled?: boolean;
    onApply?: () => void; applyDisabled?: boolean;
}) {
    const styles = useSlotRecipe({ key: "sliceEdit" })();
    if (onClear === undefined && onApply === undefined) return null;
    return <Box css={[styles.controlRow, styles.fieldActions]} data-slice-field-actions="">
        {onClear !== undefined && <SliceClearButton label={`Clear ${label}`} onClick={onClear}
            {...(clearDisabled === undefined ? {} : { disabled: clearDisabled })} />}
        {onApply !== undefined && <Box css={styles.footActions}>
            <Button size="xs" variant="solid" disabled={applyDisabled} onClick={onApply}>Apply</Button>
        </Box>}
    </Box>;
}

/** Share immediate and asynchronous count presentation without losing bigint precision. */
export function SliceCountSummary({ count, total, noun, children }: {
    count: bigint | undefined; total: bigint | undefined; noun: string; children?: ReactNode;
}) {
    const styles = useSlotRecipe({ key: "sliceEdit" })();
    const words = useFormatters();
    const show = (n: bigint | undefined) => n === undefined ? <Skeleton as="span" css={styles.choicePending} aria-label="Count loading" /> : words.number(n);
    return <Box as="span" css={styles.choiceCount} role="status" aria-busy={count === undefined || total === undefined}>
        {/* Its figures and its noun, apart: a phone's count line shows the figures where the noun has no room. */}
        <Box as="span" data-count-figures=""><Box as="span">{show(count)}</Box>{" "}<Box as="span">of {show(total)}</Box></Box>{" "}<Box as="span">{noun}</Box>{children}
    </Box>;
}
