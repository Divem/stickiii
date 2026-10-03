import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./styles.css";
import { desktopTabs } from "./desktop.js";
import type { NoteWindowContext } from "../shared/types.js";
import { t } from "./i18n.js";

window.desktopTabs = desktopTabs;

function DesktopApp() {
  const [context, setContext] = useState<NoteWindowContext | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    void desktopTabs.getWindowContext().then((value) => { if (!disposed) setContext(value); })
      .catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; };
  }, [attempt]);
  if (context) return <App context={context} />;
  return <main className="app-shell"><div className="empty-note" role="status">
    {t(failed ? "windowActionFailed" : "loadingNotes", "zh")}
    {failed && <button onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>{t("retryLoad", "zh")}</button>}
  </div></main>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
);
