export type StoplightRating = "strong" | "moderate" | "weak" | "unknown";
type Size = "sm" | "md" | "lg";

const TONE: Record<StoplightRating, { bg: string; label: string }> = {
  strong:   { bg: "bg-success",           label: "Strong" },
  moderate: { bg: "bg-warning",           label: "Moderate" },
  weak:     { bg: "bg-destructive",       label: "Weak" },
  unknown:  { bg: "bg-muted-foreground/40", label: "Unknown" },
};

const SIZES: Record<Size, string> = {
  sm: "w-2.5 h-2.5",
  md: "w-3 h-3",
  lg: "w-8 h-8",
};

/**
 * Shared rating dot used across the app (Positioning Matrix, ratings, etc).
 * Rating → semantic token. In dark mode a subtle ring boosts contrast.
 */
export function StoplightDot({
  rating,
  size = "md",
  className = "",
  ariaLabel,
}: {
  rating: StoplightRating;
  size?: Size;
  className?: string;
  ariaLabel?: string;
}) {
  const t = TONE[rating];
  return (
    <span
      role="img"
      aria-label={ariaLabel ?? `${t.label} rating`}
      title={ariaLabel ?? t.label}
      className={`inline-block rounded-full ring-1 ring-inset ring-border/50 dark:ring-white/10 ${SIZES[size]} ${t.bg} ${className}`}
    />
  );
}

export const STOPLIGHT_LABEL = Object.fromEntries(
  (Object.keys(TONE) as StoplightRating[]).map((k) => [k, TONE[k].label]),
) as Record<StoplightRating, string>;
