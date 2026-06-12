// Regression: generateSection used to read `proposal.sections` from the render
// closure when computing both the streaming preview update and the final DB
// payload. During generateAll's sequential loop that snapshot is stale, so
// each section's save replaced the sections JSONB with an object missing the
// sections generated earlier in the same run.
//
// The fix is to compute the merged sections inside a functional state updater
// so the patch always merges into the LATEST sections. This test simulates
// that flow with a minimal React-like state container and asserts that two
// sequential generations both end up persisted.
import { describe, it, expect } from "vitest";

type Sections = Record<string, { content: string; status: string; word_count: number }>;
type Proposal = { id: string; sections: Sections };

function makeState<T>(initial: T) {
  let value = initial;
  const setState = (updater: (prev: T) => T) => {
    value = updater(value);
  };
  const get = () => value;
  return { setState, get };
}

// Mirrors the persistence pattern used in generateSection: capture the merged
// sections object inside the functional updater so the DB save uses the
// LATEST state, not the stale render-closure snapshot.
async function persistGeneratedSection(
  state: { setState: (u: (p: Proposal) => Proposal) => void },
  db: { update: (p: { sections: Sections }) => Promise<void> },
  sectionId: string,
  content: string,
) {
  const wc = content.split(/\s+/).filter(Boolean).length;
  let finalSections: Sections = {};
  state.setState((p) => {
    finalSections = { ...(p.sections || {}), [sectionId]: { content, status: "draft", word_count: wc } };
    return { ...p, sections: finalSections };
  });
  await db.update({ sections: finalSections });
}

describe("generateSection sequential save merges into latest sections", () => {
  it("persists every section after a sequential generateAll-style loop", async () => {
    const proposal: Proposal = { id: "p1", sections: {} };
    const state = makeState(proposal);

    // Simulate the network DB: records every payload it received.
    const writes: Array<{ sections: Sections }> = [];
    const db = {
      update: async (patch: { sections: Sections }) => {
        writes.push({ sections: { ...patch.sections } });
      },
    };

    // Mimic generateAll: each generateSection call's outer closure would have
    // observed the proposal BEFORE the previous section was added. The stale
    // bug shape: pre-capture `const stale = state.get()` before each call.
    const order = [
      { id: "cover_letter", content: "Dear contracting officer" },
      { id: "executive_summary", content: "We propose to deliver excellence" },
    ];

    for (const s of order) {
      // (Stale closure existed here in the buggy version — intentionally
      // unused; the fix means we never read it for the merge.)
      void state.get();
      await persistGeneratedSection(state, db, s.id, s.content);
    }

    const lastWrite = writes[writes.length - 1];
    expect(Object.keys(lastWrite.sections).sort()).toEqual(["cover_letter", "executive_summary"]);
    expect(lastWrite.sections.cover_letter.content).toBe("Dear contracting officer");
    expect(lastWrite.sections.executive_summary.content).toBe("We propose to deliver excellence");

    // And the in-memory state mirrors the DB.
    expect(Object.keys(state.get().sections).sort()).toEqual(["cover_letter", "executive_summary"]);
  });

  it("source: generateSection in proposals route uses a functional setProposal for the final save", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "..", "src/routes/proposals.$proposalId.tsx"),
      "utf8",
    );
    // The final save must NOT read proposal.sections from the render closure.
    expect(src).not.toMatch(/finalSections\s*=\s*\{\s*\.\.\.\(proposal\.sections/);
    // It must compute finalSections inside a setProposal functional updater
    // and patch using that captured value.
    expect(src).toMatch(/setProposal\(\(p: any\) => \{[\s\S]*finalSections\s*=\s*\{\s*\.\.\.\(p\?\.sections/);
    expect(src).toMatch(/\.update\(\{\s*sections:\s*finalSections\s*\}\)/);
  });
});
