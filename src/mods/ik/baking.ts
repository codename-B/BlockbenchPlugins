
import { findAllIKControllers } from "./chain_utils";
import { getIKConstraintData, setIKConstraintData, applyRotationConstraints, getOrientationInfluence } from "./constraints";
import { IKConstraintData } from "./types";

// Blockbench global types
declare var Blockbench: any;
declare var Project: any;
declare var Animation: any;
declare var _Animation: any;
declare var Animator: any;
declare var Format: any;
declare var Group: any;

// Constants
const VS_DEFAULT_FPS = 20;
const KEYFRAME_TIME_TOLERANCE = 0.01;
const POSITION_THRESHOLD = 0.001;

/**
 * Gets the animatable IK weight for a controller at a specific time.
 * Interpolates between keyframes if weight is animated.
 * 
 * @param controller - The IK controller
 * @param animation - The animation to check
 * @param time - The time to evaluate
 * @returns Weight value between 0-1 (0 = disabled, 1 = fully enabled)
 */
export function getIKWeightAtTime(controller: any, animation: any, time: number): number {
    const constraintData = getIKConstraintData(controller);
    const baseWeight = constraintData.weight ?? 1.0;
    
    try {
        const animator = animation.getBoneAnimator(controller);
        if (animator) {
            
            const weightKeyframes = animator.keyframes.filter((kf: any) =>
                kf.channel === 'ik_weight'
            );

            if (weightKeyframes.length > 0) {
                
                weightKeyframes.sort((a: any, b: any) => a.time - b.time);
                
                let beforeKf: any = null;
                let afterKf: any = null;

                for (const kf of weightKeyframes) {
                    if (kf.time <= time) {
                        beforeKf = kf;
                    } else if (!afterKf) {
                        afterKf = kf;
                        break;
                    }
                }
                
                if (beforeKf && afterKf) {
                    
                    const t = (time - beforeKf.time) / (afterKf.time - beforeKf.time);
                    const beforeWeight = beforeKf.data_points?.[0]?.x ?? baseWeight;
                    const afterWeight = afterKf.data_points?.[0]?.x ?? baseWeight;
                    return Math.max(0, Math.min(1, beforeWeight + (afterWeight - beforeWeight) * t));
                } else if (beforeKf) {
                    
                    return Math.max(0, Math.min(1, beforeKf.data_points?.[0]?.x ?? baseWeight));
                } else if (afterKf) {
                    
                    return Math.max(0, Math.min(1, afterKf.data_points?.[0]?.x ?? baseWeight));
                }
            }
        }
    } catch (e) {
        
        console.warn('Error getting animatable IK weight:', e);
    }

    return baseWeight;
}

/**
 * Gets the animatable IK lock state for a controller at a specific time.
 * 
 * @param controller - The IK controller
 * @param animation - The animation to check
 * @param time - The time to evaluate
 * @returns True if the controller position should be locked at this time
 */
export function getIKLockAtTime(controller: any, animation: any, time: number): boolean {
    const constraintData = getIKConstraintData(controller);
    const baseLock = constraintData.lockPosition ?? false;
    
    try {
        const animator = animation.getBoneAnimator(controller);
        if (animator) {
            
            const lockKeyframes = animator.keyframes.filter((kf: any) =>
                kf.channel === 'ik_lock'
            );

            if (lockKeyframes.length > 0) {
                
                lockKeyframes.sort((a: any, b: any) => a.time - b.time);
                
                let beforeKf: any = null;
                let afterKf: any = null;

                for (const kf of lockKeyframes) {
                    if (kf.time <= time) {
                        beforeKf = kf;
                    } else if (!afterKf) {
                        afterKf = kf;
                        break;
                    }
                }
                
                if (beforeKf && afterKf) {
                    
                    const t = (time - beforeKf.time) / (afterKf.time - beforeKf.time);
                    const beforeLock = (beforeKf.data_points?.[0]?.x ?? (baseLock ? 1 : 0)) > 0.5;
                    const afterLock = (afterKf.data_points?.[0]?.x ?? (baseLock ? 1 : 0)) > 0.5;
                    const interpolated = beforeLock ? (1 - t) : t;
                    return interpolated > 0.5;
                } else if (beforeKf) {
                    
                    return (beforeKf.data_points?.[0]?.x ?? (baseLock ? 1 : 0)) > 0.5;
                } else if (afterKf) {
                    
                    return (afterKf.data_points?.[0]?.x ?? (baseLock ? 1 : 0)) > 0.5;
                }
            }
        }
    } catch (e) {
        
        console.warn('Error getting animatable IK lock state:', e);
    }

    return baseLock;
}

/**
 * Blends IK-driven rotation with manual keyframes and constraints.
 * Allows manual keyframe overrides to take precedence over IK when present.
 * 
 * @param bone - The bone to blend rotation for
 * @param ikRotation - The IK-calculated rotation
 * @param animation - The current animation
 * @param time - The current time
 * @param constraintData - IK constraint configuration
 * @param weight - IK weight (0-1)
 * @returns Final blended rotation with constraints applied
 */
export function blendIKWithManual(
    bone: any,
    ikRotation: [number, number, number],
    animation: any,
    time: number,
    constraintData: IKConstraintData,
    weight: number
): [number, number, number] {
    const animator = animation.getBoneAnimator(bone);
    if (!animator) {
        return applyRotationConstraints(bone, ikRotation, constraintData);
    }
    
    const rotationKeyframes = animator.keyframes.filter((kf: any) =>
        kf.channel === 'rotation' && Math.abs(kf.time - time) < KEYFRAME_TIME_TOLERANCE
    );

    if (rotationKeyframes.length > 0) {
        
        const manualRot = rotationKeyframes[0].data_points[0];
        const manualRotation: [number, number, number] = [
            manualRot.x || 0,
            manualRot.y || 0,
            manualRot.z || 0
        ];
        
        const blended: [number, number, number] = [
            manualRotation[0] * (1 - weight) + ikRotation[0] * weight,
            manualRotation[1] * (1 - weight) + ikRotation[1] * weight,
            manualRotation[2] * (1 - weight) + ikRotation[2] * weight
        ];

        return applyRotationConstraints(bone, blended, constraintData);
    }
    
    const orientationInfluence = getOrientationInfluence(constraintData);
    if (orientationInfluence) {
        
        const blended: [number, number, number] = [
            ikRotation[0] * 0.5 + orientationInfluence[0] * 0.5,
            ikRotation[1] * 0.5 + orientationInfluence[1] * 0.5,
            ikRotation[2] * 0.5 + orientationInfluence[2] * 0.5
        ];
        return applyRotationConstraints(bone, blended, constraintData);
    }

    return applyRotationConstraints(bone, ikRotation, constraintData);
}

/**
 * Bakes IK animations to keyframes for VS export.
 * Since VS doesn't support IK natively, this converts IK-driven animations
 * to regular keyframe animations by sampling the IK-driven bone transforms.
 * 
 * Process:
 * 1. Samples animation at regular intervals (VS_DEFAULT_FPS)
 * 2. Applies IK constraints and weights
 * 3. Creates rotation and position keyframes for all bones in IK chains
 * 4. Shows progress notification when complete
 * 
 * @param is_vs_project - Function to check if current project is a VS project
 */
export function bakeIKAnimations(is_vs_project: (project: any) => boolean) {
    if (!Project || !is_vs_project(Project)) return;

    const ikControllers = findAllIKControllers();
    if (ikControllers.length === 0) return;

    const animations = (Animation as unknown as typeof _Animation).all;
    const fps = VS_DEFAULT_FPS;

    let totalBakedKeyframes = 0;
    
    animations.forEach((animation: any) => {
        
        const ikBones = new Set<any>();
        ikControllers.forEach(({ chain }) => {
            chain.forEach(bone => ikBones.add(bone));
        });

        if (ikBones.size === 0) return;
        
        const frameCount = Math.ceil(animation.length * fps);
        const sampleInterval = 1 / fps; // Sample every frame
        
        const originalTime = animation.time;
        const originalSelected = animation.selected;
        const wasPlaying = Animator.playing;
        
        if (wasPlaying) {
            Animator.pause();
        }
        
        animation.select();
        
        const wasInAnimationMode = Format.animation_mode;
        if (!wasInAnimationMode) {
            Format.animation_mode = true;
        }
        
        for (let frame = 0; frame <= frameCount; frame++) {
            const time = Math.min(frame * sampleInterval, animation.length);
            
            animation.time = time;
            
            ikControllers.forEach(({ controller }) => {
                const constraintData = getIKConstraintData(controller);
                const isLocked = getIKLockAtTime(controller, animation, time);

                if (isLocked && constraintData.lockedPosition) {
                    
                    controller.origin[0] = constraintData.lockedPosition[0];
                    controller.origin[1] = constraintData.lockedPosition[1];
                    controller.origin[2] = constraintData.lockedPosition[2];
                } else if (isLocked && !constraintData.lockedPosition) {
                    
                    const pos = controller.origin;
                    constraintData.lockedPosition = [pos[0], pos[1], pos[2]];
                    setIKConstraintData(controller, constraintData);
                }
            });
            
            if (Animator.update) {
                Animator.update();
            }
            
            Blockbench.updateViewport();
            
            ikControllers.forEach(({ controller, chain }) => {
                const constraintData = getIKConstraintData(controller);
                const weight = getIKWeightAtTime(controller, animation, time);
                
                if (weight <= 0) {
                    return;
                }
                
                chain.forEach(bone => {
                    const animator = animation.getBoneAnimator(bone);
                    if (!animator) return;
                    
                    const ikRotation: [number, number, number] = [
                        bone.rotation[0] || 0,
                        bone.rotation[1] || 0,
                        bone.rotation[2] || 0
                    ];
                    
                    const finalRotation = blendIKWithManual(bone, ikRotation, animation, time, constraintData, weight);
                    
                    let originalRotation: [number, number, number] = [0, 0, 0];
                    if (animator.interpolate) {
                        try {
                            const interp = animator.interpolate('rotation');
                            originalRotation = [interp[0] || 0, interp[1] || 0, interp[2] || 0];
                        } catch (e) {
                            
                            originalRotation = [bone.rotation[0] || 0, bone.rotation[1] || 0, bone.rotation[2] || 0];
                        }
                    } else {
                        originalRotation = [bone.rotation[0] || 0, bone.rotation[1] || 0, bone.rotation[2] || 0];
                    }

                    const weightedRotation: [number, number, number] = [
                        originalRotation[0] * (1 - weight) + finalRotation[0] * weight,
                        originalRotation[1] * (1 - weight) + finalRotation[1] * weight,
                        originalRotation[2] * (1 - weight) + finalRotation[2] * weight
                    ];

                    const origin = bone.origin;
                    
                    const parentOrigin = bone.parent ? bone.parent.origin : [0, 0, 0];
                    const offset = [
                        origin[0] - parentOrigin[0],
                        origin[1] - parentOrigin[1],
                        origin[2] - parentOrigin[2]
                    ];
                    
                    const existingKf = animator.keyframes.find((kf: any) =>
                        Math.abs(kf.time - time) < sampleInterval / 4
                    );

                    if (!existingKf) {
                        
                        animator.addKeyframe({
                            interpolation: 'linear',
                            time,
                            channel: 'rotation',
                            data_points: [{
                                x: weightedRotation[0],
                                y: weightedRotation[1],
                                z: weightedRotation[2]
                            }]
                        });
                        totalBakedKeyframes++;
                        
                        if (Math.abs(offset[0]) > POSITION_THRESHOLD || Math.abs(offset[1]) > POSITION_THRESHOLD || Math.abs(offset[2]) > POSITION_THRESHOLD) {
                            animator.addKeyframe({
                                interpolation: 'linear',
                                time,
                                channel: 'position',
                                data_points: [{
                                    x: offset[0],
                                    y: offset[1],
                                    z: offset[2]
                                }]
                            });
                            totalBakedKeyframes++;
                        }
                    } else {
                        
                        const kf = existingKf;
                        if (kf.channel === 'rotation' && kf.data_points && kf.data_points[0]) {
                            kf.data_points[0].x = weightedRotation[0];
                            kf.data_points[0].y = weightedRotation[1];
                            kf.data_points[0].z = weightedRotation[2];
                        } else if (kf.channel === 'position' && kf.data_points && kf.data_points[0]) {
                            kf.data_points[0].x = offset[0];
                            kf.data_points[0].y = offset[1];
                            kf.data_points[0].z = offset[2];
                        }
                    }
                });
            });
        }
        
        animation.time = originalTime;
        if (originalSelected) {
            animation.select();
        } else {
            animation.deselect();
        }

        if (!wasInAnimationMode) {
            Format.animation_mode = false;
        }

        if (wasPlaying) {
            Animator.play();
        }
    });

    Blockbench.showQuickMessage(
        `Baked ${ikControllers.length} IK controller(s) to ${totalBakedKeyframes} keyframes`,
        3000
    );
}