import { createExportCodec } from './codec';
import { codecVS } from '../codec';
import { import_model } from '../import_model';
import { VS_Shape } from '../vs_shape_def';
import * as util from '../util';
declare var Action: any;
declare var Group: any;
declare var Outliner: any;
declare var Undo: any;
declare var Canvas: any;
declare var Codecs: any;
declare var Blockbench: any;
declare var Texture: any;
declare var Project: any;

declare function autoParseJSON(content: string): any;
declare function updateSelection(): void;

/**
 * Merges a VS attachment into the current project without overwriting project settings
 * @param content The VS_Shape data to merge
 * @param filePath The path to the file being imported (for clothing slot inference)
 */
function mergeVSAttachment(content: VS_Shape, filePath?: string) {
    // Add textures if they don't already exist
    for (const name in content.textures) {
        const existingTexture = Texture.all.find((t: any) => t.name === name);
        if (!existingTexture) {
            const texturePath = util.get_texture_location(null, content.textures[name]);
            const texture = new Texture({ name, path: texturePath }).add().load();
            if (content.textureSizes && content.textureSizes[name]) {
                texture.uv_width = content.textureSizes[name][0];
                texture.uv_height = content.textureSizes[name][1];
            }
            texture.textureLocation = content.textures[name];
        }
    }

    // Import only the model elements (not as backdrop)
    // Pass filePath for clothing slot inference
    import_model(content, false, filePath);
}

/**
 * Removes trailing commas from JSON strings to fix common syntax errors
 * This handles cases like: },] or },} which are invalid in strict JSON
 * @param jsonString The JSON string to clean
 * @returns Cleaned JSON string
 */
function cleanJSONString(jsonString: string): string {
    // Remove trailing commas before closing brackets/braces
    // Matches: comma followed by optional whitespace and then ] or }
    return jsonString.replace(/,(\s*[\]}])/g, '$1');
}

/**
 * Recursively finds a group by name within a given array of elements.
 * Case-insensitive comparison.
 * @param {string} name The name of the group to find.
 * @param {Array<object>} elements The array/tree to search through (e.g., Outliner.root).
 * @returns {Group|null} The found group or null if not found.
 */
function findGroupByName(name: string, elements: any[]): Group | null {
    const target = (name || '').toLowerCase();
    if (!target) return null;
    for (const element of elements) {
        if (element instanceof Group) {
            if ((element.name || '').toLowerCase() === target) {
                return element;
            }
            const foundInChildren = findGroupByName(name, element.children || []);
            if (foundInChildren) return foundInChildren;
        }
    }
    return null;
}

/**
 * Strips numeric suffixes (like "2", "3") that BlockBench adds to duplicate group names.
 * @param {string} name The group name, e.g., "body2" or "head3"
 * @returns {string} The base name without numeric suffix, e.g., "body" or "head"
 */
function stripNumericSuffix(name: string): string {
    if (!name) return '';
    return name.replace(/\d+$/, '');
}

/**
 * Recursively collects all groups in depth-first order (top of hierarchy first).
 * @param {Array<object>} elements The array/tree to traverse.
 * @param {Array<Group>} result The accumulator for groups.
 * @returns {Array<Group>}
 */
function collectGroupsDepthFirst(elements: any[], result: Group[] = []): Group[] {
    for (const element of elements) {
        if (element instanceof Group) {
            result.push(element);
            if (element.children && element.children.length) {
                collectGroupsDepthFirst(element.children, result);
            }
        }
    }
    return result;
}


export function createActions() {
    // Use your export codec for the import dialog (extension/name)
    const codec = createExportCodec();

    const importBBAction = new Action('import_bb_attachment', {
        name: 'Import BB Attachment',
        icon: 'fa-file-import',
        category: 'file',
        description: 'Import and automatically parent a .bbmodel attachment file',
        click: () => {
            Blockbench.import({
                resource_id: 'model',
                extensions: [codec.extension],
                type: codec.name,
                multiple: true,
            }, function(files) {
                if (!files || !files.length) return;

                Undo.initEdit({ outliner: true });

                // Merge each imported file into the current project
                files.forEach(file => {
                    try {
                        // Clean the JSON to remove trailing commas before parsing
                        const cleanedContent = cleanJSONString(file.content as string);
                        const model = autoParseJSON(cleanedContent);

                        // Validate that we got a valid model object
                        if (!model || typeof model !== 'object') {
                            console.error('[Import BB Attachment] Invalid model data in file:', file.path);
                            Blockbench.showQuickMessage(`Failed to import ${file.name}: Invalid JSON structure`, 3000);
                            return;
                        }

                        // Remove animations from the model before merging
                        // We don't want attachment animations mixed with the main model
                        // Note: Animations may be missing or empty for clothing attachments - this is normal
                        if (model.animations && Array.isArray(model.animations) && model.animations.length > 0) {
                            console.log('[Import BB Attachment] Skipping', model.animations.length, 'animations from attachment file');
                            delete model.animations;
                        }

                        Codecs.project.merge(model, file.path);
                    } catch (err) {
                        console.error('[Import BB Attachment] Error importing file:', file.path, err);
                        Blockbench.showQuickMessage(`Failed to import ${file.name}: ${err.message || err}`, 3000);
                    }
                });

                                // Give Blockbench a tick to settle the outliner
                                setTimeout(() => {
                                    const groupsToDelete: Group[] = [];
                
                                    // Step 1: Reparent elements based on stepParentName
                                    const allElements = [...Group.all, ...Cube.all];
                                    allElements.forEach(element => {
                                        const stepParentName = element.stepParentName?.trim();
                                        if (stepParentName) {
                                            let parentGroup = findGroupByName(stepParentName, Outliner.root);
                
                                            // If the target parent group doesn't exist, create it
                                            if (!parentGroup) {
                                                parentGroup = new Group({ name: stepParentName }).addTo().init();
                                                console.log(`[Import BB] Created missing stepParent group: "${stepParentName}"`);
                                            }
                
                                            // Reparent the element, avoiding circular dependencies
                                            if (parentGroup && parentGroup !== element && !(element instanceof Group && isDescendantOf(parentGroup, element))) {
                                                try {
                                                    element.addTo(parentGroup);
                                                    console.log(`[Import BB] Reparented "${element.name}" under stepParent "${stepParentName}"`);
                                                } catch (err) {
                                                    console.error('[Import BB] Error reparenting', element.name, 'to', stepParentName, err);
                                                }
                                            }
                                        }
                                    });
                
                                    // Step 2: Handle renamed duplicates from top of hierarchy down
                                    const updatedGroups = collectGroupsDepthFirst(Outliner.root);
                                    updatedGroups.forEach(group => {
                                        const gname = group.name || '';
                                        const baseName = stripNumericSuffix(gname);
                
                                        // Check if this is a renamed duplicate (has numeric suffix and differs from base)
                                        if (baseName !== gname && baseName) {
                                            // Try to find the original group with the base name
                                            const originalGroup = findGroupByName(baseName, Outliner.root);
                
                                            if (originalGroup && originalGroup !== group) {
                                                // Found the original! Move children from duplicate to original
                                                const childrenToMove = (group.children || []).slice();
                                                childrenToMove.forEach(child => {
                                                    try {
                                                        child.addTo(originalGroup);
                                                    } catch (err) {
                                                        console.error('[Import] Error moving child from', gname, 'to', baseName, err);
                                                    }
                                                });
                
                                                // Mark this duplicate group for deletion
                                                groupsToDelete.push(group);
                                            }
                                        }
                                    });
                
                                    // Step 3: Delete all duplicate groups (now that their children have been moved)
                                    groupsToDelete.forEach(group => {
                                        try {
                                            group.remove();
                                        } catch (err) {
                                            console.error('[Import] Error removing duplicate group', group.name, err);
                                        }
                                    });
                
                                    Undo.finishEdit('Import and parent attachment');
                                    Canvas.updateAll();
                                    updateSelection?.();
                                }, 100);            });
        }
    });

    const importVSAction = new Action('import_vs_attachment', {
        name: 'Import VS Attachment',
        icon: 'fa-file-import',
        category: 'file',
        description: 'Import and automatically parent a .json attachment file',
        click: () => {
            Blockbench.import({
                extensions: ['json'],
                type: 'Vintage Story Shape',
                multiple: true,
            }, function(files) {
                if (!files || !files.length) return;

                Undo.initEdit({ outliner: true });

                // Merge each imported file into the current project
                files.forEach(file => {
                    try {
                        // Clean the JSON to remove trailing commas before parsing
                        const cleanedContent = cleanJSONString(file.content as string);
                        const model = autoParseJSON(cleanedContent);

                        // Validate that we got a valid model object
                        if (!model || typeof model !== 'object') {
                            console.error('[Import VS Attachment] Invalid model data in file:', file.path);
                            Blockbench.showQuickMessage(`Failed to import ${file.name}: Invalid JSON structure`, 3000);
                            return;
                        }

                        // Remove animations from the model before merging
                        // We don't want attachment animations mixed with the main model
                        // Note: Animations may be missing or empty for clothing attachments - this is normal
                        if (model.animations && Array.isArray(model.animations) && model.animations.length > 0) {
                            console.log('[Import VS Attachment] Skipping', model.animations.length, 'animations from attachment file');
                            delete model.animations;
                        }

                        // Use our custom VS merge function instead of the generic codec merge
                        // Pass the file path for clothing slot inference
                        mergeVSAttachment(model as VS_Shape, file.path);
                    } catch (err) {
                        console.error('[Import VS Attachment] Error importing file:', file.path, err);
                        Blockbench.showQuickMessage(`Failed to import ${file.name}: ${err.message || err}`, 3000);
                    }
                });

                // Give Blockbench a tick to settle the outliner
                setTimeout(() => {
                    const groupsToDelete: Group[] = [];

                    // Step 1: Reparent elements based on stepParentName
                    const allElements = [...Group.all, ...Cube.all];
                    allElements.forEach(element => {
                        const stepParentName = element.stepParentName?.trim();
                        if (stepParentName) {
                            let parentGroup = findGroupByName(stepParentName, Outliner.root);

                            // If the target parent group doesn't exist, create it
                            if (!parentGroup) {
                                parentGroup = new Group({ name: stepParentName }).addTo().init();
                                console.log(`[Import VS] Created missing stepParent group: "${stepParentName}"`);
                            }

                            // Reparent the element, avoiding circular dependencies
                            if (parentGroup && parentGroup !== element && !(element instanceof Group && isDescendantOf(parentGroup, element))) {
                                try {
                                    element.addTo(parentGroup);
                                    console.log(`[Import VS] Reparented "${element.name}" under stepParent "${stepParentName}"`);
                                } catch (err) {
                                    console.error('[Import VS] Error reparenting', element.name, 'to', stepParentName, err);
                                }
                            }
                        }
                    });

                    // Step 2: Handle renamed duplicates from top of hierarchy down
                    const updatedGroups = collectGroupsDepthFirst(Outliner.root);

                    updatedGroups.forEach(group => {
                        const gname = group.name || '';
                        const baseName = stripNumericSuffix(gname);

                        // Check if this is a renamed duplicate (has numeric suffix and differs from base)
                        if (baseName !== gname && baseName) {
                            // Try to find the original group with the base name
                            const originalGroup = findGroupByName(baseName, Outliner.root);

                            if (originalGroup && originalGroup !== group) {
                                // Found the original! Move children from duplicate to original
                                const childrenToMove = (group.children || []).slice();
                                childrenToMove.forEach(child => {
                                    try {
                                        child.addTo(originalGroup);
                                    } catch (err) {
                                        console.error('[Import] Error moving child from', gname, 'to', baseName, err);
                                    }
                                });

                                // Mark this duplicate group for deletion
                                groupsToDelete.push(group);
                            }
                        }
                    });

                    // Step 3: Delete all duplicate groups (now that their children have been moved)
                    groupsToDelete.forEach(group => {
                        try {
                            group.remove();
                        } catch (err) {
                            console.error('[Import] Error removing duplicate group', group.name, err);
                        }
                    });

                    Undo.finishEdit('Import and parent attachment');
                    Canvas.updateAll();
                    updateSelection?.();
                }, 100);
            });
        }
    });

    return {
        importBB: importBBAction,
        importVS: importVSAction
    };
}

/**
 * Checks if 'possibleAncestor' is an ancestor of 'node'
 * Used to prevent circular reparenting
 */
function isDescendantOf(node: any, possibleAncestor: any): boolean {
    let current = node.parent;
    while (current) {
        if (current === possibleAncestor) return true;
        current = current.parent;
    }
    return false;
}

