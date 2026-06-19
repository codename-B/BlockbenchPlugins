import * as util from "./util";
import { VS_Animation, VS_AnimationKey, VS_AnimationLibrary, VS_KeyFrameInterpolation, VS_Shape } from "./vs_shape_def";

/**
 * Imports animations from the Vintage Story format into Blockbench.
 * @param {Array<object>} animations The array of animation data from the VS model file.
 */
export function import_animations(animations: Array<VS_Animation>) {
    const FPS = util.fps;

    animations.forEach(vsAnimation => {
        const animationLength = vsAnimation.quantityframes / FPS;
        const isLooping = vsAnimation.onAnimationEnd === 'Repeat';

        const animation = ((new Animation({
            //@ts-expect-error: Blockbench overwrites libdom's Animation type with its own Animation Class, but TypeScript doesn't include a way to overwrite UMD global types.
            name: vsAnimation.name,
            loop: isLooping ? 'loop' : 'once',
            length: animationLength,
            snapping: FPS
        }) as unknown) as _Animation).add();

        // Preserve VS-specific animation properties for round-trip fidelity
        // @ts-expect-error: custom property for round-trip
        animation.vs_code = vsAnimation.code;
        // @ts-expect-error: custom property for round-trip
        animation.vs_onActivityStopped = vsAnimation.onActivityStopped;
        // @ts-expect-error: custom property for round-trip
        animation.vs_onAnimationEnd = vsAnimation.onAnimationEnd;

        vsAnimation.keyframes.forEach(vsKeyframe => {
            const time = vsKeyframe.frame / FPS;
            for (const boneName in vsKeyframe.elements) {
                const transform = vsKeyframe.elements[boneName];
                const bone = Group.all.find(g => g.name === boneName);

                if (bone) {
                    const animator = animation.getBoneAnimator(bone);

                    if (transform.rotationX != null || transform.rotationY != null || transform.rotationZ != null) {
                        const value = { x: transform.rotationX || 0, y: transform.rotationY || 0, z: transform.rotationZ || 0 };
                        animator.addKeyframe(buildBBKeyframeOptions(time, 'rotation', value, transform.rotationInterp,
                            transform.rotationTangentInX, transform.rotationTangentInY, transform.rotationTangentInZ,
                            transform.rotationTangentOutX, transform.rotationTangentOutY, transform.rotationTangentOutZ));
                    }

                    if (transform.offsetX != null || transform.offsetY != null || transform.offsetZ != null) {
                        const value = { x: transform.offsetX || 0, y: transform.offsetY || 0, z: transform.offsetZ || 0 };
                        animator.addKeyframe(buildBBKeyframeOptions(time, 'position', value, transform.positionInterp,
                            transform.offsetTangentInX, transform.offsetTangentInY, transform.offsetTangentInZ,
                            transform.offsetTangentOutX, transform.offsetTangentOutY, transform.offsetTangentOutZ));
                    }

                    if (transform.stretchX != null || transform.stretchY != null || transform.stretchZ != null) {
                        const value = { x: transform.stretchX ?? 1, y: transform.stretchY ?? 1, z: transform.stretchZ ?? 1 };
                        animator.addKeyframe(buildBBKeyframeOptions(time, 'scale', value, transform.scaleInterp,
                            transform.stretchTangentInX, transform.stretchTangentInY, transform.stretchTangentInZ,
                            transform.stretchTangentOutX, transform.stretchTangentOutY, transform.stretchTangentOutZ));
                    }
                }
            }
        });
    });
};

// Build keyframe options for Blockbench, restoring interpolation mode and bezier handles
// where present. Blockbench stores `bezier_right_value`/`bezier_left_value` as deltas
// added to the keyframe value (see Blockbench keyframe.js getBezierLerp), so the inverse
// of the export's `out = 3*delta`, `in = -3*delta` is `delta = out/3`, `delta = -in/3`.
function buildBBKeyframeOptions(
    time: number,
    channel: 'rotation' | 'position' | 'scale',
    value: { x: number, y: number, z: number },
    interp: VS_KeyFrameInterpolation | undefined,
    tInX: number | undefined, tInY: number | undefined, tInZ: number | undefined,
    tOutX: number | undefined, tOutY: number | undefined, tOutZ: number | undefined,
): KeyframeOptions {
    const bbInterp = mapInterpolation(interp);
    const opts: KeyframeOptions = {
        interpolation: bbInterp,
        time,
        channel,
        data_points: [{ x: value.x, y: value.y, z: value.z }],
    };

    if (bbInterp === 'bezier') {
        opts.bezier_right_value = [
            (tOutX ?? 0) / 3,
            (tOutY ?? 0) / 3,
            (tOutZ ?? 0) / 3,
        ];
        opts.bezier_left_value = [
            -(tInX ?? 0) / 3,
            -(tInY ?? 0) / 3,
            -(tInZ ?? 0) / 3,
        ];
    }

    return opts;
}

function mapInterpolation(interp: VS_KeyFrameInterpolation | undefined): 'linear' | 'bezier' | 'step' {
    if (interp === 'Bezier') return 'bezier';
    if (interp === 'Step') return 'step';
    return 'linear';
}

/**
 * Removes every animation from the current project. Returns the count removed.
 * Animations created in this call go onto the undo stack so the user can revert.
 */
export function clear_animations(): number {
    const all = (Animation as unknown as typeof _Animation).all.slice();
    all.forEach(a => a.remove(true));
    return all.length;
}

/**
 * Imports animations from either a full VS Shape JSON (which has `animations` at the root)
 * or a standalone VS_AnimationLibrary JSON (which also has `animations` at the root, plus
 * optional `code`/`name`). The structures overlap on the `animations` field, so we just
 * read that field. Existing project animations are left alone — callers can invoke
 * {@link clear_animations} first if a clean import is wanted.
 *
 * Returns the number of animations imported.
 */
export function import_animation_library(content: VS_AnimationLibrary | VS_Shape): number {
    const animations = content?.animations;
    if (!animations || animations.length === 0) return 0;
    import_animations(animations);
    return animations.length;
}
