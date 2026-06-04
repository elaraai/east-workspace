/**
 * Scratch IR-identity check for the migrated `button.examples.tsx`.
 *
 * Each example's JSX-tag build must produce IR identical to the equivalent
 * flat-factory call (the canonical new-API form). This catches translation
 * mistakes — a dropped or mistyped prop — that tsc alone would not (both are
 * valid props). Run with node after `make build`; prints OK/FAIL per example.
 */

import { inspect } from "node:util";
import { Button, Stack, Text } from "@elaraai/east-ui";
import { Button as B, Text as T, HStack as HS } from "@elaraai/east-ui/jsx";

const eq = (jsx: unknown, factory: unknown, name: string) => {
    const ok = inspect(jsx, { depth: null }) === inspect(factory, { depth: null });
    console.log((ok ? "OK   " : "FAIL ") + name);
    if (!ok) process.exitCode = 1;
};

// buttonBasic
eq(B({ children: "Click me" }), Button.Root("Click me"), "buttonBasic");

// buttonSolidVariant
eq(
    B({ variant: "solid", colorPalette: "blue", size: "md", children: "Save Changes" }),
    Button.Root("Save Changes", { variant: "solid", colorPalette: "blue", size: "md" }),
    "buttonSolidVariant",
);

// buttonDangerOutline
eq(
    HS({ gap: "2", children: [
        B({ variant: "solid", colorPalette: "red", children: "Delete" }),
        B({ variant: "outline", colorPalette: "gray", children: "Cancel" }),
        B({ variant: "ghost", size: "sm", children: "More" }),
    ] }),
    Stack.HStack([
        Button.Root("Delete", { variant: "solid", colorPalette: "red" }),
        Button.Root("Cancel", { variant: "outline", colorPalette: "gray" }),
        Button.Root("More", { variant: "ghost", size: "sm" }),
    ], { gap: "2" }),
    "buttonDangerOutline",
);

// buttonWithIcons
eq(
    B({ startIcon: { prefix: "fas", name: "save" }, endIcon: { prefix: "fas", name: "arrow-right" }, variant: "solid", colorPalette: "blue", children: "Save" }),
    Button.Root("Save", { startIcon: { prefix: "fas", name: "save" }, endIcon: { prefix: "fas", name: "arrow-right" }, variant: "solid", colorPalette: "blue" }),
    "buttonWithIcons",
);

// buttonLoading
eq(
    B({ loading: true, loadingText: "Submitting…", loadingIcon: { prefix: "fas", name: "spinner" }, variant: "solid", colorPalette: "blue", children: "Submit" }),
    Button.Root("Submit", { loading: true, loadingText: "Submitting…", loadingIcon: { prefix: "fas", name: "spinner" }, variant: "solid", colorPalette: "blue" }),
    "buttonLoading",
);

// buttonRichLabel
eq(
    B({ variant: "solid", colorPalette: "green", children: HS({ gap: "1", align: "center", children: [
        T({ children: "Accept" }),
        T({ color: "whiteAlpha.700", children: "→ log to MES" }),
    ] }) }),
    Button.Root(
        Stack.HStack([Text.Root("Accept"), Text.Root("→ log to MES", { color: "whiteAlpha.700" })], { gap: "1", align: "center" }),
        { variant: "solid", colorPalette: "green" },
    ),
    "buttonRichLabel",
);

// buttonGhost
eq(
    B({ variant: "ghost", color: "#3d5cff", hoverBackground: "#eef2ff", children: "View details" }),
    Button.Root("View details", { variant: "ghost", color: "#3d5cff", hoverBackground: "#eef2ff" }),
    "buttonGhost",
);

// buttonPlain
eq(
    B({ variant: "plain", colorPalette: "blue", children: "Learn more" }),
    Button.Root("Learn more", { variant: "plain", colorPalette: "blue" }),
    "buttonPlain",
);

// buttonBrandedColours
eq(
    B({ startIcon: { prefix: "fas", name: "rocket" }, color: "#ffffff", background: "#1a2234", borderColor: "#3d5cff", hoverBackground: "#25345a", children: "Deploy" }),
    Button.Root("Deploy", { startIcon: { prefix: "fas", name: "rocket" }, color: "#ffffff", background: "#1a2234", borderColor: "#3d5cff", hoverBackground: "#25345a" }),
    "buttonBrandedColours",
);
