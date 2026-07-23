/**
 * East action button. Text-only by default; never full-width; never pill-shaped.
 * Use `commit` (mono uppercase) only for state-changing commit actions.
 * @startingPoint section="Core" subtitle="Action button — default / primary / ghost / danger / commit" viewport="700x180"
 */
export interface ButtonProps {
  /** Visual weight. One primary per surface, max. */
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'commit';
  /** Dense contexts (toolbars, table rows). */
  compact?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Button(props: ButtonProps): JSX.Element;
