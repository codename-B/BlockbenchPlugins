declare var Group: any;
declare var Undo: any;

declare function alert(message: string): void;
declare function confirm(message: string): boolean;

/**
 * Deletes all attachments within a given section.
 * @param {Array<Group>} groups - An array of attachment groups in the section to be deleted.
 */
export function deleteSection(groups: Group[]) {
    if (!groups || groups.length === 0) {
        alert("There are no attachments in this section to delete.");
        return;
    }

    const confirmed = confirm(`Are you sure you want to delete all ${groups.length} attachments in this section? This cannot be undone.`);
    
    if (confirmed) {
        // Create undo point before making changes
        Undo.initEdit({aspects: {outliner: true}});
        
        groups.forEach(group => {
            group.remove();
        });
        
        // Finish the undo operation
        Undo.finishEdit('delete attachment section');
        console.log(`Deleted ${groups.length} attachments.`);
    }
}
