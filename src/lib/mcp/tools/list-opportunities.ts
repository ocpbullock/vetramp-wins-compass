import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

function userClient(token: string) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_opportunities",
  title: "List opportunities",
  description:
    "List the signed-in user's federal contracting opportunities (proposals), optionally filtered by capture stage.",
  inputSchema: {
    stage: z
      .enum(["intake", "researching", "analyzing", "pursuing", "proposal", "submitted", "won", "lost", "no_bid"])
      .optional()
      .describe("Filter to opportunities in this capture stage."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows to return (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ stage, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = userClient(ctx.getToken()!);
    let q = sb
      .from("proposals")
      .select(
        "id, opportunity_title, solicitation_number, agency, naics_code, set_aside, capture_stage, response_deadline, estimated_value, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(limit ?? 25);
    if (stage) q = q.eq("capture_stage", stage);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { opportunities: data ?? [] },
    };
  },
});
