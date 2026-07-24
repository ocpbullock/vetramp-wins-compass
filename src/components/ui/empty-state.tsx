import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
  variant = "card",
}: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
  variant?: "card" | "bare";
}) {
  const body = (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-10 px-6 text-center", className)}>
      {icon ? (
        <div className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
  if (variant === "bare") return body;
  return <Card className="border-dashed">{body}</Card>;
}
