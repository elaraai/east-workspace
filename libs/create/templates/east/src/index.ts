import { East, StringType } from "@elaraai/east";

export const greet = East.function(
  [StringType],
  StringType,
  ($, name) => East.str`Hello, ${name}!`,
);
