import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createSelectionEditor, osc52 } from '../src/selection-editor.js';

// Tests reuse the installed Pi; no dependency or browser download is required.
const entry = process.env.PI_TEST_ENTRY || realpathSync(execFileSync('which', ['pi'], { encoding: 'utf8' }).trim());
let packageRoot = dirname(entry);
while (!(existsSync(resolve(packageRoot, 'package.json')) && JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).name === '@earendil-works/pi-coding-agent')) {
  const parent = dirname(packageRoot);
  if (parent === packageRoot) throw new Error('Cannot locate installed Pi package; set PI_TEST_ENTRY to its CLI entry.');
  packageRoot = parent;
}
const pi = await import(pathToFileURL(resolve(packageRoot, 'dist/index.js')));
const tui = await import(pathToFileURL(resolve(packageRoot, 'node_modules/@earendil-works/pi-tui/dist/index.js')));
const Editor = createSelectionEditor(pi.CustomEditor, tui);
const theme = { borderColor: s => s, selectList: { selectedPrefix: s => s, selectedText: s => s, description: s => s, scrollInfo: s => s, noMatch: s => s } };
const kb = { matches: (data, action) => action === 'app.clipboard.pasteImage' && tui.matchesKey(data, 'ctrl+v') };
function make(text = '', width = 80) {
  const writes = [];
  const terminal = { rows: 40, columns: width, write: data => writes.push(data) };
  const editor = new Editor({ terminal, requestRender() {} }, theme, kb);
  editor.setText(text);
  editor.focused = true;
  editor.render(width);
  return { editor, writes };
}
const left = '\x1b[1;2D', right = '\x1b[1;2C', up = '\x1b[1;2A', down = '\x1b[1;2B';
const cmd = c => `\x1b[${c.codePointAt(0)};9u`;
function type(editor, data) { editor.handleInput(data); }

test('select/reverse and copy via OSC52; Escape retains prompt', () => {
  const { editor, writes } = make('hola');
  type(editor, left); type(editor, left);
  assert.deepEqual(editor.selection(), [2, 4]);
  type(editor, right);
  assert.deepEqual(editor.selection(), [3, 4]);
  type(editor, cmd('c'));
  assert.equal(writes.at(-1), osc52('a'));
  assert.equal(editor.getText(), 'hola');
  type(editor, '\x1b');
  assert.equal(editor.selection(), null);
  assert.equal(editor.getText(), 'hola');
});
test('Backspace and Delete remove selection; native undo restores it atomically', () => {
  for (const key of ['\x7f', '\x1b[3~']) {
    const { editor } = make('hello');
    type(editor, left); type(editor, left); type(editor, key);
    assert.equal(editor.getText(), 'hel');
    assert.deepEqual(editor.getCursor(), { line: 0, col: 3 });
    type(editor, cmd('z'));
    assert.equal(editor.getText(), 'hello');
  }
});
test('typing replaces selection with one undo step and stays at replacement', () => {
  const { editor } = make('hello');
  type(editor, left); type(editor, left); type(editor, 'X');
  assert.equal(editor.getText(), 'helX');
  assert.equal(editor.getCursor().col, 4);
  type(editor, cmd('z'));
  assert.equal(editor.getText(), 'hello');
});
test('multiline selection does not navigate prompt history at boundaries', () => {
  const { editor } = make('uno\ndos\ntres');
  editor.addToHistory('older prompt');
  type(editor, up); type(editor, up); type(editor, up);
  assert.equal(editor.getText(), 'uno\ndos\ntres');
  assert.ok(editor.selection());
  type(editor, '\x7f');
  assert.equal(editor.getText(), 'uno');
});
test('select words and line boundaries', () => {
  const { editor } = make('hola mundo');
  type(editor, '\x1b[1;4D');
  assert.equal(editor.getText().slice(...editor.selection()), 'mundo');
  type(editor, '\x1b');
  type(editor, '\x1b[1;2H');
  assert.equal(editor.getText().slice(...editor.selection()), 'hola ');
});
test('Unicode graphemes are atomic, including combining marks and joined emoji', () => {
  for (const text of ['cafe\u0301', 'hola 👩‍💻', 'hola 中文']) {
    const { editor } = make(text);
    type(editor, left);
    const range = editor.selection();
    const last = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].at(-1).segment;
    assert.equal(text.slice(...range), last);
    type(editor, '\x7f');
    assert.equal(editor.getText(), text.slice(0, -last.length));
  }
});
test('selected bracketed paste supports split chunks and single undo', () => {
  const { editor } = make('hello');
  type(editor, left); type(editor, left);
  type(editor, '\x1b[200~one\r\n');
  type(editor, 'two\x1b[20');
  type(editor, '1~');
  assert.equal(editor.getText(), 'helone\ntwo');
  type(editor, cmd('z'));
  assert.equal(editor.getText(), 'hello');
});
test('normal bracketed paste and autocomplete submit remain native', () => {
  const { editor } = make();
  type(editor, '\x1b[200~abc\x1b[201~');
  assert.equal(editor.getText(), 'abc');
  let submitted;
  editor.onSubmit = text => { submitted = text; };
  type(editor, '\r');
  assert.equal(submitted, 'abc');
});
test('programmatic insert replaces selection; existing paste markers retain payload', () => {
  const { editor } = make('A');
  const payload = 'x'.repeat(3000);
  type(editor, `\x1b[200~${payload}\x1b[201~`);
  assert.equal(editor.getExpandedText(), 'A' + payload);
  editor.place(1);
  type(editor, left);
  editor.insertTextAtCursor('B');
  assert.equal(editor.getExpandedText(), 'B' + payload);
  type(editor, cmd('z'));
  assert.equal(editor.getExpandedText(), 'A' + payload);
});
test('copy a folded paste expands its payload, not the visible marker', () => {
  const { editor, writes } = make();
  const payload = 'x'.repeat(3000);
  type(editor, `\x1b[200~${payload}\x1b[201~`);
  type(editor, left); type(editor, '\x03');
  assert.equal(writes.at(-1), osc52(payload));
});
test('selection/cursor highlight does not overflow narrow, wrapped or CJK layouts', () => {
  for (const width of [1, 2, 8, 20, 80]) {
    const { editor } = make('words words 👩‍💻 中文\n\nlast line', width);
    type(editor, cmd('a'));
    const rows = editor.render(width);
    for (const line of rows) assert.ok(tui.visibleWidth(line) <= width, `${width}: ${JSON.stringify(line)}`);
    assert.ok(rows.some(s => s.includes('\x1b[48;5;24m')));
  }
});
test('left/right collapse selection; Command+C without selection never clears', () => {
  const { editor } = make('hola');
  type(editor, left); type(editor, left); type(editor, '\x1b[D');
  assert.equal(editor.selection(), null);
  assert.equal(editor.getCursor().col, 2);
  type(editor, cmd('c'));
  assert.equal(editor.getText(), 'hola');
});
test('native app shortcut forwards when there is no selection', () => {
  const { editor } = make('hola');
  let interrupted = false;
  editor.onEscape = () => { interrupted = true; };
  editor.keybindings = { matches: (data, action) => action === 'app.interrupt' && tui.matchesKey(data, 'escape') };
  type(editor, '\x1b');
  assert.equal(interrupted, true);
});
test('cut, select all, copy size limit, stale selection and release-event safety', () => {
  const { editor, writes } = make('hola');
  type(editor, cmd('a')); type(editor, cmd('x'));
  assert.equal(editor.getText(), '');
  assert.equal(writes.at(-1), osc52('hola'));
  type(editor, cmd('z')); type(editor, left);
  editor.setText('changed');
  assert.equal(editor.selection(), null);
  const large = make('a'.repeat(1024 * 1024 + 1));
  type(large.editor, cmd('a')); type(large.editor, cmd('x'));
  assert.equal(large.writes.length, 0);
  assert.equal(large.editor.getText().length, 1024 * 1024 + 1);
  const release = make('hola');
  type(release.editor, '\x1b[97;1:3u');
  assert.equal(release.editor.getText(), 'hola');
});
test('Enter submits unchanged text even while selected; newline shortcut replaces selection', () => {
  const { editor } = make('hola');
  let submitted;
  editor.onSubmit = text => { submitted = text; };
  type(editor, left); type(editor, '\r');
  assert.equal(submitted, 'hola');
  editor.setText('hola'); type(editor, left); type(editor, '\x0a');
  assert.equal(editor.getText(), 'hol\n');
});
test('real Ghostty snippet sequences match the intended Pi shortcuts', () => {
  const config = readFileSync(resolve('config/ghostty.conf'), 'utf8');
  let count = 0;
  for (const line of config.split('\n')) {
    const match = line.match(/^keybind = ([^=]+)=text:(.*)$/);
    if (!match) continue;
    const sequence = match[2].replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    assert.ok(tui.matchesKey(sequence, match[1]), match[1]);
    count++;
  }
  assert.equal(count, 14);
});
test('padded native layout remains width bounded while selecting newline and CJK', () => {
  for (const width of [8, 15, 80]) {
    const { editor } = make('中文\nlast', width);
    editor.setPaddingX(2);
    editor.render(width);
    type(editor, cmd('a'));
    for (const row of editor.render(width)) assert.ok(tui.visibleWidth(row) <= width);
  }
});
test('full layout newline highlight respects padding when the line completely fills content', () => {
  const { editor } = make('abcd\nx', 8);
  editor.setPaddingX(2);
  editor.render(8); type(editor, cmd('a'));
  for (const row of editor.render(8)) assert.ok(tui.visibleWidth(row) <= 8);
});
test('actual Pi extension loader can load package and register its lifecycle/command', async () => {
  const hostRoot = resolve(packageRoot, 'dist');
  const { loadExtensions } = await import(pathToFileURL(resolve(hostRoot, 'core/extensions/loader.js')));
  const path = resolve('extensions/index.js');
  const result = await loadExtensions([path], process.cwd());
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  assert.ok(result.extensions[0].handlers.has('session_start'));
  assert.ok(result.extensions[0].commands.has('selection-editor'));
});
test('arrow-only diagnostic reports modifiers without capturing prompt text', async () => {
  const { loadExtensions } = await import(pathToFileURL(resolve(packageRoot, 'dist/core/extensions/loader.js')));
  const result = await loadExtensions([resolve('extensions/index.js')], process.cwd());
  let listener;
  let unsubscribed = 0;
  const statuses = [];
  const ctx = { mode: 'tui', ui: {
    notify() {},
    setStatus: (_, value) => statuses.push(value),
    onTerminalInput: fn => { listener = fn; return () => { unsubscribed++; }; },
  } };
  await result.extensions[0].commands.get('selection-editor').handler('keys', ctx);
  const before = statuses.length;
  assert.equal(listener('private typed text'), undefined);
  assert.equal(statuses.length, before);
  assert.deepEqual(listener(left), { consume: true });
  assert.match(statuses.at(-1), /shift\+left/);
  listener(right); listener(up); listener(down);
  assert.equal(unsubscribed, 1);
});
