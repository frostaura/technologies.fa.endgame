import { AppShell } from "@/components/AppShell";
import { SystemStatusView } from "@/features/status/SystemStatusView";

export function App() {
  return (
    <AppShell>
      <SystemStatusView />
    </AppShell>
  );
}
