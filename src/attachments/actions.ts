import { createExportCodec } from './codec';
import { import_model } from '../import_model';
import { VS_Shape } from '../vs_shape_def';
import { inferClothingSlotFromPath } from './presets';
import * as util from '../util';

declare var Action: any;
declare var Group: any;
declare var Cube: any;
declare var Outliner: any;
declare var Undo: any;
declare var Canvas: any;
declare var Codecs: any;
declare var Blockbench: any;
declare var Texture: any;
declare var Project: any;

declare function autoParseJSON(content: string): any;
declare function updateSelection(): void;

/** Debug flag - set to true to enable verbose logging */
const DEBUG = false;

/** Platform-aware path separator */
const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

/**
 * Normalizes path separators to the current platform's convention
 * @param filePath The path to normalize
 * @returns Path with platform-appropriate separators
 */
function normalizePath(filePath: string): string {
    if (!filePath) return filePath;
    return isWindows ? filePath.replace(/\//g, '\\') : filePath.replace(/\\/g, '/');
}

/**
 * Extracts just the filename (without extension) from a path or textureLocation
 * @param pathOrLocation A file path or textureLocation string
 * @returns The filename without extension, lowercase
 */
function extractFilename(pathOrLocation: string): string {
    if (!pathOrLocation) return '';
    // Normalize separators and get the last segment
    const normalized = pathOrLocation.replace(/\\/g, '/');
    const lastSegment = normalized.split('/').pop() || '';
    // Remove extension if present
    return lastSegment.replace(/\.[^.]+$/, '').toLowerCase();
}

/**
 * Merges a VS attachment into the current project without overwriting project settings
 * @param content The VS_Shape data to merge
 * @param filePath The path to the file being imported (for clothing slot inference)
 */
function mergeVSAttachment(content: VS_Shape, filePath?: string) {
    // Add textures if they don't already exist, or update existing ones
    for (const name in content.textures) {
        const textureLocation = content.textures[name];
        // Normalize textureLocation for comparison (handle path separators and casing)
        const normalizedLocation = textureLocation?.toLowerCase().replace(/\\/g, '/');
        // Extract filename from textureLocation for matching against existing textures
        const locationFilename = extractFilename(textureLocation);

        // Check if we already have a texture with this exact name
        const existingByName = Texture.all.find((t: any) => t.name === name);

        // Check if we have a texture with the same textureLocation (might have different name)
        const existingByLocation = Texture.all.find((t: any) => {
            const tLoc = t.textureLocation?.toLowerCase().replace(/\\/g, '/');
            return tLoc && tLoc === normalizedLocation;
        });

        // Check if we have a texture whose name or path filename matches the textureLocation filename
        // This handles the case where a texture was loaded from a local file and doesn't have textureLocation set
        const existingByFilename = locationFilename ? Texture.all.find((t: any) => {
            // Match by texture name (with or without extension)
            const tName = (t.name || '').toLowerCase().replace(/\.[^.]+$/, '');
            if (tName === locationFilename) return true;
            // Match by path filename
            const pathFilename = extractFilename(t.path);
            if (pathFilename === locationFilename) return true;
            return false;
        }) : null;

        if (DEBUG) {
            console.log(`[Import VS] Texture "${name}" -> location: "${textureLocation}" (filename: "${locationFilename}")`);
            console.log(`[Import VS]   existingByName: ${existingByName?.name || 'none'} (path: ${existingByName?.path || 'none'})`);
            console.log(`[Import VS]   existingByLocation: ${existingByLocation?.name || 'none'} (path: ${existingByLocation?.path || 'none'})`);
            console.log(`[Import VS]   existingByFilename: ${existingByFilename?.name || 'none'} (path: ${existingByFilename?.path || 'none'})`);
        }

        if (existingByName) {
            // Texture with this name exists - ensure it has correct textureLocation and is loaded
            if (!existingByName.textureLocation) {
                existingByName.textureLocation = textureLocation;
            }
            if (!existingByName.loaded && existingByLocation?.path) {
                // Use path from texture with matching location
                existingByName.path = existingByLocation.path;
                existingByName.load();
            } else if (!existingByName.loaded && existingByFilename?.path) {
                // Use path from texture with matching filename
                existingByName.path = existingByFilename.path;
                existingByName.load();
            } else if (!existingByName.loaded) {
                const texturePath = util.get_texture_location(null, textureLocation);
                if (texturePath) {
                    existingByName.path = texturePath;
                    existingByName.load();
                }
            }
        } else if (existingByLocation) {
            // No texture with this name, but we have one with matching textureLocation
            // Create a new texture entry with the imported name, using the existing texture's path
            const texPath = normalizePath(existingByLocation.path);
            const texture = new Texture({
                name,
                path: texPath
            }).add().load();
            texture.textureLocation = textureLocation;
            if (content.textureSizes && content.textureSizes[name]) {
                texture.uv_width = content.textureSizes[name][0];
                texture.uv_height = content.textureSizes[name][1];
            }
            if (DEBUG) console.log(`[Import VS] Created texture "${name}" using path from existing texture with same location (path: ${texPath})`);
        } else if (existingByFilename) {
            // No texture by name or location, but we have one with matching filename
            // Create a new texture entry with the imported name, using the existing texture's path
            const texPath = normalizePath(existingByFilename.path);
            const texture = new Texture({
                name,
                path: texPath
            }).add().load();
            texture.textureLocation = textureLocation;
            if (content.textureSizes && content.textureSizes[name]) {
                texture.uv_width = content.textureSizes[name][0];
                texture.uv_height = content.textureSizes[name][1];
            }
            if (DEBUG) console.log(`[Import VS] Created texture "${name}" using path from existing texture with matching filename "${locationFilename}" (path: ${texPath})`);
        } else {
            // No matching texture found - create new one
            const texturePath = util.get_texture_location(null, textureLocation);
            const texture = new Texture({ name, path: texturePath }).add().load();
            if (content.textureSizes && content.textureSizes[name]) {
                texture.uv_width = content.textureSizes[name][0];
                texture.uv_height = content.textureSizes[name][1];
            }
            texture.textureLocation = textureLocation;
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
 * Recursively finds ALL groups matching a name within a given array of elements.
 * Case-insensitive comparison.
 * @param {string} name The name of the groups to find.
 * @param {Array<object>} elements The array/tree to search through (e.g., Outliner.root).
 * @returns {Group[]} Array of all matching groups.
 */
function findAllGroupsByName(name: string, elements: any[]): Group[] {
    const target = (name || '').toLowerCase();
    if (!target) return [];
    const results: Group[] = [];

    function search(elems: any[]) {
        for (const element of elems) {
            if (element instanceof Group) {
                if ((element.name || '').toLowerCase() === target) {
                    results.push(element);
                }
                if (element.children && element.children.length) {
                    search(element.children);
                }
            }
        }
    }

    search(elements);
    return results;
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

                const elementsBefore = new Set([...Group.all, ...Cube.all]);

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
                // Capture project reference to check validity after timeout
                const currentProject = Project;
                setTimeout(() => {
                    // Ensure project is still valid before processing
                    if (!currentProject || Project !== currentProject) {
                        console.warn('[Import BB] Project changed or closed, skipping post-import processing');
                        return;
                    }
                    processImportedAttachments(elementsBefore, files[0].path, 'Import BB');
                }, 100);
            });
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

                const elementsBefore = new Set([...Group.all, ...Cube.all]);

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
                // Capture project reference to check validity after timeout
                const currentProject = Project;
                setTimeout(() => {
                    // Ensure project is still valid before processing
                    if (!currentProject || Project !== currentProject) {
                        console.warn('[Import VS] Project changed or closed, skipping post-import processing');
                        return;
                    }
                    processImportedAttachments(elementsBefore, files[0].path, 'Import VS');
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

/**
 * Shared post-import processing for both BB and VS attachment imports.
 * Handles reparenting, duplicate merging, clothing slot assignment, and stepParent inference.
 * @param elementsBefore Set of elements before import
 * @param filePath Path to the first imported file (for slot inference)
 * @param logPrefix Prefix for console log messages (e.g., "Import BB" or "Import VS")
 */
function processImportedAttachments(elementsBefore: Set<any>, filePath: string, logPrefix: string) {
    const elementsAfter = new Set([...Group.all, ...Cube.all]);
    const newElements = [...elementsAfter].filter(e => !elementsBefore.has(e));
    const newElementsSet = new Set(newElements);

    // Step 1: Reparent elements based on stepParentName, then CLEAR stepParentName
    // We clear it after reparenting so the mesh-level system in nodePreviewControllerMod.ts
    // doesn't also try to handle parenting (which would cause THREE.js conflicts)
    if (DEBUG) console.log(`[${logPrefix}] Processing ${newElements.length} new elements for reparenting`);
    newElements.forEach(element => {
        const stepParentName = element.stepParentName?.trim();
        if (stepParentName) {
            // Find all groups with this name
            const allMatches = findAllGroupsByName(stepParentName, Outliner.root);

            // Prefer pre-existing groups over newly imported ones
            let parentGroup = allMatches.find(g => !newElementsSet.has(g)) || null;

            if (!parentGroup && allMatches.length === 0) {
                // No group with this name exists at all - create one
                parentGroup = new Group({ name: stepParentName }).addTo().init();
                if (DEBUG) console.log(`[${logPrefix}] Created missing stepParent group: "${stepParentName}"`);
            }

            if (parentGroup && parentGroup !== element && !(element instanceof Group && isDescendantOf(parentGroup, element))) {
                try {
                    // Only do outliner reparenting - keep stepParentName intact for mesh positioning
                    // The nodePreviewControllerMod.ts handles mesh positioning based on stepParentName
                    element.addTo(parentGroup);
                    if (DEBUG) console.log(`[${logPrefix}] Reparented "${element.name}" under "${stepParentName}" in outliner (keeping stepParentName for mesh positioning)`);
                } catch (e) {
                    console.error(`[${logPrefix}] Failed to reparent "${element.name}" to "${stepParentName}":`, e);
                }
            }
        }
    });

    // Step 2: Handle renamed duplicates (e.g., "head2" -> merge into "head")
    const groupsToDelete: Group[] = [];
    const updatedGroups = collectGroupsDepthFirst(Outliner.root);
    updatedGroups.forEach(group => {
        const gname = group.name || '';
        const baseName = stripNumericSuffix(gname);
        if (baseName !== gname && baseName) {
            const originalGroup = findGroupByName(baseName, Outliner.root);
            if (originalGroup && originalGroup !== group) {
                [...group.children].forEach(child => {
                    // Safety checks to prevent circular references
                    if (child === originalGroup || child.uuid === originalGroup.uuid) {
                        if (DEBUG) console.warn(`[${logPrefix}] Skipping move - child "${child.name}" is the target group`);
                        return;
                    }
                    if (child.parent === originalGroup) {
                        if (DEBUG) console.warn(`[${logPrefix}] Skipping move - child "${child.name}" already under "${originalGroup.name}"`);
                        return;
                    }
                    if (isDescendantOf(originalGroup, child)) {
                        if (DEBUG) console.warn(`[${logPrefix}] Skipping move - "${originalGroup.name}" is descendant of "${child.name}"`);
                        return;
                    }
                    try {
                        child.addTo(originalGroup);
                    } catch (e) {
                        console.error(`[${logPrefix}] Failed to move "${child.name}" to "${originalGroup.name}":`, e);
                    }
                });
                groupsToDelete.push(group);
            }
        }
    });
    groupsToDelete.forEach(group => group.remove());

    // Step 3: Determine and apply a single master clothing slot
    // Only apply to elements that don't already have a clothing slot set
    const masterClothingSlot = inferClothingSlotFromPath(filePath) || 'Unknown';

    if (masterClothingSlot) {
        if (DEBUG) console.log(`[${logPrefix}] Applying master clothing slot "${masterClothingSlot}" to elements without a slot.`);
        function applySlotRecursive(element: any, slot: string) {
            if (element instanceof Group || element instanceof Cube) {
                // Only set if not already set
                if (!element.clothingSlot || element.clothingSlot.trim() === '') {
                    element.clothingSlot = slot;
                }
            }
            if (element.children) {
                element.children.forEach((child: any) => applySlotRecursive(child, slot));
            }
        }
        newElements.forEach(element => applySlotRecursive(element, masterClothingSlot));
    }

    // Step 4: Skip auto-setting stepParentName - we now use outliner hierarchy instead
    // Setting stepParentName would trigger the mesh-level parenting system which conflicts

    Undo.finishEdit('Import and parent attachment');
    Canvas.updateAll();
    updateSelection?.();
}

