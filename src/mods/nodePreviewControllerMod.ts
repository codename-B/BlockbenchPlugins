import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";
import { is_vs_project } from "../util";
import { getAnimatedConstraintsForBone } from "./ik/constraints";
import { isIKAnimationContextActive } from "./ik/utils";


createBlockbenchMod(`${PACKAGE.name}:node_preview_controller_mod`,
    {
        original: Blockbench.NodePreviewController.prototype.updateTransform
    },
    inject_context => {
        Blockbench.NodePreviewController.prototype.updateTransform = function (this: NodePreviewController, node: OutlinerNode) {
            if (is_vs_project(Project)) {
                if ((node instanceof Group || node instanceof Cube)&& node.stepParentName && node.stepParentName !== "") {
                    return updateStepChildTransform(this, node);                    
                }

                const result = inject_context.original.call(this, node);
                applyConstrainedGroupRotation(node);
                return result;
            }
            return inject_context.original.call(this, node);
        };
        return inject_context;
    },
    extract_context => {
        Blockbench.NodePreviewController.prototype.updateTransform = extract_context.original;
    }
);

/**
 * Does the same as the original method but skips parenting root groups to the internal root mesh (commented section)
 */
function updateStepChildTransform(controller: NodePreviewController, element: any) {
    //@ts-expect-error: missing types
    const mesh = element.mesh;

        //@ts-expect-error: missing types
        if (element.getTypeBehavior('movable')) {
            //@ts-expect-error: missing types
            mesh.position.set(element.origin[0], element.origin[1], element.origin[2]);
        }    

        //@ts-expect-error: missing types
        if (element.getTypeBehavior('rotatable')) {
            const rotation = getPreviewRotation(element);
            //@ts-expect-error: missing types
            mesh.rotation.x = Math.degToRad(rotation[0]);
            //@ts-expect-error: missing types
            mesh.rotation.y = Math.degToRad(rotation[1]);
            //@ts-expect-error: missing types
            mesh.rotation.z = Math.degToRad(rotation[2]);
        }
    
    //@ts-expect-error: missing types
    if (element.getTypeBehavior('scalable')) {
        //@ts-expect-error: missing types
        mesh.scale.x = element.scale[0] || 1e-7;
        //@ts-expect-error: missing types
        mesh.scale.y = element.scale[1] || 1e-7;
        //@ts-expect-error: missing types
        mesh.scale.z = element.scale[2] || 1e-7;
    }

    // if (Format.bone_rig) {
    //     //@ts-expect-error: missing types
    //     if (element.parent instanceof OutlinerNode && element.parent.getTypeBehavior('parent')) {
    //         element.parent.mesh.add(mesh);
    //         //@ts-expect-error: missing types
    //         if (element.parent.getTypeBehavior('use_absolute_position')) {
    //             mesh.position.x -= element.parent.origin[0];
    //             mesh.position.y -= element.parent.origin[1];
    //             mesh.position.z -= element.parent.origin[2];
    //         }
    //     } else if (mesh.parent !== Project!.model_3d) {
    //         Project!.model_3d.add(mesh);
    //     }
    // } else if (mesh.parent !== Project!.model_3d) {
    //     Project!.model_3d.add(mesh);
    // }

    if((element instanceof Cube || element instanceof Group) && element.stepParentName && element.stepParentName != "") {
        const step_parent = Cube.all.find(c => c.name === `${element.stepParentName}_geo`);
        // Guard against self-parenting (would cause THREE.js "can't add as child of itself" error)
        if(step_parent && step_parent !== element && step_parent.mesh !== element.mesh) {
            step_parent.mesh.add(element.mesh);
        } else {
            Project!.model_3d.add(mesh);
        }
    }

    mesh.updateMatrixWorld();

    controller.dispatchEvent('update_transform', { element });
}

function getPreviewRotation(element: any): [number, number, number] {
    const rotation: [number, number, number] = [
        element.rotation?.[0] || 0,
        element.rotation?.[1] || 0,
        element.rotation?.[2] || 0
    ];

    if (!isIKAnimationContextActive()) {
        return rotation;
    }

    if (!(element instanceof Group)) {
        return rotation;
    }

    const constraint = getAnimatedConstraintsForBone(element.name);
    if (!constraint) {
        return rotation;
    }

    if (constraint.allowedAxes) {
        if (!constraint.allowedAxes.x) rotation[0] = 0;
        if (!constraint.allowedAxes.y) rotation[1] = 0;
        if (!constraint.allowedAxes.z) rotation[2] = 0;
    }

    if (constraint.rotationLimits) {
        if (constraint.rotationLimits.x) {
            rotation[0] = Math.max(constraint.rotationLimits.x.min, Math.min(constraint.rotationLimits.x.max, rotation[0]));
        }
        if (constraint.rotationLimits.y) {
            rotation[1] = Math.max(constraint.rotationLimits.y.min, Math.min(constraint.rotationLimits.y.max, rotation[1]));
        }
        if (constraint.rotationLimits.z) {
            rotation[2] = Math.max(constraint.rotationLimits.z.min, Math.min(constraint.rotationLimits.z.max, rotation[2]));
        }
    }

    return rotation;
}

function applyConstrainedGroupRotation(node: any): void {
    if (!(node instanceof Group)) {
        return;
    }

    //@ts-expect-error: missing types
    const mesh = node.mesh;
    if (!mesh?.rotation) {
        return;
    }

    const rotation = getPreviewRotation(node);
    mesh.rotation.x = Math.degToRad(rotation[0]);
    mesh.rotation.y = Math.degToRad(rotation[1]);
    mesh.rotation.z = Math.degToRad(rotation[2]);
    mesh.updateMatrixWorld?.();
}

