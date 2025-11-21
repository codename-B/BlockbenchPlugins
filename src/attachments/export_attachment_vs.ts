import { getActiveSlotNames } from './presets';
import { traverse } from '../export_model/traverse';
import * as props from "../property";
import * as util from '../util';
declare var Group: any;
declare var Texture: any;
declare var Project: any;
declare var OutlinerNode: any;
declare var Settings: any;
declare var Blockbench: any;
import { VS_Element } from '../vs_shape_def';

declare function requireNativeModule(module: string): any;
const fs = requireNativeModule('fs');

declare function autoStringify(data: any): string;

/**
 * Populates textureSizes and textures from the current project.
 * @param {Object} data - The export data object to populate.
 */
function populateTexturesFromProject(data: any) {
    // Populate Texture Sizes from the current project
    for (const texture of Texture.all) {
        if (texture.getUVWidth() && texture.getUVHeight()) {
            data.textureSizes[texture.name] = [texture.uv_width, texture.uv_height];
        }
    }

    // Populate Textures from the current project
    for (const texture of Texture.all) {
        let tmp: any = {};
        props.VS_TEXTURE_PROPS.find(p => p.name === 'textureLocation')?.copy(texture, tmp);
        data.textures[texture.name] = tmp.textureLocation;
    }
}

/**
 * Determines the correct step-parent bone name for a given attachment group.
 * First checks if the group has an explicit stepParentName property set,
 * then falls back to using the configurable attachment stepParent mappings from settings.
 * @param {Group} group - The attachment group from Blockbench.
 * @returns {string|null} The name of the parent bone, or null if no match is found.
 */
function getStepParentName(group: Group): string | null {
    // First, check if the group has an explicit stepParentName property set
    if (group.stepParentName && group.stepParentName.trim() !== '') {
        console.log(`[getStepParentName] Using explicit stepParentName property: "${group.stepParentName}"`);
        return group.stepParentName;
    }

    const { name } = group;
    const lowerName = name.toLowerCase();

    console.log(`[getStepParentName] Checking group: "${name}"`);

    // Get the mappings from settings
    const mappings = Settings.get("attachment_stepparent_mappings") || {
        exactMatches: {},
        patternMatches: []
    };

    // Check for exact matches first
    if (mappings.exactMatches && mappings.exactMatches[name]) {
        const stepParent = mappings.exactMatches[name];
        console.log(`[getStepParentName] Exact match found: "${name}" → "${stepParent}"`);
        return stepParent;
    }

    // Check pattern matches
    if (mappings.patternMatches && Array.isArray(mappings.patternMatches)) {
        for (const pattern of mappings.patternMatches) {
            // Check if the pattern's "contains" condition is met
            if (pattern.contains && lowerName.includes(pattern.contains.toLowerCase())) {
                // Check if there's an "endsWith" condition
                if (pattern.endsWith) {
                    if (lowerName.endsWith(pattern.endsWith.toLowerCase())) {
                        console.log(`[getStepParentName] Pattern match (contains="${pattern.contains}", endsWith="${pattern.endsWith}"): "${name}" → "${pattern.stepParent}"`);
                        return pattern.stepParent;
                    }
                } else if (pattern.default) {
                    // This is a fallback pattern - continue checking other patterns first
                    continue;
                } else if (pattern.stepParent) {
                    // Simple contains match without endsWith or default
                    console.log(`[getStepParentName] Pattern match (contains="${pattern.contains}"): "${name}" → "${pattern.stepParent}"`);
                    return pattern.stepParent;
                }
            }
        }

        // Second pass: check for default fallbacks
        for (const pattern of mappings.patternMatches) {
            if (pattern.contains && lowerName.includes(pattern.contains.toLowerCase()) && pattern.default) {
                console.log(`[getStepParentName] Pattern default match (contains="${pattern.contains}"): "${name}" → "${pattern.default}"`);
                return pattern.default;
            }
        }
    }

    // Fallback: Try to match against active slot names
    const activeSlotNames = getActiveSlotNames();
    const matches = activeSlotNames.filter(slotName =>
        lowerName.endsWith(slotName.toLowerCase())
    );

    if (matches.length === 0) {
        console.warn(`[getStepParentName] No slot match found for "${name}"`);
        return null;
    }

    if (matches.length > 1) {
        console.warn(`[getStepParentName] Multiple slot matches found for "${name}": ${matches.join(', ')}`);
    }

    // Pick the longest match to avoid shorter overlaps (e.g. "Top" vs "Face")
    const slot = matches.reduce((a, b) => (a.length >= b.length ? a : b));

    console.log(`[getStepParentName] Using slot: "${slot}"`);

    // Remove the slot suffix but keep the original casing of the prefix
    const stepParentName = name.slice(0, -slot.length);

    console.log(`[getStepParentName] Derived stepParentName: "${stepParentName}"`);

    return stepParentName || null;
}

/**
 * Exports the selected attachments to the Vintage Story format.
 * @param {Array<Group>} selection - An array of selected attachment groups.
 */
export function exportAttachmentsVS(selection: Group[]) {
    if (!selection || selection.length === 0) {
        alert("Please select one or more attachments to export.");
        return;
    }

    // Create a temporary data structure for the export
    const data: any = {
        textureWidth: Project.texture_width,
        textureHeight: Project.texture_height,
        textureSizes: {},
        textures: {},
        elements: [],
        animations: []
    };

    // Process each attachment group with its own relative offset
    selection.forEach(group => {
        const stepParentName = getStepParentName(group);
        if (stepParentName) {
            // This property will be picked up by the processGroup function
            (group as any).stepParentName = stepParentName;
        } else {
            console.warn(`Could not determine a step-parent for attachment: ${group.name}`);
        }

        // Find the parent group to make the attachment's position relative
        const parentGroup = stepParentName ? Group.all.find(g => g.name === stepParentName) : null;

        // Default offset, same as in the main model exporter
        let offset: [number, number, number] = [0, 0, 0];

        if (parentGroup) {
            // Adjust the offset by subtracting the parent's absolute position.
            // This makes the attachment's root position relative to its parent.
            offset = util.vector_sub(offset, parentGroup.origin);
        }

        // Use the main model traversal logic to process the attachment
        // We create a temporary array to hold the elements for this single attachment
        const attachmentElements: VS_Element[] = [];
        traverse(null, [group], attachmentElements, offset);

        // Add the processed elements to the main elements array
        data.elements.push(...attachmentElements);
    });


    // Clean up the temporarily added property to avoid side effects
    selection.forEach(group => {
        delete (group as any).stepParentName;
    });

    // Prompt for save location first to check if file exists
    Blockbench.export({
        type: 'Vintage Story Attachment',
        extensions: ['json'],
        name: `${selection[0].name}_attachment.json`,
        startpath: Project.save_path,
        custom_writer: (content: any, path: string) => {
            // Check if the file already exists
            if (fs.existsSync(path)) {
                try {
                    // Read the existing file
                    const existingContent = fs.readFileSync(path, 'utf8');
                    const existingData = JSON.parse(existingContent);

                    // Use textureSizes and textures from the existing file
                    if (existingData.textureSizes) {
                        data.textureSizes = existingData.textureSizes;
                    }
                    if (existingData.textures) {
                        data.textures = existingData.textures;
                    }

                    console.log('[VS Attachment Export] Preserved textureSizes and textures from existing file');
                } catch (e) {
                    console.error('[VS Attachment Export] Error reading existing file:', e);
                    // Fall back to current project textures
                    populateTexturesFromProject(data);
                }
            } else {
                // File doesn't exist, use textures from current project
                populateTexturesFromProject(data);
            }

            // Write the final content
            const finalContent = autoStringify(data);
            fs.writeFileSync(path, finalContent);
        }
    });
}
