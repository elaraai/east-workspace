/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Every word the Studio's renderers say themselves (#996, #997, #998) — ONE
 * typed message table: the inspector's section heads, its fields and its
 * controls' names, its footer, and what it says with nothing selected; the
 * page library's toolbar, pane and section heads; the popovers that name a new
 * page or a template; and the publish preview's bar, its aside and its
 * footer. What the AUTHOR wrote — a component's name, key, reads and
 * description, a placement's title, a project's, a page's and an
 * environment's names, the audience and the rollout — is data, and never
 * passes through it.
 *
 * English is the default. A host overrides any subset for a subtree with
 * {@link StudioMessagesProvider}; numbers format in the locale react-aria's
 * `I18nProvider` above the app sets (the browser's otherwise).
 *
 * @packageDocumentation
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";

/**
 * The Studio's message table.
 *
 * @remarks
 * Numbers — `span`, `px`, the counts, a version's number — arrive already
 * formatted for the locale; `np`, `nt` and `n` are the raw counts, for plurals.
 */
export interface StudioMessages {
    /** The inspector's selection block — its eyebrow. */
    selectedComponent: () => string;
    /** The placement's component's code changed since the page went live. */
    logicChanged: () => string;
    /** The Data block's eyebrow. */
    data: () => string;
    /** A component whose code reads no dataset. */
    readsNothing: () => string;
    /** The Configuration block's eyebrow. */
    configuration: () => string;
    /** Beside it, what the lock says. */
    fixedByDeveloper: () => string;
    /** A component with no description. */
    noDescription: () => string;
    /** The Layout block's eyebrow. */
    layout: () => string;
    /** The span stepper's label. */
    columnSpan: () => string;
    /** The span as the stepper shows it — `8 / 12`. */
    spanOf: (p: { span: string }) => string;
    /** The stepper's minus button. */
    decreaseSpan: () => string;
    /** The stepper's plus button. */
    increaseSpan: () => string;
    /** The row field's label. */
    row: () => string;
    /** The height field's label. */
    height: () => string;
    /** A height that is its content's own. */
    auto: () => string;
    /** A height in px — `240 px`. */
    px: (p: { px: string }) => string;
    /** The alignment's label. */
    align: () => string;
    /** At the row's top. */
    alignTop: () => string;
    /** Centred in the row. */
    alignCenter: () => string;
    /** As tall as the row. */
    alignStretch: () => string;
    /** The inspector's footer. */
    published: () => string;
    /** The inspector with nothing selected — its heading. */
    nothingSelected: () => string;
    /** Under it, what to do. */
    nothingSelectedHint: () => string;
    /** The page library's search, counting what it searches — `Search 4 pages and 4 templates…`. */
    searchLibrary: (p: { pages: string; templates: string; np: number; nt: number }) => string;
    /** The search field's name. */
    searchLabel: () => string;
    /** The search's clear button. */
    clearSearch: () => string;
    /** The Sort menu's trigger. */
    sortByName: () => string;
    /** Name, A to Z. */
    nameAz: () => string;
    /** Name, Z to A. */
    nameZa: () => string;
    /** The primary action — `New page in Ops console`. */
    newPageIn: (p: { project: string }) => string;
    /** The primary action, folded, and the New page popover's head. */
    newPage: () => string;
    /** The pane's projects caption. */
    projects: () => string;
    /** The pane's pages caption, and the Pages section's head. */
    pages: () => string;
    /** The legend's live status. */
    live: () => string;
    /** The legend's draft status. */
    draft: () => string;
    /** The Templates section's head. */
    templates: () => string;
    /** Beside it. */
    cloneToStart: () => string;
    /** Beside the Pages head — `4 in Ops console`, or `1 of 4 in Ops console` while the search narrows. */
    pagesIn: (p: { shown: string; total: string; project: string; narrowed: boolean }) => string;
    /** The New page popover's name field. */
    pageName: () => string;
    /** Under it, while it is empty. */
    pageNameMissing: () => string;
    /** The New page popover's template field. */
    template: () => string;
    /** Blank grid — no template. */
    blankGrid: () => string;
    /** The New page popover's commit. */
    createPage: () => string;
    /** A popover's cancel. */
    cancel: () => string;
    /** A name the project holds already. */
    nameTaken: (p: { name: string }) => string;
    /** The builder toolbar's Save as template, and its popover's head. */
    saveAsTemplate: () => string;
    /** Its popover's name field. */
    templateName: () => string;
    /** Under it, while it is empty. */
    templateNameMissing: () => string;
    /** Its popover's commit. */
    saveTemplate: () => string;
    /** The name it offers — `Overview template`. */
    templateNameFor: (p: { page: string }) => string;
    /** Why it is disabled while a template is open. */
    templateOpen: () => string;
    /** The publish preview's bar — `● Preview`. */
    preview: () => string;
    /** The device strip's accessible name. */
    devices: () => string;
    /** The device the page is drawn for. */
    device: (p: { device: "desktop" | "tablet" | "mobile" }) => string;
    /** The Env pill's label, before the environment's name. */
    env: () => string;
    /** Back to the builder. */
    exit: () => string;
    /** The aside's head while there is something to publish. */
    readyToPublish: () => string;
    /** The aside's head while the page is live as it stands. */
    upToDate: () => string;
    /** The aside's head while a template is open. */
    templateNotPublished: () => string;
    /** A version — `v4`. */
    version: (p: { version: string }) => string;
    /** After the live version in the aside's head — `v4 live`. */
    liveVersion: () => string;
    /** After a template's name in the aside's head. */
    templateKind: () => string;
    /** The change list's head — `3 changes since v3`. */
    changesSince: (p: { n: number; count: string; version: string }) => string;
    /** The change list's head on a first publish — `3 changes · first version`. */
    changesFirst: (p: { n: number; count: string }) => string;
    /** The change list's head while nothing changed — `No changes since v4`. */
    noChangesSince: (p: { version: string }) => string;
    /** A change's verb, before the placement's name — `Added`, `Resized`. */
    changeVerb: (p: { change: "added" | "removed" | "moved" | "resized" | "height" | "aligned" | "retitled" }) => string;
    /** The banner while every placed component's code is as it went live. */
    logicUnchanged: () => string;
    /** The banner naming the components whose code changed since the live version, by name, in the order they are placed. */
    logicChangedIn: (p: { version: string; components: readonly string[] }) => string;
    /** The Audience row's label. */
    audience: () => string;
    /** The Rollout row's label. */
    rollout: () => string;
    /** The footer's Apply. */
    saveAsDraft: () => string;
    /** The footer's publish — `Publish v4 to Staging`; with no environment, `Publish v4`; for a template, `Publish`. */
    publishTo: (p: { version?: string | undefined; env?: string | undefined }) => string;
}

/** The Studio's English messages — the default table. */
export const studioMessages: StudioMessages = {
    selectedComponent: () => "Selected component",
    logicChanged: () => "logic changed since this page went live",
    data: () => "Data",
    readsNothing: () => "reads no data",
    configuration: () => "Configuration",
    fixedByDeveloper: () => "fixed by developer",
    noDescription: () => "No description",
    layout: () => "Layout",
    columnSpan: () => "Column span",
    spanOf: ({ span }) => `${span} / 12`,
    decreaseSpan: () => "Decrease span",
    increaseSpan: () => "Increase span",
    row: () => "Row",
    height: () => "Height",
    auto: () => "Auto",
    px: ({ px }) => `${px} px`,
    align: () => "Align",
    alignTop: () => "Top",
    alignCenter: () => "Center",
    alignStretch: () => "Stretch",
    published: () => "Published component · logic immutable",
    nothingSelected: () => "Nothing selected",
    nothingSelectedHint: () => "Click a component on the grid to see what it reads and its layout.",
    searchLibrary: ({ pages, templates, np, nt }) =>
        `Search ${pages} ${np === 1 ? "page" : "pages"} and ${templates} ${nt === 1 ? "template" : "templates"}…`,
    searchLabel: () => "Search pages and templates",
    clearSearch: () => "Clear search",
    sortByName: () => "Sort · Name",
    nameAz: () => "Name A–Z",
    nameZa: () => "Name Z–A",
    newPageIn: ({ project }) => `New page in ${project}`,
    newPage: () => "New page",
    projects: () => "Projects",
    pages: () => "Pages",
    live: () => "Live",
    draft: () => "Draft",
    templates: () => "Templates",
    cloneToStart: () => "clone to start a page",
    pagesIn: ({ shown, total, project, narrowed }) => (narrowed ? `${shown} of ${total} in ${project}` : `${total} in ${project}`),
    pageName: () => "Page name",
    pageNameMissing: () => "Give the page a name to create it.",
    template: () => "Template",
    blankGrid: () => "Blank grid",
    createPage: () => "Create page",
    cancel: () => "Cancel",
    nameTaken: ({ name }) => `${name} is already a page or a template here.`,
    saveAsTemplate: () => "Save as template",
    templateName: () => "Template name",
    templateNameMissing: () => "Give the template a name to save it.",
    saveTemplate: () => "Save template",
    templateNameFor: ({ page }) => `${page} template`,
    templateOpen: () => "A template is open — open a page to save it as a template",
    preview: () => "Preview",
    devices: () => "Device",
    device: ({ device }) => (device === "desktop" ? "Desktop" : device === "tablet" ? "Tablet" : "Mobile"),
    env: () => "Env",
    exit: () => "Exit",
    readyToPublish: () => "Ready to publish",
    upToDate: () => "Up to date",
    templateNotPublished: () => "Templates are not published",
    version: ({ version }) => `v${version}`,
    liveVersion: () => "live",
    templateKind: () => "template",
    changesSince: ({ n, count, version }) => `${count} ${n === 1 ? "change" : "changes"} since ${version}`,
    changesFirst: ({ n, count }) => `${count} ${n === 1 ? "change" : "changes"} · first version`,
    noChangesSince: ({ version }) => `No changes since ${version}`,
    changeVerb: ({ change }) => {
        switch (change) {
            case "added": return "Added";
            case "removed": return "Removed";
            case "moved": return "Moved";
            case "resized": case "height": return "Resized";
            case "aligned": return "Aligned";
            case "retitled": return "Retitled";
        }
    },
    logicUnchanged: () => "Component logic unchanged — only layout changed. Safe to publish.",
    logicChangedIn: ({ version, components }) => {
        const names = components.length < 2 ? components.join("") : `${components.slice(0, -1).join(", ")} and ${components.at(-1)}`;
        const its = components.length === 1 ? "its" : "their";
        return `Logic changed since ${version} in ${names} — ${its} placements publish with ${its} new code`;
    },
    audience: () => "Audience",
    rollout: () => "Rollout",
    saveAsDraft: () => "Save as draft",
    publishTo: ({ version, env }) => (version === undefined ? "Publish" : env === undefined ? `Publish ${version}` : `Publish ${version} to ${env}`),
};

const StudioMessagesContext = createContext<StudioMessages>(studioMessages);

/**
 * The message table in effect — {@link studioMessages} with every
 * {@link StudioMessagesProvider} above overriding it.
 *
 * @returns The table
 */
export function useStudioMessages(): StudioMessages {
    return useContext(StudioMessagesContext);
}

/** Props of {@link StudioMessagesProvider}. */
export interface StudioMessagesProviderProps {
    /** The messages to override — any subset; the rest come from the table above. */
    messages: Partial<StudioMessages>;
    /** The subtree the overrides apply to. */
    children?: ReactNode;
}

/**
 * Override the Studio's words for a subtree — a translation, or a house style.
 * Providers nest: each overrides the table the one above it resolved.
 *
 * @remarks
 * The overrides are read by identity: define them once (module scope, or a
 * memo), as below.
 *
 * @param props - The overrides and the subtree
 * @returns The provider
 *
 * @example
 * ```tsx
 * const GERMAN: Partial<StudioMessages> = {
 *     nothingSelected: () => "Nichts ausgewählt",
 *     columnSpan: () => "Spaltenbreite",
 * };
 *
 * <I18nProvider locale="de-DE">
 *     <StudioMessagesProvider messages={GERMAN}>
 *         <EastChakraComponent value={builder} />
 *     </StudioMessagesProvider>
 * </I18nProvider>
 * ```
 */
export function StudioMessagesProvider({ messages, children }: StudioMessagesProviderProps) {
    const parent = useStudioMessages();
    const value = useMemo(() => ({ ...parent, ...messages }), [parent, messages]);
    return createElement(StudioMessagesContext.Provider, { value }, children);
}
