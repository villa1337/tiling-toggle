# Tiling Toggle — GNOME Shell Extension

A simple GNOME Shell extension that tiles all windows on the current workspace with a single keybinding, and restores them to their original positions/sizes on a second press.

## Concept

- **Press once:** Save every window's current geometry (position + size), then tile them all in a grid layout filling the screen.
- **Press again:** Restore all windows to their saved geometry.
- **Toggle behavior:** No persistent tiling. It's a quick "organize / restore" action.

## Target

- GNOME Shell 50+ (Fedora 44)
- ESM format (import/export)
- Wayland compatible

## UUID

`tiling-toggle@villa1337`

## File Structure

```
tiling-toggle/
├── src/
│   ├── extension.js          # Main extension logic (enable/disable, keybinding, tiling)
│   ├── metadata.json         # Extension metadata (uuid, name, shell-version)
│   ├── prefs.js              # Preferences UI (optional, later)
│   └── schemas/
│       └── org.gnome.shell.extensions.tiling-toggle.gschema.xml
├── scripts/
│   ├── install.sh            # Build + install locally
│   └── dev.sh               # Dev loop (install + restart gnome-shell via nested Wayland)
├── README.md
└── TODO.md
```

## Development Workflow

### Install locally

```bash
./scripts/install.sh
```

This compiles schemas, packs the extension, and installs it via `gnome-extensions install --force`.

### Enable

```bash
gnome-extensions enable tiling-toggle@villa1337
```

### Disable

```bash
gnome-extensions disable tiling-toggle@villa1337
```

### View logs

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Or for extension-specific output:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i tiling-toggle
```

### Test on nested Wayland (safe, no session crash risk)

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

## Keybinding

Default: `Super+P` (configurable via GSettings/prefs later)
