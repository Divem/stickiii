import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { toString } from "mdast-util-to-string";
import type { Root, RootContent, PhrasingContent } from "mdast";

const parser = unified().use(remarkParse).use(remarkGfm);
const writer = unified().use(remarkStringify).use(remarkGfm);

export function markdownTitle(content: string): string {
  return toString(parser.parse(content.split(/\r\n|\n|\r/, 1)[0]), { includeHtml: false }).trim();
}

export function externalWebUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// Preserve image destinations as links until binary media upload is supported.
// The note itself remains unchanged; only the payload sent to Feishu is normalized.
export function markdownForFeishu(content: string): { content: string; imageLinks: boolean } {
  const tree = parser.parse(content) as Root;
  let imageLinks = false;
  function transform(node: Root | RootContent | PhrasingContent): void {
    if (!("children" in node)) return;
    node.children = node.children.map((child) => {
      if (child.type === "image") {
        imageLinks = true;
        return { type: "link", url: child.url, title: child.title, children: [{ type: "text", value: child.alt || child.url }] };
      }
      if (child.type === "imageReference") {
        imageLinks = true;
        return { type: "linkReference", identifier: child.identifier, label: child.label,
          referenceType: child.referenceType, children: [{ type: "text", value: child.alt || child.identifier }] };
      }
      transform(child);
      return child;
    }) as typeof node.children;
  }
  transform(tree);
  return { content: writer.stringify(tree), imageLinks };
}
