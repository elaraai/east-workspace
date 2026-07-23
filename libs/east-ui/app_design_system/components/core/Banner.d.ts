/**
 * Inline notice band. `stale` uses the dashed-border ephemeral convention;
 * washes never exceed 8% — East banners inform, they don't shout.
 */
export interface BannerProps {
  kind?: 'guard' | 'stale' | 'partial' | 'change' | 'error';
  /** Override the default mono glyph (! ~ … △ ✕). */
  glyph?: React.ReactNode;
  /** Bold lead-in before the body text. */
  title?: React.ReactNode;
  /** Right-aligned action cluster (Buttons). */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Banner(props: BannerProps): JSX.Element;
