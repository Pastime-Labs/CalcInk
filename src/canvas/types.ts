export type Point = { x: number; y: number; pressure?: number; t?: number };

export type Stroke = { id: string; points: Point[]; width: number };

export type Page = {
  schemaVersion: 2;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  strokes: Stroke[];
};
