import {traverse} from "./export_model/traverse";
import { VS_Element } from "./vs_shape_def";

declare var Settings: any;

/**
 * Exports the Blockbench model hierarchy to the Vintage Story element format.
 * @returns An array of VS model elements.
 */
export function export_model(): Array<VS_Element> {
    const elements = [];
    const topLevelNodes = Outliner.root;

    // Apply [8, 0, 8] offset if enabled in settings (default: true)
    // Vintage Story engine requires models to be centered at [8, 0, 8]
    // instead of [0, 0, 0] to properly align with the block grid
    const applyOffset = Settings.get("vs_apply_model_offset") ?? true;
    let offset: [number,number,number] = applyOffset ? [8, 0, 8] : [0, 0, 0];

    traverse(null, topLevelNodes, elements, offset);
    return elements;
}