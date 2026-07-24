import { cn } from "@/lib/utils";

/**
 * Neutral pulsing block for loading placeholders. Uses --muted so it
 * respects both light and dark themes. Composable with `skeleton-card`,
 * `skeleton-line`, and `skeleton-navy` utilities for section-specific
 * shapes that match the real chrome they stand in for.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted/70 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
