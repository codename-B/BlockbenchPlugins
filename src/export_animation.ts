import { VS_Animation, VS_Keyframe } from "./vs_shape_def";
import * as util from "./util";
import { is_backdrop_project } from "./util/misc";

/**
 * Exports Blockbench animations to the Vintage Story animation format.
 * @returns An array of VS animations.
 */
export function export_animations(): Array<VS_Animation> {
    const animations: Array<VS_Animation> = [];

    // Don't export any animations if project contains backdrops
    if(is_backdrop_project()) {
        return [];
    }

    // Track animations with non-linear interpolations for warning
    const animationsWithNonLinearInterpolation: string[] = [];

    (Animation as unknown as typeof _Animation).all.forEach(animation => {
        const keyframes: Record<number,VS_Keyframe> = {};
        const fps = util.fps;
        const baseFrameCount = get_base_frame_quantity(animation);
        const animators = Object.values(animation.animators || {});
        let hasNonLinearInterpolation = false;

        animators.forEach(animator => {
            if (animator.type === 'bone' && animator.keyframes && animator.keyframes.length > 0) {
                // Skip NullObject animators (IK controllers) — they don't exist as VS elements
                if (typeof NullObject !== 'undefined' && NullObject.all?.some((n: any) => n.uuid === animator.uuid)) {
                    return;
                }
                const bone_name = animator.name;

                animator.keyframes.forEach(kf => {
                    // Check if keyframe uses non-linear interpolation
                    // VS only supports linear interpolation, so warn if other types are used
                    if (kf.interpolation && kf.interpolation !== 'linear') {
                        hasNonLinearInterpolation = true;
                    }

                    const frame = Math.round(kf.time * fps);
                    keyframes[frame] = keyframes[frame] || { frame, elements: {} };
                    keyframes[frame].elements[bone_name] = keyframes[frame].elements[bone_name] || {};

                    const dataPoint = kf.data_points[0];
                    switch (kf.channel) {
                        case 'rotation':
                            const rot = [dataPoint.x, dataPoint.y, dataPoint.z];
                            keyframes[frame].elements[bone_name].rotationX = Number(rot[0]);
                            keyframes[frame].elements[bone_name].rotationY = Number(rot[1]);
                            keyframes[frame].elements[bone_name].rotationZ = Number(rot[2]);
                            break;
                        case 'position':
                            keyframes[frame].elements[bone_name].offsetX = Number(dataPoint.x);
                            keyframes[frame].elements[bone_name].offsetY = Number(dataPoint.y);
                            keyframes[frame].elements[bone_name].offsetZ = Number(dataPoint.z);
                            break;
                        case 'scale':
                            if (dataPoint.x !== 1) keyframes[frame].elements[bone_name].stretchX = Number(dataPoint.x);
                            if (dataPoint.y !== 1) keyframes[frame].elements[bone_name].stretchY = Number(dataPoint.y);
                            if (dataPoint.z !== 1) keyframes[frame].elements[bone_name].stretchZ = Number(dataPoint.z);
                            break;
                    }
                });
            }

            // Process effect animators for texture swap keyframes
            if (animator.type === 'effect' && animator.keyframes && animator.keyframes.length > 0) {
                animator.keyframes.forEach(kf => {
                    if (kf.channel === 'timeline') {
                        const script = kf.data_points[0]?.script;
                        if (script) {
                            const textures = parseTextureSwapScript(script);
                            if (textures) {
                                const frame = Math.round(kf.time * fps);
                                keyframes[frame] = keyframes[frame] || { frame, elements: {} };
                                keyframes[frame].textures = textures;
                            }
                        }
                    }
                });
            }
        });

        normalize_terminal_keyframe(keyframes, baseFrameCount);

        // Wraps all animation elements into oneLiner wrappers (after all animators are processed)
        for(const keyframe of Object.values(keyframes)) {
            const wrapped_elements = {};
            for (const [element, content] of Object.entries(keyframe.elements)) {
                wrapped_elements[element] = new oneLiner(content);
            }
            keyframe.elements = wrapped_elements;
        }

        // Use preserved VS values if available, otherwise compute defaults
        // @ts-expect-error: custom property from import
        const storedCode = animation.vs_code;
        // @ts-expect-error: custom property from import
        const storedOnActivityStopped = animation.vs_onActivityStopped;
        // @ts-expect-error: custom property from import
        const storedOnAnimationEnd = animation.vs_onAnimationEnd;

        const vsAnimation : VS_Animation = {
            name: animation.name,
            code: storedCode || animation.name.toLowerCase().replace(/ /g, ''),
            quantityframes: get_frame_quantity(animation, keyframes),
            onActivityStopped: storedOnActivityStopped || "EaseOut",
            onAnimationEnd: storedOnAnimationEnd || (animation.loop === 'loop' ? "Repeat" : "Hold"),
            keyframes: Object.values(keyframes).sort((a, b) => a.frame - b.frame)
        };
        
        if (vsAnimation.quantityframes === 0 && vsAnimation.keyframes.length > 0) {
            const frame0 = vsAnimation.keyframes.find(kf => kf.frame === 0);
            if (frame0) {
                const frame1 = JSON.parse(JSON.stringify(frame0));
                frame1.frame = 1;
                vsAnimation.keyframes.push(frame1);
                vsAnimation.quantityframes = 1;
            }
        }

        // For looping animations, insert a virtual end frame copying frame 0
        // so VS can interpolate back to the start. QuantityFrames is a frame count,
        // so the last valid frame is quantityframes - 1.
        if (vsAnimation.onAnimationEnd === "Repeat" && vsAnimation.quantityframes > 0) {
            const lastFrame = vsAnimation.quantityframes - 1;
            const hasLastFrame = vsAnimation.keyframes.some(kf => kf.frame === lastFrame);
            if (!hasLastFrame) {
                const frame0 = vsAnimation.keyframes.find(kf => kf.frame === 0);
                if (frame0) {
                    const virtualFrame = JSON.parse(JSON.stringify(frame0));
                    virtualFrame.frame = lastFrame;
                    vsAnimation.keyframes.push(virtualFrame);
                    vsAnimation.keyframes.sort((a, b) => a.frame - b.frame);
                }
            }
        }

        if (vsAnimation.keyframes.length > 0) {
            animations.push(vsAnimation);
            if (hasNonLinearInterpolation) {
                animationsWithNonLinearInterpolation.push(animation.name);
            }
        }
    });

    // Warn user if any animations use non-linear interpolations
    if (animationsWithNonLinearInterpolation.length > 0) {
        display_interpolation_warning(animationsWithNonLinearInterpolation);
    }

    return animations;
}

/**
 * Returns the length of an animation in frames so it is compatible with VS. Displays a warning to the user if necessary.
 * @param animation The BB animation object.
 * @param keyframes Keyframes
 */
function get_frame_quantity(animation: _Animation, keyframes: Record<number,VS_Keyframe>): number {
    // VS uses QuantityFrames as a frame count.
    // A 60-frame animation should export with QuantityFrames = 60 and a last valid frame of 59.
    const quantityframes = get_base_frame_quantity(animation);
    const keyframe_frames = Object.keys(keyframes).map(kf => parseInt(kf));
    if (keyframe_frames.length === 0) {
        return quantityframes;
    }
    const max_keyframe = Math.max(...keyframe_frames);
    if (max_keyframe >= quantityframes) {
        display_animation_length_warning(animation.name);
        return max_keyframe + 1;
    }
    return quantityframes;
}

function get_base_frame_quantity(animation: _Animation): number {
    return Math.max(1, Math.round(animation.length * util.fps));
}

function normalize_terminal_keyframe(
    keyframes: Record<number,VS_Keyframe>,
    quantityframes: number
) {
    const terminalFrame = quantityframes;
    const lastExportableFrame = quantityframes - 1;
    const terminalKeyframe = keyframes[terminalFrame];

    if (!terminalKeyframe) {
        return;
    }

    const previousKeyframe = keyframes[lastExportableFrame];
    if (previousKeyframe) {
        if (keyframe_contents_match(previousKeyframe, terminalKeyframe)) {
            delete keyframes[terminalFrame];
            return;
        }
        return;
    }

    const shiftedKeyframe = clone_keyframe(terminalKeyframe);
    shiftedKeyframe.frame = lastExportableFrame;
    keyframes[lastExportableFrame] = shiftedKeyframe;
    delete keyframes[terminalFrame];
}

function keyframe_contents_match(a: VS_Keyframe, b: VS_Keyframe): boolean {
    return stable_keyframe_content(a) === stable_keyframe_content(b);
}

function stable_keyframe_content(keyframe: VS_Keyframe): string {
    return JSON.stringify({
        elements: sort_nested_object(keyframe.elements),
        textures: keyframe.textures ? sort_nested_object(keyframe.textures) : undefined
    });
}

function sort_nested_object(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sort_nested_object);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, nestedValue]) => [key, sort_nested_object(nestedValue)])
        );
    }
    return value;
}

function clone_keyframe(keyframe: VS_Keyframe): VS_Keyframe {
    return JSON.parse(JSON.stringify(keyframe)) as VS_Keyframe;
}

/**
 * Parses a Blockbench effect timeline script for texture swap data.
 * Expected format: "textures": { "slot": "path", ... }
 * Returns a Record<string, string> mapping texture codes to asset paths, or null if not a texture swap.
 */
function parseTextureSwapScript(script: string): Record<string, string> | null {
    try {
        // The script content is a JSON fragment like: "textures": { "mouth": "entity/mouth/*_smile" }
        // Wrap in braces to make it valid JSON
        const trimmed = script.trim();
        const json = JSON.parse('{' + trimmed + '}');
        if (json.textures && typeof json.textures === 'object') {
            return json.textures;
        }
    } catch {
        // Not valid JSON texture swap data, ignore
    }
    return null;
}

function display_animation_length_warning(animation_name: string) {
    Blockbench.showMessageBox({
        title: 'Animation Length Warning',
        message: 
            `The animation "${animation_name}" has keyframes on or past the last frame. ` +
            `This may not animate correctly in Vintage Story. ` +
            `Consider moving the keyframes away from the last frame if you experience issues.`
    });
}

function display_interpolation_warning(animation_names: string[]) {
    const animationList = animation_names.length === 1 
        ? `"${animation_names[0]}"` 
        : animation_names.map(name => `"${name}"`).join(', ');
    
    Blockbench.showMessageBox({
        title: 'Interpolation Warning',
        message: 
            `The following animation(s) use non-linear interpolation: ${animationList}\n\n` +
            `Vintage Story only supports linear interpolation between keyframes. ` +
            `All keyframes will be exported with linear interpolation, which may change ` +
            `the animation's appearance. Consider adding more keyframes to approximate ` +
            `the desired easing curves, or use linear interpolation in Blockbench.`
    });
}
