import type { CodeStep } from "../content/scripts.ts";
import { FrameChrome } from "./DemoFrame.tsx";

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
    <FrameChrome address={`code · ${LANGUAGE[step.language]}`} fit>
      <div className="min-h-0 overflow-auto bg-surface px-5 py-4" data-testid="code">
        <pre className="font-mono text-xs leading-relaxed text-ink sm:text-sm" aria-label={`Code, ${LANGUAGE[step.language]}`}>{step.code}</pre>
        {step.output && step.output.length > 0 && (
          <div className="mt-4 animate-rise animate-delay-2 border-t pt-3">
            <p className="text-eyebrow font-semibold uppercase text-ink-muted">It returns</p>
            <pre className="mt-2 font-mono text-xs leading-relaxed text-ink-body sm:text-sm">{step.output.join("\n")}</pre>
          </div>
        )}
      </div>
    </FrameChrome>
  );
}
