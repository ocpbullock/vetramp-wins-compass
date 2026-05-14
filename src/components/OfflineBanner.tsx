import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="sticky top-0 z-50 w-full border-b border-amber-300 bg-amber-100 dark:bg-amber-900/40 dark:border-amber-700">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-sm text-amber-900 dark:text-amber-100">
        <WifiOff className="h-4 w-4" />
        <span>You're offline. Changes will not be saved until you reconnect.</span>
      </div>
    </div>
  );
}
