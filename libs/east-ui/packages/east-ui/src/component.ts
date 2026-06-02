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
import { SeparatorStyleType } from "./layout/separator/types.js";
import { GridStyleType } from "./layout/grid/types.js";
import { SplitterStyleType } from "./layout/splitter/types.js";
import { StickyBoundaryType, StickyStyleType } from "./layout/sticky/types.js";
import {
    ScrollbarStyleType,
    ScrollAreaStyleType,
} from "./layout/scroll-area/types.js";
import {
    ChipRailSeparatorType,
    ChipRailStyleType,
} from "./layout/chip-rail/types.js";

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
import { TimeScaleControlType } from "./forms/time-scale-control/types.js";
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
import { StatusTokenType } from "./style/interaction.js";
import { CardStyleType } from "./container/card/types.js";
import { StateValueType } from "./contracts/states.js";
import { StatIndicatorType, StatStyleType } from "./display/stat/types.js";
import { TickFormatType } from "./format/types.js";
import { SliceSummaryType } from "./slice/summary/types.js";
import { SliceRangePickerType } from "./slice/range/types.js";
import { SliceFilterType } from "./slice/filter/types.js";
import { SliceLegendType } from "./slice/legend/types.js";
import { SliceChartType } from "./slice/chart/types.js";
import { SliceBreakdownPickerType } from "./slice/breakdown/types.js";
import { SliceSearchType } from "./slice/search/types.js";
import { SliceCohortPickerType } from "./slice/cohort/types.js";
import { SliceBindType } from "./platform/slice/index.js";
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
import { PaginationType } from "./collections/pagination/index.js";
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
    PlannerColumnType,
    PlannerCellType,
    PlannerVariantType,
    PlannerSelectEventType,
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
import { HotkeyType } from "./platform/hotkey/index.js";

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
export const UIComponentType = RecursiveType(node => VariantType({
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
        style: OptionType(BoxStyleType),
    }),

    Flex: StructType({
        children: ArrayType(node),
        style: OptionType(FlexStyleType),
    }),

    Stack: StructType({
        children: ArrayType(node),
        style: OptionType(StackStyleType),
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
     * ChipRail — horizontal chip row with density + separator + overflow
     * control. Shared primitive under `MetricRail`, `AssumptionsBar`,
     * `FilterBar`, `LegendRail`. See `layout/chip-rail/`.
     */
    ChipRail: StructType({
        chips: ArrayType(node),
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
    TimeScaleControl: TimeScaleControlType,
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
        style: OptionType(StatStyleType),
    }),
    Icon: IconType,
    MetricChip: StructType({
        value: node,
        unit: OptionType(StringType),
        icon: OptionType(IconType),
        tone: MetricChipToneType,
        style: OptionType(MetricChipStyleType),
    }),
    EditableChip: StructType({
        label: node,
        trigger: OptionType(IconType),
        disabled: OptionType(BooleanType),
        onClick: OptionType(FunctionType([], NullType)),
        style: OptionType(EditableChipStyleType),
    }),
    Kbd: KbdType,
    Meter: StructType({
        value: FloatType,
        max: OptionType(FloatType),
        label: OptionType(node),
        tone: OptionType(StatusTokenType),
        style: OptionType(MeterStyleType),
    }),
    SegmentedMeter: StructType({
        segments: ArrayType(SegmentedMeterSegmentType),
        caption: OptionType(node),
        max: OptionType(FloatType),
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
        style: OptionType(BarStripStyleType),
    }),
    AvatarGroup: AvatarGroupType,

    // Slice — typed-narrowing UI family (bound to the Slice platform)
    SliceSummary: SliceSummaryType,
    SliceRange: SliceRangePickerType,
    SliceFilter: SliceFilterType,
    SliceLegend: SliceLegendType,
    SliceChart: SliceChartType,
    SliceBreakdown: SliceBreakdownPickerType,
    SliceSearch: SliceSearchType,
    SliceCohort: SliceCohortPickerType,
    /**
     * SliceFrame — the container that houses a slice consumer. Three zones:
     * a one-row eyebrow (compact affordances left, `meta` right), an unpadded
     * `body` (the consumer visual — Table / Chart / Stat / anything), and a
     * `footer` (`derived` count by default, a `custom` node, or `hidden`). The
     * author lists which affordances the eyebrow mounts via `affordances`; the
     * renderer places each by kind (`filter`/`breakdown`/`cohort` left,
     * `search`/`range` right) in the given order. An empty `affordances` array
     * renders no eyebrow (the Embed case).
     */
    SliceFrame: StructType({
        slice: SliceBindType,
        body: node,
        affordances: ArrayType(SliceAffordanceType),
        meta: OptionType(node),
        footer: VariantType({ derived: NullType, hidden: NullType, custom: node }),
        collapsible: BooleanType,
        defaultCollapsed: BooleanType,
    }),

    // Container
    Card: StructType({
        header: OptionType(node),
        body: ArrayType(node),
        footer: OptionType(node),
        state: OptionType(StateValueType),
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
        rows: ArrayType(DictType(StringType, StructType({
            value: LiteralValueType,
            content: OptionType(node),
        }))),
        columns: ArrayType(StructType({
            key: StringType,
            dataType: EastTypeType,
            valueType: EastTypeType,
            header: OptionType(StringType),
            width: OptionType(StringType),
            minWidth: OptionType(StringType),
            maxWidth: OptionType(StringType),
            render: OptionType(FunctionType([TableCellRenderContextType], node)),
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
        style: OptionType(TableStyleType),
    }),

    Gantt: StructType({
        rows: ArrayType(StructType({
            cells: DictType(StringType, StructType({
                value: LiteralValueType,
                content: OptionType(node),
            })),
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
            render: OptionType(FunctionType([TableCellRenderContextType], node)),
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
        style: OptionType(GanttStyleType),
    }),

    Planner: StructType({
        variant: PlannerVariantType,
        axis: PlannerAxisType,
        columns: ArrayType(PlannerColumnType),
        rows: ArrayType(StructType({
            group: OptionType(StringType),
            cells: DictType(StringType, PlannerCellType),
            events: ArrayType(StructType({
                slot: PlannerSlotType,
                endSlot: OptionType(PlannerSlotType),
                bucket: OptionType(StringType),
                label: StringType,
                state: PlannerStateType,
                popover: OptionType(node),
            })),
            markers: ArrayType(PlannerMarkerType),
        })),
        now: OptionType(PlannerSlotType),
        density: OptionType(DensityType),
        slotMinWidth: OptionType(StringType),
        onSelectRow: OptionType(FunctionType([PlannerSelectEventType], NullType)),
    }),

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
