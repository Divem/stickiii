import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { attachmentImageId, contentWithAttachmentImages, externalWebUrl } from "../shared/markdown.js";
import type { NoteAttachment } from "../shared/types.js";
import NoteImage from "./NoteImage.js";
import { t, type Locale } from "./i18n.js";
import { createContext, memo, useContext, useLayoutEffect, type Ref } from "react";
import { toggleMarkdownTask } from "./markdownEditing.js";

const TaskLine = createContext<number | null>(null);
function TaskCheckbox({ checked, content, onChange, locale }: { checked: boolean; content: string; onChange?: (content: string) => void; locale: Locale }) {
  const line = useContext(TaskLine);
  return <input type="checkbox" checked={checked} disabled={!onChange || !line} aria-label={t(checked ? "markTaskIncomplete" : "markTaskComplete", locale)} onChange={(event) => {
    if (line && onChange) onChange(toggleMarkdownTask(content, line, event.target.checked));
  }} />;
}

export default memo(function MarkdownPreview({ content, locale, onOpenLink, previewRef, noteId, attachments = [], onOpenAttachment, imageReady, onChange, onReady }: {
  content: string;
  locale: Locale;
  onOpenLink: (url: string) => void;
  previewRef?: Ref<HTMLDivElement>;
  noteId?: string;
  attachments?: NoteAttachment[];
  onOpenAttachment?: (attachment: NoteAttachment) => void;
  imageReady?: boolean;
  onChange?: (content: string) => void;
  onReady?: () => void;
}) {
  useLayoutEffect(() => { onReady?.(); }, [onReady]);
  const body = contentWithAttachmentImages(content, attachments);
  const imageAttachment = (url: string) => attachments.find((item) => item.id === attachmentImageId(url) && item.mimeType.startsWith("image/"));
  return <div ref={previewRef} className="markdown-preview" tabIndex={0} aria-label={t("markdownPreview", locale)}>
    {body.trim() ? <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} skipHtml
      urlTransform={(url, key) => key === "src" && imageAttachment(url) ? url : externalWebUrl(url) ?? ""}
      components={{
        li: ({ node, children, ...props }) => <TaskLine.Provider value={node?.position?.start.line ?? null}><li {...props}>{children}</li></TaskLine.Provider>,
        input: ({ checked }) => <TaskCheckbox checked={checked === true} content={body} onChange={onChange} locale={locale} />,
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
