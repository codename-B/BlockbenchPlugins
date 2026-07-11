import { VS_Element } from "../vs_shape_def";
import {process_group} from "./group";
import {process_cube} from "./cube";
import * as util from "../util";
import { has_children, has_attachments, has_geometry } from "../transform";


/**
 * Traverses the Vintage Story element tree.
 * @param parent The parent Blockbench object.
 * @param object_space_pos The position in the object space.
 * @param vsElements The array of Vintage Story elements to process.
 * @param asBackdrop Whether to import as a backdrop.
 * @param filePath The path to the file being imported (for clothing slot inference)
 */
export function traverse(parent: Group | null, object_space_pos: [number,number,number], vsElements: Array<VS_Element>, asBackdrop: boolean, filePath?: string) {
    for (const vsElement of vsElements) {

        if (has_geometry(vsElement) && !has_children(vsElement) && !has_attachments(vsElement)) {
            // Elements with geometry but no children/attachments become cubes
            process_cube(parent, object_space_pos, vsElement, asBackdrop);
        } else if (has_geometry(vsElement) && (has_children(vsElement) || has_attachments(vsElement))) {
            // Elements with geometry AND children/attachments — should have been expanded by
            // expand_complex_elements, but handle defensively: create cube for geometry,
            // then process children under a group
            console.warn(`[VS Import] Element "${vsElement.name}" has geometry with children/attachments but wasn't expanded. Importing geometry and children separately.`);
            process_cube(parent, object_space_pos, vsElement, asBackdrop);
            const group = process_group(parent, object_space_pos, vsElement, asBackdrop, filePath);
            if (has_children(vsElement)) {
                traverse(group, util.vector_add(vsElement.from, object_space_pos), vsElement.children!, asBackdrop, filePath);
            }
        } else {
            // Elements without geometry become groups (containers, anchors, placeholders)
            const group = process_group(parent, object_space_pos, vsElement, asBackdrop, filePath);
            if (has_children(vsElement)) {
                traverse(group, util.vector_add(vsElement.from, object_space_pos), vsElement.children!, asBackdrop, filePath);
            }
        }
    }
}