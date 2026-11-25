import { useId } from "react";
import { Select } from "@/components/ui/field";
import { navigate, paths } from "@/lib/router";
import { chooseOrganisation, organisationsOf, useActiveOrganisation } from "@/lib/useActiveOrganisation";
import { cn } from "@/lib/utils";
import { useGetMeQuery } from "@/store/api";

/**
 * Which organisation the console shows, for a person who belongs to more than one (ID-02). Choosing
 * one sets the active organisation every screen reads, and opens its org chart. Nothing is drawn for
 * a person in one organisation, or for an operator inside one in God mode.
 */
export function OrganisationSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const me = useGetMeQuery(undefined);
  const active = useActiveOrganisation();
  const id = useId();
  const organisations = organisationsOf(me.data);
  if (organisations.length < 2 || active.entered) return null;
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <label htmlFor={id} className={compact ? "sr-only" : "font-medium"}>
        Working in
      </label>
      <Select
        id={id}
        value={active.organisation?.slug ?? ""}
        onChange={(e) => {
          chooseOrganisation(e.target.value);
          navigate(paths.home());
        }}
        className={compact ? "w-auto max-w-full" : "sm:w-auto"}
      >
        {organisations.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
