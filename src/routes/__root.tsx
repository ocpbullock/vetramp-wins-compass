import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Federal Contracts Dashboard — VetRamp" },
      { name: "description", content: "Active solicitations, historical awards, and AI proposal drafts for VetRamp." },
      { property: "og:title", content: "Federal Contracts Dashboard — VetRamp" },
      { name: "twitter:title", content: "Federal Contracts Dashboard — VetRamp" },
      { property: "og:description", content: "Active solicitations, historical awards, and AI proposal drafts for VetRamp." },
      { name: "twitter:description", content: "Active solicitations, historical awards, and AI proposal drafts for VetRamp." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2ef35e68-c86e-4248-b5b7-e09c8198b739/id-preview-0e1b79f0--bafe3a4b-f889-4ccf-8587-5e092cb4ed6c.lovable.app-1778541228107.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2ef35e68-c86e-4248-b5b7-e09c8198b739/id-preview-0e1b79f0--bafe3a4b-f889-4ccf-8587-5e092cb4ed6c.lovable.app-1778541228107.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
