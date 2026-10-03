import type { SavedPage } from "../db";

export type SaveStatus = "saved" | "saving" | "not-saved";

export class SaveQueue {
  private pending: SavedPage | null = null;
  private running: Promise<void> | null = null;
  private failure: unknown = null;
  private state: SaveStatus = "saved";

  constructor(
    private readonly save: (record: SavedPage) => Promise<void>,
    private readonly onStatus: (status: SaveStatus) => void,
  ) {}

  get status(): SaveStatus {
    return this.state;
  }

  enqueue(record: SavedPage): void {
    this.pending = structuredClone(record);
    this.setStatus(this.failure === null ? "saving" : "not-saved");
    this.start();
  }

  async flush(): Promise<void> {
    while (true) {
      if (this.failure !== null) throw this.failure;
      if (this.pending && !this.running) this.start();
      const current = this.running;
      if (!current) return;
      await current;
    }
  }

  retry(): void {
    if (!this.pending) return;
    this.failure = null;
    this.setStatus("saving");
    this.start();
  }

  hasUnsavedChanges(): boolean {
    return this.pending !== null || this.running !== null || this.failure !== null;
  }

  private setStatus(status: SaveStatus): void {
    if (this.state === status) return;
    this.state = status;
    this.onStatus(status);
  }

  private start(): void {
    if (this.running || this.failure !== null || !this.pending) return;
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.pending && this.failure === null) this.start();
    });
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const record = this.pending;
      this.pending = null;
      try {
        await this.save(record);
      } catch (error) {
        this.pending ??= record;
        this.failure = error;
        this.setStatus("not-saved");
        return;
      }
    }
    this.setStatus("saved");
  }
}
