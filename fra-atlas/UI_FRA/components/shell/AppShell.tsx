"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BarChart3,
  Boxes,
  FileText,
  FlaskConical,
  Map,
  Scale,
  Sigma,
  SlidersHorizontal,
  Info,
} from "lucide-react";
import { DISCLAIMER } from "@/lib/meta";

const NAV = [
  { href: "/", label: "Atlas", icon: Map, hint: "Districts, schemes & claims" },
  { href: "/playground", label: "Playground", icon: SlidersHorizontal, hint: "What-if: every model, live" },
  { href: "/arena", label: "Model arena", icon: BarChart3, hint: "Leaderboards & error analysis" },
  { href: "/explain", label: "Explainability", icon: FlaskConical, hint: "Importance & partial dependence" },
  { href: "/classify", label: "Classification", icon: Sigma, hint: "Terciles, ROC, thresholds" },
  { href: "/data", label: "Data & structure", icon: Boxes, hint: "Dataset, clusters, rules mined" },
  { href: "/rules", label: "Scoring rules", icon: Scale, hint: "The formulas & cutoff what-ifs" },
  { href: "/claims", label: "Claims & documents", icon: FileText, hint: "OCR + NER intake, claim table" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-slate-900 text-slate-100">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="text-lg font-bold tracking-tight">FRA Atlas</div>
          <div className="text-xs text-slate-400 mt-0.5">ML lab for Forest Rights Act claims</div>
        </div>
        <nav className="flex-1 py-3">
          {NAV.map(({ href, label, icon: Icon, hint }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-start gap-3 px-5 py-2.5 text-sm transition-colors ${
                  active ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                }`}
              >
                <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="block text-[11px] text-slate-400">{hint}</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 text-[11px] text-slate-400 border-t border-slate-800 leading-relaxed">
          Models trained on 1,540 synthetic plots in 7 districts. Labels come from scheme_rules.py (rules + noise).
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden flex gap-1 overflow-x-auto bg-slate-900 px-2 py-2">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`whitespace-nowrap rounded px-2.5 py-1 text-xs ${
                (href === "/" ? pathname === "/" : pathname.startsWith(href)) ? "bg-slate-700 text-white" : "text-slate-300"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 sm:px-6 py-2 text-xs text-amber-900">
          <Info className="w-3.5 h-3.5 shrink-0" />
          {DISCLAIMER}
        </div>
        <main className="flex-1 min-w-0 px-4 sm:px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
