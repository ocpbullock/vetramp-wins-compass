import { Button } from "@/components/ui/button";

export function NaicsFilterChips({
  searched,
  active,
  onChange,
}: {
  searched: string[];
  active: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  if (!searched || searched.length === 0) return null;

  function toggle(code: string) {
    const next = new Set(active);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground mr-1">NAICS:</span>
      {searched.map((code) => {
        const on = active.has(code);
        return (
          <button
            key={code}
            onClick={() => toggle(code)}
            className={`font-mono text-xs px-2 py-1 rounded border transition-colors ${
              on
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-border hover:bg-accent"
            }`}
            title={on ? "Click to hide" : "Click to show"}
          >
            {code}
          </button>
        );
      })}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={() => onChange(new Set(searched))}
      >
        All
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={() => onChange(new Set())}
      >
        None
      </Button>
    </div>
  );
}
