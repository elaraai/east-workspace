/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

export {
    EastChakraDataList,
    toChakraDataListRoot,
    type DataListRootValue,
    type DataListItemValue,
    type EastChakraDataListProps,
} from "./data-list";

export {
    EastChakraPagination,
    type PaginationValue,
    type EastChakraPaginationProps,
} from "./pagination";

export {
    EastChakraMatrix,
    type MatrixRootValue,
    type EastChakraMatrixProps,
} from "./matrix";

export {
    EastChakraTable,
    toChakraTableRoot,
    type TableRootValue,
    type TableColumnValue,
    type EastChakraTableProps,
} from "./table";

export {
    EastChakraTreeView,
    toChakraTreeViewRoot,
    type TreeViewRootValue,
    type TreeNodeValue,
    type EastChakraTreeViewProps,
} from "./tree-view";

export {
    EastChakraPlanner,
    type PlannerRootValue,
    type PlannerEventValue,
    type EastChakraPlannerProps,
} from "./planner";

export {
    EastChakraPlan,
    type PlanRootValue,
    type PlanRowValue,
    type EastChakraPlanProps,
} from "./plan";

export {
    EastChakraLibrary,
    type LibraryValue,
    type LibraryItemValue,
    type EastChakraLibraryProps,
} from "./library";

export {
    EastChakraRoster,
    type RosterValue,
    type RosterShiftValue,
    type EastChakraRosterProps,
} from "./roster";

export {
    EastChakraBoard,
    type BoardValue,
    type BoardEntityValue,
    type BoardAssignmentValue,
    type EastChakraBoardProps,
} from "./board";

export {
    EastChakraCalendar,
    type CalendarValue,
    type CalendarCellValue,
    type EastChakraCalendarProps,
} from "./calendar";

export {
    EastChakraSchematic,
    type SchematicValue,
    type SchematicItemValue,
    type EastChakraSchematicProps,
} from "./schematic";
export {
    EastChakraFlowchart,
    type FlowchartValue,
    type EastChakraFlowchartProps,
} from "./flowchart";
export {
    EastChakraMap,
    type MapValue,
    type MapAreaValue,
    type MapMarkerValue,
    type MapLineValue,
    type MapOverlayValue,
    type EastChakraMapProps,
} from "./map";

export {
    EastChakraBlend,
    type BlendValue,
    type BlendTargetValue,
    type BlendAllocationValue,
    type EastChakraBlendProps,
} from "./blend";

// Key search over a collection's canonical key order (#520, relocated in #574
// — it has no e3 dependency: every prop is a host callback).
export {
    DatasetKeySearch,
    parseKeyInput,
    keyRangePredicates,
    type DatasetKeySearchProps,
    type DatasetKeyMatchRange,
    type DatasetKeyQuery,
    type ParsedKeyInput,
} from "./key-search/index.js";
