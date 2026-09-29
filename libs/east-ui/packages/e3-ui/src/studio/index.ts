/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio (#787) — components developers publish as code, and the pages
 * operators build from them on the 12-column snap grid.
 *
 * @packageDocumentation
 */

import {
    StudioComponentType,
    StudioComponents,
    StudioFrameType,
} from "./component.js";

export {
    StudioComponentType,
    StudioFrameType,
    fingerprintOf,
    type StudioComponentMeta,
    type StudioFrameLiteral,
} from "./component.js";

/** The type of the {@link Studio} namespace. */
export interface StudioNamespace {
    /** Declares a component: a self-contained East UI function, and what the palette shows of it. */
    component: typeof StudioComponents.component;
    /** Renders one placement by its component's key, from the components a surface lists. */
    dispatch: typeof StudioComponents.dispatch;
    /** The Studio's East types. */
    Types: {
        /** A Studio component ({@link StudioComponentType}). */
        Component: typeof StudioComponentType;
        /** How a component's placements are drawn ({@link StudioFrameType}). */
        Frame: typeof StudioFrameType;
    };
}

/**
 * The Studio — components developers publish as code (`Studio.component`),
 * and the placements that render them (`Studio.dispatch`).
 */
export const Studio: StudioNamespace = {
    component: StudioComponents.component,
    dispatch: StudioComponents.dispatch,
    Types: {
        Component: StudioComponentType,
        Frame: StudioFrameType,
    },
};
