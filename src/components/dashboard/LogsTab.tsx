import { useLogStore } from "@/lib/log-store";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export function LogsTab() {
  const { logs, clear } = useLogStore();
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <div className="text-xs text-muted-foreground">{logs.length} entries</div>
        <Button variant="outline" size="sm" onClick={clear}><Trash2 className="w-3 h-3 mr-1" /> Clear</Button>
      </div>
      <div className="bg-zinc-950 text-zinc-100 rounded-md p-3 font-mono text-xs h-[500px] overflow-y-auto">
        {logs.length === 0 && <div className="text-zinc-500">No log entries yet.</div>}
        {logs.map((l, i) => (
          <div
            key={i}
            className={
              l.level === "error" ? "text-red-400" :
              l.level === "success" ? "text-emerald-400" :
              "text-zinc-400"
            }
          >
            <span className="text-zinc-600">[{l.ts.slice(11, 19)}]</span> {l.message}
          </div>
        ))}
      </div>
    </div>
  );
}
