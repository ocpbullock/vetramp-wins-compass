import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { CompetitiveIntel } from "@/lib/api";

type Level = "strong" | "moderate" | "weak";

const LABEL: Record<Level, string> = {
  strong: "Strong", moderate: "Moderate", weak: "Weak",
};

function Icon({ level }: { level: Level }) {
  if (level === "strong") return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (level === "moderate") return <AlertTriangle className="w-4 h-4 text-amber-500" />;
  return <XCircle className="w-4 h-4 text-red-500" />;
}

function fmtUsd(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function scoreNaics(oppNaics: string, userNaics: string[]): { lvl: Level; detail: string } {
  if (!oppNaics) return { lvl: "weak", detail: "No NAICS on opportunity" };
  if (userNaics.length === 0) return { lvl: "moderate", detail: "No user NAICS configured" };
  if (userNaics.includes(oppNaics)) {
    return { lvl: "strong", detail: `Exact match — ${oppNaics} is in your NAICS list` };
  }
  const prefix4 = oppNaics.slice(0, 4);
  if (userNaics.some((n) => n.slice(0, 4) === prefix4)) {
    return { lvl: "moderate", detail: `Adjacent — same 4-digit family (${prefix4}xx) as your NAICS` };
  }
  const prefix3 = oppNaics.slice(0, 3);
  if (userNaics.some((n) => n.slice(0, 3) === prefix3)) {
    return { lvl: "moderate", detail: `Loosely related — same 3-digit subsector (${prefix3}xxx)` };
  }
  return { lvl: "weak", detail: `${oppNaics} outside your NAICS list` };
}

function scoreSetAside(sa: string | undefined): { lvl: Level; detail: string } {
  const u = (sa || "").toUpperCase();
  if (!u) return { lvl: "moderate", detail: "Unrestricted (full and open)" };
  if (["SDVOSBC", "VSA", "VSB"].includes(u)) return { lvl: "strong", detail: `${u} — preferred set-aside` };
  if (["SBA", "WOSB", "EDWOSB", "HZC", "HZS"].includes(u)) return { lvl: "moderate", detail: `${u} — small business set-aside` };
  if (["8A", "8AN"].includes(u)) return { lvl: "weak", detail: `${u} — restricted to 8(a) firms` };
  return { lvl: "moderate", detail: `Set-aside: ${u}` };
}

function scoreAgencyExp(count: number, agencyName: string): { lvl: Level; detail: string } {
  if (count >= 3) return { lvl: "strong", detail: `${count} prior awards in your history at ${agencyName}` };
  if (count >= 1) return { lvl: "moderate", detail: `${count} prior award${count === 1 ? "" : "s"} at ${agencyName}` };
  return { lvl: "weak", detail: `No prior awards at ${agencyName} in your cached history` };
}

function scoreIncumbent(top: CompetitiveIntel["incumbent"]["top"]): { lvl: Level; detail: string } {
  if (!top) return { lvl: "strong", detail: "No identifiable incumbent — open field" };
  const v = top.value || 0;
  if (v >= 10_000_000) return { lvl: "weak", detail: `Entrenched: ${top.vendor} — ${fmtUsd(v)}` };
  if (v >= 2_000_000) return { lvl: "moderate", detail: `Mid-size incumbent: ${top.vendor} — ${fmtUsd(v)}` };
  return { lvl: "moderate", detail: `Small incumbent: ${top.vendor} — ${fmtUsd(v)} (displaceable)` };
}

function scoreContractSize(avg: number): { lvl: Level; detail: string } {
  if (avg <= 0) return { lvl: "moderate", detail: "Insufficient agency history" };
  if (avg >= 250_000 && avg <= 25_000_000) return { lvl: "strong", detail: `Avg ~${fmtUsd(avg)} — within sweet spot` };
  if (avg < 250_000) return { lvl: "moderate", detail: `Avg ~${fmtUsd(avg)} — small contracts` };
  return { lvl: "moderate", detail: `Avg ~${fmtUsd(avg)} — large primes territory` };
}

function scoreCompetition(vendorCount: number): { lvl: Level; detail: string } {
  if (vendorCount === 0) return { lvl: "moderate", detail: "No prior agency competitors found" };
  if (vendorCount <= 8) return { lvl: "strong", detail: `${vendorCount} active vendors — limited competition` };
  if (vendorCount <= 25) return { lvl: "moderate", detail: `${vendorCount} active vendors — typical competition` };
  return { lvl: "weak", detail: `${vendorCount}+ active vendors — crowded field` };
}

function scoreTimeline(deadline?: string): { lvl: Level; detail: string } {
  if (!deadline) return { lvl: "moderate", detail: "No response deadline on record" };
  const days = Math.floor((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { lvl: "weak", detail: `Closed ${-days}d ago` };
  if (days <= 7) return { lvl: "weak", detail: `${days}d remaining — very tight` };
  if (days <= 14) return { lvl: "moderate", detail: `${days}d remaining — manageable` };
  return { lvl: "strong", detail: `${days}d remaining — comfortable runway` };
}

const VAL: Record<Level, number> = { strong: 2, moderate: 1, weak: 0 };

export function BidScorecard({
  data, userNaics, userAgencyAwardCount, oppNaics, oppSetAside, responseDeadLine,
}: {
  data: CompetitiveIntel;
  userNaics: string[];
  userAgencyAwardCount: number;
  oppNaics: string;
  oppSetAside?: string;
  responseDeadLine?: string;
}) {
  const rows: { key: string; label: string; r: { lvl: Level; detail: string } }[] = [
    { key: "naics", label: "NAICS Match", r: scoreNaics(oppNaics, userNaics) },
    { key: "setaside", label: "Set-Aside Match", r: scoreSetAside(oppSetAside) },
    { key: "agency", label: "Agency Experience", r: scoreAgencyExp(userAgencyAwardCount, data.agencyHistory.agencyName || "this agency") },
    { key: "incumbent", label: "Incumbent Risk", r: scoreIncumbent(data.incumbent.top) },
    { key: "size", label: "Contract Size", r: scoreContractSize(data.agencyHistory.avgValue) },
    { key: "competition", label: "Competition Level", r: scoreCompetition(data.agencyHistory.vendors.length) },
    { key: "timeline", label: "Response Timeline", r: scoreTimeline(responseDeadLine) },
  ];

  const avg = rows.reduce((s, x) => s + VAL[x.r.lvl], 0) / rows.length;
  const overall: Level = avg >= 1.4 ? "strong" : avg >= 0.85 ? "moderate" : "weak";
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
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border/50">
              <td className="p-2 font-medium">{row.label}</td>
              <td className="p-2"><span className="inline-flex items-center gap-1.5"><Icon level={row.r.lvl} />{LABEL[row.r.lvl]}</span></td>
              <td className="p-2 text-muted-foreground">{row.r.detail}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-muted/30">
            <td className="p-2 font-semibold">Overall</td>
            <td className="p-2"><span className="inline-flex items-center gap-1.5 font-semibold uppercase"><Icon level={overall} />{LABEL[overall]}</span></td>
            <td className="p-2 text-muted-foreground">Aggregate of {rows.length} factors (avg {avg.toFixed(2)}/2.00)</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
