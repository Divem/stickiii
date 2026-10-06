import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon } from "lucide-react";
import type { NoteAttachment } from "../shared/types.js";
import { t, type Locale } from "./i18n.js";

export default function NoteImage({ noteId, attachment, locale, onOpen, ready = true, compact = false }: {
  noteId: string; attachment: NoteAttachment; locale: Locale; ready?: boolean; compact?: boolean;
  onOpen: (attachment: NoteAttachment) => void;
}) {
  const [source, setSource] = useState(attachment.previewDataUrl);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const previewId = useId();
  const visible = compact && expanded && ready;
  const load = ready && (!compact || visible);
  useEffect(() => { if (!ready) setExpanded(false); }, [ready]);
  useEffect(() => {
    setSource(attachment.previewDataUrl);
    setFailed(false);
  }, [noteId, attachment.id, attachment.previewDataUrl]);
  useEffect(() => {
    let active = true;
    if (!source && !failed && load) {
      void window.desktopTabs.attachmentPreview(noteId, attachment.id)
        .then((url) => { if (active) setSource(url); })
        .catch(() => { if (active) setFailed(true); });
    }
    return () => { active = false; };
  }, [noteId, attachment.id, source, failed, load]);
  useLayoutEffect(() => {
    if (!visible || !trigger.current) { setPosition(null); return; }
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    const height = Math.min(200, Math.max(above, below), window.innerHeight - 24);
    setPosition({
      width, height,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min(below >= height || below >= above ? rect.bottom + 8 : rect.top - height - 8, window.innerHeight - height - 12)),
    });
    const close = () => setExpanded(false);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", escape);
    };
  }, [visible]);
  const image = source && !failed ? <img src={source} alt={attachment.name} loading="lazy" onError={() => setFailed(true)} />
      : <span className="note-image-placeholder" role="status"><ImageIcon size={22} />
        <span>{t(failed ? "imagePreviewFailed" : "imageLoading", locale)}</span></span>;
  return <>
    <button ref={trigger} type="button" className={compact ? "note-image-link" : "note-image-open"}
      title={compact ? undefined : `${t("openImage", locale)} · ${attachment.name}`}
      aria-label={`${t("openImage", locale)} ${attachment.name}`} aria-describedby={visible && position ? previewId : undefined}
      onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)} onBlur={() => setExpanded(false)} onClick={() => onOpen(attachment)}>
      {compact ? <><ImageIcon size={14} /><span>{attachment.name}</span></> : image}
    </button>
    {visible && position && createPortal(<div id={previewId} role="tooltip" className="note-image-hover-preview"
      data-page-theme={trigger.current?.closest("[data-page-theme]")?.getAttribute("data-page-theme") ?? undefined}
      style={position}>{image}</div>, document.body)}
  </>;
}
