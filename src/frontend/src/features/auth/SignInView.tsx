import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { RISE, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/Icon";
import { Skeleton } from "@/components/states";
import { describeError } from "@/lib/queryState";
import {
  useDevelopmentSignInMutation,
  useGetAuthOptionsQuery,
  usePasskeyLoginCompleteMutation,
  usePasskeyLoginOptionsMutation,
  usePasskeyRegisterCompleteMutation,
  usePasskeyRegisterOptionsMutation,
} from "@/store/api";
import { assertionJson, describePasskeyError, passkeysSupported, registrationJson, toCreationOptions, toRequestOptions } from "./webauthn";

const LEADS: { icon: "organisation" | "credits" | "verdict" | "secrets"; title: string; text: string }[] = [
  { icon: "organisation", title: "One tree for everything you own", text: "Permissions, secrets, budgets and context set once, inherited all the way down." },
  { icon: "credits", title: "Cost you can predict", text: "An estimate before work starts, a cap at every level, and no charge for fixing its own mistakes." },
  { icon: "verdict", title: "Research that can say no", text: "Every idea is argued against first, and the verdict can stop a build." },
  { icon: "secrets", title: "The same services under every app", text: "Sign-in, data, secrets and AI come with each app, the same way every time." },
];

type Busy = null | "login" | "register" | "development";

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
  const nameId = useId();
  const emailId = useId();
  const supported = passkeysSupported();

  const run = async (kind: Exclude<Busy, null>, work: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e && typeof e === "object" && "status" in e ? describeError(e as never) : describePasskeyError(e));
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
      const { publicKey } = await registerOptions({ displayName: displayName.trim(), email: email.trim() }).unwrap();
      const credential = (await navigator.credentials.create({ publicKey: toCreationOptions(publicKey) })) as PublicKeyCredential | null;
      if (!credential) throw new Error("No passkey was created.");
      await registerComplete({ credential: registrationJson(credential) }).unwrap();
    });
  };

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <div className="flex flex-col justify-center gap-8 px-4 py-10 sm:px-10 lg:px-16">
        <div className="flex items-center gap-2.5">
          <img src="/brand/endgame-mark.svg" alt="" width={40} height={40} className="size-10" />
          <span className="font-display text-2xl font-bold tracking-tight">Endgame</span>
        </div>
        <div className="flex max-w-form flex-col gap-3 animate-rise motion-reduce:animate-none">
          <h1 className="text-4xl font-semibold leading-tight">{creating ? "Create your passkey" : "Sign in"}</h1>
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
              <input
                id={nameId}
                required
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="min-h-12 rounded-xs border border-border-strong bg-surface px-3.5 text-base"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor={emailId} className="font-medium">
                Email address
              </label>
              <input
                id={emailId}
                type="email"
                required
                autoComplete="email webauthn"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-h-12 rounded-xs border border-border-strong bg-surface px-3.5 text-base"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" disabled={!supported || busy !== null}>
                {busy === "register" ? "Waiting for your device…" : "Create passkey"}
              </Button>
              <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy !== null}>
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
            <Button variant="ghost" onClick={() => setCreating(true)} disabled={busy !== null}>
              First time here? Create your passkey
            </Button>
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

      <aside aria-label="What Endgame does" className="relative hidden overflow-hidden bg-primary px-16 py-16 text-primary-ink lg:flex lg:flex-col lg:justify-center lg:gap-8">
        <div aria-hidden className="absolute -right-16 -top-20 size-aura animate-drift rounded-full bg-violet opacity-75 blur-aura motion-reduce:animate-none" />
        <div aria-hidden className="absolute -bottom-36 right-40 size-aura animate-drift rounded-full bg-teal opacity-75 blur-aura animate-delay-5 motion-reduce:animate-none" />
        <p className="relative text-eyebrow font-semibold uppercase text-primary-ink-soft">One place to run every product you own</p>
        <ul className="relative flex flex-col gap-6">
          {LEADS.map((lead, i) => (
            <li key={lead.title} className={cn("flex gap-4", RISE, stagger(i + 1))}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xs bg-surface text-primary">
                <Icon name={lead.icon} />
              </span>
              <div className="flex flex-col gap-1">
                <span className="font-display text-lg font-semibold">{lead.title}</span>
                <span className="text-primary-tint">{lead.text}</span>
              </div>
            </li>
          ))}
        </ul>
      </aside>
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
    <div className="flex max-w-form flex-col gap-2 rounded-md border border-dashed border-border-strong p-4">
      <span className="text-eyebrow font-semibold uppercase text-ink-muted">Development only</span>
      <p className="text-sm text-ink-body">This deployment is in development and offers a sign-in without a passkey.</p>
      <Button variant="outline" className="self-start" onClick={onSignIn} disabled={busy !== null}>
        {busy === "development" ? "Signing in…" : "Development sign-in"}
      </Button>
    </div>
  );
}
