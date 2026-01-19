
import { createBlockbenchMod } from "../../util/moddingTools";
import * as PACKAGE from "../../../package.json";
import { is_vs_project } from "../../util";
import { codecVS } from "../../codec";
import { setupIKProperties } from "./properties";
import { setupInteractiveIK, updatePinnedBones } from "./interactive";
import { bakeIKAnimations } from "./baking";
import { checkForIKControllers } from "./chain_utils";

// Blockbench global types
declare var Blockbench: any;
declare var Project: any;

/**
 * IK Improvement Mod for VS Plugin
 * 
 * This mod addresses IK limitations for VS export and adds interactive IK features:
 * 1. Detects IK usage and warns users that VS doesn't support IK natively
 * 2. Bakes IK animations to keyframes on export (converts IK-driven motion to keyframe animation)
 * 3. Provides user feedback during the baking process
 * 4. Adds advanced IK constraint features
 * 5. Interactive IK features for faster animation workflow
 */
createBlockbenchMod(
    `${PACKAGE.name}:ik_mod`,
    {
        
        originalCompile: codecVS.compile.bind(codecVS),
    },
    context => {
        const { editIKConstraintsAction, togglePinBoneAction } = setupIKProperties(context);
        
        setupInteractiveIK();
        
        Blockbench.on('load_project', () => {
            setTimeout(updatePinnedBones, 100);
        });
        
        codecVS.compile = function (options: any) {
            if (is_vs_project(Project)) {
                
                const hasIK = checkForIKControllers();
                if (hasIK) {
                    
                    const shouldBake = Blockbench.showMessageBox({
                        title: 'IK Animation Detected',
                        message:
                            'Your model uses Inverse Kinematics (IK) controllers.\n\n' +
                            'Vintage Story does not support IK natively. IK animations will be ' +
                            'automatically converted to keyframe animations during export.\n\n' +
                            'This may result in a large number of keyframes. Continue?',
                        buttons: ['Bake IK to Keyframes', 'Cancel Export']
                    });

                    if (shouldBake === 0) {
                        
                        bakeIKAnimations(is_vs_project);
                    } else {
                        
                        throw new Error('Export cancelled: IK animations need to be baked to keyframes');
                    }
                }
            }
            return context.originalCompile(options);
        };

        return { ...context, editIKConstraintsAction, togglePinBoneAction };
    },
    context => {
        
        codecVS.compile = context.originalCompile;
        
        if (context.editIKConstraintsAction) {
            context.editIKConstraintsAction.delete();
        }
        if (context.togglePinBoneAction) {
            context.togglePinBoneAction.delete();
        }
    }
);