import { describe, it, expect } from "vitest";
import { batchUeis, dedupeAwards } from "@/lib/ecosystem-build";
import type { ScopedAward } from "@/lib/ecosystem-rank";

describe("batchUeis", () => {
  it("splits 27 holders into 3 batches of 10/10/7", () => {
    const ueis = Array.from({ length: 27 }, (_, i) => `UEI${String(i).padStart(9, "0")}`);
    const batches = batchUeis(ueis, 10);
    expect(batches.map((b) => b.length)).toEqual([10, 10, 7]);
    expect(batches.flat()).toHaveLength(27);
  });

  it("drops blanks and case-insensitive duplicates", () => {
    expect(batchUeis(["abc", "ABC", "", null, "def"], 10)).toEqual([["ABC", "DEF"]]);
  });
});

describe("dedupeAwards", () => {
  const a = (over: Partial<ScopedAward>): ScopedAward => ({
    generated_internal_id: "g1",
    "Award ID": "P1",
    "Recipient UEI": "U1",
    "Award Amount": 100,
    ...over,
  }) as ScopedAward;

  it("keeps the tagged copy when a duplicate is untagged", () => {
    const out = dedupeAwards([a({ scope: undefined }), a({ scope: "customer" })]);
    expect(out).toHaveLength(1);
    expect(out[0].scope).toBe("customer");
  });

  it("keeps the first tagged copy over later tagged duplicates", () => {
    const out = dedupeAwards([a({ scope: "customer" }), a({ scope: "agency" })]);
    expect(out).toHaveLength(1);
    expect(out[0].scope).toBe("customer");
  });

  it("falls back to Award ID + UEI when generated_internal_id is missing", () => {
    const out = dedupeAwards([
      a({ generated_internal_id: undefined }),
      a({ generated_internal_id: undefined, scope: "agency" }),
      a({ generated_internal_id: undefined, "Recipient UEI": "U2" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].scope).toBe("agency");
  });

  it("keeps distinct awards", () => {
    const out = dedupeAwards([a({}), a({ generated_internal_id: "g2" })]);
    expect(out).toHaveLength(2);
  });
});
