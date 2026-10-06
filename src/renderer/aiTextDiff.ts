export type AiTextChange = { kind: "equal" | "added" | "removed"; text: string };

function append(changes: AiTextChange[], kind: AiTextChange["kind"], text: string): void {
  if (!text) return;
  const previous = changes.at(-1);
  if (previous?.kind === kind) previous.text += text;
  else changes.push({ kind, text });
}

function compareTokens(before: string[], after: string[]): AiTextChange[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const left = before.slice(start, before.length - end);
  const right = after.slice(start, after.length - end);
  const changes: AiTextChange[] = [];
  append(changes, "equal", before.slice(0, start).join(""));
  // Bound memory and work for model responses with many unrelated lines.
  // The coarse replacement remains lossless and never hides either version.
  if (!left.length || !right.length || (left.length + 1) * (right.length + 1) > 250_000) {
    append(changes, "removed", left.join(""));
    append(changes, "added", right.join(""));
  } else {
    const width = right.length + 1;
    const lengths = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
      lengths[i * width + j] = left[i] === right[j] ? 1 + lengths[(i + 1) * width + j + 1]
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
    let i = 0, j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        append(changes, "equal", left[i]); i++; j++;
      } else if (i < left.length && (j === right.length || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) {
        append(changes, "removed", left[i++]);
      } else append(changes, "added", right[j++]);
    }
  }
  append(changes, "equal", end ? before.slice(before.length - end).join("") : "");
  return changes;
}

export function compareAiText(before: string, after: string): AiTextChange[] {
  // Align complete lines first, then refine each replacement using Unicode
  // characters. This preserves distant unchanged paragraphs and emoji.
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const coarse = compareTokens(lines(before), lines(after));
  const changes: AiTextChange[] = [];
  for (let index = 0; index < coarse.length; index++) {
    const part = coarse[index];
    if (part.kind === "equal") { append(changes, part.kind, part.text); continue; }
    let removed = "", added = "";
    while (index < coarse.length && coarse[index].kind !== "equal") {
      if (coarse[index].kind === "removed") removed += coarse[index].text;
      else added += coarse[index].text;
      index++;
    }
    index--;
    for (const change of compareTokens(Array.from(removed), Array.from(added))) append(changes, change.kind, change.text);
  }
  return changes;
}
