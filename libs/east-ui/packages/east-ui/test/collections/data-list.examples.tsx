/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Badge, DataList, Highlight, HoverCard, Text, VStack } from "@elaraai/east-ui/jsx";

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

export const dataListHorizontal = example({
    keywords: ["DataList", "Root", "orientation", "horizontal"],
    description: "Data list with horizontal layout",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <DataList orientation="horizontal" items={[
                { label: "Price", value: <Text>$99.00</Text> },
                { label: "Quantity", value: <Text>5</Text> },
                { label: "Total", value: <Text>$495.00</Text> },
            ]} />
        );
    }),
    inputs: [],
});

export const dataListBold = example({
    keywords: ["DataList", "Root", "variant", "bold"],
    description: "Data list with bold styling",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <DataList variant="bold" items={[
                { label: "CPU", value: <Text>Intel i9-14900K</Text> },
                { label: "RAM", value: <Text>64GB DDR5</Text> },
                { label: "Storage", value: <Text>2TB NVMe SSD</Text> },
            ]} />
        );
    }),
    inputs: [],
});

export const dataListSmall = example({
    keywords: ["DataList", "Root", "size", "sm", "compact"],
    description: "Compact data list",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <DataList size="sm" items={[
                { label: "ID", value: <Text>#12345</Text> },
                { label: "Type", value: <Text>Premium</Text> },
                { label: "Status", value: <Text>Verified</Text> },
            ]} />
        );
    }),
    inputs: [],
});

export const dataListLarge = example({
    keywords: ["DataList", "Root", "size", "lg"],
    description: "Larger data list for emphasis",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <DataList size="lg" items={[
                { label: "Revenue", value: <Text>$1,234,567</Text> },
                { label: "Growth", value: <Text>+15.2%</Text> },
                { label: "Customers", value: <Text>10,432</Text> },
            ]} />
        );
    }),
    inputs: [],
});

export const dataListProfile = example({
    keywords: ["DataList", "Root", "profile", "user"],
    description: "Real-world data list example",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <DataList items={[
                { label: "Full Name", value: <Text>Jane Smith</Text> },
                { label: "Email", value: <Text>jane.smith@company.com</Text> },
                { label: "Department", value: <Text>Engineering</Text> },
                { label: "Role", value: <Text>Senior Developer</Text> },
                { label: "Location", value: <Text>San Francisco, CA</Text> },
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

export const dataListColourOverrides = example({
    keywords: ["DataList", "Root", "colour", "override", "background", "labelColor", "valueColor"],
    description: "Colour escape hatches — explicit background / border / label / value colours for brand alignment",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <DataList
                orientation="horizontal"
                background="blue.50"
                borderColor="blue.200"
                labelColor="blue.700"
                valueColor="blue.900"
                items={[
                    { label: "Username", value: <Text>alice_smith</Text> },
                    { label: "Email", value: <Text>alice@example.com</Text> },
                    { label: "Status", value: <Text>Active</Text> },
                ]}
            />
        );
    }),
    inputs: [],
});
