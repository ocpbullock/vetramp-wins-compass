import { describe, it, expect } from "vitest";
import { companyFromVendorLookup, companyFromSamEntity } from "../src/lib/companies";

describe("companyFromVendorLookup", () => {
  it("maps a USAspending-style vendor profile into a CompanyDraft", () => {
    const draft = companyFromVendorLookup(
      {
        recipientId: "abc-123",
        profile: {
          recipient_name: "Acme Federal LLC",
          uei: "ABCDE12345",
          duns: "999999999",
          business_types: ["SDVOSB", "Small Business"],
        },
        naicsBreakdown: [
          { code: "541512", awards: 5, totalValue: 1_000_000 },
          { code: "541519", awards: 2, totalValue: 200_000 },
        ],
        summary: { totalContracts: 7, totalValue: 1_200_000 },
      },
      "team-1",
    );
    expect(draft.team_id).toBe("team-1");
    expect(draft.name).toBe("Acme Federal LLC");
    expect(draft.uei).toBe("ABCDE12345");
    expect(draft.naics_codes).toEqual(["541512", "541519"]);
    expect(draft.certifications).toEqual(["SDVOSB", "Small Business"]);
    expect(draft.source).toBe("vendor_lookup");
    expect(draft.external_ref).toMatchObject({ recipient_id: "abc-123" });
    expect(draft.relationship_status).toBe("prospective");
  });
});

describe("companyFromSamEntity", () => {
  it("maps a SAM.gov entity into a CompanyDraft", () => {
    const draft = companyFromSamEntity(
      {
        legalBusinessName: "Globex Systems",
        ueiSAM: "ZYXWV98765",
        cageCode: "1A2B3",
        entityURL: "globex.example",
        naicsList: [{ code: "541330" }, { code: "541512" }],
        certifications: ["8(a)"],
        businessTypes: ["WOSB"],
      },
      "team-2",
    );
    expect(draft.name).toBe("Globex Systems");
    expect(draft.uei).toBe("ZYXWV98765");
    expect(draft.cage_code).toBe("1A2B3");
    expect(draft.website).toBe("globex.example");
    expect(draft.naics_codes).toEqual(["541330", "541512"]);
    expect(draft.certifications).toEqual(["8(a)"]);
    expect(draft.set_asides).toEqual(["WOSB"]);
    expect(draft.source).toBe("sam_gov");
  });
});
