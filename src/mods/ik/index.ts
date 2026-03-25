
import { createBlockbenchMod } from "../../util/moddingTools";
import * as PACKAGE from "../../../package.json";
import { is_vs_project } from "../../util";
import { codecVS } from "../../codec";
import { setupIKProperties } from "./properties";
import { setupInteractiveIK, updatePinnedBones } from "./interactive";
import { bakeIKAnimations } from "./baking";
import { checkForIKControllers } from "./chain_utils";
import { setOnConstraintCacheRebuilt } from "./constraints";
import { refreshIKPreview } from "./utils";
import { syncConstraintEnforcement, clearConstraintEnforcement } from "../boneAnimatorMod";

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
        
        // Re-patch bone meshes whenever constraint cache is rebuilt
        setOnConstraintCacheRebuilt(() => {
            refreshIKPreview(undefined, true);
            syncConstraintEnforcement();
        });

        Blockbench.on('load_project', () => {
            setTimeout(() => {
                updatePinnedBones();
                refreshIKPreview(undefined, true);
                syncConstraintEnforcement();
            }, 100);
        });
        
        codecVS.compile = function (options: any) {
            if (is_vs_project(Project)) {
                const hasIK = checkForIKControllers();
                if (hasIK) {
                    bakeIKAnimations(is_vs_project);
                }
            }
            return context.originalCompile(options);
        };

        return { ...context, editIKConstraintsAction, togglePinBoneAction };
    },
    context => {
        
        codecVS.compile = context.originalCompile;
        clearConstraintEnforcement();

        if (context.editIKConstraintsAction) {
            context.editIKConstraintsAction.delete();
        }
        if (context.togglePinBoneAction) {
            context.togglePinBoneAction.delete();
        }
    }
);
