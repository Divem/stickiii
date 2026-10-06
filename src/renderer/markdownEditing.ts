export type MarkdownEdit = { start: number; end: number; text: string; selectionStart: number; selectionEnd: number };

function inCodeFence(content: string, position: number): boolean {
  let fence: string | null = null;
  for (const line of content.slice(0, position).split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!marker) continue;
    if (!fence) fence = marker[1];
    else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
  }
  return fence !== null;
}

export function continueMarkdownList(content: string, start: number, end: number): MarkdownEdit | null {
  if (start !== end || inCodeFence(content, start)) return null;
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const line = content.slice(lineStart, start);
  const match = line.match(/^( {0,3}|\t*)([-+*]|\d+[.)]) (\[[ xX]\] )?(.*)$/);
  if (!match) return null;
  if (!match[4].trim() && (content[start] === "\n" || start === content.length)) {
    return { start: lineStart, end, text: "", selectionStart: lineStart, selectionEnd: lineStart };
  }
  const marker = /^\d/.test(match[2]) ? `${Number.parseInt(match[2], 10) + 1}${match[2].slice(-1)}` : match[2];
  const text = `\n${match[1]}${marker} ${match[3] ? "[ ] " : ""}`;
  return { start, end, text, selectionStart: start + text.length, selectionEnd: start + text.length };
}

export function toggleMarkdownBold(content: string, start: number, end: number): MarkdownEdit | null {
  if (inCodeFence(content, start)) return null;
  const selected = content.slice(start, end);
  if (start >= 2 && content.slice(start - 2, start) === "**" && content.slice(end, end + 2) === "**") {
    return { start: start - 2, end: end + 2, text: selected, selectionStart: start - 2, selectionEnd: end - 2 };
  }
  if (selected.length >= 4 && selected.startsWith("**") && selected.endsWith("**")) {
    return { start, end, text: selected.slice(2, -2), selectionStart: start, selectionEnd: end - 4 };
  }
  return { start, end, text: `**${selected}**`, selectionStart: start + 2, selectionEnd: end + 2 };
}

export function toggleMarkdownTask(content: string, line: number, checked: boolean): string {
  const lines = content.split("\n");
  if (line < 1 || line > lines.length || inCodeFence(content, lines.slice(0, line - 1).join("\n").length)) return content;
  lines[line - 1] = lines[line - 1].replace(/^(\s*(?:[-+*]|\d+[.)])\s+\[)[ xX](\])/, `$1${checked ? "x" : " "}$2`);
  return lines.join("\n");
}
