export type Point = { x: number; y: number; pressure?: number; t?: number };

export const PAGE_WIDTH = 840;
export const PAGE_HEIGHT = 1188;

export type StrokeStyle = "pen" | "pencil";
export type Stroke = {
  id: string;
  points: Point[];
  width: number;
  color?: string;
  style?: StrokeStyle;
};

export type PaperTemplate = "blank" | "ruled" | "grid" | "dots";
export type PageGeometry = "a4" | "legacy";

type PageBase = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  strokes: Stroke[];
};

export type Page = PageBase & (
  | { schemaVersion: 2; geometry?: never; template?: never }
  | { schemaVersion: 3; geometry: PageGeometry; template: PaperTemplate }
);
