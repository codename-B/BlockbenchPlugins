/**
 * Sound keyframe support.
 *
 * VS has no sound field on shape keyframes: the engine's `AnimationSound` lives on
 * `AnimationMetaData` in entity JSON. Rather than require an engine change, sounds ride in the
 * shape's keyframes as `sounds[]` exactly like `particles[]` does, and GlintMod reads them back
 * out of the raw shape JSON.
 *
 * Blockbench's sound keyframes store a free-text `effect` name plus a `file` path to the audio on
 * disk (which it plays during timeline scrubbing). VS wants an asset location, so we convert
 * between the two: `<assets>/<domain>/sounds/<path>.ogg` <-> `domain:path`.
 */

import { parse_model_location } from "./animation_library_paths";
import { is_vs_project } from "./util";
import { VS_AnimationSound } from "./vs_shape_def";

const fs = requireNativeModule('fs');

const SOUND_EXTENSIONS = ['.ogg', '.wav', '.mp3'];

/**
 * Extra sound fields, registered on Blockbench's keyframe data point so they get real inputs in
 * the keyframe panel. Blockbench renders whatever is registered on KeyframeDataPoint
 * (`v-for="(property, key) in data_point.constructor.properties"`), honouring `condition`, so
 * these only appear on sound keyframes. They round-trip through .bbmodel automatically because
 * Keyframe.getUndoCopy() copies every registered property of each data point.
 *
 * Defaults mirror the engine's AnimationSound, and export omits any field still at its default.
 */
const SOUND_DEFAULTS = { vs_range: 32, vs_volume: 1, vs_pitch: 1, vs_chance: 1 } as const;

function onSoundKeyframe(dataPoint: any): boolean {
    return dataPoint?.keyframe?.channel === 'sound';
}

if (typeof KeyframeDataPoint !== 'undefined') {
    new Property(KeyframeDataPoint, 'number', 'vs_range', {
        label: 'Range', exposed: true, default: SOUND_DEFAULTS.vs_range, condition: onSoundKeyframe,
    });
    new Property(KeyframeDataPoint, 'number', 'vs_volume', {
        label: 'Volume', exposed: true, default: SOUND_DEFAULTS.vs_volume, condition: onSoundKeyframe,
    });
    new Property(KeyframeDataPoint, 'number', 'vs_pitch', {
        label: 'Pitch', exposed: true, default: SOUND_DEFAULTS.vs_pitch, condition: onSoundKeyframe,
    });
    new Property(KeyframeDataPoint, 'number', 'vs_chance', {
        label: 'Chance', exposed: true, default: SOUND_DEFAULTS.vs_chance, condition: onSoundKeyframe,
    });
    new Property(KeyframeDataPoint, 'boolean', 'vs_looping', {
        label: 'Looping', exposed: true, default: false, condition: onSoundKeyframe,
    });
}

/**
 * Reads the optional sound fields off a data point. The panel renders numbers as text inputs, so
 * these come back as strings and have to be coerced before comparing against the defaults.
 */
function readSoundOptions(dp: KeyframeDataPointData): Partial<VS_AnimationSound> {
    const out: Partial<VS_AnimationSound> = {};

    for (const key of ['range', 'volume', 'pitch', 'chance'] as const) {
        const raw = dp[`vs_${key}`];
        if (raw === undefined || raw === null || raw === '') continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value === SOUND_DEFAULTS[`vs_${key}`]) continue;
        out[key] = value;
    }

    if (dp.vs_looping === true) out.looping = true;
    return out;
}

/** Strips a trailing audio extension. */
function without_extension(path: string): string {
    for (const ext of SOUND_EXTENSIONS) {
        if (path.toLowerCase().endsWith(ext)) return path.slice(0, -ext.length);
    }
    return path;
}

/**
 * Converts a local audio file path to a VS asset location, when the file sits inside an
 * `assets/<domain>/sounds/` tree. Returns null for files kept outside the mod's assets.
 */
export function sound_location_for_file(filePath: string): string | null {
    const p = filePath.replace(/\\/g, '/');
    const match = /\/assets\/([^/]+)\/sounds\/(.+)$/.exec(p);
    if (!match) return null;
    return `${match[1]}:${without_extension(match[2])}`;
}

/**
 * The VS asset location a Blockbench sound data point should export as.
 *
 * The effect code wins over the picked file. The file is only a local preview, and a code can say
 * things a single file cannot, most importantly the `*` wildcard VS uses to pick a random variant
 * (bruister_peck_* covering bruister_peck_1/2/3). Deriving the location from the file would silently
 * collapse that to whichever variant happened to be picked.
 */
function sound_location_for_data_point(dp: KeyframeDataPointData): string | null {
    const effect = (dp.effect || '').trim();
    if (effect) return effect;
    return dp.file ? sound_location_for_file(dp.file) : null;
}

/** Converts one Blockbench sound data point to a VS keyframe sound, or null if it has no target. */
export function sound_from_data_point(dp: KeyframeDataPointData): VS_AnimationSound | null {
    const location = sound_location_for_data_point(dp);
    if (!location) return null;
    return { location, ...readSoundOptions(dp) };
}

/** Finds the audio file for a VS sound location so Blockbench can play it while scrubbing. */
function sound_file_for_location(location: string): string | null {
    const modelPath = Project?.save_path || Project?.export_path;
    if (!modelPath) return null;
    const ctx = parse_model_location(modelPath);
    if (!ctx) return null;

    const colon = location.indexOf(':');
    const domain = colon >= 0 ? location.slice(0, colon) : ctx.domain;
    const path = colon >= 0 ? location.slice(colon + 1) : location;
    if (!path) return null;

    // A `*` marks a random-variant set (bruister_peck_* -> bruister_peck_1/2/3). Preview the
    // first variant, since Blockbench can only play one file.
    const concrete = path.split('*').join('1');
    const soundsRoot = `${ctx.assetsRoot}/${domain}/sounds`;

    for (const ext of SOUND_EXTENSIONS) {
        const candidate = `${soundsRoot}/${concrete}${ext}`;
        if (fs.existsSync(candidate)) return candidate;
    }

    // Codes are often short names rather than full paths (bruister_peck_* for
    // entity/bruister/bruister_peck_1.ogg), so fall back to searching the sounds tree.
    return find_sound_by_name(soundsRoot, concrete.split('/').pop() ?? concrete);
}

/** Depth-first search for `<name><ext>` under the sounds folder. */
function find_sound_by_name(dir: string, name: string, depth = 0): string | null {
    if (depth > 6 || !fs.existsSync(dir)) return null;

    let entries: any[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }

    for (const entry of entries) {
        if (entry.isFile() && SOUND_EXTENSIONS.some(ext => entry.name.toLowerCase() === name.toLowerCase() + ext)) {
            return `${dir}/${entry.name}`;
        }
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const found = find_sound_by_name(`${dir}/${entry.name}`, name, depth + 1);
        if (found) return found;
    }
    return null;
}

/**
 * Re-resolves the audio file on every sound keyframe. Blockbench saves `file` into the .bbmodel as
 * an absolute path, so a project opened elsewhere points at a file that does not exist. The path
 * is derived from the sound's asset location, so it is rebuilt on load rather than trusted.
 */
export function relink_sound_files(): number {
    let linked = 0;

    for (const animation of (Animation as unknown as typeof _Animation).all) {
        const effects = (animation.animators as any)?.effects;
        if (!effects?.sound) continue;

        for (const keyframe of effects.sound as _Keyframe[]) {
            for (const dp of keyframe.data_points as any[]) {
                const file = sound_file_for_location((dp.effect || '').trim());
                if (file) {
                    dp.file = file;
                    linked++;
                } else {
                    delete dp.file;
                }
            }
        }
    }
    return linked;
}

Blockbench.on('load_project', () => {
    if (!is_vs_project(Project)) return;
    relink_sound_files();
});

/** Builds one Blockbench sound data point, attaching the audio file when it can be found. */
export function sound_data_point(sound: VS_AnimationSound): Record<string, unknown> {
    const dp: Record<string, unknown> = { effect: sound.location };
    const file = sound_file_for_location(sound.location);
    if (file) dp.file = file;

    if (sound.range !== undefined) dp.vs_range = sound.range;
    if (sound.volume !== undefined) dp.vs_volume = sound.volume;
    if (sound.pitch !== undefined) dp.vs_pitch = sound.pitch;
    if (sound.chance !== undefined) dp.vs_chance = sound.chance;
    if (sound.looping) dp.vs_looping = true;

    return dp;
}
