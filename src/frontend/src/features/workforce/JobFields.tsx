import { useId } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useAppSelector } from "@/store";
import type { Tree } from "@/store/types";
import { CHECK_BOX, CHECK_ROW, GROWING } from "./layout";
import { KNOWN_SERVICES, KNOWN_TOOLS, THINKING_POWERS, groupedTools, personLabels, serviceLabel, tierLabel, toolLabel, type JobDraftShape } from "./workforceModel";

/** A job description being edited: what a hire is drafted with and an employee works to. */
export type JobDraft = JobDraftShape;

/**
 * The parts of a job a person changes on screen. Who it is and how it thinks sit two across; the
 * mandate is a text area that shows whole lines; the budget sits beside what it means; and what it may
 * use is grouped under headings, in columns, each choice a full-height row.
 */
export function JobFields({
  draft,
  onChange,
  managers,
  tree,
  withBudget = true,
  budgetLabel = "Its own monthly budget (optional)",
  allowStandard = true,
}: {
  draft: JobDraft;
  onChange: (next: JobDraft) => void;
  managers: { id: string; name: string; role: string; scope?: string }[];
  /** For telling apart two people with the same name and role in "Reports to": where each works. */
  tree?: Tree;
  withBudget?: boolean;
  budgetLabel?: string;
  /** Once a thinking power is set it is changed, not taken away; the standard choice is offered only before. */
  allowStandard?: boolean;
}) {
  const mode = useAppSelector((s) => s.ui.mode);
  const ids = { name: useId(), role: useId(), mandate: useId(), tier: useId(), manager: useId(), budget: useId(), tools: useId(), services: useId() };
  const set = (patch: Partial<JobDraft>) => onChange({ ...draft, ...patch });
  const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  // Tools it already has that this console does not name are kept, and can be taken away.
  const tools = [...new Set([...KNOWN_TOOLS, ...draft.tools])];
  const tiers = [...new Set([...THINKING_POWERS, ...(draft.modelTier ? [draft.modelTier] : [])])];
  const labels = personLabels(
    managers.map((m) => ({ ...m, scope: m.scope ?? "" })),
    tree,
  );
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
        <Field id={ids.name} label="Name">
          <Input id={ids.name} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field id={ids.role} label="Role">
          <Input id={ids.role} value={draft.role} onChange={(e) => set({ role: e.target.value })} />
        </Field>
        <Field id={ids.tier} label="Thinking power">
          <Select id={ids.tier} value={draft.modelTier} onChange={(e) => set({ modelTier: e.target.value })}>
            {allowStandard && <option value="">{tierLabel(null, mode)}, for the work it does</option>}
            {tiers.map((t) => (
              <option key={t} value={t}>
                {tierLabel(t, mode)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={ids.manager} label="Reports to">
          <Select id={ids.manager} value={draft.reportsTo} onChange={(e) => set({ reportsTo: e.target.value })}>
            <option value="">Nobody: it answers to you</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {labels.get(m.id)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {withBudget && (
        // The budget beside what it means, rather than a short box over a long hint.
        <div className="grid grid-cols-1 items-end gap-x-5 gap-y-1.5 md:grid-cols-2">
          <Field id={ids.budget} label={budgetLabel}>
            <Input id={ids.budget} inputMode="numeric" value={draft.budget} onChange={(e) => set({ budget: e.target.value })} aria-describedby={`${ids.budget}-hint`} />
          </Field>
          <span id={`${ids.budget}-hint`} className="text-sm text-ink-muted md:flex md:min-h-touch md:items-center">
            Counts what the contractors it briefs spend too. Leave it empty for none of its own.
          </span>
        </div>
      )}
      <Field id={ids.mandate} label="Mandate">
        <Textarea id={ids.mandate} rows={4} value={draft.mandate} onChange={(e) => set({ mandate: e.target.value })} className={GROWING} />
      </Field>
      <fieldset aria-labelledby={ids.tools} className="flex min-w-0 flex-col gap-3">
        <legend id={ids.tools} className="mb-3 font-medium">
          What it may use
        </legend>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          {groupedTools(tools).map((g) => (
            <div key={g.title} className="flex min-w-0 flex-col">
              <span className="pb-1 text-sm font-semibold text-ink-muted">{g.title}</span>
              {g.tools.map((t) => (
                <label key={t} className={CHECK_ROW}>
                  <input type="checkbox" checked={draft.tools.includes(t)} onChange={() => set({ tools: toggle(draft.tools, t) })} className={CHECK_BOX} />
                  {toolLabel(t, mode)}
                </label>
              ))}
            </div>
          ))}
        </div>
      </fieldset>
      <fieldset aria-labelledby={ids.services} className="flex min-w-0 flex-col">
        <legend id={ids.services} className="mb-3 font-medium">
          The platform&rsquo;s services it may use
        </legend>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
          {KNOWN_SERVICES.map((x) => (
            <label key={x} className={CHECK_ROW}>
              <input type="checkbox" checked={draft.services.includes(x)} onChange={() => set({ services: toggle(draft.services, x) })} className={CHECK_BOX} />
              {serviceLabel(x, mode)}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
