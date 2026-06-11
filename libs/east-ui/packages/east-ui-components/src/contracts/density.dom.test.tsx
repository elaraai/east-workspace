/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Density-cascade tests: a display component (Tag) must size itself from
 * (1) its own `density` field, (2) an enclosing `DensityProvider`, and
 * (3) a container value (Stack) whose `density` provides the context —
 * all three must agree, and differ from the undensified standalone look.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant } from "@elaraai/east";
import { system } from "../theme/index.js";
import { DensityProvider } from "./density.js";
import { EastChakraTag, type TagValue } from "../display/tag/index.js";
import { EastChakraComponent } from "../component.js";

afterEach(cleanup);

const none = variant("none", null);

function tagValue(density?: "condensed" | "compact" | "comfortable"): TagValue {
    return {
        label: "Shiraz",
        closable: none,
        onClose: none,
        density: density ? variant("some", variant(density, null)) : none,
        style: none,
    } as TagValue;
}

function tagRootClass(container: HTMLElement): string {
    const el = container.querySelector(".elara-tag__root");
    expect(el).not.toBeNull();
    return el!.className;
}

describe("density cascade", () => {
    test("explicit density, provider density, and container density agree", () => {
        const standalone = render(
            <ChakraProvider value={system}>
                <EastChakraTag value={tagValue()} />
            </ChakraProvider>,
        );
        const explicit = render(
            <ChakraProvider value={system}>
                <EastChakraTag value={tagValue("condensed")} />
            </ChakraProvider>,
        );
        const inherited = render(
            <ChakraProvider value={system}>
                <DensityProvider value="condensed">
                    <EastChakraTag value={tagValue()} />
                </DensityProvider>
            </ChakraProvider>,
        );

        const standaloneClass = tagRootClass(standalone.container);
        const explicitClass = tagRootClass(explicit.container);
        const inheritedClass = tagRootClass(inherited.container);

        expect(explicitClass).not.toBe(standaloneClass);
        expect(inheritedClass).toBe(explicitClass);
    });

    test("a Stack value with density provides the cascade to its children", () => {
        const stackValue = variant("Stack", {
            children: [variant("Tag", tagValue())],
            density: variant("some", variant("condensed", null)),
            style: none,
        });
        const viaStack = render(
            <ChakraProvider value={system}>
                <EastChakraComponent value={stackValue as never} storageKey="t" />
            </ChakraProvider>,
        );
        const explicit = render(
            <ChakraProvider value={system}>
                <EastChakraTag value={tagValue("condensed")} />
            </ChakraProvider>,
        );

        expect(tagRootClass(viaStack.container)).toBe(tagRootClass(explicit.container));
    });
});
