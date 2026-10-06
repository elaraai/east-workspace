/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan (#1177, #1191, #1193): its renderer, which lays the canvas out in
 * its `BuilderFrame` and registers itself against the `Plan` extension as it
 * loads (`frame/index.tsx`), and the canvas the frame places in main
 * (`canvas.tsx`). There is no Plan outside its frame: the canvas is a hook the
 * frame calls, and its parts stay inside this package.
 *
 * @packageDocumentation
 */

export {
    EastChakraPlan,
    EastChakraPlanPayload,
    type EastChakraPlanProps,
    type EastChakraPlanPayloadProps,
    type PlanValue,
} from "./frame/index.js";
export {
    usePlanCanvas,
    setPlanRootRenderProbe,
    type PlanCanvasArgs,
    type PlanCanvasParts,
    type PlanChrome,
    type PlanRootValue,
    type PlanRowValue,
} from "./canvas.js";
