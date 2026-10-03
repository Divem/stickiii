import type { Note, NoteAttachment } from "../shared/types.js";

function sameAttachments(a: NoteAttachment[], b: NoteAttachment[]): boolean {
  return a === b || (a.length === b.length && a.every((item, index) => {
    const other = b[index];
    return item.id === other.id && item.name === other.name && item.size === other.size &&
      item.mimeType === other.mimeType && item.storedPath === other.storedPath && item.previewDataUrl === other.previewDataUrl;
  }));
}

export function sameNoteDraft(a: Note, b: Note): boolean {
  return a.content === b.content && (a.theme ?? "paper") === (b.theme ?? "paper") && sameAttachments(a.attachments, b.attachments);
}

export function hasNoteContent(note: Note): boolean {
  return !!note.content.trim() || note.attachments.length > 0;
}

// All local writes share a queue. Queued jobs read the latest draft when they
// start, and a flush drains edits made while an earlier write was in flight.
export class NoteSaveQueue {
  private latest = new Map<string, Note>();
  private stored = new Map<string, Note>();
  private deleted = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private write: (note: Note) => Promise<Note>, private onSaved: (note: Note) => void = () => {}) {}

  seed(notes: Note[]): void {
    this.deleted.clear();
    this.latest = new Map(notes.map((note) => [note.id, note]));
    this.stored = new Map(this.latest);
  }

  track(note: Note): void { this.latest.set(note.id, note); }
  read(id: string): Note | undefined { return this.latest.get(id); }
  isStored(id: string): boolean { return this.stored.has(id); }

  isDirty(id: string): boolean {
    const note = this.latest.get(id);
    if (!note) return false;
    const saved = this.stored.get(id);
    return saved ? !sameNoteDraft(note, saved) : hasNoteContent(note);
  }

  acceptStored(saved: Note): void {
    this.stored.set(saved.id, saved);
    const current = this.latest.get(saved.id);
    this.latest.set(saved.id, !current || sameNoteDraft(current, saved) ? saved : {
      ...current, createdAt: saved.createdAt, feishu: saved.feishu, feishuTargets: saved.feishuTargets,
    });
    this.onSaved(saved);
  }

  // Other windows own these notes. Replace both snapshots so a stale main
  // draft can never become a write after ownership returns to the library.
  acceptExternal(saved: Note): void {
    if (this.deleted.has(saved.id)) return;
    const previous = this.stored.get(saved.id);
    if (previous && Date.parse(saved.updatedAt) < Date.parse(previous.updatedAt)) return;
    this.stored.set(saved.id, saved);
    this.latest.set(saved.id, saved);
    this.onSaved(saved);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(job);
    this.tail = pending.catch(() => {});
    return pending;
  }

  private async writeLatest(id: string): Promise<void> {
    if (!this.isDirty(id)) return;
    const snapshot = this.latest.get(id)!;
    this.acceptStored(await this.write(snapshot));
  }

  save(id: string): Promise<void> { return this.enqueue(() => this.writeLatest(id)); }

  flush(id?: string): Promise<void> {
    return this.enqueue(async () => {
      let dirty: string[];
      do {
        dirty = [...this.latest.keys()].filter((key) => (id === undefined || id === key) && this.isDirty(key));
        for (const key of dirty) await this.writeLatest(key);
      } while (dirty.length > 0);
    });
  }

  remove(id: string, destroy: () => Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      await destroy();
      this.deleted.add(id);
      this.latest.delete(id);
      this.stored.delete(id);
    });
  }
}
