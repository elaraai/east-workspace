/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East UI — UI component library for the East language.
 *
 * @remarks
 * The public surface is **JSX tags**: capitalized, React-style components
 * (`<Button variant="solid">Save</Button>`, `<VStack gap="4">…</VStack>`) that
 * desugar to East IR. Author them in a `.tsx` file with the
 * `/** @jsxImportSource @elaraai/east-ui *​/` pragma. Each tag also carries its
 * `Types` namespace (e.g. `Table.Types.CellRenderContext`, `Slider.Types`) and,
 * where relevant, data-builders (`Select.Item`) and nested tags
 * (`<Text.Eyebrow>`).
 *
 * The underlying factories (`Button.Root(…)`) are an implementation detail and
 * live under `@elaraai/east-ui/internal` for renderers and tests.
 *
 * Components return East data structures (variants/structs) that can be
 * serialized to IR, compiled, and rendered in any environment.
 *
 * @packageDocumentation
 */

// Re-export variant from East for convenience
export { variant } from "@elaraai/east";

// JSX combinators — wrap any factory as a custom tag (the extension API).
export { optionsTag, content, leaf, container, hasKeys } from "./runtime/combinators.js";
export type { JsxTag, ContainerProps, ContentProps, ValueProps, OptionsProps } from "./runtime/combinators.js";
export { coalesceChildren } from "./runtime/children.js";
export type { ContainerChildrenType } from "./runtime/children.js";
export type { UIElement } from "./runtime/runtime.js";

// Style System
export { Style } from "./style.js";
export { DensityType, type DensityLiteral, StatusTokenType, type StatusTokenLiteral } from "./style/interaction.js";

// Drag & drop grammar contract — hosts type `onDrag` handlers against these
export {
    LibraryRefType,
    CellRefType,
    DragSinkType, type DragSinkLiteral,
    DragEdgeType, type DragEdgeLiteral,
    DragEventType,
    CanDropFnType,
} from "./contracts/drag.js";

// Review / approval grammar contract — hosts type `review` configs against these
export {
    ApprovalStateType, type ApprovalStateLiteral,
    RowRefType,
    reviewType, type ReviewStructType,
    RowReviewType,
    type ReviewConfig,
    deriveApproval,
} from "./contracts/review.js";

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
} from "./runtime/typography/index.js";

// Layout
export {
    Box, Flex, Stack, VStack, HStack, AlignedStack, Separator, Grid, Splitter,
    Sticky, ScrollArea, Expandable, Dock, Configurator,
} from "./runtime/layout/index.js";

// Buttons
export { Button, IconButton, CopyButton, CloseButton, Toggle, ButtonGroup } from "./runtime/buttons/index.js";
export type { ButtonLabelInput, ButtonOptions } from "./buttons/index.js";

// Forms
export { Input, Checkbox, RadioGroup, RadioCardGroup, TimeRangeInput, DateRangeInput, Switch, Select, Combobox, Slider, Field, FileUpload, Textarea, TagsInput } from "./runtime/forms/index.js";

// Feedback
export { Progress, Banner, EmptyState, Skeleton, Status } from "./runtime/feedback/index.js";

// Navigation
export { App, Breadcrumb, NavList, Pages, Route } from "./runtime/navigation/index.js";
export { NavListType, NavSectionType, NavItemType } from "./navigation/index.js";
export type { NavListStyle, NavSectionInput, NavItemInput, AppInput } from "./navigation/index.js";
// First-class navigation: the Navigation config/bind handle API (like State / Slice).
// `Pages` is the `<Pages nav pages>` JSX tag (re-exported above); its `.Root`
// factory takes `{ nav, pages }` and `Pages.Types.Handle(routes)` is the handle
// type builder (namespaced — never bare-exported).
export { Navigation } from "./navigation/index.js";
export type {
    NavRoutes, NavRouteConfig, NavConfig, RouteVariantOf, NavHandleType, BoundNav, PageConstructors,
} from "./navigation/index.js";

// Display
export { Badge, Tag, Avatar, Image, Stat, Icon, MetricChip, EditableChip, Kbd, Meter, SegmentedMeter, BarStrip, AvatarGroup, Trace, ChipRail } from "./runtime/display/index.js";
export type { IconName } from "./display/index.js";

// Containers
export { Card } from "./runtime/container/index.js";

// Collections
export { DataList, Deck, ValueTree, Matrix, Pagination, Table, TreeView, Gantt, Planner, Library, Roster, Board, Calendar, Schematic, Flowchart, Map, Blend } from "./runtime/collections/index.js";

// Charts
export { Chart, Sparkline } from "./runtime/charts/index.js";

// Disclosure
export { Accordion, Carousel, Collapsible, Disclosure, OptionList, SegmentGroup, Story, Tabs } from "./runtime/disclosure/index.js";

// Overlays
export { Tooltip, Menu, Dialog, Drawer, Popover, HoverCard, ActionBar, ToggleTip, CommandPalette } from "./runtime/overlays/index.js";
export { dialog_open, drawer_open } from "./overlays/index.js";
export { HotkeyType } from "./platform/hotkey/index.js";
export { Hotkey } from "./runtime/platform-hotkey.js";

// Reactive (selective re-rendering)
export { Reactive, Match } from "./runtime/reactive/index.js";

// Component Types
export { UIComponentType, type UIComponentNode } from "./component.js";

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
export { Slice } from "./runtime/slice.js";
export {
    SliceSummaryType, SliceRangePickerType, SliceFilterType,
    SliceLegendType, SliceBreakdownPickerType,
    SliceSearchType, SliceSearchMatchType,
    SliceCohortModeType, SliceCohortPickerType,
} from "./slice/index.js";
export { type SliceCohortOptions, type SlicePresetsOptions } from "./slice/cohort/index.js";
