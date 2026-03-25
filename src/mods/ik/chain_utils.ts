
// Blockbench global types
declare var Group: any;
declare var NullObject: any;
declare var OutlinerNode: any;
declare var Project: any;

/**
 * Chain Utility helper interface
 */
export interface IKControllerInfo {
    controller: any;
    target: any;
    chain: any[];
}

/**
 * Resolves a value that may be a UUID string to the actual outliner node.
 */
function resolveNode(nodeOrUuid: any): any {
    if (typeof nodeOrUuid === 'string') {
        return OutlinerNode.uuids[nodeOrUuid] ?? null;
    }
    return nodeOrUuid;
}

/**
 * Gets the IK chain for a controller.
 * Walks up from the ik_target's parent bone to either the ik_source bone
 * or the controller's parent bone (whichever is hit first).
 * Returns the chain ordered from root to leaf.
 *
 * @param controller - The NullObject IK controller
 * @returns Array of Group bones forming the IK chain, ordered root to leaf
 */
export function getIKChain(controller: any): any[] {
    const chain: any[] = [];

    const target = resolveNode(controller.ik_target);
    if (!target) return chain;

    const source = resolveNode(controller.ik_source);
    const controllerParent = controller.parent;

    // Find the starting bone: the target's parent if target is a locator/element,
    // or the target itself if it's a Group
    let start: any = target instanceof Group ? target : target.parent;

    // Walk up from the start bone to the source or controller's parent
    let current: any = start;
    while (current && current instanceof Group) {
        chain.unshift(current);
        if (source && current === source) break;
        if (!source && current === controllerParent) break;
        current = current.parent;
    }

    return chain;
}

/**
 * Finds all IK controllers in the current project.
 * IK controllers are NullObjects that have an ik_target property set.
 *
 * @returns Array of IK controller information including controller, target, and chain
 */
export function findAllIKControllers(): IKControllerInfo[] {
    const ikControllers: IKControllerInfo[] = [];

    const nulls = NullObject.all;

    for (const nullObj of nulls) {
        if (nullObj.ik_target) {
            const target = resolveNode(nullObj.ik_target);
            if (!target) continue;
            const chain = getIKChain(nullObj);
            ikControllers.push({
                controller: nullObj,
                target,
                chain
            });
        }
    }

    return ikControllers;
}

/**
 * Checks if the current project has any IK controllers.
 *
 * @returns True if at least one IK controller exists in the project
 */
export function checkForIKControllers(): boolean {
    if (!Project) return false;

    const nulls = NullObject.all;

    for (const nullObj of nulls) {
        if (nullObj.ik_target) {
            return true;
        }
    }

    return false;
}
