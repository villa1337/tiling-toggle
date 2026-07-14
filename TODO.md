# Tiling Toggle — TODO

## Phase 1: Minimal Working Extension

- [x] metadata.json with correct uuid, name, shell-version (50)
- [x] extension.js skeleton (Extension class, enable/disable lifecycle)
- [x] Register keybinding (Super+P) via GSettings + Main.wm.addKeybinding
- [x] On press: get all windows on active workspace
- [x] Save each window's current geometry (x, y, width, height) to a Map
- [x] Tile all windows in a grid layout (equal-size cells filling the work area)
- [x] On second press: restore all windows from saved geometry
- [x] Toggle state tracking (tiled vs. free)
- [x] GSchema XML for the keybinding
- [x] install.sh script (compile schemas + gnome-extensions install)
- [x] BUG FIX: Added `settings-schema` to metadata.json + explicit schema ID in getSettings() call
- [ ] **PENDING TEST**: Log out/in required, then `gnome-extensions enable tiling-toggle@villa1337` and test Super+P

## Phase 2: Edge Cases & Polish

- [ ] Handle minimized windows (skip them? or unminimize + tile?)
- [ ] Handle fullscreen windows (skip them? or unfullscreen + tile?)
- [ ] Handle new windows opened while tiled (don't break restore)
- [ ] Handle closed windows while tiled (remove from saved state, don't crash on restore)
- [ ] Handle workspace switch while tiled (per-workspace state?)
- [ ] Animate tile/restore transitions (if GNOME API supports it)
- [ ] Multi-monitor: tile per-monitor or across all?

## Phase 3: Preferences & Configurability

- [ ] prefs.js with a UI for changing the keybinding
- [ ] Setting: grid columns preference (auto based on window count vs. fixed)
- [ ] Setting: gap/padding between tiled windows
- [ ] Setting: exclude certain apps from tiling (by WM_CLASS)

## Phase 4: Packaging & Distribution

- [ ] Test on fresh GNOME 50 session
- [ ] Test on nested Wayland
- [ ] Create zip package for extensions.gnome.org
- [ ] Add screenshots/GIF to README
- [ ] Push to GitHub (villa1337/tiling-toggle)
- [ ] Submit to extensions.gnome.org (optional)

## Testing Checklist

- [ ] Extension loads without errors in journal
- [ ] Keybinding registers and fires
- [ ] 2 windows → tiles side by side
- [ ] 3 windows → tiles in grid (2+1 or 1×3)
- [ ] 4 windows → tiles in 2×2 grid
- [ ] 6+ windows → tiles in appropriate grid
- [ ] Restore returns all windows to exact previous positions
- [ ] Toggle works repeatedly (tile → restore → tile → restore)
- [ ] No crash on enable/disable cycle
- [ ] No crash if triggered with 0 windows
- [ ] No crash if triggered with 1 window
- [ ] Works on Wayland (no X11-only APIs used)

## Notes

- GNOME 50 uses ESM (import/export), NOT the old `ExtensionUtils` pattern
- Use `global.workspace_manager.get_active_workspace()` for current workspace
- Use `Meta.Window` methods: `get_frame_rect()`, `move_resize_frame()`
- Work area (excluding top bar): `workspace.get_work_area_for_monitor()`
- Keybinding requires a GSettings schema with the keybinding key
