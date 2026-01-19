
import * as PACKAGE from "../../../package.json";
import { getIKConstraintData, setIKConstraintData, openIKConstraintEditor } from "./constraints";
import { getIKChain } from "./chain_utils";
import { updatePinnedBones, togglePinBone } from "./interactive";

// Blockbench global types
declare var Property: any;
declare var Action: any;
declare var Group: any;
declare var Outliner: any;
declare var Locator: any;
declare var Format: any;
declare var Animation: any;
declare var Blockbench: any;
declare var MenuBar: any;

export function setupIKProperties(context: any): any {

    const weightProp = new Property(Group, "number", "vsIKWeight", {
        default: 1.0,
        label: "IK Weight",
        exposed: true,
        condition: () => {
            try {
                const selected = Outliner.selected;
                if (!selected || selected.length !== 1) return false;
                const obj = selected[0];
                
                const isNull = obj instanceof Group && (obj as any).isNull === true;
                const isLocator = obj instanceof Locator;
                return isNull || isLocator;
            } catch (e) {
                console.error('IK Weight condition error:', e);
                return false;
            }
        },
        inputs: {
            element_panel: {
                input: {
                    label: 'IK Weight (0-1)',
                    type: 'number',
                    min: 0,
                    max: 1,
                    step: 0.01
                }
            }
        },
        onChange() {
            const obj = this as any;
            if (obj && (obj.isNull || obj instanceof Locator)) {
                
                if (obj.vsIKWeight === undefined) {
                    const constraintData = getIKConstraintData(obj);
                    obj.vsIKWeight = constraintData.weight ?? 1.0;
                }
                
                const constraintData = getIKConstraintData(obj);
                constraintData.weight = Math.max(0, Math.min(1, obj.vsIKWeight ?? 1.0));
                setIKConstraintData(obj, constraintData);
                
                if (Format.animation_mode) {

                    const currentAnimation = Animation.selected;
                    if (currentAnimation) {
                        const animator = currentAnimation.getBoneAnimator(obj);
                        if (animator) {
                            const currentTime = currentAnimation.time;
                            const weight = Math.max(0, Math.min(1, obj.vsIKWeight ?? 1.0));
                            
                            const existingKf = animator.keyframes.find((kf: any) =>
                                kf.channel === 'ik_weight' && Math.abs(kf.time - currentTime) < 0.01
                            );

                            if (existingKf) {
                                
                                if (existingKf.data_points && existingKf.data_points[0]) {
                                    existingKf.data_points[0].x = weight;
                                }
                            } else {
                                
                                animator.addKeyframe({
                                    interpolation: 'linear',
                                    time: currentTime,
                                    channel: 'ik_weight',
                                    data_points: [{ x: weight, y: 0, z: 0 }]
                                });
                            }
                        }
                    }
                }
            }
        },
        keyframeable: true
    });

    const lockProp = new Property(Group, "boolean", "vsIKLockPosition", {
        default: false,
        label: "Lock IK Position",
        exposed: true,
        condition: () => {
            try {
                const selected = Outliner.selected;
                if (!selected || selected.length !== 1) return false;
                const obj = selected[0];
                
                const isNull = obj instanceof Group && (obj as any).isNull === true;
                const isLocator = obj instanceof Locator;
                return isNull || isLocator;
            } catch (e) {
                console.error('IK Lock Position condition error:', e);
                return false;
            }
        },
        inputs: {
            element_panel: {
                input: {
                    label: 'Lock Controller Position',
                    type: 'checkbox'
                }
            }
        },
        onChange() {
            const obj = this as any;
            if (obj && (obj.isNull || obj instanceof Locator)) {
                
                if (obj.vsIKLockPosition === undefined) {
                    const constraintData = getIKConstraintData(obj);
                    obj.vsIKLockPosition = constraintData.lockPosition ?? false;
                }
                
                const constraintData = getIKConstraintData(obj);
                constraintData.lockPosition = obj.vsIKLockPosition ?? false;
                if (constraintData.lockPosition) {
                    
                    constraintData.lockedPosition = [obj.origin[0], obj.origin[1], obj.origin[2]];
                }
                setIKConstraintData(obj, constraintData);
                
                if (Format.animation_mode) {

                    const currentAnimation = Animation.selected;
                    if (currentAnimation) {
                        const animator = currentAnimation.getBoneAnimator(obj);
                        if (animator) {
                            const currentTime = currentAnimation.time;
                            const lockValue = obj.vsIKLockPosition ? 1 : 0;
                            
                            const existingKf = animator.keyframes.find((kf: any) =>
                                kf.channel === 'ik_lock' && Math.abs(kf.time - currentTime) < 0.01
                            );

                            if (existingKf) {
                                
                                if (existingKf.data_points && existingKf.data_points[0]) {
                                    existingKf.data_points[0].x = lockValue;
                                }
                            } else {
                                
                                animator.addKeyframe({
                                    interpolation: 'linear',
                                    time: currentTime,
                                    channel: 'ik_lock',
                                    data_points: [{ x: lockValue, y: 0, z: 0 }]
                                });
                            }
                        }
                    }
                }
            }
        },
        keyframeable: true
    });

    const helperProp = new Property(Group, "string", "vsIKOrientationHelper", {
        default: '',
        label: "IK Orientation Helper",
        exposed: true,
        condition: () => {
            try {
                const selected = Outliner.selected;
                if (!selected || selected.length !== 1) return false;
                const obj = selected[0];
                
                const isNull = obj instanceof Group && (obj as any).isNull === true;
                const isLocator = obj instanceof Locator;
                return isNull || isLocator;
            } catch (e) {
                console.error('IK Orientation Helper condition error:', e);
                return false;
            }
        },
        options: () => {
            const nulls = Group.all.filter((g: any) => g.isNull);
            const options: { [key: string]: string } = { '': 'None' };
            nulls.forEach((nullObj: any) => {
                options[nullObj.name] = nullObj.name;
            });
            return options;
        },
        inputs: {
            element_panel: {
                input: {
                    label: 'Orientation Helper (Void Object)',
                    type: 'select',
                    options: () => {
                        const nulls = Group.all.filter((g: any) => g.isNull);
                        const options: { [key: string]: string } = { '': 'None' };
                        nulls.forEach((nullObj: any) => {
                            options[nullObj.name] = nullObj.name;
                        });
                        return options;
                    }
                }
            }
        },
        onChange() {
            const obj = this as any;
            if (obj && (obj.isNull || obj instanceof Locator)) {
                
                if (obj.vsIKOrientationHelper === undefined) {
                    const constraintData = getIKConstraintData(obj);
                    obj.vsIKOrientationHelper = constraintData.orientationHelper || '';
                }
                
                const constraintData = getIKConstraintData(obj);
                constraintData.orientationHelper = obj.vsIKOrientationHelper || undefined;
                setIKConstraintData(obj, constraintData);
            }
        }
    });

    try {
        new Property(Locator, "number", "vsIKWeight", {
            default: 1.0,
            label: "IK Weight",
            exposed: true,
            condition: () => {
                const selected = Outliner.selected;
                if (!selected || selected.length !== 1) return false;
                return selected[0] instanceof Locator;
            },
            inputs: {
                element_panel: {
                    input: {
                        label: 'IK Weight (0-1)',
                        type: 'number',
                        min: 0,
                        max: 1,
                        step: 0.01
                    }
                }
            },
            onChange() {
                const obj = this as any;
                if (obj instanceof Locator) {
                    const constraintData = getIKConstraintData(obj as any);
                    constraintData.weight = Math.max(0, Math.min(1, obj.vsIKWeight ?? 1.0));
                    setIKConstraintData(obj as any, constraintData);
                }
            }
        });
    } catch (e) {
        
    }

    try {
        new Property(Locator, "boolean", "vsIKLockPosition", {
            default: false,
            label: "Lock IK Position",
            exposed: true,
            condition: () => {
                const selected = Outliner.selected;
                if (!selected || selected.length !== 1) return false;
                return selected[0] instanceof Locator;
            },
            inputs: {
                element_panel: {
                    input: {
                        label: 'Lock Controller Position',
                        type: 'checkbox'
                    }
                }
            },
            onChange() {
                const obj = this as any;
                if (obj instanceof Locator) {
                    const constraintData = getIKConstraintData(obj as any);
                    constraintData.lockPosition = obj.vsIKLockPosition ?? false;
                    if (constraintData.lockPosition) {
                        constraintData.lockedPosition = [obj.origin[0], obj.origin[1], obj.origin[2]];
                    }
                    setIKConstraintData(obj as any, constraintData);
                }
            }
        });
    } catch (e) {
        
    }
    
    const editIKConstraintsAction = new Action(`${PACKAGE.name}:edit_ik_constraints`, {
        name: 'Edit IK Constraints...',
        icon: 'settings',
        condition: () => {
            try {
                const selected = Outliner.selected;
                if (!selected || selected.length !== 1) return false;
                const obj = selected[0];
                
                const isNull = obj instanceof Group && (obj as any).isNull === true;
                const isLocator = obj instanceof Locator;
                return isNull || isLocator;
            } catch (e) {
                console.error('Edit IK Constraints condition error:', e);
                return false;
            }
        },
        click: () => {
            const selected = Outliner.selected;
            if (!selected || selected.length !== 1) return;
            const controller = selected[0] as unknown as any;

            if ((!controller.isNull && !(controller instanceof Locator)) || !controller.ikTarget) return;

            openIKConstraintEditor(controller, getIKChain);
        }
    });
    
    MenuBar.addAction(editIKConstraintsAction, 'edit');
    
    const togglePinBoneAction = new Action(`${PACKAGE.name}:toggle_pin_bone`, {
        name: 'Toggle Pin Bone',
        icon: 'push_pin',
        condition: () => {
            const selected = Outliner.selected;
            if (!selected || selected.length !== 1) return false;
            const obj = selected[0];
            return obj instanceof Group && !obj.isNull;
        },
        click: () => {
            const selected = Outliner.selected;
            if (!selected || selected.length !== 1) return;
            const bone = selected[0] as unknown as any;
            if (bone.isNull) return;

            togglePinBone(bone);
        }
    });

    MenuBar.addAction(togglePinBoneAction, 'edit');

    new Property(Group, "boolean", "vsIKInteractiveMode", {
        default: false,
        label: "Interactive IK Mode",
        exposed: true,
        condition: () => {
            try {
                const selected = Outliner.selected;
                if (!selected || selected.length !== 1) return false;
                const obj = selected[0];
                
                const isNull = obj instanceof Group && (obj as any).isNull === true;
                const isLocator = obj instanceof Locator;
                return isNull || isLocator;
            } catch (e) {
                console.error('IK Interactive Mode condition error:', e);
                return false;
            }
        },
        inputs: {
            element_panel: {
                input: {
                    label: 'Enable Interactive IK (Drag limbs to auto-adjust joints)',
                    type: 'checkbox'
                }
            }
        },
        onChange() {
            const obj = this as any;
            if (obj && (obj.isNull || obj instanceof Locator)) {
                const constraintData = getIKConstraintData(obj);
                constraintData.interactiveMode = obj.vsIKInteractiveMode ?? false;
                setIKConstraintData(obj, constraintData);

                if (constraintData.interactiveMode) {
                    Blockbench.showQuickMessage(
                        'Interactive IK enabled: Drag bones in IK chains to auto-adjust connected joints. Use "Toggle Pin Bone" to pin joints.',
                        4000
                    );
                }
            }
        }
    });

    new Property(Group, "boolean", "vsIKPinned", {
        default: false,
        label: "IK Pinned",
        exposed: true,
        condition: () => {
            const selected = Outliner.selected;
            if (!selected || selected.length !== 1) return false;
            const obj = selected[0];
            return obj instanceof Group && !obj.isNull;
        },
        inputs: {
            element_panel: {
                input: {
                    label: 'Pin Bone (prevents IK from moving this bone)',
                    type: 'checkbox'
                }
            }
        },
        onChange() {
            const obj = this as any;
            if (obj && obj instanceof Group && !obj.isNull) {
                updatePinnedBones();
            }
        }
    });
    
    const syncIKProperties = () => {
        const selected = Outliner.selected;
        if (!selected || selected.length !== 1) return;
        const obj = selected[0];

        if ((obj instanceof Group || obj instanceof Locator) && (obj.isNull || obj instanceof Locator) && obj.ikTarget) {
            const constraintData = getIKConstraintData(obj);
            
            if (obj.vsIKWeight === undefined) {
                obj.vsIKWeight = constraintData.weight ?? 1.0;
            }
            if (obj.vsIKLockPosition === undefined) {
                obj.vsIKLockPosition = constraintData.lockPosition ?? false;
            }
            if (obj.vsIKOrientationHelper === undefined) {
                obj.vsIKOrientationHelper = constraintData.orientationHelper || '';
            }
        }
    };

    Blockbench.on('select', syncIKProperties);
    Blockbench.on('update_selection', syncIKProperties);

    return { editIKConstraintsAction, togglePinBoneAction };
}