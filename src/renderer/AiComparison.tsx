import { useMemo, useState } from "react";
import type { NoteAttachment } from "../shared/types.js";
import { compareAiText, type AiTextChange } from "./aiTextDiff.js";
import { t, type Locale } from "./i18n.js";
import MarkdownPreview from "./MarkdownPreview.js";

function ChangeText({ changes }: { changes: AiTextChange[] }) {
  return <>{changes.map((change, index) => change.kind === "added" ? <ins key={index}>{change.text}</ins>
    : change.kind === "removed" ? <del key={index}>{change.text}</del> : <span key={index}>{change.text}</span>)}</>;
}

export default function AiComparison({ originalContent, content, locale, noteId, attachments, onOpenLink, onOpenAttachment }: {
  originalContent: string; content: string; locale: Locale; noteId: string; attachments: NoteAttachment[];
  onOpenLink: (url: string) => void; onOpenAttachment: (attachment: NoteAttachment) => void;
}) {
  const [view, setView] = useState<"original" | "result" | "diff">("diff");
  const changes = useMemo(() => compareAiText(originalContent, content), [originalContent, content]);
  const views = ["original", "result", "diff"] as const;
  const labels = { original: "aiOriginal", result: "aiResult", diff: "aiDifferences" } as const;
  return <div className="ai-comparison">
    <div className="ai-comparison-tabs" role="group" aria-label={t("aiComparisonViews", locale)}>
      {views.map((item) => <button key={item} type="button" aria-pressed={view === item} onClick={() => setView(item)}>{t(labels[item], locale)}</button>)}
    </div>
    {view === "diff" ? <>
      <div className="ai-diff-legend"><span className="ai-diff-added">+ {t("aiAdded", locale)}</span><span className="ai-diff-removed">− {t("aiRemoved", locale)}</span></div>
      <div className="ai-diff-scroll" tabIndex={0} aria-label={t("aiDifferences", locale)}>
        <div className="ai-diff-inline"><ChangeText changes={changes} /></div>
        <div className="ai-diff-columns"><section><h3>{t("aiOriginal", locale)}</h3><div><ChangeText changes={changes.filter((item) => item.kind !== "added")} /></div></section>
          <section><h3>{t("aiResult", locale)}</h3><div><ChangeText changes={changes.filter((item) => item.kind !== "removed")} /></div></section></div>
      </div>
    </> : <MarkdownPreview content={view === "original" ? originalContent : content} locale={locale} noteId={noteId} attachments={attachments}
      onOpenLink={onOpenLink} onOpenAttachment={onOpenAttachment} />}
  </div>;
}
