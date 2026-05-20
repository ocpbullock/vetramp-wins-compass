import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      // 5-minute default: this is a collaborative tool, so teammates' edits
      // (proposals, milestones, tracked, starred) need to surface quickly.
      // Slow-moving data (company profile, contract vehicles, KB, etc.)
      // overrides this at the call site.
      queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: true },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
