/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, StringType, variant, example } from "@elaraai/east";
import {
    Button,
    Clipboard,
    Download,
    Reactive,
    Share,
    Stack,
    State,
    Text,
    UIComponentType,
} from "@elaraai/east-ui";

export const clipboardCopyButton = example({
    keywords: ["Clipboard", "copy", "Button", "onClick"],
    description: "Button that copies a fixed string to the clipboard",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onClick = $.const(East.function([], NullType, ($) => {
                $(Clipboard.copy("https://app.example.com/scenarios/s1"));
            }));
            return Button.Root("Copy link", { onClick });
        }));
    }),
    inputs: [],
});

export const clipboardCopyReactive = example({
    keywords: ["Clipboard", "copy", "Reactive", "State"],
    description: "Copy the current value of a State-bound key to the clipboard",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([StringType], "share.url", "https://example.com"));
            const url = $.let(bind.read());
            const onClick = $.const(East.function([], NullType, ($) => {
                const current = $.let(bind.read());
                $(Clipboard.copy(current));
            }));
            return Stack.VStack([
                Text.Root(East.str`URL: ${url}`),
                Button.Root("Copy", { onClick }),
            ], { gap: "2", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const downloadCsvButton = example({
    keywords: ["Download", "csv", "Button", "onClick"],
    description: "Button that downloads a 2-column CSV with two body rows",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onClick = $.const(East.function([], NullType, ($) => {
                $(Download.csv(East.value({
                    filename: "scenarios.csv",
                    headers: ["id", "name"],
                    rows: [
                        ["s1", "baseline"],
                        ["s2", "optimised"],
                    ],
                }, Download.Types.CsvInput)));
            }));
            return Button.Root("Download CSV", { onClick });
        }));
    }),
    inputs: [],
});

export const downloadBlobButton = example({
    keywords: ["Download", "blob", "Button", "binary"],
    description: "Button that downloads a small binary payload",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onClick = $.const(East.function([], NullType, ($) => {
                $(Download.blob(East.value({
                    filename: "preview.bin",
                    mimeType: "application/octet-stream",
                    data: new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]),
                }, Download.Types.BlobInput)));
            }));
            return Button.Root("Download bytes", { onClick });
        }));
    }),
    inputs: [],
});

export const shareLinkButton = example({
    keywords: ["Share", "link", "Button", "navigator.share"],
    description: "Button that opens the OS share sheet for a URL",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onClick = $.const(East.function([], NullType, ($) => {
                $(Share.link(East.value({
                    url: "https://app.example.com/scenarios/s1",
                    title: variant("some", "Scenario S1"),
                    text: variant("some", "Pricing scenario from Q2 2026"),
                }, Share.Types.LinkInput)));
            }));
            return Button.Root("Share", { onClick });
        }));
    }),
    inputs: [],
});
