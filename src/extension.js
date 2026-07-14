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
    #windowFullscreenSignals = new Map();
    #retileLaterId = null;
    #closeIdleId = null;
    #outlineDelayId = null;
    #retiling = false;

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
            !w.is_fullscreen() &&
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
        this.#connectWindowFullscreenAll(windows);
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
        this.#disconnectAllWindowFullscreen();
        this.#savedGeometries.clear();
        this.#tiled = false;
    }

    // --- Retile ---

    #retile(windows) {
        this.#cancelPending();
        this.#retiling = true;

        // Hide outline during layout transition
        if (this.#outline)
            this.#outline.hide();

        this.#applyLayout(windows);

        // Two-stage defer: BEFORE_REDRAW lets Mutter commit the layout,
        // then a second BEFORE_REDRAW on the next frame reads settled rects.
        // After both frames, a short timeout (50ms) gives the compositor time
        // to fully paint the settled positions before we draw the outline.
        const laters = global.compositor.get_laters();
        this.#retileLaterId = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this.#retileLaterId = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
                this.#retileLaterId = null;
                // Small delay so the compositor finishes painting settled windows
                this.#outlineDelayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    this.#outlineDelayId = null;
                    this.#retiling = false;
                    this.#positionOutline();
                    return GLib.SOURCE_REMOVE;
                });
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    #cancelPending() {
        if (this.#retileLaterId !== null) {
            global.compositor.get_laters().remove(this.#retileLaterId);
            this.#retileLaterId = null;
        }
        if (this.#outlineDelayId) {
            GLib.source_remove(this.#outlineDelayId);
            this.#outlineDelayId = null;
        }
        if (this.#closeIdleId) {
            GLib.source_remove(this.#closeIdleId);
            this.#closeIdleId = null;
        }
        this.#retiling = false;
    }

    #applyLayout(windows) {
        const mode = this.#settings.get_string('layout-mode');
        if (mode === 'fibonacci')
            this.#applyFibonacci(windows);
        else
            this.#applyGrid(windows);
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

    #applyFibonacci(windows) {
        const monitor = global.display.get_current_monitor();
        const workspace = global.workspace_manager.get_active_workspace();
        const workArea = workspace.get_work_area_for_monitor(monitor);

        const gap = TILE_GAP;
        let x = workArea.x + OUTER_GAP;
        let y = workArea.y + OUTER_GAP;
        let w = workArea.width - OUTER_GAP * 2;
        let h = workArea.height - OUTER_GAP * 2;

        const count = windows.length;

        for (let i = 0; i < count; i++) {
            if (i === count - 1) {
                // Last window takes all remaining space
                windows[i].move_resize_frame(false, x, y, w, h);
            } else {
                // Alternate splits: even = vertical (left/right), odd = horizontal (top/bottom)
                if (i % 2 === 0) {
                    // Split vertically — this window gets the left portion
                    const splitW = Math.floor((w - gap) * 0.55);
                    windows[i].move_resize_frame(false, x, y, splitW, h);
                    x += splitW + gap;
                    w -= splitW + gap;
                } else {
                    // Split horizontally — this window gets the top portion
                    const splitH = Math.floor((h - gap) * 0.55);
                    windows[i].move_resize_frame(false, x, y, w, splitH);
                    y += splitH + gap;
                    h -= splitH + gap;
                }
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
                this.#connectWindowFullscreen(win);
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
        this.#disconnectWindowFullscreen(closedId);

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

    // --- Fullscreen handling ---

    #connectWindowFullscreen(win) {
        const signalId = win.connect('notify::fullscreen', () => {
            this.#onWindowFullscreenChanged(win);
        });
        this.#windowFullscreenSignals.set(win.get_id(), {window: win, signalId});
    }

    #connectWindowFullscreenAll(windows) {
        for (const win of windows) {
            this.#connectWindowFullscreen(win);
        }
    }

    #disconnectWindowFullscreen(winId) {
        const entry = this.#windowFullscreenSignals.get(winId);
        if (entry) {
            try {
                entry.window.disconnect(entry.signalId);
            } catch (_e) {}
            this.#windowFullscreenSignals.delete(winId);
        }
    }

    #disconnectAllWindowFullscreen() {
        for (const [_id, {window, signalId}] of this.#windowFullscreenSignals) {
            try {
                window.disconnect(signalId);
            } catch (_e) {}
        }
        this.#windowFullscreenSignals.clear();
    }

    #onWindowFullscreenChanged(win) {
        if (!this.#tiled) return;

        // Whether entering or exiting fullscreen, retile the remaining
        // non-fullscreen windows. The outline will be hidden during retile
        // and repositioned on the correct (non-fullscreen) focused window.
        const remaining = this.#getWindows();

        if (remaining.length === 0) {
            // All windows are fullscreen — just hide the outline
            if (this.#outline)
                this.#outline.hide();
            return;
        }

        this.#retile(remaining);
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
        // Skip during active retile — the retile callback will position the outline.
        this.#focusSignalId = global.display.connect('notify::focus-window', () => {
            if (!this.#retiling)
                this.#positionOutline();
        });
    }

    #positionOutline() {
        if (!this.#outline || !this.#tiled) return;

        const focused = global.display.get_focus_window();

        if (!focused || !this.#savedGeometries.has(focused.get_id()) || focused.is_fullscreen()) {
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
