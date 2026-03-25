
import * as PACKAGE from "../../../package.json";
import { IKConstraintData, BoneConstraint } from "./types";
import { ConstraintVisualizer } from "./constraint_visualizer";
import { findAllIKControllers } from "./chain_utils";

// Blockbench global types
declare var Group: any;
declare var NullObject: any;
declare var Dialog: any;
declare var Blockbench: any;
declare var Project: any;
declare var Animation: any;
declare var Animator: any;

/**
 * Gets IK constraint data for a controller.
 * Loads persisted boneConstraints from the vsIKBoneConstraints string property.
 */
export function getIKConstraintData(controller: any): IKConstraintData {
    if (!controller.vsIKConstraints) {
        let boneConstraints: Record<string, any> = {};
        try {
            if (controller.vsIKBoneConstraints && controller.vsIKBoneConstraints !== '{}') {
                boneConstraints = JSON.parse(controller.vsIKBoneConstraints);
            }
        } catch (e) {
            console.error('Error parsing vsIKBoneConstraints:', e);
        }
        controller.vsIKConstraints = {
            weight: controller.vsIKWeight ?? 1.0,
            lockPosition: controller.vsIKLockPosition ?? false,
            boneConstraints
        };
    }
    return controller.vsIKConstraints;
}

/**
 * Sets IK constraint data for a controller
 */
export function setIKConstraintData(controller: any, data: IKConstraintData): void {
    controller.vsIKConstraints = { ...getIKConstraintData(controller), ...data };
    constraintCache = null;

    // Persist boneConstraints to the Blockbench Property (saved in bbmodel file)
    try {
        const bc = controller.vsIKConstraints.boneConstraints;
        controller.vsIKBoneConstraints = bc ? JSON.stringify(bc) : '{}';
    } catch (e) {
        console.error('Error serializing boneConstraints:', e);
    }

    try {
        if (Project && Project.save) {
            Project.save();
        }
    } catch (e) {
        console.error('Error saving project after IK constraint update:', e);
    }

    ensureCache();
}

/**
 * Cached constraint lookup for playback performance.
 * Invalidated whenever setIKConstraintData is called.
 */
let constraintCache: Map<string, BoneConstraint> | null = null;

/** Callback invoked after constraint cache is rebuilt */
let onCacheRebuilt: (() => void) | null = null;

/**
 * Registers a callback that fires whenever the constraint cache is rebuilt.
 * Used by the mesh enforcement system to re-patch bone meshes.
 */
export function setOnConstraintCacheRebuilt(cb: () => void): void {
    onCacheRebuilt = cb;
}

/**
 * Returns the full constraint cache (rebuilding if needed).
 * Used by the mesh enforcement system.
 */
export function getConstraintCacheEntries(): Map<string, BoneConstraint> | null {
    // Ensure cache is built
    ensureCache();
    return constraintCache;
}

function ensureCache(): void {
    if (!constraintCache) {
        constraintCache = new Map();
        try {
            const controllers = findAllIKControllers();
            for (const { controller } of controllers) {
                const data = getIKConstraintData(controller);
                if (data.boneConstraints) {
                    for (const [name, constraint] of Object.entries(data.boneConstraints)) {
                        constraintCache.set(name, constraint);
                    }
                }
            }
        } catch (e) {
            // During early load, NullObject etc. may not exist yet
        }
        if (onCacheRebuilt) onCacheRebuilt();
    }
}

/**
 * Gets the bone constraint for a given bone name across all IK controllers.
 * Uses a lazy cache rebuilt on constraint changes.
 */
export function getConstraintsForBone(boneName: string): BoneConstraint | null {
    ensureCache();
    return constraintCache?.get(boneName) ?? null;
}

function getSelectedAnimation(): any | null {
    try {
        return Animation?.selected ?? Animator?.selected ?? null;
    } catch {
        return null;
    }
}

function getExistingAnimator(animation: any, node: any): any | null {
    if (!animation?.animators || !node) {
        return null;
    }

    return animation.animators[node.uuid]
        ?? Object.values(animation.animators).find((animator: any) =>
            animator?.uuid === node.uuid || animator?.name === node.name
        )
        ?? null;
}

export function isIKControllerAnimated(controller: any, animation: any | null = getSelectedAnimation()): boolean {
    const animator = getExistingAnimator(animation, controller);
    if (!animator?.keyframes?.length) {
        return false;
    }

    return animator.keyframes.some((kf: any) =>
        kf?.channel === 'position' ||
        kf?.channel === 'rotation' ||
        kf?.channel === 'scale'
    );
}

export function getAnimatedConstraintsForBone(
    boneName: string,
    animation: any | null = getSelectedAnimation()
): BoneConstraint | null {
    let activeConstraint: BoneConstraint | null = null;

    try {
        const controllers = findAllIKControllers();
        for (const { controller } of controllers) {
            if (!isIKControllerAnimated(controller, animation)) {
                continue;
            }

            const constraint = getIKConstraintData(controller).boneConstraints?.[boneName] ?? null;
            if (constraint) {
                activeConstraint = constraint;
            }
        }
    } catch {
        return null;
    }

    return activeConstraint;
}

/**
 * Applies rotation constraints to a bone rotation
 */
export function applyRotationConstraints(bone: any, rotation: [number, number, number], constraintData: IKConstraintData): [number, number, number] {
    const boneName = bone.name;
    const boneConstraint = constraintData.boneConstraints?.[boneName];

    if (!boneConstraint) {
        return rotation;
    }

    let [rx, ry, rz] = rotation;
    
    if (boneConstraint.allowedAxes) {
        // Disabled axis: keep the bone's current rotation (don't move on this axis)
        if (!boneConstraint.allowedAxes.x) rx = bone.rotation[0] || 0;
        if (!boneConstraint.allowedAxes.y) ry = bone.rotation[1] || 0;
        if (!boneConstraint.allowedAxes.z) rz = bone.rotation[2] || 0;
    }
    
    if (boneConstraint.rotationLimits) {
        const limits = boneConstraint.rotationLimits;

        if (limits.x) {
            rx = Math.max(limits.x.min, Math.min(limits.x.max, rx));
        }
        if (limits.y) {
            ry = Math.max(limits.y.min, Math.min(limits.y.max, ry));
        }
        if (limits.z) {
            rz = Math.max(limits.z.min, Math.min(limits.z.max, rz));
        }
    }

    return [rx, ry, rz];
}

/**
 * Gets orientation influence from external helper object
 */
export function getOrientationInfluence(constraintData: IKConstraintData): [number, number, number] | null {
    if (!constraintData.orientationHelper) {
        return null;
    }

    const helper = NullObject.all.find((g: any) => g.name === constraintData.orientationHelper);
    if (!helper) {
        return null;
    }
    
    return [helper.rotation[0] || 0, helper.rotation[1] || 0, helper.rotation[2] || 0];
}

const JOINT_PRESETS: Record<string, BoneConstraint> = {
    'Unconstrained': {
        allowedAxes: { x: true, y: true, z: true },
        rotationLimits: {}
    },
    'Hinge (X)': {
        allowedAxes: { x: true, y: false, z: false },
        rotationLimits: { x: { min: 0, max: 150 } }
    },
    'Hinge (Y)': {
        allowedAxes: { x: false, y: true, z: false },
        rotationLimits: { y: { min: 0, max: 150 } }
    },
    'Hinge (Z)': {
        allowedAxes: { x: false, y: false, z: true },
        rotationLimits: { z: { min: 0, max: 150 } }
    },
    'Ball & Socket': {
        allowedAxes: { x: true, y: true, z: true },
        rotationLimits: { x: { min: -90, max: 90 }, y: { min: -90, max: 90 }, z: { min: -90, max: 90 } }
    },
    'Pivot (X)': {
        allowedAxes: { x: true, y: true, z: true },
        rotationLimits: { y: { min: -45, max: 45 }, z: { min: -45, max: 45 } }
    },
    'Pivot (Y)': {
        allowedAxes: { x: true, y: true, z: true },
        rotationLimits: { x: { min: -45, max: 45 }, z: { min: -45, max: 45 } }
    },
    'Fixed': {
        allowedAxes: { x: false, y: false, z: false },
        rotationLimits: { x: { min: 0, max: 0 }, y: { min: 0, max: 0 }, z: { min: 0, max: 0 } }
    }
};

function detectPreset(boneConstraint: BoneConstraint): string {
    for (const [name, preset] of Object.entries(JOINT_PRESETS)) {
        const axMatch =
            (boneConstraint.allowedAxes?.x !== false) === (preset.allowedAxes?.x !== false) &&
            (boneConstraint.allowedAxes?.y !== false) === (preset.allowedAxes?.y !== false) &&
            (boneConstraint.allowedAxes?.z !== false) === (preset.allowedAxes?.z !== false);
        if (!axMatch) continue;

        const limMatch = (['x', 'y', 'z'] as const).every(axis => {
            const a = boneConstraint.rotationLimits?.[axis];
            const b = preset.rotationLimits?.[axis];
            if (!a && !b) return true;
            if (!a || !b) return false;
            return a.min === b.min && a.max === b.max;
        });
        if (limMatch) return name;
    }
    return '';
}

function getPresetFormValues(boneName: string, preset: BoneConstraint): Record<string, any> {
    return {
        [`${boneName}_axis_x`]: preset.allowedAxes?.x !== false,
        [`${boneName}_axis_y`]: preset.allowedAxes?.y !== false,
        [`${boneName}_axis_z`]: preset.allowedAxes?.z !== false,
        [`${boneName}_rot_x_min`]: preset.rotationLimits?.x?.min ?? -180,
        [`${boneName}_rot_x_max`]: preset.rotationLimits?.x?.max ?? 180,
        [`${boneName}_rot_y_min`]: preset.rotationLimits?.y?.min ?? -180,
        [`${boneName}_rot_y_max`]: preset.rotationLimits?.y?.max ?? 180,
        [`${boneName}_rot_z_min`]: preset.rotationLimits?.z?.min ?? -180,
        [`${boneName}_rot_z_max`]: preset.rotationLimits?.z?.max ?? 180,
    };
}

/**
 * Opens a dialog to edit IK constraints for a controller
 */
export function openIKConstraintEditor(controller: any, getIKChain: (controller: any) => any[]) {
    if (!controller.ik_target) return;

    const chain = getIKChain(controller);
    const constraintData = getIKConstraintData(controller);

    const presetOptions: Record<string, string> = { '': 'Custom' };
    for (const name of Object.keys(JOINT_PRESETS)) {
        presetOptions[name] = name;
    }

    const form: any = {};

    chain.forEach((bone, index) => {
        const boneName = bone.name;
        const boneConstraint = constraintData.boneConstraints?.[boneName] || {};

        form[`${boneName}_preset`] = {
            label: `${boneName} - Joint Preset`,
            type: 'select',
            options: presetOptions,
            value: detectPreset(boneConstraint)
        };
        form[`${boneName}_axis_x`] = {
            label: `${boneName} - Allow X Rotation`,
            type: 'checkbox',
            value: boneConstraint.allowedAxes?.x !== false
        };
        form[`${boneName}_axis_y`] = {
            label: `${boneName} - Allow Y Rotation`,
            type: 'checkbox',
            value: boneConstraint.allowedAxes?.y !== false
        };
        form[`${boneName}_axis_z`] = {
            label: `${boneName} - Allow Z Rotation`,
            type: 'checkbox',
            value: boneConstraint.allowedAxes?.z !== false
        };
        form[`${boneName}_rot_x_min`] = {
            label: `${boneName} - X Rotation Min (degrees)`,
            type: 'number',
            value: boneConstraint.rotationLimits?.x?.min ?? -180,
            step: 1
        };
        form[`${boneName}_rot_x_max`] = {
            label: `${boneName} - X Rotation Max (degrees)`,
            type: 'number',
            value: boneConstraint.rotationLimits?.x?.max ?? 180,
            step: 1
        };
        form[`${boneName}_rot_y_min`] = {
            label: `${boneName} - Y Rotation Min (degrees)`,
            type: 'number',
            value: boneConstraint.rotationLimits?.y?.min ?? -180,
            step: 1
        };
        form[`${boneName}_rot_y_max`] = {
            label: `${boneName} - Y Rotation Max (degrees)`,
            type: 'number',
            value: boneConstraint.rotationLimits?.y?.max ?? 180,
            step: 1
        };
        form[`${boneName}_rot_z_min`] = {
            label: `${boneName} - Z Rotation Min (degrees)`,
            type: 'number',
            value: boneConstraint.rotationLimits?.z?.min ?? -180,
            step: 1
        };
        form[`${boneName}_rot_z_max`] = {
            label: `${boneName} - Z Rotation Max (degrees)`,
            type: 'number',
            value: boneConstraint.rotationLimits?.z?.max ?? 180,
            step: 1
        };
    });

    // Track last preset selection per bone to detect actual preset changes
    const lastPreset: Record<string, string> = {};
    chain.forEach(bone => {
        lastPreset[bone.name] = detectPreset(constraintData.boneConstraints?.[bone.name] || {});
    });

    let visualizer: ConstraintVisualizer | null = null;

    const dialog = new Dialog('ik_constraint_editor', {
        title: `IK Constraints: ${controller.name}`,
        form,
        width: 500,
        onFormChange(formResult: any) {
            const updates: Record<string, any> = {};
            let presetChanged = false;

            chain.forEach(bone => {
                const boneName = bone.name;
                const presetName = formResult[`${boneName}_preset`];

                // Preset dropdown changed — apply preset values
                if (presetName !== lastPreset[boneName]) {
                    lastPreset[boneName] = presetName;
                    presetChanged = true;
                    const preset = JOINT_PRESETS[presetName];
                    if (preset) {
                        Object.assign(updates, getPresetFormValues(boneName, preset));
                    }
                }
            });

            // If no preset dropdown changed, check if manual edits
            // invalidate the current preset selection
            if (!presetChanged) {
                chain.forEach(bone => {
                    const boneName = bone.name;
                    const currentPreset = formResult[`${boneName}_preset`];
                    if (currentPreset) {
                        // Build a BoneConstraint from current form values to compare
                        const current: BoneConstraint = {
                            allowedAxes: {
                                x: formResult[`${boneName}_axis_x`] !== false,
                                y: formResult[`${boneName}_axis_y`] !== false,
                                z: formResult[`${boneName}_axis_z`] !== false,
                            },
                            rotationLimits: {
                                x: { min: formResult[`${boneName}_rot_x_min`], max: formResult[`${boneName}_rot_x_max`] },
                                y: { min: formResult[`${boneName}_rot_y_min`], max: formResult[`${boneName}_rot_y_max`] },
                                z: { min: formResult[`${boneName}_rot_z_min`], max: formResult[`${boneName}_rot_z_max`] },
                            }
                        };
                        const detected = detectPreset(current);
                        if (detected !== currentPreset) {
                            lastPreset[boneName] = '';
                            updates[`${boneName}_preset`] = '';
                        }
                    }
                });
            }

            if (Object.keys(updates).length > 0) {
                dialog.setFormValues(updates);
            }

            // Update visualizer with current form state
            if (visualizer) {
                const currentConstraints: Record<string, BoneConstraint> = {};
                const merged = { ...formResult, ...updates };
                chain.forEach(bone => {
                    const boneName = bone.name;
                    currentConstraints[boneName] = {
                        allowedAxes: {
                            x: merged[`${boneName}_axis_x`] !== false,
                            y: merged[`${boneName}_axis_y`] !== false,
                            z: merged[`${boneName}_axis_z`] !== false,
                        },
                        rotationLimits: {
                            x: { min: merged[`${boneName}_rot_x_min`], max: merged[`${boneName}_rot_x_max`] },
                            y: { min: merged[`${boneName}_rot_y_min`], max: merged[`${boneName}_rot_y_max`] },
                            z: { min: merged[`${boneName}_rot_z_min`], max: merged[`${boneName}_rot_z_max`] },
                        }
                    };
                });
                visualizer.update(currentConstraints);
            }
        },
        onConfirm: (formResult: any) => {
            try {
                const updatedConstraints: Record<string, BoneConstraint> = {};

                chain.forEach(bone => {
                    const boneName = bone.name;
                    const constraint: BoneConstraint = {};

                    constraint.allowedAxes = {
                        x: formResult[`${boneName}_axis_x`] !== false,
                        y: formResult[`${boneName}_axis_y`] !== false,
                        z: formResult[`${boneName}_axis_z`] !== false
                    };

                    const xMin = formResult[`${boneName}_rot_x_min`];
                    const xMax = formResult[`${boneName}_rot_x_max`];
                    const yMin = formResult[`${boneName}_rot_y_min`];
                    const yMax = formResult[`${boneName}_rot_y_max`];
                    const zMin = formResult[`${boneName}_rot_z_min`];
                    const zMax = formResult[`${boneName}_rot_z_max`];

                    constraint.rotationLimits = {};
                    if (xMin !== -180 || xMax !== 180) {
                        constraint.rotationLimits.x = { min: xMin, max: xMax };
                    }
                    if (yMin !== -180 || yMax !== 180) {
                        constraint.rotationLimits.y = { min: yMin, max: yMax };
                    }
                    if (zMin !== -180 || zMax !== 180) {
                        constraint.rotationLimits.z = { min: zMin, max: zMax };
                    }

                    if (!constraint.allowedAxes.x || !constraint.allowedAxes.y || !constraint.allowedAxes.z ||
                        constraint.rotationLimits.x || constraint.rotationLimits.y || constraint.rotationLimits.z) {
                        updatedConstraints[boneName] = constraint;
                    }
                });

                constraintData.boneConstraints = updatedConstraints;
                setIKConstraintData(controller, constraintData);

                Blockbench.showQuickMessage('IK constraints updated', 2000);
            } catch (e) {
                console.error('Error saving IK constraints:', e);
                Blockbench.showQuickMessage('Error saving IK constraints', 2000);
            }

            visualizer?.dispose();
            visualizer = null;
        },
        onCancel: () => {
            visualizer?.dispose();
            visualizer = null;
        }
    });
    dialog.show();

    // Create visualizer after dialog is shown so it appears in the viewport
    visualizer = new ConstraintVisualizer(chain, constraintData.boneConstraints || {});
}
