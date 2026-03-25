
import { vec3Length, vec3Sub, alignVectors, vec3Normalize, vec3Add } from "./math";
import { getBoneWorldPosition, getBoneEndWorldPosition } from "./utils";
import { IKConstraintData, BoneConstraint } from "./types";
import { applyRotationConstraints } from "./constraints";

// Blockbench global types
declare var Blockbench: any;
declare var Group: any;

// Constants
const CHAIN_REACH_MARGIN = 0.95;
const IK_SOLVER_DAMPING = 0.5;
const IK_SOLVER_MAX_ITERATIONS = 15;
const IK_SOLVER_TOLERANCE = 0.1;

/**
 * Calculates the maximum reachable distance of an IK chain.
 * This is the sum of all bone lengths in the chain.
 * 
 * @param chain - Array of bones forming the IK chain
 * @returns Total maximum reach distance
 */
export function getChainMaxReach(chain: any[]): number {
    let totalLength = 0;
    for (let i = 0; i < chain.length - 1; i++) {
        const bone = chain[i];
        const nextBone = chain[i + 1];
        const bonePos = getBoneWorldPosition(bone);
        const nextBonePos = getBoneWorldPosition(nextBone);
        totalLength += vec3Length(vec3Sub(nextBonePos, bonePos));
    }
    return totalLength;
}

/**
 * Clamps a target position to be within the IK chain's reach.
 * Uses a margin (CHAIN_REACH_MARGIN) to prevent overextension.
 * 
 * @param chain - Array of bones forming the IK chain
 * @param targetPosition - Desired target position
 * @param maxReach - Maximum reach distance of the chain
 * @returns Clamped position within chain reach
 */
export function clampTargetToChainReach(
    chain: any[],
    targetPosition: [number, number, number],
    maxReach: number
): [number, number, number] {
    const root = chain[0];
    const rootPos = getBoneWorldPosition(root);
    const toTarget = vec3Sub(targetPosition, rootPos);
    const distance = vec3Length(toTarget);
    
    if (distance <= maxReach) {
        return targetPosition;
    }
    
    const clampedDirection = vec3Normalize(toTarget);
    const clampedDistance = maxReach * CHAIN_REACH_MARGIN;
    const clampedTarget = vec3Add(rootPos, [
        clampedDirection[0] * clampedDistance,
        clampedDirection[1] * clampedDistance,
        clampedDirection[2] * clampedDistance
    ]);

    return clampedTarget;
}

/**
 * CCD (Cyclic Coordinate Descent) IK solver.
 * Solves IK chain to reach target position, respecting pinned bones and rotation constraints.
 * 
 * @param chain - Array of bones forming the IK chain
 * @param targetPosition - Target position for the end effector
 * @param pinnedBones - Set of bone names that should not move
 * @param constraintData - IK constraint configuration
 * @param maxIterations - Maximum solver iterations (default: IK_SOLVER_MAX_ITERATIONS)
 * @param tolerance - Distance tolerance for convergence (default: IK_SOLVER_TOLERANCE)
 * @returns True if target was reached within tolerance
 */
export function solveIKChain(
    chain: any[],
    targetPosition: [number, number, number],
    pinnedBones: Set<string>,
    constraintData: IKConstraintData,
    maxIterations: number = IK_SOLVER_MAX_ITERATIONS,
    tolerance: number = IK_SOLVER_TOLERANCE
): boolean {
    if (chain.length < 2) return false;

    const endEffector = chain[chain.length - 1];
    const root = chain[0];
    
    if (pinnedBones.has(endEffector.name) || pinnedBones.has(root.name)) {
        return false;
    }
    
    for (let iter = 0; iter < maxIterations; iter++) {
        
        const currentEndPos = getBoneEndWorldPosition(endEffector);
        
        const distance = vec3Length(vec3Sub(targetPosition, currentEndPos));
        if (distance < tolerance) {
            return true;
        }
        
        for (let i = chain.length - 2; i >= 0; i--) {
            const bone = chain[i];
            if (pinnedBones.has(bone.name)) {
                continue;
            }

            const boneWorldPos = getBoneWorldPosition(bone);
            const currentEndEffectorPos = getBoneEndWorldPosition(endEffector);
            
            const toEnd = vec3Sub(currentEndEffectorPos, boneWorldPos);
            const toEndLen = vec3Length(toEnd);
            
            const toTarget = vec3Sub(targetPosition, boneWorldPos);
            const toTargetLen = vec3Length(toTarget);
            
            if (toEndLen < 0.001 || toTargetLen < 0.001) {
                continue;
            }
            
            const damping = IK_SOLVER_DAMPING;
            const rotationDelta = alignVectors(toEnd, toTarget);
            
            const currentRot: [number, number, number] = [
                bone.rotation[0] || 0,
                bone.rotation[1] || 0,
                bone.rotation[2] || 0
            ];

            let newRot: [number, number, number] = [
                currentRot[0] + rotationDelta[0] * damping,
                currentRot[1] + rotationDelta[1] * damping,
                currentRot[2] + rotationDelta[2] * damping
            ];
            
            newRot = applyRotationConstraints(bone, newRot, constraintData);
            
            bone.rotation[0] = newRot[0];
            bone.rotation[1] = newRot[1];
            bone.rotation[2] = newRot[2];
            
        }
    }
    
    const finalEndPos = getBoneEndWorldPosition(endEffector);
    const finalDistance = vec3Length(vec3Sub(targetPosition, finalEndPos));

    return finalDistance < tolerance * 2;
}
