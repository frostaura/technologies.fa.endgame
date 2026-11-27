/** Every symbol in `public/brand/icons.svg`. `iconNames.test.ts` keeps this list and the sprite in step. */
export const ICON_NAMES = [
  "organisation",
  "division",
  "project",
  "app",
  "employee",
  "contractors",
  "research",
  "verdict",
  "plan",
  "build",
  "evaluate",
  "publish",
  "credits",
  "health",
  "always-on",
  "asleep",
  "private",
  "public",
  "secrets",
  "assistants",
  "incoming-data",
  "schedules",
  "email",
  "god-mode",
  "notifications",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/**
 * The colour of a `tinted` icon. The house look has one accent and black on white (ARCH-011): an icon
 * takes one quiet ink whatever its kind; colour is kept for status tags and the accent for actions.
 */
export const ICON_KIND: Record<IconName, string> = {
  organisation: "text-ink-body",
  division: "text-ink-body",
  project: "text-ink-body",
  app: "text-ink-body",
  employee: "text-ink-body",
  contractors: "text-ink-body",
  research: "text-ink-body",
  verdict: "text-ink-body",
  plan: "text-ink-body",
  build: "text-ink-body",
  evaluate: "text-ink-body",
  publish: "text-ink-body",
  credits: "text-ink-body",
  health: "text-ink-body",
  "always-on": "text-ink-body",
  asleep: "text-ink-body",
  private: "text-ink-body",
  public: "text-ink-body",
  secrets: "text-ink-body",
  assistants: "text-ink-body",
  "incoming-data": "text-ink-body",
  schedules: "text-ink-body",
  email: "text-ink-body",
  "god-mode": "text-ink-body",
  notifications: "text-ink-body",
};
