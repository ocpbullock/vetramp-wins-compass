import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "default" | "success" | "warning" | "destructive" | "brass" | "money";

const TONE_TEXT: Record<Tone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  brass: "text-[color:var(--brand-brass)]",
  money: "text-money",
};

/**
 * Shared briefing-style metric block. Title in briefing-label, big tabular
 * number, optional sub-line, optional icon, optional custom visual (e.g. a
 * PwinDial in place of the number).
 */
export function MetricCard({
  label,
  value,
  sub,
  tone = "default",
  icon: Icon,
  visual,
  onClick,
  className = "",
  cardClassName = "",
}: {
  label: string;
  value?: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  visual?: ReactNode;
  onClick?: () => void;
  className?: string;
  cardClassName?: string;
}) {
  const content = (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0 flex-1">
        <div className="briefing-label">{label}</div>
        {visual ? (
          <div className="mt-1">{visual}</div>
        ) : (
          <div className={`text-[22px] leading-tight md:text-2xl font-bold tabular-nums mt-1 ${TONE_TEXT[tone]}`}>
            {value ?? "—"}
          </div>
        )}
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </div>
      {Icon && <Icon className={`w-5 h-5 shrink-0 ${TONE_TEXT[tone]}`} />}
    </div>
  );

  return (
    <Card
      onClick={onClick}
      className={`${onClick ? "cursor-pointer hover:shadow-md transition-shadow" : ""} ${cardClassName}`}
    >
      <CardContent className="p-4">{content}</CardContent>
    </Card>
  );
}
