import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { tillfalligtTema } from "./shell/tema";
import "./stil.css";

tillfalligtTema();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
