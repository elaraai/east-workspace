/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Examples for the Decision.Brief pattern.
 *
 * Each export is an East value of type `UIComponentType` produced by
 * `Decision.Brief.Root({ … })`. Showcases / docs pages import these as
 * namespaces and inject specific named examples into the matching spec
 * sections (purpose, mocks, when-to-use, etc.).
 *
 * Click handlers are real `East.function`s declared inside each example
 * via `$.const(...)` — they emit toasts so the showcase makes the wiring
 * visible without needing a real commit pipeline. The outer `fn` stays
 * sync (returning `UIComponentType`); async `Toast.emit` lives inside
 * `Reactive.Root`'s inner function body.
 *
 * @packageDocumentation
 */

import { East, FunctionType, NullType, example, none, some, variant } from "@elaraai/east";
import { Reactive, Toast, UIComponentType } from "@elaraai/east-ui";
import { Decision } from "@elaraai/east-ui-patterns";

/**
 * Standard accent — the default Decide-mode briefing. Routine / Exception /
 * standard Commitment archetypes.
 */
export const decisionBriefStandard = example({
    keywords: [
        "Decision", "Brief", "Decide", "anchor", "standard",
        "shift-swap", "workforce", "OT savings",
    ],
    description: "Decision.Brief — standard accent, workforce shift-swap recommendation",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onApply = $.const(East.function([], NullType, $ => {
                $(Toast.emit(Toast.make("success", "Shift swap applied", {
                    description: "3 SE shifts moved Patel → Cho for week of May 11.",
                    duration: 4000n,
                })));
            }), FunctionType([], NullType));
            const onModify = $.const(East.function([], NullType, $ => {
                $(Toast.emit(Toast.make("info", "Modify dialog opened", {
                    description: "Adjust the proposed shift swap before committing.",
                    duration: 3000n,
                })));
            }), FunctionType([], NullType));
            const onOverride = $.const(East.function([], NullType, $ => {
                $(Toast.emit(Toast.make("warning", "Override + why", {
                    description: "Capture the reason — feeds the audit log.",
                    duration: 3000n,
                })));
            }), FunctionType([], NullType));
            const onAside = $.const(East.function([], NullType, $ => {
                $(Toast.emit(Toast.make("info", "Alternatives", {
                    description: "Showing the next-best moves the model considered.",
                    duration: 3000n,
                })));
            }), FunctionType([], NullType));
            return Decision.Brief.Root({
                claim: "Move 3 SE shifts from **Patel** → **Cho** for week of May 11",
                because: [
                    {
                        reason: "SE-1 forecast is **+14%** vs base, driven by holiday demand",
                        accent: some("13.6k vs 11.9k units"),
                    },
                    {
                        reason: "Cho is 12h under weekly cap; Patel is at 38h with 4 forecast",
                        accent: some("weekend-pref flag from Mar"),
                    },
                    {
                        reason: "Past 5 similar moves all reduced overtime; right rate **5/5**",
                        accent: none,
                    },
                ],
                upside: "**−$8.4k** overtime saved this week · coverage 99.4% (+1.2 pp)",
                risks: some(
                    "Patel weekend preference (raised Mar 18, see audit) · 1 customer touchpoint Tue",
                ),
                unknowns: some(
                    "Cho's school-pickup arrangement — last conversation >30d",
                ),
                stakes: {
                    impact:        { value: "−$8.4k",   tone: variant("mid", null) },
                    affected:      some("3 workers"),
                    reversibility: some({ value: "reversible 24h", tone: variant("low", null) }),
                },
                actions: [
                    { label: "Apply", options: { onClick: onApply, style: { variant: "solid", size: "lg" } } },
                    { label: "Modify", options: { onClick: onModify, style: { variant: "outline" } } },
                    { label: "Override", options: { onClick: onOverride, style: { variant: "ghost" } } },
                ],
                aside: { label: "Why this?" },
                accent: some(variant("brand", null)),
            });
        }));
    }),
    inputs: [],
});

/**
 * Guarded accent (warn) — Commitment / Strategic decisions. Apply opens
 * Commit.Confirm with a required audit note.
 */
export const decisionBriefGuarded = example({
    keywords: [
        "Decision", "Brief", "guarded", "warn", "irreversible",
        "promo", "marketplace", "early-end",
    ],
    description: "Decision.Brief — guarded accent, marketplace clearance early-end",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onApply = $.const(East.function([], NullType, $ => {
                $(Toast.emit(Toast.make("warning", "Confirm & commit", {
                    description: "Opens Commit.Confirm with audit note required.",
                    duration: 4000n,
                })));
            }), FunctionType([], NullType));
            const onEditTerms = $.const(East.function([], NullType, $ => {
                $(Toast.emit(Toast.make("info", "Edit terms", {
                    description: "Adjust early-end window before committing.",
                    duration: 3000n,
                })));
            }), FunctionType([], NullType));
            const onReject = $.const(East.function([], NullType, $ => {
                $(Toast.emit(Toast.make("info", "Reject + why", {
                    description: "Capture why — feeds the audit log.",
                    duration: 3000n,
                })));
            }), FunctionType([], NullType));
            return Decision.Brief.Root({
                claim: "Cancel marketplace clearance promotion early — end **Sun 23:59**",
                because: [
                    {
                        reason: "Promo is cannibalising direct-channel revenue at **1.3×** target rate",
                        accent: some("last 14 days"),
                    },
                    {
                        reason: "Ending Sun 23:59 keeps the committed minimum impressions; further loss avoided",
                        accent: none,
                    },
                    {
                        reason: "Customer-comms team has the 8-hour window pre-staged from prior incidents",
                        accent: none,
                    },
                ],
                upside: "Net revenue **+$84k** · partner SLA still at floor (2.3M impressions)",
                risks: some(
                    "Partner relationship strain — second early-end this quarter · brand may flag in QBR",
                ),
                unknowns: some(
                    "Whether partner has discretionary spend earmarked for this slot — last call was 6w ago",
                ),
                stakes: {
                    impact:        { value: "+$84k",  tone: variant("high", null) },
                    affected:      some("partner + 4 brands"),
                    reversibility: some({
                        value: "irreversible after Sun",
                        tone:  variant("high", null),
                    }),
                },
                actions: [
                    { label: "Confirm & commit", options: { onClick: onApply, style: { variant: "solid", size: "lg" } } },
                    { label: "Edit terms", options: { onClick: onEditTerms, style: { variant: "outline" } } },
                    { label: "Reject", options: { onClick: onReject, style: { variant: "ghost" } } },
                ],
                aside: { label: "Why this?" },
                accent: some(variant("warn", null)),
                // Marketplace clearance carries longer body content
                // (partner-comm framing, multi-clause risks). Widen
                // beyond the 560 px default so bullets don't wrap tight.
                style:  { maxWidth: "720px" },
            });
        }));
    }),
    inputs: [],
});

/**
 * Trivial — low-stakes Routine. Single Apply + Dismiss; no risks slot
 * (renders "none material" placeholder).
 */
export const decisionBriefTrivial = example({
    keywords: [
        "Decision", "Brief", "trivial", "routine", "low-stakes", "shift-pin",
    ],
    description: "Decision.Brief — trivial, single Apply + Dismiss",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onApply = $.const(East.function([], NullType, $ => {
                $(Toast.emit(Toast.make("success", "Pinned", {
                    description: "S. Cho pinned to morning shift Tue–Thu.",
                    duration: 3000n,
                })));
            }), FunctionType([], NullType));
            const onDismiss = $.const(East.function([], NullType, $ => {
                $(Toast.emit(Toast.make("neutral", "Dismissed", {
                    duration: 2000n,
                })));
            }), FunctionType([], NullType));
            return Decision.Brief.Root({
                claim: "Pin worker **S. Cho** to morning shift Tue–Thu",
                because: [
                    {
                        reason: "Stated preference confirmed in this morning's standup",
                        accent: none,
                    },
                    {
                        reason: "No skill-mix or coverage change",
                        accent: none,
                    },
                ],
                upside: "Honours stated preference · no model knock-on",
                risks: none,
                unknowns: none,
                stakes: {
                    impact:        { value: "~$0", tone: variant("low", null) },
                    affected:      some("1 worker"),
                    reversibility: some({
                        value: "reversible anytime",
                        tone:  variant("low", null),
                    }),
                },
                actions: [
                    { label: "Apply", options: { onClick: onApply, style: { variant: "solid", size: "lg" } } },
                    { label: "Dismiss", options: { onClick: onDismiss, style: { variant: "ghost" } } },
                ],
                accent: some(variant("brand", null)),
            });
        }));
    }),
    inputs: [],
});
