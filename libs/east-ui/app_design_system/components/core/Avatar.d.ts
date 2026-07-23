/**
 * Initials avatar — mono initials in a circle. No photos in East surfaces.
 */
export interface AvatarProps {
  /** 1-3 characters, e.g. "JK". */
  initials: string;
  /** Diameter in px. Default 22; rosters use 24. */
  size?: number;
  /** Brand-filled form (matrix row headers). */
  filled?: boolean;
  style?: React.CSSProperties;
}
export declare function Avatar(props: AvatarProps): JSX.Element;
