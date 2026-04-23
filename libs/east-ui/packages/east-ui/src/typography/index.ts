/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Text
export { Text } from "./text/index.js";
export { TextType, TextVisualStyleType, type TextStyle } from "./text/types.js";

// Code
export { Code } from "./code/index.js";
export { CodeType, CodeVariantType, CodeVisualStyleType, type CodeStyle } from "./code/types.js";

// Heading
export { Heading } from "./heading/index.js";
export { HeadingType, HeadingAsType, HeadingVisualStyleType, type HeadingStyle } from "./heading/types.js";

// Link
export { Link } from "./link/index.js";
export { LinkType, LinkVariantType, LinkVisualStyleType, type LinkStyle } from "./link/types.js";

// Highlight
export { Highlight } from "./highlight/index.js";
export { HighlightType, HighlightVisualStyleType, type HighlightStyle } from "./highlight/types.js";

// Mark
export { Mark } from "./mark/index.js";
export { MarkType, MarkVariantType, MarkVisualStyleType, type MarkStyle } from "./mark/types.js";

// List
export { List } from "./list/index.js";
export {
    ListVariantType,
    ListMarkerType,
    ListVisualStyleType,
    type ListStyle,
} from "./list/types.js";

// CodeBlock
export { CodeBlock } from "./code-block/index.js";
export { CodeBlockType, CodeBlockVisualStyleType, type CodeBlockStyle } from "./code-block/types.js";

// Numeric
export { Numeric } from "./numeric/index.js";
export {
    NumericType,
    NumericFormatType,
    NumericSentimentType,
    NumericVisualStyleType,
    type NumericStyle,
} from "./numeric/types.js";

// Note
export { Note, NoteType } from "./note/index.js";
export {
    NoteVariantType,
    NoteEmphasisType,
    NoteVisualStyleType,
    type NoteStyle,
} from "./note/types.js";
