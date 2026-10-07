import { describe, expect, it } from "vitest";
import { StoredDataError, validateSavedPage } from "./validation";

describe("saved stroke metadata", () => {
  const record = {
    page: {
      schemaVersion: 2,
      id: "page-1",
      title: "Page",
      createdAt: 1,
      updatedAt: 1,
      strokes: [{
        id: "mark",
        width: 3,
        color: "#aBc123",
        style: "pencil",
        points: [{ x: 1, y: 2, t: 3 }],
      }],
    },
    corrections: {},
  };

  it("accepts old strokes and valid style/color while rejecting malformed metadata", () => {
    expect(validateSavedPage(record, "page-1")).toEqual(record);
    const old = structuredClone(record);
    delete (old.page.strokes[0] as { color?: string }).color;
    delete (old.page.strokes[0] as { style?: string }).style;
    expect(validateSavedPage(old, "page-1")).toEqual(old);
    expect(() => validateSavedPage({
      ...record,
      page: { ...record.page, strokes: [{ ...record.page.strokes[0], color: "red" }] },
    }, "page-1")).toThrow(StoredDataError);
    expect(() => validateSavedPage({
      ...record,
      page: { ...record.page, strokes: [{ ...record.page.strokes[0], style: "marker" }] },
    }, "page-1")).toThrow(StoredDataError);
  });
});
