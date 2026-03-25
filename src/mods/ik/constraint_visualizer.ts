
import { BoneConstraint } from "./types";

// @ts-expect-error: THREE is global in Blockbench
declare const THREE: typeof import('three');
declare var Canvas: any;

const ARC_SEGMENTS = 32;
const ARC_RADIUS = 3;
const FILL_OPACITY = 0.15;
const OUTLINE_OPACITY = 0.8;
const RENDER_ORDER = 998;
const DISABLED_MARKER_SIZE = 1.5;
const DEG_TO_RAD = Math.PI / 180;

const AXIS_COLORS = {
    x: 0xef3333,
    y: 0x7bef37,
    z: 0x3b8aef,
};

type Axis = 'x' | 'y' | 'z';
const AXES: Axis[] = ['x', 'y', 'z'];

interface AxisVisual {
    fillMesh: any | null;
    outlineLine: any | null;
    disabledMarker: any | null;
}

interface BoneVisual {
    bone: any;
    container: any;
    axes: Record<Axis, AxisVisual>;
}

function getAxisRotation(axis: Axis): any {
    switch (axis) {
        case 'x': return new THREE.Euler(0, Math.PI / 2, 0);
        case 'y': return new THREE.Euler(Math.PI / 2, 0, 0);
        case 'z': return new THREE.Euler(0, 0, 0);
    }
}

function createArcFillGeometry(minDeg: number, maxDeg: number): any {
    const minRad = minDeg * DEG_TO_RAD;
    const maxRad = maxDeg * DEG_TO_RAD;
    const range = maxRad - minRad;
    const step = range / ARC_SEGMENTS;
    const vertices: number[] = [];

    for (let i = 0; i < ARC_SEGMENTS; i++) {
        const a1 = minRad + step * i;
        const a2 = minRad + step * (i + 1);
        vertices.push(0, 0, 0);
        vertices.push(Math.cos(a1) * ARC_RADIUS, Math.sin(a1) * ARC_RADIUS, 0);
        vertices.push(Math.cos(a2) * ARC_RADIUS, Math.sin(a2) * ARC_RADIUS, 0);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return geometry;
}

function createArcOutlineGeometry(minDeg: number, maxDeg: number): any {
    const minRad = minDeg * DEG_TO_RAD;
    const maxRad = maxDeg * DEG_TO_RAD;
    const range = maxRad - minRad;
    const step = range / ARC_SEGMENTS;
    const points: number[] = [];

    // Radial line to min
    points.push(0, 0, 0);
    points.push(Math.cos(minRad) * ARC_RADIUS, Math.sin(minRad) * ARC_RADIUS, 0);

    // Arc from min to max
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
        const a = minRad + step * i;
        points.push(Math.cos(a) * ARC_RADIUS, Math.sin(a) * ARC_RADIUS, 0);
    }

    // Radial line back to center
    points.push(0, 0, 0);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geometry;
}

function createCircleOutlineGeometry(): any {
    const step = (Math.PI * 2) / ARC_SEGMENTS;
    const points: number[] = [];

    for (let i = 0; i <= ARC_SEGMENTS; i++) {
        const a = step * i;
        points.push(Math.cos(a) * ARC_RADIUS, Math.sin(a) * ARC_RADIUS, 0);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geometry;
}

function createDisabledMarkerGeometry(): any {
    const s = DISABLED_MARKER_SIZE;
    const vertices = [
        -s, -s, 0, s, s, 0,
        s, -s, 0, -s, s, 0,
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return geometry;
}

export class ConstraintVisualizer {
    private boneVisuals: Map<string, BoneVisual> = new Map();
    private fillMaterials: Record<Axis, any> = {} as any;
    private outlineMaterials: Record<Axis, any> = {} as any;
    private disabledMaterials: Record<Axis, any> = {} as any;

    constructor(private chain: any[], constraints: Record<string, BoneConstraint>) {
        this.createMaterials();

        for (const bone of chain) {
            const constraint = constraints[bone.name] || {};
            this.createBoneVisual(bone, constraint);
        }
    }

    private createMaterials(): void {
        for (const axis of AXES) {
            const color = AXIS_COLORS[axis];
            this.fillMaterials[axis] = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: FILL_OPACITY,
                depthTest: false,
                side: THREE.DoubleSide,
            });
            this.outlineMaterials[axis] = new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: OUTLINE_OPACITY,
                depthTest: false,
            });
            this.disabledMaterials[axis] = new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: OUTLINE_OPACITY,
                depthTest: false,
            });
        }
    }

    private createBoneVisual(bone: any, constraint: BoneConstraint): void {
        const container = new THREE.Group();
        container.renderOrder = RENDER_ORDER;

        const axes: Record<Axis, AxisVisual> = {
            x: { fillMesh: null, outlineLine: null, disabledMarker: null },
            y: { fillMesh: null, outlineLine: null, disabledMarker: null },
            z: { fillMesh: null, outlineLine: null, disabledMarker: null },
        };

        const visual: BoneVisual = { bone, container, axes };
        this.boneVisuals.set(bone.name, visual);

        for (const axis of AXES) {
            const allowed = constraint.allowedAxes?.[axis] !== false;
            const limits = constraint.rotationLimits?.[axis];
            this.updateAxisVisual(visual, axis, allowed, limits);
        }

        if (bone.mesh) {
            bone.mesh.add(container);
        } else {
            Canvas.scene.add(container);
        }
    }

    private updateAxisVisual(
        visual: BoneVisual,
        axis: Axis,
        allowed: boolean,
        limits: { min: number; max: number } | undefined
    ): void {
        const av = visual.axes[axis];
        const container = visual.container;

        if (!allowed) {
            // Hide arcs
            if (av.fillMesh) av.fillMesh.visible = false;
            if (av.outlineLine) av.outlineLine.visible = false;

            // Show disabled marker
            if (!av.disabledMarker) {
                const geom = createDisabledMarkerGeometry();
                av.disabledMarker = new THREE.LineSegments(geom, this.disabledMaterials[axis]);
                av.disabledMarker.rotation.copy(getAxisRotation(axis));
                av.disabledMarker.renderOrder = RENDER_ORDER;
                container.add(av.disabledMarker);
            }
            av.disabledMarker.visible = true;
            return;
        }

        // Axis is enabled — hide disabled marker
        if (av.disabledMarker) av.disabledMarker.visible = false;

        const minDeg = limits?.min ?? -180;
        const maxDeg = limits?.max ?? 180;
        const isFullRange = minDeg <= -180 && maxDeg >= 180;

        if (isFullRange) {
            // Full range — outline circle only, no fill
            if (av.fillMesh) av.fillMesh.visible = false;

            if (av.outlineLine) {
                av.outlineLine.geometry.dispose();
                av.outlineLine.geometry = createCircleOutlineGeometry();
            } else {
                const geom = createCircleOutlineGeometry();
                av.outlineLine = new THREE.Line(geom, this.outlineMaterials[axis]);
                av.outlineLine.rotation.copy(getAxisRotation(axis));
                av.outlineLine.renderOrder = RENDER_ORDER;
                container.add(av.outlineLine);
            }
            av.outlineLine.visible = true;
        } else {
            // Limited range — fill wedge + outline
            const safeMin = Math.min(minDeg, maxDeg);
            const safeMax = Math.max(minDeg, maxDeg);

            // Fill
            if (av.fillMesh) {
                av.fillMesh.geometry.dispose();
                av.fillMesh.geometry = createArcFillGeometry(safeMin, safeMax);
            } else {
                const geom = createArcFillGeometry(safeMin, safeMax);
                av.fillMesh = new THREE.Mesh(geom, this.fillMaterials[axis]);
                av.fillMesh.rotation.copy(getAxisRotation(axis));
                av.fillMesh.renderOrder = RENDER_ORDER;
                container.add(av.fillMesh);
            }
            av.fillMesh.visible = true;

            // Outline
            if (av.outlineLine) {
                av.outlineLine.geometry.dispose();
                av.outlineLine.geometry = createArcOutlineGeometry(safeMin, safeMax);
            } else {
                const geom = createArcOutlineGeometry(safeMin, safeMax);
                av.outlineLine = new THREE.Line(geom, this.outlineMaterials[axis]);
                av.outlineLine.rotation.copy(getAxisRotation(axis));
                av.outlineLine.renderOrder = RENDER_ORDER;
                container.add(av.outlineLine);
            }
            av.outlineLine.visible = true;
        }
    }

    update(constraints: Record<string, BoneConstraint>): void {
        for (const bone of this.chain) {
            const visual = this.boneVisuals.get(bone.name);
            if (!visual) continue;

            const constraint = constraints[bone.name] || {};
            for (const axis of AXES) {
                const allowed = constraint.allowedAxes?.[axis] !== false;
                const limits = constraint.rotationLimits?.[axis];
                this.updateAxisVisual(visual, axis, allowed, limits);
            }
        }
    }

    dispose(): void {
        for (const [, visual] of this.boneVisuals) {
            for (const axis of AXES) {
                const av = visual.axes[axis];
                if (av.fillMesh) {
                    av.fillMesh.geometry.dispose();
                    visual.container.remove(av.fillMesh);
                }
                if (av.outlineLine) {
                    av.outlineLine.geometry.dispose();
                    visual.container.remove(av.outlineLine);
                }
                if (av.disabledMarker) {
                    av.disabledMarker.geometry.dispose();
                    visual.container.remove(av.disabledMarker);
                }
            }

            if (visual.bone.mesh) {
                visual.bone.mesh.remove(visual.container);
            } else {
                Canvas.scene.remove(visual.container);
            }
        }

        for (const axis of AXES) {
            this.fillMaterials[axis].dispose();
            this.outlineMaterials[axis].dispose();
            this.disabledMaterials[axis].dispose();
        }

        this.boneVisuals.clear();
    }
}
