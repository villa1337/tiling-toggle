import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OUTLINE_WIDTH = 3;
const TILE_GAP = 6;
const OUTER_GAP = 6;

export default class TilingToggleExtension extends Extension {
    #settings = null;
    #tiled = false;
    #savedGeometries = new Map();
    #outline = null;
    #focusSignalId = null;
    #windowCreatedSignalId = null;
    #windowCloseSignals = new Map();
    #retileLaterId = null;
    #closeIdleId = null;

    enable() {
        this.#settings = this.getSettings('org.gnome.shell.extensions.tiling-toggle');
        Main.wm.addKeybinding(
            'toggle-tiling',
            this.#settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => this.#toggle()
        );
    }

    disable() {
        Main.wm.removeKeybinding('toggle-tiling');
        this.#cleanup();
        this.#settings = null;
    }

    #toggle() {
        if (this.#tiled) {
            this.#restore();
        } else {
            this.#tile();
        }
    }

    #getWindows() {
        const workspace = global.workspace_manager.get_active_workspace();
        return workspace.list_windows().filter(w =>
            !w.is_skip_taskbar() &&
            !w.minimized &&
            w.get_window_type() === Meta.WindowType.NORMAL
        );
    }

    // --- Core tile/restore ---

    #tile() {
        const windows = this.#getWindows();
        if (windows.length === 0) return;

        this.#savedGeometries.clear();
        for (const win of windows) {
            const rect = win.get_frame_rect();
            this.#savedGeometries.set(win.get_id(), {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                maximized: win.is_maximized(),
            });

            if (win.is_maximized())
                win.unmaximize();
        }

        this.#tiled = true;

        this.#setupOutline();
        this.#connectWindowCreated();
        this.#connectWindowCloseAll(windows);
        this.#retile(windows);
    }

    #restore() {
        const windows = this.#getWindows();

        for (const win of windows) {
            const saved = this.#savedGeometries.get(win.get_id());
            if (!saved) continue;

            win.move_resize_frame(false, saved.x, saved.y, saved.width, saved.height);

            if (saved.maximized)
                win.maximize();
        }

        this.#cleanup();
    }

    #cleanup() {
        this.#cancelPending();
        this.#destroyOutline();
        this.#disconnectWindowCreated();
        this.#disconnectAllWindowClose();
        this.#savedGeometries.clear();
        this.#tiled = false;
    }

    // --- Retile ---

    #retile(windows) {
        this.#cancelPending();

        // Hide outline during layout transition
        if (this.#outline)
            this.#outline.hide();

        this.#applyGrid(windows);

        // Use Meta.later_add to position outline AFTER compositor commits frame rects
        this.#retileLaterId = Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
            this.#retileLaterId = null;
            this.#positionOutline();
            return GLib.SOURCE_REMOVE;
        });
    }

    #cancelPending() {
        if (this.#retileLaterId !== null) {
            Meta.later_remove(this.#retileLaterId);
            this.#retileLaterId = null;
        }
        if (this.#closeIdleId) {
            GLib.source_remove(this.#closeIdleId);
            this.#closeIdleId = null;
        }
    }

    #applyGrid(windows) {
        const monitor = global.display.get_current_monitor();
        const workspace = global.workspace_manager.get_active_workspace();
        const workArea = workspace.get_work_area_for_monitor(monitor);

        const areaX = workArea.x + OUTER_GAP;
        const areaY = workArea.y + OUTER_GAP;
        const areaWidth = workArea.width - OUTER_GAP * 2;
        const areaHeight = workArea.height - OUTER_GAP * 2;

        const count = windows.length;
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);

        const gap = TILE_GAP;
        const totalGapX = gap * (cols - 1);
        const totalGapY = gap * (rows - 1);
        const cellWidth = Math.floor((areaWidth - totalGapX) / cols);
        const cellHeight = Math.floor((areaHeight - totalGapY) / rows);

        for (let i = 0; i < windows.length; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);

            const y = areaY + row * (cellHeight + gap);

            if (row === rows - 1) {
                const windowsInLastRow = count - (rows - 1) * cols;
                const lastGapX = gap * (windowsInLastRow - 1);
                const lastRowWidth = Math.floor((areaWidth - lastGapX) / windowsInLastRow);
                const lastRowCol = i - (rows - 1) * cols;
                windows[i].move_resize_frame(
                    false,
                    areaX + lastRowCol * (lastRowWidth + gap),
                    y,
                    lastRowWidth,
                    cellHeight
                );
            } else {
                const x = areaX + col * (cellWidth + gap);
                windows[i].move_resize_frame(false, x, y, cellWidth, cellHeight);
            }
        }
    }

    // --- Auto-tile new windows ---

    #connectWindowCreated() {
        this.#windowCreatedSignalId = global.display.connect('window-created', (_display, win) => {
            const mapId = win.connect('notify::mapped', () => {
                win.disconnect(mapId);

                if (win.is_skip_taskbar() || win.minimized ||
                    win.get_window_type() !== Meta.WindowType.NORMAL)
                    return;

                if (!this.#tiled) return;

                const rect = win.get_frame_rect();
                this.#savedGeometries.set(win.get_id(), {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    maximized: win.is_maximized(),
                });

                if (win.is_maximized())
                    win.unmaximize();

                this.#connectWindowClose(win);
                this.#retile(this.#getWindows());
            });
        });
    }

    #disconnectWindowCreated() {
        if (this.#windowCreatedSignalId) {
            global.display.disconnect(this.#windowCreatedSignalId);
            this.#windowCreatedSignalId = null;
        }
    }

    // --- Window close handling ---

    #connectWindowClose(win) {
        const signalId = win.connect('unmanaging', () => {
            this.#onWindowClosed(win);
        });
        this.#windowCloseSignals.set(win.get_id(), {window: win, signalId});
    }

    #connectWindowCloseAll(windows) {
        for (const win of windows) {
            this.#connectWindowClose(win);
        }
    }

    #disconnectAllWindowClose() {
        for (const [_id, {window, signalId}] of this.#windowCloseSignals) {
            try {
                window.disconnect(signalId);
            } catch (_e) {}
        }
        this.#windowCloseSignals.clear();
    }

    #onWindowClosed(closedWin) {
        if (!this.#tiled) return;

        const closedId = closedWin.get_id();
        this.#savedGeometries.delete(closedId);
        this.#windowCloseSignals.delete(closedId);

        if (this.#closeIdleId) {
            GLib.source_remove(this.#closeIdleId);
            this.#closeIdleId = null;
        }

        this.#closeIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#closeIdleId = null;
            if (!this.#tiled) return GLib.SOURCE_REMOVE;

            const remaining = this.#getWindows();

            if (remaining.length === 0) {
                this.#cleanup();
                return GLib.SOURCE_REMOVE;
            }

            this.#retile(remaining);
            return GLib.SOURCE_REMOVE;
        });
    }

    // --- Focus outline ---

    #setupOutline() {
        this.#destroyOutline();

        if (!this.#settings.get_boolean('enable-outline'))
            return;

        const color = this.#settings.get_string('outline-color') || '#4a9fff';

        this.#outline = new St.Widget({
            style: `border: ${OUTLINE_WIDTH}px solid ${color};`,
            reactive: false,
            visible: false,
        });
        global.window_group.add_child(this.#outline);

        // Synchronous focus handler — no idle, no deferred positioning.
        // When focus changes, the window rects are already settled.
        this.#focusSignalId = global.display.connect('notify::focus-window', () => {
            this.#positionOutline();
        });
    }

    #positionOutline() {
        if (!this.#outline || !this.#tiled) return;

        const focused = global.display.get_focus_window();

        if (!focused || !this.#savedGeometries.has(focused.get_id())) {
            this.#outline.hide();
            return;
        }

        const rect = focused.get_frame_rect();
        this.#outline.set_position(rect.x - OUTLINE_WIDTH, rect.y - OUTLINE_WIDTH);
        this.#outline.set_size(rect.width + OUTLINE_WIDTH * 2, rect.height + OUTLINE_WIDTH * 2);
        this.#outline.show();

        global.window_group.set_child_above_sibling(this.#outline, null);
    }

    #destroyOutline() {
        if (this.#focusSignalId) {
            global.display.disconnect(this.#focusSignalId);
            this.#focusSignalId = null;
        }

        if (this.#outline) {
            global.window_group.remove_child(this.#outline);
            this.#outline.destroy();
            this.#outline = null;
        }
    }
}
