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
/** Animators currently sitting on the rewind at the end of a "once" animation. */
const rewound = new WeakSet<object>();

/**
 * True while this animator is showing the rewind Blockbench performs as a "once" animation ends.
 *
 * Ending a one-shot runs `setTime(0)`, `preview()`, `pause()` and finally `preview(true)`, so the
 * playhead lands on 0 and renders three times. Only the last of those passes `in_loop`, which is
 * what Blockbench gates sound on, so it is the one that replays a frame-0 keyframe. Detecting the
 * rewind by comparing against `last_displayed_time` alone does not survive that, because the first
 * render resets it to 0. The state is latched instead, and cleared as soon as the playhead moves,
 * so pressing play again still triggers the sound normally.
 */
function is_end_of_single_shot(animator: any): boolean {
    const animation = animator.animation;
    if (!animation || animation.loop !== 'once' || animation.time > 0) {
        rewound.delete(animator);
        return false;
    }
    if (animator.last_displayed_time > 0) rewound.add(animator);
    return rewound.has(animator);
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
