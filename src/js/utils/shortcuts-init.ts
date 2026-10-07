import { ShortcutsManager } from '../logic/shortcuts.js';

export function initializeGlobalShortcuts() {
    ShortcutsManager.init();

    console.log('Global shortcuts initialized');
}
