import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { attachmentImageId, contentWithAttachmentImages, externalWebUrl } from "../shared/markdown.js";
import type { NoteAttachment } from "../shared/types.js";
import NoteImage from "./NoteImage.js";
import { t, type Locale } from "./i18n.js";
import { memo, type Ref } from "react";

export default memo(function MarkdownPreview({ content, locale, onOpenLink, previewRef, noteId, attachments = [], onOpenAttachment, imageReady }: {
  content: string;
  locale: Locale;
  onOpenLink: (url: string) => void;
  previewRef?: Ref<HTMLDivElement>;
  noteId?: string;
  attachments?: NoteAttachment[];
  onOpenAttachment?: (attachment: NoteAttachment) => void;
  imageReady?: boolean;
}) {
  const body = contentWithAttachmentImages(content, attachments);
  const imageAttachment = (url: string) => attachments.find((item) => item.id === attachmentImageId(url) && item.mimeType.startsWith("image/"));
  return <div ref={previewRef} className="markdown-preview" tabIndex={0} aria-label={t("markdownPreview", locale)}>
    {body.trim() ? <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} skipHtml
      urlTransform={(url, key) => key === "src" && imageAttachment(url) ? url : externalWebUrl(url) ?? ""}
      components={{
        a: ({ href, children }) => href ? <a href={href} onClick={(event) => { event.preventDefault(); onOpenLink(href); }}>{children}</a> : <span>{children}</span>,
        img: ({ src, alt }) => {
          const attachment = typeof src === "string" ? imageAttachment(src) : undefined;
          return attachment && noteId ? <NoteImage noteId={noteId} attachment={attachment} locale={locale} ready={imageReady}
            onOpen={onOpenAttachment ?? (() => {})} /> : src && !attachmentImageId(String(src))
            ? <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" /> : <span>{alt}</span>;
        },
      }}
    >{body}</Markdown> : <p className="preview-empty">{t("notePlaceholder", locale)}</p>}
  </div>;
});
