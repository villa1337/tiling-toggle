import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TilingTogglePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.tiling-toggle');

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        });
        window.add(page);

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

        // Load current binding
        const updateLabel = () => {
            const bindings = settings.get_strv('toggle-tiling');
            shortcutLabel.set_accelerator(bindings.length > 0 ? bindings[0] : '');
        };
        updateLabel();

        // Listen for changes
        const settingsId = settings.connect('changed::toggle-tiling', updateLabel);
        window.connect('close-request', () => {
            settings.disconnect(settingsId);
        });

        // Capture new shortcut on click
        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();

            // Allow Escape to cancel / clear
            if (mask === 0 && keyval === Gdk.KEY_Escape) {
                settings.set_strv('toggle-tiling', []);
                return Gdk.EVENT_STOP;
            }

            // Require at least one modifier
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
    }
}
