import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDeviceRequest } from "./device";
import { getSession, getWorld, goto, onHostChange, reset } from "./host";
import { clock } from "./server/engine";
import { PERSONAS, SCENARIOS } from "./world/scenarios";
import { INVITATION_CODE } from "./world/default";

/**
 * The demo's own chrome. Standalone, a slim strip says it is a demo on mock data and lets the
 * person switch persona and scenario or reset; embedded in the academy, there is none. The
 * device sheet is the one exception: it stands in for the person's phone or laptop, so it is
 * shown either way.
 */

function useHost() {
  const [, bump] = useState(0);
  useEffect(() => onHostChange(() => bump((n) => n + 1)), []);
  return getSession();
}

export function DemoStrip() {
  const session = useHost();
  // Whoever is signed in now: they may have signed in, or out, since the persona was chosen.
  const signedIn = getWorld().sessionUserId;
  const shown = [...PERSONAS.values()].find((p) => p.userId !== null && p.userId === signedIn)?.name ?? (signedIn ? session.persona : PERSONAS.get(session.persona)?.userId ? "signed-out" : session.persona);
  const [playing, setPlaying] = useState(clock.playing);
  const [speed, setSpeed] = useState(clock.speed);
  return (
    <div data-demo-chrome="" role="region" aria-label="Demo controls" className="sticky top-0 z-40 flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-ink px-4 py-2 text-sm text-surface">
      <strong className="font-semibold">Demo — mock data</strong>
      <label className="flex items-center gap-2">
        <span className="sr-only text-surface/70 sm:not-sr-only">Signed in as</span>
        <select value={shown} onChange={(e) => goto({ persona: e.target.value })} className="min-h-touch w-40 rounded-xs bg-surface px-2 text-ink sm:w-auto">
          {[...PERSONAS.values()].map((p) => (
            <option key={p.name} value={p.name}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="sr-only text-surface/70 sm:not-sr-only">Scenario</span>
        <select value={session.scenario} onChange={(e) => goto({ scenario: e.target.value })} className="min-h-touch w-40 rounded-xs bg-surface px-2 text-ink sm:w-auto">
          {[...SCENARIOS.values()].map((s) => (
            <option key={s.name} value={s.name}>
              {s.title}
            </option>
          ))}
          {!SCENARIOS.has(session.scenario) && <option value={session.scenario}>{session.scenario}</option>}
        </select>
      </label>
      <span className="flex items-center gap-2">
        <button
          type="button"
          className="min-h-touch rounded-xs px-2 font-semibold underline"
          onClick={() => {
            clock.playing = !clock.playing;
            setPlaying(clock.playing);
          }}
        >
          {playing ? "Pause the work" : "Play the work"}
        </button>
        <button
          type="button"
          className="min-h-touch rounded-xs px-2 font-semibold underline"
          aria-label={`Speed: ${speed} times`}
          onClick={() => {
            clock.speed = speed >= 8 ? 1 : speed * 2;
            setSpeed(clock.speed);
          }}
        >
          {speed}×
        </button>
      </span>
      {session.persona === "invited" && <span className="text-surface/70">Invitation code: {INVITATION_CODE}</span>}
      <button type="button" onClick={() => reset()} className="ml-auto min-h-touch rounded-xs px-2 font-semibold underline">
        Reset the demo
      </button>
    </div>
  );
}

export function DeviceSheet() {
  const req = useDeviceRequest();
  if (!req) return null;
  const registering = req.action === "register";
  return (
    <div data-demo-chrome="" className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="demo-device-title" className="flex w-full max-w-form flex-col gap-4 rounded-md bg-surface p-6 text-ink shadow-raised">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Your device</p>
        <h2 id="demo-device-title" className="text-xl font-semibold">
          {registering ? "Create a passkey for endgame.example?" : "Sign in to endgame.example with a passkey?"}
        </h2>
        <p className="text-ink-body">
          {registering ? `A passkey for ${req.account ?? "this account"} will be saved on this device.` : "Choose the passkey to use. This stands in for your phone or laptop's own prompt."}
        </p>
        {registering ? (
          <Button onClick={() => req.resolve(req.choices[0]?.id ?? "ok")}>Save the passkey</Button>
        ) : req.choices.length === 0 ? (
          <p className="rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">This device holds no passkey for Endgame.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {req.choices.map((c) => (
              <li key={c.id}>
                <Button variant="outline" className="w-full justify-start" onClick={() => req.resolve(c.id)}>
                  {c.label}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" onClick={() => req.resolve(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
