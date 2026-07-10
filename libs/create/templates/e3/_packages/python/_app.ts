import e3 from "@elaraai/e3";
import { East, ArrayType, FloatType } from "@elaraai/east";

// TS-East mirror of `packages/python/__PACKAGE_NAME__`'s @platform_function —
// same dotted "__PACKAGE_NAME__.example" name, same signature. Keep this in
// lockstep with packages/python/__PACKAGE_NAME__/src/__PACKAGE_NAME__/example.py.
const example = East.platform("__PACKAGE_NAME__.example", [ArrayType(FloatType)], FloatType);

const values = e3.input("__PACKAGE_IDENT___values", ArrayType(FloatType), [1.0, 2.0, 3.0]);

// No `environment` needed: e3 derives it from the `{ custom: "__PACKAGE_NAME__" }`
// platform reference below — at export it captures packages/python/__PACKAGE_NAME__'s
// dependency closure into the bundle. Editing anything under that package re-runs
// only this task; sibling packages stay cached. (To override — e.g. pin a
// container image, or add prebuilt `tools` binaries — add an explicit
// `environment:` here.)
export const __PACKAGE_IDENT___task = e3.task(
  "__PACKAGE_IDENT___example",
  [values],
  East.function([ArrayType(FloatType)], FloatType, ($, v) => {
    $.return(example(v));
  }),
  {
    runner: { runtime: "east-py", platforms: [{ custom: "__PACKAGE_NAME__" }, "east-py-std"] },
  },
);
