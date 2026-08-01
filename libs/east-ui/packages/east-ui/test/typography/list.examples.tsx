/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Icon, List, Reactive, Separator, VStack, HStack, Text } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const listUnordered = example({
    keywords: ["List", "Root", "unordered", "bulleted"],
    description: "Bulleted list",
    fn: East.function([], UIComponentType, (_$) => {
        return <List items={["First item", "Second item", "Third item"]} variant="unordered" />;
    }),
    inputs: [],
});

// ============================================================================
// List — variants, spacing, palettes (variant panel)
// ============================================================================

export const listVariants = example({
    keywords: ["List", "Root", "ordered", "numbered", "gap", "spacing", "colorPalette", "blue", "markers", "green", "empty", "Reactive", "State", "interactive", "counter"],
    description: "List variant panel — ordered (numbered list), with gap (increased spacing between items), colored (blue list markers), green (green numbered list), empty (list with no items), interactive (reactive list whose item labels update from a counter)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="ORDERED" align="start" />
                <List items={["Step one", "Step two", "Step three"]} variant="ordered" />
                <Separator label="WITH GAP" align="start" />
                <List items={["Item A", "Item B", "Item C"]} variant="unordered" gap="4" />
                <Separator label="COLORED" align="start" />
                <List items={["Blue item one", "Blue item two", "Blue item three"]} variant="unordered" colorPalette="blue" />
                <Separator label="GREEN" align="start" />
                <List items={["Complete task A", "Complete task B", "Complete task C"]} variant="ordered" colorPalette="green" />
                <Separator label="EMPTY" align="start" />
                <List items={[]} />
                <Separator label="INTERACTIVE" align="start" />
                <Reactive>{$ => {
                    const counter = $.let(State.bind([IntegerType], "list_counter", 0n));
                    const value = $.let(counter.read());
                    const increment = $.const(East.function([], NullType, $ => {
                        const cur = $.let(counter.read());
                        $(counter.write(cur.add(1n)));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <List
                                items={[
                                    <Text>{East.str`First — bump ${East.print(value)}`}</Text>,
                                    <Text>{East.str`Second — bump ${East.print(value)}`}</Text>,
                                    <Text>{East.str`Third — bump ${East.print(value)}`}</Text>,
                                ]}
                                variant="ordered"
                            />
                            <Button onClick={increment}>Bump</Button>
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// List — semantic treatments mirroring the design system (variant panel)
// ============================================================================

export const listSemantic = example({
    keywords: ["List", "Root", "features", "product", "ordered", "steps", "installation", "marker", "check", "compliance", "workforce", "dash", "danger", "problem", "issues"],
    description: "List semantic panel — features (product features), steps (installation steps), checkmarks (compliance checklist with green check markers, mirrors the shift-optimiser `.wf-constraints` block), dashed (problem notes with red dash markers, mirrors the `.problem-notes` block)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="FEATURES" align="start" />
                <List items={["Fast performance", "Type-safe development", "Easy to use API", "Comprehensive documentation"]} variant="unordered" gap="2" colorPalette="teal" />
                <Separator label="STEPS" align="start" />
                <List items={["Install dependencies", "Configure environment", "Run the application", "Verify installation"]} variant="ordered" gap="3" />
                <Separator label="CHECKMARKS" align="start" />
                <List
                    items={[
                        "Max 5 consecutive shifts — 412 staff, clear",
                        "SLA: 92% on-time (27 misses)",
                        "Rostered vs demand: within tolerance",
                        "Training currency: all staff in-date",
                    ]}
                    marker="check"
                    markerColor="fg.success"
                    gap="2"
                />
                <Separator label="DASHED" align="start" />
                <List
                    items={[
                        <Text fontStyle="italic">Stage 1 delayed ~6h by setpoint drift since 02:00</Text>,
                        <Text fontStyle="italic">Vendor feed unavailable — forecast using last-known</Text>,
                        <Text fontStyle="italic">3 drivers flagged for manual review</Text>,
                    ]}
                    marker="dash"
                    markerColor="fg.danger"
                    gap="2"
                />
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Rich items — the custom item-slot contract
// ============================================================================

export const listRichItems = example({
    keywords: ["List", "Root", "rich", "UIComp", "icon", "HStack"],
    description: "Rich items — each is a custom HStack with icon + text",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <List
                items={[
                    <HStack gap="2" align="center">
                        <Icon prefix="fas" name="circle-check" color="fg.success" />
                        <Text>Passed: schema validation</Text>
                    </HStack>,
                    <HStack gap="2" align="center">
                        <Icon prefix="fas" name="circle-xmark" color="fg.danger" />
                        <Text>Failed: missing required field `id`</Text>
                    </HStack>,
                    <HStack gap="2" align="center">
                        <Icon prefix="fas" name="circle-info" color="fg.info" />
                        <Text>Skipped: optional integrity check</Text>
                    </HStack>,
                ]}
                marker="none"
                gap="2"
            />
        );
    }),
    inputs: [],
});
