import { Plugin, TFile, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import { SpatialView, SPATIAL_VIEW_TYPE } from "./views/SpatialView";
import "./styles/styles.css";

export default class InkdownPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(SPATIAL_VIEW_TYPE, (leaf: WorkspaceLeaf) => new SpatialView(leaf, this));

    this.addCommand({
      id: "open-active-note-in-spatial-editor",
      name: "Open active note in Inkdown",
      checkCallback: checking => {
        const file = this.app.workspace.getActiveFile();
        if (checking) return !!file && file.extension === "md";
        if (!file || file.extension !== "md") {
          new Notice("Open a Markdown note first.");
          return;
        }
        void this.openSpatialView(file);
      }
    });

    this.addRibbonIcon("pen-tool", "Open active note in Inkdown", () => {
      const file = this.app.workspace.getActiveFile();
      if (file instanceof TFile && file.extension === "md") void this.openSpatialView(file);
      else new Notice("Open a Markdown note first.");
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(SPATIAL_VIEW_TYPE);
  }

  private async openSpatialView(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: SPATIAL_VIEW_TYPE, active: true, state: { file: file.path } });
    await this.app.workspace.revealLeaf(leaf);
  }
}