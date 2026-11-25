/** The contract between the demo and a hosted app's view (see `HostedAppView`). */

export type HostedAppState = "running" | "asleep" | "paused" | "crashed" | "not-published" | "slow" | "busy" | "unreachable" | "outage";

export interface HostedVisitor {
  /**
   * Who is looking at the app, decided by the demo's persona.
   * - `member`: a member of the organisation with a role on the app.
   * - `member-without-access`: signed in to Endgame, with no role on this app.
   * - `invited`: an address the app was shared with, not yet registered (so not signed in here).
   * - `end-user`: registered at this app and signed in to it.
   * - `signed-out`: nobody is signed in.
   */
  kind: "member" | "member-without-access" | "invited" | "end-user" | "signed-out";
  displayName: string | null;
  email: string | null;
  /** End users of a shared app only: false once the app is no longer shared with them (ACC-12). Default true. */
  stillShared?: boolean;
}

export interface HostedApp {
  id: string;
  name: string;
  organisationName: string;
  access: "private" | "shared" | "public";
  state: HostedAppState;
  /** Absolute addresses, e.g. `https://endgame.example/acme/community/club/reading-list/`. A missing scheme reads as https. */
  addresses: { path: string; subdomain: string };
  /** Why a paused app is paused: the organisation's overdraft limit (default) or a spent monthly budget. */
  pausedReason?: "overdraft" | "budget";
}

export interface PasskeyPrompt {
  action: "sign-in" | "register";
  /** The host the passkey belongs to: always the platform's own host, where sign-in happens. */
  site: string;
  /** The account being registered; null when signing in (the device offers its passkeys). */
  account: string | null;
}

export interface HostedContext {
  app: HostedApp;
  /** Which of the two addresses the visitor used. */
  form: "path" | "subdomain";
  /** The path inside the app after its base, e.g. "" or "books/new"; may carry a query. */
  rest: string;
  visitor: HostedVisitor;
  /** Simulated passkey ceremony: resolves true if the person approved on "their device". */
  passkey(prompt: PasskeyPrompt): Promise<boolean>;
  /** Check a shared app's invitation: null when the email+code are valid, else the exact refusal the Edge would show. */
  checkInvitation(email: string, code: string): string | null;
  /** Called when the visitor's state changes (signed in, registered, signed out). Update `visitor` from it. */
  onVisitorChange(next: HostedVisitor): void;
  /** Navigate within the app (the demo maps this to its hash route). */
  navigate(rest: string): void;
  /** Leave the app back to the console. */
  exit(): void;

  /** How long a sleeping app takes to wake, in milliseconds. Default 2000. */
  wakeMs?: number;
  /** Called once a sleeping app has woken, so the demo can mark it running. */
  onWake?(): void;
  /**
   * Who approving "Sign in with a passkey" (the member button) signs in as. Default: the current
   * visitor's name and address, as a member with a role. Pass `member-without-access` to walk ACC-10.
   */
  memberAccount?: HostedVisitor;
  /**
   * The end user whose passkey for this app is on this device, for "Sign in with your passkey".
   * Default: whoever registered or signed out here earlier in the page's life; else none, and the
   * Edge's "That passkey could not be verified for this app." is shown.
   */
  returningEndUser?: HostedVisitor | null;
  /** True when the address is already registered with this app (sign-up then refuses). Default: only addresses registered here earlier. */
  isRegistered?(email: string): boolean;
}
