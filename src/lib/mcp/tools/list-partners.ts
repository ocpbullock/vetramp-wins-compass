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
  name: "list_partners",
  title: "List partner companies",
  description: "List companies in the user's teaming-partner roster, optionally filtered by name.",
  inputSchema: {
    search: z.string().min(1).optional().describe("Case-insensitive substring match on company name."),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = userClient(ctx.getToken()!);
    let q = sb
      .from("companies")
      .select("id, name, uei, cage_code, website, naics_codes, certifications, size_status, hq_location, updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit ?? 50);
    if (search) q = q.ilike("name", `%${search}%`);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { partners: data ?? [] },
    };
  },
});
