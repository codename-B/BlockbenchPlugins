
import * as PACKAGE from "../../../package.json";
import { IKConstraintData, BoneConstraint } from "./types";

// Blockbench global types
declare var Group: any;
declare var Dialog: any;
declare var Blockbench: any;
declare var Project: any;

/**
 * Gets IK constraint data for a controller
 */
export function getIKConstraintData(controller: any): IKConstraintData {
    if (!controller.vsIKConstraints) {
        controller.vsIKConstraints = {
            weight: 1.0,
            lockPosition: false,
            boneConstraints: {}
        };
    }
    return controller.vsIKConstraints;
}

/**
 * Sets IK constraint data for a controller
 */
export function setIKConstraintData(controller: any, data: IKConstraintData): void {
    controller.vsIKConstraints = { ...getIKConstraintData(controller), ...data };
    
    if (Project) {
        Project.save();
    }
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
        if (!boneConstraint.allowedAxes.x) rx = 0;
        if (!boneConstraint.allowedAxes.y) ry = 0;
        if (!boneConstraint.allowedAxes.z) rz = 0;
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

    const helper = Group.all.find((g: any) => g.name === constraintData.orientationHelper && g.isNull);
    if (!helper) {
        return null;
    }
    
    return [helper.rotation[0] || 0, helper.rotation[1] || 0, helper.rotation[2] || 0];
}

/**
 * Opens a dialog to edit IK constraints for a controller
 */
export function openIKConstraintEditor(controller: any, getIKChain: (target: any) => any[]) {
    const target = controller.ikTarget;
    if (!target) return;

    const chain = getIKChain(target);
    const constraintData = getIKConstraintData(controller);
    
    const form: any = {};

    chain.forEach((bone, index) => {
        const boneName = bone.name;
        const boneConstraint = constraintData.boneConstraints?.[boneName] || {};
        
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

    new Dialog('ik_constraint_editor', {
        title: `IK Constraints: ${controller.name}`,
        form,
        width: 500,
        onConfirm: (formResult: any) => {
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
        }
    }).show();
}