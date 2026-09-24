import React from "react";
import ReactDOM from "react-dom/client";
import "@/i18n";
import ScribePanel from "./ScribePanel";
import "./scribe.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ScribePanel />
  </React.StrictMode>,
);
