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

// @ts-expect-error: requireNativeModule is missing in blockbench types --- IGNORE ---
const fs = requireNativeModule('fs');

const SOUND_EXTENSIONS = ['.ogg', '.wav', '.mp3'];

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

/** The VS asset location a Blockbench sound data point should export as. */
export function sound_location_for_data_point(dp: KeyframeDataPointData): string | null {
    const fromFile = dp.file ? sound_location_for_file(dp.file) : null;
    if (fromFile) return fromFile;
    // Hand-typed effect names are treated as asset locations so authors can reference sounds
    // that live outside the project folder.
    const effect = (dp.effect || '').trim();
    return effect || null;
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

    for (const ext of SOUND_EXTENSIONS) {
        const candidate = `${ctx.assetsRoot}/${domain}/sounds/${path}${ext}`;
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/** Builds one Blockbench sound data point, attaching the audio file when it can be found. */
export function sound_data_point(location: string): Record<string, unknown> {
    const dp: Record<string, unknown> = { effect: location };
    const file = sound_file_for_location(location);
    if (file) dp.file = file;
    return dp;
}
