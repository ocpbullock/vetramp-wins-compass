import { describe, it, expect } from "vitest";
import { extractTemplateStructure, findActiveTemplate } from "../src/lib/proposal-template";

describe("extractTemplateStructure", () => {
  it("returns empty for empty input", () => {
    expect(extractTemplateStructure("")).toEqual({ sections: [], boilerplate: "" });
    expect(extractTemplateStructure(null)).toEqual({ sections: [], boilerplate: "" });
  });

  it("extracts markdown ATX headings as the outline", () => {
    const md = `# Executive Summary\nBody.\n# Technical Approach\nMore body.\n## Sub heading\n# Past Performance\n`;
    const { sections } = extractTemplateStructure(md);
    expect(sections.map((s) => s.title)).toEqual([
      "Executive Summary",
      "Technical Approach",
      "Past Performance",
    ]);
  });

  it("extracts numbered outline headings", () => {
    const txt = `1. COVER LETTER\nbody\n2. EXECUTIVE SUMMARY\nbody\n2.1 Sub item\n3. TECHNICAL APPROACH\nbody\n`;
    const { sections } = extractTemplateStructure(txt);
    // top level == depth 1 (numbered 1./2./3.)
    expect(sections.length).toBe(3);
    expect(sections[0].title).toBe("1. COVER LETTER");
    expect(sections[2].title).toBe("3. TECHNICAL APPROACH");
  });

  it("falls back to ALL-CAPS headings when no markdown/numbered headings exist", () => {
    const txt = `EXECUTIVE SUMMARY\nSome paragraph text that is not a heading.\nTECHNICAL APPROACH\nMore body.\nPAST PERFORMANCE\n`;
    const { sections } = extractTemplateStructure(txt);
    expect(sections.map((s) => s.title)).toEqual([
      "EXECUTIVE SUMMARY",
      "TECHNICAL APPROACH",
      "PAST PERFORMANCE",
    ]);
  });

  it("generates unique slugified ids", () => {
    const md = `# Overview\n# Overview\n# Past Performance\n`;
    const { sections } = extractTemplateStructure(md);
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns boilerplate truncated to 25k chars", () => {
    const big = "# Heading\n" + "x".repeat(40_000);
    const { boilerplate } = extractTemplateStructure(big);
    expect(boilerplate.length).toBe(25_000);
  });
});

describe("findActiveTemplate", () => {
  it("returns null when no attachments or no template", () => {
    expect(findActiveTemplate(null)).toBeNull();
    expect(findActiveTemplate([])).toBeNull();
    expect(findActiveTemplate([{ file_type: "sow", parsed_content: "abc" }])).toBeNull();
  });

  it("ignores templates without parsed_content", () => {
    expect(findActiveTemplate([{ file_type: "template", parsed_content: "" }])).toBeNull();
    expect(findActiveTemplate([{ file_type: "template", parsed_content: null }])).toBeNull();
  });

  it("returns the first usable template", () => {
    const t = findActiveTemplate([
      { id: "1", file_type: "sow", parsed_content: "x" },
      { id: "2", file_type: "template", parsed_content: "# Hi" },
      { id: "3", file_type: "template", parsed_content: "# Other" },
    ]);
    expect(t?.id).toBe("2");
  });
});
