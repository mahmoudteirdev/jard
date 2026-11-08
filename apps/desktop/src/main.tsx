import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Fonts are bundled (OFL), never fetched: the app works offline.
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

// The single source for colours, spacing and type; generated from design/tokens.json.
import "../../../design/tokens.css";
import "./app.css";

import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
