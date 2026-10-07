import { Children, isValidElement, useState, type ReactNode } from "react";
import { t, type Locale } from "./i18n.js";

export default function FeedbackStack({ children, locale }: { children: ReactNode; locale: Locale }) {
  const [expanded, setExpanded] = useState(false);
  const items = Children.toArray(children).filter(isValidElement<{ "data-priority"?: number }>);
  items.sort((a, b) => (b.props["data-priority"] ?? 0) - (a.props["data-priority"] ?? 0));
  return <div className={`feedback-stack${expanded ? " expanded" : ""}`} onClick={(event) => event.stopPropagation()}>
    {(expanded ? items : items.slice(0, 1))}
    {items.length > 1 && <button className="feedback-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      {expanded ? t("collapseMessages", locale) : t("moreMessages", locale).replace("{count}", String(items.length - 1))}
    </button>}
  </div>;
}
