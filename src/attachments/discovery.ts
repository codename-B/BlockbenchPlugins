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

  const results: IAttachmentSection[] = [];
  const slotMap: { [key: string]: IAttachmentSection } = {};

  function getOrCreateBucket(slot: string): IAttachmentSection {
    if (!slotMap[slot]) {
      const newSection: IAttachmentSection = { slot, elements: [] };
      slotMap[slot] = newSection;
      results.push(newSection);
    }
    return slotMap[slot];
  }

  function walk(node: any) {
    // Check if this element has an explicit clothingSlot property
    if ((node instanceof Group || node instanceof Cube) && node.clothingSlot && node.clothingSlot.trim() !== '') {
      const bucket = getOrCreateBucket(node.clothingSlot);
      bucket.elements.push(node);
    }

    // Always descend to find nested clothing items
    if (Array.isArray(node.children)) {
      node.children.forEach(walk);
    }
  }

  (Outliner.root || []).forEach(walk);

  // Sort results to have a consistent order
  results.sort((a, b) => a.slot.localeCompare(b.slot));

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