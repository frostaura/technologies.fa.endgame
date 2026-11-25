import { operatorFlows, track } from "../lib/data.ts";
import { href } from "../lib/router.ts";
import { FlowList } from "../components/FlowList.tsx";
import { Eyebrow, Page } from "../components/Shell.tsx";
import { LEVEL_BLURB } from "../lib/labels.ts";
import { flow } from "../lib/data.ts";
import { REACHES } from "../content/types.ts";
import { REACH_LABEL } from "../lib/labels.ts";

/** FrostAura's own handbook: God mode and running the platform. Kept apart from client navigation. */
export function OperatorHome() {
  const ids = track("Operator")?.flows ?? [];
  const flows = ids.flatMap((id) => flow(id) ?? []);
  const reaches = REACHES.filter((r) => operatorFlows.some((f) => f.reach === r));
  return (
    <Page>
      <div className="rounded-lg bg-night p-8 text-primary-ink sm:p-10">
        <p className="text-eyebrow font-semibold uppercase text-live">FrostAura only</p>
        <h1 className="mt-3 font-display text-title-sm font-bold sm:text-title">The operator handbook</h1>
        <p className="mt-4 max-w-read text-lead text-primary-ink-soft">{LEVEL_BLURB.Operator} Every God-mode entry into an organisation is logged, and that organisation's Owner can read the log.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          {flows[0] && <a href={href(`/flow/${flows[0].id}`)} className="inline-flex min-h-touch items-center rounded-full bg-surface px-6 text-sm font-semibold text-ink hover:bg-primary-tint">Begin with {flows[0].id}</a>}
          {reaches.map((r) => (
            <a key={r} href={href(`/operator/reach/${r}`)} className="inline-flex min-h-touch items-center rounded-full border-2 border-primary-ink-soft px-5 text-sm font-semibold hover:bg-surface/10">{REACH_LABEL[r]}</a>
          ))}
        </div>
      </div>
      <div className="mt-10">
        <Eyebrow>In order</Eyebrow>
        <div className="mt-4"><FlowList flows={flows} numbered /></div>
      </div>
    </Page>
  );
}
