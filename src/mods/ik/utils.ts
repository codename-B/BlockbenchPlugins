
import { vec3Length, vec3Sub } from "./math";
import { findAllIKControllers } from "./chain_utils";

// Blockbench global types
declare var Group: any;

/**
 * Gets the world position of a bone (accounting for parent transforms)
 */
export function getBoneWorldPosition(bone: any): [number, number, number] {
    let pos: [number, number, number] = [bone.origin[0], bone.origin[1], bone.origin[2]];
    let current: any = bone.parent;

    while (current && current instanceof Group) {
        pos[0] += current.origin[0];
        pos[1] += current.origin[1];
        pos[2] += current.origin[2];
        current = current.parent;
    }

    return pos;
}

/**
 * Gets the world position of a bone's end (considering bone length/direction)
 * In Blockbench, bones are points, so we calculate the "end" based on children
 */
export function getBoneEndWorldPosition(bone: any): [number, number, number] {
    const start = getBoneWorldPosition(bone);
    
    if (bone.children && bone.children.length > 0) {
        const firstChild = bone.children[0];
        if (firstChild instanceof Group) {
            return getBoneWorldPosition(firstChild);
        }
    }
    
    const ikControllers = findAllIKControllers();
    for (const { chain } of ikControllers) {
        const boneIndex = chain.indexOf(bone);
        if (boneIndex >= 0 && boneIndex < chain.length - 1) {
            const nextBone = chain[boneIndex + 1];
            return getBoneWorldPosition(nextBone);
        }
    }
    
    return [start[0], start[1] + 1, start[2]];
}

/**
 * Gets the length of a bone (distance to its end)
 */
export function getBoneLength(bone: any): number {
    const start = getBoneWorldPosition(bone);
    const end = getBoneEndWorldPosition(bone);
    return vec3Length(vec3Sub(end, start));
}