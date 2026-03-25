import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";
import { is_vs_project } from "../util";
import {
    getAnimatedConstraintsForBone,
    getConstraintCacheEntries,
    getIKConstraintData,
    applyRotationConstraints,
    isIKControllerAnimated
} from "./ik/constraints";
import { findAllIKControllers, getIKChain } from "./ik/chain_utils";
import { refreshIKPreview, isIKAnimationContextActive } from "./ik/utils";
import { getIKWeightAtTime } from "./ik/baking";
import { BoneConstraint } from "./ik/types";

// @ts-expect-error: THREE is global in Blockbench
declare const THREE: typeof import('three');

const DEG2RAD = Math.PI / 180;
const ROTATION_EPSILON = 0.0001;

/**
 * Map of patched bone names to their cleanup functions.
 * Used to restore original updateMatrixWorld when constraints change.
 */
const patchedBones = new Map<string, () => void>();

/**
 * Patches updateMatrixWorld on constrained bone meshes so that
 * IK constraints are enforced during the render pass — AFTER
 * Blockbench's IK solver has set the bone rotations.
 */
export function syncConstraintEnforcement(): void {
    // Clean up old patches
    for (const cleanup of patchedBones.values()) cleanup();
    patchedBones.clear();

    const entries = getConstraintCacheEntries();
    if (!entries) return;

    for (const [boneName] of entries) {
        const bone = Group.all.find((g: any) => g.name === boneName);
        if (!bone?.mesh) continue;

        const originalFn = bone.mesh.updateMatrixWorld;

        bone.mesh.updateMatrixWorld = function (this: any, force: boolean) {
            if (!isIKAnimationContextActive()) {
                return originalFn.call(this, force);
            }

            const constraint = getAnimatedConstraintsForBone(boneName, getActiveAnimation());
            if (!constraint) {
                return originalFn.call(this, force);
            }

            // Clamp rotation before matrix is recomputed
            const euler = this.rotation;
            if (constraint.allowedAxes) {
                if (!constraint.allowedAxes.x) euler.x = 0;
                if (!constraint.allowedAxes.y) euler.y = 0;
                if (!constraint.allowedAxes.z) euler.z = 0;
            }
            if (constraint.rotationLimits) {
                if (constraint.rotationLimits.x) {
                    euler.x = Math.max(constraint.rotationLimits.x.min * DEG2RAD,
                        Math.min(constraint.rotationLimits.x.max * DEG2RAD, euler.x));
                }
                if (constraint.rotationLimits.y) {
                    euler.y = Math.max(constraint.rotationLimits.y.min * DEG2RAD,
                        Math.min(constraint.rotationLimits.y.max * DEG2RAD, euler.y));
                }
                if (constraint.rotationLimits.z) {
                    euler.z = Math.max(constraint.rotationLimits.z.min * DEG2RAD,
                        Math.min(constraint.rotationLimits.z.max * DEG2RAD, euler.z));
                }
            }
            originalFn.call(this, force);
        };

        patchedBones.set(boneName, () => {
            if (bone.mesh) {
                bone.mesh.updateMatrixWorld = originalFn;
            }
        });
    }
}

/**
 * Removes all constraint enforcement patches.
 */
export function clearConstraintEnforcement(): void {
    for (const cleanup of patchedBones.values()) cleanup();
    patchedBones.clear();
}

function getActiveAnimation(): any | null {
    try {
        return Animation?.selected ?? Animator?.selected ?? null;
    } catch {
        return null;
    }
}

function enforceControllerAnimationConstraints(controller: any, animation: any | null): any[] {
    if (!controller?.ik_target) {
        return [];
    }

    const chain = getIKChain(controller);
    if (chain.length === 0) {
        return [];
    }

    if (!isIKControllerAnimated(controller, animation)) {
        return [];
    }

    if (animation) {
        const weight = getIKWeightAtTime(controller, animation, animation.time);
        if (weight <= 0) {
            return [];
        }
    }

    const constraintData = getIKConstraintData(controller);
    const changedBones: any[] = [];

    for (const bone of chain) {
        const currentRotation: [number, number, number] = [
            bone.rotation?.[0] || 0,
            bone.rotation?.[1] || 0,
            bone.rotation?.[2] || 0
        ];
        const constrainedRotation = applyRotationConstraints(bone, currentRotation, constraintData);

        const changed =
            Math.abs(constrainedRotation[0] - currentRotation[0]) > ROTATION_EPSILON ||
            Math.abs(constrainedRotation[1] - currentRotation[1]) > ROTATION_EPSILON ||
            Math.abs(constrainedRotation[2] - currentRotation[2]) > ROTATION_EPSILON;

        if (!changed) {
            continue;
        }

        bone.rotation[0] = constrainedRotation[0];
        bone.rotation[1] = constrainedRotation[1];
        bone.rotation[2] = constrainedRotation[2];
        changedBones.push(bone);
    }

    return changedBones;
}

function enforceAnimatedIKConstraints(): void {
    if (!is_vs_project(Project) || !isIKAnimationContextActive()) {
        return;
    }

    const animation = getActiveAnimation();
    const changedBones = new Set<any>();

    for (const { controller } of findAllIKControllers()) {
        const changed = enforceControllerAnimationConstraints(controller, animation);
        changed.forEach((bone: any) => changedBones.add(bone));
    }

    if (changedBones.size > 0) {
        refreshIKPreview(Array.from(changedBones));
    }
}

/**
 * Patches the BoneAnimator to flip rotation and position application when a VS file is loaded
 */
createBlockbenchMod(
    `${PACKAGE.name}:bone_animator_mod`,
    {
        original: Blockbench.BoneAnimator.prototype.displayFrame,
        additional_function: Blockbench.BoneAnimator.prototype.flippedDisplayPosition,
        originalPreview: Animator.preview
    },
    context => {
        // Inject code here
        Blockbench.BoneAnimator.prototype.displayFrame = function (this: BoneAnimator, multiplier = 1) {
            if (is_vs_project(Project)) {
                if (!this.doRender()) return;
                this.getGroup();
                        //@ts-expect-error: Missing in type --- IGNORE ---
                Animator.MolangParser.context.animation = this.animation;

                const rotation = this.interpolate('rotation');
                const position = this.interpolate('position');

                // Apply IK constraints to interpolated rotation during playback
                // (for bones with keyframes — IK-driven bones are handled by updateMatrixWorld patches)
                if (rotation) {
                    const group = this.group;
                    if (group) {
                        const constraint = getAnimatedConstraintsForBone(group.name, getActiveAnimation());
                        if (constraint) {
                            if (constraint.allowedAxes) {
                                if (!constraint.allowedAxes.x) rotation[0] = 0;
                                if (!constraint.allowedAxes.y) rotation[1] = 0;
                                if (!constraint.allowedAxes.z) rotation[2] = 0;
                            }
                            if (constraint.rotationLimits) {
                                if (constraint.rotationLimits.x) {
                                    rotation[0] = Math.max(constraint.rotationLimits.x.min, Math.min(constraint.rotationLimits.x.max, rotation[0]));
                                }
                                if (constraint.rotationLimits.y) {
                                    rotation[1] = Math.max(constraint.rotationLimits.y.min, Math.min(constraint.rotationLimits.y.max, rotation[1]));
                                }
                                if (constraint.rotationLimits.z) {
                                    rotation[2] = Math.max(constraint.rotationLimits.z.min, Math.min(constraint.rotationLimits.z.max, rotation[2]));
                                }
                            }
                        }
                    }
                }

                //@ts-expect-error: Copied from blockbench itself, so it should work :P
                if (!this.muted.rotation) this.displayRotation(rotation, multiplier);

                if (!this.muted.position) {
                    this.flippedDisplayPosition(position, rotation, multiplier);

                }
                //@ts-expect-error: Copied from blockbench itself, so it should work :P
                if (!this.muted.scale) this.displayScale(this.interpolate('scale'), multiplier);
                return;
            }
            return context.original.call(this, multiplier);
        };

        Animator.preview = function (this: any, in_loop?: boolean) {
            const result = context.originalPreview.call(this, in_loop);

            if (is_vs_project(Project) && isIKAnimationContextActive()) {
                enforceAnimatedIKConstraints();
            }

            return result;
        };


        Blockbench.BoneAnimator.prototype.flippedDisplayPosition = function (this: BoneAnimator, position, rotation, multiplier) {
            if (!rotation) {
                this.displayPosition(position, multiplier);
            } else {
                if (position) {
                    const vec = position
                        .V3_toThree()
                        .applyEuler(new THREE.Euler(
                            THREE.MathUtils.degToRad(rotation[0]),
                            THREE.MathUtils.degToRad(rotation[1]),
                            THREE.MathUtils.degToRad(rotation[2])
                            //@ts-expect-error: Missing in type --- IGNORE ---
                        ), Format.euler_order);
                    this.displayPosition(vec.toArray(), multiplier);
                }
            }
        };
        return context;
    },
    context => {
        clearConstraintEnforcement();
        Animator.preview = context.originalPreview;
        Blockbench.BoneAnimator.prototype.flippedDisplayPosition = context.additional_function;
        Blockbench.BoneAnimator.prototype.displayFrame = context.original;
    }

);
