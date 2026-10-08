/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `@elaraai/east-ui-components/testing` — the DOM test helpers this package's
 * renderer tests use, for the sibling renderer packages' tests (e3-ui-components'
 * Plan, #1177): the drag layer's faked seams, slice configs, the row frame's
 * re-measure probe, and the icon checks (#1263). Not an API for apps. They
 * need React's `act` and a DOM — jsdom in a test run — and nothing of a test
 * framework. It also hands a browser spec the editing session's words
 * (`editingMessages`, #1194), which it names the history item's controls by:
 * this entry loads in Node, where the package's own needs a DOM.
 *
 * @packageDocumentation
 */

export { announced, layOut, pointAt, press, stubScrollIntoView, tick } from "./testing/drag-layer.js";
export { ICON_GLYPHS, faIcons, loneGlyphs, markOf } from "./testing/icons.js";
export { integerField, sliceConfig, stringField, type SliceFieldSpec } from "./testing/slice.js";
export { setVirtualRowsMeasureProbe } from "./collections/virtual-rows.js";
export { editingMessages } from "./editing/messages.js";
