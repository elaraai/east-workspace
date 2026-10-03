/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Layout components for structuring content.
 */
export {
    toChakraBox,
    EastChakraBox,
    type BoxValue,
    type EastChakraBoxProps,
} from "./box/index.js";

export {
    toChakraFlex,
    EastChakraFlex,
    type FlexValue,
    type EastChakraFlexProps,
} from "./flex/index.js";

export {
    toChakraStack,
    EastChakraStack,
    type StackValue,
    type EastChakraStackProps,
} from "./stack/index.js";

export {
    toChakraSeparator,
    EastChakraSeparator,
    type SeparatorValue,
    type EastChakraSeparatorProps,
} from "./separator/index.js";

export {
    toChakraGrid,
    EastChakraGrid,
    type GridValue,
    type EastChakraGridProps,
} from "./grid/index.js";

export {
    toChakraSplitter,
    EastChakraSplitter,
    type SplitterValue,
    type EastChakraSplitterProps,
} from "./splitter/index.js";

export {
    EastChakraSnapGrid,
    SnapGridTiles,
    type SnapGridValue,
    type SnapGridCellValue,
    type SnapGridLayoutCell,
    type SnapGridTilesProps,
    type SnapGridEditorCell,
    type SnapGridEditorEditing,
    type SnapGridEditorValue,
    type EastChakraSnapGridProps,
} from "./snap-grid/index.js";
export { DockPane, type DockPaneProps } from "./dock/index.js";
export {
    BuilderFrame,
    placePanes,
    paneWidths,
    MIN_MAIN,
    MIN_SCRIM,
    NARROW_FRAME,
    type BuilderFrameProps,
    type BuilderFramePane,
    type BuilderFrameDock,
    type PaneMode,
    type PanePlacement,
    type PanePlacements,
    type PaneWeight,
    type PaneWidths,
} from "./builder-frame/index.js";
export { SnapGridEditor, type SnapGridEditorProps } from "./snap-grid/editor.js";
export {
    SnapGridMessagesProvider,
    snapGridMessages,
    type SnapGridMessages,
    type SnapGridMessagesProviderProps,
} from "./snap-grid/messages.js";
