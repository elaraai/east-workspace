/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Internal exports — the component **factories** (`Button.Root(…)`,
 * `Stack.VStack([…])`, `Input.String(…)`) plus standalone style/data types.
 *
 * @remarks
 * The public `@elaraai/east-ui` entry exports JSX **tags**. This entry is for
 * internal consumers that build/inspect IR directly — the renderer
 * (`east-ui-components`) and the in-repo test specs — which call the factories
 * and reference the East type values (`Button.Types.Button`, …). Not part of
 * the public authoring API.
 *
 * @internal
 * @packageDocumentation
 */

// Re-export variant from East for convenience
export { variant } from "@elaraai/east";

// Style System
export { Style } from "./style.js";
export { DensityType, type DensityLiteral } from "./style/interaction.js";

// Drag & drop grammar contract
export {
    LibraryRefType,
    CellRefType,
    DragSinkType, type DragSinkLiteral,
    DragEdgeType, type DragEdgeLiteral,
    DragEventType,
} from "./contracts/drag.js";

// Format helpers
export { Format } from "./format/index.js";
export type {
    NumberFormatOptions,
    CurrencyFormatOptions,
    PercentFormatOptions,
    CompactFormatOptions,
    UnitFormatOptions,
} from "./format/index.js";

// Component factories, by category
export {
    Text, Code, Heading, Link, Highlight, Mark, List, CodeBlock,
    Numeric, Note,
} from "./typography/index.js";
export {
    Box, Flex, Stack, AlignedStack, Separator, Grid, Splitter,
    Sticky, ScrollArea,
} from "./layout/index.js";
export { Button, IconButton, CopyButton, CloseButton, Toggle, ButtonGroup } from "./buttons/index.js";
export type { ButtonLabelInput, ButtonOptions } from "./buttons/index.js";
export { Input, Checkbox, RadioGroup, RadioCardGroup, TimeRangeInput, DateRangeInput, Switch, Select, Combobox, Slider, Field, FileUpload, Textarea, TagsInput } from "./forms/index.js";
export { Progress, Banner, EmptyState, Skeleton, Status } from "./feedback/index.js";
export { Breadcrumb, NavList, NavListType, NavSectionType, NavItemType } from "./navigation/index.js";
export type { NavListStyle, NavSectionInput, NavItemInput } from "./navigation/index.js";
export { Navigation, Pages, NavBindHandleType, navBindPlatformFn, NavBindPrimitives, routeVariantType } from "./navigation/index.js";
export type {
    NavRoutes, NavRouteConfig, NavConfig, RouteVariantOf, NavHandleType, BoundNav, PageConstructors, PagesHandlers, PagesInput,
} from "./navigation/index.js";
export { Badge, Tag, Avatar, Stat, Icon, MetricChip, EditableChip, Kbd, Meter, SegmentedMeter, BarStrip, AvatarGroup, Trace, ChipRail, type IconName } from "./display/index.js";
export { Card } from "./container/index.js";
export { DataList, Matrix, Pagination, Table, TreeView, Gantt, Planner, Library, Roster, Board, Calendar, Schematic, Map, Blend } from "./collections/index.js";
export { Chart } from "./charts/chart/index.js";
export { Sparkline } from "./charts/index.js";
export { Accordion, Carousel, Collapsible, Disclosure, OptionList, SegmentGroup, Story, Tabs } from "./disclosure/index.js";
export { Tooltip, Menu, Dialog, dialog_open, Drawer, drawer_open, Popover, HoverCard, ActionBar, ToggleTip, CommandPalette } from "./overlays/index.js";
export { Hotkey, HotkeyType } from "./platform/hotkey/index.js";
export { Reactive } from "./reactive/index.js";

// Component / extension / platform
export { UIComponentType } from "./component.js";
export {
    EastUI,
    component,
    type UIComponentDef,
    type UIComponentOptions,
} from "./extension.js";
export { State, StateBindPrimitives, SliceApplyImpl, sliceDimensions, sliceFields, sliceMatches, sliceBreakdown, sliceSeries, SLICE_SERIES_PALETTE, Clipboard, Download, Share } from "./platform/index.js";
export { SliceConfigType, sliceConfigTypeFor, SliceChromeType, SliceStateType, SliceBindType, SliceBindPrimitives } from "./platform/slice/index.js";
export { SliceAffordanceType, type SliceAffordanceLiteral } from "./contracts/slice-affordances.js";
export {
    Slice,
    SliceSummaryType, SliceRangePickerType, SliceFilterType,
    SliceLegendType, SliceBreakdownPickerType,
    SliceSearchType, SliceSearchMatchType,
} from "./slice/index.js";

// JSX combinators (custom-tag authoring) — also surfaced here for internal use.
export { optionsTag, content, leaf, container, hasKeys } from "./runtime/combinators.js";
export type { JsxTag, ContainerProps, ContentProps, ValueProps, OptionsProps } from "./runtime/combinators.js";

// Standalone style/data types (renderers reference these directly).
export * from "./layout/box/types.js";
export * from "./layout/stack/types.js";
export * from "./layout/aligned-stack/types.js";
export * from "./shared/plot-gutter.js";
export * from "./layout/grid/types.js";
export * from "./layout/separator/types.js";
export * from "./layout/splitter/types.js";
export * from "./buttons/button/types.js";
export * from "./forms/input/types.js";
export * from "./forms/checkbox/types.js";
export * from "./forms/switch/types.js";
export * from "./forms/select/types.js";
export * from "./forms/slider/types.js";
export * from "./forms/field/types.js";
export * from "./forms/file-upload/types.js";
export * from "./forms/textarea/types.js";
export * from "./forms/tags-input/types.js";
export * from "./feedback/banner/status-type.js";
export * from "./feedback/banner/types.js";
export * from "./feedback/progress/types.js";
export * from "./display/avatar/types.js";
export * from "./display/badge/types.js";
export * from "./display/stat/types.js";
export * from "./display/tag/types.js";
export * from "./display/trace/types.js";
export * from "./container/card/types.js";
export * from "./collections/data-list/types.js";
export * from "./collections/table/types.js";
export * from "./collections/tree-view/types.js";
export * from "./format/types.js";
export * from "./charts/sparkline/types.js";
export * from "./disclosure/accordion/types.js";
export * from "./disclosure/carousel/types.js";
export * from "./disclosure/story/types.js";
export * from "./overlays/tooltip/types.js";
export * from "./overlays/menu/types.js";
