import type { ReactNode } from "react";

/** The console frame: a brand header and a bounded, full-width main area. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-page items-center gap-3 px-4 sm:px-6 lg:px-10">
          <img src="/brand/endgame-mark.svg" alt="" width={28} height={28} className="size-7" />
          <span className="font-display text-lg font-semibold tracking-tight">Endgame</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-page flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">{children}</main>
    </div>
  );
}
