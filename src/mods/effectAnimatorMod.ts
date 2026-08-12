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
/**
 * True when this render is the rewind Blockbench performs as a "once" animation finishes: the
 * playhead has jumped back to the start from somewhere later in the timeline. Playing again from a
 * paused start does not match, because the previous render left the playhead at 0.
 */
function is_end_of_single_shot(animator: any): boolean {
    return animator.animation?.loop === 'once'
        && animator.animation.time === 0
        && animator.last_displayed_time > 0;
}

createBlockbenchMod(`${PACKAGE.name}:effect_animator_mod`,
    {
        original: Blockbench.EffectAnimator.prototype.displayFrame
    },
    inject_context => {
        Blockbench.EffectAnimator.prototype.displayFrame = function (this: EffectAnimator, in_loop?: boolean) {
            if (!is_vs_project(Project)) {
                return inject_context.original.call(this, in_loop);
            }

            ensure_particle_links(this);
            ensure_sound_links(this);

            if (!is_end_of_single_shot(this)) {
                return inject_context.original.call(this, in_loop);
            }

            // Blockbench ends a "once" animation with setTime(0) -> preview() -> pause(), so the
            // rewind re-renders frame 0 and fires anything keyed there a second time. Its own
            // 400ms sound cooldown has expired by then on all but the shortest animations. Mute
            // the effect channels just for this rewind render so the tail is silent.
            const muted = (this as any).muted;
            const previous = { sound: muted.sound, particle: muted.particle };
            muted.sound = true;
            muted.particle = true;
            try {
                return inject_context.original.call(this, in_loop);
            } finally {
                muted.sound = previous.sound;
                muted.particle = previous.particle;
            }
        };
        return inject_context;
    },
    extract_context => {
        Blockbench.EffectAnimator.prototype.displayFrame = extract_context.original;
    }
);
