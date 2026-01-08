import { QUICK_MESSAGE_DURATION } from './constants';

/**
 * Deletes all attachments within a given section.
 * @param {Array<Group|Cube>} elements - An array of attachment groups/elements in the section to be deleted.
 */
export function deleteSection(elements: any[]) {
    if (!elements || elements.length === 0) {
        Blockbench.showQuickMessage("There are no attachments in this section to delete.", QUICK_MESSAGE_DURATION);
        return;
    }

    // Confirmation is handled in panel.ts confirmDelete method
    Undo.initEdit({ outliner: true }, `Delete ${elements.length} attachment(s)`);

    // The 'elements' array from the panel is the definitive list of top-level attachments for this section.
    // Blockbench's .remove() method handles removing children automatically, regardless of their properties.
    elements.forEach(element => element.remove());

    Undo.finishEdit(`Delete ${elements.length} attachment(s)`);
    
    Blockbench.dispatchEvent('attachments_changed', {});
    Blockbench.showQuickMessage(`Deleted ${elements.length} attachment(s)`, QUICK_MESSAGE_DURATION);
}