import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./lab.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LabProvider } from "./store";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LabProvider>
      <App />
    </LabProvider>
  </StrictMode>,
);
