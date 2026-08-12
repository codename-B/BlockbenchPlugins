/**
 * Viewport preview for VS particle keyframes.
 *
 * Blockbench renders a particle keyframe through Wintersky, but only when the keyframe's data
 * point carries a `file` pointing at a Snowstorm emitter JSON that has been registered with
 * `Animator.loadParticleEmitter`. VS keyframes only store the effect's asset code, so nothing
 * renders until we resolve that code to a file on disk and load it.
 *
 * Effect codes are VS asset locations (`[domain:]path`). GlintMod registers a `particles` asset
 * category, so an effect lives at `<assets>/<domain>/particles/<path>.json`.
 */

import { parse_model_location } from "./animation_library_paths";
import { is_vs_project } from "./util";

const fs = requireNativeModule('fs');
const nodePath = requireNativeModule('path');

/** Effect codes already resolved this session: code -> file path, or null when unresolvable. */
const resolvedEffects = new Map<string, string | null>();

/** Resets the cache so a newly added particle file is picked up without restarting Blockbench. */
export function clear_particle_cache(): void {
    resolvedEffects.clear();
}

/**
 * `<assets>/<domain>/particles/<path>.json` for an effect code, using the project's asset root.
 *
 * Returned with native separators. Blockbench finds an effect's texture by splitting this path on
 * the platform separator, locating the "particles" segment and treating everything above it as the
 * pack root. A forward-slash path on Windows splits into a single segment, so that search fails and
 * every particle falls back to the placeholder texture.
 */
function particle_file_for(effectCode: string): string | null {
    const modelPath = Project?.save_path || Project?.export_path;
    if (!modelPath) return null;
    const ctx = parse_model_location(modelPath);
    if (!ctx) return null;

    const colon = effectCode.indexOf(':');
    const domain = colon >= 0 ? effectCode.slice(0, colon) : ctx.domain;
    const path = colon >= 0 ? effectCode.slice(colon + 1) : effectCode;
    if (!path) return null;

    return nodePath.join(ctx.assetsRoot, domain, 'particles', `${path}.json`);
}

/**
 * Resolves an effect code to a loaded emitter file, returning the path Blockbench should use on
 * the keyframe data point. Returns null when the effect has no file, which just means no preview.
 */
export function resolve_particle_effect(effectCode: string): string | null {
    const code = effectCode.trim();
    if (!code) return null;

    const cached = resolvedEffects.get(code);
    if (cached !== undefined) return cached;

    const file = particle_file_for(code);
    if (!file || !fs.existsSync(file)) {
        resolvedEffects.set(code, null);
        return null;
    }

    // Registering the same path twice is harmless; Blockbench replaces the config in place.
    if (!Animator.particle_effects[file]) {
        try {
            Animator.loadParticleEmitter(file, namespace_components(fs.readFileSync(file, 'utf-8')));
        } catch (e) {
            console.warn(`[VS Particles] Could not load emitter "${file}":`, e);
            resolvedEffects.set(code, null);
            return null;
        }
    }

    resolvedEffects.set(code, file);
    return file;
}

/**
 * Adds the `minecraft:` namespace to component names that lack one.
 *
 * Wintersky, which drives Blockbench's particle preview, looks every component up as
 * `components["minecraft:" + name]`. VS effects are written with bare names, so without this every
 * lookup misses and the emitter is built with no rate, shape, lifetime or appearance: registered,
 * linked, and completely inert. Only `components` is touched, since `curves` and `events` are
 * author-named in Bedrock too. The file on disk is left alone.
 */
function namespace_components(content: string): string {
    const json = JSON.parse(content);
    const components = json?.particle_effect?.components;
    if (!components) return content;

    const namespaced: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(components)) {
        namespaced[name.includes(':') ? name : `minecraft:${name}`] = value;
    }
    json.particle_effect.components = namespaced;
    return JSON.stringify(json);
}

/** Builds one Blockbench particle data point, with a preview file attached when we can find one. */
export function particle_data_point(effect: string, locator?: string): Record<string, unknown> {
    const file = resolve_particle_effect(effect);
    const dp: Record<string, unknown> = { effect, locator: locator || '' };
    if (file) dp.file = file;
    return dp;
}

/**
 * Blockbench stores the emitter path on the keyframe as an absolute path and saves it into the
 * .bbmodel, so a project opened on another machine (or after the assets move) carries a path that
 * does not exist and Blockbench reports "File Not Found". The path is derived from the effect
 * code, so it is never worth trusting what was saved: re-resolve every particle keyframe against
 * this machine's asset folder whenever a project loads.
 */
Blockbench.on('load_project', () => {
    if (!is_vs_project(Project)) return;
    relink_particle_previews();
});

/**
 * Re-resolves every particle keyframe in the project. Also exposed through the "Reload VFX
 * Previews" action, for effects authored by hand or added to the assets folder after the model was
 * opened. Returns how many data points now have an emitter.
 */
export function relink_particle_previews(): number {
    clear_particle_cache();
    let linked = 0;

    for (const animation of (Animation as unknown as typeof _Animation).all) {
        const effects = (animation.animators as any)?.effects;
        if (!effects?.particle) continue;

        for (const keyframe of effects.particle as _Keyframe[]) {
            for (const dp of keyframe.data_points as any[]) {
                const file = resolve_particle_effect(dp.effect || '');
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
