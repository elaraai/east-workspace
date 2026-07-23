/**
 * Inline mono key/value pair (HORIZON **14 d**). The standard way to surface a
 * single named fact in headers, rails, and captions.
 */
export interface TagProps {
  /** Uppercase mono key, e.g. "horizon". */
  k: React.ReactNode;
  /** The value; numerals render tabular. */
  v: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Tag(props: TagProps): JSX.Element;
