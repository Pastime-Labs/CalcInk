import { describe, expect, it, vi } from "vitest";
import type { SavedPage } from "../db";
import { SaveQueue } from "./save-queue";

function record(title: string): SavedPage {
  return {
    page: {
      schemaVersion: 2,
      id: "page",
      title,
      createdAt: 1,
      updatedAt: 1,
      strokes: [],
    },
    corrections: {},
  };
}

describe("SaveQueue", () => {
  it("serializes writes and coalesces pending snapshots", async () => {
    let release: (() => void) | undefined;
    const saved: string[] = [];
    const save = vi.fn(async (value: SavedPage) => {
      saved.push(value.page.title);
      if (value.page.title === "first") {
        await new Promise<void>((resolve) => { release = resolve; });
      }
    });
    const queue = new SaveQueue(save, () => {});
    queue.enqueue(record("first"));
    queue.enqueue(record("middle"));
    queue.enqueue(record("last"));
    expect(saved).toEqual(["first"]);
    release?.();
    await queue.flush();
    expect(saved).toEqual(["first", "last"]);
    expect(queue.status).toBe("saved");
  });

  it("keeps a failed snapshot for explicit retry", async () => {
    let fail = true;
    const saved: string[] = [];
    const queue = new SaveQueue(async (value) => {
      if (fail) throw new Error("disk full");
      saved.push(value.page.title);
    }, () => {});
    queue.enqueue(record("ink"));
    await expect(queue.flush()).rejects.toThrow("disk full");
    expect(queue.status).toBe("not-saved");
    expect(queue.hasUnsavedChanges()).toBe(true);
    queue.enqueue(record("newer ink"));
    expect(queue.status).toBe("not-saved");
    fail = false;
    queue.retry();
    await queue.flush();
    expect(saved).toEqual(["newer ink"]);
    expect(queue.hasUnsavedChanges()).toBe(false);
  });

  it("flushes a successor write enqueued by a save callback", async () => {
    let release: (() => void) | undefined;
    let added = false;
    const saved: string[] = [];
    let queue!: SaveQueue;
    queue = new SaveQueue(async (value) => {
      if (value.page.title === "second") {
        await new Promise<void>((resolve) => { release = resolve; });
      }
      saved.push(value.page.title);
    }, (status) => {
      if (status === "saved" && !added) {
        added = true;
        queue.enqueue(record("second"));
      }
    });
    queue.enqueue(record("first"));
    let flushed = false;
    const flush = queue.flush().then(() => { flushed = true; });
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(flushed).toBe(false);
    release?.();
    await flush;
    expect(saved).toEqual(["first", "second"]);
  });
});
