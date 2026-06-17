import { createFileRoute, redirect } from "@tanstack/react-router";

// Temporary redirect: the old home dashboard now lives at /discover while we
// build the new Capture Workspace home. This keeps existing links working.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/discover" });
  },
  component: () => null,
});
