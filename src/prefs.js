import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TilingTogglePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.tiling-toggle');

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        });
        window.add(page);

        // --- Keybinding ---
        const group = new Adw.PreferencesGroup({
            title: 'Keybinding',
            description: 'Choose the keyboard shortcut to toggle tiling',
        });
        page.add(group);

        const row = new Adw.ActionRow({
            title: 'Toggle Tiling',
            subtitle: 'Tile/restore all windows on the current workspace',
        });
        group.add(row);

        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: 'Disabled',
            valign: Gtk.Align.CENTER,
        });
        row.add_suffix(shortcutLabel);
        row.set_activatable_widget(shortcutLabel);

        const updateLabel = () => {
            const bindings = settings.get_strv('toggle-tiling');
            shortcutLabel.set_accelerator(bindings.length > 0 ? bindings[0] : '');
        };
        updateLabel();

        const settingsId = settings.connect('changed::toggle-tiling', updateLabel);
        window.connect('close-request', () => {
            settings.disconnect(settingsId);
        });

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();

            if (mask === 0 && keyval === Gdk.KEY_Escape) {
                settings.set_strv('toggle-tiling', []);
                return Gdk.EVENT_STOP;
            }

            if (mask === 0)
                return Gdk.EVENT_PROPAGATE;

            const accelerator = Gtk.accelerator_name_with_keycode(
                null, keyval, keycode, mask
            );

            if (accelerator) {
                settings.set_strv('toggle-tiling', [accelerator]);
            }

            return Gdk.EVENT_STOP;
        });
        row.add_controller(controller);

        // --- Focus Outline ---
        const outlineGroup = new Adw.PreferencesGroup({
            title: 'Focus Outline',
            description: 'Highlight the focused window while tiled',
        });
        page.add(outlineGroup);

        const outlineRow = new Adw.SwitchRow({
            title: 'Show Focus Outline',
            subtitle: 'Draw a colored border around the focused tiled window',
        });
        outlineGroup.add(outlineRow);
        settings.bind('enable-outline', outlineRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const colorRow = new Adw.ActionRow({
            title: 'Outline Color',
            subtitle: 'Border color for the focus highlight',
        });
        outlineGroup.add(colorRow);

        const colorButton = new Gtk.ColorDialogButton({
            valign: Gtk.Align.CENTER,
            dialog: new Gtk.ColorDialog({title: 'Outline Color'}),
        });
        colorRow.add_suffix(colorButton);

        const loadColor = () => {
            const hex = settings.get_string('outline-color') || '#4a9fff';
            const rgba = new Gdk.RGBA();
            rgba.parse(hex);
            colorButton.set_rgba(rgba);
        };
        loadColor();

        colorButton.connect('notify::rgba', () => {
            const rgba = colorButton.get_rgba();
            const r = Math.round(rgba.red * 255);
            const g = Math.round(rgba.green * 255);
            const b = Math.round(rgba.blue * 255);
            const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            settings.set_string('outline-color', hex);
        });

        settings.bind('enable-outline', colorRow, 'sensitive',
            Gio.SettingsBindFlags.DEFAULT);
    }
}
