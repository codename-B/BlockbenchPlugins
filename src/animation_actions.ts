import { createAction } from "./util/moddingTools";
import * as PACKAGE from "../package.json";
import { is_vs_project } from "./util";
import { clear_animations } from "./import_animation";

// Importing and exporting VS animation files is handled natively by the multi-file
// animation workflow (format `animation_files` + the VS AnimationCodec): use the
// ANIMATIONS panel's Import Animations / Save / Save All. Only the bulk-clear helper
// remains as a convenience action here.

const clear_animations_action = createAction(`${PACKAGE.name}:clear_animations_vs`, {
    name: 'Clear All Animations',
    icon: 'delete_sweep',
    condition() {
        return is_vs_project(Project);
    },
    click: function () {
        const total = (Animation as unknown as typeof _Animation).all.length;
        if (total === 0) {
            Blockbench.showQuickMessage('No animations to clear');
            return;
        }
        if (!confirm(`Delete all ${total} animation${total === 1 ? '' : 's'} from this project?\n\nThis can be undone with Ctrl+Z.`)) {
            return;
        }
        const removed = clear_animations();
        Blockbench.showQuickMessage(`Cleared ${removed} animation${removed === 1 ? '' : 's'}`);
    }
});
MenuBar.addAction(clear_animations_action, 'edit');
