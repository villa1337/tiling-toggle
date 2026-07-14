import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const TILE_GAP = 6; // pixels between tiles
const OUTER_GAP = 6; // pixels from screen edges (top, left, right, bottom)

export default class TilingToggleExtension extends Extension {
    #settings = null;
    #tiled = false;
    #savedGeometries = new Map(); // windowId -> {x, y, width, height, maximized}
    #windowCreatedSignalId = null;
    #windowCloseSignals = new Map(); // windowId -> {window, signalId}
    #retileIdleId = null;
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

        // Save current geometries
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

        // Connect window lifecycle signals
        this.#connectWindowCreated();
        this.#connectWindowCloseAll(windows);

        // Apply grid
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
        this.#cancelAllIdles();
        this.#disconnectWindowCreated();
        this.#disconnectAllWindowClose();
        this.#savedGeometries.clear();
        this.#tiled = false;
    }

    // --- Retile: the single path that applies grid ---

    #retile(windows) {
        // Cancel pending idle callbacks
        this.#cancelAllIdles();

        // Apply the grid layout
        this.#applyGrid(windows);

        this.#retileIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#retileIdleId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    #cancelAllIdles() {
        if (this.#retileIdleId) {
            GLib.source_remove(this.#retileIdleId);
            this.#retileIdleId = null;
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

        // Inset work area by outer gap
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

            // Last row might have fewer windows — stretch them
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

                // Save its geometry so we can restore later
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

                // Retile everything including the new window
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
            } catch (_e) {
                // Window may already be destroyed
            }
        }
        this.#windowCloseSignals.clear();
    }

    #onWindowClosed(closedWin) {
        if (!this.#tiled) return;

        const closedId = closedWin.get_id();
        this.#savedGeometries.delete(closedId);
        this.#windowCloseSignals.delete(closedId);

        // Cancel any previous close idle (rapid closes)
        if (this.#closeIdleId) {
            GLib.source_remove(this.#closeIdleId);
            this.#closeIdleId = null;
        }

        // Defer retile — window hasn't fully gone yet
        this.#closeIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#closeIdleId = null;
            if (!this.#tiled) return GLib.SOURCE_REMOVE;

            const remaining = this.#getWindows();

            if (remaining.length === 0) {
                this.#cleanup();
                return GLib.SOURCE_REMOVE;
            }

            // Retile remaining windows
            this.#retile(remaining);
            return GLib.SOURCE_REMOVE;
        });
    }
}
