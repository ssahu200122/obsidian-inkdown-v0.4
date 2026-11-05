import { SpatialDocument } from "../types";

export class CommandManager {
  private undoStack: SpatialDocument[] = [];
  private redoStack: SpatialDocument[] = [];

  constructor(private onChange: (document: SpatialDocument) => void) {}

  checkpoint(document: SpatialDocument): void {
    this.undoStack.push(JSON.parse(JSON.stringify(document)) as SpatialDocument);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: SpatialDocument): SpatialDocument | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(JSON.parse(JSON.stringify(current)) as SpatialDocument);
    this.onChange(previous);
    return previous;
  }

  redo(current: SpatialDocument): SpatialDocument | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(JSON.parse(JSON.stringify(current)) as SpatialDocument);
    this.onChange(next);
    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}