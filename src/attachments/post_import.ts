import { inferClothingSlotFromPath } from './presets';
import { showClothingSlotDialog } from './dialogs';
import { findAllGroupsByName, findGroupByName, stripNumericSuffix, collectGroupsDepthFirst, isDescendantOf } from '../util/outliner';
import { QUICK_MESSAGE_DURATION } from './constants';
import { markAsRecentlyImported } from './panel';

const DEBUG = false;

function logDebug(message: string, ...args: any[]) {
    if (DEBUG) console.log(message, ...args);
}

function getGroupPath(group: Group): string {
    const parts: string[] = [];
    let current: any = group;
    while (current && current instanceof Group) {
        parts.unshift(current.name || 'Unnamed');
        current = current.parent;
    }
    return parts.join(' > ') || group.name || 'Unknown';
}

/**
 * Finds a matching group in the existing model based on clothing slot and optional name.
 */
function findBestMatchingGroupBySlot(clothingSlot: string, groupName: string | null, existingElements: Set<any>): Group | null {
    if (!clothingSlot || !clothingSlot.trim()) return null;

    const normalizedSlot = clothingSlot.trim().toLowerCase();
    const normalizedName = groupName ? groupName.trim().toLowerCase() : '';

    let bestMatch: Group | null = null;
    let exactNameMatch: Group | null = null;

    function search(elements: any[]) {
        for (const element of elements) {
            if (element instanceof Group && existingElements.has(element)) {
                const elemSlot = (element.clothingSlot || '').trim().toLowerCase();

                if (elemSlot === normalizedSlot) {
                    if (normalizedName && (element.name || '').trim().toLowerCase() === normalizedName) {
                        exactNameMatch = element;
                        return;
                    }
                    if (!bestMatch) bestMatch = element;
                }
            }
            if (element.children && element.children.length > 0) {
                search(element.children);
                if (exactNameMatch) return;
            }
        }
    }

    search(Outliner.root);
    return exactNameMatch || bestMatch;
}

/**
 * Applies the selected clothing slot to all new elements.
 */
function applyClothingSlot(newElements: any[], slot: string, logPrefix: string) {
    if (DEBUG) console.log(`[${logPrefix}] Applying slot "${slot}" to ${newElements.length} elements.`);

    const apply = (element: any) => {
        if (element instanceof Group || element instanceof Cube) {
            element.clothingSlot = slot;
        }
        if (element.children) {
            element.children.forEach(apply);
        }
    };

    // Filter for top-level new elements to avoid double processing
    const newElementsSet = new Set(newElements);
    const topLevel = newElements.filter(e => !e.parent || !newElementsSet.has(e.parent));

    topLevel.forEach(element => {
        apply(element);
        markAsRecentlyImported(element);
        element.children?.forEach((child: any) => markAsRecentlyImported(child));
    });
}

/**
 * Matches new groups to existing ones based on clothing slot.
 */
function smartMatchGroups(newElements: any[], newElementsSet: Set<any>, existingElements: Set<any>, logPrefix: string): number {
    const topLevelGroups = newElements.filter(e => e instanceof Group && (!e.parent || !newElementsSet.has(e.parent))) as Group[];
    let matchCount = 0;

    if (DEBUG) console.log(`[${logPrefix}] Smart match: checking ${topLevelGroups.length} groups.`);

    for (const newGroup of topLevelGroups) {
        const slot = newGroup.clothingSlot?.trim();
        if (!slot) continue;

        const match = findBestMatchingGroupBySlot(slot, newGroup.name, existingElements);
        if (match) {
            if (DEBUG) console.log(`[${logPrefix}] Matched "${newGroup.name}" -> "${match.name}" (slot: ${slot})`);

            [...newGroup.children].forEach(child => child.addTo(match));
            matchCount++;

            if (newGroup.children.length === 0) newGroup.remove();
        }
    }
    return matchCount;
}

/**
 * Merges new groups into existing groups with the same name (hierarchical merge).
 */
function mergeHierarchicalGroups(newElements: any[], newElementsSet: Set<any>, logPrefix: string) {
    if (DEBUG) console.log(`[${logPrefix}] merging hierarchies.`);

    const allNewGroups = collectGroupsDepthFirst(newElements.filter(e => e instanceof Group && newElementsSet.has(e)));

    // Process deepest first
    for (let i = allNewGroups.length - 1; i >= 0; i--) {
        const newGroup = allNewGroups[i];
        if (!newElementsSet.has(newGroup)) continue;

        const matches = findAllGroupsByName(newGroup.name, Outliner.root).filter(g => !newElementsSet.has(g));

        if (matches.length > 0) {
            const target = matches[0]; // Take first match
            if (DEBUG) console.log(`[${logPrefix}] Merging "${newGroup.name}" into "${target.name}"`);

            [...newGroup.children].forEach(child => child.addTo(target));

            if (newGroup.clothingSlot && !target.clothingSlot) {
                target.clothingSlot = newGroup.clothingSlot;
            }

            if (newGroup.children.length === 0) {
                newGroup.remove();
                newElementsSet.delete(newGroup);
            }
        }
    }
}

/**
 * Merges groups that share the same clothing slot and have similar names.
 */
function mergeGroupsByCommonSlot(newElements: any[], newElementsSet: Set<any>, logPrefix: string) {
    if (DEBUG) console.log(`[${logPrefix}] merging by common slot.`);

    const bySlot = new Map<string, Group[]>();
    newElements.forEach(e => {
        if (e instanceof Group && newElementsSet.has(e) && e.clothingSlot) {
            const slot = e.clothingSlot.trim();
            if (!bySlot.has(slot)) bySlot.set(slot, []);
            bySlot.get(slot)!.push(e);
        }
    });

    bySlot.forEach((groups, slot) => {
        if (groups.length < 2) return;

        // Sort by name length to find the "base" group (shortest name)
        groups.sort((a, b) => (a.name || '').length - (b.name || '').length);
        const base = groups[0];
        const baseName = (base.name || '').toLowerCase();

        if (!baseName) return;

        // Find groups extending the base name (e.g. "Hair" vs "HairOuter")
        const targets = groups.slice(1).filter(g => (g.name || '').toLowerCase().startsWith(baseName));
        if (targets.length === 0) return;

        // Check if base exists in old model, otherwise use the new one as base
        const existMatches = findAllGroupsByName(base.name, Outliner.root).filter(g => !newElementsSet.has(g));
        const finalTarget = existMatches[0] || base;

        if (finalTarget === base || !newElementsSet.has(finalTarget)) {
            targets.forEach(g => {
                if (!newElementsSet.has(g)) return;

                if (DEBUG) console.log(`[${logPrefix}] Merging "${g.name}" into "${finalTarget.name}" (slot: ${slot})`);
                [...g.children].forEach(c => c.addTo(finalTarget));

                if (g.children.length === 0) {
                    g.remove();
                    newElementsSet.delete(g);
                }
            });
        }
    });
}

/**
 * Reparents elements based on their `stepParentName` property.
 */
function reparentByStepParent(newElements: any[], newElementsSet: Set<any>, logPrefix: string) {
    if (DEBUG) console.log(`[${logPrefix}] reparenting by stepParent.`);

    newElements.forEach(element => {
        const stepParent = element.stepParentName?.trim();
        if (!stepParent) return;

        const matches = findAllGroupsByName(stepParent, Outliner.root);
        let parent = matches.find(g => !newElementsSet.has(g));

        if (!parent && matches.length === 0) {
            parent = new Group({ name: stepParent }).addTo().init();
            if (DEBUG) console.log(`[${logPrefix}] Created stepParent group: "${stepParent}"`);
        }

        if (parent && parent !== element && !isDescendantOf(parent, element)) {
            element.addTo(parent);
        }
    });
}

/**
 * Merges any duplicate groups in the model.
 */
function mergeDuplicateGroups(logPrefix: string) {
    const toDelete: Group[] = [];
    collectGroupsDepthFirst(Outliner.root).forEach(group => {
        const name = group.name || '';
        const base = stripNumericSuffix(name);

        if (base !== name && base) {
            const original = findGroupByName(base, Outliner.root);
            if (original && original !== group) {
                // Move children if safe
                [...group.children].forEach(child => {
                    if (child !== original && child.parent !== original && !isDescendantOf(original, child)) {
                        child.addTo(original);
                    }
                });
                toDelete.push(group);
            }
        }
    });
    toDelete.forEach(g => g.remove());
}

/**
 * Main entry point: Organizes imported attachments.
 */
export async function processImportedAttachments(elementsBefore: Set<any>, filePath: string, logPrefix: string, model?: any) {
    const elementsAfter = new Set([...Group.all, ...Cube.all]);
    const newElements = [...elementsAfter].filter(e => !elementsBefore.has(e));
    const newElementsSet = new Set(newElements);

    // 1. User selects clothing slot
    const inferred = inferClothingSlotFromPath(filePath);
    const result = await showClothingSlotDialog(inferred, filePath, model);
    const masterSlot = result.slot;

    if (!masterSlot) {
        if (DEBUG) console.log(`[${logPrefix}] Import cancelled.`);
        newElements.forEach(e => e.remove());
        Blockbench.showQuickMessage('Import cancelled', QUICK_MESSAGE_DURATION);
        return;
    }

    // 2. Apply slot to new elements
    applyClothingSlot(newElements, masterSlot, logPrefix);

    // 3. Smart Match: New groups -> Old groups with same slot
    const matchCount = smartMatchGroups(newElements, newElementsSet, elementsBefore, logPrefix);
    if (matchCount > 0) {
        Blockbench.showQuickMessage(`Matched ${matchCount} groups`, QUICK_MESSAGE_DURATION);
    }

    // 4. Hierarchical Match: New groups -> Old groups with same name/path
    mergeHierarchicalGroups(newElements, newElementsSet, logPrefix);

    // 5. Common Slot Match: "HairOuter" -> "Hair" if same slot
    mergeGroupsByCommonSlot(newElements, newElementsSet, logPrefix);

    // 6. Step Parent Reparenting
    reparentByStepParent(newElements, newElementsSet, logPrefix);

    // 7. Cleanup Duplicates
    mergeDuplicateGroups(logPrefix);

    Undo.finishEdit(`Import attachment: ${filePath.split(/[/\\]/).pop()}`);
    Canvas.updateAll();
    if (typeof updateSelection === 'function') updateSelection();
}
