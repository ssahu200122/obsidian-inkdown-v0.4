export type ToolMode = "select" | "pen" | "eraser";

export interface InkPoint {
  x: number;
  y: number;
  pressure: number;
}

export interface InkStroke {
  id: string;
  color: string;
  width: number;
  points: InkPoint[];
}

export interface TextObject {
  id: string;
  type: "text";
  x: number;
  y: number;
  width: number;
  height: number;
  markdown: string;
  isPrimary?: boolean;
}

export type CanvasObject = TextObject;

export interface SpatialDocument {
  version: 2;
  notePath: string;
  viewport: { x: number; y: number; zoom: number };
  objects: CanvasObject[];
  strokes: InkStroke[];
}

export function makeId(): string {
  return `ink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createDefaultSpatialDocument(notePath: string, markdown = ""): SpatialDocument {
  return {
    version: 2,
    notePath,
    viewport: { x: 80, y: 60, zoom: 1 },
    objects: [{
      id: makeId(), type: "text", x: 130, y: 110, width: 620, height: 420,
      markdown, isPrimary: true
    }],
    strokes: []
  };
}