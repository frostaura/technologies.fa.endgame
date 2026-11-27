import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { routerBasename } from "@endgame/appkit";
import { AppErrorBoundary, rootOptions } from "@endgame/appkit/ui";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// The router's base comes from the page's <base>, which the server sets per address. The kit's boundary at the root keeps
// a render error anywhere from blanking the page (App has one around each page too); rootOptions reports what it caught once.
createRoot(root, rootOptions).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter basename={routerBasename()}>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
