import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listOpportunities from "./tools/list-opportunities";
import getOpportunity from "./tools/get-opportunity";
import listPartners from "./tools/list-partners";
import listActivities from "./tools/list-activities";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "vetramp-pursuit-mcp",
  title: "VetRamp Pursuit",
  version: "0.1.0",
  instructions:
    "Access the signed-in user's federal contracting opportunities, capture activities, and teaming-partner roster in VetRamp Pursuit. Use list_opportunities to browse the pipeline, get_opportunity for full detail, list_activities for capture tasks, and list_partners for the roster.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listOpportunities, getOpportunity, listPartners, listActivities],
});
