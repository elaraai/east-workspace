/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Badge, DataList, Highlight, HoverCard, Separator, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const DATA_LIST_HORIZONTAL_DATA = [
    { label: "Price", value: <Text>$99.00</Text> },
    { label: "Quantity", value: <Text>5</Text> },
    { label: "Total", value: <Text>$495.00</Text> },
];
const DATA_LIST_BOLD_DATA = [
    { label: "CPU", value: <Text>Intel i9-14900K</Text> },
    { label: "RAM", value: <Text>64GB DDR5</Text> },
    { label: "Storage", value: <Text>2TB NVMe SSD</Text> },
];
const DATA_LIST_SMALL_DATA = [
    { label: "ID", value: <Text>#12345</Text> },
    { label: "Type", value: <Text>Premium</Text> },
    { label: "Status", value: <Text>Verified</Text> },
];
const DATA_LIST_LARGE_DATA = [
    { label: "Revenue", value: <Text>$1,234,567</Text> },
    { label: "Growth", value: <Text>+15.2%</Text> },
    { label: "Customers", value: <Text>10,432</Text> },
];
const DATA_LIST_PROFILE_DATA = [
    { label: "Full Name", value: <Text>Jane Smith</Text> },
    { label: "Email", value: <Text>jane.smith@company.com</Text> },
    { label: "Department", value: <Text>Engineering</Text> },
    { label: "Role", value: <Text>Senior Developer</Text> },
    { label: "Location", value: <Text>San Francisco, CA</Text> },
];
const DATA_LIST_COLOUR_OVERRIDES_DATA = [
    { label: "Username", value: <Text>alice_smith</Text> },
    { label: "Email", value: <Text>alice@example.com</Text> },
    { label: "Status", value: <Text>Active</Text> },
];

export const dataListBasic = example({
    keywords: ["DataList", "Root", "basic", "vertical"],
    description: "Default vertical data list",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <DataList items={[
                { label: "Status", value: <Text>Active</Text> },
                { label: "User", value: <Text>john.doe@example.com</Text> },
                { label: "Created", value: <Text>2024-01-15</Text> },
            ]} />
        );
    }),
    inputs: [],
});

export const dataListRichValues = example({
    keywords: ["DataList", "Root", "Badge", "HoverCard", "Highlight", "rich"],
    description: "Values can be any UI component — badges, hover cards, highlighted text",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <DataList items={[
                { label: "Status", value: <Badge variant="solid" colorPalette="green">Active</Badge> },
                {
                    label: "Assigned To",
                    value: (
                        <HoverCard trigger={<Text color="blue.500">@alice</Text>}>
                            <VStack gap="1">
                                <Text fontWeight="bold">Alice Johnson</Text>
                                <Text textStyle="body-sm">Lead Designer — UX Team</Text>
                            </VStack>
                        </HoverCard>
                    ),
                },
                { label: "Filter", value: <Highlight query={["LIKE"]}>name LIKE '%smith%'</Highlight> },
                { label: "Priority", value: <Badge variant="subtle" colorPalette="red">Urgent</Badge> },
            ]} />
        );
    }),
    inputs: [],
});

export const dataListVariants = example({
    keywords: ["DataList", "Root", "orientation", "horizontal", "variant", "bold", "size", "sm", "compact", "lg", "profile", "user", "colour", "override", "background", "labelColor", "valueColor"],
    description: "DataList variant panel — list horizontal (horizontal layout), list bold (bold styling), list small (compact data list), list large (larger data list for emphasis), list profile (real-world data list), list colour overrides (explicit background / border / label / value colours for brand alignment)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" align="stretch">
                <Separator label="List Horizontal" align="start" />
                <DataList orientation="horizontal" items={DATA_LIST_HORIZONTAL_DATA} />
                <Separator label="List Bold" align="start" />
                <DataList variant="bold" items={DATA_LIST_BOLD_DATA} />
                <Separator label="List Small" align="start" />
                <DataList size="sm" items={DATA_LIST_SMALL_DATA} />
                <Separator label="List Large" align="start" />
                <DataList size="lg" items={DATA_LIST_LARGE_DATA} />
                <Separator label="List Profile" align="start" />
                <DataList items={DATA_LIST_PROFILE_DATA} />
                <Separator label="List Colour Overrides" align="start" />
                <DataList
                        orientation="horizontal"
                        background="blue.50"
                        borderColor="blue.200"
                        labelColor="blue.700"
                        valueColor="blue.900"
                        items={DATA_LIST_COLOUR_OVERRIDES_DATA}
                    />
            </VStack>
        );
    }),
    inputs: [],
});
