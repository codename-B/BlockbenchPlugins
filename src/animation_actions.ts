import { createAction } from "./util/moddingTools";
import * as PACKAGE from "../package.json";
import { is_vs_project } from "./util";
import { clear_animations, import_animation_library } from "./import_animation";
import { export_animation_library } from "./export_animation";

// @ts-expect-error: requireNativeModule is missing in blockbench types --- IGNORE ---
const fs = requireNativeModule('fs');

const import_animations_action = createAction(`${PACKAGE.name}:import_animations_vs`, {
    name: 'Import Animations from VS Format',
    icon: 'movie',
    condition() {
        return is_vs_project(Project);
    },
    click: function () {
        Blockbench.import({
            type: 'json',
            extensions: ['json'],
        }, function (files) {
            try {
                const content = autoParseJSON(files[0].content as string);
                const count = import_animation_library(content);
                Blockbench.showQuickMessage(count > 0
                    ? `Imported ${count} animation${count === 1 ? '' : 's'}`
                    : 'No animations found in file');
            } catch (e) {
                console.error('[VS Animation Import] Import failed:', e);
                Blockbench.showMessageBox({
                    title: 'VS Animation Import Error',
                    message: `Import failed: ${e instanceof Error ? e.message : String(e)}`
                });
            }
        });
    }
});
MenuBar.addAction(import_animations_action, 'file.import');

const export_animations_action = createAction(`${PACKAGE.name}:export_animations_vs`, {
    name: 'Export Animations to VS Format',
    icon: 'movie',
    condition() {
        return is_vs_project(Project);
    },
    click: function () {
        if (!Project) {
            throw new Error("No project loaded during animation export");
        }

        const animations = (Animation as unknown as typeof _Animation).all;
        if (animations.length === 0) {
            Blockbench.showQuickMessage('No animations to export');
            return;
        }

        const projectName = Project.name || 'animations';
        const defaultCode = projectName.toLowerCase().replace(/\s+/g, '-');

        const form: InputFormConfig = {
            library_code: { label: 'Library Code', type: 'text', value: defaultCode, description: 'Optional identifier, used only in log messages' },
            library_name: { label: 'Library Name', type: 'text', value: projectName, description: 'Optional display name, used only in log messages' },
            '_': '_',
            _info: { type: 'info', text: `Select animations to include (${animations.length} available):` },
        };

        animations.forEach((anim, i) => {
            form[`anim_${i}`] = { label: anim.name, type: 'checkbox', value: true };
        });

        new Dialog(`${PACKAGE.name}:export_animations_dialog`, {
            title: 'Export Animations to VS Format',
            form,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onConfirm(formResult: any) {
                const selectedNames = new Set<string>();
                animations.forEach((anim, i) => {
                    if (formResult[`anim_${i}`]) selectedNames.add(anim.name);
                });

                if (selectedNames.size === 0) {
                    Blockbench.showQuickMessage('No animations selected');
                    return;
                }

                const code = (formResult.library_code as string)?.trim() || undefined;
                const name = (formResult.library_name as string)?.trim() || undefined;
                const filenameStem = code || defaultCode;

                Blockbench.export({
                    name: filenameStem,
                    type: 'json',
                    extensions: ['json'],
                    savetype: 'text',
                    custom_writer: (_content, exportPath) => {
                        try {
                            const library = export_animation_library(code, name);
                            library.animations = library.animations.filter(a => selectedNames.has(a.name));
                            fs.writeFileSync(exportPath, autoStringify(library));
                            Blockbench.showQuickMessage(`Exported ${library.animations.length} animation${library.animations.length === 1 ? '' : 's'}`);
                        } catch (e) {
                            console.error('[VS Animation Export] Export failed:', e);
                            Blockbench.showMessageBox({
                                title: 'VS Animation Export Error',
                                message: `Export failed: ${e instanceof Error ? e.message : String(e)}`
                            });
                        }
                    }
                });
            }
        }).show();
    }
});
MenuBar.addAction(export_animations_action, 'file.export');

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
