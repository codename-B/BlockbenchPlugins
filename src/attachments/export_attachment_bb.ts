declare var Group: any;
import { createExportCodec } from './codec';

declare function alert(message: string): void;

/**
 * Exports the selected attachments to the standard Blockbench (.bbmodel) format.
 * @param {Array<Group>} selection - An array of selected attachment groups.
 */
export function exportAttachmentsBB(selection: Group[]) {
    if (!selection || selection.length === 0) {
        alert("Please select one or more attachments to export.");
        return;
    }

    const bb_codec = createExportCodec();
    bb_codec.export(selection);
    
    console.log("Exporting selected attachments to .bbmodel format...");
}
