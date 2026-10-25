/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Optimise run's shared parts (#1409; `Optimise Spec.md`) — what every
 * builder that takes the app's optimiser draws in its own frame: the Elara
 * eye and its button, the eye's toolbar item before the history item, the
 * banner the result lands with, the legend's `Elara change`, the footer
 * line's words while the call is out, and the words table. The run itself,
 * the one history step and the landing on a builder's entries are the
 * builder's (e3-ui-components).
 *
 * @packageDocumentation
 */

export { ElaraEye, ELARA_EYE_DOTS, type ElaraEyeProps, type ElaraEyeSize } from "./eye.js";
export { OptimiseButton, OPTIMISE_BLINK_MS, type OptimiseButtonProps, type OptimiseButtonSize } from "./button.js";
export { optimiseToolbarItem, OPTIMISE_RANK } from "./toolbar-item.js";
export { OptimiseBanner, OPTIMISE_BANNER_COLLAPSE_MS, type OptimiseBannerProps, type OptimiseOutcome } from "./banner.js";
export { OptimiseLegendItem, type OptimiseLegendItemProps } from "./legend.js";
export { optimiseRunningLine, optimiseStoppedLine, optimiseSeconds } from "./line.js";
export { optimiseMessages, type OptimiseMessages } from "./messages.js";
export {
    useLanding, useLandingStyles, cascadeDelays, cascadeOrder, cascadeStep,
    OPTIMISE_CASCADE_MS, OPTIMISE_CASCADE_STEP_MS, OPTIMISE_COLUMN_PX, OPTIMISE_FLARE_MS, OPTIMISE_GLOW_FADE_MS, OPTIMISE_HIGHLIGHT_MS, OPTIMISE_TOTALS_DELAY_MS,
    type CascadeBox, type Landing, type LandingAttributes, type LandingStyles,
} from "./landing.js";
