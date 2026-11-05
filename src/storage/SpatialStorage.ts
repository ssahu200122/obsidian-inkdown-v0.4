import { App, normalizePath, TFile } from "obsidian";
import {
  CanvasObject, createDefaultSpatialDocument, InkStroke, makeId, SpatialDocument
} from "../types";

export class SpatialStorage {
  constructor(private app: App) {}

  getSidecarPath(notePath: string): string {
    return normalizePath(`${notePath}.spatial.json`);
  }

  async load(note: TFile): Promise<SpatialDocument> {
    const path = this.getSidecarPath(note.path);
    const markdown = await this.app.vault.cachedRead(note);
    if (!(await this.app.vault.adapter.exists(path))) {
      return createDefaultSpatialDocument(note.path, markdown);
    }

    try {
      const raw = JSON.parse(await this.app.vault.adapter.read(path));
      if (raw.version === 2 && raw.notePath === note.path &&
          raw.viewport && Array.isArray(raw.objects) && Array.isArray(raw.strokes)) {
        return raw as SpatialDocument;
      }

      // Migrate v0.1-v0.3 sidecars. Keep old ink and card position.
      const viewport = raw.viewport ?? { x: 80, y: 60, zoom: 1 };
      const strokes: InkStroke[] = Array.isArray(raw.strokes) ? raw.strokes : [];
      const objects: CanvasObject[] = [];

      if (Array.isArray(raw.objects)) {
        for (const object of raw.objects) {
          if (object && object.type === "text") objects.push(object as CanvasObject);
        }
      } else if (Array.isArray(raw.blocks)) {
        for (const block of raw.blocks) {
          objects.push({
            id: block.id ?? makeId(), type: "text",
            x: block.x ?? 160, y: block.y ?? 140,
            width: block.width ?? 440, height: block.height ?? 260,
            markdown: block.kind === "note" ? markdown : (block.markdown ?? ""),
            isPrimary: block.kind === "note"
          });
        }
      } else if (raw.noteCard) {
        objects.push({
          id: makeId(), type: "text",
          x: raw.noteCard.x ?? 150, y: raw.noteCard.y ?? 115,
          width: raw.noteCard.width ?? 620, height: 420,
          markdown, isPrimary: true
        });
      }

      if (!objects.some(object => object.isPrimary)) {
        objects.unshift({
          id: makeId(), type: "text", x: 130, y: 110, width: 620, height: 420,
          markdown, isPrimary: true
        });
      }

      return { version: 2, notePath: note.path, viewport, objects, strokes };
    } catch (error) {
      console.error("Inkdown: Invalid spatial sidecar; opening a fresh layout.", error);
      return createDefaultSpatialDocument(note.path, markdown);
    }
  }

  async save(document: SpatialDocument): Promise<void> {
    const path = this.getSidecarPath(document.notePath);
    await this.app.vault.adapter.write(path, JSON.stringify(document, null, 2));
  }
}