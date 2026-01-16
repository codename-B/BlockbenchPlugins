import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";
import { is_vs_project } from "../util";
import { codecVS } from "../codec";
import { createPanel } from "../util/moddingTools";

// Blockbench global types
declare var Property: any;
declare var Action: any;
declare var Dialog: any;
declare var MenuBar: any;
declare var BarItems: any;

/**
 * IK Improvement Mod for VS Plugin
 * 
 * This mod addresses IK limitations for VS export and adds interactive IK features:
 * 1. Detects IK usage and warns users that VS doesn't support IK natively
 * 2. Bakes IK animations to keyframes on export (converts IK-driven motion to keyframe animation)
 * 3. Provides user feedback during the baking process
 * 4. Adds advanced IK constraint features:
 *    - Animatable IK weight/enable toggle
 *    - Lock IK end controller position during animation
 *    - Rotation constraints (axis limits and restrictions)
 *    - External void object helpers for orientation influence
 *    - Manual keyframe override support
 * 5. Interactive IK features for faster animation workflow:
 *    - Pin/unpin bones to lock them in place during IK solving
 *    - Interactive IK mode: When enabled, dragging bones in IK chains will
 *      automatically adjust connected joints (works with Blockbench's built-in IK)
 *    - Forward kinematics support: Pin end effectors (like feet) and move
 *      the root/torso, having intermediate joints auto-adjust
 * 
 * Usage for Interactive IK:
 * - Enable "Interactive IK Mode" on an IK controller
 * - Use "Toggle Pin Bone" action or checkbox to pin bones that should stay fixed
 * - Drag bones in the IK chain - connected joints will auto-adjust
 * - Example: Pin the hoof and thigh, then drag the knee to adjust leg position
 * - Example: Pin all feet, then move the torso - legs will auto-adjust to keep feet in place
 * 
 * Known Limitations:
 * - VS format does not support IK, so all IK must be converted to keyframes
 * - IK controller transform inheritance issues (when controllers aren't at dead center) are
 *   a Blockbench core issue that may require fixes in Blockbench itself
 * - The baking process samples IK at regular intervals, which may create many keyframes
 * - Complex IK setups may need manual refinement after baking
 * - Real-time IK solving uses CCD (Cyclic Coordinate Descent) algorithm which works well
 *   for 2-3 bone chains but may need more iterations for longer chains
 * - Bone length is calculated from child bones or chain relationships, which may not
 *   always match the visual bone length in Blockbench
 */

/**
 * IK Constraint Data Structure
 */
interface IKConstraintData {
    // Weight/enable (0-1, where 0 = disabled, 1 = fully enabled)
    weight?: number;
    // Lock controller position during animation
    lockPosition?: boolean;
    // Locked position (set when lockPosition is enabled)
    lockedPosition?: [number, number, number];
    // Rotation constraints per bone in chain
    boneConstraints?: Record<string, BoneConstraint>;
    // External orientation helper (void object name)
    orientationHelper?: string;
    // Interactive IK mode (for real-time dragging)
    interactiveMode?: boolean;
    // Pinned bones (bones that stay fixed during IK solving)
    pinnedBones?: string[];
}

/**
 * Bone rotation constraints
 */
interface BoneConstraint {
    // Allowed rotation axes (true = can rotate, false = locked)
    allowedAxes?: { x: boolean; y: boolean; z: boolean };
    // Rotation limits in degrees
    rotationLimits?: {
        x?: { min: number; max: number };
        y?: { min: number; max: number };
        z?: { min: number; max: number };
    };
}

createBlockbenchMod(
    `${PACKAGE.name}:ik_mod`,
    {
        // Store original methods we'll patch
        originalCompile: codecVS.compile.bind(codecVS),
    },
    context => {
        // Add IK constraint properties to Group (for IK controllers)
        //@ts-expect-error: Property may not be in types
        const weightProp = new Property(Group, "number", "vsIKWeight", {
            default: 1.0,
            label: "IK Weight",
            exposed: true,
            condition: () => {
                try {
                    const selected = Outliner.selected;
                    if (!selected || selected.length !== 1) return false;
                    const obj = selected[0];
                    // Check if it's a null object or locator
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
                    // Initialize property from constraint data if not set
                    if (obj.vsIKWeight === undefined) {
                        const constraintData = getIKConstraintData(obj);
                        obj.vsIKWeight = constraintData.weight ?? 1.0;
                    }
                    // Sync to constraint data
                    const constraintData = getIKConstraintData(obj);
                    constraintData.weight = Math.max(0, Math.min(1, obj.vsIKWeight ?? 1.0));
                    setIKConstraintData(obj, constraintData);
                    
                    // If in animation mode, create/update keyframe for weight
                    if (Format.animation_mode) {
                        //@ts-expect-error: Animation type
                        const currentAnimation = Animation.selected;
                        if (currentAnimation) {
                            const animator = currentAnimation.getBoneAnimator(obj);
                            if (animator) {
                                const currentTime = currentAnimation.time;
                                const weight = Math.max(0, Math.min(1, obj.vsIKWeight ?? 1.0));
                                
                                // Check if keyframe already exists at this time
                                const existingKf = animator.keyframes.find((kf: any) => 
                                    kf.channel === 'ik_weight' && Math.abs(kf.time - currentTime) < 0.01
                                );
                                
                                if (existingKf) {
                                    // Update existing keyframe
                                    if (existingKf.data_points && existingKf.data_points[0]) {
                                        existingKf.data_points[0].x = weight;
                                    }
                                } else {
                                    // Add new keyframe
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
        //@ts-expect-error: Property may not be in types
        const lockProp = new Property(Group, "boolean", "vsIKLockPosition", {
            default: false,
            label: "Lock IK Position",
            exposed: true,
            condition: () => {
                try {
                    const selected = Outliner.selected;
                    if (!selected || selected.length !== 1) return false;
                    const obj = selected[0];
                    // Check if it's a null object or locator
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
                    // Initialize property from constraint data if not set
                    if (obj.vsIKLockPosition === undefined) {
                        const constraintData = getIKConstraintData(obj);
                        obj.vsIKLockPosition = constraintData.lockPosition ?? false;
                    }
                    // Sync to constraint data
                    const constraintData = getIKConstraintData(obj);
                    constraintData.lockPosition = obj.vsIKLockPosition ?? false;
                    if (constraintData.lockPosition) {
                        // Store current position as locked position
                        constraintData.lockedPosition = [obj.origin[0], obj.origin[1], obj.origin[2]];
                    }
                    setIKConstraintData(obj, constraintData);
                    
                    // If in animation mode, create/update keyframe for lock state
                    if (Format.animation_mode) {
                        //@ts-expect-error: Animation type
                        const currentAnimation = Animation.selected;
                        if (currentAnimation) {
                            const animator = currentAnimation.getBoneAnimator(obj);
                            if (animator) {
                                const currentTime = currentAnimation.time;
                                const lockValue = obj.vsIKLockPosition ? 1 : 0;
                                
                                // Check if keyframe already exists at this time
                                const existingKf = animator.keyframes.find((kf: any) => 
                                    kf.channel === 'ik_lock' && Math.abs(kf.time - currentTime) < 0.01
                                );
                                
                                if (existingKf) {
                                    // Update existing keyframe
                                    if (existingKf.data_points && existingKf.data_points[0]) {
                                        existingKf.data_points[0].x = lockValue;
                                    }
                                } else {
                                    // Add new keyframe
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
        //@ts-expect-error: Property may not be in types
        const helperProp = new Property(Group, "string", "vsIKOrientationHelper", {
            default: '',
            label: "IK Orientation Helper",
            exposed: true,
            condition: () => {
                try {
                    const selected = Outliner.selected;
                    if (!selected || selected.length !== 1) return false;
                    const obj = selected[0];
                    // Check if it's a null object or locator
                    const isNull = obj instanceof Group && (obj as any).isNull === true;
                    const isLocator = obj instanceof Locator;
                    return isNull || isLocator;
                } catch (e) {
                    console.error('IK Orientation Helper condition error:', e);
                    return false;
                }
            },
            options: () => {
                const nulls = Group.all.filter(g => g.isNull);
                const options: {[key: string]: string} = { '': 'None' };
                nulls.forEach(nullObj => {
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
                            const nulls = Group.all.filter(g => g.isNull);
                            const options: {[key: string]: string} = { '': 'None' };
                            nulls.forEach(nullObj => {
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
                    // Initialize property from constraint data if not set
                    if (obj.vsIKOrientationHelper === undefined) {
                        const constraintData = getIKConstraintData(obj);
                        obj.vsIKOrientationHelper = constraintData.orientationHelper || '';
                    }
                    // Sync to constraint data
                    const constraintData = getIKConstraintData(obj);
                    constraintData.orientationHelper = obj.vsIKOrientationHelper || undefined;
                    setIKConstraintData(obj, constraintData);
                }
            }
        });
        // Also create properties on Locator type (in case they're separate)
        //@ts-expect-error: Property may not be in types
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
            // Locator properties might not be needed
        }

        //@ts-expect-error: Property may not be in types
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
            // Locator properties might not be needed
        }

        // Add action to open IK constraint editor
        const editIKConstraintsAction = new Action(`${PACKAGE.name}:edit_ik_constraints`, {
            name: 'Edit IK Constraints...',
            icon: 'settings',
            condition: () => {
                try {
                    const selected = Outliner.selected;
                    if (!selected || selected.length !== 1) return false;
                    const obj = selected[0];
                    // Check if it's a null object or locator
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
                const controller = selected[0] as Group | Locator;
                //@ts-expect-error: IK properties
                if ((!controller.isNull && !(controller instanceof Locator)) || !controller.ikTarget) return;
                
                openIKConstraintEditor(controller as Group);
            }
        });

        // Add action to context menu
        MenuBar.addAction(editIKConstraintsAction, 'edit');

        // Add pin/unpin action for bones
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
                const bone = selected[0] as Group;
                if (bone.isNull) return;
                
                togglePinBone(bone);
            }
        });

        MenuBar.addAction(togglePinBoneAction, 'edit');

        // Add property for interactive IK mode on controllers
        //@ts-expect-error: Property may not be in types
        new Property(Group, "boolean", "vsIKInteractiveMode", {
            default: false,
            label: "Interactive IK Mode",
            exposed: true,
            condition: () => {
                try {
                    const selected = Outliner.selected;
                    if (!selected || selected.length !== 1) return false;
                    const obj = selected[0];
                    // Check if it's a null object or locator
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

        // Add property to show if a bone is pinned
        //@ts-expect-error: Property may not be in types
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

        // Sync property values from constraint data when selection changes
        const syncIKProperties = () => {
            const selected = Outliner.selected;
            if (!selected || selected.length !== 1) return;
            const obj = selected[0];
            //@ts-expect-error: IK properties
            //@ts-expect-error: IK properties
            if ((obj instanceof Group || obj instanceof Locator) && (obj.isNull || obj instanceof Locator) && obj.ikTarget) {
                const constraintData = getIKConstraintData(obj as Group);
                // Sync property values from constraint data
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

        // Initialize interactive IK system
        setupInteractiveIK();
        
        // Initialize pinned bones on project load
        Blockbench.on('load_project', () => {
            setTimeout(updatePinnedBones, 100);
        });

        // Hook into codec compile to bake IK animations before export
        codecVS.compile = function(options: any) {
            if (is_vs_project(Project)) {
                // Check if any IK controllers exist
                const hasIK = checkForIKControllers();
                if (hasIK) {
                    // Warn user that IK will be baked to keyframes
                    const shouldBake = Blockbench.showMessageBox({
                        title: 'IK Animation Detected',
                        message: 
                            'Your model uses Inverse Kinematics (IK) controllers.\n\n' +
                            'Vintage Story does not support IK natively. IK animations will be ' +
                            'automatically converted to keyframe animations during export.\n\n' +
                            'This may result in a large number of keyframes. Continue?',
                        buttons: ['Bake IK to Keyframes', 'Cancel Export']
                    });
                    
                    if (shouldBake === 0) {
                        // Bake IK to keyframes
                        bakeIKAnimations();
                    } else {
                        // User cancelled
                        throw new Error('Export cancelled: IK animations need to be baked to keyframes');
                    }
                }
            }
            return context.originalCompile(options);
        };

        return { ...context, editIKConstraintsAction, togglePinBoneAction };
    },
    context => {
        // Restore original compile method
        codecVS.compile = context.originalCompile;
        // Remove actions
        if (context.editIKConstraintsAction) {
            context.editIKConstraintsAction.delete();
        }
        if (context.togglePinBoneAction) {
            context.togglePinBoneAction.delete();
        }
    }
);

/**
 * Bakes IK animations to keyframes for VS export
 * Since VS doesn't support IK natively, we need to convert IK-driven animations
 * to regular keyframe animations by sampling the IK-driven bone transforms
 */
function bakeIKAnimations() {
    if (!Project || !is_vs_project(Project)) return;

    const ikControllers = findAllIKControllers();
    if (ikControllers.length === 0) return;

    //@ts-expect-error: Animation type
    const animations = (Animation as unknown as typeof _Animation).all;
    const fps = 20; // VS default FPS
    
    let totalBakedKeyframes = 0;
    
    // For each animation, bake IK-driven bones
    animations.forEach(animation => {
        // Get all bones that are part of IK chains
        const ikBones = new Set<Group>();
        ikControllers.forEach(({ chain }) => {
            chain.forEach(bone => ikBones.add(bone));
        });

        if (ikBones.size === 0) return;

        // Sample animation at regular intervals
        const frameCount = Math.ceil(animation.length * fps);
        const sampleInterval = 1 / fps; // Sample every frame
        
        // Store original animation state
        const originalTime = animation.time;
        const originalSelected = animation.selected;
        const wasPlaying = Animator.playing;
        
        // Stop animation if playing
        if (wasPlaying) {
            Animator.pause();
        }
        
        // Select animation to ensure it's active
        animation.select();
        
        // Enable animation mode if not already
        const wasInAnimationMode = Format.animation_mode;
        if (!wasInAnimationMode) {
            Format.animation_mode = true;
        }
        
        // Process each IK controller to handle locked positions
        // Note: Lock position is now animatable, so we'll check it per frame
        
        // Sample each frame
        for (let frame = 0; frame <= frameCount; frame++) {
            const time = Math.min(frame * sampleInterval, animation.length);
            
            // Set animation time
            animation.time = time;
            
            // Apply locked positions for controllers (check animatable lock state)
            ikControllers.forEach(({ controller }) => {
                const constraintData = getIKConstraintData(controller);
                const isLocked = getIKLockAtTime(controller, animation, time);
                
                if (isLocked && constraintData.lockedPosition) {
                    // Use stored locked position
                    controller.origin[0] = constraintData.lockedPosition[0];
                    controller.origin[1] = constraintData.lockedPosition[1];
                    controller.origin[2] = constraintData.lockedPosition[2];
                } else if (isLocked && !constraintData.lockedPosition) {
                    // Lock was just enabled, store current position
                    const pos = controller.origin;
                    constraintData.lockedPosition = [pos[0], pos[1], pos[2]];
                    setIKConstraintData(controller, constraintData);
                }
            });
            
            // Force animation update
            //@ts-expect-error: Animation update
            if (Animator.update) {
                //@ts-expect-error: Animation update
                Animator.update();
            }
            
            // Update viewport to ensure IK is calculated
            Blockbench.updateViewport();
            
            // Small delay to ensure IK solver has time to calculate
            // (This is a workaround - in a real implementation we'd want a proper callback)
            
            // For each IK controller, process its chain
            ikControllers.forEach(({ controller, chain }) => {
                const constraintData = getIKConstraintData(controller);
                const weight = getIKWeightAtTime(controller, animation, time);
                
                // Skip if IK is disabled (weight = 0)
                if (weight <= 0) {
                    return;
                }
                
                // Process each bone in the chain
                chain.forEach(bone => {
                    const animator = animation.getBoneAnimator(bone);
                    if (!animator) return;
                    
                    // Get the bone's current transforms after IK is applied
                    const ikRotation: [number, number, number] = [
                        bone.rotation[0] || 0,
                        bone.rotation[1] || 0,
                        bone.rotation[2] || 0
                    ];
                    
                    // Apply constraints and blend with manual keyframes
                    const finalRotation = blendIKWithManual(bone, ikRotation, animation, time, constraintData, weight);
                    
                    // Apply weight to final rotation (blend with original if weight < 1)
                    // Get original rotation from keyframes (if any) or bone's base rotation
                    let originalRotation: [number, number, number] = [0, 0, 0];
                    if (animator.interpolate) {
                        try {
                            const interp = animator.interpolate('rotation');
                            originalRotation = [interp[0] || 0, interp[1] || 0, interp[2] || 0];
                        } catch (e) {
                            // If interpolation fails, use bone's base rotation
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
                    
                    // Calculate position offset relative to parent
                    const parentOrigin = bone.parent ? bone.parent.origin : [0, 0, 0];
                    const offset = [
                        origin[0] - parentOrigin[0],
                        origin[1] - parentOrigin[1],
                        origin[2] - parentOrigin[2]
                    ];
                    
                    // Check if keyframe already exists at this time (within tolerance)
                    const existingKf = animator.keyframes.find((kf: any) => 
                        Math.abs(kf.time - time) < sampleInterval / 4
                    );
                    
                    if (!existingKf) {
                        // Always add rotation keyframe
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
                        
                        // Add position keyframe if offset is non-zero (VS uses offsetX/Y/Z)
                        // Use a small threshold to avoid unnecessary keyframes for tiny movements
                        if (Math.abs(offset[0]) > 0.001 || Math.abs(offset[1]) > 0.001 || Math.abs(offset[2]) > 0.001) {
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
                        // Update existing keyframe if it's close enough
                        // This ensures we capture IK-driven changes even if there was a pre-existing keyframe
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
        
        // Restore original state
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

/**
 * Finds all IK controllers and their target bones
 */
function findAllIKControllers(): Array<{ controller: Group; target: Group | Locator; chain: Group[] }> {
    const ikControllers: Array<{ controller: Group; target: Group | Locator; chain: Group[] }> = [];
    
    //@ts-expect-error: IK properties may not be in types
    const nulls = Group.all.filter(g => g.isNull);
    
    for (const nullObj of nulls) {
        //@ts-expect-error: IK properties
        if (nullObj.ikTarget) {
            //@ts-expect-error: IK properties
            const target = nullObj.ikTarget;
            const chain = getIKChain(target);
            ikControllers.push({
                controller: nullObj,
                target,
                chain
            });
        }
    }
    
    return ikControllers;
}

/**
 * Gets the IK chain starting from a target bone
 * Includes all parent bones up to the root, so the shoulder should be included if it's a parent
 */
function getIKChain(target: Group | Locator): Group[] {
    const chain: Group[] = [];
    
    if (target instanceof Group) {
        // Walk up the parent chain to find all bones in the IK chain
        let current: any = target;
        while (current && current instanceof Group) {
            // Only include actual bones (not null objects/locators) in the chain
            // But include the target itself even if it's a locator
            if (current === target || !current.isNull) {
                chain.unshift(current);
            }
            current = current.parent;
        }
    }
    
    return chain;
}


/**
 * Checks if the project has any IK controllers (Null objects with IK targets)
 */
function checkForIKControllers(): boolean {
    if (!Project) return false;
    
    //@ts-expect-error: IK properties may not be in types
    const nulls = Group.all.filter(g => g.isNull);
    
    for (const nullObj of nulls) {
        //@ts-expect-error: IK properties
        if (nullObj.ikTarget) {
            return true;
        }
    }
    
    return false;
}

/**
 * Gets IK constraint data for a controller
 */
function getIKConstraintData(controller: Group): IKConstraintData {
    //@ts-expect-error: Custom property
    if (!controller.vsIKConstraints) {
        //@ts-expect-error: Custom property
        controller.vsIKConstraints = {
            weight: 1.0,
            lockPosition: false,
            boneConstraints: {}
        };
    }
    //@ts-expect-error: Custom property
    return controller.vsIKConstraints;
}

/**
 * Sets IK constraint data for a controller
 */
function setIKConstraintData(controller: Group, data: IKConstraintData): void {
    //@ts-expect-error: Custom property
    controller.vsIKConstraints = { ...getIKConstraintData(controller), ...data };
    // Mark project as modified
    if (Project) {
        Project.save();
    }
}

/**
 * Gets animatable IK weight for a controller at a specific time
 * Returns the weight value (0-1) considering animation keyframes
 */
function getIKWeightAtTime(controller: Group, animation: any, time: number): number {
    const constraintData = getIKConstraintData(controller);
    const baseWeight = constraintData.weight ?? 1.0;
    
    // Check for animatable weight keyframes
    try {
        const animator = animation.getBoneAnimator(controller);
        if (animator) {
            // Find weight keyframes
            const weightKeyframes = animator.keyframes.filter((kf: any) => 
                kf.channel === 'ik_weight'
            );
            
            if (weightKeyframes.length > 0) {
                // Sort by time
                weightKeyframes.sort((a: any, b: any) => a.time - b.time);
                
                // Find surrounding keyframes
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
                
                // Interpolate between keyframes
                if (beforeKf && afterKf) {
                    // Linear interpolation
                    const t = (time - beforeKf.time) / (afterKf.time - beforeKf.time);
                    const beforeWeight = beforeKf.data_points?.[0]?.x ?? baseWeight;
                    const afterWeight = afterKf.data_points?.[0]?.x ?? baseWeight;
                    return Math.max(0, Math.min(1, beforeWeight + (afterWeight - beforeWeight) * t));
                } else if (beforeKf) {
                    // Use last keyframe value
                    return Math.max(0, Math.min(1, beforeKf.data_points?.[0]?.x ?? baseWeight));
                } else if (afterKf) {
                    // Use first keyframe value
                    return Math.max(0, Math.min(1, afterKf.data_points?.[0]?.x ?? baseWeight));
                }
            }
        }
    } catch (e) {
        // If animator doesn't exist or error occurs, fall back to base weight
        console.warn('Error getting animatable IK weight:', e);
    }
    
    return baseWeight;
}

/**
 * Gets animatable IK lock state for a controller at a specific time
 * Returns true if the controller position should be locked
 */
function getIKLockAtTime(controller: Group, animation: any, time: number): boolean {
    const constraintData = getIKConstraintData(controller);
    const baseLock = constraintData.lockPosition ?? false;
    
    // Check for animatable lock keyframes
    try {
        const animator = animation.getBoneAnimator(controller);
        if (animator) {
            // Find lock keyframes
            const lockKeyframes = animator.keyframes.filter((kf: any) => 
                kf.channel === 'ik_lock'
            );
            
            if (lockKeyframes.length > 0) {
                // Sort by time
                lockKeyframes.sort((a: any, b: any) => a.time - b.time);
                
                // Find surrounding keyframes
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
                
                // Interpolate between keyframes (threshold at 0.5)
                if (beforeKf && afterKf) {
                    // Linear interpolation
                    const t = (time - beforeKf.time) / (afterKf.time - beforeKf.time);
                    const beforeLock = (beforeKf.data_points?.[0]?.x ?? (baseLock ? 1 : 0)) > 0.5;
                    const afterLock = (afterKf.data_points?.[0]?.x ?? (baseLock ? 1 : 0)) > 0.5;
                    const interpolated = beforeLock ? (1 - t) : t;
                    return interpolated > 0.5;
                } else if (beforeKf) {
                    // Use last keyframe value
                    return (beforeKf.data_points?.[0]?.x ?? (baseLock ? 1 : 0)) > 0.5;
                } else if (afterKf) {
                    // Use first keyframe value
                    return (afterKf.data_points?.[0]?.x ?? (baseLock ? 1 : 0)) > 0.5;
                }
            }
        }
    } catch (e) {
        // If animator doesn't exist or error occurs, fall back to base lock state
        console.warn('Error getting animatable IK lock state:', e);
    }
    
    return baseLock;
}

/**
 * Applies rotation constraints to a bone rotation
 */
function applyRotationConstraints(bone: Group, rotation: [number, number, number], constraintData: IKConstraintData): [number, number, number] {
    const boneName = bone.name;
    const boneConstraint = constraintData.boneConstraints?.[boneName];
    
    if (!boneConstraint) {
        return rotation;
    }
    
    let [rx, ry, rz] = rotation;
    
    // Apply axis restrictions
    if (boneConstraint.allowedAxes) {
        if (!boneConstraint.allowedAxes.x) rx = 0;
        if (!boneConstraint.allowedAxes.y) ry = 0;
        if (!boneConstraint.allowedAxes.z) rz = 0;
    }
    
    // Apply rotation limits
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
function getOrientationInfluence(constraintData: IKConstraintData): [number, number, number] | null {
    if (!constraintData.orientationHelper) {
        return null;
    }
    
    const helper = Group.all.find(g => g.name === constraintData.orientationHelper && g.isNull);
    if (!helper) {
        return null;
    }
    
    // Return helper's rotation as influence
    return [helper.rotation[0] || 0, helper.rotation[1] || 0, helper.rotation[2] || 0];
}

/**
 * Blends IK-driven rotation with manual keyframes and constraints
 */
function blendIKWithManual(
    bone: Group,
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
    
    // Check for manual rotation keyframes at this time
    const rotationKeyframes = animator.keyframes.filter((kf: any) => 
        kf.channel === 'rotation' && Math.abs(kf.time - time) < 0.01
    );
    
    if (rotationKeyframes.length > 0) {
        // Manual keyframe exists - blend with IK based on weight
        const manualRot = rotationKeyframes[0].data_points[0];
        const manualRotation: [number, number, number] = [
            manualRot.x || 0,
            manualRot.y || 0,
            manualRot.z || 0
        ];
        
        // Blend: manual * (1 - weight) + ik * weight
        const blended: [number, number, number] = [
            manualRotation[0] * (1 - weight) + ikRotation[0] * weight,
            manualRotation[1] * (1 - weight) + ikRotation[1] * weight,
            manualRotation[2] * (1 - weight) + ikRotation[2] * weight
        ];
        
        return applyRotationConstraints(bone, blended, constraintData);
    }
    
    // Apply orientation influence from helper
    const orientationInfluence = getOrientationInfluence(constraintData);
    if (orientationInfluence) {
        // Blend IK rotation with orientation helper (50/50 blend)
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
 * Opens a dialog to edit IK constraints for a controller
 */
function openIKConstraintEditor(controller: Group) {
    //@ts-expect-error: IK properties
    const target = controller.ikTarget;
    if (!target) return;
    
    const chain = getIKChain(target);
    const constraintData = getIKConstraintData(controller);
    
    // Build form for bone constraints
    const form: any = {};
    
    chain.forEach((bone, index) => {
        const boneName = bone.name;
        const boneConstraint = constraintData.boneConstraints?.[boneName] || {};
        
        // Allowed axes
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
        
        // Rotation limits
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
                
                // Parse allowed axes
                constraint.allowedAxes = {
                    x: formResult[`${boneName}_axis_x`] !== false,
                    y: formResult[`${boneName}_axis_y`] !== false,
                    z: formResult[`${boneName}_axis_z`] !== false
                };
                
                // Parse rotation limits
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
                
                // Only add constraint if it has meaningful restrictions
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

/**
 * Toggles pin state for a bone
 */
function togglePinBone(bone: Group): void {
    //@ts-expect-error: Custom property
    bone.vsIKPinned = !bone.vsIKPinned;
    updatePinnedBones();
    
    Blockbench.showQuickMessage(
        `${bone.name} ${bone.vsIKPinned ? 'pinned' : 'unpinned'}`,
        2000
    );
}

/**
 * Updates pinned bones list in all IK controllers
 */
function updatePinnedBones(): void {
    const pinnedBones = Group.all
        .filter(g => !g.isNull && (g as any).vsIKPinned)
        .map(g => g.name);
    
    // Update all IK controllers with pinned bones list
    const ikControllers = findAllIKControllers();
    ikControllers.forEach(({ controller }) => {
        const constraintData = getIKConstraintData(controller);
        constraintData.pinnedBones = pinnedBones;
        setIKConstraintData(controller, constraintData);
    });
}

/**
 * Gets the world position of a bone (accounting for parent transforms)
 */
function getBoneWorldPosition(bone: Group): [number, number, number] {
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
function getBoneEndWorldPosition(bone: Group): [number, number, number] {
    const start = getBoneWorldPosition(bone);
    
    // If bone has children, use first child's position as end
    if (bone.children && bone.children.length > 0) {
        const firstChild = bone.children[0];
        if (firstChild instanceof Group) {
            return getBoneWorldPosition(firstChild);
        }
    }
    
    // If no children, check if this bone is part of a chain
    // and use the next bone in the chain as the end point
    const ikControllers = findAllIKControllers();
    for (const { chain } of ikControllers) {
        const boneIndex = chain.indexOf(bone);
        if (boneIndex >= 0 && boneIndex < chain.length - 1) {
            const nextBone = chain[boneIndex + 1];
            return getBoneWorldPosition(nextBone);
        }
    }
    
    // Fallback: assume bone extends 1 unit in Y direction
    // This is a simplification for bones without clear children
    return [start[0], start[1] + 1, start[2]];
}

/**
 * Gets the length of a bone (distance to its end)
 */
function getBoneLength(bone: Group): number {
    const start = getBoneWorldPosition(bone);
    const end = getBoneEndWorldPosition(bone);
    return vec3Length(vec3Sub(end, start));
}

/**
 * Calculates the maximum reachable distance of an IK chain
 * This is the sum of all bone lengths in the chain
 */
function getChainMaxReach(chain: Group[]): number {
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
 * Clamps a target position to be within the IK chain's reach
 * Returns the clamped position
 */
function clampTargetToChainReach(
    chain: Group[],
    targetPosition: [number, number, number],
    maxReach: number
): [number, number, number] {
    const root = chain[0];
    const rootPos = getBoneWorldPosition(root);
    const toTarget = vec3Sub(targetPosition, rootPos);
    const distance = vec3Length(toTarget);
    
    // If target is within reach, return as-is
    if (distance <= maxReach) {
        return targetPosition;
    }
    
    // Clamp to maximum reach
    const clampedDirection = vec3Normalize(toTarget);
    const clampedDistance = maxReach * 0.95; // Use 95% to leave some margin
    const clampedTarget = vec3Add(rootPos, [
        clampedDirection[0] * clampedDistance,
        clampedDirection[1] * clampedDistance,
        clampedDirection[2] * clampedDistance
    ]);
    
    return clampedTarget;
}

/**
 * Vector math utilities
 */
function vec3Sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vec3Add(a: [number, number, number], b: [number, number, number]): [number, number, number] {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vec3Length(v: [number, number, number]): number {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function vec3Normalize(v: [number, number, number]): [number, number, number] {
    const len = vec3Length(v);
    if (len < 0.0001) return [0, 0, 0];
    return [v[0] / len, v[1] / len, v[2] / len];
}

function vec3Dot(a: [number, number, number], b: [number, number, number]): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vec3Cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

/**
 * Convert Euler angles (degrees) to rotation matrix
 */
function eulerToRotationMatrix(euler: [number, number, number]): number[][] {
    const [rx, ry, rz] = euler.map(deg => deg * Math.PI / 180);
    
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    
    return [
        [cy * cz, -cy * sz, sy],
        [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
        [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy]
    ];
}

/**
 * Apply rotation to a vector
 */
function rotateVector(v: [number, number, number], euler: [number, number, number]): [number, number, number] {
    const m = eulerToRotationMatrix(euler);
    return [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
    ];
}

/**
 * Calculate rotation needed to align one vector to another
 * Returns Euler angles in degrees
 */
function alignVectors(from: [number, number, number], to: [number, number, number]): [number, number, number] {
    const fromNorm = vec3Normalize(from);
    const toNorm = vec3Normalize(to);
    
    const dot = vec3Dot(fromNorm, toNorm);
    
    // If vectors are already aligned
    if (Math.abs(dot - 1) < 0.0001) {
        return [0, 0, 0];
    }
    
    // If vectors are opposite
    if (Math.abs(dot + 1) < 0.0001) {
        // Find perpendicular axis
        const perp = Math.abs(fromNorm[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const axis = vec3Normalize(vec3Cross(fromNorm, perp));
        const angle = Math.PI;
        // Convert axis-angle to Euler (simplified - assumes rotation around Y)
        return [0, angle * 180 / Math.PI, 0];
    }
    
    // Calculate rotation axis and angle
    const axis = vec3Normalize(vec3Cross(fromNorm, toNorm));
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    
    // Convert axis-angle to Euler angles (simplified approximation)
    // For better results, would use proper quaternion conversion
    const angleDeg = angle * 180 / Math.PI;
    
    // Approximate Euler angles based on axis
    // This is a simplification - proper implementation would use quaternions
    if (Math.abs(axis[1]) > 0.9) {
        // Rotation primarily around Y axis
        return [0, angleDeg * (axis[1] > 0 ? 1 : -1), 0];
    } else if (Math.abs(axis[0]) > 0.9) {
        // Rotation primarily around X axis
        return [angleDeg * (axis[0] > 0 ? 1 : -1), 0, 0];
    } else {
        // Rotation primarily around Z axis
        return [0, 0, angleDeg * (axis[2] > 0 ? 1 : -1)];
    }
}

/**
 * CCD (Cyclic Coordinate Descent) IK solver
 * Solves IK chain to reach target position, respecting pinned bones and constraints
 */
function solveIKChain(
    chain: Group[],
    targetPosition: [number, number, number],
    pinnedBones: Set<string>,
    constraintData: IKConstraintData,
    maxIterations: number = 15,
    tolerance: number = 0.1
): boolean {
    if (chain.length < 2) return false;
    
    const endEffector = chain[chain.length - 1];
    const root = chain[0];
    
    // Don't solve if end effector or root is pinned
    if (pinnedBones.has(endEffector.name) || pinnedBones.has(root.name)) {
        return false;
    }
    
    // Store original rotations to restore if solving fails
    const originalRotations = chain.map(bone => [
        bone.rotation[0] || 0,
        bone.rotation[1] || 0,
        bone.rotation[2] || 0
    ] as [number, number, number]);
    
    // CCD solver: iterate from end effector towards root
    for (let iter = 0; iter < maxIterations; iter++) {
        // Get current end effector position
        const currentEndPos = getBoneEndWorldPosition(endEffector);
        
        // Check if we're close enough
        const distance = vec3Length(vec3Sub(targetPosition, currentEndPos));
        if (distance < tolerance) {
            return true; // Successfully reached target
        }
        
        // Work backwards from end effector to root
        // This should include the shoulder if it's in the chain
        for (let i = chain.length - 2; i >= 0; i--) {
            const bone = chain[i];
            if (pinnedBones.has(bone.name)) {
                continue;
            }
            
            const boneWorldPos = getBoneWorldPosition(bone);
            const currentEndEffectorPos = getBoneEndWorldPosition(endEffector);
            
            // Vector from bone to current end effector position
            const toEnd = vec3Sub(currentEndEffectorPos, boneWorldPos);
            const toEndLen = vec3Length(toEnd);
            
            // Vector from bone to target
            const toTarget = vec3Sub(targetPosition, boneWorldPos);
            const toTargetLen = vec3Length(toTarget);
            
            // Skip if vectors are too short
            if (toEndLen < 0.001 || toTargetLen < 0.001) {
                continue;
            }
            
            // Calculate rotation needed to align toEnd with toTarget
            // Use a damping factor to make solving smoother
            const damping = 0.5; // Adjust this to control solving speed (0-1)
            const rotationDelta = alignVectors(toEnd, toTarget);
            
            // Apply rotation to bone (additive with damping)
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
            
            // Apply constraints
            newRot = applyRotationConstraints(bone, newRot, constraintData);
            
            // Update bone rotation
            bone.rotation[0] = newRot[0];
            bone.rotation[1] = newRot[1];
            bone.rotation[2] = newRot[2];
            
            // Update viewport to reflect changes
            Blockbench.updateViewport();
        }
    }
    
    // If we didn't converge, check final distance
    const finalEndPos = getBoneEndWorldPosition(endEffector);
    const finalDistance = vec3Length(vec3Sub(targetPosition, finalEndPos));
    
    return finalDistance < tolerance * 2; // Allow slightly larger tolerance
}

/**
 * Interactive IK drag state tracking
 */
interface DragState {
    isActive: boolean;
    draggedBone: Group | null;
    originalBoneState: Map<string, { position: [number, number, number]; rotation: [number, number, number] }>;
    ikChain: Group[] | null;
    controller: Group | null;
    constraintData: IKConstraintData | null;
    startPosition: [number, number, number] | null;
}

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
 * Hook into bone dragging for interactive IK
 * Implements real-time IK solving when dragging bones in IK chains
 */
function setupInteractiveIK(): void {
    let lastSelectedBone: Group | null = null;
    let transformCount = 0;
    
    // Track when selection changes to detect drag start
    Blockbench.on('select', () => {
        // Work in both edit and animation mode
        const selected = Outliner.selected;
        if (!selected || selected.length !== 1) return;
        
        const bone = selected[0];
        if (!(bone instanceof Group) || bone.isNull) return;
        
        // Check if this bone is part of an IK chain
        // Always enable interactive IK for any IK chain to keep bones connected
        const ikControllers = findAllIKControllers();
        for (const { controller, chain } of ikControllers) {
            const constraintData = getIKConstraintData(controller);
            // Always enable - don't require interactiveMode flag
            
            if (chain.includes(bone)) {
                const pinnedBones = new Set(constraintData.pinnedBones || []);
                
                // Don't allow dragging pinned bones
                if (pinnedBones.has(bone.name)) {
                    Blockbench.showQuickMessage(
                        `Cannot drag pinned bone: ${bone.name}`,
                        2000
                    );
                    return;
                }
                
                // Initialize drag state if not already active
                if (!dragState.isActive || dragState.draggedBone !== bone) {
                    dragState.isActive = true;
                    dragState.draggedBone = bone;
                    dragState.ikChain = chain;
                    dragState.controller = controller;
                    dragState.constraintData = constraintData;
                    dragState.startPosition = getBoneWorldPosition(bone);
                    dragState.originalBoneState.clear();
                    transformCount = 0;
                    
                    // Store original state of all bones in chain
                    chain.forEach(chainBone => {
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
                
                lastSelectedBone = bone;
                break;
            }
        }
    });
    
    // Track drag updates and solve IK
    Blockbench.on('transform_selection', () => {
        // Work in both edit and animation mode
        const selected = Outliner.selected;
        if (!selected || selected.length !== 1) return;
        
        const bone = selected[0];
        if (!(bone instanceof Group) || bone.isNull) return;
        
        // Check if this bone is part of an IK chain
        // Always enable interactive IK to keep chains connected
        if (!dragState.isActive || dragState.draggedBone !== bone) {
            // Try to initialize if not already active
            const ikControllers = findAllIKControllers();
            for (const { controller, chain } of ikControllers) {
                const constraintData = getIKConstraintData(controller);
                // Always enable - keep all IK chains constrained
                
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
                    
                    chain.forEach(chainBone => {
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
        
        // Get current target position (where the bone is being dragged to)
        let targetPosition = getBoneWorldPosition(bone);
        
        // If this is the end effector, clamp target to chain's maximum reach
        const endEffectorIndex = chain.length - 1;
        if (chain[endEffectorIndex] === bone) {
            // Calculate maximum reach of the chain
            const maxReach = getChainMaxReach(chain);
            const rootPos = getBoneWorldPosition(chain[0]);
            const distance = vec3Length(vec3Sub(targetPosition, rootPos));
            
            // If dragged beyond reach, clamp it
            if (distance > maxReach) {
                const clampedTarget = clampTargetToChainReach(chain, targetPosition, maxReach);
                
                // Move the bone back to the clamped position
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
            
            // Solve IK to reach target position (now clamped to reach)
            solveIKChain(chain, targetPosition, pinnedBones, constraintData);
        } else {
            // Bone is in the middle of the chain
            // Find the bone's index in the chain
            const boneIndex = chain.indexOf(bone);
            if (boneIndex === -1) return;
            
            // Get the sub-chain from this bone to the end
            const subChain = chain.slice(boneIndex);
            const endEffector = subChain[subChain.length - 1];
            
            // Clamp the dragged bone's position to maintain chain connectivity
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
            
            // Solve IK for the sub-chain
            solveIKChain(subChain, endEffectorTarget, pinnedBones, constraintData);
        }
        
        // Update viewport (throttled to avoid performance issues)
        if (transformCount % 2 === 0) {
            Blockbench.updateViewport();
        }
    });
    
    // Track drag end
    Blockbench.on('finish_edit', () => {
        if (dragState.isActive && dragState.ikChain && dragState.draggedBone) {
            // If in animation mode, create keyframes for the solved positions
            if (Format.animation_mode) {
                //@ts-expect-error: Animation type
                const currentAnimation = Animation.selected;
                if (currentAnimation) {
                    const currentTime = currentAnimation.time;
                    
                    dragState.ikChain.forEach(bone => {
                        const animator = currentAnimation.getBoneAnimator(bone);
                        if (!animator) return;
                        
                        // Check if keyframe already exists at this time
                        const existingKf = animator.keyframes.find((kf: any) => 
                            kf.channel === 'rotation' && Math.abs(kf.time - currentTime) < 0.01
                        );
                        
                        if (!existingKf) {
                            // Add keyframe for the solved rotation
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
                            // Update existing keyframe
                            if (existingKf.data_points && existingKf.data_points[0]) {
                                existingKf.data_points[0].x = bone.rotation[0] || 0;
                                existingKf.data_points[0].y = bone.rotation[1] || 0;
                                existingKf.data_points[0].z = bone.rotation[2] || 0;
                            }
                        }
                    });
                }
            }
            
            // Reset drag state
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
    
    // Also reset on selection change if not dragging
    Blockbench.on('update_selection', () => {
        if (!dragState.isActive) {
            lastSelectedBone = null;
        }
    });
}
