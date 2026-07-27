import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/** Persisted boolean stored in localStorage. Safe on server (initial value). */
export function usePersistedBool(key: string, initial: boolean): [boolean, (b: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch { /* ignore */ }
    return initial;
  });
  const set = (b: boolean) => {
    setValue(b);
    try { window.localStorage.setItem(key, b ? "1" : "0"); } catch { /* ignore */ }
  };
  return [value, set];
}

/**
 * Shared collapsible section with a chevron, informative one-line summary,
 * localStorage-persisted open state, and reduced-motion respect.
 */
export function CollapsibleSection({
  id, title, summary, defaultOpen = false, storageKey, children,
}: {
  /** DOM id — also used as scroll target for anchor links. */
  id: string;
  title: string;
  /** One-line state summary shown next to the title when collapsed AND when open. */
  summary: string;
  defaultOpen?: boolean;
  /** Optional explicit localStorage key. Defaults to `collapsible:${id}`. */
  storageKey?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = usePersistedBool(storageKey ?? `collapsible:${id}`, defaultOpen);
  return (
    <section id={id} className="scroll-mt-32 border-t pt-4 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 text-left group"
        aria-expanded={open}
        aria-controls={`${id}-body`}
      >
        <ChevronRight
          className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        />
        <span className="briefing-label group-hover:text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground ml-2 truncate">{summary}</span>
      </button>
      {open && (
        <div id={`${id}-body`} className="pt-3 space-y-4">
          {children}
        </div>
      )}
    </section>
  );
}
