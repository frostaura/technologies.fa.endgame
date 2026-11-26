import { useEffect, useRef } from "react";
import { LEVELS, type Level } from "./content/types.ts";
import { useLocation, href } from "./lib/router.ts";
import { flow, isOperator } from "./lib/data.ts";
import { Shell } from "./components/Shell.tsx";
import { Cover } from "./pages/Cover.tsx";
import { Learn, PathPage } from "./pages/Learn.tsx";
import { AreaPage, Browse, ReachPage, RolePage } from "./pages/Browse.tsx";
import { SearchPage } from "./pages/SearchPage.tsx";
import { FlowPage } from "./pages/FlowPage.tsx";
import { DemoPage } from "./pages/DemoPage.tsx";
import { OperatorHome } from "./pages/OperatorHome.tsx";
import { About } from "./pages/About.tsx";
import { ProgressPage } from "./pages/ProgressPage.tsx";
import { Finish } from "./pages/Finish.tsx";
import { PrintPage } from "./pages/PrintPage.tsx";
import { NotFound } from "./pages/NotFound.tsx";

const TITLE = "The Endgame Academy";

export function App() {
  const { parts, query, hash } = useLocation();
  const [head = "", a = "", b = "", c = ""] = parts;

  // A new page starts at its top, unless the address names a step to land on, and keyboard focus
  // moves to its content so the next Tab or arrow key acts on the page that was opened.
  // A step within the page that is open (scrolling, Back, a link to another step) is not a new page;
  // a new page opened at a step lands on it, not at the top.
  const first = useRef(true);
  useEffect(() => {
    if (!/\/step\/\d/.test(window.location.hash)) window.scrollTo({ top: 0 });
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [head, a]);

  if (head === "print") return <PrintPage operator={a === "operator"} />;
  if (head === "demo") return <DemoPage back={query.get("back") ? href(query.get("back") ?? "/") : href("/")} />;

  let page = <NotFound />;
  let operator = false;
  let title = TITLE;
  if (!head) page = <Cover />;
  else if (head === "learn") page = <Learn />;
  else if (head === "path" && (LEVELS as readonly string[]).includes(a) && a !== "Operator") page = <PathPage level={a as Level} />;
  else if (head === "browse") page = <Browse />;
  else if (head === "area") page = <AreaPage id={a} />;
  else if (head === "who") page = <RolePage role={a} />;
  else if (head === "reach") page = <ReachPage reach={a} />;
  else if (head === "search") {
    operator = query.get("scope") === "operator";
    page = <SearchPage q={query.get("q") ?? ""} operator={operator} />;
  } else if (head === "flow") {
    const f = flow(a);
    operator = !!f && isOperator(f);
    title = f ? `${f.id} ${f.title} · ${TITLE}` : TITLE;
    page = <FlowPage key={hash.split("/step/")[0]} id={a} step={b === "step" && /^\d+$/.test(c) ? Number(c) : null} />;
  } else if (head === "operator") {
    operator = true;
    if (!a) page = <OperatorHome />;
    else if (a === "area") page = <AreaPage id={b} operator />;
    else if (a === "who") page = <RolePage role={b} operator />;
    else if (a === "reach") page = <ReachPage reach={b} operator />;
    else if (a === "browse") page = <Browse operator />;
  } else if (head === "about") page = <About />;
  else if (head === "progress") {
    page = <ProgressPage />;
    title = `Your progress · ${TITLE}`;
  }
  else if (head === "finish") page = <Finish />;

  return (
    <Shell operator={operator}>
      <Title text={operator && !head.startsWith("flow") ? `Operator handbook · ${TITLE}` : title} />
      {page}
    </Shell>
  );
}

function Title({ text }: { text: string }) {
  useEffect(() => {
    document.title = text;
  }, [text]);
  return null;
}
