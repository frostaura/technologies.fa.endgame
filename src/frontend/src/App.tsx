import { useEffect } from "react";
import { Failed, Loading, Skeleton } from "@/components/states";
import { Link } from "@/components/Link";
import { Button, buttonVariants } from "@/components/ui/button";
import { errorStatus, describeError } from "@/lib/queryState";
import { matchRoute, navigate, paths, useLocation } from "@/lib/router";
import { useAppDispatch, useAppSelector } from "@/store";
import { useGetMeQuery } from "@/store/api";
import { modeSet } from "@/store/uiSlice";
import { AppView } from "@/features/apps/AppView";
import { OperatorAccessView } from "@/features/audit/OperatorAccessView";
import { SignInView } from "@/features/auth/SignInView";
import { CreditsView } from "@/features/credits/CreditsView";
import { HomeView } from "@/features/home/HomeView";
import { RunView } from "@/features/runs/RunView";
import { SecretsView } from "@/features/secrets/SecretsView";
import { AppShell } from "@/features/shell/AppShell";
import { StartView } from "@/features/start/StartView";
import { SystemStatusView } from "@/features/status/SystemStatusView";
import { VerdictView } from "@/features/verdict/VerdictView";

/** The session decides what renders: signed out is the sign-in screen, never a broken console. */
export function App() {
  const me = useGetMeQuery(undefined);
  const { pathname } = useLocation();
  const route = matchRoute(pathname);
  const signedOut = me.isError && errorStatus(me.error) === 401;

  // Keep the address honest: a signed-out visitor sits at /sign-in, a signed-in one never does.
  useEffect(() => {
    if (signedOut && route.name !== "sign-in") navigate(paths.signIn(), { replace: true });
    if (me.data && route.name === "sign-in") navigate(paths.home(), { replace: true });
  }, [signedOut, me.data, route.name]);

  if (signedOut) return <SignInView />;
  if (me.isError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-form flex-col justify-center gap-4 px-4">
        <img src="/brand/endgame-mark.svg" alt="" width={40} height={40} className="size-10" />
        <Failed title="Endgame could not check who you are" reason={describeError(me.error)} onRetry={() => void me.refetch()} />
      </main>
    );
  }
  if (!me.data) {
    return (
      <Loading label="Opening Endgame" className="flex min-h-screen flex-col">
        <div className="flex h-16 items-center gap-3 border-b bg-surface px-4 sm:px-8">
          <img src="/brand/endgame-mark.svg" alt="" width={30} height={30} className="size-8" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex flex-col gap-6 px-4 py-8 sm:px-8">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-64 rounded-md" />
        </div>
      </Loading>
    );
  }

  switch (route.name) {
    case "home":
    case "sign-in":
      return <HomeView />;
    case "start":
      return <StartView />;
    case "run":
      return <RunView key={route.id} runId={route.id} />;
    case "idea":
      return <VerdictView key={route.id} ideaId={route.id} />;
    case "app":
      return <AppView key={route.id} appId={route.id} />;
    case "credits":
      return <CreditsView />;
    case "secrets":
      return <SecretsView />;
    case "operator-access":
      return <OperatorAccessView />;
    case "system":
      return <SystemRoute />;
    default:
      return <NotFound />;
  }
}

/** System status is technical detail; in normal mode it is offered, not shown. */
function SystemRoute() {
  const mode = useAppSelector((s) => s.ui.mode);
  const dispatch = useAppDispatch();
  return (
    <AppShell crumbs={[{ label: "System" }]}>
      {mode === "technical" ? (
        <SystemStatusView />
      ) : (
        <section className="flex max-w-form flex-col items-start gap-4">
          <h1 className="text-3xl font-semibold">System status is technical detail</h1>
          <p className="text-ink-body">It names the services Endgame runs on, so it is shown in technical mode only.</p>
          <Button onClick={() => dispatch(modeSet("technical"))}>Switch to technical mode</Button>
        </section>
      )}
    </AppShell>
  );
}

function NotFound() {
  return (
    <AppShell crumbs={[{ label: "Not found" }]}>
      <section className="flex max-w-form flex-col items-start gap-4">
        <h1 className="text-3xl font-semibold">Nothing lives at this address</h1>
        <p className="text-ink-body">The link may be old, or the thing it pointed to was removed.</p>
        <Link href={paths.home()} className={buttonVariants()}>
          Back to the org chart
        </Link>
      </section>
    </AppShell>
  );
}
