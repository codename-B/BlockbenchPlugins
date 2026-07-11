/**
 * Helper functions for slot categorization and visual styling
 */

export type SlotCategory = 'clothing' | 'armor' | 'facial' | 'accessory' | 'other';

export interface SlotInfo {
    category: SlotCategory;
    icon: string;
    color: string;
}

/**
 * Categorizes a slot name into a category type
 */
export function getSlotCategory(slot: string): SlotCategory {
    const lowerSlot = slot.toLowerCase();
    
    // Armor slots
    if (lowerSlot.includes('armor')) {
        return 'armor';
    }
    
    // Facial features
    const facialSlots = ['face', 'eyes', 'eyebrows', 'nose', 'mouth', 'facialhair', 'ears', 'hair'];
    if (facialSlots.some(f => lowerSlot.includes(f))) {
        return 'facial';
    }
    
    // Accessories
    const accessorySlots = ['earrings', 'faceitem', 'emblem', 'neck'];
    if (accessorySlots.some(a => lowerSlot.includes(a))) {
        return 'accessory';
    }
    
    // Clothing (default for most body parts)
    const clothingSlots = ['upperbody', 'lowerbody', 'top', 'bottoms', 'outerwear', 'shoes', 'boots', 'gloves', 'hand', 'foot', 'arm', 'shoulder', 'waist', 'headwear'];
    if (clothingSlots.some(c => lowerSlot.includes(c))) {
        return 'clothing';
    }
    
    return 'other';
}

/**
 * Gets the icon for a slot category
 */
export function getSlotIcon(category: SlotCategory): string {
    switch (category) {
        case 'armor':
            return 'shield';
        case 'facial':
            return 'face';
        case 'accessory':
            return 'star';
        case 'clothing':
            return 'checkroom';
        default:
            return 'label';
    }
}

/**
 * Gets the color for a slot category (CSS color or hex)
 */
export function getSlotColor(category: SlotCategory): string {
    switch (category) {
        case 'armor':
            return '#9c27b0'; // Purple
        case 'facial':
            return '#ff9800'; // Orange
        case 'accessory':
            return '#2196f3'; // Blue
        case 'clothing':
            return '#4caf50'; // Green
        default:
            return '#757575'; // Grey
    }
}

/**
 * Gets complete slot information
 */
export function getSlotInfo(slot: string): SlotInfo {
    const category = getSlotCategory(slot);
    return {
        category,
        icon: getSlotIcon(category),
        color: getSlotColor(category)
    };
}

/**
 * Suggests a slot based on element names
 */
export function suggestSlotFromName(elementName: string, availableSlots: string[]): string | null {
    const lowerName = elementName.toLowerCase();
    
    // Common name-to-slot mappings
    const nameMappings: { [key: string]: string[] } = {
        'hat': ['Headwear', 'Head'],
        'cap': ['Headwear', 'Head'],
        'helmet': ['Armor Head', 'Headwear', 'Head'],
        'shirt': ['Top', 'UpperBody'],
        'top': ['Top', 'UpperBody'],
        'pants': ['Bottoms', 'LowerBody'],
        'trousers': ['Bottoms', 'LowerBody'],
        'shoes': ['Shoes', 'Foot'],
        'boots': ['Shoes', 'Foot'],
        'gloves': ['Gloves', 'Hand'],
        'eyes': ['Eyes', 'Face'],
        'nose': ['Nose', 'Face'],
        'mouth': ['Mouth', 'Face'],
        'hair': ['Hair'],
        'earrings': ['Earrings', 'Ears'],
        'jacket': ['Outerwear', 'UpperBodyOver'],
        'coat': ['Outerwear', 'UpperBodyOver']
    };
    
    // Check for exact matches first
    for (const [key, slots] of Object.entries(nameMappings)) {
        if (lowerName.includes(key)) {
            // Return first matching slot that's available
            for (const slot of slots) {
                if (availableSlots.includes(slot)) {
                    return slot;
                }
            }
        }
    }
    
    // Check if any slot name is contained in the element name
    for (const slot of availableSlots) {
        const lowerSlot = slot.toLowerCase();
        if (lowerName.includes(lowerSlot) || lowerSlot.includes(lowerName)) {
            return slot;
        }
    }
    
    return null;
}
