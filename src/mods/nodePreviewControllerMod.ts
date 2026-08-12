import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";
import { is_vs_project } from "../util";
import { getAnimatedConstraintsForBone } from "./ik/constraints";
import { isIKAnimationContextActive } from "./ik/utils";
import { composeEulerXYZ, relativeEulerXYZ } from "../attachments/attachment_transform";
import type { Vector3Tuple } from "../attachments/attachment_transform";


createBlockbenchMod(`${PACKAGE.name}:node_preview_controller_mod`,
    {
        original: Blockbench.NodePreviewController.prototype.updateTransform
    },
    inject_context => {
        Blockbench.NodePreviewController.prototype.updateTransform = function (this: NodePreviewController, node: OutlinerNode) {
            if (is_vs_project(Project)) {
                if ((node instanceof Group || node instanceof Cube)&& node.stepParentName && node.stepParentName !== "") {
                    const stepParent = resolveStepParentTarget(node);
                    const usesPhysicalParent = node.vs_step_parent_local !== true
                        && stepParent instanceof Group
                        && node.parent === stepParent;

                    // Absolute-space BB attachments can use Blockbench's normal
                    // transform once they have been placed under the real socket.
                    // Standalone legacy sources should likewise retain their
                    // authored hierarchy when no socket is present.
                    if (usesPhysicalParent || (node.vs_step_parent_local !== true && !stepParent)) {
                        const result = inject_context.original.call(this, node);
                        applyConstrainedGroupRotation(node);
                        return result;
                    }

                    return updateStepChildTransform(this, node, stepParent);
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
function updateStepChildTransform(controller: NodePreviewController, element: any, stepParent: Group | Cube | null) {
    //@ts-expect-error: missing types
    const mesh = element.mesh;

    //@ts-expect-error: missing types
    if (element.getTypeBehavior('movable')) {
        let position = [...element.origin] as Vector3Tuple;
        if (stepParent) {
            if (element.vs_step_parent_local === true) {
                // VS children are relative to parent.from, while the preview
                // mesh is rooted at parent.rotationOrigin/origin.
                const parentFrom = getStepParentFrom(stepParent);
                position = [
                    element.origin[0] + parentFrom[0] - stepParent.origin[0],
                    element.origin[1] + parentFrom[1] - stepParent.origin[1],
                    element.origin[2] + parentFrom[2] - stepParent.origin[2],
                ];
            } else {
                // Absolute BB coordinates become local to the target mesh pivot.
                position = [
                    element.origin[0] - stepParent.origin[0],
                    element.origin[1] - stepParent.origin[1],
                    element.origin[2] - stepParent.origin[2],
                ];
            }
        }
        //@ts-expect-error: missing types
        mesh.position.set(position[0], position[1], position[2]);
    }

    //@ts-expect-error: missing types
    if (element.getTypeBehavior('rotatable')) {
        const rotation = element.vs_step_parent_local === true || !stepParent
            ? getPreviewRotation(element)
            : relativeEulerXYZ(getElementBindRotation(element), getElementBindRotation(stepParent));
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
        // Guard against self-parenting and attachment-child cycles.
        if(stepParent && stepParent !== element && stepParent.mesh !== element.mesh) {
            stepParent.mesh.add(element.mesh);
        } else {
            Project!.model_3d.add(mesh);
        }
    }

    mesh.updateMatrixWorld();

    controller.dispatchEvent('update_transform', { element });
}

function isInElementSubtree(candidate: Group | Cube, element: Group | Cube): boolean {
    let current: any = candidate;
    while (current instanceof Group || current instanceof Cube) {
        if (current === element) return true;
        current = current.parent;
    }
    return false;
}

function resolveStepParentTarget(element: Group | Cube): Group | Cube | null {
    const name = element.stepParentName?.trim();
    if (!name) return null;
    const attachmentSlot = element.clothingSlot?.trim();

    const groups = Group.all.filter((candidate: Group) =>
        candidate.name === name
        && candidate !== element
        && !isInElementSubtree(candidate, element)
    );
    const preferredGroup = groups.find((candidate: Group) =>
        !candidate.stepParentName?.trim()
        && (!candidate.clothingSlot?.trim() || candidate.clothingSlot?.trim() !== attachmentSlot)
    ) || groups.find((candidate: Group) =>
        !candidate.clothingSlot?.trim() || candidate.clothingSlot?.trim() !== attachmentSlot
    ) || groups[0];
    if (preferredGroup) return preferredGroup;

    const cubes = Cube.all.filter((candidate: Cube) =>
        candidate.name === `${name}_geo`
        && candidate !== element
        && !isInElementSubtree(candidate, element)
    );
    return cubes.find((candidate: Cube) =>
        !candidate.clothingSlot?.trim() || candidate.clothingSlot?.trim() !== attachmentSlot
    ) || cubes[0] || null;
}

function getStepParentFrom(stepParent: Group | Cube): Vector3Tuple {
    if (stepParent instanceof Cube) return [...stepParent.from] as Vector3Tuple;
    if (Array.isArray(stepParent.vs_group_from) && stepParent.vs_group_from.length === 3) {
        return [...stepParent.vs_group_from] as Vector3Tuple;
    }
    const geoChild = stepParent.children.find(child =>
        child instanceof Cube && child.name === `${stepParent.name}_geo`
    ) as Cube | undefined;
    return [...(geoChild?.from || stepParent.origin)] as Vector3Tuple;
}

function getElementBindRotation(element: Group | Cube): Vector3Tuple {
    const chain: Vector3Tuple[] = [];
    let current: any = element;
    while (current instanceof Group || current instanceof Cube) {
        chain.unshift([...(current.rotation || [0, 0, 0])] as Vector3Tuple);
        current = current.parent;
    }
    return composeEulerXYZ(chain);
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

