import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/foundation.css";

function DevelopmentStatus() {
  return (
    <main className="dev-status">
      <h1>BoardOps rewrite foundation</h1>
      <p>Phase 00/01 only. The product UI is intentionally not approximated here.</p>
      <p>The actual BoardOps frontend will be ported from the golden master after the source-audit gate.</p>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    {window.location.pathname === "/dev" ? <DevelopmentStatus /> : <div data-boardops-product-root />}
  </StrictMode>,
);
