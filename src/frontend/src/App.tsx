import { Suspense, lazy, useEffect } from "react";
import { Failed, Loading, Skeleton } from "@/components/states";
import { Link } from "@/components/Link";
import { Button, buttonVariants } from "@/components/ui/button";
import { errorStatus, describeError } from "@/lib/queryState";
import { matchRoute, navigate, paths, useLocation, type Route } from "@/lib/router";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAppDispatch, useAppSelector } from "@/store";
import { useGetMeQuery } from "@/store/api";
import { modeSet } from "@/store/uiSlice";
import { SignInView } from "@/features/auth/SignInView";
import { HomeView } from "@/features/home/HomeView";
import { AppShell } from "@/features/shell/AppShell";

/** Every screen but the org chart loads when first opened, so the console opens fast. */
const AppView = lazy(() => import("@/features/apps/AppView").then((x) => ({ default: x.AppView })));
const OperatorAccessView = lazy(() => import("@/features/audit/OperatorAccessView").then((x) => ({ default: x.OperatorAccessView })));
const CreditsView = lazy(() => import("@/features/credits/CreditsView").then((x) => ({ default: x.CreditsView })));
const RunView = lazy(() => import("@/features/runs/RunView").then((x) => ({ default: x.RunView })));
const SecretsView = lazy(() => import("@/features/secrets/SecretsView").then((x) => ({ default: x.SecretsView })));
const StartView = lazy(() => import("@/features/start/StartView").then((x) => ({ default: x.StartView })));
const SystemStatusView = lazy(() => import("@/features/status/SystemStatusView").then((x) => ({ default: x.SystemStatusView })));
const VerdictView = lazy(() => import("@/features/verdict/VerdictView").then((x) => ({ default: x.VerdictView })));
const AutonomyView = lazy(() => import("@/features/autonomy/AutonomyView").then((x) => ({ default: x.AutonomyView })));
const EmployeeView = lazy(() => import("@/features/workforce/EmployeeView").then((x) => ({ default: x.EmployeeView })));
const HireView = lazy(() => import("@/features/workforce/HireView").then((x) => ({ default: x.HireView })));
const HiresView = lazy(() => import("@/features/workforce/HiresView").then((x) => ({ default: x.HiresView })));
const PeopleView = lazy(() => import("@/features/people/PeopleView").then((x) => ({ default: x.PeopleView })));
const AssistantsView = lazy(() => import("@/features/assistants/AssistantsView").then((x) => ({ default: x.AssistantsView })));
const NotificationsView = lazy(() => import("@/features/notifications/NotificationsView").then((x) => ({ default: x.NotificationsView })));
const SuggestionsView = lazy(() => import("@/features/suggestions/SuggestionsView").then((x) => ({ default: x.SuggestionsView })));
const OperatorView = lazy(() => import("@/features/operator/OperatorView").then((x) => ({ default: x.OperatorView })));

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

  // A crash anywhere inside a screen is caught here at worst, never a blank page.
  return (
    <ErrorBoundary name="This screen" variant="route" resetKey={pathname}>
      <Suspense
        fallback={
          <Loading label="Opening the screen" className="flex min-h-screen flex-col gap-6 px-4 py-8 sm:px-8">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-64 rounded-md" />
          </Loading>
        }
      >
        <Screen route={route} />
      </Suspense>
    </ErrorBoundary>
  );
}

function Screen({ route }: { route: Route }) {
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
    case "employee":
      return <EmployeeView key={route.id} employeeId={route.id} />;
    case "hire":
      return <HireView key={route.id} hireId={route.id} />;
    case "hires":
      return <HiresView />;
    case "autonomy":
      return <AutonomyView />;
    case "people":
      return <PeopleView />;
    case "assistants":
      return <AssistantsView />;
    case "notifications":
      return <NotificationsView />;
    case "suggestions":
      return <SuggestionsView />;
    case "operator":
      return <OperatorView />;
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
