import { InkPoint, InkStroke, makeId } from "../types";

export class InkController {
  private active: InkStroke | null = null;
  constructor(
    private svg: SVGSVGElement,
    private getPoint: (event: PointerEvent) => InkPoint,
    private getTool: () => "select" | "pen" | "eraser",
    private getStrokes: () => InkStroke[],
    private setStrokes: (strokes: InkStroke[]) => void
  ) {
    this.svg.addEventListener("pointerdown", this.down);
    this.svg.addEventListener("pointermove", this.move);
    this.svg.addEventListener("pointerup", this.up);
    this.svg.addEventListener("pointercancel", this.up);
    this.render();
  }

  destroy(): void {
    this.svg.removeEventListener("pointerdown", this.down);
    this.svg.removeEventListener("pointermove", this.move);
    this.svg.removeEventListener("pointerup", this.up);
    this.svg.removeEventListener("pointercancel", this.up);
  }

  render(): void {
    this.svg.replaceChildren();
    const strokes = this.active ? [...this.getStrokes(), this.active] : this.getStrokes();
    for (const stroke of strokes) {
      if (!stroke.points.length) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      path.setAttribute("points", stroke.points.map(p => `${p.x},${p.y}`).join(" "));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", stroke.color);
      path.setAttribute("stroke-width", String(stroke.width));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      this.svg.appendChild(path);
    }
  }

  private down = (event: PointerEvent): void => {
    const tool = this.getTool();
    if (tool === "select") return;
    event.preventDefault();
    event.stopPropagation();
    this.svg.setPointerCapture(event.pointerId);
    const point = this.getPoint(event);

    if (tool === "eraser") {
      const radius = 24;
      const before = this.getStrokes();
      const after = before.filter(stroke =>
        !stroke.points.some(p => Math.hypot(p.x - point.x, p.y - point.y) < radius)
      );
      if (after.length !== before.length) this.setStrokes(after);
      this.render();
      return;
    }

    this.active = {
      id: makeId(), color: "#d7a24c", width: 3.2, points: [point]
    };
    this.render();
  };

  private move = (event: PointerEvent): void => {
    if (!this.active) return;
    event.preventDefault();
    this.active.points.push(this.getPoint(event));
    this.render();
  };

  private up = (): void => {
    if (!this.active) return;
    this.setStrokes([...this.getStrokes(), this.active]);
    this.active = null;
    this.render();
  };
}