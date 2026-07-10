/**
 * Helpers that map between Vintage Story animation-library *references* (the strings
 * stored in a shape's `animationLibraries[]`) and on-disk file paths.
 *
 * Mirrors the engine's resolution in `Shape.ResolveAnimationLibraries()`:
 *   reference `"[domain:]sub/path"`  <->  `assets/<domain>/animations/sub/path.json`
 * (an unqualified reference defaults to the "game" domain in the engine; for authoring
 * we also try the shape's own domain so same-mod libraries resolve).
 */

/** Normalises Windows backslashes to forward slashes (accepted by Node + Blockbench). */
function normalize(p: string): string {
    return p.replace(/\\/g, "/");
}

/** Splits a reference into its optional domain and sub-path, e.g. `game:humanoid/walk`. */
export function split_reference(ref: string): { domain?: string, subpath: string } {
    const trimmed = ref.trim();
    const idx = trimmed.indexOf(":");
    if (idx >= 0) {
        return { domain: trimmed.slice(0, idx), subpath: trimmed.slice(idx + 1) };
    }
    return { domain: undefined, subpath: trimmed };
}

/**
 * Locates the `assets/<domain>/` root from a model file path.
 * `.../assets/game/shapes/entity/foo.json` -> `{ assetsRoot: ".../assets", domain: "game" }`.
 * Returns null when the path is not inside an `assets/<domain>/` tree.
 */
export function parse_model_location(modelPath: string): { assetsRoot: string, domain: string } | null {
    const p = normalize(modelPath);
    const marker = "/assets/";
    const i = p.indexOf(marker);
    if (i < 0) return null;
    const after = p.slice(i + marker.length); // "<domain>/shapes/..."
    const slash = after.indexOf("/");
    if (slash <= 0) return null;
    return { assetsRoot: p.slice(0, i) + "/assets", domain: after.slice(0, slash) };
}

/**
 * Produces the candidate absolute file paths a reference could resolve to, in priority
 * order. An explicit-domain reference yields a single candidate; an unqualified one is
 * tried against the model's own domain first, then "game". The caller picks the first
 * that exists on disk (matching the engine's "warn and skip if not found" behaviour).
 */
export function reference_to_candidate_paths(ref: string, modelPath: string): string[] {
    const ctx = parse_model_location(modelPath);
    if (!ctx) return [];
    const { domain, subpath } = split_reference(ref);
    if (!subpath) return [];

    const domains: string[] = [];
    if (domain) {
        domains.push(domain);
    } else {
        domains.push(ctx.domain);
        if (ctx.domain !== "game") domains.push("game");
    }

    const seen = new Set<string>();
    const paths: string[] = [];
    for (const d of domains) {
        const candidate = `${ctx.assetsRoot}/${d}/animations/${subpath}.json`;
        if (!seen.has(candidate)) { seen.add(candidate); paths.push(candidate); }
    }
    return paths;
}

/**
 * Derives the `animationLibraries` reference for a library file path. Inverse of
 * {@link reference_to_candidate_paths}.
 * `.../assets/game/animations/humanoid/walk.json` -> `"game:humanoid/walk"`.
 * Falls back to the bare sub-path when no `assets/<domain>/` segment is present, and
 * returns null when the path is not under an `animations/` folder.
 */
export function path_to_reference(filePath: string): string | null {
    const p = normalize(filePath);
    const marker = "/animations/";
    const i = p.indexOf(marker);
    if (i < 0) return null;

    const subpath = p.slice(i + marker.length).replace(/\.json$/i, "");
    if (!subpath) return null;

    const before = p.slice(0, i); // ".../assets/<domain>"
    const am = "/assets/";
    const ai = before.lastIndexOf(am);
    if (ai >= 0) {
        const domain = before.slice(ai + am.length).split("/")[0];
        if (domain) return `${domain}:${subpath}`;
    }
    return subpath;
}

/** Library file base name without extension, used as a default library code/name. */
export function basename_no_ext(filePath: string): string {
    const p = normalize(filePath);
    const base = p.slice(p.lastIndexOf("/") + 1);
    return base.replace(/\.json$/i, "");
}
