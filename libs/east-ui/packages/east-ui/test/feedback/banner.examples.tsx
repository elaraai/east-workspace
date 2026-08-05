/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, NullType, StringType, StructType, example, none, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Banner, Button, Configurator, HStack, Reactive, SegmentGroup, Switch, Text } from "@elaraai/east-ui";

// ============================================================================
// Status variants — the Banner status grammar's live configurator (epic #455).
// ============================================================================

export const bannerStatusVariants = example({
    keywords: ["Banner", "stale", "dashed", "refresh", "info", "partial", "guard", "warning", "actions", "change", "saved", "success", "commit", "undo", "view", "sync", "progress", "error", "neutral", "dismissible", "onDismiss", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Banner status configurator — the eight-status grammar as one axis, each status swapping its paired icon, copy and action, plus a dismissible switch; the aside tracks onDismiss",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // The status axis carries the whole grammar: each entry pairs the
                // status variant with its paired icon and representative copy, so
                // selecting a status swaps the entire banner — `getTag()` gives
                // the segment key AND its label.
                const statuses = $.const([
                    { status: variant("info", null),    icon: "circle-info",          title: "You're viewing a frozen scenario", desc: "Editing is disabled. Duplicate the scenario to make changes.", action: "Duplicate" },
                    { status: variant("warning", null), icon: "triangle-exclamation", title: "Demand forecast degraded",         desc: "Two feeds reported late data this morning.",                   action: "Inspect" },
                    { status: variant("success", null), icon: "circle-check",         title: "Export complete",                  desc: "The plan pack landed in the shared drive.",                    action: "Open" },
                    { status: variant("error", null),   icon: "circle-xmark",         title: "Run failed",                       desc: "The solver exited before writing results.",                    action: "Retry" },
                    { status: variant("neutral", null), icon: "circle",               title: "Draft scenario",                   desc: "Not yet submitted for review.",                                action: "Submit" },
                    { status: variant("change", null),  icon: "circle-check",         title: "Scenario saved",                   desc: "Your changes are committed.",                                  action: "Undo" },
                    { status: variant("guard", null),   icon: "shield-halved",        title: "3 warnings on this run",           desc: "Review before promoting to production.",                       action: "Review" },
                    { status: variant("stale", null),   icon: "clock-rotate-left",    title: "Data last refreshed 48m ago",      desc: "Some metrics may be stale.",                                   action: "Refresh" },
                ], ArrayType(StructType({ status: Banner.Types.Status, icon: StringType, title: StringType, desc: StringType, action: StringType })));

                const statusBind      = $.let(State.bind([StringType], "banner_status", "stale"));
                const dismissibleBind = $.let(State.bind([BooleanType], "banner_dismissible", true));
                const dismissedBind   = $.let(State.bind([BooleanType], "banner_dismissed", false));

                const sKey        = $.let(statusBind.read());
                const dismissible = $.let(dismissibleBind.read());
                const dismissed   = $.let(dismissedBind.read());

                const onStatus      = $.const(East.function([StringType], NullType, ($, next) => { $(statusBind.write(next)); }));
                const onDismissible = $.const(East.function([BooleanType], NullType, ($, next) => { $(dismissibleBind.write(next)); }));
                const onDismiss     = $.const(East.function([], NullType, $ => {
                    $(dismissedBind.write(true));
                }));
                const onReset       = $.const(East.function([], NullType, $ => {
                    $(dismissedBind.write(false));
                }));

                // The selection is a lookup into the same array the control renders.
                const sel = $.let(statuses.filter((_$, o) => o.status.getTag().equal(sKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Status", sKey,
                                <SegmentGroup value={sKey} onChange={onStatus} size="sm"
                                    items={statuses.map((_$, o) => SegmentGroup.Item(o.status.getTag(), <Text>{o.status.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Dismiss spec row below rather than as one value.
                            Configurator.Slot("Dismiss",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={dismissible} label="Dismissible" onChange={onDismissible} />
                                </HStack>),
                        ]}
                        preview={
                            <Banner
                                status={sel.status}
                                icon={{ prefix: "fas", name: sel.icon, label: none, style: none }}
                                title={<Text fontWeight="medium">{sel.title}</Text>}
                                description={<Text>{sel.desc}</Text>}
                                actions={<Button variant="outline" size="sm"><Text>{sel.action}</Text></Button>}
                                dismissible={dismissible}
                                onDismiss={onDismiss}
                            />
                        }
                        aside={{
                            label: "Dismissed · onDismiss",
                            body: (
                                <HStack gap="3" align="center">
                                    <Badge colorPalette="brand">{dismissed.ifElse(_$ => "DISMISSED", _$ => "VISIBLE")}</Badge>
                                    <Button size="xs" variant="outline" onClick={onReset}>Reset</Button>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Icon", sel.icon),
                            Configurator.Spec("Action", sel.action),
                            Configurator.Spec("Dismiss", dismissible.ifElse(_$ => "close button", _$ => "persistent")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
