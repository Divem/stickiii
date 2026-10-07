export class AttachmentPreviewCache {
  private cached = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private bytes = 0;

  constructor(private load: (noteId: string, attachmentId: string) => Promise<string>, private maxBytes = 8 * 1024 * 1024, private maxEntries = 32) {}

  get(noteId: string, attachmentId: string): Promise<string> {
    const key = JSON.stringify([noteId, attachmentId]);
    const cached = this.cached.get(key);
    if (cached !== undefined) {
      this.cached.delete(key); this.cached.set(key, cached);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const job = this.load(noteId, attachmentId).then((source) => {
      const size = source.length * 2;
      if (size <= this.maxBytes) {
        this.cached.set(key, source); this.bytes += size;
        while (this.bytes > this.maxBytes || this.cached.size > this.maxEntries) {
          const oldest = this.cached.keys().next().value!;
          this.bytes -= this.cached.get(oldest)!.length * 2; this.cached.delete(oldest);
        }
      }
      return source;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, job);
    return job;
  }
}
