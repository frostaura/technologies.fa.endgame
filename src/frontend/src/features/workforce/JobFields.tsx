import { useId } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useAppSelector } from "@/store";
import { KNOWN_SERVICES, KNOWN_TOOLS, THINKING_POWERS, serviceLabel, tierLabel, toolLabel, type JobDraftShape } from "./workforceModel";

/** A job description being edited: what a hire is drafted with and an employee works to. */
export type JobDraft = JobDraftShape;

/** The parts of a job a person changes on screen, laid out for the width: two columns on a wide screen, one on a phone. */
export function JobFields({
  draft,
  onChange,
  managers,
  withBudget = true,
  budgetLabel = "Its own monthly budget (optional)",
  allowStandard = true,
}: {
  draft: JobDraft;
  onChange: (next: JobDraft) => void;
  managers: { id: string; name: string; role: string }[];
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
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                {m.name} · {m.role}
              </option>
            ))}
          </Select>
        </Field>
        {withBudget && (
          <Field id={ids.budget} label={budgetLabel} hint="Counts what the contractors it briefs spend too. Leave it empty for none of its own.">
            <Input id={ids.budget} inputMode="numeric" value={draft.budget} onChange={(e) => set({ budget: e.target.value })} aria-describedby={`${ids.budget}-hint`} />
          </Field>
        )}
      </div>
      <Field id={ids.mandate} label="Mandate">
        <Textarea id={ids.mandate} rows={3} value={draft.mandate} onChange={(e) => set({ mandate: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <fieldset aria-labelledby={ids.tools} className="flex flex-col gap-1.5">
          <legend id={ids.tools} className="mb-1 font-medium">
            What it may use
          </legend>
          {tools.map((t) => (
            <label key={t} className="flex min-h-touch items-center gap-2.5">
              <input type="checkbox" checked={draft.tools.includes(t)} onChange={() => set({ tools: toggle(draft.tools, t) })} className="size-4 accent-primary" />
              {toolLabel(t, mode)}
            </label>
          ))}
        </fieldset>
        <fieldset aria-labelledby={ids.services} className="flex flex-col gap-1.5">
          <legend id={ids.services} className="mb-1 font-medium">
            The platform&rsquo;s services it may use
          </legend>
          {KNOWN_SERVICES.map((x) => (
            <label key={x} className="flex min-h-touch items-center gap-2.5">
              <input type="checkbox" checked={draft.services.includes(x)} onChange={() => set({ services: toggle(draft.services, x) })} className="size-4 accent-primary" />
              {serviceLabel(x, mode)}
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
