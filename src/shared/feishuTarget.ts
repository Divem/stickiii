import type { FeishuDocument, FeishuSyncMode, Note } from "./types.js";

export type FeishuTarget = { kind: "docx" | "wiki"; token: string; url: string };

export function parseFeishuTarget(value: string): FeishuTarget | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !(url.hostname === "feishu.cn" || url.hostname.endsWith(".feishu.cn"))) return undefined;
    const match = /^\/(docx|wiki)\/([a-zA-Z0-9]+)\/?$/.exec(url.pathname);
    if (!match) return undefined;
    return { kind: match[1] as "docx" | "wiki", token: match[2], url: url.href };
  } catch { return undefined; }
}

export function feishuTargetKey(appId: string, mode: FeishuSyncMode, target?: FeishuTarget): string {
  return mode === "create" ? `${appId}:create` : `${appId}:append:${target?.kind}:${target?.token}`;
}

export function selectFeishuDocument(note: Note, key: string, appId: string, mode: FeishuSyncMode): FeishuDocument | undefined {
  if (note.feishu?.targetKey === key) return note.feishu;
  if (note.feishuTargets?.[key]) return note.feishuTargets[key];
  // Migrate the previous single-document mapping without creating another document.
  if (mode === "create" && note.feishu && !note.feishu.targetKey && !note.feishu.mode && note.feishu.appId === appId) return note.feishu;
  return undefined;
}
