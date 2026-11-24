import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { routerBasename } from "@endgame/appkit";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// The router's base comes from the page's <base>, which the server sets per address.
createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename()}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
