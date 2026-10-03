import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { externalWebUrl } from "../shared/markdown.js";
import { t, type Locale } from "./i18n.js";
import { memo, type Ref } from "react";

export default memo(function MarkdownPreview({ content, locale, onOpenLink, previewRef }: {
  content: string;
  locale: Locale;
  onOpenLink: (url: string) => void;
  previewRef?: Ref<HTMLDivElement>;
}) {
  return <div ref={previewRef} className="markdown-preview" tabIndex={0} aria-label={t("markdownPreview", locale)}>
    {content.trim() ? <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} skipHtml
      urlTransform={(url) => externalWebUrl(url) ?? ""}
      components={{
        a: ({ href, children }) => href ? <a href={href} onClick={(event) => { event.preventDefault(); onOpenLink(href); }}>{children}</a> : <span>{children}</span>,
        img: ({ src, alt }) => src ? <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" /> : <span>{alt}</span>,
      }}
    >{content}</Markdown> : <p className="preview-empty">{t("notePlaceholder", locale)}</p>}
  </div>;
});
