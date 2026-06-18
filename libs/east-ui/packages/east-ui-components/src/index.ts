/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East UI React - React components for rendering East UI types with Chakra UI.
 *
 * @packageDocumentation
 */

/* The self-hosted brand fonts live in a separate subpath
 * (`@elaraai/east-ui-components/fonts`) so app entry points opt in with a
 * single side-effect import — keeping the main `system` entry CSS-free so
 * Node test runners (which lack a CSS loader) can still import this
 * module transitively. See README / CLAUDE.md for the consumer pattern. */

// Canonical Elara Chakra v3 system — wrap your root in `<ChakraProvider value={system}>`.
export {
    system,
    tokens,
    semanticTokens,
    textStyles,
    layerStyles,
    globalCss,
    buttonRecipe,
    inputRecipe,
} from "./theme/index.js";

// Top-level component that renders any East UI component
export { EastChakraComponent, type EastChakraComponentProps } from "./component.js";

// Renderer-side primitives — shared chrome consumed by pattern renderers.
export { Pill, type PillProps, type PillSize } from "./primitives/index.js";

// Typography
export {
    toChakraText,
    EastChakraText,
    type TextValue,
    type EastChakraTextProps,
    Markdown,
    type MarkdownProps,
} from "./typography/index.js";

// Buttons
export {
    toChakraButton,
    EastChakraButton,
    type ButtonValue,
    type EastChakraButtonProps,
    toChakraIconButton,
    EastChakraIconButton,
    type IconButtonValue,
    type EastChakraIconButtonProps,
    EastChakraCopyButton,
    type CopyButtonValue,
    type EastChakraCopyButtonProps,
} from "./buttons/index.js";

// Layout
export {
    toChakraBox,
    EastChakraBox,
    type BoxValue,
    type EastChakraBoxProps,
    toChakraStack,
    EastChakraStack,
    type StackValue,
    type EastChakraStackProps,
    toChakraSeparator,
    EastChakraSeparator,
    type SeparatorValue,
    type EastChakraSeparatorProps,
    toChakraGrid,
    EastChakraGrid,
    type GridValue,
    type EastChakraGridProps,
    toChakraSplitter,
    EastChakraSplitter,
    type SplitterValue,
    type EastChakraSplitterProps,
} from "./layout/index.js";

// Charts
export {
    EastChakraSparkline,
    type EastChakraSparklineProps,
    EastVisxChart,
    type EastVisxChartProps,
} from "./charts/index.js";

// Disclosure
export {
    EastChakraAccordion,
    EastChakraAccordionItem,
    toChakraAccordionRoot,
    toChakraAccordionItem,
    type AccordionValue,
    type AccordionItemValue,
    type EastChakraAccordionProps,
    type EastChakraAccordionItemProps,
    EastChakraCarousel,
    toChakraCarousel,
    type CarouselValue,
    type EastChakraCarouselProps,
    EastChakraTabs,
    EastChakraTabsTrigger,
    EastChakraTabsContent,
    toChakraTabsRoot,
    toChakraTabsTrigger,
    toChakraTabsContent,
    type TabsValue,
    type TabsItemValue,
    type EastChakraTabsProps,
    type EastChakraTabsItemProps,
    EastChakraStory,
    EastChakraStoryStep,
    EastChakraStoryProgress,
    type EastChakraStoryProps,
    type EastChakraStoryStepProps,
    type EastChakraStoryProgressProps,
} from "./disclosure/index.js";

// Collections
export {
    EastChakraDataList,
    toChakraDataListRoot,
    type DataListRootValue,
    type DataListItemValue,
    type EastChakraDataListProps,
    EastChakraTable,
    toChakraTableRoot,
    type TableRootValue,
    type TableColumnValue,
    type EastChakraTableProps,
    EastChakraTreeView,
    toChakraTreeViewRoot,
    type TreeViewRootValue,
    type TreeNodeValue,
    type EastChakraTreeViewProps,
    EastChakraPlanner,
    type PlannerRootValue,
    type PlannerEventValue,
    type EastChakraPlannerProps,
    EastChakraLibrary,
    type LibraryValue,
    type LibraryItemValue,
    type EastChakraLibraryProps,
    EastChakraRoster,
    type RosterValue,
    type RosterShiftValue,
    type EastChakraRosterProps,
    EastChakraCalendar,
    type CalendarValue,
    type CalendarCellValue,
    type EastChakraCalendarProps,
    EastChakraSchematic,
    type SchematicValue,
    type SchematicItemValue,
    type EastChakraSchematicProps,
    EastChakraMap,
    type MapValue,
    type MapAreaValue,
    type MapMarkerValue,
    type MapLineValue,
    type MapOverlayValue,
    type EastChakraMapProps,
    EastChakraBlend,
    type BlendValue,
    type BlendTargetValue,
    type BlendAllocationValue,
    type EastChakraBlendProps,
} from "./collections/index.js";

// Navigation
export {
    EastChakraBreadcrumb,
    type BreadcrumbRootValue,
    type BreadcrumbItemValue,
    type EastChakraBreadcrumbProps,
    type EastChakraBreadcrumbItemProps,
} from "./navigation/index.js";

// Display
export {
    EastChakraIcon,
    toFontAwesomeIcon,
    type IconValue,
    type EastChakraIconProps,
    EastChakraBadge,
    toChakraBadge,
    type BadgeValue,
    type EastChakraBadgeProps,
    EastChakraTag,
    toChakraTag,
    type TagValue,
    type EastChakraTagProps,
    EastChakraAvatar,
    toChakraAvatar,
    type AvatarValue,
    type EastChakraAvatarProps,
    EastChakraStat,
    type StatValue,
    type EastChakraStatProps,
} from "./display/index.js";

// Forms
export {
    // Input
    EastChakraStringInput,
    EastChakraIntegerInput,
    EastChakraFloatInput,
    EastChakraDateTimeInput,
    toChakraStringInput,
    toChakraIntegerInput,
    toChakraFloatInput,
    toChakraDateTimeInput,
    type StringInputValue,
    type IntegerInputValue,
    type FloatInputValue,
    type DateTimeInputValue,
    type EastChakraStringInputProps,
    type EastChakraIntegerInputProps,
    type EastChakraFloatInputProps,
    type EastChakraDateTimeInputProps,
    type ChakraDateTimeInputProps,
    // Checkbox
    EastChakraCheckbox,
    toChakraCheckbox,
    type CheckboxValue,
    type EastChakraCheckboxProps,
    // Switch
    EastChakraSwitch,
    toChakraSwitch,
    type SwitchValue,
    type EastChakraSwitchProps,
    // Select
    EastChakraSelect,
    toChakraSelect,
    type SelectRootValue,
    type SelectItemValue,
    type EastChakraSelectProps,
    // Combobox
    EastChakraCombobox,
    toChakraCombobox,
    type ComboboxRootValue,
    type ComboboxItemValue,
    type EastChakraComboboxProps,
    // Slider
    EastChakraSlider,
    toChakraSlider,
    type SliderValue,
    type EastChakraSliderProps,
    // Field
    EastChakraField,
    toChakraField,
    type FieldValue,
    type EastChakraFieldProps,
    // Textarea
    EastChakraTextarea,
    toChakraTextarea,
    type TextareaValue,
    type EastChakraTextareaProps,
    // TagsInput
    EastChakraTagsInput,
    toChakraTagsInput,
    type TagsInputValue,
    type EastChakraTagsInputProps,
    // FileUpload
    EastChakraFileUpload,
    toChakraFileUpload,
    type FileUploadValue,
    type EastChakraFileUploadProps,
    // ClauseBuilder
    ClauseBuilder,
    ClauseChip,
    type ClauseBuilderProps,
    type ClauseChipProps,
    type ClauseFieldSpec,
    type ClauseOpSpec,
    type ClauseSubmitValue,
    type ClauseKind,
} from "./forms/index.js";

// Feedback
export {
    EastChakraProgress,
    toChakraProgress,
    type ProgressValue,
    type EastChakraProgressProps,
    EastChakraEmptyState,
    type EmptyStateValue,
    type EastChakraEmptyStateProps,
    EastChakraSkeleton,
    type SkeletonValue,
    type EastChakraSkeletonProps,
    EastChakraStatus,
    type StatusValue,
    type EastChakraStatusProps,
    EastChakraBanner,
    type BannerValue,
    type EastChakraBannerProps,
} from "./feedback/index.js";

// Container
export {
    EastChakraCard,
    toChakraCard,
    type CardValue,
    type EastChakraCardProps,
} from "./container/index.js";

// Overlays
export {
    EastChakraTooltip,
    type TooltipValue,
    type EastChakraTooltipProps,
    EastChakraMenu,
    type MenuValue,
    type MenuItemValue,
    type EastChakraMenuProps,
    EastChakraPopover,
    type PopoverValue,
    type EastChakraPopoverProps,
    EastChakraHoverCard,
    type HoverCardValue,
    type EastChakraHoverCardProps,
    EastChakraDialog,
    type DialogValue,
    type EastChakraDialogProps,
    EastChakraDrawer,
    type DrawerValue,
    type EastChakraDrawerProps,
    EastChakraActionBar,
    type ActionBarValue,
    type ActionBarItemValue,
    type EastChakraActionBarProps,
    EastChakraToggleTip,
    type ToggleTipValue,
    type EastChakraToggleTipProps,
    // Programmatic overlay management
    OverlayManagerProvider,
    type OverlayManagerProviderProps,
    DialogOpenImpl,
    DrawerOpenImpl,
    OverlayImpl,
} from "./overlays/index.js";

// Drag & drop layer (the renderer half of the drag grammar contract)
export {
    DragLayerProvider,
    type DragLayerProviderProps,
    useDragLayer,
    useDragLayerOptional,
    useDragTarget,
    useDropCell,
    useDropSink,
    useDragSourceItem,
    useDragEventChip,
    type DragEventValue,
    type CellCoord,
    type DragKinds,
    type DragTargetConfig,
} from "./dnd/drag-layer.js";

// Hooks
export { usePersistedState, type PersistedStateResult } from "./hooks/usePersistedState.js";

// Platform (State Management)
export {
    // State implementation (for compilation)
    StateImpl,
    StateRuntime,

    // Slice implementations (auto-register on import)
    SliceImpl, buildSliceHandle, DEFAULT_SLICE_STATE,
    SliceApplyImpl,

    // Clipboard implementation (auto-registers on import)
    ClipboardImpl,

    // Download implementation (auto-registers on import)
    DownloadImpl,

    // Share implementation (auto-registers on import)
    ShareImpl,

    // Store
    UIStore,
    createUIStore,
    type UIStoreInterface,
    type UIStoreOptions,
    PersistentUIStore,
    createPersistentUIStore,

    // React Provider and Hooks
    UIStoreProvider,
    type UIStoreProviderProps,
    useUIStore,
    useUIStoreSubscription,
    useUIState,
    useUIKey,
    useUIWrite,
    useUIBatch,

    // Components
    EastComponent,
    type EastComponentProps,
    EastFunction,
    type EastFunctionProps,
    EncodedEastFunction,
    type EncodedEastFunctionProps,
} from "./platform/index.js";

// Reactive tracker registry
export {
    type ReactiveTracker,
    type ReactiveTrackerStore,
    registerReactiveTracker,
    subscribeTrackers,
    getReactiveTrackers,
    getTrackersVersion,
} from "./reactive/tracker.js";

// Platform implementation registry
export {
    registerPlatformImplementation,
    getRegisteredPlatformImplementations,
} from "./platform/registry.js";

// UI extension mechanism — register renderers for components declared via
// `EastUI.component(...)` in `@elaraai/east-ui`.
export {
    EastChakraExtension,
    implementUIComponent,
    getExtensionEntry,
    hasExtensionRenderer,
    clearExtensionRegistry,
    type EastChakraExtensionProps,
    type ExtensionRendererProps,
} from "./extension/index.js";

// Shared renderer helpers — for sibling renderer packages (e.g. e3-ui-components)
// that build their own extension components and need the same option-unwrap +
// tick-format primitives the in-package renderers use.
export { getSomeorUndefined } from "./utils.js";
export { formatTick, type TickFormatOpt } from "./typography/numeric/format-tick.js";

export { SliceRailCluster, EastChakraSliceRail } from "./slice/rail";
export { useSliceReactivity } from "./slice/use-slice-reactivity";
// Reusable, handle-free Slice predicate-editor pieces — used by the Experiment
// surface's population filter (its population is an Array<SlicePredicate>).
export { SlicePredicateBuilder, type SlicePredicateBuilderProps, type SliceFieldValue } from "./slice/predicate-builder";
export { SliceEditPopover, type SliceEditPopoverProps } from "./slice/edit";
export { formatPredicate, predicateParts, type PredicateValue } from "./slice/predicate-format";
