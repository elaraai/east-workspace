/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Plot-gutter context coverage independent of any particular collection.
 */
import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { PlotGutterProvider, usePlotGutter } from "./plot-gutter.js";

afterEach(cleanup);
function Probe({ name }: { name: string }) {
    const gutter = usePlotGutter();
    return <output data-testid={name} data-left={gutter?.left} data-right={gutter?.right} data-imposed={gutter !== undefined ? "" : undefined} />;
}
describe("plot-gutter context (#147)", () => {
    test("without a provider, the component can retain its natural gutter", () => {
        const { getByTestId } = render(<Probe name="plain" />);
        expect(getByTestId("plain").hasAttribute("data-imposed")).toBe(false);
    });
    test("the provider publishes both insets to its descendants", () => {
        const { getByTestId } = render(<PlotGutterProvider value={{ left: "120px", right: "16px" }}><Probe name="child" /></PlotGutterProvider>);
        expect(getByTestId("child").getAttribute("data-left")).toBe("120px");
        expect(getByTestId("child").getAttribute("data-right")).toBe("16px");
    });
    test("a nested provider is scoped, and changing it updates its consumers", () => {
        const tree = (left: string) => <PlotGutterProvider value={{ left: "120px", right: "16px" }}>
            <Probe name="outer" />
            <PlotGutterProvider value={{ left }}><Probe name="inner" /></PlotGutterProvider>
        </PlotGutterProvider>;
        const { getByTestId, rerender } = render(tree("80px"));
        expect(getByTestId("inner").getAttribute("data-left")).toBe("80px");
        expect(getByTestId("inner").getAttribute("data-right")).toBeNull();
        rerender(tree("96px"));
        expect(getByTestId("inner").getAttribute("data-left")).toBe("96px");
        expect(getByTestId("outer").getAttribute("data-left")).toBe("120px");
    });
});
