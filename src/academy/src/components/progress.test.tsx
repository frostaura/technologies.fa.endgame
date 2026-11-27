import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StepPager } from "./StepPager.tsx";
import { Medal, ProgressRing } from "./ProgressMarks.tsx";
import { useSwipe } from "../lib/swipe.ts";

afterEach(cleanup);

describe("the step pager", () => {
  const pager = (props: Partial<Parameters<typeof StepPager>[0]> = {}) =>
    render(<StepPager variant="bar" active={1} total={4} furthest={1} onPrev={() => {}} onNext={() => {}} end={<button type="button">Finish</button>} {...props} />);

  it("names its controls for a screen reader, and says where the learner is in words", () => {
    pager({ active: 2 });
    expect(screen.getByRole("group", { name: "Step controls" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous step" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next step" })).toBeTruthy();
    expect(screen.getByText("Step 2 of 4")).toBeTruthy();
  });

  it("cannot go before the first step, and goes on with Next", () => {
    const onNext = vi.fn();
    pager({ onNext });
    expect((screen.getByRole("button", { name: "Previous step" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("on the last step offers what ends the flow instead of Next", () => {
    pager({ active: 4, furthest: 4 });
    expect(screen.queryByRole("button", { name: "Next step" })).toBeNull();
    expect(screen.getByRole("button", { name: "Finish" })).toBeTruthy();
  });

  it("a flow picked up part-way offers the beginning", () => {
    const onRestart = vi.fn();
    pager({ active: 3, resumed: { step: 3, onRestart } });
    expect(screen.getByText("Picked up where you left off, at step 3.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start from the beginning" }));
    expect(onRestart).toHaveBeenCalledOnce();
  });
});

describe("progress marks", () => {
  it("a ring says its count in words, not by colour alone", () => {
    render(<ProgressRing done={12} total={77} label="Foundation: 12 of 77 flows done" />);
    expect(screen.getByRole("img", { name: "Foundation: 12 of 77 flows done" })).toBeTruthy();
  });

  it("a medal says whether it is earned", () => {
    render(<><Medal earned mark="01" label="Foundation badge: earned" /><Medal earned={false} mark="02" label="Core badge: not yet" /></>);
    expect(screen.getByRole("img", { name: "Foundation badge: earned" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Core badge: not yet" }).textContent).toBe("02");
  });
});

function Swipeable({ onLeft, onRight }: { onLeft: () => void; onRight: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useSwipe(ref, { onLeft, onRight });
  return (
    <div ref={ref} data-testid="area">
      <input aria-label="field" />
    </div>
  );
}

const touch = (el: Element, type: "touchStart" | "touchEnd", x: number, y: number) =>
  fireEvent[type](el, { touches: type === "touchStart" ? [{ clientX: x, clientY: y }] : [], changedTouches: [{ clientX: x, clientY: y }] });

describe("swiping", () => {
  it("a sideways swipe moves on or back; a scroll, a short stroke or a stroke in a field does not", () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    render(<Swipeable onLeft={onLeft} onRight={onRight} />);
    const area = screen.getByTestId("area");
    touch(area, "touchStart", 300, 400);
    touch(area, "touchEnd", 120, 410);
    expect(onLeft).toHaveBeenCalledOnce();
    touch(area, "touchStart", 100, 400);
    touch(area, "touchEnd", 300, 390);
    expect(onRight).toHaveBeenCalledOnce();
    // Mostly vertical: a scroll.
    touch(area, "touchStart", 200, 600);
    touch(area, "touchEnd", 120, 300);
    // Too short.
    touch(area, "touchStart", 200, 400);
    touch(area, "touchEnd", 170, 400);
    // In a field.
    const field = screen.getByRole("textbox", { name: "field" });
    touch(field, "touchStart", 300, 400);
    touch(field, "touchEnd", 100, 400);
    expect(onLeft).toHaveBeenCalledOnce();
    expect(onRight).toHaveBeenCalledOnce();
  });
});

describe("a ring's figure", () => {
  it("says <1% for a start too small to round, never a misleading 0%", () => {
    render(<ProgressRing done={1} total={288} label="1 of 288" />);
    expect(screen.getByRole("img", { name: "1 of 288" }).textContent).toBe("<1%");
  });
  it("draws a locked badge as a badge to come, not a dot", () => {
    render(<Medal earned={false} label="Ten flows: not yet" />);
    expect(screen.getByRole("img", { name: "Ten flows: not yet" }).querySelector("svg")).not.toBeNull();
  });
});
