import { East, IntegerType, ArrayType, FloatType, variant } from "@elaraai/east";

export const f = East.function([], IntegerType, ($) => {
  const a = $.let([] as number[], ArrayType(FloatType));
  East.value(5n);
  const v = $.const(variant("some", 1n));
  return a.size();
});
