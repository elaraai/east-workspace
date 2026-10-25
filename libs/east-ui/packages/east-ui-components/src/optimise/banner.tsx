/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The banner a run lands with (#1409; `Optimise Spec.md` §8, R21) — the
 * shared `BannerView` in the frame's banners slot, inset 0 12 12, in its
 * Elara tone: the eye mark, a title and one line, no actions. Done — **Elara
 * optimised {period}** · `{n} changes: {a} added, {c} changed, {r} removed.
 * Undo or apply them like any edit.` — and none — **No changes** · `Elara
 * found nothing to improve in {period}.` — are `role="status"`; fail —
 * **Couldn't optimise {period}** · `Nothing changed. Run it again from the
 * eye.` — is `role="alert"`, in the error tone with the exclamation mark. It
 * fades in over `--dur-base`, and when its outcome goes it collapses over
 * `--dur-base` — height, opacity and margin — then leaves.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useState } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleExclamation } from "@fortawesome/free-solid-svg-icons";
import { BannerView } from "../feedback/banner/index.js";
import { useFormatters } from "../format/index.js";
import { ElaraEye } from "./eye.js";
import { optimiseMessages, type OptimiseMessages } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

/** How long the banner takes to collapse once its outcome goes: the design system's `--dur-base`. */
export const OPTIMISE_BANNER_COLLAPSE_MS = 200;

/** What a run came to: changes, with their counts; nothing to change; or a failure. */
export type OptimiseOutcome =
    | { readonly kind: "done"; readonly period: string; readonly added: number; readonly changed: number; readonly removed: number }
    | { readonly kind: "none"; readonly period: string }
    | { readonly kind: "fail"; readonly period: string };

/** Props of {@link OptimiseBanner}. */
export interface OptimiseBannerProps {
    /** What the banner says; `undefined` with none to say, which collapses one that shows. */
    readonly outcome: OptimiseOutcome | undefined;
    /** Dismisses the banner, ending the highlight with it (R16); with none, the banner has no close. */
    readonly onDismiss?: (() => void) | undefined;
    /** The words: the shared table unless given. */
    readonly messages?: OptimiseMessages | undefined;
}

/**
 * The banner's words for an outcome.
 *
 * @param outcome - The outcome
 * @param m - The words
 * @param number - The locale's number formatter
 * @returns Its title and its line
 */
function wordsOf(outcome: OptimiseOutcome, m: OptimiseMessages, number: (n: number) => string): { title: string; detail: string } {
    switch (outcome.kind) {
        case "done": {
            const n = outcome.added + outcome.changed + outcome.removed;
            const parts = [
                outcome.added > 0 ? m.added({ count: number(outcome.added) }) : undefined,
                outcome.changed > 0 ? m.changed({ count: number(outcome.changed) }) : undefined,
                outcome.removed > 0 ? m.removed({ count: number(outcome.removed) }) : undefined,
            ].filter((part): part is string => part !== undefined).join(", ");
            return { title: m.done({ period: outcome.period }), detail: m.doneDetail({ n, count: number(n), parts }) };
        }
        case "none": return { title: m.none(), detail: m.noneDetail({ period: outcome.period }) };
        case "fail": return { title: m.fail({ period: outcome.period }), detail: m.failDetail() };
    }
}

/**
 * The banner a run lands with — see the module docs.
 *
 * @param props - The outcome, and what dismisses it ({@link OptimiseBannerProps})
 * @returns The banner; nothing once it has collapsed
 */
export function OptimiseBanner({ outcome, onDismiss, messages = optimiseMessages }: OptimiseBannerProps) {
    const recipe = useSlotRecipe({ key: "optimise" });
    const styles = useMemo(() => recipe({}) as Styles, [recipe]);
    const { number } = useFormatters();
    // The outcome shown: kept while the banner collapses, once the outcome has gone.
    const [held, setHeld] = useState(outcome);
    if (outcome !== undefined && outcome !== held) setHeld(outcome);
    const leaving = outcome === undefined && held !== undefined;
    useEffect(() => {
        if (!leaving) return undefined;
        const timer = setTimeout(() => setHeld(undefined), OPTIMISE_BANNER_COLLAPSE_MS);
        return () => clearTimeout(timer);
    }, [leaving]);
    if (held === undefined) return null;
    const { title, detail } = wordsOf(held, messages, number);
    const failed = held.kind === "fail";
    return (
        <Box css={styles.banner} data-optimise-banner={held.kind} data-leaving={leaving ? "" : undefined}>
            <Box css={styles.bannerBox}>
                <BannerView status={failed ? "error" : "elara"} title={title} description={detail}
                    mark={failed ? <FontAwesomeIcon icon={faCircleExclamation} /> : <ElaraEye size={16} />}
                    dismissible={onDismiss !== undefined} onDismiss={onDismiss} />
            </Box>
        </Box>
    );
}
