/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East UI - UI component library for the East language.
 *
 * @remarks
 * East UI provides typed UI component definitions that return data structures
 * describing UI layouts rather than rendering directly. This enables portability,
 * type safety, composability, and separation of concerns.
 *
 * Components return East data structures (variants/structs) that can be:
 * - Serialized to JSON as East IR
 * - Compiled to executable functions
 * - Rendered in any environment (React with Chakra UI, HTML, etc.)
 *
 * @packageDocumentation
 */

// Re-export variant from East for convenience
export { variant } from "@elaraai/east";

// Style System
export { Style } from "./style.js";
export { DensityType, type DensityLiteral } from "./style/interaction.js";

// Format helpers
export { Format } from "./format/index.js";
export type {
    NumberFormatOptions,
    CurrencyFormatOptions,
    PercentFormatOptions,
    CompactFormatOptions,
    UnitFormatOptions,
} from "./format/index.js";

// Typography
export {
    Text, Code, Heading, Link, Highlight, Mark, List, CodeBlock,
    Numeric, Note,
} from "./typography/index.js";

// Layout
export {
    Box, Flex, Stack, Separator, Grid, Splitter,
    Sticky, ScrollArea, ChipRail,
} from "./layout/index.js";

// Buttons
export { Button, IconButton, CopyButton, CloseButton, Toggle, ButtonGroup } from "./buttons/index.js";
export type { ButtonLabelInput, ButtonOptions } from "./buttons/index.js";

// Forms
export { Input, Checkbox, RadioGroup, RadioCardGroup, TimeScaleControl, TimeRangeInput, DateRangeInput, Switch, Select, Combobox, Slider, Field, FileUpload, Textarea, TagsInput } from "./forms/index.js";

// Feedback
export { Progress, Banner, EmptyState, Skeleton, Status } from "./feedback/index.js";

// Navigation
export { Breadcrumb, NavList, NavListType, NavSectionType, NavItemType } from "./navigation/index.js";
export type { NavListStyle, NavSectionInput, NavItemInput } from "./navigation/index.js";

// Display
export { Badge, Tag, Avatar, Stat, Icon, MetricChip, EditableChip, Kbd, Meter, SegmentedMeter, BarStrip, AvatarGroup, type IconName } from "./display/index.js";

// Containers
export { Card } from "./container/index.js";

// Collections
export { DataList, Matrix, Pagination, Table, TreeView, Gantt, Planner } from "./collections/index.js";

// Charts
export { Chart, Sparkline } from "./charts/index.js";

// Disclosure
export { Accordion, Carousel, Collapsible, Disclosure, OptionList, SegmentGroup, Tabs } from "./disclosure/index.js";

// Overlays
export { Tooltip, Menu, Dialog, dialog_open, Drawer, drawer_open, Popover, HoverCard, ActionBar, ToggleTip, CommandPalette } from "./overlays/index.js";
export { Hotkey, HotkeyType } from "./platform/hotkey/index.js";

// Reactive (selective re-rendering)
export { Reactive } from "./reactive/index.js";

// Component Types
export { UIComponentType } from "./component.js";

// Extension mechanism — declare custom UI components that are rendered by
// downstream `*-components` packages (the UI analog of platform functions).
export {
    EastUI,
    component,
    type UIComponentDef,
    type UIComponentOptions,
} from "./extension.js";

// Platform (state management - signatures only)
// For e3 dataset bindings, use Data.bind from @elaraai/e3-ui
export { State, SliceApplyImpl, sliceDimensions, sliceFields, sliceMatches, sliceBreakdown, sliceSeries, SLICE_SERIES_PALETTE, Clipboard, Download, Share } from "./platform/index.js";
export {
    Slice,
    SliceSummaryType, SliceRangePickerType, SliceFilterType,
    SliceLegendType, SliceBreakdownPickerType,
    SliceSearchType, SliceSearchMatchType,
} from "./slice/index.js";
