/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    RecursiveType,
    VariantType,
    ArrayType,
    OptionType,
    StructType,
    StringType,
    IntegerType,
    FloatType,
    BooleanType,
    NullType,
    DateTimeType,
    BlobType,
    DictType,
    FunctionType,
    LiteralValueType,
    EastTypeType,
} from "@elaraai/east";

// Typography
import { TextType } from "./typography/text/types.js";
import { CodeType } from "./typography/code/types.js";
import { HeadingType } from "./typography/heading/types.js";
import { LinkType } from "./typography/link/types.js";
import { HighlightType } from "./typography/highlight/types.js";
import { MarkType } from "./typography/mark/types.js";
import { ListVisualStyleType } from "./typography/list/types.js";
import { NumericType } from "./typography/numeric/types.js";
import { NoteVariantType, NoteVisualStyleType } from "./typography/note/types.js";
import { CodeBlockType } from "./typography/code-block/types.js";

// Layout
import { DensityType, AlignType, LabelInputType } from "./style.js";
import { BoxStyleType } from "./layout/box/types.js";
import { FlexStyleType } from "./layout/flex/types.js";
import { StackStyleType } from "./layout/stack/types.js";
import { AlignedStackStyleType } from "./layout/aligned-stack/types.js";
import { AlignedGutterType, PlotGutterType } from "./shared/plot-gutter.js";
import { SeparatorStyleType } from "./layout/separator/types.js";
import { GridStyleType } from "./layout/grid/types.js";
import { SplitterStyleType } from "./layout/splitter/types.js";
import { StickyBoundaryType, StickyStyleType } from "./layout/sticky/types.js";
import { ExpandableStyleType } from "./layout/expandable/types.js";
import {
    ScrollbarStyleType,
    ScrollAreaStyleType,
} from "./layout/scroll-area/types.js";
import {
    ChipRailSeparatorType,
    ChipRailStyleType,
} from "./display/chip-rail/types.js";

// Story (disclosure)
import {
    StoryActiveBindingType,
    StoryProgressBindingType,
    StoryStyleType,
} from "./disclosure/story/types.js";

// Buttons
import { ButtonStyleType } from "./buttons/button/types.js";
import { IconButtonType } from "./buttons/icon-button/types.js";
import { CopyButtonType } from "./buttons/copy-button/types.js";
import { CloseButtonType } from "./buttons/close-button/types.js";
import { ToggleStyleType } from "./buttons/toggle/types.js";
import { ButtonGroupStyleType } from "./buttons/button-group/types.js";

// Forms
import { StringInputType, IntegerInputType, FloatInputType, DateTimeInputType } from "./forms/input/types.js";
import { CheckboxType } from "./forms/checkbox/types.js";
import { RadioGroupType } from "./forms/radio-group/types.js";
import { RadioCardGroupType } from "./forms/radio-card-group/types.js";
import { TimeRangeInputType } from "./forms/time-range-input/types.js";
import { DateRangeInputType } from "./forms/date-range-input/types.js";
import { FieldType } from "./forms/field/types.js";
import { SwitchType } from "./forms/switch/types.js";
import { SelectRootType } from "./forms/select/types.js";
import { ComboboxRootType } from "./forms/combobox/types.js";
import { SliderType } from "./forms/slider/types.js";
import { FileUploadType } from "./forms/file-upload/types.js";
import { TextareaType } from "./forms/textarea/types.js";
import { TagsInputRootType } from "./forms/tags-input/types.js";

// Feedback
import { ProgressType } from "./feedback/progress/types.js";
import { BannerStatusType } from "./feedback/banner/status-type.js";
import { BannerStyleType } from "./feedback/banner/types.js";
import { EmptyStateStyleType } from "./feedback/empty-state/types.js";
import { SkeletonType } from "./feedback/skeleton/types.js";
import { StatusValueType, StatusStyleType } from "./feedback/status/types.js";
import { ColorSchemeType } from "./style/scheme.js";

// Navigation
import { BreadcrumbRootType } from "./navigation/breadcrumb/types.js";
import { NavListType } from "./navigation/nav-list/types.js";

// Display
import { BadgeType } from "./display/badge/types.js";
import { TagType } from "./display/tag/types.js";
import { AvatarType } from "./display/avatar/types.js";
import { MetricChipToneType, MetricChipStyleType } from "./display/metric-chip/types.js";
import { EditableChipStyleType } from "./display/editable-chip/types.js";
import { KbdType } from "./display/kbd/types.js";
import { MeterStyleType } from "./display/meter/types.js";
import { SegmentedMeterSegmentType, SegmentedMeterStyleType } from "./display/segmented-meter/types.js";
import { BarStripStyleType, BarStripSortType } from "./display/bar-strip/types.js";
import { AvatarGroupType } from "./display/avatar-group/types.js";
import { TraceType } from "./display/trace/types.js";
import { LibraryRootType } from "./collections/library/types.js";
import { RosterRootType } from "./collections/roster/types.js";
import { BoardRootType } from "./collections/board/types.js";
import { CalendarRootType } from "./collections/calendar/types.js";
import {
    SchematicItemType,
    SchematicZoneType,
    SchematicLinkType,
    SchematicNetType,
    SchematicSliceEffectType,
    SchematicLayerType,
    SchematicSelectionModeType,
    SchematicSelectionEventType,
    SchematicViewportEventType,
    SchematicZoneSelectionEventType,
    SchematicLinkModeType,
    SchematicLinkCreateEventType,
    SchematicLinkEditEventType,
    SchematicNetEndpointsType,
    SchematicItemMoveEventType,
} from "./collections/schematic/types.js";
import {
    MapLatLngType,
    MapTileType,
    MapFocusType,
    MapAreaType,
    MapHexLayerType,
    MapMarkerType,
    MapLineType,
    MapLabelType,
} from "./collections/map/types.js";
import { BlendRootType } from "./collections/blend/types.js";
import { StatusTokenType } from "./style/interaction.js";
import { CardStyleType } from "./container/card/types.js";
import { StateValueType } from "./contracts/states.js";
import { StatIndicatorType, StatStyleType } from "./display/stat/types.js";
import { TickFormatType } from "./format/types.js";
import { SliceSummaryType } from "./slice/summary/types.js";
import { SliceRangePickerType } from "./slice/range/types.js";
import { SliceFilterType } from "./slice/filter/types.js";
import { SliceLegendType } from "./slice/legend/types.js";
import { SliceBreakdownPickerType } from "./slice/breakdown/types.js";
import { SliceSearchType } from "./slice/search/types.js";
import { SliceCohortPickerType } from "./slice/cohort/types.js";
import { SliceBindType, SliceBrushStyleType, SliceChromeType, SlicePersistType } from "./platform/slice/index.js";
import { SliceAffordanceType } from "./contracts/slice-affordances.js";
import { IconType } from "./display/icon/types.js";

// Collections
import { DataListStyleType } from "./collections/data-list/types.js";
import {
    MatrixSegmentType,
    MatrixMarkerType,
    MatrixOrientationType,
    MatrixLegendEntryType,
    MatrixCellClickEventType,
    MatrixSegmentClickEventType,
    MatrixSegmentChangeEventType,
} from "./collections/matrix/types.js";
import { PaginationType } from "./collections/pagination/types.js";
import {
    TableStyleType,
    TableCellRenderContextType,
    TableColumnGroupType,
    TableSelectionType,
    TablePaginationType,
} from "./collections/table/types.js";
import {
    GanttStyleType,
    GanttAxisType,
    GanttTaskStatusType,
    GanttMilestoneKindType,
    GanttTaskClickEventType,
    GanttTaskDragEventType,
    GanttTaskDurationChangeEventType,
    GanttTaskProgressChangeEventType,
    GanttMilestoneClickEventType,
    GanttMilestoneDragEventType,
    TimeStepType,
} from "./collections/gantt/types.js";
import {
    PlannerSlotType,
    PlannerAxisType,
    PlannerStateType,
    PlannerMarkerType,
    PlannerStretchType,
    PlannerContentType,
    PlannerAnimationType,
    PlannerColumnType,
    PlannerCellType,
    PlannerVariantType,
    PlannerSelectEventType,
    PlannerApprovalType,
    PlannerApproveEventType,
} from "./collections/planner/types.js";
import {
    TableRowClickEventType,
    TableCellClickEventType,
    TableRowSelectionEventType,
    TableSortEventType,
} from "./collections/table/types.js";
// import { TreeViewStyleType } from "./collections/tree-view/types.js";

// Charts
import { SparklineType } from "./charts/sparkline/types.js";
import { ChartSpecType } from "./charts/spec/index.js";

// Disclosure
import { AccordionStyleType } from "./disclosure/accordion/types.js";
import { CarouselStyleType } from "./disclosure/carousel/types.js";
import { TabsStyleType } from "./disclosure/tabs/types.js";
import { SegmentGroupStyleType } from "./disclosure/segment-group/types.js";
import { CollapsibleStyleType } from "./disclosure/collapsible/types.js";
import { DisclosureStyleType } from "./disclosure/show-more/types.js";
import { OptionListStyleType } from "./disclosure/option-list/types.js";

// Overlays
import { TooltipStyleType } from "./overlays/tooltip/types.js";
import { MenuItemType, MenuStyleType } from "./overlays/menu/types.js";
import { TreeViewStyleType, TreeViewSelectionModeType } from "./collections/tree-view/types.js";
import { DialogStyleType } from "./overlays/dialog/types.js";
import { DrawerStyleType } from "./overlays/drawer/types.js";
import { PopoverStyleType } from "./overlays/popover/types.js";
import { HoverCardStyleType } from "./overlays/hover-card/types.js";
import { ActionBarItemType, ActionBarStyleType } from "./overlays/action-bar/types.js";
import { ToggleTipStyleType } from "./overlays/toggle-tip/types.js";
import { CommandPaletteType } from "./overlays/command-palette/types.js";
import { HotkeyType } from "./platform/hotkey/types.js";

/**
 * Recursive type representing any UI component in East UI.
 *
 * @remarks
 * This is a discriminated union of all available UI components.
 * The recursive structure allows container components (Box, Stack, Card)
 * to have children that are also UIComponentType.
 *
 * The `node` parameter in the RecursiveType callback represents
 * UIComponentType itself, enabling recursive children definitions.
 *
 * As new components are added, they should be registered here:
 * - Leaf components: just add their type directly
 * - Container components: use `ArrayType(node)` for children
 *
 * @property Text - Text component for displaying styled text (leaf)
 * @property Button - Button component for interactive actions (leaf)
 * @property Box - Box component for general-purpose layout (container with children)
 * @property Stack - Stack component for flex-based layout (container with children)
 * @property Separator - Separator component for visual dividers (leaf)
 * @property Grid - Grid component for CSS grid layouts (container with items)
 * @property Splitter - Splitter component for resizable panel layouts (container with panels)
 * @property StringInput - String input component for text entry (leaf)
 * @property IntegerInput - Integer input component for whole numbers (leaf)
 * @property FloatInput - Float input component for decimal numbers (leaf)
 * @property DateTimeInput - DateTime input component for date/time entry (leaf)
 * @property Checkbox - Checkbox component for boolean input (leaf)
 * @property Switch - Switch component for toggle input (leaf)
 * @property Select - Select component for dropdown selection (leaf)
 * @property Slider - Slider component for numeric range selection (leaf)
 * @property Field - Field component for form control wrappers (container with control)
 * @property Progress - Progress component for showing completion (leaf)
 * @property Badge - Badge component for labels and counts (leaf)
 * @property Tag - Tag component for categorization (leaf)
 * @property Avatar - Avatar component for user images (leaf)
 * @property Card - Card component for content containers (container with body)
 * @property Stat - Stat component for metric display (leaf)
 * @property DataList - DataList component for label-value pairs (leaf)
 * @property Table - Table component for data display (leaf)
 * @property TreeView - TreeView component for hierarchical data (leaf)
 * @property Accordion - Accordion component for collapsible panels (container with content children)
 * @property Sparkline - Sparkline component for compact inline charts (leaf)
 */
const UIComponentTypeImpl = RecursiveType(node => VariantType({
    // Typography
    Text: TextType,
    Code: CodeType,
    Heading: HeadingType,
    Link: LinkType,
    Highlight: HighlightType,
    Mark: MarkType,
    /**
     * List — container with rich `items`. Each item is a `UIComponentType`,
     * so the factory can hold `Text`, `HStack`, icons, or any other primitive.
     * String items are coerced to `Text.Root(s)` at the factory boundary.
     */
    List: StructType({
        items: ArrayType(node),
        style: OptionType(ListVisualStyleType),
    }),
    CodeBlock: CodeBlockType,
    Numeric: NumericType,
    /**
     * Note — narrative / callout / quote prose block. `body` is a
     * UIComponentType child (coerced from strings at the factory).
     */
    Note: StructType({
        body: node,
        variant: NoteVariantType,
        style: OptionType(NoteVisualStyleType),
    }),

    // Buttons
    /**
     * Button — content (`label`) + icon slots + state (`loading`/`disabled`)
     * + behaviour (`onClick`) on main; visual presets + colour escape hatches
     * inside `style`. `label` is a UIComponentType child (strings coerce to
     * `Text.Root` at the factory boundary).
     */
    Button: StructType({
        label: node,
        startIcon: OptionType(IconType),
        endIcon: OptionType(IconType),
        loadingText: OptionType(StringType),
        loadingIcon: OptionType(IconType),
        loading: OptionType(BooleanType),
        disabled: OptionType(BooleanType),
        onClick: OptionType(FunctionType([], NullType)),
        style: OptionType(ButtonStyleType),
    }),
    IconButton: IconButtonType,
    CopyButton: CopyButtonType,
    /** CloseButton — dismiss affordance with optional aria-label (renderer default "Close"). */
    CloseButton: CloseButtonType,
    /**
     * Toggle — two-state pressable affordance. `label` is a UIComponentType
     * child (coerced from strings at the factory boundary); `pressed` lives
     * on the main struct as primary state.
     */
    Toggle: StructType({
        label: node,
        icon: OptionType(IconType),
        pressed: BooleanType,
        disabled: OptionType(BooleanType),
        onChange: OptionType(FunctionType([BooleanType], NullType)),
        style: OptionType(ToggleStyleType),
    }),
    /**
     * ButtonGroup — visual grouping of button-like children. Chakra v3's
     * `<Group>` propagates size / variant / colorPalette via React context.
     */
    ButtonGroup: StructType({
        buttons: ArrayType(node),
        style: OptionType(ButtonGroupStyleType),
    }),

    // Layout - Containers
    Box: StructType({
        children: ArrayType(node),
        density: OptionType(DensityType),
        style: OptionType(BoxStyleType),
    }),

    Flex: StructType({
        children: ArrayType(node),
        density: OptionType(DensityType),
        style: OptionType(FlexStyleType),
    }),

    Stack: StructType({
        children: ArrayType(node),
        density: OptionType(DensityType),
        style: OptionType(StackStyleType),
    }),
    AlignedStack: StructType({
        children: ArrayType(node),
        gutter: OptionType(AlignedGutterType),
        style: OptionType(AlignedStackStyleType),
    }),

    Separator: StructType({
        /** Rich label inside the separator. String callers coerce to `Text.Root` at the factory. */
        label: OptionType(node),
        style: OptionType(SeparatorStyleType),
    }),

    Grid: StructType({
        items: ArrayType(StructType({
            content: node,
            colSpan: OptionType(StringType),
            rowSpan: OptionType(StringType),
            colStart: OptionType(StringType),
            colEnd: OptionType(StringType),
            rowStart: OptionType(StringType),
            rowEnd: OptionType(StringType),
            /** Named grid area — references a name from `templateAreas`. */
            area: OptionType(StringType),
        })),
        density: OptionType(DensityType),
        style: OptionType(GridStyleType),
    }),

    Splitter: StructType({
        panels: ArrayType(StructType({
            id: StringType,
            content: node,
            minSize: OptionType(FloatType),
            maxSize: OptionType(FloatType),
            collapsible: OptionType(BooleanType),
            defaultCollapsed: OptionType(BooleanType),
        })),
        defaultSize: ArrayType(FloatType),
        style: OptionType(SplitterStyleType),
    }),

    /**
     * Sticky — semantic wrapper over `position: sticky` with `offset` +
     * `boundary: "parent" | "viewport"`. See `layout/sticky/`.
     */
    Sticky: StructType({
        content: node,
        offset: OptionType(StringType),
        boundary: OptionType(StickyBoundaryType),
        style: OptionType(StickyStyleType),
    }),

    /**
     * ScrollArea — cross-browser consistent scrollbar styling via Radix.
     * See `layout/scroll-area/`.
     */
    ScrollArea: StructType({
        content: node,
        scrollbarStyle: OptionType(ScrollbarStyleType),
        style: OptionType(ScrollAreaStyleType),
    }),

    /**
     * Expandable — region that expands in place (CSS takeover, no portal)
     * to fill the app container and collapses back into the layout.
     * Distinct from Collapsible (in-flow show/hide) and Dialog/Drawer
     * (portalled overlays). See `layout/expandable/`.
     */
    Expandable: StructType({
        content: node,
        expanded: OptionType(BooleanType),
        onExpandedChange: OptionType(FunctionType([BooleanType], NullType)),
        label: OptionType(StringType),
        style: OptionType(ExpandableStyleType),
    }),

    /**
     * ChipRail — horizontal chip row with density + separator + overflow
     * control. Shared primitive under `MetricRail`, `AssumptionsBar`,
     * `FilterBar`, `LegendRail`. See `display/chip-rail/`.
     */
    ChipRail: StructType({
        chips: ArrayType(node),
        labels: OptionType(ArrayType(StringType)),
        density: OptionType(DensityType),
        separator: OptionType(ChipRailSeparatorType),
        style: OptionType(ChipRailStyleType),
    }),


    // Forms
    StringInput: StringInputType,
    IntegerInput: IntegerInputType,
    FloatInput: FloatInputType,
    DateTimeInput: DateTimeInputType,
    Checkbox: CheckboxType,
    RadioGroup: RadioGroupType,
    RadioCardGroup: RadioCardGroupType,
    TimeRangeInput: TimeRangeInputType,
    DateRangeInput: DateRangeInputType,
    Switch: SwitchType,
    Select: SelectRootType,
    Combobox: ComboboxRootType,
    Slider: SliderType,
    FileUpload: FileUploadType,
    Field: FieldType,
    Textarea: TextareaType,
    TagsInput: TagsInputRootType,

    // Feedback
    Progress: ProgressType,

    /**
     * Banner — full-width page-level feedback surface with paired icon.
     * Covers all in-flow status callouts; replaces the deleted Alert + Toast
     * primitives (bsys spec collapses them into one).
     */
    Banner: StructType({
        status: BannerStatusType,
        title: node,
        description: OptionType(node),
        actions: OptionType(node),
        icon: OptionType(IconType),
        dismissible: OptionType(BooleanType),
        showIcon: OptionType(BooleanType),
        onDismiss: OptionType(FunctionType([], NullType)),
        style: OptionType(BannerStyleType),
    }),

    Skeleton: SkeletonType,

    /**
     * Status — semantic classification chip with paired icon.
     */
    Status: StructType({
        value: StatusValueType,
        label: node,
        icon: OptionType(IconType),
        pulsing: OptionType(BooleanType),
        showIcon: OptionType(BooleanType),
        style: OptionType(StatusStyleType),
    }),

    /**
     * EmptyState — placeholder UI for zero-state sections.
     */
    EmptyState: StructType({
        icon: OptionType(IconType),
        glyph: OptionType(StringType),
        title: node,
        description: OptionType(node),
        actions: OptionType(node),
        style: OptionType(EmptyStateStyleType),
    }),

    // Navigation
    Breadcrumb: BreadcrumbRootType,
    NavList: NavListType,
    /**
     * Pages — first-class navigation content-switcher. `render` is a nullary
     * function yielding the active page, built by the `Pages.Root` factory as a
     * match over the route stack (so only the active arm runs — visible-only — and
     * every page body sits in the IR for the manifest union). The renderer
     * evaluates it leaf-only and remounts on a route change; `navKey` is the
     * path's State key it subscribes to.
     */
    Pages: StructType({
        render: FunctionType([], node),
        navKey: StringType,
    }),

    // Display
    Badge: BadgeType,
    Tag: TagType,
    Avatar: AvatarType,
    Stat: StructType({
        label: StringType,
        value: LiteralValueType,
        format: OptionType(TickFormatType),
        helpText: OptionType(StringType),
        baseline: OptionType(node),
        delta: OptionType(node),
        info: OptionType(node),
        indicator: OptionType(StatIndicatorType),
        density: OptionType(DensityType),
        style: OptionType(StatStyleType),
    }),
    Icon: IconType,
    MetricChip: StructType({
        value: node,
        unit: OptionType(StringType),
        icon: OptionType(IconType),
        tone: MetricChipToneType,
        density: OptionType(DensityType),
        style: OptionType(MetricChipStyleType),
    }),
    EditableChip: StructType({
        label: node,
        trigger: OptionType(IconType),
        disabled: OptionType(BooleanType),
        onClick: OptionType(FunctionType([], NullType)),
        density: OptionType(DensityType),
        style: OptionType(EditableChipStyleType),
    }),
    Kbd: KbdType,
    Meter: StructType({
        value: FloatType,
        max: OptionType(FloatType),
        label: OptionType(node),
        tone: OptionType(StatusTokenType),
        density: OptionType(DensityType),
        style: OptionType(MeterStyleType),
    }),
    SegmentedMeter: StructType({
        segments: ArrayType(SegmentedMeterSegmentType),
        caption: OptionType(node),
        max: OptionType(FloatType),
        density: OptionType(DensityType),
        style: OptionType(SegmentedMeterStyleType),
    }),
    BarStrip: StructType({
        items: ArrayType(StructType({
            label: node,
            value: FloatType,
            tone: OptionType(StatusTokenType),
            color: OptionType(StringType),
            trailing: OptionType(node),
        })),
        showValues: OptionType(BooleanType),
        sort: OptionType(BarStripSortType),
        maxItems: OptionType(IntegerType),
        density: OptionType(DensityType),
        style: OptionType(BarStripStyleType),
    }),
    AvatarGroup: AvatarGroupType,
    Trace: TraceType,

    // Library — draggable palette (drag & drop source role)
    Library: LibraryRootType,

    // Slice — typed-narrowing UI family (bound to the Slice platform)
    SliceSummary: SliceSummaryType,
    SliceRange: SliceRangePickerType,
    SliceFilter: SliceFilterType,
    SliceLegend: SliceLegendType,
    SliceBreakdown: SliceBreakdownPickerType,
    SliceSearch: SliceSearchType,
    SliceCohort: SliceCohortPickerType,

    /**
     * SliceRail — the slice affordance cluster as a standalone strip: one row
     * that never wraps, compressing along the chip ladder, with the sectioned
     * `Slice.Edit` popover as its only expansion. `persist` opts the slice's
     * state into localStorage / sessionStorage / URL persistence (#168).
     */
    SliceRail: StructType({
        slice: SliceBindType,
        affordances: ArrayType(SliceAffordanceType),
        persist: OptionType(SlicePersistType),
        brush: OptionType(SliceBrushStyleType),
    }),

    // Container
    Card: StructType({
        header: OptionType(node),
        body: ArrayType(node),
        footer: OptionType(node),
        state: OptionType(StateValueType),
        density: OptionType(DensityType),
        style: OptionType(CardStyleType),
    }),
    DataList: StructType({
        items: ArrayType(StructType({
            label: StringType,
            value: node,
        })),
        style: OptionType(DataListStyleType),
    }),
    Pagination: PaginationType,

    Matrix: StructType({
        rows: ArrayType(StructType({
            key: StringType,
            value: StringType,
            sublabel: OptionType(StringType),
            group: OptionType(StringType),
            cells: DictType(StringType, StructType({
                segments: ArrayType(MatrixSegmentType),
                markers: ArrayType(MatrixMarkerType),
                orientation: OptionType(MatrixOrientationType),
                slot: OptionType(node),
                popover: OptionType(node),
            })),
        })),
        columns: ArrayType(StructType({
            key: StringType,
            label: OptionType(LabelInputType),
        })),
        rowHeader: OptionType(StringType),
        orientation: MatrixOrientationType,
        legend: OptionType(ArrayType(MatrixLegendEntryType)),
        minLabelSize: OptionType(FloatType),
        density: OptionType(DensityType),
        plotGutter: OptionType(PlotGutterType),
        onCellClick: OptionType(FunctionType([MatrixCellClickEventType], NullType)),
        onSegmentClick: OptionType(FunctionType([MatrixSegmentClickEventType], NullType)),
        onSegmentChange: OptionType(FunctionType([MatrixSegmentChangeEventType], NullType)),
    }),

    // Charts
    Sparkline: SparklineType,
    /** visx-primitive chart tree (recursive ChartSpec). Backs `Chart.*` and `Slice.Chart.*`. */
    VisxChart: ChartSpecType,

    TreeView: StructType({
        nodes: ArrayType(RecursiveType(inner => VariantType({
            Item: StructType({
                value: StringType,
                label: StringType,
                indicator: OptionType(IconType),
            }),
            Branch: StructType({
                value: StringType,
                label: StringType,
                indicator: OptionType(IconType),
                children: ArrayType(inner),
                disabled: OptionType(BooleanType),
            }),
        }))),
        label: OptionType(StringType),
        defaultExpandedValue: OptionType(ArrayType(StringType)),
        defaultSelectedValue: OptionType(ArrayType(StringType)),
        selectionMode: OptionType(TreeViewSelectionModeType),
        animateContent: OptionType(BooleanType),
        onExpandedChange: OptionType(FunctionType([ArrayType(StringType)], NullType)),
        onSelectionChange: OptionType(FunctionType([ArrayType(StringType)], NullType)),
        onFocusChange: OptionType(FunctionType([OptionType(StringType)], NullType)),
        style: OptionType(TreeViewStyleType),
    }),

    Table: StructType({
        rows: ArrayType(DictType(StringType, LiteralValueType)),
        columns: ArrayType(StructType({
            key: StringType,
            dataType: EastTypeType,
            valueType: EastTypeType,
            header: OptionType(StringType),
            width: OptionType(StringType),
            minWidth: OptionType(StringType),
            maxWidth: OptionType(StringType),
            render: FunctionType([TableCellRenderContextType], node),
        })),
        frozen: ArrayType(StringType),
        columnGroups: OptionType(ArrayType(TableColumnGroupType)),
        footer: OptionType(DictType(StringType, StructType({
            content: node,
            colSpan: OptionType(IntegerType),
            rowSpan: OptionType(IntegerType),
        }))),
        footerRows: OptionType(ArrayType(DictType(StringType, StructType({
            content: node,
            colSpan: OptionType(IntegerType),
            rowSpan: OptionType(IntegerType),
        })))),
        expandedContent: OptionType(FunctionType([IntegerType], node)),
        interactive: OptionType(BooleanType),
        columnResize: OptionType(BooleanType),
        virtualization: OptionType(BooleanType),
        density: OptionType(DensityType),
        rowStatus: OptionType(FunctionType([IntegerType], StatusTokenType)),
        pagination: OptionType(TablePaginationType),
        selection: OptionType(TableSelectionType),
        onCellClick: OptionType(FunctionType([TableCellClickEventType], NullType)),
        onCellDoubleClick: OptionType(FunctionType([TableCellClickEventType], NullType)),
        onRowClick: OptionType(FunctionType([TableRowClickEventType], NullType)),
        onRowDoubleClick: OptionType(FunctionType([TableRowClickEventType], NullType)),
        onRowSelectionChange: OptionType(FunctionType([TableRowSelectionEventType], NullType)),
        onSortChange: OptionType(FunctionType([TableSortEventType], NullType)),
        slice: OptionType(SliceChromeType),
        style: OptionType(TableStyleType),
    }),

    Gantt: StructType({
        rows: ArrayType(StructType({
            cells: DictType(StringType, LiteralValueType),
            tasks: ArrayType(StructType({
                start: DateTimeType,
                end: DateTimeType,
                label: OptionType(LabelInputType),
                progress: OptionType(FloatType),
                status: OptionType(GanttTaskStatusType),
                popover: OptionType(node),
            })),
            milestones: ArrayType(StructType({
                date: DateTimeType,
                label: OptionType(LabelInputType),
                kind: OptionType(GanttMilestoneKindType),
                popover: OptionType(node),
            })),
        })),
        columns: ArrayType(StructType({
            key: StringType,
            dataType: EastTypeType,
            valueType: EastTypeType,
            header: OptionType(StringType),
            width: OptionType(StringType),
            minWidth: OptionType(StringType),
            maxWidth: OptionType(StringType),
            render: FunctionType([TableCellRenderContextType], node),
        })),
        frozen: ArrayType(StringType),
        axis: OptionType(GanttAxisType),
        dragStep: OptionType(TimeStepType),
        durationStep: OptionType(TimeStepType),
        rowStatus: OptionType(FunctionType([IntegerType], StatusTokenType)),
        onCellClick: OptionType(FunctionType([TableCellClickEventType], NullType)),
        onCellDoubleClick: OptionType(FunctionType([TableCellClickEventType], NullType)),
        onRowClick: OptionType(FunctionType([TableRowClickEventType], NullType)),
        onRowDoubleClick: OptionType(FunctionType([TableRowClickEventType], NullType)),
        onSortChange: OptionType(FunctionType([TableSortEventType], NullType)),
        onTaskClick: OptionType(FunctionType([GanttTaskClickEventType], NullType)),
        onTaskDoubleClick: OptionType(FunctionType([GanttTaskClickEventType], NullType)),
        onTaskDrag: OptionType(FunctionType([GanttTaskDragEventType], NullType)),
        onTaskDurationChange: OptionType(FunctionType([GanttTaskDurationChangeEventType], NullType)),
        onTaskProgressChange: OptionType(FunctionType([GanttTaskProgressChangeEventType], NullType)),
        onMilestoneClick: OptionType(FunctionType([GanttMilestoneClickEventType], NullType)),
        onMilestoneDoubleClick: OptionType(FunctionType([GanttMilestoneClickEventType], NullType)),
        onMilestoneDrag: OptionType(FunctionType([GanttMilestoneDragEventType], NullType)),
        slice: OptionType(SliceChromeType),
        style: OptionType(GanttStyleType),
    }),

    Planner: StructType({
        variant: PlannerVariantType,
        axis: PlannerAxisType,
        columns: ArrayType(PlannerColumnType),
        rows: ArrayType(StructType({
            group: OptionType(StringType),
            cells: DictType(StringType, PlannerCellType),
            // Mirror `PlannerEventType` in `collections/planner/index.ts` — `popover`
            // / `hovercard` are spelled with the recursion `node` here (the resolved
            // `UIComponentType` there).
            events: ArrayType(StructType({
                key: OptionType(StringType),
                slot: PlannerSlotType,
                endSlot: OptionType(PlannerSlotType),
                bucket: OptionType(StringType),
                label: StringType,
                state: PlannerStateType,
                popover: OptionType(node),
                stretch: OptionType(PlannerStretchType),
                content: OptionType(PlannerContentType),
                tone: OptionType(StatusValueType),
                color: OptionType(StringType),
                colorPalette: OptionType(ColorSchemeType),
                animation: OptionType(PlannerAnimationType),
                hovercard: OptionType(node),
            })),
            markers: ArrayType(PlannerMarkerType),
            status: OptionType(StatusValueType),
            approval: OptionType(PlannerApprovalType),
        })),
        now: OptionType(PlannerSlotType),
        density: OptionType(DensityType),
        slotMinWidth: OptionType(StringType),
        plotGutter: OptionType(PlotGutterType),
        onSelectRow: OptionType(FunctionType([PlannerSelectEventType], NullType)),
        // Optional review chrome — the per-row decision column + batch foot.
        // Mirror this shape with `PlannerReviewType` in
        // `collections/planner/index.ts` (which spells `summary` with the
        // resolved `UIComponentType` rather than the recursion `node`).
        review: OptionType(StructType({
            columnLabel: StringType,
            summary: OptionType(node),
            onApprove: OptionType(FunctionType([PlannerApproveEventType], NullType)),
            onReject: OptionType(FunctionType([PlannerApproveEventType], NullType)),
            onApproveAll: OptionType(FunctionType([], NullType)),
            onRejectAll: OptionType(FunctionType([], NullType)),
            onRerun: OptionType(FunctionType([], NullType)),
            rerunLabel: StringType,
        })),
        rowHover: OptionType(BooleanType),
    }),

    // Roster — people × days-of-week shift grid (drag & drop target role)
    Roster: RosterRootType,

    // Board — single-day areas × shifts assignment board (drag & drop target role)
    Board: BoardRootType,

    // Calendar — day-of-week × week intensity grid (visualisation only)
    Calendar: CalendarRootType,

    // Schematic — 2D world-coordinate canvas. The `itemHover` / `zoneHover` /
    // `linkHover` builders return arbitrary UI via the recursion `node`; mirror
    // this shape with `SchematicRootType` in `collections/schematic/index.ts`
    // (which spells those fields with the resolved `UIComponentType`).
    Schematic: StructType({
        extent: StructType({ width: FloatType, height: FloatType }),
        items: ArrayType(SchematicItemType),
        zones: ArrayType(SchematicZoneType),
        links: ArrayType(SchematicLinkType),
        nets: ArrayType(SchematicNetType),
        scaleUnit: OptionType(StringType),
        grid: OptionType(BooleanType),
        navigator: OptionType(BooleanType),
        minimap: OptionType(BooleanType),
        slice: OptionType(SliceChromeType),
        sliceEffect: OptionType(SchematicSliceEffectType),
        layers: OptionType(ArrayType(SchematicLayerType)),
        height: OptionType(StringType),
        onSelect: OptionType(FunctionType([StringType], NullType)),
        selectionMode: OptionType(SchematicSelectionModeType),
        onSelectionChange: OptionType(FunctionType([SchematicSelectionEventType], NullType)),
        sliceSelectField: OptionType(StringType),
        selectZoomFocus: OptionType(BooleanType),
        onViewportChange: OptionType(FunctionType([SchematicViewportEventType], NullType)),
        onItemOpen: OptionType(FunctionType([StringType], NullType)),
        onSelectZone: OptionType(FunctionType([StringType], NullType)),
        onZoneSelectionChange: OptionType(FunctionType([SchematicZoneSelectionEventType], NullType)),
        linkMode: OptionType(SchematicLinkModeType),
        onCreateLink: OptionType(FunctionType([SchematicLinkCreateEventType], NullType)),
        onSelectLink: OptionType(FunctionType([StringType], NullType)),
        onEditLink: OptionType(FunctionType([SchematicLinkEditEventType], NullType)),
        onDeleteLink: OptionType(FunctionType([StringType], NullType)),
        readOnly: OptionType(BooleanType),
        readOnlyLinks: OptionType(BooleanType),
        readOnlyItems: OptionType(BooleanType),
        onMoveItem: OptionType(FunctionType([SchematicItemMoveEventType], NullType)),
        itemHover: OptionType(FunctionType([StringType], node)),
        zoneHover: OptionType(FunctionType([StringType], node)),
        linkHover: OptionType(FunctionType([StringType], node)),
        onEditNet: OptionType(FunctionType([SchematicNetEndpointsType], NullType)),
        canConnect: OptionType(FunctionType([StringType, StringType], BooleanType)),
    }),

    // Map — interactive geographic basemap + H3 / area overlay. The
    // `overlays` slot hosts arbitrary UIComponent children via the
    // recursion `node`; mirror this shape with `MapRootType` in
    // `collections/map/index.ts` (which spells the same fields with the
    // resolved `UIComponentType`).
    Map: StructType({
        tiles: MapTileType,
        center: MapLatLngType,
        zoom: IntegerType,
        minZoom: OptionType(IntegerType),
        maxZoom: OptionType(IntegerType),
        lodZoom: OptionType(IntegerType),
        fitBounds: OptionType(MapFocusType),
        areas: ArrayType(MapAreaType),
        hexes: OptionType(MapHexLayerType),
        markers: ArrayType(MapMarkerType),
        lines: ArrayType(MapLineType),
        labels: ArrayType(MapLabelType),
        overlays: ArrayType(StructType({
            content: node,
            align: AlignType,
            verticalAlign: AlignType,
            key: OptionType(StringType),
            geoAnchor: OptionType(MapLatLngType),
            offset: OptionType(StructType({ x: FloatType, y: FloatType })),
            interactive: OptionType(BooleanType),
        })),
        scrollWheelZoom: OptionType(BooleanType),
        attributionPrefix: OptionType(BooleanType),
        height: OptionType(StringType),
        onAreaClick: OptionType(FunctionType([StringType], NullType)),
        onMarkerClick: OptionType(FunctionType([StringType], NullType)),
        onZoom: OptionType(FunctionType([IntegerType], NullType)),
        onSelect: OptionType(FunctionType([StringType], NullType)),
    }),

    // Blend — assembly surface for blending / batching decisions
    Blend: BlendRootType,

    // Disclosure
    /**
     * Accordion — collapsible content panels. `trigger` on each item is a
     * UIComponentType (strings coerce to `Text.Root` at the factory).
     * Config (`multiple` / `collapsible`), state (`value` / `defaultValue`)
     * and behaviour (`onValueChange`) live on main; visual presets + colour
     * slots live inside `style`.
     */
    Accordion: StructType({
        items: ArrayType(StructType({
            value: StringType,
            title: StringType,
            meta: OptionType(StringType),
            content: ArrayType(node),
            disabled: OptionType(BooleanType),
        })),
        multiple: OptionType(BooleanType),
        collapsible: OptionType(BooleanType),
        value: OptionType(ArrayType(StringType)),
        defaultValue: OptionType(ArrayType(StringType)),
        onValueChange: OptionType(FunctionType([ArrayType(StringType)], NullType)),
        style: OptionType(AccordionStyleType),
    }),

    /**
     * Carousel — slideshow of UIComp slides. State (`index` / `defaultIndex`),
     * config (`loop` / `autoplay` / `slidesPerView` / `slidesPerMove` /
     * `allowMouseDrag` / `showIndicators` / `showControls` / `spacing` /
     * `padding`), and behaviour (`onIndexChange`) live on main; visual
     * presets (`orientation`) + colour slots live inside `style`.
     */
    Carousel: StructType({
        items: ArrayType(node),
        index: OptionType(IntegerType),
        defaultIndex: OptionType(IntegerType),
        slidesPerView: OptionType(IntegerType),
        slidesPerMove: OptionType(IntegerType),
        loop: OptionType(BooleanType),
        autoplay: OptionType(BooleanType),
        allowMouseDrag: OptionType(BooleanType),
        showIndicators: OptionType(BooleanType),
        showControls: OptionType(BooleanType),
        spacing: OptionType(StringType),
        onIndexChange: OptionType(FunctionType([IntegerType], NullType)),
        style: OptionType(CarouselStyleType),
    }),

    /**
     * Tabs — tabbed content panels. `trigger` on each item is a
     * UIComponentType (strings coerce to `Text.Root` at the factory).
     * State (`value` / `defaultValue`) + behaviour (`onValueChange`) live
     * on main; visual presets + colour slots live inside `style`.
     */
    Tabs: StructType({
        items: ArrayType(StructType({
            value: StringType,
            trigger: node,
            content: ArrayType(node),
            disabled: OptionType(BooleanType),
        })),
        value: OptionType(StringType),
        defaultValue: OptionType(StringType),
        onValueChange: OptionType(FunctionType([StringType], NullType)),
        style: OptionType(TabsStyleType),
    }),

    /**
     * Story — scroll-driven narrative: prose steps in a rail beside one
     * persistent sticky stage that evolves through keyframes
     * (design/story.html §2.7 Narrate). `steps` are `StoryStep` children
     * (soft contract — the renderer skips non-step children with a dev
     * warning). State (`active` / `progress` bindings, `activeStep`
     * override) + behaviour (`onStepEnter` / `onStepExit`) live on main;
     * layout presets live inside `style`. `title` opts into the sticky
     * one-row Story.Progress chrome.
     */
    Story: StructType({
        steps: ArrayType(node),
        active: OptionType(StoryActiveBindingType),
        progress: OptionType(StoryProgressBindingType),
        activeStep: OptionType(StringType),
        title: OptionType(StringType),
        onStepEnter: OptionType(FunctionType([StringType], NullType)),
        onStepExit: OptionType(FunctionType([StringType], NullType)),
        style: OptionType(StoryStyleType),
    }),

    /**
     * StoryStep — one narrative beat: spine node · eyebrow · title · body
     * (the children, filling the step's scroll runway) and an optional
     * `stage` keyframe shown in the sticky slot while active. A real
     * component so conditional steps (`cond.ifElse(stepA, stepB)`) are
     * legal; rendered standalone it degrades to a plain rail block.
     */
    StoryStep: StructType({
        id: StringType,
        eyebrow: OptionType(StringType),
        title: OptionType(StringType),
        stage: OptionType(node),
        body: ArrayType(node),
    }),

    /**
     * StoryProgress — the one-row chrome strip (eyebrow title · per-step
     * dots · counter · prev/next). Mounts standalone anywhere because it
     * only talks to the `active` binding; dots and prev/next write it and
     * the Story's rail treats the write as navigation.
     */
    StoryProgress: StructType({
        count: IntegerType,
        active: OptionType(StoryActiveBindingType),
        title: OptionType(StringType),
    }),

    /**
     * SegmentGroup — two-or-more-state toolbar toggle. `label` on each item
     * is a UIComponentType (strings coerce to `Text.Root` at the factory).
     * State (`value`) + behaviour (`onChange`) live on main; visual presets
     * + colour slots live inside `style`.
     */
    SegmentGroup: StructType({
        value: StringType,
        items: ArrayType(StructType({
            value: StringType,
            label: node,
            disabled: OptionType(BooleanType),
        })),
        onChange: OptionType(FunctionType([StringType], NullType)),
        style: OptionType(SegmentGroupStyleType),
    }),

    /**
     * Collapsible — single open/close region with a rich trigger and
     * arbitrary UIComp content. Distinct from Accordion (multiple sections)
     * and Disclosure (text truncation).
     */
    Collapsible: StructType({
        trigger: node,
        content: node,
        defaultOpen: OptionType(BooleanType),
        onOpenChange: OptionType(FunctionType([BooleanType], NullType)),
        style: OptionType(CollapsibleStyleType),
    }),

    /**
     * Disclosure — text-truncation "show more / show less" primitive.
     * Distinct from Collapsible (open/close arbitrary region).
     */
    Disclosure: StructType({
        text: node,
        lines: OptionType(IntegerType),
        moreLabel: OptionType(StringType),
        lessLabel: OptionType(StringType),
        style: OptionType(DisclosureStyleType),
    }),

    /**
     * OptionList — keyboard-navigable list of selectable options.
     */
    OptionList: StructType({
        options: ArrayType(StructType({
            id: StringType,
            label: node,
            description: OptionType(node),
            trailing: OptionType(node),
            disabled: OptionType(BooleanType),
        })),
        selectedId: OptionType(StringType),
        onSelect: OptionType(FunctionType([StringType], NullType)),
        style: OptionType(OptionListStyleType),
    }),

    // Overlays
    Tooltip: StructType({
        trigger: node,
        content: StringType,
        style: OptionType(TooltipStyleType),
    }),

    Menu: StructType({
        trigger: node,
        items: ArrayType(MenuItemType),
        style: OptionType(MenuStyleType),
    }),

    Dialog: StructType({
        trigger: node,
        body: ArrayType(node),
        eyebrow: OptionType(StringType),
        title: OptionType(StringType),
        description: OptionType(StringType),
        style: OptionType(DialogStyleType),
    }),

    Drawer: StructType({
        trigger: node,
        body: ArrayType(node),
        eyebrow: OptionType(StringType),
        title: OptionType(StringType),
        description: OptionType(StringType),
        style: OptionType(DrawerStyleType),
    }),

    Popover: StructType({
        trigger: node,
        body: ArrayType(node),
        title: OptionType(StringType),
        description: OptionType(StringType),
        style: OptionType(PopoverStyleType),
    }),

    HoverCard: StructType({
        trigger: node,
        body: ArrayType(node),
        title: OptionType(StringType),
        description: OptionType(StringType),
        style: OptionType(HoverCardStyleType),
    }),

    ActionBar: StructType({
        items: ArrayType(ActionBarItemType),
        selectionCount: OptionType(IntegerType),
        selectionLabel: OptionType(StringType),
        style: OptionType(ActionBarStyleType),
    }),

    ToggleTip: StructType({
        trigger: node,
        content: StringType,
        style: OptionType(ToggleTipStyleType),
    }),

    CommandPalette: CommandPaletteType,
    Hotkey: HotkeyType,

    // Reactive - for selective re-rendering
    ReactiveComponent: StructType({
        /** The render function to execute - returns UIComponentType */
        render: FunctionType([], node),
    }),

    /**
     * Extensible UI component slot — the analog of a platform function for the
     * UI layer. Downstream packages declare typed components via
     * {@link EastUI.component} and wire renderers via {@link implementUIComponent}
     * (in `@elaraai/east-ui-components`); the renderer dispatcher resolves
     * `kind` against the registry.
     *
     * @property kind - Component identifier ("Diff", future "AuditLog", etc.).
     * @property payload - Beast2-encoded value of the component's declared schema.
     */
    Extension: StructType({
        kind: StringType,
        payload: BlobType,
    }),
}));

type UIComponentNodeImpl =
    typeof UIComponentTypeImpl extends RecursiveType<infer Node> ? Node : never;

/**
 * The recursion node of {@link UIComponentType}, as a named interface.
 *
 * The variant type inferred from the `RecursiveType(...)` literal is an
 * anonymous structural type thousands of lines long. Type aliases lose their
 * name through generic inference, so any downstream `export const x = ui(...)`
 * compiled with declaration emit would force TypeScript to serialize the whole
 * structure inline and fail with TS7056. An interface is a symbol, so the
 * declaration emitter always references it by name instead.
 *
 * The interface wraps the node (`VariantType<...>`) rather than its cases
 * record: interfaces have no implicit index signature, so a cases interface
 * would fail `VariantType`'s `{ [K in string]: any }` constraint. The node's
 * `cases` property remains the anonymous literal type, which satisfies it.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface UIComponentNode extends UIComponentNodeImpl {}

export const UIComponentType: RecursiveType<UIComponentNode> = UIComponentTypeImpl;

/**
 * Type alias for UIComponentType.
 */
export type UIComponentType = typeof UIComponentType;

// ============================================================================
// Shared positioned-content primitives (UIComp-coupled)
// ============================================================================

/**
 * Shared overlay input — a UIComponent positioned inside a container
 * via the same axis-based `align` / `verticalAlign` pair used for
 * segment labels.
 *
 * @remarks
 * Used by Matrix cell overlays, Planner event overlays, and Gantt
 * task / milestone overlays. The renderer paints each overlay as an
 * absolutely-positioned flex container filling the parent box, with
 * `align` / `verticalAlign` mapped to `justify-content` /
 * `align-items` (start → flex-start, end → flex-end). Multiple
 * overlays stack as siblings and don't interfere because each gets
 * its own flex container.
 *
 * @property content - The UIComponent rendered inside the overlay.
 * @property align - Horizontal alignment within the parent box.
 * @property verticalAlign - Vertical alignment within the parent box.
 */
export const OverlayInputType = StructType({
    content: UIComponentType,
    align: AlignType,
    verticalAlign: AlignType,
});

export type OverlayInputType = typeof OverlayInputType;
