
// Blockbench global types
declare var Group: any;
declare var Locator: any;
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
 * Gets the IK chain starting from a target bone.
 * Walks up the parent hierarchy to include all bones up to the root.
 * Only includes actual bones (not null objects/locators) in the chain,
 * except for the target itself.
 * 
 * @param target - The target bone or locator
 * @returns Array of bones forming the IK chain, ordered from root to target
 */
export function getIKChain(target: any): any[] {
    const chain: any[] = [];

    if (target instanceof Group) {
        
        let current: any = target;
        while (current && current instanceof Group) {
            
            if (current === target || !current.isNull) {
                chain.unshift(current);
            }
            current = current.parent;
        }
    }

    return chain;
}

/**
 * Finds all IK controllers in the current project.
 * IK controllers are null objects (Groups with isNull=true) that have an ikTarget property.
 * 
 * @returns Array of IK controller information including controller, target, and chain
 */
export function findAllIKControllers(): IKControllerInfo[] {
    const ikControllers: IKControllerInfo[] = [];

    const nulls = Group.all.filter((g: any) => g.isNull);

    for (const nullObj of nulls) {
        if (nullObj.ikTarget) {
            const target = nullObj.ikTarget;
            const chain = getIKChain(target);
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

    const nulls = Group.all.filter((g: any) => g.isNull);

    for (const nullObj of nulls) {
        if (nullObj.ikTarget) {
            return true;
        }
    }

    return false;
}