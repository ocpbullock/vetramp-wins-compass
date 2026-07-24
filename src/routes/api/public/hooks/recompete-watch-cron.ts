// Cron wrapper for recompete-watch batch mode.
// pg_cron POSTs here daily with the shared secret header (stored in Supabase Vault).
// We verify the header and then invoke the recompete-watch edge function with the
// service-role bearer (available server-side) and { scanAll: true }.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/recompete-watch-cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? "";
        if (!provided) {
          return new Response("Missing cron secret", { status: 401 });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // Read the shared secret from Vault.
        const { data: secretRow, error: secretErr } = await supabaseAdmin
          .schema("vault" as never)
          .from("decrypted_secrets" as never)
          .select("decrypted_secret")
          .eq("name", "recompete_watch_cron_secret")
          .maybeSingle();

        if (secretErr || !secretRow) {
          console.error("[recompete-watch-cron] vault read failed", secretErr);
          return new Response("Cron secret not configured", { status: 500 });
        }
        const expected = (secretRow as { decrypted_secret: string })
          .decrypted_secret;

        // Constant-time-ish compare.
        if (
          provided.length !== expected.length ||
          !provided.split("").every((c, i) => c === expected[i])
        ) {
          return new Response("Invalid cron secret", { status: 401 });
        }

        const supabaseUrl = process.env.SUPABASE_URL!;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        if (!supabaseUrl || !serviceKey) {
          return new Response("Server not configured", { status: 500 });
        }

        const res = await fetch(`${supabaseUrl}/functions/v1/recompete-watch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
          body: JSON.stringify({ scanAll: true }),
        });

        const text = await res.text();
        return new Response(text, {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
