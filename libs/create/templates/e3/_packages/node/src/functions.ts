import { East, ArrayType, FloatType } from "@elaraai/east";

// An East function owned by @__PROJECT_NAME__/__PACKAGE_NAME__ — East all the way down.
//
// platform.ts is the other way across the package boundary: a platform function
// wraps NATIVE Node code East cannot express, and the task calling it runs on
// east-node with this package installed. An East function is built here with
// `East.function`, so it IS East IR: the app refers to it by package, name and
// type (East.importFunction("@__PROJECT_NAME__/__PACKAGE_NAME__", "scale", …) in
// src/packages/__PACKAGE_NAME__.ts), and at export e3 finds this package in the
// npm workspace, exports every function in `eastFunctions` from the BUILT
// `./functions` entry (east-node export-functions on dist/functions.js — build
// first) and embeds the IR in the task. The deployed program is pure IR and runs
// on any runner, with nothing installed where it runs.
//
// To add a function: build it here and add it to `eastFunctions` under the name
// the app imports. The app declares the same FunctionType — the two must be
// equal exactly, and e3 checks that at export.

// Scale every value by a factor. The parameters are East expressions and `.map`
// builds East IR — nothing here runs in Node.
export const scale = East.function(
  [ArrayType(FloatType), FloatType],
  ArrayType(FloatType),
  ($, values, factor) => values.map(($, v) => v.multiply(factor)),
);

// The East functions this package exports, by the name the app imports them under.
export const eastFunctions = { scale };
