/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The eye button (#1409; `Optimise Spec.md` §8, D1, R6, R19) — the one
 * control of a run: a click at rest starts one, a click while the call is out
 * stops it. Icon-only, named `Optimise {period}` at rest and `Stop optimising`
 * while running, its tooltip the same; Enter and Space act as a click does,
 * and the focus stays on it through a run. Where the period cannot be
 * optimised at all — read only, published, a month in view — the builder
 * lists no eye (ruled 25 Oct 2026); while the period's reads are in flight it
 * is disabled, its tooltip `Read-only` — never by unapplied edits, which are
 * a run's input. Its states are the `optimise` recipe's: hover, focus,
 * running (the iris's echo and the halo on the live-pulse cycle; hovered, Stop
 * in the eye's place), one blink at a result with nothing to change, disabled.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, chakra, Portal, Tooltip, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStop } from "@fortawesome/free-solid-svg-icons";
import { ElaraEye, type ElaraEyeSize } from "./eye.js";
import { optimiseMessages, type OptimiseMessages } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

/** How long the eye's one blink takes (§8): 560ms. */
export const OPTIMISE_BLINK_MS = 560;

/** The button's sizes: `md` 32 × 32 with a 16px mark, `sm` 24 × 24 with 14, `toolbar` 32 × 28 with 14 — a builder's toolbar row's, whose every control stands 28px. */
export type OptimiseButtonSize = "md" | "sm" | "toolbar";

/** The mark's size at each of the button's. */
const MARK: Readonly<Record<OptimiseButtonSize, ElaraEyeSize>> = { md: 16, sm: 14, toolbar: 14 };

/** Props of {@link OptimiseButton}. */
export interface OptimiseButtonProps {
    /** The scope's label, named in `Optimise {period}` — `W11`, `Oct 5 – 9`, `8 work orders`. */
    readonly period: string;
    /** Whether a run is out: the eye runs, and a click stops it. */
    readonly running: boolean;
    /** Moves each time a run lands with nothing to change: the eye blinks once each time it does. */
    readonly blink?: number | undefined;
    /** Disabled while the period cannot take a run yet — its reads in flight; its tooltip `Read-only`. A period that can never be optimised lists no eye. */
    readonly disabled?: boolean | undefined;
    /** Starts a run. */
    readonly onRun: () => void;
    /** Stops the run out. */
    readonly onStop: () => void;
    /** Its size: `md` unless given. */
    readonly size?: OptimiseButtonSize | undefined;
    /** The words: the shared table unless given. */
    readonly messages?: OptimiseMessages | undefined;
}

/**
 * The eye button — see the module docs.
 *
 * @param props - The scope, whether a run is out, and what a click does ({@link OptimiseButtonProps})
 * @returns The button, with its tooltip
 */
export function OptimiseButton({ period, running, blink, disabled = false, onRun, onStop, size = "md", messages = optimiseMessages }: OptimiseButtonProps) {
    const recipe = useSlotRecipe({ key: "optimise" });
    const styles = useMemo(() => recipe({ size }) as Styles, [recipe, size]);
    // One blink each time `blink` moves (a result with nothing to change), for the blink's length.
    const [blinking, setBlinking] = useState(false);
    const last = useRef(blink);
    useEffect(() => {
        if (blink === undefined || blink === last.current) return undefined;
        last.current = blink;
        setBlinking(true);
        const timer = setTimeout(() => setBlinking(false), OPTIMISE_BLINK_MS);
        return () => clearTimeout(timer);
    }, [blink]);
    const label = running ? messages.stop() : messages.optimise({ period });
    const tip = disabled ? messages.readOnly() : label;
    return (
        <Tooltip.Root openDelay={250}>
            <Tooltip.Trigger asChild>
                {/* The tooltip's trigger wraps the button: a disabled button fires no pointer events of its own. */}
                <span>
                    <chakra.button type="button" css={styles.button} data-optimise-button="" data-size={size}
                        data-running={running ? "" : undefined} data-blink={blinking ? "" : undefined}
                        aria-label={label} disabled={disabled}
                        onClick={() => { if (!disabled) (running ? onStop : onRun)(); }}>
                        <ElaraEye size={MARK[size]} />
                        <Box as="span" css={styles.stop} data-eye-stop="" aria-hidden="true"><FontAwesomeIcon icon={faStop} /></Box>
                    </chakra.button>
                </span>
            </Tooltip.Trigger>
            <Portal><Tooltip.Positioner><Tooltip.Content>{tip}</Tooltip.Content></Tooltip.Positioner></Portal>
        </Tooltip.Root>
    );
}
