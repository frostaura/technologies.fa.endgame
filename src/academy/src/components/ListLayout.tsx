import type { ReactNode } from "react";
import { Page } from "./Shell.tsx";
import { PageHeader, type Crumb } from "./PageHeader.tsx";

/**
 * The one layout of every list of flows — a path, an area, who you are, how a flow is reached: the
 * page header (the trail, the title, what it covers, how many) in a column that stays in view beside
 * the list on a wide screen, then whatever the page keeps there (its progress, its sections). Below a
 * wide screen the header sits on top and `bar` (an area's section chips) sticks under the site header.
 */
export function ListLayout({ crumbs, title, lede, meta, tag, aside, bar, children }: { crumbs: Crumb[]; title: string; lede: string; meta?: ReactNode; tag?: string; aside?: ReactNode; bar?: ReactNode; children: ReactNode }) {
  return (
    <Page>
      <div className="grid gap-8 lg:grid-cols-3 lg:gap-12 2xl:grid-cols-4">
        <div className="min-w-0 lg:sticky lg:top-header lg:self-start lg:pt-2">
          <PageHeader crumbs={crumbs} title={title} lede={lede} meta={meta} tag={tag} />
          {aside}
        </div>
        <div className="min-w-0 lg:col-span-2 2xl:col-span-3">
          {bar}
          {children}
        </div>
      </div>
    </Page>
  );
}
