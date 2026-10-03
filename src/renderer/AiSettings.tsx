import { useRef, useState } from "react";
import { ChevronLeft, LoaderCircle, Sparkles } from "lucide-react";
import type { AiConfig, AiConnectionResult } from "../shared/types.js";
import { aiConnectionErrorMessages, t, type Locale, type MessageKey } from "./i18n.js";

export default function AiSettings({ config, locale, onClose, onSaved, onCleared }: {
  config: AiConfig | null; locale: Locale; onClose: () => void;
  onSaved: (config: AiConfig) => void; onCleared: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "https://api.openai.com/v1");
  const [model, setModel] = useState(config?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiConnectionResult | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const lock = useRef(false);

  async function submit(clear = false): Promise<void> {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const result = clear ? await window.desktopTabs.clearAiConfig()
        : await window.desktopTabs.saveAiConfig({ baseUrl, model, apiKey });
      if (result.status === "saved") { setApiKey(""); onSaved(result.config); }
      else if (result.status === "cleared") { setApiKey(""); onCleared(); }
      else setError(result.status === "invalid" ? "aiConfigInvalid" : "aiSecureUnavailable");
    } catch { setError("aiSecureUnavailable"); }
    finally { lock.current = false; setBusy(false); }
  }

  async function testConnection(): Promise<void> {
    if (lock.current) return;
    lock.current = true; setBusy(true); setTesting(true); setTestResult(null); setError(null);
    try { setTestResult(await window.desktopTabs.testAiConnection({ baseUrl, model, apiKey })); }
    catch { setTestResult({ status: "error", message: "secure-storage" }); }
    finally { lock.current = false; setBusy(false); setTesting(false); }
  }

  function edited(): void { setTestResult(null); setError(null); }

  const testMessage = testResult?.status === "connected"
    ? t("aiTestSuccess", locale).replace("{model}", testResult.model).replace("{ms}", String(testResult.latencyMs))
    : testResult?.status === "error" ? t(aiConnectionErrorMessages[testResult.message] ?? "aiTestFailed", locale) : null;

  return <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <button type="button" className="popover-back" disabled={busy} onClick={onClose}><ChevronLeft size={12} />{t("back", locale)}</button>
    <div className="provider-heading"><Sparkles size={15} /><strong>{t("aiSettings", locale)}</strong>
      {config && <span className="configured-label">{t("configured", locale)}</span>}</div>
    <p className="credential-hint">{t("aiConfigHint", locale)}</p>
    <label className="credential-field"><span>{t("aiBaseUrl", locale)}</span>
      <input type="url" required disabled={busy} value={baseUrl} autoComplete="off" onChange={(event) => { setBaseUrl(event.target.value); edited(); }} /></label>
    <p className="credential-hint">{t("aiBaseUrlHint", locale)}</p>
    <label className="credential-field"><span>{t("aiModel", locale)}</span>
      <input required disabled={busy} value={model} autoComplete="off" placeholder={t("aiModelPlaceholder", locale)} onChange={(event) => { setModel(event.target.value); edited(); }} /></label>
    <label className="credential-field"><span>{t("aiApiKey", locale)}</span>
      <input type="password" disabled={busy} value={apiKey} autoComplete="new-password" spellCheck={false}
        placeholder={t(config ? "aiKeySavedPlaceholder" : "aiKeyPlaceholder", locale)} onChange={(event) => { setApiKey(event.target.value); edited(); }} /></label>
    <p className="credential-hint">{t("aiSecureHint", locale)}</p>
    {error && <p className="credential-hint ai-config-error" role="alert">{t(error, locale)}</p>}
    <div className="ai-test-section"><button type="button" className="ai-test-button" disabled={busy} aria-busy={testing} onClick={() => void testConnection()}>
      {testing && <LoaderCircle size={12} className="spin" />}{t(testing ? "aiTestingConnection" : "aiTestConnection", locale)}</button>
      <p className="credential-hint">{t("aiTestHint", locale)}</p>
      {testMessage && <p className={`credential-hint ai-test-result ${testResult?.status === "error" ? "ai-config-error" : ""}`}
        role={testResult?.status === "error" ? "alert" : "status"}>{testMessage}</p>}</div>
    <div className="credential-actions"><button type="button" className="secondary-action" disabled={busy} onClick={onClose}>{t("cancel", locale)}</button>
      <button type="submit" className="primary-action" disabled={busy}>{busy && !testing && <LoaderCircle size={12} className="spin" />}{t("saveConfig", locale)}</button></div>
    {config && <button type="button" className="clear-config" disabled={busy} onClick={() => void submit(true)}>{t("clearConfig", locale)}</button>}
  </form>;
}
