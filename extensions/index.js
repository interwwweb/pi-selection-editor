import { CustomEditor, VERSION } from '@earendil-works/pi-coding-agent';
import { matchesKey, parseKey, decodeKittyPrintable, isKeyRelease, visibleWidth, truncateToWidth, CURSOR_MARKER } from '@earendil-works/pi-tui';
import { createSelectionEditor } from '../src/selection-editor.js';

const SelectionEditor = createSelectionEditor(CustomEditor, {
  matchesKey, decodeKittyPrintable, isKeyRelease, visibleWidth, truncateToWidth, CURSOR_MARKER,
});

export default function selectionEditor(pi) {
  let state = 'not initialized';
  let stopKeys;
  function install(ctx) {
    if (ctx.mode !== 'tui') return;
    if (!/^0\.87\.(\d+)(?:$|-)/.test(VERSION) || Number(VERSION.split('.')[2].split('-')[0]) < 1) {
      state = `unsupported Pi ${VERSION}`;
      ctx.ui.notify(`Selection editor not validated for Pi ${VERSION}; native editor retained.`, 'warning');
      return;
    }
    ctx.ui.setEditorComponent((tui, theme, keys) => {
      try {
        const editor = new SelectionEditor(tui, theme, keys);
        state = 'active';
        return editor;
      }
      catch (error) {
        state = `native fallback: ${error.message}`;
        ctx.ui.notify(`Selection editor disabled: ${error.message}`, 'warning');
        return new CustomEditor(tui, theme, keys);
      }
    });
  }
  pi.on('session_start', (_event, ctx) => install(ctx));
  pi.on('session_shutdown', () => { stopKeys?.(); stopKeys = undefined; });
  pi.registerCommand('selection-editor', {
    description: 'Prompt selection: on, off, help, status, or keys (arrow-only diagnosis)',
    handler: async (args, ctx) => {
      if (ctx.mode !== 'tui') return;
      const action = args.trim();
      if (action === 'keys') {
        stopKeys?.();
        let remaining = 4;
        ctx.ui.setStatus('selection-keys', 'Press Shift+arrows: waiting for arrow keys (no text recorded)');
        stopKeys = ctx.ui.onTerminalInput(data => {
          const key = parseKey(data);
          if (!key || !/(?:^|\+)(?:left|right|up|down)$/.test(key) || isKeyRelease(data)) return;
          ctx.ui.setStatus('selection-keys', `Pi received: ${key}; editor: ${state}`);
          if (--remaining === 0) { stopKeys?.(); stopKeys = undefined; }
          return { consume: true }; // Diagnostic arrows must not alter the prompt.
        });
        ctx.ui.notify('Press four Shift+arrows. Footer shows received modifiers. Only arrow keys are examined; no text is logged.', 'info');
      } else if (action === 'off') {
        state = 'off';
        stopKeys?.(); stopKeys = undefined;
        ctx.ui.setStatus('selection-keys', undefined);
        ctx.ui.setEditorComponent(undefined);
        ctx.ui.notify('Native editor restored.', 'info');
      } else if (action === 'on') {
        install(ctx);
        ctx.ui.notify(`Selection editor: ${state}.`, state === 'active' ? 'info' : 'warning');
      } else {
        ctx.ui.notify(`Selection editor: ${state}; Pi ${VERSION}. Shift+arrows: select; Alt/Ctrl+Shift+left/right: words; Backspace/Delete: delete; Ctrl+C with selection: OSC52 copy. Ghostty snippet adds Command+C/X/A/Z. /selection-editor off restores native editor.`, 'info');
      }
    },
  });
}
