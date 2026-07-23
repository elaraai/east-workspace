/**
 * THE status treatment: colored dot + uppercase mono word. Never a tinted
 * background badge — that pattern is banned system-wide.
 */
export interface StatusProps {
  /** Dot color/behavior. `live` and `run` pulse. */
  level?: 'ok' | 'warn' | 'error' | 'high' | 'mid' | 'low' | 'brand' | 'live' | 'run' | 'ring';
  /** The status word(s), e.g. "Committed". */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Status(props: StatusProps): JSX.Element;
