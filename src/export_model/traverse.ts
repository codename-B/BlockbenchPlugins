import { VS_Element } from "../vs_shape_def";
import {process_cube} from "./cube";
import {process_group, process_collapsed_group} from "./group";

/**
 * Traverses the Blockbench outliner and processes nodes for export.
 * @param parent The parent node in the hierarchy.
 * @param nodes The array of nodes to process.
 * @param accu The accumulator for the VS elements.
 * @param offset The position offset to apply.
 * @param parent_from_override When set, child positions are computed relative to this
 *   instead of parent.origin. Used when the VS element's `from` differs from its
 *   `rotationOrigin` (complex elements with geometry + children).
 */
export function traverse(parent: Group | null, nodes: Array<OutlinerNode>, accu: Array<VS_Element>, offset: [number,number,number], parent_from_override?: [number, number, number]) {
    // Collect _geo cubes that will be collapsed into their parent group
    const collapsedGeoCubes = new Set<Cube>();

    // First pass: identify groups with _geo children
    for (const node of nodes) {
        if (!node.export) continue;
        if (node instanceof Group) {
            const geoChild = find_geo_child(node);
            if (geoChild) {
                collapsedGeoCubes.add(geoChild);
            }
        }
    }

    // Second pass: process nodes, skipping collapsed _geo cubes
    for (const node of nodes) {
        if(!node.export) continue;
        if (node instanceof Group) {
            const geoChild = find_geo_child(node);
            if (geoChild) {
                process_collapsed_group(parent, node, geoChild, accu, offset, parent_from_override);
            } else {
                process_group(parent, node, accu, offset, parent_from_override);
            }
        } else if (node instanceof Cube) {
            // Skip cubes that were collapsed into their parent group
            if (collapsedGeoCubes.has(node)) continue;
            process_cube(parent, node, accu, offset, parent_from_override);
        }
        // Locator nodes are handled as attachment points on their parent elements, so skip them here
    }
}

/**
 * Finds a _geo child cube that was created by expand_complex_element during import.
 * @param group The group to search in.
 * @returns The _geo Cube if found, undefined otherwise.
 */
function find_geo_child(group: Group): Cube | undefined {
    const geoName = `${group.name}_geo`;
    return group.children.find(
        child => child instanceof Cube
            && child.name === geoName
            && child.export
    ) as Cube | undefined;
}
