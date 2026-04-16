/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Badge, DataList, Highlight, HoverCard, Stack, Text, UIComponentType } from "../../src/index.js";

export const dataListBasic = example({
    keywords: ["DataList", "Root", "basic", "vertical"],
    description: "Default vertical data list",
    fn: East.function([], UIComponentType, (_$) => {
        return DataList.Root([
            { label: "Status", value: Text.Root("Active") },
            { label: "User", value: Text.Root("john.doe@example.com") },
            { label: "Created", value: Text.Root("2024-01-15") },
        ]);
    }),
    inputs: [],
});

export const dataListHorizontal = example({
    keywords: ["DataList", "Root", "orientation", "horizontal"],
    description: "Data list with horizontal layout",
    fn: East.function([], UIComponentType, (_$) => {
        return DataList.Root([
            { label: "Price", value: Text.Root("$99.00") },
            { label: "Quantity", value: Text.Root("5") },
            { label: "Total", value: Text.Root("$495.00") },
        ], { orientation: "horizontal" });
    }),
    inputs: [],
});

export const dataListBold = example({
    keywords: ["DataList", "Root", "variant", "bold"],
    description: "Data list with bold styling",
    fn: East.function([], UIComponentType, (_$) => {
        return DataList.Root([
            { label: "CPU", value: Text.Root("Intel i9-14900K") },
            { label: "RAM", value: Text.Root("64GB DDR5") },
            { label: "Storage", value: Text.Root("2TB NVMe SSD") },
        ], { variant: "bold" });
    }),
    inputs: [],
});

export const dataListSmall = example({
    keywords: ["DataList", "Root", "size", "sm", "compact"],
    description: "Compact data list",
    fn: East.function([], UIComponentType, (_$) => {
        return DataList.Root([
            { label: "ID", value: Text.Root("#12345") },
            { label: "Type", value: Text.Root("Premium") },
            { label: "Status", value: Text.Root("Verified") },
        ], { size: "sm" });
    }),
    inputs: [],
});

export const dataListLarge = example({
    keywords: ["DataList", "Root", "size", "lg"],
    description: "Larger data list for emphasis",
    fn: East.function([], UIComponentType, (_$) => {
        return DataList.Root([
            { label: "Revenue", value: Text.Root("$1,234,567") },
            { label: "Growth", value: Text.Root("+15.2%") },
            { label: "Customers", value: Text.Root("10,432") },
        ], { size: "lg" });
    }),
    inputs: [],
});

export const dataListProfile = example({
    keywords: ["DataList", "Root", "profile", "user"],
    description: "Real-world data list example",
    fn: East.function([], UIComponentType, (_$) => {
        return DataList.Root([
            { label: "Full Name", value: Text.Root("Jane Smith") },
            { label: "Email", value: Text.Root("jane.smith@company.com") },
            { label: "Department", value: Text.Root("Engineering") },
            { label: "Role", value: Text.Root("Senior Developer") },
            { label: "Location", value: Text.Root("San Francisco, CA") },
        ]);
    }),
    inputs: [],
});

export const dataListRichValues = example({
    keywords: ["DataList", "Root", "Badge", "HoverCard", "Highlight", "rich"],
    description: "Values can be any UI component — badges, hover cards, highlighted text",
    fn: East.function([], UIComponentType, (_$) => {
        return DataList.Root([
            { label: "Status", value: Badge.Root("Active", { variant: "solid", colorPalette: "green" }) },
            { label: "Assigned To", value: HoverCard.Root(
                Text.Root("@alice", { color: "blue.500" }),
                [
                    Stack.VStack([
                        Text.Root("Alice Johnson", { fontWeight: "bold" }),
                        Text.Root("Lead Designer — UX Team", { fontSize: "sm" }),
                    ], { gap: "1" }),
                ],
            ) },
            { label: "Filter", value: Highlight.Root("name LIKE '%smith%'", ["LIKE"]) },
            { label: "Priority", value: Badge.Root("Urgent", { variant: "subtle", colorPalette: "red" }) },
        ]);
    }),
    inputs: [],
});
