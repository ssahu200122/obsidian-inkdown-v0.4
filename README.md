# Inkdown v0.4.0

Inkdown is an Obsidian spatial notebook prototype: freeform text objects, Markdown rendering, handwriting, object manipulation and canvas navigation.

## v0.4 scope

- Professional ribbon-style toolbar using Obsidian theme variables.
- Click empty canvas in Select mode to create a text object and focus it.
- Independent text objects stored in the JSON sidecar.
- Existing primary note content is represented by a primary text object and remains backed by the original `.md` file.
- Drag a text object's grip to move it.
- Eight resize handles.
- Right-click context menu: duplicate, bring to front, send to back, delete.
- Delete/Backspace removes the selected secondary object when the canvas has focus.
- Ctrl/Cmd+Z and Ctrl/Cmd+Y undo/redo object operations.
- Space + drag or middle mouse drag pans.
- Ctrl/Cmd + mouse wheel zooms around the cursor.
- Home fits all objects; toolbar has fit and zoom controls.
- Existing v0.1-v0.3 sidecars are migrated on load; old ink strokes are retained.
- Pen and Eraser mode route pointer input to the ink layer and disable text-object interaction.

## Install for development

1. Extract the project.
2. In the project directory run `npm install`.
3. Run `npm run dev` for watch mode or `npm run build` for a production bundle.
4. Copy `manifest.json`, generated `main.js`, and `src/styles/styles.css` (renamed to `styles.css`) into `<Vault>/.obsidian/plugins/inkdown/`.
5. Enable Inkdown under Settings → Community plugins.

## Controls

- `V`: Select
- `P`: Pen
- `E`: Eraser
- `Space + drag`: Pan
- Middle mouse drag: Pan
- `Ctrl/Cmd + wheel`: Cursor-centred zoom
- `Delete` / `Backspace`: Delete selected secondary text object
- `Ctrl/Cmd + Z`: Undo
- `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y`: Redo
- `Home`: Fit canvas
- `Escape`: Deselect

## Storage

For `Mathematics/Probability.md`, the sidecar is `Mathematics/Probability.md.spatial.json`.

The primary text object is backed by the original Markdown note. Additional text objects are stored in the sidecar. Spatial coordinates, sizes, viewport and handwriting strokes are stored in the sidecar.

## Important scope note

v0.4 establishes the canvas/object interaction foundation. Text input currently uses a native editor surface with Obsidian Markdown rendering below it; it is not yet true CodeMirror 6 inline Live Preview. That is the next editor-integration milestone. Advanced ink selection, lasso, highlighter, partial eraser, images and shapes are also future work.

## Safety

Test in a disposable vault and back up important notes before installing. This is a development build; verify build and runtime behaviour in your Obsidian version.


## v0.4.2 — OneNote-style click-to-type

- Clicking blank canvas in Select mode places a temporary insertion caret only.
- No text object or empty card is created until the user enters the first character.
- On first input, a text object is created at the clicked world coordinate and the typed text is transferred into its editor.
- Clicking away without typing removes the temporary caret and leaves no object.
- Escape cancels pending insertion.
- Switching to Pen/Eraser or closing the view clears pending insertion.


## v0.4.3 — Focus and insertion-caret reliability

- Clicking empty canvas deselects the previously selected text object and removes its editing frame and controls.
- Clicking empty canvas commits the current editor before placing a new insertion caret.
- Canvas hit testing now accepts empty canvas descendants while excluding text objects and toolbar/status/context-menu UI.
- The temporary insertion input handler no longer uses a one-shot listener, so empty or composition input events cannot silently disable future typing.
- The insertion caret is explicitly focused after placement.


## v0.4.4 — Mouse double-click insertion

- Single left-click on blank canvas only deselects the current object and clears pending insertion.
- Double left-click on blank canvas creates the temporary insertion caret at the clicked canvas coordinate.
- The first committed character creates the persistent text object.
- Double-clicks on existing text objects are left to the text object's own edit interaction.
- Toolbar, status bar and context menu double-clicks do not create text.
- Status guidance now explicitly says to double-click empty canvas to start writing.


## v0.4.5 — Automatic text-container growth

- Text containers expand vertically when editor content or rendered Markdown exceeds their current height.
- Textarea height follows its content while typing.
- Rendered Markdown height is measured after Obsidian MarkdownRenderer completes.
- Existing user-selected height is preserved; auto-growth never shrinks a container.
- Manual resize remains available, and future typing expands the box again if content needs more room.


## v0.5.0 — CodeMirror 6 editor and infinite canvas navigation

### Markdown editing
- Replaced the native textarea editor with CodeMirror 6.
- Added Markdown language parsing, syntax highlighting, line wrapping, undo/redo and standard editor keymaps.
- Preserved Obsidian MarkdownRenderer as a live rendered preview while editing.
- Editor editability follows Select/Pen/Eraser tool mode.

### Infinite canvas navigation
- Mouse wheel pans vertically.
- Shift + mouse wheel pans horizontally.
- Trackpad horizontal delta is supported.
- Ctrl/Cmd + wheel continues to zoom around the cursor.
- The dot grid now belongs to the transformed world, so it moves and scales with the canvas.

Note: This milestone provides CodeMirror Markdown editing plus a live rendered preview. It is not yet Obsidian's full native Live Preview decoration system, where Markdown delimiters disappear inline in the same editor surface.


## v0.5.1 — Wheel navigation and duplicate method fix

- Removed the duplicate `deselectObjects()` class member warning.
- Wheel handler now runs in capture phase with `{ passive: false }`, intercepting gestures before nested Obsidian/editor scroll containers.
- Stops wheel propagation after handling so Obsidian's surrounding panes do not consume the gesture.
- Normal wheel pans vertically; trackpad `deltaX` pans horizontally.
- Shift + wheel pans horizontally, handling both browser `deltaY` and `deltaX` reporting behaviours.
- Ctrl/Cmd + wheel remains pointer-anchored zoom.
- Normalizes mouse wheel line/page delta modes.


## v0.5.2 — Selection/insertion recovery and unbounded canvas grid

- Object pointerdown now explicitly selects the object and stops bubbling to the viewport.
- Blank-canvas pointer handler ignores the temporary insertion caret, so clicking/focusing it cannot cancel insertion.
- Added a `beforeinput` fallback for committed keyboard/IME text insertion.
- Expanded the SVG ink coordinate plane around the origin.
- Moved the dot grid from the finite world element to the viewport and phase-shifts it with pan/zoom. The canvas grid therefore remains visible when navigating left of the original origin as well as in other directions.
