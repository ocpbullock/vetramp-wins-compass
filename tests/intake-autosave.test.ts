/**
 * Regression test: proposal IntakeStep must not lose user-entered values when
 * a background server refetch returns stale (or merely older) data.
 *
 * Scenario modelled:
 *   1. Initial load: local <- server.
 *   2. User edits a tracked field locally; dirty flag flips, save in flight.
 *   3. A background refetch (e.g. after parse, or tab re-mount) hands us a
 *      server proposal row that DOES NOT include the user's edit yet.
 *   4. mergeServerProposal must preserve the user's edit while still
 *      accepting non-tracked server updates (e.g. compliance_matrix).
 *   5. After the save completes (dirty=false, inFlight=0), a subsequent
 *      server refresh that now includes the edit is adopted verbatim.
 */
import { describe, it, expect } from "vitest";
import { mergeServerProposal, INTAKE_TRACKED_FIELDS } from "../src/lib/intake-merge";

const baseRow = {
  id: "p1",
  opportunity_type: null,
  estimated_value: null,
  contract_type: null,
  pop_base_months: null,
  pop_option_months: null,
  clearance_requirement: null,
  user_notes: "",
  targeted_scope_areas: null,
  prime_contractor_name: null,
  compliance_matrix: null,
  parsing_status: "idle",
};

describe("mergeServerProposal", () => {
  it("adopts server row on initial init (no prev)", () => {
    const next = mergeServerProposal(null, baseRow, { dirty: false, inFlight: 0 });
    expect(next).toBe(baseRow);
  });

  it("adopts server row when not dirty and no save in flight", () => {
    const prev = { ...baseRow, user_notes: "stale local" };
    const server = { ...baseRow, user_notes: "from server" };
    const next = mergeServerProposal(prev, server, { dirty: false, inFlight: 0 });
    expect(next.user_notes).toBe("from server");
  });

  it("preserves dirty user edits across a background refetch", () => {
    const local = {
      ...baseRow,
      user_notes: "in-progress edit",
      estimated_value: 250000,
      contract_type: "ffp",
    };
    // Server refetch hasn't received the save yet, but has a new compliance_matrix.
    const server = { ...baseRow, compliance_matrix: { requirements: [] }, parsing_status: "done" };

    const next = mergeServerProposal(local, server, { dirty: true, inFlight: 1 });

    // Tracked fields preserved
    expect(next.user_notes).toBe("in-progress edit");
    expect(next.estimated_value).toBe(250000);
    expect(next.contract_type).toBe("ffp");
    // Untracked server fields adopted
    expect(next.compliance_matrix).toEqual({ requirements: [] });
    expect(next.parsing_status).toBe("done");
  });

  it("preserves edits while save is in flight even if dirty already cleared", () => {
    const local = { ...baseRow, user_notes: "edit" };
    const server = { ...baseRow, user_notes: "" };
    const next = mergeServerProposal(local, server, { dirty: false, inFlight: 1 });
    expect(next.user_notes).toBe("edit");
  });

  it("adopts new server row when proposal id changes", () => {
    const local = { ...baseRow, user_notes: "edit on p1" };
    const server = { ...baseRow, id: "p2", user_notes: "server p2" };
    const next = mergeServerProposal(local, server, { dirty: true, inFlight: 1 });
    expect(next).toBe(server);
  });

  it("covers every documented intake tracked field", () => {
    // Sanity: every field listed must round-trip through preservation.
    const local: Record<string, any> = { ...baseRow };
    for (const f of INTAKE_TRACKED_FIELDS) local[f] = `local-${f}`;
    const server: Record<string, any> = { ...baseRow };
    for (const f of INTAKE_TRACKED_FIELDS) server[f] = `server-${f}`;
    const next = mergeServerProposal(local, server, { dirty: true, inFlight: 1 }) as Record<string, any>;
    for (const f of INTAKE_TRACKED_FIELDS) {
      expect(next[f]).toBe(`local-${f}`);
    }
  });

  it("simulates the full enter-values -> refetch -> save-complete cycle", () => {
    // 1. Initial load
    let local = mergeServerProposal(null, baseRow, { dirty: false, inFlight: 0 });
    expect(local.user_notes).toBe("");

    // 2. User edits
    local = { ...local, user_notes: "draft note", opportunity_type: "new" };

    // 3. Background refetch arrives mid-save (debounced save in flight)
    const stale = { ...baseRow, parsing_status: "parsing" };
    local = mergeServerProposal(local, stale, { dirty: true, inFlight: 1 });
    expect(local.user_notes).toBe("draft note");
    expect(local.opportunity_type).toBe("new");
    expect(local.parsing_status).toBe("parsing");

    // 4. Save completes, server now reflects the edit
    const synced = { ...baseRow, user_notes: "draft note", opportunity_type: "new", parsing_status: "done" };
    local = mergeServerProposal(local, synced, { dirty: false, inFlight: 0 });
    expect(local.user_notes).toBe("draft note");
    expect(local.opportunity_type).toBe("new");
    expect(local.parsing_status).toBe("done");
  });
});
