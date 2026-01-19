
import { vec3Length, vec3Sub, vec3Normalize, vec3Add } from "./math";
import { getBoneWorldPosition, getBoneEndWorldPosition } from "./utils";
import { getChainMaxReach, clampTargetToChainReach } from "./solver";
import { getIKConstraintData, setIKConstraintData } from "./constraints";
import { DragState } from "./types";
import { solveIKChain } from "./solver";
import { findAllIKControllers as findAllControllers } from "./chain_utils";

// Blockbench global types
declare var Blockbench: any;
declare var Group: any;
declare var Outliner: any;
declare var Format: any;
declare var Animation: any;

// Constants
const VIEWPORT_UPDATE_THROTTLE = 2;
const KEYFRAME_TIME_TOLERANCE = 0.01;

const dragState: DragState = {
    isActive: false,
    draggedBone: null,
    originalBoneState: new Map(),
    ikChain: null,
    controller: null,
    constraintData: null,
    startPosition: null
};

/**
 * Toggles the pin state for a bone.
 * Pinned bones will not move during IK solving.
 * 
 * @param bone - The bone to toggle pin state for
 */
export function togglePinBone(bone: any): void {
    bone.vsIKPinned = !bone.vsIKPinned;
    updatePinnedBones();

    Blockbench.showQuickMessage(
        `${bone.name} ${bone.vsIKPinned ? 'pinned' : 'unpinned'}`,
        2000
    );
}

/**
 * Updates the pinned bones list in all IK controllers.
 * Syncs the global pinned bones state across all IK controller constraints.
 */
export function updatePinnedBones(): void {
    const pinnedBones = Group.all
        .filter((g: any) => !g.isNull && (g as any).vsIKPinned)
        .map((g: any) => g.name);
    
    const ikControllers = findAllControllers();
    ikControllers.forEach(({ controller }) => {
        const constraintData = getIKConstraintData(controller);
        constraintData.pinnedBones = pinnedBones;
        setIKConstraintData(controller, constraintData);
    });
}

/**
 * Sets up interactive IK by hooking into Blockbench bone dragging events.
 * Implements real-time IK solving when dragging bones in IK chains.
 * 
 * Features:
 * - Automatic IK solving during bone transforms
 * - Respects pinned bones
 * - Creates keyframes in animation mode
 * - Throttled viewport updates for performance
 */
export function setupInteractiveIK(): void {
    let transformCount = 0;
    
    Blockbench.on('select', () => {
        
        const selected = Outliner.selected;
        if (!selected || selected.length !== 1) return;

        const bone = selected[0];
        if (!(bone instanceof Group) || bone.isNull) return;
        
        const ikControllers = findAllControllers();
        for (const { controller, chain } of ikControllers) {
            const constraintData = getIKConstraintData(controller);

            if (chain.includes(bone)) {
                const pinnedBones = new Set(constraintData.pinnedBones || []);
                
                if (pinnedBones.has(bone.name)) {
                    Blockbench.showQuickMessage(
                        `Cannot drag pinned bone: ${bone.name}`,
                        2000
                    );
                    return;
                }
                
                if (!dragState.isActive || dragState.draggedBone !== bone) {
                    dragState.isActive = true;
                    dragState.draggedBone = bone;
                    dragState.ikChain = chain;
                    dragState.controller = controller;
                    dragState.constraintData = constraintData;
                    dragState.startPosition = getBoneWorldPosition(bone);
                    dragState.originalBoneState.clear();
                    transformCount = 0;
                    
                    chain.forEach((chainBone: any) => {
                        dragState.originalBoneState.set(chainBone.name, {
                            position: [chainBone.origin[0], chainBone.origin[1], chainBone.origin[2]],
                            rotation: [
                                chainBone.rotation[0] || 0,
                                chainBone.rotation[1] || 0,
                                chainBone.rotation[2] || 0
                            ]
                        });
                    });
                }

                break;
            }
        }
    });
    
    Blockbench.on('transform_selection', () => {
        
        const selected = Outliner.selected;
        if (!selected || selected.length !== 1) return;

        const bone = selected[0];
        if (!(bone instanceof Group) || bone.isNull) return;
        
        if (!dragState.isActive || dragState.draggedBone !== bone) {
            
            const ikControllers = findAllControllers();
            for (const { controller, chain } of ikControllers) {
                const constraintData = getIKConstraintData(controller);

                if (chain.includes(bone)) {
                    const pinnedBones = new Set(constraintData.pinnedBones || []);
                    if (pinnedBones.has(bone.name)) return;

                    dragState.isActive = true;
                    dragState.draggedBone = bone;
                    dragState.ikChain = chain;
                    dragState.controller = controller;
                    dragState.constraintData = constraintData;
                    dragState.startPosition = getBoneWorldPosition(bone);
                    dragState.originalBoneState.clear();
                    transformCount = 0;

                    chain.forEach((chainBone: any) => {
                        dragState.originalBoneState.set(chainBone.name, {
                            position: [chainBone.origin[0], chainBone.origin[1], chainBone.origin[2]],
                            rotation: [
                                chainBone.rotation[0] || 0,
                                chainBone.rotation[1] || 0,
                                chainBone.rotation[2] || 0
                            ]
                        });
                    });
                    break;
                }
            }
        }

        if (!dragState.isActive || !dragState.draggedBone || !dragState.ikChain || !dragState.constraintData) {
            return;
        }

        if (dragState.draggedBone !== bone) return;

        transformCount++;
        const chain = dragState.ikChain;
        const constraintData = dragState.constraintData;
        const pinnedBones = new Set(constraintData.pinnedBones || []);
        
        let targetPosition = getBoneWorldPosition(bone);
        
        const endEffectorIndex = chain.length - 1;
        if (chain[endEffectorIndex] === bone) {
            
            const maxReach = getChainMaxReach(chain);
            const rootPos = getBoneWorldPosition(chain[0]);
            const distance = vec3Length(vec3Sub(targetPosition, rootPos));
            
            if (distance > maxReach) {
                const clampedTarget = clampTargetToChainReach(chain, targetPosition, maxReach);
                
                const boneParent = bone.parent;
                if (boneParent instanceof Group) {
                    const parentPos = getBoneWorldPosition(boneParent);
                    bone.origin[0] = clampedTarget[0] - parentPos[0];
                    bone.origin[1] = clampedTarget[1] - parentPos[1];
                    bone.origin[2] = clampedTarget[2] - parentPos[2];
                } else {
                    bone.origin[0] = clampedTarget[0];
                    bone.origin[1] = clampedTarget[1];
                    bone.origin[2] = clampedTarget[2];
                }

                targetPosition = clampedTarget;
            }
            
            solveIKChain(chain, targetPosition, pinnedBones, constraintData);
        } else {
            
            const boneIndex = chain.indexOf(bone);
            if (boneIndex === -1) return;
            
            const subChain = chain.slice(boneIndex);
            const endEffector = subChain[subChain.length - 1];
            
            const maxReach = getChainMaxReach(subChain);
            const rootPos = getBoneWorldPosition(subChain[0]);
            const distance = vec3Length(vec3Sub(targetPosition, rootPos));

            if (distance > maxReach) {
                const clampedTarget = clampTargetToChainReach(subChain, targetPosition, maxReach);
                const boneParent = bone.parent;
                if (boneParent instanceof Group) {
                    const parentPos = getBoneWorldPosition(boneParent);
                    bone.origin[0] = clampedTarget[0] - parentPos[0];
                    bone.origin[1] = clampedTarget[1] - parentPos[1];
                    bone.origin[2] = clampedTarget[2] - parentPos[2];
                } else {
                    bone.origin[0] = clampedTarget[0];
                    bone.origin[1] = clampedTarget[1];
                    bone.origin[2] = clampedTarget[2];
                }
                targetPosition = clampedTarget;
            }

            const endEffectorTarget = getBoneEndWorldPosition(endEffector);
            
            solveIKChain(subChain, endEffectorTarget, pinnedBones, constraintData);
        }
        
        if (transformCount % VIEWPORT_UPDATE_THROTTLE === 0) {
            Blockbench.updateViewport();
        }
    });
    
    Blockbench.on('finish_edit', () => {
        if (dragState.isActive && dragState.ikChain && dragState.draggedBone) {
            
            if (Format.animation_mode) {
                const currentAnimation = Animation.selected;
                if (currentAnimation) {
                    const currentTime = currentAnimation.time;

                    dragState.ikChain.forEach((bone: any) => {
                        const animator = currentAnimation.getBoneAnimator(bone);
                        if (!animator) return;
                        
                        const existingKf = animator.keyframes.find((kf: any) =>
                            kf.channel === 'rotation' && Math.abs(kf.time - currentTime) < KEYFRAME_TIME_TOLERANCE
                        );

                        if (!existingKf) {
                            
                            animator.addKeyframe({
                                interpolation: 'linear',
                                time: currentTime,
                                channel: 'rotation',
                                data_points: [{
                                    x: bone.rotation[0] || 0,
                                    y: bone.rotation[1] || 0,
                                    z: bone.rotation[2] || 0
                                }]
                            });
                        } else {
                            
                            if (existingKf.data_points && existingKf.data_points[0]) {
                                existingKf.data_points[0].x = bone.rotation[0] || 0;
                                existingKf.data_points[0].y = bone.rotation[1] || 0;
                                existingKf.data_points[0].z = bone.rotation[2] || 0;
                            }
                        }
                    });
                }
            }
            
            dragState.isActive = false;
            dragState.draggedBone = null;
            dragState.ikChain = null;
            dragState.controller = null;
            dragState.constraintData = null;
            dragState.startPosition = null;
            dragState.originalBoneState.clear();
            transformCount = 0;
        }
    });
    
    Blockbench.on('update_selection', () => {
        
        if (!dragState.isActive) {
        }
    });
}