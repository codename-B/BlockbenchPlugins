declare var Outliner: any;
declare var Group: any;
declare var Cube: any;

import { getActiveSlotNames } from './presets';

export interface IAttachmentSection {
    slot: string;
    elements: (Group | Cube)[];
}

/**
 * Walks the Outliner tree and groups matching elements based on their clothingSlot property.
 * Only elements with an explicit clothingSlot property set will be included.
 */
export function findAttachments(): IAttachmentSection[] {
  // console.log('🔍 Starting attachment discovery (native nodes)...');

  // Get the active slot names based on current preset
  const activeSlotNames = getActiveSlotNames();

  // Prepare result buckets
  const results: IAttachmentSection[] = activeSlotNames.map(slot => ({ slot, elements: [] }));

  // Simple helper to get bucket by slot
  const bucketFor = (slot: string) => results.find(r => r.slot === slot);

  function walk(node: any) {
    // Check if this element has an explicit clothingSlot property
    if ((node instanceof Group || node instanceof Cube) && node.clothingSlot && node.clothingSlot.trim() !== '') {
      const bucket = bucketFor(node.clothingSlot);
      if (bucket) {
        bucket.elements.push(node);
      }
    }

    // Always descend to find nested clothing items
    if (Array.isArray(node.children)) {
      node.children.forEach(walk);
    }
  }

  (Outliner.root || []).forEach(walk);

  return results;
}

export function getAttachments(): (Group | Cube)[] {
  const allAttachments: (Group | Cube)[] = [];
  findAttachments().forEach(section => {
    allAttachments.push(...section.elements);
  });
  return allAttachments;
}

export function isAttachment(node: any): boolean {
    if (!node) return false;
    // Check if it has an explicit clothingSlot property
    return (node instanceof Group || node instanceof Cube) && node.clothingSlot && node.clothingSlot.trim() !== '';
}