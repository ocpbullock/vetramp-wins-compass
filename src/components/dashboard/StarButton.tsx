import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStarred, type StarToggleInput } from "@/lib/starred";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function StarButton({
  input,
  size = "icon-sm",
  className = "",
}: {
  input: StarToggleInput;
  size?: "icon-sm" | "icon";
  className?: string;
}) {
  const { isStarred, toggle } = useStarred();
  const on = !!input.noticeId && isStarred(input.noticeId);
  const dim = size === "icon-sm" ? "h-7 w-7" : "h-8 w-8";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`${dim} ${className}`}
          aria-pressed={on}
          aria-label={on ? "Unstar opportunity" : "Star opportunity"}
          onClick={(e) => { e.stopPropagation(); toggle(input); }}
          disabled={!input.noticeId}
        >
          <Star
            className={`w-4 h-4 transition-colors ${
              on ? "fill-amber-400 text-amber-500" : "text-muted-foreground hover:text-amber-500"
            }`}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{on ? "Unstar" : "Star"}</TooltipContent>
    </Tooltip>
  );
}
