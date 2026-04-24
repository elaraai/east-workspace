/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { match, equalFor, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";

// Import implemented components
import { EastChakraText } from "./typography/text";
import { EastChakraCode } from "./typography/code";
import { EastChakraHeading } from "./typography/heading";
import { EastChakraLink } from "./typography/link";
import { EastChakraHighlight } from "./typography/highlight";
import { EastChakraMark } from "./typography/mark";
import { EastChakraList } from "./typography/list";
import { EastChakraCodeBlock } from "./typography/code-block";
import { EastChakraNumeric } from "./typography/numeric";
import { EastChakraNote } from "./typography/note";
import { EastChakraButton } from "./buttons/button";
import { EastChakraIconButton } from "./buttons/icon-button";
import { EastChakraCopyButton } from "./buttons/copy-button";
import { EastChakraCloseButton } from "./buttons/close-button";
import { EastChakraToggle } from "./buttons/toggle";
import { EastChakraButtonGroup } from "./buttons/button-group";
import { EastChakraSparkline } from "./charts/sparkline";
import { EastChakraAreaChart, EastChakraAreaRangeChart } from "./charts/area";
import { EastChakraBarChart } from "./charts/bar";
import { EastChakraLineChart } from "./charts/line";
import { EastChakraScatterChart } from "./charts/scatter";
import { EastChakraPieChart } from "./charts/pie";
import { EastChakraRadarChart } from "./charts/radar";
import { EastChakraBarList } from "./charts/bar-list";
import { EastChakraBarSegment } from "./charts/bar-segment";
import { EastChakraComposedChart } from "./charts/composed";
import { EastChakraBox } from "./layout/box";
import { EastChakraFlex } from "./layout/flex";
import { EastChakraStack } from "./layout/stack";
import { EastChakraSeparator } from "./layout/separator";
import { EastChakraGrid } from "./layout/grid";
import { EastChakraSplitter } from "./layout/splitter";
import { EastChakraSticky } from "./layout/sticky";
import { EastChakraScrollArea } from "./layout/scroll-area";
import { EastChakraChipRail } from "./layout/chip-rail";
import { EastChakraAccordion } from "./disclosure/accordion";
import { EastChakraCarousel } from "./disclosure/carousel";
import { EastChakraTabs } from "./disclosure/tabs";
import { EastChakraSegmentGroup } from "./disclosure/segment-group";
import { EastChakraCollapsible } from "./disclosure/collapsible";
import { EastChakraDisclosure } from "./disclosure/show-more";
import { EastChakraSteps } from "./disclosure/steps";
import { EastChakraTimeline } from "./disclosure/timeline";
import { EastChakraOptionList } from "./disclosure/option-list";
import { EastChakraDataList } from "./collections/data-list";
import { EastChakraTable } from "./collections/table";
import { EastChakraTreeView } from "./collections/tree-view";
import { EastChakraGantt } from "./collections/gantt";
import { EastChakraPlanner } from "./collections/planner";
import { EastChakraBreadcrumb } from "./navigation/breadcrumb";
import { EastChakraIcon } from "./display/icon";
import { EastChakraBadge } from "./display/badge";
import { EastChakraTag } from "./display/tag";
import { EastChakraAvatar } from "./display/avatar";
import { EastChakraStat } from "./display/stat";
import { EastChakraMetricChip } from "./display/metric-chip";
import {
    EastChakraStringInput,
    EastChakraIntegerInput,
    EastChakraFloatInput,
    EastChakraDateTimeInput,
    EastChakraCheckbox,
    EastChakraSwitch,
    EastChakraSelect,
    EastChakraCombobox,
    EastChakraSlider,
    EastChakraField,
    EastChakraTextarea,
    EastChakraTagsInput,
    EastChakraFileUpload,
} from "./forms";
import { EastChakraAlert, EastChakraProgress, EastChakraEmptyState, EastChakraSpinner, EastChakraSkeleton, EastChakraStatus, EastChakraBanner, EastChakraProgressCircle } from "./feedback";
import { EastChakraCard } from "./container";
import {
    EastChakraTooltip,
    EastChakraMenu,
    EastChakraPopover,
    EastChakraHoverCard,
    EastChakraDialog,
    EastChakraDrawer,
    EastChakraActionBar,
    EastChakraToggleTip,
} from "./overlays";
import { EastReactiveComponent } from "./reactive";

// Pre-define the equality function at module level
const uiComponentEqual = equalFor(UIComponentType);

export interface EastChakraComponentProps {
    value: ValueTypeOf<UIComponentType>;
    /** Storage key prefix for persisting component state. Built up as the tree renders. */
    storageKey: string;
}

/** Build a child storage key by appending a segment to the parent key. */
function childKey(parentKey: string, segment: string): string {
    return parentKey ? `${parentKey}.${segment}` : segment;
}

/**
 * Top-level component that renders any East UI component.
 * Matches on the variant type and delegates to the appropriate React component.
 */
export const EastChakraComponent = memo(function EastChakraComponent({ value, storageKey }: EastChakraComponentProps) {
    const rendered = useMemo(() => {
        return match(value, {
            // Typography
            Text: (v) => <EastChakraText value={v} />,
            Code: (v) => <EastChakraCode value={v} />,
            Heading: (v) => <EastChakraHeading value={v} />,
            Link: (v) => <EastChakraLink value={v} />,
            Highlight: (v) => <EastChakraHighlight value={v} />,
            Mark: (v) => <EastChakraMark value={v} />,
            List: (v) => <EastChakraList value={v} storageKey={childKey(storageKey, "List")} />,
            CodeBlock: (v) => <EastChakraCodeBlock value={v} />,
            Numeric: (v) => <EastChakraNumeric value={v} />,
            Note: (v) => <EastChakraNote value={v} storageKey={childKey(storageKey, "Note")} />,

            // Buttons
            Button: (v) => <EastChakraButton value={v} storageKey={childKey(storageKey, "Button")} />,
            IconButton: (v) => <EastChakraIconButton value={v} />,
            CopyButton: (v) => <EastChakraCopyButton value={v} />,
            CloseButton: (v) => <EastChakraCloseButton value={v} />,
            Toggle: (v) => <EastChakraToggle value={v} storageKey={childKey(storageKey, "Toggle")} />,
            ButtonGroup: (v) => <EastChakraButtonGroup value={v} storageKey={childKey(storageKey, "ButtonGroup")} />,

            // Layout
            Box: (v) => <EastChakraBox value={v} storageKey={storageKey} />,
            Flex: (v) => <EastChakraFlex value={v} storageKey={storageKey} />,
            Stack: (v) => <EastChakraStack value={v} storageKey={storageKey} />,
            Separator: (v) => <EastChakraSeparator value={v} storageKey={storageKey} />,
            Grid: (v) => <EastChakraGrid value={v} storageKey={storageKey} />,
            Splitter: (v) => <EastChakraSplitter value={v} storageKey={childKey(storageKey, "Splitter")} />,
            Sticky: (v) => <EastChakraSticky value={v} storageKey={childKey(storageKey, "Sticky")} />,
            ScrollArea: (v) => <EastChakraScrollArea value={v} storageKey={childKey(storageKey, "ScrollArea")} />,
            ChipRail: (v) => <EastChakraChipRail value={v} storageKey={childKey(storageKey, "ChipRail")} />,

            // Forms
            StringInput: (v) => <EastChakraStringInput value={v} />,
            IntegerInput: (v) => <EastChakraIntegerInput value={v} />,
            FloatInput: (v) => <EastChakraFloatInput value={v} />,
            DateTimeInput: (v) => <EastChakraDateTimeInput value={v} />,
            Checkbox: (v) => <EastChakraCheckbox value={v} />,
            Switch: (v) => <EastChakraSwitch value={v} />,
            Select: (v) => <EastChakraSelect value={v} />,
            Combobox: (v) => <EastChakraCombobox value={v} />,
            Slider: (v) => <EastChakraSlider value={v} />,
            FileUpload: (v) => <EastChakraFileUpload value={v} />,
            Field: (v) => <EastChakraField value={v} storageKey={childKey(storageKey, "Field")} />,
            Textarea: (v) => <EastChakraTextarea value={v} />,
            TagsInput: (v) => <EastChakraTagsInput value={v} />,

            // Feedback
            Progress: (v) => <EastChakraProgress value={v} />,
            ProgressCircle: (v) => <EastChakraProgressCircle value={v} />,
            Alert: (v) => <EastChakraAlert value={v} storageKey={childKey(storageKey, "Alert")} />,
            Banner: (v) => <EastChakraBanner value={v} storageKey={childKey(storageKey, "Banner")} />,
            EmptyState: (v) => <EastChakraEmptyState value={v} storageKey={childKey(storageKey, "EmptyState")} />,
            Spinner: (v) => <EastChakraSpinner value={v} />,
            Skeleton: (v) => <EastChakraSkeleton value={v} />,
            Status: (v) => <EastChakraStatus value={v} storageKey={childKey(storageKey, "Status")} />,

            // Navigation
            Breadcrumb: (v) => <EastChakraBreadcrumb value={v} />,

            // Display
            Icon: (v) => <EastChakraIcon value={v} />,
            Badge: (v) => <EastChakraBadge value={v} />,
            Tag: (v) => <EastChakraTag value={v} />,
            Avatar: (v) => <EastChakraAvatar value={v} />,
            Stat: (v) => <EastChakraStat value={v} storageKey={childKey(storageKey, "Stat")} />,
            MetricChip: (v) => <EastChakraMetricChip value={v} storageKey={childKey(storageKey, "MetricChip")} />,

            // Container
            Card: (v) => <EastChakraCard value={v} storageKey={storageKey} />,

            // Collections
            DataList: (v) => <EastChakraDataList value={v} storageKey={childKey(storageKey, "DataList")} />,
            Table: (v) => <EastChakraTable value={v} storageKey={childKey(storageKey, "Table")} />,
            Gantt: (v) => <EastChakraGantt value={v} storageKey={childKey(storageKey, "Gantt")} />,
            Planner: (v) => <EastChakraPlanner value={v} storageKey={childKey(storageKey, "Planner")} />,

            // Charts
            Sparkline: (v) => <EastChakraSparkline value={v} />,
            AreaChart: (v) => <EastChakraAreaChart value={v} />,
            AreaRangeChart: (v) => <EastChakraAreaRangeChart value={v} />,
            BarChart: (v) => <EastChakraBarChart value={v} />,
            LineChart: (v) => <EastChakraLineChart value={v} />,
            ScatterChart: (v) => <EastChakraScatterChart value={v} />,
            PieChart: (v) => <EastChakraPieChart value={v} />,
            RadarChart: (v) => <EastChakraRadarChart value={v} />,
            BarList: (v) => <EastChakraBarList value={v} />,
            BarSegment: (v) => <EastChakraBarSegment value={v} />,
            ComposedChart: (v) => <EastChakraComposedChart value={v} />,

            TreeView: (v) => <EastChakraTreeView value={v} storageKey={childKey(storageKey, "TreeView")} />,

            // Disclosure
            Accordion: (v) => <EastChakraAccordion value={v} storageKey={childKey(storageKey, "Accordion")} />,
            Carousel: (v) => <EastChakraCarousel value={v} storageKey={childKey(storageKey, "Carousel")} />,
            Tabs: (v) => <EastChakraTabs value={v} storageKey={childKey(storageKey, "Tabs")} />,
            SegmentGroup: (v) => <EastChakraSegmentGroup value={v} storageKey={childKey(storageKey, "SegmentGroup")} />,
            Collapsible: (v) => <EastChakraCollapsible value={v} storageKey={childKey(storageKey, "Collapsible")} />,
            Disclosure: (v) => <EastChakraDisclosure value={v} storageKey={childKey(storageKey, "Disclosure")} />,
            Steps: (v) => <EastChakraSteps value={v} storageKey={childKey(storageKey, "Steps")} />,
            Timeline: (v) => <EastChakraTimeline value={v} storageKey={childKey(storageKey, "Timeline")} />,
            OptionList: (v) => <EastChakraOptionList value={v} storageKey={childKey(storageKey, "OptionList")} />,

            // Overlays
            Tooltip: (v) => <EastChakraTooltip value={v} storageKey={childKey(storageKey, "Tooltip")} />,
            Menu: (v) => <EastChakraMenu value={v} storageKey={childKey(storageKey, "Menu")} />,
            Popover: (v) => <EastChakraPopover value={v} storageKey={childKey(storageKey, "Popover")} />,
            HoverCard: (v) => <EastChakraHoverCard value={v} storageKey={childKey(storageKey, "HoverCard")} />,
            Dialog: (v) => <EastChakraDialog value={v} storageKey={childKey(storageKey, "Dialog")} />,
            Drawer: (v) => <EastChakraDrawer value={v} storageKey={childKey(storageKey, "Drawer")} />,
            ActionBar: (v) => <EastChakraActionBar value={v} />,
            ToggleTip: (v) => <EastChakraToggleTip value={v} storageKey={childKey(storageKey, "ToggleTip")} />,

            // Reactive
            ReactiveComponent: (v) => <EastReactiveComponent value={v} storageKey={childKey(storageKey, "ReactiveComponent")} />,
        });
    }, [value, storageKey]);

    return <>{rendered}</>;
}, (prev, next) => uiComponentEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
