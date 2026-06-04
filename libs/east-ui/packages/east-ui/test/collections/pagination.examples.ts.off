/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Pagination, Reactive, State, UIComponentType } from "@elaraai/east-ui";

export const paginationBasic = example({
    keywords: ["Pagination", "Root", "page", "basic", "Reactive", "State"],
    description: "Default pagination at page 0 of 25 (pageSize 20 of 500 total)",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const pageBind = $.let(State.bind([IntegerType], "pagination_basic_page", 0n));
            const page = $.let(pageBind.read(), IntegerType);
            const onChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));
            return Pagination.Root(page, 20n, 500n, onChange);
        }));
    }),
    inputs: [],
});

export const paginationOutlineLarge = example({
    keywords: ["Pagination", "Root", "variant", "outline", "size", "lg", "Reactive", "State"],
    description: "Outlined large pagination",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const pageBind = $.let(State.bind([IntegerType], "pagination_outline_page", 0n));
            const page = $.let(pageBind.read(), IntegerType);
            const onChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));
            return Pagination.Root(page, 10n, 200n, onChange, { variant: "outline", size: "lg" });
        }));
    }),
    inputs: [],
});

export const paginationSiblings = example({
    keywords: ["Pagination", "Root", "siblings", "boundaries", "Reactive", "State"],
    description: "Pagination with wider siblings range showing more page triggers",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const pageBind = $.let(State.bind([IntegerType], "pagination_siblings_page", 5n));
            const page = $.let(pageBind.read(), IntegerType);
            const onChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));
            return Pagination.Root(page, 10n, 500n, onChange, { siblings: 2n, boundaries: 2n });
        }));
    }),
    inputs: [],
});

export const paginationColourOverrides = example({
    keywords: ["Pagination", "Root", "color", "activeColor", "activeBackground", "Reactive", "State"],
    description: "Pagination with custom active-page colour overrides",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const pageBind = $.let(State.bind([IntegerType], "pagination_colour_page", 2n));
            const page = $.let(pageBind.read(), IntegerType);
            const onChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));
            return Pagination.Root(page, 25n, 300n, onChange, {
                variant: "subtle",
                activeBackground: "blue.500",
                activeColor: "white",
            });
        }));
    }),
    inputs: [],
});
