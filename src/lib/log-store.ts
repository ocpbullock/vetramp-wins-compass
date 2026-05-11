import { create } from "zustand";

export type LogLevel = "info" | "success" | "error";
export type LogEntry = { ts: string; level: LogLevel; message: string };

type State = {
  logs: LogEntry[];
  log: (level: LogLevel, message: string) => void;
  clear: () => void;
};

export const useLogStore = create<State>((set) => ({
  logs: [],
  log: (level, message) =>
    set((s) => ({
      logs: [
        ...s.logs.slice(-499),
        { ts: new Date().toISOString(), level, message },
      ],
    })),
  clear: () => set({ logs: [] }),
}));
