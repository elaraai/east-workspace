/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The eye as an entry of its builder's View (ruled 27 Oct 2026, "Into the
 * View menu") — what the eye's toolbar item folds into where the row's floor
 * needs its room (`OPTIMISE_RANK`, `./toolbar-item.tsx`): the View that
 * bundles the period's controls on a phone lists it in the eye's place, so a
 * run, its Stop and why it is off are reachable from the toolbar at every
 * width. It does what the eye does: at rest it is named `Optimise {period}`
 * and starts a run; while a run is out it is `Stop optimising` and stops it;
 * and wherever the eye is disabled — the period's reads in flight — it is
 * disabled too, and says why (`Read-only`) in words beside its name, as a
 * touch screen shows them, where no tooltip shows. Its names are
 * `optimiseMessages`', its mark the eye's, in the eye's colours while a run
 * is out. Its styles are the `optimise` recipe's `entry` and `entryReason`.
 *
 * @packageDocumentation
 */

import { useId, useMemo } from "react";
import { Box, Button, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import type { OptimiseButtonProps } from "./button.js";
import { ElaraEye } from "./eye.js";
import { optimiseMessages } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

/** Props of {@link OptimiseEntry}: the eye's own, but its blink and its size, which an entry has none of. */
export type OptimiseEntryProps = Pick<OptimiseButtonProps, "period" | "running" | "disabled" | "onRun" | "onStop" | "messages">;

/**
 * The eye's entry in its builder's View — see the module docs.
 *
 * @param props - The scope, whether a run is out, whether it is off, and what pressing it does ({@link OptimiseEntryProps})
 * @returns The entry: a button of the View's, named for what pressing it does
 */
export function OptimiseEntry({ period, running, disabled = false, onRun, onStop, messages = optimiseMessages }: OptimiseEntryProps) {
    const recipe = useSlotRecipe({ key: "optimise" });
    const styles = useMemo(() => recipe({}) as Styles, [recipe]);
    const reason = useId();
    const label = running ? messages.stop() : messages.optimise({ period });
    return (
        <Button size="xs" variant="ghost" css={styles.entry} data-optimise-entry="" data-running={running ? "" : undefined}
            aria-label={label} aria-describedby={disabled ? reason : undefined} disabled={disabled}
            onClick={() => { if (!disabled) (running ? onStop : onRun)(); }}>
            <ElaraEye size={14} />
            <span>{label}</span>
            {disabled && <Box as="span" id={reason} css={styles.entryReason} data-entry-reason="">{messages.readOnly()}</Box>}
        </Button>
    );
}
