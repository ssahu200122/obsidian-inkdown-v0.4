import {
  ItemView, MarkdownRenderer, Notice, setIcon, TFile, WorkspaceLeaf
} from "obsidian";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import type InkdownPlugin from "../main";
import { CanvasController } from "../canvas/CanvasController";
import { InkController } from "../canvas/InkController";
import { CommandManager } from "../commands/CommandManager";
import { CanvasObject, makeId, SpatialDocument, TextObject, ToolMode } from "../types";
import { SpatialStorage } from "../storage/SpatialStorage";

export const SPATIAL_VIEW_TYPE = "inkdown-spatial-view";

export class SpatialView extends ItemView {
  private plugin: InkdownPlugin;
  private storage: SpatialStorage;
  private file: TFile | null = null;
  private document: SpatialDocument | null = null;
  private viewportEl!: HTMLDivElement;
  private worldEl!: HTMLDivElement;
  private svgEl!: SVGSVGElement;
  private statusEl!: HTMLSpanElement;
  private zoomLabel!: HTMLSpanElement;
  private canvas!: CanvasController;
  private ink!: InkController;
  private history!: CommandManager;
  private tool: ToolMode = "select";
  private selectedId: string | null = null;
  private saveTimer: number | null = null;
  private spaceDown = false;
  private gestureCleanup: (() => void) | null = null;
  private objectElements = new Map<string, HTMLDivElement>();
  private renderToken = 0;
  private pendingPath: string | null = null;
  private contextDismiss: ((event: PointerEvent) => void) | null = null;
  private pendingInsertion: HTMLTextAreaElement | null = null;
  private codeEditors = new Map<string, EditorView>();
  private editorModeCompartments = new Map<string, Compartment>();

  constructor(leaf: WorkspaceLeaf, plugin: InkdownPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.storage = new SpatialStorage(plugin.app);
  }

  getViewType(): string { return SPATIAL_VIEW_TYPE; }
  getDisplayText(): string { return this.file ? `Inkdown · ${this.file.basename}` : "Inkdown"; }
  getIcon(): string { return "pen-tool"; }
  getState(): Record<string, unknown> { return { file: this.file?.path ?? null }; }

  async setState(state: Record<string, unknown>, result: { history: boolean }): Promise<void> {
    const path = typeof state.file === "string" ? state.file : null;
    await super.setState(state, result);
    if (path && this.viewportEl) await this.loadNote(path);
    else this.pendingPath = path;
  }

  async onOpen(): Promise<void> {
    this.buildLayout();
    this.history = new CommandManager(() => {});
    const statePath = typeof this.getState().file === "string" ? this.getState().file as string : null;
    const path = this.pendingPath ?? statePath;
    this.pendingPath = null;
    if (path) await this.loadNote(path);
    this.registerDomEvent(this.contentEl, "keydown", this.onKeyDown);
    this.registerDomEvent(this.contentEl, "keyup", this.onKeyUp);
    this.viewportEl.addEventListener("wheel", this.onWheel, { passive: false, capture: true });
    this.registerDomEvent(this.viewportEl, "contextmenu", this.onContextMenu);
  }

  async onClose(): Promise<void> {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    await this.persist();
    this.ink?.destroy();
    this.codeEditors.forEach(view => view.destroy());
    this.codeEditors.clear();
    this.editorModeCompartments.clear();
    this.pendingInsertion?.remove();
    this.pendingInsertion = null;
    this.gestureCleanup?.();
    if (this.contextDismiss) window.removeEventListener("pointerdown", this.contextDismiss, true);
    this.contentEl.empty();
  }

  private buildLayout(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("inkdown-view");

    const ribbon = root.createDiv({ cls: "inkdown-ribbon" });
    const brand = ribbon.createDiv({ cls: "inkdown-brand-area" });
    brand.createDiv({ cls: "inkdown-logo", text: "i" });
    const brandText = brand.createDiv({ cls: "inkdown-brand-copy" });
    brandText.createDiv({ cls: "inkdown-brand-name", text: "Inkdown" });
    brandText.createDiv({ cls: "inkdown-brand-subtitle", text: "SPATIAL NOTEBOOK" });

    const tools = ribbon.createDiv({ cls: "inkdown-tool-group" });
    this.toolButton(tools, "select", "mouse-pointer-2", "Select", "V");
    this.toolButton(tools, "pen", "pen-tool", "Pen", "P");
    this.toolButton(tools, "eraser", "eraser", "Eraser", "E");

    const actions = ribbon.createDiv({ cls: "inkdown-action-group" });
    this.actionButton(actions, "Undo", "undo-2", () => this.undo());
    this.actionButton(actions, "Redo", "redo-2", () => this.redo());
    this.actionButton(actions, "Fit canvas", "maximize", () => this.fitCanvas());
    this.actionButton(actions, "Zoom out", "minus", () => this.canvas.zoomBy(0.85));
    this.zoomLabel = actions.createSpan({ cls: "inkdown-zoom-label", text: "100%" });
    this.actionButton(actions, "Zoom in", "plus", () => this.canvas.zoomBy(1.18));
    this.actionButton(actions, "Save", "cloud", () => void this.persist());

    this.statusEl = root.createDiv({ cls: "inkdown-statusbar" });
    this.statusEl.setText("Ready · Double-click empty canvas to start writing");

    this.viewportEl = root.createDiv({ cls: "inkdown-viewport" });
    this.worldEl = this.viewportEl.createDiv({ cls: "inkdown-world" });
    this.svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svgEl.classList.add("inkdown-ink-layer");
    this.svgEl.setAttribute("width", "1000000");
    this.svgEl.setAttribute("height", "1000000");
    this.svgEl.setAttribute("viewBox", "-500000 -500000 1000000 1000000");
    this.svgEl.style.left = "-500000px";
    this.svgEl.style.top = "-500000px";
    this.worldEl.appendChild(this.svgEl);

    this.canvas = new CanvasController(
      this.viewportEl, this.worldEl,
      () => this.document?.viewport ?? { x: 80, y: 60, zoom: 1 },
      next => {
        if (this.document) this.document.viewport = next;
        this.updateZoomLabel();
      }
    );

    this.viewportEl.addEventListener("pointerdown", this.onViewportPointerDown);
    this.viewportEl.addEventListener("dblclick", this.onViewportDoubleClick);
    this.viewportEl.addEventListener("pointermove", this.onViewportPointerMove);
    this.viewportEl.addEventListener("pointerup", this.onViewportPointerUp);
    this.viewportEl.addEventListener("pointercancel", this.onViewportPointerUp);
    this.setTool("select");
  }

  private toolButton(parent: HTMLElement, mode: ToolMode, icon: string, label: string, shortcut: string): void {
    const button = parent.createEl("button", { cls: "inkdown-tool-button", attr: { type: "button", title: `${label} (${shortcut})` } });
    const iconEl = button.createSpan({ cls: "inkdown-tool-icon" });
    // Obsidian's setIcon uses its own SVG icon registry.
    setIcon(iconEl, icon);
    button.createSpan({ cls: "inkdown-tool-label", text: label });
    button.addEventListener("click", () => this.setTool(mode));
    button.dataset.tool = mode;
  }

  private actionButton(parent: HTMLElement, label: string, icon: string, action: () => void): void {
    const button = parent.createEl("button", { cls: "inkdown-icon-button", attr: { type: "button", title: label, "aria-label": label } });
    const iconEl = button.createSpan();
    setIcon(iconEl, icon);
    button.addEventListener("click", action);
  }

  private setTool(tool: ToolMode): void {
    this.tool = tool;
    if (tool !== "select" && this.pendingInsertion) {
      this.pendingInsertion.remove();
      this.pendingInsertion = null;
    }
    this.viewportEl.dataset.tool = tool;
    this.contentEl.querySelectorAll<HTMLButtonElement>(".inkdown-tool-button")
      .forEach(button => button.classList.toggle("is-active", button.dataset.tool === tool));
    this.codeEditors.forEach((view, id) => {
      const compartment = this.editorModeCompartments.get(id);
      if (compartment) {
        view.dispatch({
          effects: compartment.reconfigure([
            EditorView.editable.of(tool === "select"),
            EditorState.readOnly.of(tool !== "select")
          ])
        });
      }
      if (tool !== "select") view.contentDOM.blur();
    });
    this.statusEl.setText(
      tool === "select" ? "Select · Double-click empty space to write · Drag a block handle to move · Space + drag to pan" :
      tool === "pen" ? "Pen · Draw freely across the canvas · Press V to return to Select" :
      "Eraser · Remove nearby ink strokes · Press V to return to Select"
    );
  }

  private async loadNote(path: string): Promise<void> {
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (!(abstract instanceof TFile) || abstract.extension !== "md") {
      new Notice("Inkdown: Open a Markdown note first.");
      return;
    }
    this.ink?.destroy();
    this.file = abstract;
    this.document = await this.storage.load(abstract);
    this.history.clear();
    this.selectedId = null;
    await this.renderObjects();
    this.ink = new InkController(
      this.svgEl,
      event => {
        const point = this.canvas.screenToWorld(event.clientX, event.clientY);
        return { ...point, pressure: event.pressure || 0.5 };
      },
      () => this.tool,
      () => this.document?.strokes ?? [],
      strokes => {
        if (!this.document) return;
        this.history.checkpoint(this.document);
        this.document.strokes = strokes;
        this.scheduleSave();
      }
    );
    this.canvas.apply();
    this.updateZoomLabel();
    this.leaf.updateHeader();
    this.statusEl.setText(`Opened ${abstract.basename}`);
  }

  private async renderObjects(): Promise<void> {
    if (!this.document || !this.file) return;
    const token = ++this.renderToken;
    this.codeEditors.forEach(view => view.destroy());
    this.codeEditors.clear();
    this.editorModeCompartments.clear();
    this.objectElements.clear();
    this.worldEl.querySelectorAll(".inkdown-object").forEach(el => el.remove());

    for (const object of this.document.objects) {
      if (token !== this.renderToken) return;
      const el = this.worldEl.createDiv({ cls: "inkdown-object" });
      el.dataset.objectId = object.id;
      el.style.left = `${object.x}px`;
      el.style.top = `${object.y}px`;
      el.style.width = `${object.width}px`;
      el.style.height = `${object.height}px`;
      if (object.id === this.selectedId) el.classList.add("is-selected");

      const topbar = el.createDiv({ cls: "inkdown-object-topbar" });
      const handle = topbar.createDiv({ cls: "inkdown-object-handle", attr: { title: "Drag to move" } });
      handle.setText("⠿");
      const actions = topbar.createDiv({ cls: "inkdown-object-actions" });
      const editButton = actions.createEl("button", {
        cls: "inkdown-object-action",
        attr: { type: "button", title: "Edit text", "aria-label": "Edit text" }
      });
      setIcon(editButton, "pencil");
      const deleteButton = actions.createEl("button", {
        cls: "inkdown-object-action is-delete",
        attr: { type: "button", title: "Delete text box", "aria-label": "Delete text box" }
      });
      setIcon(deleteButton, "trash-2");

      const body = el.createDiv({ cls: "inkdown-object-body" });
      const editorHost = body.createDiv({ cls: "inkdown-cm-host" });
      const preview = body.createDiv({ cls: "inkdown-live-preview" });
      const markdownText = object.isPrimary
        ? await this.app.vault.cachedRead(this.file)
        : object.markdown;
      await MarkdownRenderer.render(this.app, markdownText, preview, this.file.path, this);

      const modeCompartment = new Compartment();
      this.editorModeCompartments.set(object.id, modeCompartment);
      const cmView = new EditorView({
        parent: editorHost,
        state: EditorState.create({
          doc: markdownText,
          extensions: [
            markdown(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.lineWrapping,
            EditorView.theme({
              "&": { backgroundColor: "transparent", color: "var(--text-normal)", fontSize: "var(--font-size)" },
              ".cm-content": { fontFamily: "var(--font-text)", padding: "2px 0", minHeight: "100px" },
              ".cm-gutters": { display: "none" },
              ".cm-scroller": { overflow: "visible", fontFamily: "var(--font-text)" },
              "&.cm-focused": { outline: "none" },
              ".cm-activeLine": { backgroundColor: "transparent" },
              ".cm-selectionBackground, ::selection": { backgroundColor: "var(--text-selection)" }
            }),
            modeCompartment.of([
              EditorView.editable.of(this.tool === "select"),
              EditorState.readOnly.of(this.tool !== "select")
            ]),
            EditorView.updateListener.of(update => {
              if (!update.docChanged) return;
              const value = update.state.doc.toString();
              if (object.isPrimary) this.schedulePrimaryWrite(value);
              else object.markdown = value;
              this.growObjectToFit(object, editorHost, preview, "editor");
              this.scheduleSave();
              window.clearTimeout((editorHost as any).__inkdownRenderTimer);
              (editorHost as any).__inkdownRenderTimer = window.setTimeout(async () => {
                if (!preview.isConnected || !this.file) return;
                preview.empty();
                await MarkdownRenderer.render(this.app, value, preview, this.file!.path, this);
                this.growObjectToFit(object, editorHost, preview, "both");
              }, 180);
            })
          ]
        })
      });
      this.codeEditors.set(object.id, cmView);
      this.objectElements.set(object.id, el);
      this.growObjectToFit(object, editorHost, preview, "preview");

      const enterEdit = () => {
        if (this.tool !== "select") return;
        this.selectObject(object.id);
        el.classList.add("is-editing");
        cmView.requestMeasure();
        cmView.focus();
      };
      const leaveEdit = async () => {
        const value = cmView.state.doc.toString();
        if (object.isPrimary) await this.flushPrimaryWrite(value);
        else object.markdown = value;
        preview.empty();
        await MarkdownRenderer.render(this.app, value, preview, this.file!.path, this);
        el.classList.remove("is-editing");
        this.growObjectToFit(object, editorHost, preview, "preview");
        this.scheduleSave();
      };

      el.addEventListener("pointerdown", event => {
        if (this.tool !== "select") return;
        this.selectObject(object.id);
        // Keep the event within this object; it must not be interpreted as
        // a blank-canvas click by the viewport.
        event.stopPropagation();
      });
      handle.addEventListener("pointerdown", event => this.startMove(event, object.id));
      editButton.addEventListener("click", event => {
        event.stopPropagation();
        enterEdit();
      });
      deleteButton.addEventListener("click", event => {
        event.stopPropagation();
        this.deleteObject(object.id);
      });
      preview.addEventListener("dblclick", event => {
        event.preventDefault();
        enterEdit();
      });
      el.addEventListener("contextmenu", event => {
        event.preventDefault();
        this.selectObject(object.id);
        this.showContextMenu(event.clientX, event.clientY, object.id);
      });

      cmView.dom.addEventListener("focusin", () => {
        if (this.tool !== "select") return;
        this.selectObject(object.id);
        el.classList.add("is-editing");
      });
      cmView.dom.addEventListener("focusout", () => {
        window.setTimeout(() => {
          if (!el.isConnected || el.contains(document.activeElement)) return;
          void leaveEdit();
        }, 0);
      });
      cmView.dom.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          cmView.contentDOM.blur();
          event.stopPropagation();
        }
      });

      this.addResizeHandles(el, object);
    }
  }

  private addResizeHandles(el: HTMLDivElement, object: CanvasObject): void {
    const directions = ["n","s","e","w","ne","nw","se","sw"];
    for (const direction of directions) {
      const handle = el.createDiv({ cls: `inkdown-resize-handle inkdown-resize-${direction}` });
      handle.addEventListener("pointerdown", event => this.startResize(event, object, direction));
    }
  }

  private selectObject(id: string): void {
    this.selectedId = id;
    this.objectElements.forEach((el, objectId) => {
      el.classList.toggle("is-selected", objectId === id);
    });
  }

  private startMove(event: PointerEvent, id: string): void {
    if (this.tool !== "select" || event.button !== 0 || !this.document) return;
    const object = this.document.objects.find(item => item.id === id);
    if (!object) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectObject(id);
    this.history.checkpoint(this.document);
    const sx = event.clientX, sy = event.clientY, ox = object.x, oy = object.y;
    const zoom = this.document.viewport.zoom;
    const move = (e: PointerEvent) => {
      object.x = ox + (e.clientX - sx) / zoom;
      object.y = oy + (e.clientY - sy) / zoom;
      const el = this.objectElements.get(id);
      if (el) { el.style.left = `${object.x}px`; el.style.top = `${object.y}px`; }
    };
    this.beginGesture(move, () => this.scheduleSave());
  }

  private startResize(event: PointerEvent, object: CanvasObject, direction: string): void {
    if (this.tool !== "select" || !this.document || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectObject(object.id);
    this.history.checkpoint(this.document);
    const sx = event.clientX, sy = event.clientY;
    const original = { x: object.x, y: object.y, width: object.width, height: object.height };
    const zoom = this.document.viewport.zoom;
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - sx) / zoom;
      const dy = (e.clientY - sy) / zoom;
      if (direction.includes("e")) object.width = Math.max(180, original.width + dx);
      if (direction.includes("s")) object.height = Math.max(100, original.height + dy);
      if (direction.includes("w")) {
        const width = Math.max(180, original.width - dx);
        object.x = original.x + original.width - width;
        object.width = width;
      }
      if (direction.includes("n")) {
        const height = Math.max(100, original.height - dy);
        object.y = original.y + original.height - height;
        object.height = height;
      }
      this.applyObjectGeometry(object);
    };
    this.beginGesture(move, () => this.scheduleSave());
  }

  private applyObjectGeometry(object: CanvasObject): void {
    const el = this.objectElements.get(object.id);
    if (!el) return;
    el.style.left = `${object.x}px`;
    el.style.top = `${object.y}px`;
    el.style.width = `${object.width}px`;
    el.style.height = `${object.height}px`;
  }

  private beginGesture(move: (event: PointerEvent) => void, finish: () => void): void {
    this.gestureCleanup?.();
    const onMove = (event: PointerEvent) => move(event);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      this.gestureCleanup = null;
      finish();
    };
    this.gestureCleanup = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  private onViewportPointerDown = (event: PointerEvent): void => {
    if (!this.document || !this.canvas) return;
    const target = event.target as HTMLElement;
    const objectTarget = target.closest?.(".inkdown-object");
    const insertionTarget = target.closest?.(".inkdown-pending-caret");
    if (insertionTarget) return;
    const isCanvasSurface = !objectTarget &&
      !target.closest?.(".inkdown-ribbon, .inkdown-statusbar, .inkdown-context-menu");

    if (event.button === 1 || (this.spaceDown && event.button === 0)) {
      event.preventDefault();
      this.startPan(event);
      return;
    }

    // A single left click on blank canvas only clears focus/selection.
    // Text insertion is started by onViewportDoubleClick.
    if (this.tool !== "select" || event.button !== 0 || !isCanvasSurface) return;
    this.deselectObjects();
    this.pendingInsertion?.remove();
    this.pendingInsertion = null;
  };

  private onViewportDoubleClick = (event: MouseEvent): void => {
    if (!this.document || !this.canvas || this.tool !== "select" || event.button !== 0) return;
    const target = event.target as HTMLElement;
    const objectTarget = target.closest?.(".inkdown-object");
    const isCanvasSurface = !objectTarget &&
      !target.closest?.(".inkdown-ribbon, .inkdown-statusbar, .inkdown-context-menu");
    if (!isCanvasSurface) return;

    event.preventDefault();
    event.stopPropagation();
    this.deselectObjects();
    this.pendingInsertion?.remove();
    const point = this.canvas.screenToWorld(event.clientX, event.clientY);
    this.placeInsertionCaret(point.x, point.y);
  };

  private deselectObjects(): void {
    const active = this.contentEl.querySelector<HTMLElement>(".inkdown-cm-host .cm-content:focus");
    if (active) active.blur();
    this.selectedId = null;
    this.objectElements.forEach(el => {
      el.classList.remove("is-selected");
      el.classList.remove("is-editing");
    });
  };

  // A blank click places only a caret. The persistent object is created
  // after the first input, matching OneNote's click-then-type behaviour.
  private placeInsertionCaret(x: number, y: number): void {
    this.pendingInsertion?.remove();
    const caret = this.worldEl.createEl("textarea", {
      cls: "inkdown-pending-caret",
      attr: { rows: "1", spellcheck: "false", "aria-label": "Type to create a text container" }
    });
    caret.style.left = `${x}px`;
    caret.style.top = `${y}px`;
    this.pendingInsertion = caret;

    const onFirstText = (): void => {
      const initialText = caret.value;
      if (!initialText.length) return;
      caret.removeEventListener("input", onFirstText);
      this.pendingInsertion = null;
      caret.remove();
      this.createTextObject(x, y, initialText);
    };
    // Do not use { once: true }: browsers can emit empty/composition input
    // events before the first committed character.
    caret.addEventListener("input", onFirstText);
    caret.addEventListener("beforeinput", event => {
      // Let the browser perform the edit, then the input handler transfers it.
      if (event.inputType.startsWith("insert") && event.data) {
        window.setTimeout(onFirstText, 0);
      }
    });

    caret.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        caret.remove();
        if (this.pendingInsertion === caret) this.pendingInsertion = null;
      }
      event.stopPropagation();
    });

    caret.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (this.pendingInsertion === caret && !caret.value) {
          caret.remove();
          this.pendingInsertion = null;
        }
      }, 0);
    });
    caret.focus({ preventScroll: true });
  }

  private createTextObject(x: number, y: number, initialMarkdown = ""): void {
    if (!this.document) return;
    const object: TextObject = {
      id: makeId(), type: "text",
      x: Math.round(x), y: Math.round(y),
      width: 420, height: 220, markdown: initialMarkdown, isPrimary: false
    };
    this.history.checkpoint(this.document);
    this.document.objects.push(object);
    this.selectedId = object.id;
    void this.renderObjects().then(() => {
      this.scheduleSave();
      const el = this.objectElements.get(object.id);
      const editor = this.codeEditors.get(object.id);
      if (el && editor) {
        el.classList.add("is-editing");
        editor.focus();
      }
    });
  }

  private startPan(event: PointerEvent): void {
    const sx = event.clientX, sy = event.clientY;
    let lastX = sx, lastY = sy;
    this.viewportEl.classList.add("is-panning");
    const move = (e: PointerEvent) => {
      this.canvas.panBy(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX; lastY = e.clientY;
    };
    this.beginGesture(move, () => {
      this.viewportEl.classList.remove("is-panning");
      this.scheduleSave();
    });
  }

  private onViewportPointerMove = (_event: PointerEvent): void => {};
  private onViewportPointerUp = (_event: PointerEvent): void => {};

  private onWheel = (event: WheelEvent): void => {
    // Ctrl/Cmd + wheel remains zoom, anchored at the pointer.
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      this.canvas.zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.08 : 0.92);
      this.scheduleSave();
      return;
    }

    // Convert line/page wheel units to pixels. Most Windows mouse wheels
    // report DOM_DELTA_LINE; trackpads generally report pixel deltas.
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 32
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(this.viewportEl.clientWidth, this.viewportEl.clientHeight)
        : 1;

    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;

    // Shift + wheel is horizontal navigation. Browsers differ: some report
    // the shifted wheel as deltaY, others as deltaX.
    if (event.shiftKey) {
      const horizontal = Math.abs(dy) > 0 ? dy : dx;
      if (horizontal !== 0) {
        event.preventDefault();
        event.stopPropagation();
        this.canvas.panBy(-horizontal, 0);
        this.scheduleSave();
      }
      return;
    }

    // Ordinary wheel scrolls vertically; trackpad deltaX pans horizontally too.
    if (dx !== 0 || dy !== 0) {
      event.preventDefault();
      event.stopPropagation();
      this.canvas.panBy(-dx, -dy);
      this.scheduleSave();
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Space" && !this.isTypingTarget(event.target)) {
      this.spaceDown = true;
      event.preventDefault();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      if (this.isTypingTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) this.redo(); else this.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      if (this.isTypingTarget(event.target)) return;
      event.preventDefault();
      this.redo();
      return;
    }
    if (this.isTypingTarget(event.target)) return;

    if (event.key === "v" || event.key === "V") this.setTool("select");
    if (event.key === "p" || event.key === "P") this.setTool("pen");
    if (event.key === "e" || event.key === "E") this.setTool("eraser");
    if ((event.key === "Delete" || event.key === "Backspace") && this.selectedId) {
      event.preventDefault();
      this.deleteObject(this.selectedId);
    }
    if (event.key === "Escape") {
      this.deselectObjects();
      this.hideContextMenu();
    }
    if (event.key === "Home") this.fitCanvas();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") this.spaceDown = false;
  };

  private isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el?.closest("textarea, input, [contenteditable='true']");
  }

  private onContextMenu = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    const objectEl = target.closest<HTMLElement>(".inkdown-object");
    if (!objectEl) return;
    const id = objectEl.dataset.objectId;
    if (!id) return;
    event.preventDefault();
    this.selectObject(id);
    this.showContextMenu(event.clientX, event.clientY, id);
  };

  private showContextMenu(x: number, y: number, id: string): void {
    this.hideContextMenu();
    const menu = this.contentEl.createDiv({ cls: "inkdown-context-menu" });
    const add = (label: string, icon: string, action: () => void, danger = false) => {
      const item = menu.createDiv({ cls: `inkdown-context-item${danger ? " is-danger" : ""}` });
      const iconEl = item.createSpan();
      setIcon(iconEl, icon);
      item.createSpan({ text: label });
      item.addEventListener("click", () => { action(); this.hideContextMenu(); });
    };
    add("Duplicate", "copy", () => this.duplicateObject(id));
    add("Bring to front", "layers", () => this.changeZOrder(id, true));
    add("Send to back", "layers-2", () => this.changeZOrder(id, false));
    menu.createDiv({ cls: "inkdown-context-divider" });
    add("Delete", "trash-2", () => this.deleteObject(id), true);
    menu.style.left = `${Math.min(x, window.innerWidth - 210)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 220)}px`;
    if (this.contextDismiss) window.removeEventListener("pointerdown", this.contextDismiss, true);
    this.contextDismiss = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) this.hideContextMenu();
    };
    window.addEventListener("pointerdown", this.contextDismiss, true);
  }

  private hideContextMenu(): void {
    this.contentEl.querySelector(".inkdown-context-menu")?.remove();
    if (this.contextDismiss) {
      window.removeEventListener("pointerdown", this.contextDismiss, true);
      this.contextDismiss = null;
    }
  }

  private deleteObject(id: string): void {
    if (!this.document) return;
    const object = this.document.objects.find(item => item.id === id);
    if (!object || object.isPrimary) {
      new Notice("The original note container cannot be deleted.");
      return;
    }
    this.history.checkpoint(this.document);
    this.document.objects = this.document.objects.filter(item => item.id !== id);
    this.objectElements.get(id)?.remove();
    this.objectElements.delete(id);
    this.selectedId = null;
    this.scheduleSave();
  }

  private duplicateObject(id: string): void {
    if (!this.document) return;
    const object = this.document.objects.find(item => item.id === id);
    if (!object) return;
    this.history.checkpoint(this.document);
    const copy: TextObject = {
      ...object, id: makeId(), x: object.x + 32, y: object.y + 32,
      isPrimary: false, markdown: object.isPrimary ? "" : object.markdown
    };
    this.document.objects.push(copy);
    this.selectedId = copy.id;
    void this.renderObjects().then(() => this.scheduleSave());
  }

  private changeZOrder(id: string, front: boolean): void {
    if (!this.document) return;
    this.history.checkpoint(this.document);
    const object = this.document.objects.find(item => item.id === id);
    if (!object) return;
    this.document.objects = this.document.objects.filter(item => item.id !== id);
    if (front) this.document.objects.push(object); else this.document.objects.unshift(object);
    void this.renderObjects().then(() => this.scheduleSave());
  }

  private undo(): void {
    if (!this.document) return;
    const previous = this.history.undo(this.document);
    if (previous) {
      this.document = previous;
      this.selectedId = null;
      void this.renderObjects().then(() => {
        this.ink?.render();
        this.scheduleSave();
      });
    }
  }

  private redo(): void {
    if (!this.document) return;
    const next = this.history.redo(this.document);
    if (next) {
      this.document = next;
      this.selectedId = null;
      void this.renderObjects().then(() => {
        this.ink?.render();
        this.scheduleSave();
      });
    }
  }

  private fitCanvas(): void {
    if (!this.document) return;
    this.canvas.fit(this.document.objects);
    this.updateZoomLabel();
    this.scheduleSave();
  }

  private updateZoomLabel(): void {
    if (!this.zoomLabel || !this.document) return;
    this.zoomLabel.setText(`${Math.round(this.document.viewport.zoom * 100)}%`);
  }

  private async flushPrimaryWrite(value: string): Promise<void> {
    if (!this.file) return;
    if (this.primaryWriteTimer !== null) {
      window.clearTimeout(this.primaryWriteTimer);
      this.primaryWriteTimer = null;
    }
    try {
      await this.app.vault.modify(this.file, value);
      this.statusEl.setText("Markdown saved");
    } catch (error) {
      console.error("Inkdown: Markdown save failed.", error);
      new Notice("Inkdown could not save the Markdown note.");
    }
  }

  private schedulePrimaryWrite(value: string): void {
    if (!this.file) return;
    // The original note is updated from the primary writing object.
    if (this.primaryWriteTimer !== null) window.clearTimeout(this.primaryWriteTimer);
    this.primaryWriteTimer = window.setTimeout(async () => {
      if (!this.file) return;
      try {
        await this.app.vault.modify(this.file, value);
        this.statusEl.setText("Markdown saved");
      } catch (error) {
        console.error("Inkdown: Markdown save failed.", error);
        new Notice("Inkdown could not save the Markdown note.");
      }
    }, 650);
  }
  private primaryWriteTimer: number | null = null;

  private scheduleSave(): void {
    if (!this.document) return;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.statusEl.setText("Saving changes…");
    this.saveTimer = window.setTimeout(() => void this.persist(), 650);
  }

  private async persist(): Promise<void> {
    if (!this.document) return;
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      await this.storage.save(this.document);
      this.statusEl.setText("All changes saved");
    } catch (error) {
      console.error("Inkdown: Save failed.", error);
      this.statusEl.setText("Save failed");
      new Notice("Inkdown could not save the spatial layout.");
    }
  }
}

function requireObsidian(): typeof import("obsidian") {
  // Static import is avoided in the type helper; the bundled Obsidian module
  // supplies setIcon at runtime.
  return require("obsidian") as typeof import("obsidian");
}