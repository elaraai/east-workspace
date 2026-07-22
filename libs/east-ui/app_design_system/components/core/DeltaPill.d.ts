/**
 * Mono numeric change pill (▲ +4.2%). Color carries valence; background stays
 * neutral (or a 6% wash in the outlined form) — never a saturated fill.
 */
export interface DeltaPillProps {
  dir?: 'up' | 'down' | 'flat' | 'brand';
  /** Bordered form with a 6% valence wash (diff views). */
  outlined?: boolean;
  /** Hide the ▲/▼ glyph when the value already carries a sign. */
  arrow?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function DeltaPill(props: DeltaPillProps): JSX.Element;
