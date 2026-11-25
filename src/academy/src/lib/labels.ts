import type { Level, Reach, Role } from "../content/types.ts";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  builder: "Builder",
  viewer: "Viewer",
  operator: "Operator",
  "end-user": "App end user",
  assistant: "AI assistant",
  developer: "App developer",
  "host-admin": "Host administrator",
};

export const ROLE_BLURB: Record<Role, string> = {
  owner: "You own the organisation: money, people, and what may go public.",
  admin: "You run the organisation day to day: people, budgets, secrets.",
  builder: "You turn ideas into apps and keep them changing.",
  viewer: "You read what is happening, and change nothing.",
  operator: "FrostAura, in God mode, with every entry logged.",
  "end-user": "You use an app someone built on Endgame.",
  assistant: "An AI assistant working through a key and MCP.",
  developer: "You build on the app kit, or call the API.",
  "host-admin": "You run the machine Endgame is hosted on.",
};

export const REACH_LABEL: Record<Reach, string> = {
  screen: "On a screen",
  api: "API or assistant only",
  cli: "Command line",
  automatic: "Automatic",
  none: "No route",
};

export const REACH_BLURB: Record<Reach, string> = {
  screen: "Flows you follow in the console or a hosted app.",
  api: "Flows with no screen: only the API or an AI assistant reaches them.",
  cli: "Flows run from a terminal on the host.",
  automatic: "Things Endgame does by itself, which you watch happen.",
  none: "Entries the reading found with no route at all.",
};

export const LEVEL_BLURB: Record<Level, string> = {
  Foundation: "Day one: sign in, read the home screen, start an idea, read a verdict, open an app.",
  Core: "Running an organisation day to day: people, hiring, credits, apps, secrets, autonomy.",
  Advanced: "For the person who owns the setup: rule sets, tighter limits, assistants, technical mode.",
  Developer: "Through the API, an AI assistant or the app kit.",
  Operator: "FrostAura only: God mode, provisioning, prices, backups, Cloudflare, deploying.",
};
