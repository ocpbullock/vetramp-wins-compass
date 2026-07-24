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
  name: "list_activities",
  title: "List opportunity activities",
  description: "List capture activities/tasks for a given opportunity (proposal id).",
  inputSchema: {
    proposalId: z.string().uuid().describe("Opportunity (proposal) id."),
    status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ proposalId, status }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = userClient(ctx.getToken()!);
    let q = sb
      .from("opportunity_activities")
      .select("id, title, detail, owner_user_id, due_date, status, created_from_analysis, created_at")
      .eq("proposal_id", proposalId)
      .order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { activities: data ?? [] },
    };
  },
});
