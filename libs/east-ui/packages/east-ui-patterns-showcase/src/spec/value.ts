import type {
  ArrayType,
  BlobType,
  BooleanType,
  DateTimeType,
  DictType,
  FloatType,
  IntegerType,
  NullType,
  SetType,
  StringType,
  StructType,
  VariantType,
} from '@elaraai/east'
import type { variant } from '@elaraai/east'

/**
 * ValueOf — TypeScript value shape of an East type. Lets us derive the React
 * prop / fixture / runtime-data type directly from the East type definition,
 * keeping the slot spec and the rendered component in lock-step.
 *
 * Mirrors the JS-value branches of `SubtypeExprOrValue` from @elaraai/east,
 * minus the `Expr<...>` alternatives — patterns here render values, never
 * expressions.
 */
export type ValueOf<T> =
  T extends NullType ? null :
  T extends BooleanType ? boolean :
  T extends IntegerType ? bigint :
  T extends FloatType ? number :
  T extends StringType ? string :
  T extends DateTimeType ? Date :
  T extends BlobType ? Uint8Array :
  T extends ArrayType<infer V> ? ValueOf<V>[] :
  T extends SetType<infer K> ? Set<ValueOf<K>> :
  T extends DictType<infer K, infer V> ? Map<ValueOf<K>, ValueOf<V>> :
  T extends StructType<infer Fields> ? { [K in keyof Fields]: ValueOf<Fields[K]> } :
  T extends VariantType<infer Cases> ? { [K in keyof Cases]: variant<K, ValueOf<Cases[K]>> }[keyof Cases] :
  unknown
