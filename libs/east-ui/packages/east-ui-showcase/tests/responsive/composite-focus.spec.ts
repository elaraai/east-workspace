/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A composite field owns one focus ring, on its bordered wrapper. The
 * universal :focus-visible rule must not also ring the inner editing field.
 * Measure the real cascade in Chromium, including Chakra's merged variants;
 * jsdom cannot establish this invariant. Mouse focus matters too: a text
 * input matches :focus-visible even when reached by a click.
 */
import { test, expect, type Locator, type Page } from "playwright/test";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChakraProvider, NumberInput, Combobox, TagsInput, createListCollection } from "@chakra-ui/react";
import { system } from "@elaraai/east-ui-components/testing";
import { settled } from "./settle";

async function openExample(page: Page, theme: string, hash: string): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${hash}`);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await settled(page);
    return entry;
}

async function focusField(page: Page, field: Locator, mode: "mouse" | "keyboard"): Promise<void> {
    if (mode === "mouse") {
        await field.click();
    } else {
        // Establish the starting point without clicking the field. Actual
        // Tab navigation must reach it and engage the browser's keyboard
        // modality. Remove the temporary starting point after navigation.
        await field.evaluate(el => {
            const before = document.createElement("button");
            before.setAttribute("data-focus-start", "");
            before.textContent = "Before field";
            el.before(before);
            before.focus();
        });
        await page.keyboard.press("Tab");
        await page.locator("[data-focus-start]").evaluate(el => el.remove());
    }
    await expect(field).toBeFocused();
    await expect.poll(() => field.evaluate(el => el.matches(":focus-visible"))).toBe(true);
}

/** Resolve the theme token through the browser, including its dark colour. */
async function focusShadow(field: Locator): Promise<string> {
    return field.evaluate(el => {
        const probe = document.createElement("div");
        probe.style.boxShadow = "var(--chakra-shadows-focus)";
        el.parentElement!.append(probe);
        const shadow = getComputedStyle(probe).boxShadow;
        probe.remove();
        return shadow;
    });
}

async function expectOneRing(field: Locator, wrapper: Locator): Promise<void> {
    const shadow = await focusShadow(field);
    expect(shadow).not.toBe("none");
    await expect(wrapper).toHaveCSS("box-shadow", shadow);
    await expect(field).toHaveCSS("box-shadow", "none");
    await expect(field).toHaveCSS("outline-style", "none");
}

for (const theme of ["light", "dark"]) {
    for (const mode of ["mouse", "keyboard"] as const) {
        test.describe(`composite focus · ${theme} · ${mode} @desktop`, () => {
            test("direct Chakra consumers: inherited variants and editable tags keep one ring", async ({ page }) => {
                // Native focus works on server-rendered inputs. Use the real
                // Chakra components and the built system to exercise variants
                // the East showcase does not expose, without copying CSS or
                // inferring its cascade from a jsdom render.
                const controls: ReactNode[] = [h("input", { key: "native", "aria-label": "Native field" })];
                for (const variant of ["outline", "subtle", "flushed"] as const) {
                    controls.push(
                        h("div", { key: `number-${variant}`, "data-focus-case": "number" },
                            h(NumberInput.Root, { variant }, h(NumberInput.Input))),
                        h("div", { key: `combo-${variant}`, "data-focus-case": "combo" },
                            h(Combobox.Root, { variant, collection: createListCollection<unknown>({ items: [] }) },
                                h(Combobox.Control, null, h(Combobox.Input)))),
                        h("div", { key: `tags-${variant}`, "data-focus-case": "tags" },
                            h(TagsInput.Root, { variant, defaultValue: ["NA"] },
                                h(TagsInput.Control, null,
                                    h(TagsInput.Item, { index: 0, value: "NA" },
                                        // Expose the editing part to native
                                        // focus; tag state transitions are
                                        // outside this CSS cascade check.
                                        h(TagsInput.ItemInput, { hidden: false, tabIndex: 0 })),
                                    h(TagsInput.Input)))),
                    );
                }
                await page.setContent(renderToStaticMarkup(h(ChakraProvider, { value: system, children: controls })));
                await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
                for (const control of await page.locator("[data-focus-case]").all()) {
                    const wrapper = await control.getAttribute("data-focus-case") === "number"
                        ? control.locator("[data-part=root]") : control.locator("[data-part=control]");
                    for (const field of await control.locator("input:not([type=hidden])").all()) {
                        await focusField(page, field, mode);
                        await expectOneRing(field, wrapper);
                    }
                }
                // No recipe supplies this field's ring: the universal rule
                // itself must remain intact for consumers' ordinary inputs.
                const native = page.getByRole("textbox", { name: "Native field" });
                await focusField(page, native, mode);
                const shadow = await focusShadow(native);
                expect(shadow).not.toBe("none");
                await expect(native).toHaveCSS("box-shadow", shadow);
            });

            for (const kind of ["integer", "float", "datetime"]) {
                test(`${kind}: only the wrapper rings`, async ({ page }) => {
                    const entry = await openExample(page, theme, "forms/input/inputStyles");
                    await entry.locator("[data-scope=select][data-part=trigger]").first().click();
                    await page.getByRole("option", { name: kind, exact: true }).click();
                    const fields = entry.getByRole("spinbutton");
                    await expect(fields).toHaveCount(kind === "datetime" ? 6 : 1);
                    for (const field of await fields.all()) {
                        await focusField(page, field, mode);
                        // Both date and time groups sit inside the same shell.
                        const wrapper = kind === "datetime"
                            ? field.locator("../../..")
                            : field.locator("..");
                        await expectOneRing(field, wrapper);
                        if (kind === "datetime") {
                            // The segment being edited remains distinguishable.
                            await expect(field).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
                            await expect(field).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
                        }
                    }
                });
            }

            test("tags: only the control rings", async ({ page }) => {
                const entry = await openExample(page, theme, "forms/tags-input/tagsInputSuggestions");
                const field = entry.locator("[data-scope=tags-input][data-part=input]");
                await focusField(page, field, mode);
                await expectOneRing(field, entry.locator("[data-scope=tags-input][data-part=control]"));
            });

            test("library search: only the search box rings", async ({ page }) => {
                const entry = await openExample(page, theme, "collections/library/libraryPeople");
                const field = entry.locator("input").first();
                await focusField(page, field, mode);
                await expectOneRing(field, field.locator(".."));
                if (mode === "keyboard") {
                    await field.fill("Patel");
                    const clear = field.locator("..").getByRole("button");
                    await expect(clear).toBeVisible();
                    await field.press("Tab");
                    await expect(clear).toBeFocused();
                    await expect(clear).toHaveCSS("box-shadow", await focusShadow(clear));
                }
            });

            for (const kind of ["date", "time"]) {
                test(`${kind} range: each endpoint owns one ring`, async ({ page }) => {
                    const entry = await openExample(page, theme, `forms/${kind}-range-input/${kind}RangeInputBasic`);
                    const fields = entry.getByRole("spinbutton");
                    await expect(fields).toHaveCount(6);
                    for (const field of await fields.all()) {
                        await focusField(page, field, mode);
                        await expectOneRing(field, field.locator("../../.."));
                    }
                });
            }

            test("combobox: the outline variant keeps its inner opt-out", async ({ page }) => {
                const entry = await openExample(page, theme, "forms/combobox/comboboxVariants");
                const field = entry.locator("[data-scope=combobox][data-part=input]");
                await focusField(page, field, mode);
                await expectOneRing(field, entry.locator("[data-scope=combobox][data-part=control]"));
            });

            test("a standalone text input still has its focus ring", async ({ page }) => {
                const entry = await openExample(page, theme, "forms/input/inputStyles");
                const field = entry.getByRole("textbox");
                await focusField(page, field, mode);
                const shadow = await focusShadow(field);
                expect(shadow).not.toBe("none");
                await expect(field).toHaveCSS("box-shadow", shadow);
            });
        });
    }
}
