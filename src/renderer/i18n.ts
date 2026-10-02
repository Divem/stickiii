export const messages = {
  appName: ["Desk Tabs", "Desk Tabs"],
  productTagline: ["把想法放在手边", "Keep ideas within reach"],
  allNotes: ["全部记录", "All notes"],
  searchPlaceholder: ["搜索记录", "Search notes"],
  newNote: ["新建记录", "New note"],
  emptyTitle: ["从一条记录开始", "Start with one note"],
  emptyDescription: ["按下快捷键，写下此刻的想法。文字、图片和文件都可以放进来。", "Press the shortcut and capture the moment. Text, images, and files all belong here."],
  startWriting: ["开始记录", "Start writing"],
  untitled: ["未命名记录", "Untitled note"],
  notePlaceholder: ["记录此刻的想法…", "Capture the thought…"],
  addAttachment: ["添加图片或文件", "Add image or file"],
  localSaved: ["本地已保存", "Saved locally"],
  saving: ["保存中…", "Saving…"],
  sync: ["同步", "Sync"],
  synced: ["已同步", "Synced"],
  close: ["关闭窗口", "Close window"],
  minimize: ["最小化窗口", "Minimize window"],
  deleteNote: ["删除记录", "Delete note"],
  deleteConfirm: ["确定删除这条记录吗？", "Delete this note?"],
  noResults: ["没有找到匹配记录", "No matching notes"],
  attachmentCount: ["个附件", "attachments"],
  localFirst: ["本地优先", "Local first"],
  integrations: ["同步到", "Sync to"],
  comingSoon: ["连接器即将开放", "Connector coming soon"],
  notion: ["Notion", "Notion"],
  feishu: ["飞书", "Lark"],
  syncNotConfigured: ["还没有配置连接器。先在设置里连接 Notion 或飞书。", "No connector is configured yet. Connect Notion or Lark in settings first."],
  syncSuccess: ["已同步到", "Synced to"],
  syncError: ["同步失败，请稍后重试。", "Sync failed. Try again later."],
  fileOpenError: ["无法打开这个文件。", "This file could not be opened."],
} as const;

export type MessageKey = keyof typeof messages;
export type Locale = "zh" | "en";

export function t(key: MessageKey, locale: Locale): string {
  return messages[key][locale === "en" ? 1 : 0];
}
