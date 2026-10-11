// Native editor hooks are isolated here: Pi currently has no public selection/cursor setter API.
// Fail closed on incompatible versions rather than replacing the working editor.
export function assertCompatible(editor) {
  for (const name of ['moveCursor', 'moveWordBackwards', 'moveWordForwards',
    'setCursorCol', 'buildVisualLineMap', 'layoutText', 'segment', 'cancelAutocomplete',
    'exitHistoryBrowsing', 'expandPasteMarkers', 'undo']) {
    if (typeof editor[name] !== 'function') throw new Error(`Unsupported Pi editor: missing ${name}`);
  }
  if (!Array.isArray(editor.state?.lines) || !(editor.pastes instanceof Map)) {
    throw new Error('Unsupported Pi editor state');
  }
}

export function offsetOf(lines, cursor) {
  return lines.slice(0, cursor.line).reduce((sum, line) => sum + line.length + 1, 0) + cursor.col;
}
export function positionOf(text, offset) {
  const lines = text.slice(0, offset).split('\n');
  return { line: lines.length - 1, col: lines.at(-1).length };
}
export function osc52(text) {
  return `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`;
}

export function createSelectionEditor(Base, { matchesKey, decodeKittyPrintable, isKeyRelease, visibleWidth, truncateToWidth, CURSOR_MARKER }) {
  return class SelectionEditor extends Base {
    anchor = null;
    pendingPaste = null;
    selectionText = null;

    constructor(...args) {
      super(...args);
      assertCompatible(this);
    }

    selection() {
      // Programmatic/history changes must not leave an anchor pointing into another prompt.
      if (this.selectionText !== null && this.selectionText !== this.getText()) this.clearSelection();
      if (this.anchor === null) return null;
      const cursor = offsetOf(this.getLines(), this.getCursor());
      return cursor === this.anchor ? null : [Math.min(this.anchor, cursor), Math.max(this.anchor, cursor)];
    }
    clearSelection() {
      this.anchor = null;
      this.selectionText = null;
    }
    setText(text) {
      this.clearSelection();
      this.pendingPaste = null;
      super.setText(text);
    }
    place(offset) {
      const cursor = positionOf(this.getText(), offset);
      this.state.cursorLine = cursor.line;
      this.setCursorCol(cursor.col);
    }
    extend(move) {
      this.selection();
      if (this.anchor === null) this.anchor = offsetOf(this.getLines(), this.getCursor());
      this.selectionText = this.getText();
      this.cancelAutocomplete();
      this.exitHistoryBrowsing();
      move(); // Native grapheme-aware, paste-marker-aware and visual-line-aware movement.
    }
    replaceSelection(text) {
      const range = this.selection();
      if (!range) return false;
      const original = this.getText();
      const normalized = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
      const result = original.slice(0, range[0]) + normalized + original.slice(range[1]);
      // setText creates ONE native undo snapshot. Preserve surviving folded-paste payloads.
      const pastes = new Map(this.pastes);
      const pasteCounter = this.pasteCounter;
      this.clearSelection();
      super.setText(result);
      this.pastes = pastes;
      this.pasteCounter = pasteCounter;
      this.place(range[0] + normalized.length);
      return true;
    }
    copySelection() {
      const range = this.selection();
      if (!range) return false;
      const text = this.expandPasteMarkers(this.getText().slice(...range));
      // Bound payload size; never read/query the user's clipboard or launch server clipboard tools.
      if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) return false;
      this.tui.terminal.write(osc52(text));
      return true;
    }
    insertTextAtCursor(text) {
      if (!text) return;
      if (!this.replaceSelection(text)) super.insertTextAtCursor(text);
    }
    handleMouse(event) {
      if (event.type === 'click' && event.button === 'left') this.clearSelection();
      return super.handleMouse(event);
    }
    handleInput(data) {
      if (!data || isKeyRelease(data)) return;
      // TUI delivers bracketed-paste markers; selected replacement also supports split chunks.
      if (this.pendingPaste !== null) {
        this.pendingPaste += data;
        if (this.pendingPaste.length > 16 * 1024 * 1024) {
          this.pendingPaste = null;
          this.clearSelection();
          return;
        }
        const end = this.pendingPaste.indexOf('\x1b[201~');
        if (end < 0) return;
        const text = this.pendingPaste.slice(0, end);
        const tail = this.pendingPaste.slice(end + 6);
        this.pendingPaste = null;
        if (!this.replaceSelection(text)) super.insertTextAtCursor(text);
        if (tail) this.handleInput(tail);
        return;
      }
      if (data.startsWith('\x1b[200~') && this.selection()) {
        this.pendingPaste = '';
        this.handleInput(data.slice(6));
        return;
      }
      const is = (key) => matchesKey(data, key);
      const movements = [
        ['shift+left', () => this.moveCursor(0, -1)],
        ['shift+right', () => this.moveCursor(0, 1)],
        ['shift+up', () => this.moveCursor(-1, 0)],
        ['shift+down', () => this.moveCursor(1, 0)],
        ['alt+shift+left', () => this.moveWordBackwards()],
        ['alt+shift+right', () => this.moveWordForwards()],
        ['ctrl+shift+left', () => this.moveWordBackwards()],
        ['ctrl+shift+right', () => this.moveWordForwards()],
        ['shift+home', () => this.setCursorCol(0)],
        ['shift+end', () => this.setCursorCol(this.getLines()[this.getCursor().line].length)],
        ['super+shift+left', () => this.setCursorCol(0)],
        ['super+shift+right', () => this.setCursorCol(this.getLines()[this.getCursor().line].length)],
        ['super+shift+up', () => this.place(0)],
        ['super+shift+down', () => this.place(this.getText().length)],
      ];
      for (const [key, move] of movements) {
        if (is(key)) { this.extend(move); return; }
      }
      if (is('super+a')) {
        this.anchor = 0;
        this.selectionText = this.getText();
        this.cancelAutocomplete();
        this.place(this.getText().length);
        return;
      }
      if (is('super+c') || (is('ctrl+c') && this.selection())) {
        this.copySelection();
        return; // Without selection, Command+C must not clear/exit Pi.
      }
      if (is('super+x')) {
        if (this.copySelection()) this.replaceSelection('');
        return;
      }
      if (is('super+z')) {
        this.clearSelection();
        // Native undo, without taking Ctrl+Z away from Unix job control.
        this.undo();
        return;
      }
      const range = this.selection();
      if (range) {
        if (is('backspace') || is('delete') || is('ctrl+d')) {
          this.replaceSelection('');
          return;
        }
        if (is('escape')) { this.clearSelection(); return; }
        if (is('left') || is('right')) {
          this.place(range[is('left') ? 0 : 1]);
          this.clearSelection();
          return;
        }
        const printable = decodeKittyPrintable(data);
        if (printable !== undefined) { this.replaceSelection(printable); return; }
        if (!['\r', '\n', '\t'].includes(data) && !data.includes('\x1b') && [...data].every(c => c >= ' ' || c === '\n' || c === '\r' || c === '\t')) {
          this.replaceSelection(data);
          return;
        }
        if (is('shift+enter') || is('ctrl+j')) { this.replaceSelection('\n'); return; }
      }
      // Do not clear the anchor before an async native clipboard insert or extension shortcut.
      if (this.keybindings.matches(data, 'app.clipboard.pasteImage')) {
        super.handleInput(data);
        return;
      }
      this.clearSelection();
      super.handleInput(data); // Preserve autocomplete, history, app shortcuts, submission, interrupts.
    }

    render(width) {
      // Native wordWrapLine recurses on a double-width grapheme at layout width 1.
      // Render at a safe minimum, then crop only for exceptionally tiny terminals.
      const rows = this.renderSelection(Math.max(4, width));
      return width < 4 ? rows.map(row => truncateToWidth(row, Math.max(0, width), '')) : rows;
    }
    renderSelection(width) {
      const output = super.render(width);
      const range = this.selection();
      if (!range) return output;
      const paddingX = Math.min(this.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
      const contentWidth = Math.max(1, width - paddingX * 2);
      const layout = this.layoutText(this.lastWidth);
      const map = this.buildVisualLineMap(this.lastWidth);
      const logicalLines = this.getLines();
      for (let row = 0; row < this.renderedVisibleLineCount; row++) {
        const index = this.scrollOffset + row;
        const chunk = layout[index];
        const source = map[index];
        if (!chunk || !source) continue;
        const start = offsetOf(logicalLines, { line: source.logicalLine, col: source.startCol });
        let display = '';
        for (const grapheme of this.segment(chunk.text, 'grapheme')) {
          const selected = start + grapheme.index < range[1] && start + grapheme.index + grapheme.segment.length > range[0];
          const cursor = chunk.hasCursor && chunk.cursorPos === grapheme.index;
          if (cursor && this.focused) display += CURSOR_MARKER;
          if (selected) display += '\x1b[48;5;24m\x1b[97m';
          if (cursor) display += '\x1b[7m';
          display += grapheme.segment;
          if (selected || cursor) display += '\x1b[0m';
        }
        const endCursor = chunk.hasCursor && chunk.cursorPos >= chunk.text.length;
        if (endCursor) {
          if (this.focused) display += CURSOR_MARKER;
          display += '\x1b[7m \x1b[0m';
        } else {
          const lineEnd = offsetOf(logicalLines, { line: source.logicalLine, col: logicalLines[source.logicalLine].length });
          if (start + chunk.text.length === lineEnd && range[0] <= lineEnd && range[1] > lineEnd) {
            display += '\x1b[48;5;24m\x1b[97m \x1b[0m'; // Selected newline.
          }
        }
        const right = Math.max(0, width - paddingX - visibleWidth(display));
        output[row + 1] = ' '.repeat(paddingX) + display + ' '.repeat(right);
      }
      return output;
    }
  };
}
