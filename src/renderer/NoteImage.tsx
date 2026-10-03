import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { NoteAttachment } from "../shared/types.js";
import { t, type Locale } from "./i18n.js";

export default function NoteImage({ noteId, attachment, locale, onOpen, ready = true }: {
  noteId: string; attachment: NoteAttachment; locale: Locale; ready?: boolean;
  onOpen: (attachment: NoteAttachment) => void;
}) {
  const [source, setSource] = useState(attachment.previewDataUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSource(attachment.previewDataUrl);
    setFailed(false);
    if (!attachment.previewDataUrl && ready) {
      void window.desktopTabs.attachmentPreview(noteId, attachment.id)
        .then((url) => { if (active) setSource(url); })
        .catch(() => { if (active) setFailed(true); });
    }
    return () => { active = false; };
  }, [noteId, attachment.id, attachment.previewDataUrl, ready]);
  return <button type="button" className="note-image-open" title={`${t("openImage", locale)} · ${attachment.name}`}
    aria-label={`${t("openImage", locale)} ${attachment.name}`} onClick={() => onOpen(attachment)}>
    {source && !failed ? <img src={source} alt={attachment.name} loading="lazy" onError={() => setFailed(true)} />
      : <span className="note-image-placeholder" role="status"><ImageIcon size={22} />
        <span>{t(failed ? "imagePreviewFailed" : "imageLoading", locale)}</span></span>}
  </button>;
}
