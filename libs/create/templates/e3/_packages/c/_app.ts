import e3 from "@elaraai/e3";
import { East, ArrayType, FloatType } from "@elaraai/east";

// A C tool captured via `environment: { tools }`. Unlike python/node packages,
// e3 does NOT auto-derive a tools environment — you attach the prebuilt binary
// explicitly, and rebuilding it changes the env hash so only this task re-runs.
// Build it first: `make -C packages/native/__PACKAGE_NAME__`.
//
// This example passes a value through the tool unchanged (the scaffold binary is
// a passthrough). Replace src/__PACKAGE_NAME__.c with real native logic — embed
// east-c to decode / compute / encode the BEAST2 dataset files.
const __PACKAGE_IDENT___values = e3.input("__PACKAGE_IDENT___values", ArrayType(FloatType), [1.0, 2.0, 3.0]);

export const __PACKAGE_IDENT___task = e3.customTask(
  "__PACKAGE_IDENT___tool",
  [__PACKAGE_IDENT___values],
  ArrayType(FloatType),
  (_$, inputs, output) => East.str`__PACKAGE_NAME__ ${inputs.get(0n)} ${output}`,
  {
    environment: { tools: { files: ["packages/native/__PACKAGE_NAME__/build/__PACKAGE_NAME__"] } },
  },
);
