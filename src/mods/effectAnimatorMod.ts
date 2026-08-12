import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";
import { is_vs_project } from "../util";
import { ensure_particle_links } from "../animation_particles";
import { ensure_sound_links } from "../animation_sounds";

/**
 * Resolves effect files just before Blockbench draws them.
 *
 * VS keyframes only store an asset code; Blockbench needs a real path in `data_point.file` before
 * it will spawn a particle emitter or play a sound. Doing that on `load_project` is unreliable
 * because the event fires before the project is ready, which is why attachments.ts defers its own
 * work by 100ms. Hooking the render path instead makes it demand-driven, so it cannot run too
 * early and there is nothing for the user to trigger by hand.
 */
createBlockbenchMod(`${PACKAGE.name}:effect_animator_mod`,
    {
        original: Blockbench.EffectAnimator.prototype.displayFrame
    },
    inject_context => {
        Blockbench.EffectAnimator.prototype.displayFrame = function (this: EffectAnimator, in_loop?: boolean) {
            if (is_vs_project(Project)) {
                ensure_particle_links(this);
                ensure_sound_links(this);
            }
            return inject_context.original.call(this, in_loop);
        };
        return inject_context;
    },
    extract_context => {
        Blockbench.EffectAnimator.prototype.displayFrame = extract_context.original;
    }
);
