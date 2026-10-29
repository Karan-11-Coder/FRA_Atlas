"use client";

export interface Span {
  start: number;
  end: number;
  text: string;
  field: string;
  source: "regex" | "spacy";
  label: string;
}

/**
 * OCR text with extracted entities highlighted.
 * Blue = labelled-field regex, violet = spaCy NER, green = both found the same characters.
 */
export default function HighlightedText({ text, spans }: { text: string; spans: Span[] }) {
  const cuts = new Set<number>([0, text.length]);
  spans.forEach((s) => {
    cuts.add(s.start);
    cuts.add(s.end);
  });
  const points = [...cuts].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const covering = spans.filter((s) => s.start <= a && s.end >= b);
    segments.push({ a, b, covering });
  }
  return (
    <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[12px] leading-relaxed">
      {segments.map(({ a, b, covering }) => {
        const chunk = text.slice(a, b);
        if (!covering.length) return <span key={a}>{chunk}</span>;
        const sources = new Set(covering.map((s) => s.source));
        const cls = sources.size > 1 ? "bg-emerald-200" : sources.has("regex") ? "bg-blue-200" : "bg-violet-200";
        const title = covering.map((s) => `${s.source === "spacy" ? "spaCy " + s.label : "regex"} → ${s.field}`).join("\n");
        return (
          <mark key={a} className={`${cls} rounded-sm px-0.5 text-slate-900`} title={title}>
            {chunk}
          </mark>
        );
      })}
    </pre>
  );
}

export function SpanLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-slate-600">
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-blue-200" /> rule-based (labelled field)</span>
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-violet-200" /> spaCy NER (PERSON / GPE / DATE)</span>
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-emerald-200" /> both</span>
    </div>
  );
}
