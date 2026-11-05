export interface ViewportTransform {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export class CanvasController {
  constructor(
    private viewport: HTMLElement,
    private world: HTMLElement,
    private getTransform: () => ViewportTransform,
    private setTransform: (next: ViewportTransform) => void
  ) {}

  apply(): void {
    const t = this.getTransform();
    this.world.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.zoom})`;
    // Viewport-anchored dot grid gives the appearance of an unbounded plane.
    this.viewport.style.setProperty("--inkdown-grid-x", `${t.x % (24 * t.zoom)}px`);
    this.viewport.style.setProperty("--inkdown-grid-y", `${t.y % (24 * t.zoom)}px`);
  }

  screenToWorld(clientX: number, clientY: number): CanvasPoint {
    const rect = this.viewport.getBoundingClientRect();
    const t = this.getTransform();
    return {
      x: (clientX - rect.left - t.x) / t.zoom,
      y: (clientY - rect.top - t.y) / t.zoom
    };
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.viewport.getBoundingClientRect();
    const t = this.getTransform();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const worldX = (sx - t.x) / t.zoom;
    const worldY = (sy - t.y) / t.zoom;
    const zoom = Math.max(0.2, Math.min(3.5, t.zoom * factor));
    this.setTransform({
      zoom,
      x: sx - worldX * zoom,
      y: sy - worldY * zoom
    });
    this.apply();
  }

  zoomBy(factor: number): void {
    const rect = this.viewport.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  panBy(dx: number, dy: number): void {
    const t = this.getTransform();
    this.setTransform({ ...t, x: t.x + dx, y: t.y + dy });
    this.apply();
  }

  fit(objects: Array<{x:number;y:number;width:number;height:number}>): void {
    if (!objects.length) return;
    const rect = this.viewport.getBoundingClientRect();
    const minX = Math.min(...objects.map(o => o.x));
    const minY = Math.min(...objects.map(o => o.y));
    const maxX = Math.max(...objects.map(o => o.x + o.width));
    const maxY = Math.max(...objects.map(o => o.y + o.height));
    const padding = 100;
    const zoom = Math.max(0.2, Math.min(2.2,
      Math.min((rect.width - padding * 2) / Math.max(1, maxX - minX),
               (rect.height - padding * 2) / Math.max(1, maxY - minY))));
    this.setTransform({
      zoom,
      x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom
    });
    this.apply();
  }
}