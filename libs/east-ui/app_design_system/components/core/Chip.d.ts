/**
 * Bordered token chip — filters, selections, small facts. `brand` = active/selected
 * (the only tinted background East allows); `dashed` = ephemeral or placeholder.
 */
export interface ChipProps {
  variant?: 'default' | 'brand' | 'dashed';
  compact?: boolean;
  /** Renders an × affordance. */
  onDismiss?: () => void;
  /** Renders a ▾ opener affordance. */
  caret?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Chip(props: ChipProps): JSX.Element;
