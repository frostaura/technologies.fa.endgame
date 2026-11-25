import type { CodeStep } from "../content/scripts.ts";

const LANGUAGE: Record<CodeStep["language"], string> = {
  csharp: "C#",
  typescript: "TypeScript",
  tsx: "TypeScript (React)",
  javascript: "JavaScript",
  json: "JSON",
  http: "HTTP",
  bash: "Shell",
  sql: "SQL",
  yaml: "YAML",
  text: "Text",
};

/** Code the step is about, set like the terminal, with what it prints or returns beneath it. */
export function CodePanel({ step }: { step: CodeStep }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg bg-night shadow-raised" data-testid="code">
      <div className="flex items-center gap-2 px-4 py-2.5" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-attention-line" />
        <span className="h-2.5 w-2.5 rounded-full bg-primary-soft" />
        <span className="h-2.5 w-2.5 rounded-full bg-live" />
        <span className="ml-2 font-mono text-xs text-primary-ink-soft">{LANGUAGE[step.language]}</span>
      </div>
      <div className="flex-1 overflow-auto px-5 pb-5">
        <pre className="font-mono text-xs leading-relaxed text-primary-ink sm:text-sm" aria-label={`Code, ${LANGUAGE[step.language]}`}>{step.code}</pre>
        {step.output && step.output.length > 0 && (
          <div className="mt-4 animate-rise animate-delay-2 border-t border-primary-soft pt-3">
            <p className="text-eyebrow font-semibold uppercase text-live">It returns</p>
            <pre className="mt-2 font-mono text-xs leading-relaxed text-primary-ink-soft sm:text-sm">{step.output.join("\n")}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
