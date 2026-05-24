import { East, IntegerType, ArrayType, FloatType } from "@elaraai/east";

export const f = East.function([], IntegerType, ($) => {
  const a = $.let([] as number[], ArrayType(FloatType));
  East.value(5n);
  const t = East.IntegerType;
  return a.size();
});
