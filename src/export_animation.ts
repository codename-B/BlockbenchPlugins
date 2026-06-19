import { VS_Animation, VS_AnimationKey, VS_AnimationLibrary, VS_Keyframe, VS_KeyFrameInterpolation } from "./vs_shape_def";
import * as util from "./util";
import { is_backdrop_project } from "./util/misc";

type BBChannel = 'position' | 'rotation' | 'scale';

// Maps a Blockbench keyframe interpolation mode to the engine's mode. Linear is
// returned as null (the default; field omitted from JSON). Catmullrom converts to
// Bezier with computed Hermite tangents (see computeCatmullRomTangents) so smooth
// curves are preserved on export — the engine has no native Catmull-Rom mode but
// the conversion is exact for uniform spacing and a good approximation otherwise.
function mapInterpolation(bbMode: string | undefined): { mode: VS_KeyFrameInterpolation | null, isCatmull: boolean } {
    if (!bbMode || bbMode === 'linear') return { mode: null, isCatmull: false };
    if (bbMode === 'bezier') return { mode: 'Bezier', isCatmull: false };
    if (bbMode === 'step') return { mode: 'Step', isCatmull: false };
    if (bbMode === 'catmullrom') return { mode: 'Bezier', isCatmull: true };
    return { mode: null, isCatmull: false };
}

// Cubic Bezier handle (value-delta) -> cubic Hermite tangent at the segment's near end.
// Blockbench stores `bezier_right_value`/`bezier_left_value` as deltas added to the
// keyframe value when constructing the control point — see
// https://github.com/JannisX11/blockbench/blob/master/js/animations/keyframe.js (getBezierLerp).
// Equating cubic Bezier B'(0) = 3*(P1-P0) with cubic Hermite's start-tangent gives
// `tangent = 3 * delta` at the outgoing end; at the incoming end the same identity
// applied to B'(1) = 3*(P3-P2) yields `tangent = -3 * delta`. Approximate when the
// handle's time offset deviates from the canonical 1/3 spacing: tangent direction is
// preserved but time skew on the handle is not. Adequate for default-shaped handles.
function outTangentFromDelta(delta: number): number {
    return 3 * delta;
}
function inTangentFromDelta(delta: number): number {
    return -3 * delta;
}

// Computes a Catmull-Rom keyframe's Hermite tangent in value-per-segment-t units for both
// segment sides (out into the next segment, in from the prev segment). The instantaneous
// slope at frame_i is `(P_{i+1} - P_{i-1}) / (frame_{i+1} - frame_{i-1})` — the symmetric
// finite difference. Scaling that slope by each adjacent segment's frame duration gives
// the per-segment-t tangent the engine expects.
//
// Boundary cases (no prev, no next, single keyframe) fall back to one-sided differences
// so the converted Bezier still has a sensible slope at endpoints.
function computeCatmullRomTangents(
    channelKfs: _Keyframe[],
    idx: number,
    axis: 'x' | 'y' | 'z',
    fps: number,
): { out: number, in: number } {
    const cur = channelKfs[idx];
    const prev = idx > 0 ? channelKfs[idx - 1] : null;
    const next = idx < channelKfs.length - 1 ? channelKfs[idx + 1] : null;

    const curFrame = Math.round(cur.time * fps);
    const curVal = Number(cur.data_points[0][axis]);

    let slopePerFrame = 0;
    if (prev && next) {
        const prevFrame = Math.round(prev.time * fps);
        const nextFrame = Math.round(next.time * fps);
        const span = nextFrame - prevFrame;
        if (span > 0) {
            slopePerFrame = (Number(next.data_points[0][axis]) - Number(prev.data_points[0][axis])) / span;
        }
    } else if (next) {
        const nextFrame = Math.round(next.time * fps);
        const span = nextFrame - curFrame;
        if (span > 0) slopePerFrame = (Number(next.data_points[0][axis]) - curVal) / span;
    } else if (prev) {
        const prevFrame = Math.round(prev.time * fps);
        const span = curFrame - prevFrame;
        if (span > 0) slopePerFrame = (curVal - Number(prev.data_points[0][axis])) / span;
    }

    const outDur = next ? Math.max(0, Math.round(next.time * fps) - curFrame) : 0;
    const inDur = prev ? Math.max(0, curFrame - Math.round(prev.time * fps)) : 0;
    return { out: slopePerFrame * outDur, in: slopePerFrame * inDur };
}

function applyCatmullRomToKey(
    elem: VS_AnimationKey,
    channel: BBChannel,
    channelKfs: _Keyframe[],
    idx: number,
    fps: number,
) {
    const fields = CHANNEL_FIELDS[channel];
    (elem as any)[fields.interp] = 'Bezier';

    const tx = computeCatmullRomTangents(channelKfs, idx, 'x', fps);
    const ty = computeCatmullRomTangents(channelKfs, idx, 'y', fps);
    const tz = computeCatmullRomTangents(channelKfs, idx, 'z', fps);
    if (tx.out !== 0) (elem as any)[fields.tangentOutX] = tx.out;
    if (ty.out !== 0) (elem as any)[fields.tangentOutY] = ty.out;
    if (tz.out !== 0) (elem as any)[fields.tangentOutZ] = tz.out;
    if (tx.in !== 0) (elem as any)[fields.tangentInX] = tx.in;
    if (ty.in !== 0) (elem as any)[fields.tangentInY] = ty.in;
    if (tz.in !== 0) (elem as any)[fields.tangentInZ] = tz.in;
}

interface ChannelFieldNames {
    interp: keyof VS_AnimationKey;
    tangentInX: keyof VS_AnimationKey; tangentInY: keyof VS_AnimationKey; tangentInZ: keyof VS_AnimationKey;
    tangentOutX: keyof VS_AnimationKey; tangentOutY: keyof VS_AnimationKey; tangentOutZ: keyof VS_AnimationKey;
}

const CHANNEL_FIELDS: Record<BBChannel, ChannelFieldNames> = {
    position: {
        interp: 'positionInterp',
        tangentInX: 'offsetTangentInX', tangentInY: 'offsetTangentInY', tangentInZ: 'offsetTangentInZ',
        tangentOutX: 'offsetTangentOutX', tangentOutY: 'offsetTangentOutY', tangentOutZ: 'offsetTangentOutZ',
    },
    rotation: {
        interp: 'rotationInterp',
        tangentInX: 'rotationTangentInX', tangentInY: 'rotationTangentInY', tangentInZ: 'rotationTangentInZ',
        tangentOutX: 'rotationTangentOutX', tangentOutY: 'rotationTangentOutY', tangentOutZ: 'rotationTangentOutZ',
    },
    scale: {
        interp: 'scaleInterp',
        tangentInX: 'stretchTangentInX', tangentInY: 'stretchTangentInY', tangentInZ: 'stretchTangentInZ',
        tangentOutX: 'stretchTangentOutX', tangentOutY: 'stretchTangentOutY', tangentOutZ: 'stretchTangentOutZ',
    },
};

function applyInterpolationToKey(elem: VS_AnimationKey, channel: BBChannel, kf: _Keyframe, _value: { x: number, y: number, z: number }, interp: VS_KeyFrameInterpolation) {
    const fields = CHANNEL_FIELDS[channel];
    (elem as any)[fields.interp] = interp;

    if (interp !== 'Bezier') return;

    const right = kf.bezier_right_value;
    if (right) {
        const tx = outTangentFromDelta(Number(right[0]));
        const ty = outTangentFromDelta(Number(right[1]));
        const tz = outTangentFromDelta(Number(right[2]));
        if (tx !== 0) (elem as any)[fields.tangentOutX] = tx;
        if (ty !== 0) (elem as any)[fields.tangentOutY] = ty;
        if (tz !== 0) (elem as any)[fields.tangentOutZ] = tz;
    }

    const left = kf.bezier_left_value;
    if (left) {
        const tx = inTangentFromDelta(Number(left[0]));
        const ty = inTangentFromDelta(Number(left[1]));
        const tz = inTangentFromDelta(Number(left[2]));
        if (tx !== 0) (elem as any)[fields.tangentInX] = tx;
        if (ty !== 0) (elem as any)[fields.tangentInY] = ty;
        if (tz !== 0) (elem as any)[fields.tangentInZ] = tz;
    }
}

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

    // Track animations whose catmull-rom keyframes got converted to bezier, so we can
    // surface a single informational popup at the end of the export.
    const animationsWithCatmullConversion: string[] = [];

    (Animation as unknown as typeof _Animation).all.forEach(animation => {
        const keyframes: Record<number,VS_Keyframe> = {};
        const fps = util.fps;
        const baseFrameCount = get_base_frame_quantity(animation);
        const animators = Object.values(animation.animators || {});
        let hadCatmullConversion = false;

        animators.forEach(animator => {
            if (animator.type === 'bone' && animator.keyframes && animator.keyframes.length > 0) {
                // Skip NullObject animators (IK controllers) — they don't exist as VS elements
                if (typeof NullObject !== 'undefined' && NullObject.all?.some((n: any) => n.uuid === animator.uuid)) {
                    return;
                }
                const bone_name = animator.name;

                // Catmull-Rom -> Bezier conversion needs the prev/next keyframes in the SAME
                // channel (matching the engine's per-channel keyframe walk). Pre-sort once.
                const byChannel: Record<BBChannel, _Keyframe[]> = { position: [], rotation: [], scale: [] };
                animator.keyframes.forEach(kf => {
                    if (kf.channel === 'position' || kf.channel === 'rotation' || kf.channel === 'scale') {
                        byChannel[kf.channel].push(kf);
                    }
                });
                (Object.keys(byChannel) as BBChannel[]).forEach(ch => byChannel[ch].sort((a, b) => a.time - b.time));

                animator.keyframes.forEach(kf => {
                    const { mode: vsInterp, isCatmull } = mapInterpolation(kf.interpolation);
                    if (isCatmull) hadCatmullConversion = true;

                    const frame = Math.round(kf.time * fps);
                    keyframes[frame] = keyframes[frame] || { frame, elements: {} };
                    keyframes[frame].elements[bone_name] = keyframes[frame].elements[bone_name] || {};
                    const elem = keyframes[frame].elements[bone_name];

                    const dataPoint = kf.data_points[0];
                    const value = { x: Number(dataPoint.x), y: Number(dataPoint.y), z: Number(dataPoint.z) };
                    const channel = kf.channel as BBChannel;
                    const channelKfs = channel in byChannel ? byChannel[channel] : null;

                    const applyInterp = () => {
                        if (!vsInterp) return;
                        if (isCatmull && channelKfs) {
                            applyCatmullRomToKey(elem, channel, channelKfs, channelKfs.indexOf(kf), fps);
                        } else {
                            applyInterpolationToKey(elem, channel, kf, value, vsInterp);
                        }
                    };

                    switch (kf.channel) {
                        case 'rotation':
                            elem.rotationX = value.x;
                            elem.rotationY = value.y;
                            elem.rotationZ = value.z;
                            applyInterp();
                            break;
                        case 'position':
                            elem.offsetX = value.x;
                            elem.offsetY = value.y;
                            elem.offsetZ = value.z;
                            applyInterp();
                            break;
                        case 'scale':
                            if (value.x !== 1) elem.stretchX = value.x;
                            if (value.y !== 1) elem.stretchY = value.y;
                            if (value.z !== 1) elem.stretchZ = value.z;
                            applyInterp();
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
            if (hadCatmullConversion) animationsWithCatmullConversion.push(animation.name);
        }
    });

    if (animationsWithCatmullConversion.length > 0) {
        display_catmull_conversion_notice(animationsWithCatmullConversion);
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

/**
 * Wraps {@link export_animations} output in a VS_AnimationLibrary structure suitable for
 * writing to a standalone animation library JSON file (the format consumed by the engine's
 * `Shape.AnimationLibraries` references).
 */
export function export_animation_library(code?: string, name?: string): VS_AnimationLibrary {
    const library: VS_AnimationLibrary = { animations: export_animations() };
    if (code) library.code = code;
    if (name) library.name = name;
    return library;
}

function display_catmull_conversion_notice(animation_names: string[]) {
    const animationList = animation_names.length === 1
        ? `"${animation_names[0]}"`
        : animation_names.map(name => `"${name}"`).join(', ');

    Blockbench.showMessageBox({
        title: 'Catmull-Rom Converted to Bezier',
        message:
            `The following animation(s) had catmull-rom keyframes: ${animationList}\n\n` +
            `Vintage Story has no native catmull-rom mode, so these keyframes were exported ` +
            `as bezier with tangents computed from neighbouring keyframes. The curve is ` +
            `preserved (exact for uniform keyframe spacing, close otherwise). No action needed.`
    });
}

