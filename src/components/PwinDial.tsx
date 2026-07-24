import { colorFor } from "@/lib/pwin";

type Size = "sm" | "md";

/**
 * Shared semicircular pWin gauge. Uses colorFor() thresholds mapped to
 * semantic tokens (success / warning / destructive). Presentation only —
 * does not compute or transform the score.
 */
export function PwinDial({
  value,
  size = "md",
  label,
  className = "",
}: {
  value: number | null | undefined;
  size?: Size;
  label?: string;
  className?: string;
}) {
  const v = value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, Math.round(value)));
  const tone = v == null ? "muted" : colorFor(v);
  const stroke =
    tone === "green" ? "var(--success)"
    : tone === "amber" ? "var(--warning)"
    : tone === "red" ? "var(--destructive)"
    : "var(--muted-foreground)";

  const dims = size === "sm"
    ? { w: 84, h: 50, r: 34, sw: 8, num: "text-lg", cap: "text-[9px]" }
    : { w: 140, h: 82, r: 58, sw: 12, num: "text-2xl", cap: "text-[10px]" };
  const cx = dims.w / 2;
  const cy = dims.h - dims.sw / 2 - 2;
  const path = `M ${cx - dims.r} ${cy} A ${dims.r} ${dims.r} 0 0 1 ${cx + dims.r} ${cy}`;

  return (
    <div
      className={`inline-flex flex-col items-center justify-end ${className}`}
      role="img"
      aria-label={`pWin ${v ?? "unknown"}`}
    >
      <svg
        width={dims.w}
        height={dims.h}
        viewBox={`0 0 ${dims.w} ${dims.h}`}
        className="overflow-visible"
      >
        <path
          d={path}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={dims.sw}
          strokeLinecap="round"
        />
        {v != null && (
          <path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth={dims.sw}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${v} 100`}
            style={{ transition: "stroke-dasharray 400ms ease-out" }}
          />
        )}
        <text
          x={cx}
          y={cy - dims.sw / 2 - (size === "sm" ? 2 : 4)}
          textAnchor="middle"
          className={`${dims.num} font-bold tabular-nums fill-foreground`}
        >
          {v == null ? "—" : v}
        </text>
      </svg>
      {label && (
        <div className={`${dims.cap} uppercase tracking-wider text-muted-foreground -mt-1`}>
          {label}
        </div>
      )}
    </div>
  );
}
