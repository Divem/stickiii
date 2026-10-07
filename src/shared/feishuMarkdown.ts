import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import type { Root, RootContent, PhrasingContent } from "mdast";
import { attachmentImageId } from "./markdown.js";

const parser = unified().use(remarkParse).use(remarkGfm);
const writer = unified().use(remarkStringify).use(remarkGfm);

// Preserve remote image destinations as links; local attachment images are sent as
// separate media blocks. The note itself remains unchanged; only the Feishu
// payload is normalized.
export function markdownForFeishu(content: string): { content: string; imageLinks: boolean } {
  const tree = parser.parse(content) as Root;
  let imageLinks = false;
  function transform(node: Root | RootContent | PhrasingContent): void {
    if (!("children" in node)) return;
    node.children = node.children.map((child) => {
      if (child.type === "image") {
        if (attachmentImageId(child.url)) return { type: "text", value: child.alt || "" };
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
