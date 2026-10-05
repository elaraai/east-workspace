/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A host draws an input preview's controls in its own header (#1209): `bare`
 * drops the band naming the input, and `toolbar`, `search`, `onSearchChange`
 * and the host's handle reach the value's preview, each change alone.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, renderHook, cleanup, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "@elaraai/east-ui-components";
import { InputPreview, type InputPreviewProps } from "./InputPreview.js";
import type { DatasetPreviewProps } from "./DatasetPreview.js";
import { usePreviewControls, type PreviewControls } from "./preview-controls.js";

/** What the value's preview was last given, and how often it rendered. */
const seen = vi.hoisted(() => ({ value: undefined as DatasetPreviewProps | undefined, renders: 0 }));
vi.mock("./DatasetPreview.js", () => ({
    DatasetPreview: (props: DatasetPreviewProps) => {
        seen.value = props;
        seen.renders++;
        return <div>the value</div>;
    },
}));

afterEach(() => {
    cleanup();
    seen.value = undefined;
    seen.renders = 0;
});

/** A handle, as a host makes one. */
function makeControls(): PreviewControls {
    return renderHook(() => usePreviewControls()).result.current;
}

function renderInput(props: Partial<InputPreviewProps>) {
    const tree = (more: Partial<InputPreviewProps>) => (
        <ChakraProvider value={system}>
            <InputPreview apiUrl="http://e3.test" repo="default" workspace="w" path=".inputs.threshold" {...more} />
        </ChakraProvider>
    );
    const view = render(tree(props));
    return { rerenderWith: (more: Partial<InputPreviewProps>) => view.rerender(tree(more)) };
}

describe("InputPreview (#1209)", () => {
    test("names the input in a band, unless bare", () => {
        const { rerenderWith } = renderInput({});
        expect(screen.getByText("threshold")).toBeTruthy();
        rerenderWith({ bare: true });
        expect(screen.queryByText("threshold")).toBe(null);
        expect(screen.getByText("the value")).toBeTruthy();
    });

    test("passes the host's controls to the value's preview, which stays editable, each change alone reaching it", () => {
        const first: Partial<InputPreviewProps> = { toolbar: false, search: "k01", onSearchChange: vi.fn(), controls: makeControls() };
        const { rerenderWith } = renderInput(first);
        expect([seen.value?.editable, seen.value?.toolbar, seen.value?.search]).toEqual([true, false, "k01"]);
        expect(seen.value?.onSearchChange).toBe(first.onSearchChange);
        expect(seen.value?.controls).toBe(first.controls);

        const next = { ...first, search: "k02" };
        rerenderWith(next);
        expect(seen.value?.search).toBe("k02");
        next.toolbar = true;
        rerenderWith({ ...next });
        expect(seen.value?.toolbar).toBe(true);
        next.onSearchChange = vi.fn();
        rerenderWith({ ...next });
        expect(seen.value?.onSearchChange).toBe(next.onSearchChange);
        next.controls = makeControls();
        rerenderWith({ ...next });
        expect(seen.value?.controls).toBe(next.controls);
    });

    test("a rotated token, or another fetch, reaches the value's preview, as TaskPreview's does", () => {
        const { rerenderWith } = renderInput({ requestOptions: { token: "first" } });
        expect(seen.value?.requestOptions?.token).toBe("first");
        rerenderWith({ requestOptions: { token: "second" } });
        expect(seen.value?.requestOptions?.token).toBe("second");
        // The same props again render nothing new.
        const renders = seen.renders;
        rerenderWith({ requestOptions: { token: "second" } });
        expect(seen.renders).toBe(renders);
        const fetch = vi.fn() as unknown as typeof globalThis.fetch;
        rerenderWith({ requestOptions: { token: "second", fetch } });
        expect(seen.value?.requestOptions?.fetch).toBe(fetch);
    });

    test("another server or repository reaches the value's preview", () => {
        const { rerenderWith } = renderInput({});
        rerenderWith({ apiUrl: "http://other.test" });
        expect(seen.value?.apiUrl).toBe("http://other.test");
        rerenderWith({ apiUrl: "http://other.test", repo: "other" });
        expect(seen.value?.repo).toBe("other");
    });
});
