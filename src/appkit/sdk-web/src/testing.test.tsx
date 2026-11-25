import { fireEvent, screen } from "@testing-library/react";
import { Link, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp, setBase } from "./testing.js";

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

function TinyApp() {
  return (
    <Routes>
      <Route path="/" element={<Link to="/courts/new" data-testid="new-court">Book a court</Link>} />
      <Route path="/courts/new" element={<section data-testid="page-new-court"><Where /></section>} />
    </Routes>
  );
}

afterEach(() => setBase(`${window.location.origin}/`));

describe("renderApp", () => {
  it("renders the app at an address, and a click on a link shows the page it routes to", () => {
    renderApp(<TinyApp />, { at: "/" });
    fireEvent.click(screen.getByTestId("new-court"));
    expect(screen.getByTestId("page-new-court")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/courts/new");
  });

  it("starts at the address given", () => {
    renderApp(<TinyApp />, { at: "/courts/new" });
    expect(screen.getByTestId("page-new-court")).toBeTruthy();
  });

  it("serves the app under a prefix when given one, with the page's <base> set to it", () => {
    renderApp(<TinyApp />, { at: "/", base: "https://endgame.example.test/acme/labs/demo/" });
    expect(document.baseURI).toBe("https://endgame.example.test/acme/labs/demo/");
    expect(screen.getByTestId("new-court").getAttribute("href")).toBe("/acme/labs/demo/courts/new");
    fireEvent.click(screen.getByTestId("new-court"));
    expect(screen.getByTestId("where").textContent).toBe("/courts/new");
  });
});
