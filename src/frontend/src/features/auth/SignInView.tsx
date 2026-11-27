import { useId, useState, type FormEvent } from "react";
import { TITLE } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { LINK } from "@/components/ui/layout";
import { RISE, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/Icon";
import { Skeleton } from "@/components/states";
import { describeError } from "@/lib/queryState";
import { navigate } from "@/lib/router";
import { useAppDispatch, useAppSelector } from "@/store";
import {
  api,
  useDevelopmentSignInMutation,
  useGetAuthOptionsQuery,
  usePasskeyLoginCompleteMutation,
  usePasskeyLoginOptionsMutation,
  usePasskeyRegisterCompleteMutation,
  usePasskeyRegisterOptionsMutation,
} from "@/store/api";
import { registerOptionsWithInvitation } from "@/store/sensitive";
import { rememberReturnTo, takeReturnTo } from "./returnTo";
import { assertionJson, describePasskeyError, passkeysSupported, registrationJson, toCreationOptions, toRequestOptions } from "./webauthn";

const LEADS: { icon: "organisation" | "credits" | "verdict" | "secrets"; title: string; text: string }[] = [
  { icon: "organisation", title: "One tree for everything you own", text: "Permissions, secrets, budgets and context set once, inherited all the way down." },
  { icon: "credits", title: "Cost you can predict", text: "An estimate before work starts, a cap at every level, and no charge for fixing its own mistakes." },
  { icon: "verdict", title: "Research that can say no", text: "Every idea is argued against first, and the verdict can stop a build." },
  { icon: "secrets", title: "The same services under every app", text: "Sign-in, data, secrets and AI come with each app, the same way every time." },
];

type Busy = null | "login" | "register" | "development";

/** A refusal whose words are already the server's, in plain language. */
class Refused extends Error {}

async function invited(body: { displayName: string; email: string; invitationCode: string }) {
  const outcome = await registerOptionsWithInvitation(body);
  if (!outcome.ok) throw new Refused(outcome.reason);
  return outcome.data;
}

export function SignInView() {
  const options = useGetAuthOptionsQuery(undefined);
  const [loginOptions] = usePasskeyLoginOptionsMutation();
  const [loginComplete] = usePasskeyLoginCompleteMutation();
  const [registerOptions] = usePasskeyRegisterOptionsMutation();
  const [registerComplete] = usePasskeyRegisterCompleteMutation();
  const [developmentSignIn] = useDevelopmentSignInMutation();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const nameId = useId();
  const emailId = useId();
  const codeId = useId();
  const supported = passkeysSupported();
  const dispatch = useAppDispatch();
  // Read as the screen first draws: the console replaces the address with /sign-in straight after.
  // Only a signed-out arrival keeps it; after a session on this page it was the previous person's.
  const hadSession = useAppSelector((s) => s.ui.hadSession);
  const [returnTo] = useState(() => rememberReturnTo(!hadSession));

  const run = async (kind: Exclude<Busy, null>, work: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await work();
      const next = takeReturnTo(returnTo);
      if (next) {
        // The session is read again first, so the console waits for it instead of sending the person back to sign in.
        void dispatch(api.endpoints.getMe.initiate(undefined, { forceRefetch: true, subscribe: false }));
        navigate(next, { replace: true });
      }
    } catch (e) {
      if (e instanceof Refused) setError(e.message);
      else setError(e && typeof e === "object" && "status" in e ? describeError(e as never) : describePasskeyError(e));
    } finally {
      setBusy(null);
    }
  };

  const signIn = () =>
    run("login", async () => {
      const { publicKey } = await loginOptions(undefined).unwrap();
      const credential = (await navigator.credentials.get({ publicKey: toRequestOptions(publicKey) })) as PublicKeyCredential | null;
      if (!credential) throw new Error("No passkey was chosen.");
      await loginComplete({ credential: assertionJson(credential) }).unwrap();
    });

  const register = (event: FormEvent) => {
    event.preventDefault();
    void run("register", async () => {
      const who = { displayName: displayName.trim(), email: email.trim() };
      const code = invitationCode.trim();
      const { publicKey } = code ? await invited({ ...who, invitationCode: code }) : await registerOptions(who).unwrap();
      const credential = (await navigator.credentials.create({ publicKey: toCreationOptions(publicKey) })) as PublicKeyCredential | null;
      if (!credential) throw new Error("No passkey was created.");
      await registerComplete({ credential: registrationJson(credential) }).unwrap();
    });
  };

  return (
    // One composed page on the house look: the sign-in card and, beside it from md up (under it on a phone),
    // what Endgame does, centred in the screen as one block whose two columns share a top. Black on white, one accent.
    // The safe-area insets sit on the outer box and the 16 px gutter inside it, so neither overrides the other (real-stack 59).
    <div className="flex min-h-screen bg-ground pl-safe-l pr-safe-r">
      <div className="flex w-full items-center justify-center px-4 py-10 sm:px-8">
      <div className="grid w-full max-w-page grid-cols-1 items-start gap-10 md:grid-cols-2 lg:gap-16">
      <div className="flex flex-col gap-8 rounded-lg border bg-surface px-6 py-8 shadow-card sm:px-10 sm:py-10">
        <div className="flex items-center gap-2.5">
          <img src="/brand/endgame-mark.svg" alt="" width={40} height={40} className="size-10" />
          <span className="font-display text-2xl font-bold tracking-tight">Endgame</span>
        </div>
        <div className="flex max-w-form flex-col gap-3 animate-rise motion-reduce:animate-none">
          <h1 className={TITLE}>{creating ? "Create your passkey" : "Sign in"}</h1>
          <p className="text-base text-ink-body">
            {creating
              ? "Your device keeps the key; Endgame never sees a password, because there is none."
              : "Use the passkey on this device. There is no password to remember or to lose."}
          </p>
        </div>

        {!supported && (
          <p role="alert" className="max-w-form rounded-xs bg-attention-tint px-4 py-3 text-sm text-attention-text">
            This browser cannot use passkeys. Open Endgame in a current browser on a device with a screen lock.
          </p>
        )}

        {error && (
          <p role="alert" data-state="failed" className="max-w-form rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-sm text-attention-text">
            {error}
          </p>
        )}

        {creating ? (
          <form onSubmit={register} className="flex max-w-form flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor={nameId} className="font-medium">
                Your name
              </label>
              <Input
                id={nameId}
                required
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor={emailId} className="font-medium">
                Email address
              </label>
              <Input
                id={emailId}
                type="email"
                required
                autoComplete="email webauthn"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor={codeId} className="font-medium">
                Invitation code
              </label>
              <Input
                id={codeId}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-describedby={`${codeId}-hint`}
                value={invitationCode}
                onChange={(e) => setInvitationCode(e.target.value)}
                className="font-mono"
              />
              <p id={`${codeId}-hint`} className="text-sm text-ink-muted">
                The code you were sent or given when you were invited. It works once. Leave it empty only if you are the first person here.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" disabled={!supported || busy !== null}>
                {busy === "register" ? "Waiting for your device…" : "Create passkey"}
              </Button>
              <Button variant="quiet" onClick={() => setCreating(false)} disabled={busy !== null}>
                I already have one
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex max-w-form flex-col items-start gap-4">
            <Button size="lg" onClick={() => void signIn()} disabled={!supported || busy !== null}>
              <Icon name="secrets" />
              {busy === "login" ? "Waiting for your device…" : "Sign in with a passkey"}
            </Button>
            {/* A question and its link, not a button: the words are the house link (one name, read whole). */}
            <button type="button" className="min-h-touch text-left text-ink-body disabled:text-ink-muted" onClick={() => setCreating(true)} disabled={busy !== null}>
              First time here? <span className={LINK}>Create your passkey</span>
            </button>
          </div>
        )}

        <DevelopmentSignIn
          options={options}
          busy={busy}
          onSignIn={() =>
            void run("development", async () => {
              await developmentSignIn(undefined).unwrap();
            })
          }
        />
      </div>

      {/* Its first line sits level with the card's mark (the card's own top padding), so the two tops read as one. */}
      <aside aria-label="What Endgame does" className="flex flex-col gap-7 px-2 pt-8 max-md:hidden sm:pt-10">
        <p className="font-display text-2xl font-bold leading-10 tracking-tight text-ink">One place to run every product you own</p>
        <ul className="flex flex-col gap-6">
          {LEADS.map((lead, i) => (
            <li key={lead.title} className={cn("flex gap-4", RISE, stagger(i + 1))}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xs border bg-surface text-primary">
                <Icon name={lead.icon} />
              </span>
              <div className="flex flex-col gap-1">
                <span className="font-display text-lg font-semibold">{lead.title}</span>
                <span className="text-ink-body">{lead.text}</span>
              </div>
            </li>
          ))}
        </ul>
      </aside>
      </div>
      </div>
    </div>
  );
}

function DevelopmentSignIn({ options, busy, onSignIn }: { options: ReturnType<typeof useGetAuthOptionsQuery>; busy: Busy; onSignIn: () => void }) {
  if (options.isLoading) {
    return (
      <div role="status" aria-busy="true" className="max-w-form">
        <span className="sr-only">Checking how this deployment signs people in</span>
        <Skeleton className="h-12 w-64" />
      </div>
    );
  }
  if (options.isError) {
    return (
      <p role="alert" data-state="failed" className="max-w-form text-sm text-attention-text">
        Could not check this deployment’s sign-in options: {describeError(options.error)}
      </p>
    );
  }
  if (!options.data?.developmentSignIn) return null;
  return (
    <div className="flex max-w-form flex-col gap-2 rounded-md border bg-ground p-4">
      <span className="text-sm font-semibold text-ink">Development only</span>
      <p className="text-sm text-ink-body">This deployment is in development and offers a sign-in without a passkey.</p>
      <Button variant="secondary" className="self-start" onClick={onSignIn} disabled={busy !== null}>
        {busy === "development" ? "Signing in…" : "Development sign-in"}
      </Button>
    </div>
  );
}
