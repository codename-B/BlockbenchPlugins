
// Blockbench global types
declare var Group: any;
declare var Locator: any;

/**
 * IK Constraint Data Structure
 */
export interface IKConstraintData {
    
    weight?: number;
    
    lockPosition?: boolean;
    
    lockedPosition?: [number, number, number];
    
    boneConstraints?: Record<string, BoneConstraint>;
    
    orientationHelper?: string;
    
    interactiveMode?: boolean;
    
    pinnedBones?: string[];
}

/**
 * Bone rotation constraints
 */
export interface BoneConstraint {
    
    allowedAxes?: { x: boolean; y: boolean; z: boolean };
    
    rotationLimits?: {
        x?: { min: number; max: number };
        y?: { min: number; max: number };
        z?: { min: number; max: number };
    };
}

/**
 * Interactive IK drag state tracking
 */
export interface DragState {
    isActive: boolean;
    draggedBone: any | null;
    originalBoneState: Map<string, { position: [number, number, number]; rotation: [number, number, number] }>;
    ikChain: any[] | null;
    controller: any | null;
    constraintData: IKConstraintData | null;
    startPosition: [number, number, number] | null;
}