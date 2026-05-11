import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { CompetitiveIntel } from "@/lib/api";

type Level = "strong" | "moderate" | "weak" | string;

const LABEL: Record<string, string> = {
  strong: "Strong", moderate: "Moderate", weak: "Weak",
};

function Icon({ level }: { level: Level }) {
  if (level === "strong") return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (level === "moderate") return <AlertTriangle className="w-4 h-4 text-amber-500" />;
  return <XCircle className="w-4 h-4 text-red-500" />;
}

function rowDetail(key: string, d: CompetitiveIntel): string {
  switch (key) {
    case "naicsMatch": return "NAICS scoring relative to your primary IT services codes (541511–541519)";
    case "setAsideMatch": return d.marketLandscape.setAside ? `Set-aside: ${d.marketLandscape.setAside}` : "Unrestricted or non-preferred";
    case "agencyExperience": return "No prior award history attached for VetRamp";
    case "incumbentRisk": return d.incumbent.top ? `Incumbent: ${d.incumbent.top.vendor} (${(d.incumbent.top.value / 1e6).toFixed(1)}M)` : "No identifiable incumbent";
    case "contractSize": return d.agencyHistory.avgValue ? `Agency avg ~$${(d.agencyHistory.avgValue / 1e6).toFixed(1)}M for this NAICS` : "Insufficient agency history";
    case "competitionLevel": return `${d.agencyHistory.vendors.length} unique vendors at this agency`;
    case "timeline": return "Time remaining vs response deadline";
    default: return "";
  }
}

const ROWS: { key: keyof CompetitiveIntel["scorecard"]; label: string }[] = [
  { key: "naicsMatch", label: "NAICS Match" },
  { key: "setAsideMatch", label: "Set-Aside Match" },
  { key: "agencyExperience", label: "Agency Experience" },
  { key: "incumbentRisk", label: "Incumbent Risk" },
  { key: "contractSize", label: "Contract Size" },
  { key: "competitionLevel", label: "Competition Level" },
  { key: "timeline", label: "Response Timeline" },
];

export function BidScorecard({ data }: { data: CompetitiveIntel }) {
  const overall = data.scorecard.overall;
  const overallColor = overall === "strong"
    ? "border-emerald-500/40 bg-emerald-500/5"
    : overall === "moderate"
    ? "border-amber-500/40 bg-amber-500/5"
    : "border-red-500/40 bg-red-500/5";

  return (
    <div className={`border rounded-lg overflow-hidden ${overallColor}`}>
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr><th className="text-left p-2">Factor</th><th className="text-left p-2">Score</th><th className="text-left p-2">Detail</th></tr>
        </thead>
        <tbody>
          {ROWS.map((r) => {
            const v = data.scorecard[r.key];
            return (
              <tr key={r.key} className="border-t border-border/50">
                <td className="p-2 font-medium">{r.label}</td>
                <td className="p-2"><span className="inline-flex items-center gap-1.5"><Icon level={v} />{LABEL[v] ?? v}</span></td>
                <td className="p-2 text-muted-foreground">{rowDetail(r.key, data)}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-border bg-muted/30">
            <td className="p-2 font-semibold">Overall</td>
            <td className="p-2"><span className="inline-flex items-center gap-1.5 font-semibold uppercase"><Icon level={overall} />{LABEL[overall] ?? overall}</span></td>
            <td className="p-2 text-muted-foreground">Aggregate of all factors</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
