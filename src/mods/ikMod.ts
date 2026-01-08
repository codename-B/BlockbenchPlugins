import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";
import { is_vs_project } from "../util";
import { codecVS } from "../codec";

/**
 * IK Improvement Mod for VS Plugin
 * 
 * This mod addresses IK limitations for VS export:
 * 1. Detects IK usage and warns users that VS doesn't support IK natively
 * 2. Bakes IK animations to keyframes on export (converts IK-driven motion to keyframe animation)
 * 3. Provides user feedback during the baking process
 * 
 * Known Limitations:
 * - VS format does not support IK, so all IK must be converted to keyframes
 * - IK controller transform inheritance issues (when controllers aren't at dead center) are
 *   a Blockbench core issue that may require fixes in Blockbench itself
 * - The baking process samples IK at regular intervals, which may create many keyframes
 * - Complex IK setups may need manual refinement after baking
 * 
 * Future Improvements:
 * - Add IK settings panel with baking options (sample rate, which controllers to bake)
 * - Improve transform inheritance fixes for IK controllers
 * - Add IK constraint visualization/feedback
 */

createBlockbenchMod(
    `${PACKAGE.name}:ik_mod`,
    {
        // Store original methods we'll patch
        originalCompile: codecVS.compile.bind(codecVS),
    },
    context => {
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

        return context;
    },
    context => {
        // Restore original compile method
        codecVS.compile = context.originalCompile;
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
        
        // Sample each frame
        for (let frame = 0; frame <= frameCount; frame++) {
            const time = Math.min(frame * sampleInterval, animation.length);
            
            // Set animation time
            animation.time = time;
            
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
            
            // For each bone in IK chains, sample and add keyframes
            ikBones.forEach(bone => {
                const animator = animation.getBoneAnimator(bone);
                if (!animator) return;
                
                // Get the bone's current transforms after IK is applied
                // The bone's rotation and origin should reflect IK calculations
                const rotation = bone.rotation;
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
                    // Even if rotation appears zero, IK might have modified it
                    animator.addKeyframe({
                        interpolation: 'linear',
                        time,
                        channel: 'rotation',
                        data_points: [{ 
                            x: rotation[0] || 0, 
                            y: rotation[1] || 0, 
                            z: rotation[2] || 0 
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
                        kf.data_points[0].x = rotation[0] || 0;
                        kf.data_points[0].y = rotation[1] || 0;
                        kf.data_points[0].z = rotation[2] || 0;
                    } else if (kf.channel === 'position' && kf.data_points && kf.data_points[0]) {
                        kf.data_points[0].x = offset[0];
                        kf.data_points[0].y = offset[1];
                        kf.data_points[0].z = offset[2];
                    }
                }
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
 */
function getIKChain(target: Group | Locator): Group[] {
    const chain: Group[] = [];
    
    if (target instanceof Group) {
        // Walk up the parent chain to find all bones in the IK chain
        let current: any = target;
        while (current && current instanceof Group) {
            chain.unshift(current);
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
