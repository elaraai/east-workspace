/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's pages (#992) — the record a solution declares with
 * `Studio.Types.Pages`, the patches its writes are, and what is read from it.
 */

import { ArrayType, DictType, East, IntegerType, OptionType, StringType, example, none, some, variant } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";

export const studioChanges = example({
    keywords: [
        "Studio", "Studio.changes", "changes", "change list", "publish preview", "layout", "page", "cells",
        "added", "moved", "resized", "diff",
    ],
    description: "The changes from a page's published layout to its draft — what the builder counts and the publish preview lists: a tile resized, and a card added beside it",
    fn: East.function([], ArrayType(Studio.Types.Change), ($) => {
        const live = $.const({
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                { key: "c-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "fp-trend" },
            ],
        }, Studio.Types.Page);
        const draft = $.const({
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "fp-trend" },
                { key: "c-bars", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, component: "breakdown_bars", fingerprint: "fp-bars" },
            ],
        }, Studio.Types.Page);
        return Studio.changes(live, draft);
    }),
    inputs: [],
    returns: [
        variant("resized", { cell: "c-trend", component: "revenue_trend", detail: "span 12 → 8" }),
        variant("added", { cell: "c-bars", component: "breakdown_bars", detail: "row 2 · span 4" }),
    ],
});

export const studioPublish = example({
    keywords: [
        "Studio", "Studio.publish", "publish", "version", "live", "draft", "patch", "record", "pages", "Studio.Types.Pages",
        "fingerprint", "stamp",
    ],
    description: "A publish is one patch of the page: applied, the page's live version is its draft, numbered from 1 — each placement stamped with its listed component's fingerprint, and one whose component the surface does not list keeping its own",
    fn: East.function([], IntegerType, ($) => {
        const pages = $.const(new Map([
            [{ project: "ops", page: "overview" }, variant("page", {
                draft: {
                    title: "Overview",
                    cells: [
                        { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                    ],
                },
                live: none,
            })],
        ]), Studio.Types.Pages);
        const key = $.const({ project: "ops", page: "overview" }, Studio.Types.Key);
        const components = $.const([], ArrayType(Studio.Types.Component));
        const published = $.const(East.applyPatch(pages, Studio.publish(pages, key, components)), Studio.Types.Pages);
        return published.get(key).match({
            page: (_$, page) => page.live.match({ some: (_$2, live) => live.version, none: (_$2) => East.value(0n) }),
            template: (_$) => East.value(0n),
        });
    }),
    inputs: [],
    returns: 1n,
});

export const studioNewPage = example({
    keywords: ["Studio", "Studio.newPage", "new page", "template", "Studio.saveTemplate", "save as template", "blank grid", "patch"],
    description: "A new page starts from a template's cells, under its own title, with no live version — one inserting patch",
    fn: East.function([], IntegerType, ($) => {
        const pages = $.const(new Map([
            [{ project: "ops", page: "tpl-kpis" }, variant("template", {
                title: "KPIs",
                cells: [
                    { key: "t-kpi", row: "t1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                ],
            })],
        ]), Studio.Types.Pages);
        const key = $.const({ project: "ops", page: "detail" }, Studio.Types.Key);
        const template = $.const(some({ project: "ops", page: "tpl-kpis" }), OptionType(Studio.Types.Key));
        const started = $.const(East.applyPatch(pages, Studio.newPage(pages, key, "Detail", template)), Studio.Types.Pages);
        return started.get(key).match({
            page: (_$, page) => page.draft.cells.size(),
            template: (_$) => East.value(0n),
        });
    }),
    inputs: [],
    returns: 1n,
});

export const studioUsage = example({
    keywords: ["Studio", "Studio.usage", "used in", "usage", "component", "count", "pages", "catalog"],
    description: "How many pages place each component — \"Used in N\" — a page counted once whether its draft, its live version or both place it",
    fn: East.function([], DictType(StringType, IntegerType), ($) => {
        const pages = $.let(new Map(), Studio.Types.Pages);
        $(pages.insert({ project: "ops", page: "overview" }, variant("page", {
            draft: {
                title: "Overview",
                cells: [
                    { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                ],
            },
            live: some({
                version: 1n,
                page: {
                    title: "Overview",
                    cells: [
                        { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                        { key: "c-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "fp-trend" },
                    ],
                },
            }),
        })));
        $(pages.insert({ project: "ops", page: "detail" }, variant("page", {
            draft: {
                title: "Detail",
                cells: [
                    { key: "d-kpi", row: "d1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                ],
            },
            live: none,
        })));
        return Studio.usage(pages);
    }),
    inputs: [],
    returns: new Map([["kpi_rail", 2n], ["revenue_trend", 1n]]),
});

export const studioStatus = example({
    keywords: ["Studio", "Studio.status", "status", "live", "draft", "published", "page library"],
    description: "A page is live when its draft is its published layout, and a draft when it has changes the site does not show",
    fn: East.function([], StringType, ($) => {
        const page = $.const({
            draft: {
                title: "Overview",
                cells: [
                    { key: "c-kpi", row: "r1", span: 8n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                ],
            },
            live: some({
                version: 1n,
                page: {
                    title: "Overview",
                    cells: [
                        { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                    ],
                },
            }),
        }, Studio.Types.PageEntry);
        return Studio.status(page).match({ live: (_$) => East.value("Live"), draft: (_$) => East.value("Draft") });
    }),
    inputs: [],
    returns: "Draft",
});
