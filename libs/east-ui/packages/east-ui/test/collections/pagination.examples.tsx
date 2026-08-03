/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Pagination, Reactive } from "@elaraai/east-ui";

export const paginationBasic = example({
    keywords: ["Pagination", "Root", "page", "basic", "Reactive", "State"],
    description: "Default pagination at page 0 of 25 (pageSize 20 of 500 total)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pageBind = $.let(State.bind([IntegerType], "pagination_basic_page", 0n));
            const page = $.let(pageBind.read());
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));
            return <Pagination page={page} pageSize={20n} count={500n} onPageChange={onPageChange} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const paginationOutlineLarge = example({
    keywords: ["Pagination", "Root", "variant", "outline", "size", "lg", "Reactive", "State"],
    description: "Outlined large pagination",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pageBind = $.let(State.bind([IntegerType], "pagination_outline_page", 0n));
            const page = $.let(pageBind.read());
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));
            return <Pagination page={page} pageSize={10n} count={200n} onPageChange={onPageChange} variant="outline" size="lg" />;
        }}</Reactive>
    )),
    inputs: [],
});

export const paginationSiblings = example({
    keywords: ["Pagination", "Root", "siblings", "boundaries", "Reactive", "State"],
    description: "Pagination with wider siblings range showing more page triggers",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pageBind = $.let(State.bind([IntegerType], "pagination_siblings_page", 5n));
            const page = $.let(pageBind.read());
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));
            return <Pagination page={page} pageSize={10n} count={500n} onPageChange={onPageChange} siblings={2n} boundaries={2n} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const paginationColourOverrides = example({
    keywords: ["Pagination", "Root", "color", "activeColor", "activeBackground", "Reactive", "State"],
    description: "Pagination with custom active-page colour overrides",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pageBind = $.let(State.bind([IntegerType], "pagination_colour_page", 2n));
            const page = $.let(pageBind.read());
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));
            return <Pagination page={page} pageSize={25n} count={300n} onPageChange={onPageChange} variant="subtle" activeBackground="bg.brand.subtle" activeColor="fg.inverse" />;
        }}</Reactive>
    )),
    inputs: [],
});
