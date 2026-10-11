# Pi Selection Editor

Portable Pi package for selecting and editing prompt text, including OSC 52 copy over SSH/Herdr.
No Pi core patches, external clipboard commands, npm dependencies or browser downloads.

## Install on any server or computer

With Pi **0.87.1–0.87.x**, copy this directory to a durable location and run:

```sh
pi install /absolute/path/to/pi-selection-editor
```

Alternatively run `bash /absolute/path/to/pi-selection-editor/scripts/install.sh`; it checks compatibility
and installs without downloading dependencies. Then run `/reload` inside the existing Pi session (or start Pi).
The installer also makes `~/.local/share/pi-selection-editor` point to the source (without overwriting
an existing installation). Set `PI_SELECTION_EDITOR_DIR` to override that stable path. This uses Pi's actual agent directory,
including `PI_CODING_AGENT_DIR`, not a hardcoded `~/.pi/agent`. Moving the source directory requires
removing the old package declaration and installing the new path.

Test first without persisting: `pi -e /absolute/path/to/pi-selection-editor`.

For repeatable multi-machine deployment, install the versioned Git repository:

```sh
pi install git:github.com/interwwweb/pi-selection-editor@v0.1.2
```

Pin releases; run tests against new Pi versions before changing compatibility. A portable tar archive
can also be copied/extracted on another host, followed by the installer:

```sh
mkdir -p ~/.local/share/pi-selection-editor
tar -xzf pi-selection-editor-0.1.2.tgz -C ~/.local/share/pi-selection-editor --strip-components=1
bash ~/.local/share/pi-selection-editor/scripts/install.sh
```

Keep this installed directory: a local Pi package is loaded in place, not copied.

## Launchers with `--no-extensions` (including pi-core-full)

Package installation alone is intentionally ignored by this flag. `/reload` cannot change the CLI
arguments of an already running process. Start with an explicit extension instead:

```sh
pi-core-full --extension "$HOME/.local/share/pi-selection-editor/extensions/index.js" --resume
```

Or make the same `--extension` argument part of your launcher. Keep `--no-extensions` so unrelated
extensions remain disabled. The current server's `~/.local/bin/pi-core-full` was updated to include
this extension only when the stable path exists; on another host that launcher change must be
replicated or the explicit command above used. **Restart and resume** after changing launch arguments;
subsequent source changes can use `/reload` once the extension is included in the process arguments.

## Keyboard behavior

| Shortcut | Behavior |
| --- | --- |
| Shift+Left/Right | Extend/reverse selection by grapheme |
| Shift+Up/Down | Extend selection across visual lines, keeping the column like a standard editor |
| Alt/Option+Shift+Left/Right | Extend by word |
| Ctrl+Shift+Left/Right | Alternative word selection, if the terminal forwards it |
| Shift+Home/End | Select to logical line start/end |
| Backspace/Delete | Delete selected text |
| Typing or paste | Replace selection in one undo operation |
| Ctrl+C with selection | Copy through OSC 52; without selection native Pi behavior remains |
| Escape with selection | Deselect; second Escape resumes native behavior |
| Left/Right with selection | Collapse to selection start/end |
| Command+C/X/A/Z | Copy / cut / select all / undo with the Ghostty configuration below |
| Command+Shift+Left/Right | Select to logical line start/end with Ghostty configuration |
| Command+Shift+Up/Down | Select to prompt start/end with Ghostty configuration |
| Command+V | Ghostty's native paste from the local Mac clipboard |

Shift+Up/Down is standard column-based selection, **not** a separate whole-line selection mode.
Regular/fullscreen rendering retains native borders, autocomplete and hardware cursor markers.
Mouse drag in the transcript remains terminal/Pi transcript selection; this package does not implement
mouse drag selection of editable prompt ranges. Fullscreen click cancels prompt selection and places
the native cursor. Unicode graphemes and folded paste markers remain atomic.

## Ghostty on your Mac (manual step)

The terminal configuration belongs on the **Mac**, not on the remote Linux host.

`config/ghostty.conf` contains the optional mappings. Open your Ghostty configuration with Command+comma
and copy the entries, or include the downloaded file using an **absolute local Mac path**:

```ini
config-file = /absolute/mac/path/to/pi-selection-editor/config/ghostty.conf
```

Reload Ghostty's configuration using its menu or command palette. Leave Command+V's native mapping intact.

**Important:** Command+C/X/A/Z are overridden for every application in the terminal using this config.
Use a **dedicated Pi terminal/profile**, not all your ordinary shell windows, if you want to retain the
normal terminal shortcuts elsewhere. Do not blindly duplicate or overwrite existing config files.
Without this optional configuration, Shift selection and Ctrl+C work only if the outer terminal forwards
the keys. Ghostty can use Shift+arrows for its own selection; this snippet explicitly forwards those four
combinations as well as the Command shortcuts.
Removing the include/mappings restores Ghostty's original shortcuts.

The mapping sends explicit key sequences, so it does not require Ghostty to exist on the server.
OSC 52 must be allowed by the outer terminal and forwarded by intervening multiplexers.
OSC 52 copy was independently confirmed by the user on the current Mac → Herdr → server connection.
The final mapped Command shortcuts still require an interactive test from that Mac.

## If selection does not work

0. If `/selection-editor status` is sent to the model as an ordinary message, the extension command
   is not loaded. Check the launcher for `--no-extensions`; follow the explicit-load instructions above.
1. `/selection-editor status` must report **active**. If not, try `/selection-editor on` and note the exact warning.
2. `/selection-editor keys`, then press Shift+Left/Right/Up/Down. The footer must show `shift+left`, etc.
   Plain `left` means a modifier was lost. No response means an earlier terminal/multiplexer layer may
   have consumed the key. This diagnostic checks only four arrow events and never records typed text.
3. Apply `config/ghostty.conf` on your Mac and reload Ghostty (Pi `/reload` does not reload Ghostty).
4. At minimum, add these **Mac-side** mappings:

```ini
keybind = shift+left=text:\x1b[1;2D
keybind = shift+right=text:\x1b[1;2C
keybind = shift+up=text:\x1b[1;2A
keybind = shift+down=text:\x1b[1;2B
```

## Recovery

- `/selection-editor off`: restore the native editor immediately.
- `/selection-editor on`: enable again; `/selection-editor help`: show shortcuts.
- `pi remove /absolute/path/to/pi-selection-editor`: uninstall persistently; then `/reload`.
- `pi -ne`: start Pi without configured extensions for diagnosis.
- Also remove the optional Mac key mappings when disabling the package.

There can be only **one custom editor**. Do not combine this package with vim/modal/custom editor
extensions: whichever installs last owns the editor. Clipboard operations are explicit user keypresses,
never automatic clipboard reads. Copy is limited to 1 MiB; oversized cut does not delete the text.
Selected bracketed paste is bounded to 16 MiB. No prompt, credential or clipboard content is logged.

## Compatibility and verification

Pi does not yet expose a public selection/cursor setter API. This package subclasses `CustomEditor`
and isolates the necessary native editor hooks in `src/selection-editor.js`. Runtime shape checks and
a Pi 0.87.x version guard retain the native editor if incompatible. It is **not** a guarantee of support
for all future Pi releases. Do not patch global `node_modules` to fix compatibility.

Run `npm test` with the installed `pi` on PATH. Tests use that installation without downloading anything.
For alternate installations set `PI_TEST_ENTRY` to the real Pi CLI JavaScript entry path.
Tests cover selection, words, multiline movement/history boundaries, Unicode, atomic undo, paste chunks,
folded paste payloads, copy/cut, render widths, app shortcut forwarding and the actual Pi extension loader.

After `/reload`, manually verify in the real Ghostty/Herdr connection:

1. Type `hola mundo`, select with Shift+Left and delete; undo.
2. Select a word with Option+Shift+Left, type replacement and undo.
3. Make a multiline prompt, extend with Shift+Up/Down and paste into selection.
4. Copy the selection with Ctrl+C and paste into a Mac application.
5. After applying Ghostty mappings, repeat with Command+C/V/X/A/Z.
6. Check normal Enter submission, autocomplete, Escape and model/app shortcuts.

A separate real Pi TUI/PTY smoke test confirmed Shift+arrow selection highlighting on this server.
That bypasses Ghostty/Herdr and does not replace the Mac-to-server interactive checks.
