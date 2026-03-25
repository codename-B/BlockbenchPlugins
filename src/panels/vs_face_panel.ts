import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";

const WIND_MODE_OPTIONS: Record<string, string> = {
    '': 'Default',
    '0': 'NoWind',
    '1': 'WeakWind',
    '2': 'NormalWind',
    '3': 'Leaves',
    '4': 'Bend',
    '5': 'TallBend',
    '6': 'Water',
    '7': 'ExtraWeakWind',
    '8': 'Fruit',
    '9': 'WeakWindNoBend',
    '10': 'Vines',
    '11': 'Seaweed',
    '12': 'WaterWaves',
    '13': 'WeakWindReducedAlpha',
};

const REFLECTIVE_MODE_OPTIONS: Record<string, string> = {
    '0': 'None',
    '1': 'Weak',
    '2': 'Medium',
    '3': 'Strong',
    '4': 'Sparkly',
    '5': 'Mild',
};

const FACE_DIRECTIONS = ['north', 'east', 'south', 'west', 'up', 'down'] as const;

/**
 * Returns the 4 vertex positions for a given face direction on a cube.
 * Order matches VS Model Creator's CubeVertices array (Face.java).
 * Maps unit cube (-1,-1,-1)→(1,1,1) to Blockbench cube from→to.
 */
function getFaceVertices(cube: Cube, direction: string): [number, number, number][] {
    const [x1, y1, z1] = cube.from;
    const [x2, y2, z2] = cube.to;

    switch (direction) {
        case 'north': return [[x1,y1,z1], [x1,y2,z1], [x2,y2,z1], [x2,y1,z1]];
        case 'east':  return [[x2,y1,z1], [x2,y2,z1], [x2,y2,z2], [x2,y1,z2]];
        case 'south': return [[x1,y1,z2], [x2,y1,z2], [x2,y2,z2], [x1,y2,z2]];
        case 'west':  return [[x1,y1,z1], [x1,y1,z2], [x1,y2,z2], [x1,y2,z1]];
        case 'up':    return [[x1,y2,z1], [x1,y2,z2], [x2,y2,z2], [x2,y2,z1]];
        case 'down':  return [[x1,y1,z1], [x2,y1,z1], [x2,y1,z2], [x1,y1,z2]];
        default:      return [[0,0,0], [0,0,0], [0,0,0], [0,0,0]];
    }
}

// Vertex highlight dot — shared THREE.js objects
let vertexDot: any = null;

function createVertexDot() {
    if (vertexDot) return;
    // @ts-expect-error: THREE is global in Blockbench
    const geo = new THREE.SphereGeometry(0.5, 8, 8);
    // @ts-expect-error: THREE is global in Blockbench
    const mat = new THREE.MeshBasicMaterial({ color: 0xff4444, depthTest: false, transparent: true, opacity: 0.9 });
    // @ts-expect-error: THREE is global in Blockbench
    vertexDot = new THREE.Mesh(geo, mat);
    vertexDot.renderOrder = 999;
    vertexDot.visible = false;
}

function showVertexDot(cube: Cube, direction: string, vertexIndex: number) {
    createVertexDot();
    const vertices = getFaceVertices(cube, direction);
    const pos = vertices[vertexIndex];
    if (!pos) return;

    // Convert absolute position to mesh-local space (relative to cube's origin/pivot),
    // then transform to world space via the mesh's matrix (handles rotation + parent groups)
    // @ts-expect-error: THREE is global in Blockbench
    const localPos = new THREE.Vector3(
        pos[0] - cube.origin[0],
        pos[1] - cube.origin[1],
        pos[2] - cube.origin[2]
    );

    // @ts-expect-error: mesh access
    if (cube.mesh) {
        // @ts-expect-error: mesh access
        cube.mesh.updateMatrixWorld();
        // @ts-expect-error: mesh access
        const worldPos = cube.mesh.localToWorld(localPos);
        vertexDot.position.copy(worldPos);
    } else {
        vertexDot.position.set(pos[0], pos[1], pos[2]);
    }

    vertexDot.visible = true;

    // @ts-expect-error: scene access
    if (!vertexDot.parent) {
        Canvas.scene.add(vertexDot);
    }
}

function hideVertexDot() {
    if (vertexDot) {
        vertexDot.visible = false;
    }
}

function removeVertexDot() {
    if (vertexDot) {
        if (vertexDot.parent) vertexDot.parent.remove(vertexDot);
        vertexDot.geometry.dispose();
        vertexDot.material.dispose();
        vertexDot = null;
    }
}

const vueComponent = {
    template: `
        <div>
            <p v-if="!hasFace" class="panel_message">Select a face to edit VS properties</p>
            <div v-else>
                <div class="vs_face_props_header">
                    <label class="vs_face_props_face_label">{{ selectedFaceName }}</label>
                    <label class="vs_face_props_apply_all">
                        <input type="checkbox" v-model="applyToAll"> All faces
                    </label>
                </div>

                <div class="vs_face_props_section">
                    <label class="vs_face_props_label">Glow Level</label>
                    <input type="number" class="dark_bordered" min="0" max="255" step="1"
                        :value="glow" @input="setGlow($event.target.value)">
                </div>

                <div class="vs_face_props_section">
                    <label class="vs_face_props_label">Reflective Mode</label>
                    <select class="dark_bordered" :value="reflectiveMode" @change="setReflectiveMode($event.target.value)">
                        <option v-for="(label, value) in reflectiveModeOptions" :value="value" :key="value">{{ label }}</option>
                    </select>
                </div>

                <div class="vs_face_props_section">
                    <label class="vs_face_props_label">Wind Mode</label>
                    <div class="vs_face_props_vector4">
                        <select v-for="i in 4" :key="'wm'+i" class="dark_bordered vs_face_props_v4_input"
                            :value="getWindModeComponent(i-1)" @change="setWindModeComponent(i-1, $event.target.value)"
                            @mouseenter="highlightVertex(i-1)" @mouseleave="clearVertex()"
                            @focus="highlightVertex(i-1)" @blur="clearVertex()">
                            <option v-for="(label, value) in windModeOptions" :value="value" :key="value">{{ label }}</option>
                        </select>
                    </div>
                </div>

                <div class="vs_face_props_section">
                    <label class="vs_face_props_label">Wind Data</label>
                    <div class="vs_face_props_vector4">
                        <input v-for="i in 4" :key="'wd'+i" type="number" class="dark_bordered vs_face_props_v4_input"
                            :value="getWindDataComponent(i-1)" @input="setWindDataComponent(i-1, $event.target.value)"
                            @mouseenter="highlightVertex(i-1)" @mouseleave="clearVertex()"
                            @focus="highlightVertex(i-1)" @blur="clearVertex()">
                    </div>
                </div>
            </div>
        </div>
    `,
    data() {
        return {
            selectedCube: null as Cube | null,
            selectedFaceName: '' as string,
            applyToAll: false,
            glow: 0,
            reflectiveMode: '0',
            windMode: [null, null, null, null] as (number | null)[],
            windData: [0, 0, 0, 0] as number[],
            windModeOptions: WIND_MODE_OPTIONS,
            reflectiveModeOptions: REFLECTIVE_MODE_OPTIONS,
            _listeners: [] as Array<() => void>,
        };
    },
    computed: {
        hasFace(): boolean {
            return !!(this as any).selectedCube && !!(this as any).selectedFaceName;
        }
    },
    methods: {
        getSelectedFace(): any | null {
            const self = this as any;
            if (!self.selectedCube || !self.selectedFaceName) return null;
            return self.selectedCube.faces[self.selectedFaceName];
        },

        getTargetFaces(): Array<{ face: any, direction: string }> {
            const self = this as any;
            if (!self.selectedCube) return [];
            if (self.applyToAll) {
                return FACE_DIRECTIONS
                    .filter(d => self.selectedCube.faces[d])
                    .map(d => ({ face: self.selectedCube.faces[d], direction: d }));
            }
            const face = self.getSelectedFace();
            if (!face) return [];
            return [{ face, direction: self.selectedFaceName }];
        },

        highlightVertex(index: number) {
            const self = this as any;
            if (self.selectedCube && self.selectedFaceName) {
                showVertexDot(self.selectedCube, self.selectedFaceName, index);
            }
        },

        clearVertex() {
            hideVertexDot();
        },

        setGlow(value: string) {
            const num = Math.max(0, Math.min(255, parseInt(value) || 0));
            (this as any).glow = num;
            for (const { face } of (this as any).getTargetFaces()) {
                face.glow = num;
            }
        },

        setReflectiveMode(value: string) {
            const num = parseInt(value) || 0;
            (this as any).reflectiveMode = String(num);
            for (const { face } of (this as any).getTargetFaces()) {
                face.reflectiveMode = num;
            }
        },

        getWindModeComponent(index: number): string {
            const val = (this as any).windMode[index];
            return val === null || val === undefined ? '' : String(val);
        },

        setWindModeComponent(index: number, value: string) {
            const self = this as any;
            const num = value === '' ? null : parseInt(value);
            self.windMode[index] = num;
            // Force reactivity
            self.windMode = [...self.windMode];

            for (const { face } of self.getTargetFaces()) {
                if (!face.windMode) {
                    face.windMode = [0, 0, 0, 0];
                }
                face.windMode[index] = num ?? 0;
                // If all components are 0/null, clear windMode
                if (face.windMode.every((v: number) => v === 0)) {
                    face.windMode = undefined;
                }
            }
        },

        getWindDataComponent(index: number): number {
            return (this as any).windData[index] || 0;
        },

        setWindDataComponent(index: number, value: string) {
            const self = this as any;
            const num = parseInt(value) || 0;
            self.windData[index] = num;
            // Force reactivity
            self.windData = [...self.windData];

            for (const { face } of self.getTargetFaces()) {
                if (!face.windData) {
                    face.windData = [0, 0, 0, 0];
                }
                face.windData[index] = num;
                // If all components are 0, clear windData
                if (face.windData.every((v: number) => v === 0)) {
                    face.windData = undefined;
                }
            }
        },

        loadFromFace() {
            const self = this as any;
            const face = self.getSelectedFace();
            if (!face) {
                self.glow = 0;
                self.reflectiveMode = '0';
                self.windMode = [null, null, null, null];
                self.windData = [0, 0, 0, 0];
                return;
            }
            self.glow = face.glow || 0;
            self.reflectiveMode = String(face.reflectiveMode || 0);
            self.windMode = face.windMode ? [...face.windMode] : [null, null, null, null];
            self.windData = face.windData ? [...face.windData] : [0, 0, 0, 0];
        },

        getSelectedFaceName(): string {
            // @ts-expect-error: UVEditor types incomplete
            const selectedFaces = UVEditor?.vue?.selected_faces;
            if (selectedFaces && selectedFaces.length > 0) {
                return selectedFaces[0];
            }
            return 'north';
        },

        updateSelection() {
            const self = this as any;
            hideVertexDot();

            // Find selected cube
            const selected = Cube.selected;
            if (!selected || selected.length === 0) {
                self.selectedCube = null;
                self.selectedFaceName = '';
                return;
            }
            self.selectedCube = selected[0];
            self.selectedFaceName = self.getSelectedFaceName();
            self.loadFromFace();
        },

        // Polls for face selection changes (UV editor doesn't fire events for face clicks)
        pollFaceSelection() {
            const self = this as any;
            if (!self.selectedCube) return;
            const currentFace = self.getSelectedFaceName();
            if (currentFace !== self.selectedFaceName) {
                self.selectedFaceName = currentFace;
                self.loadFromFace();
            }
        }
    },
    mounted() {
        const self = this as any;
        self.updateSelection();

        // Listen for element selection changes
        const onSelectionUpdate = () => self.updateSelection();
        Blockbench.on('update_selection' as EventName, onSelectionUpdate);
        Blockbench.on('update_faces' as EventName, onSelectionUpdate);

        // Poll for face selection changes (UV editor face clicks don't fire events)
        const pollInterval = setInterval(() => self.pollFaceSelection(), 100);

        self._listeners = [
            () => Blockbench.removeListener('update_selection' as EventName, onSelectionUpdate),
            () => Blockbench.removeListener('update_faces' as EventName, onSelectionUpdate),
            () => clearInterval(pollInterval),
        ];
    },
    beforeDestroy() {
        const self = this as any;
        hideVertexDot();
        for (const unsub of self._listeners) {
            unsub();
        }
    }
};

let panel: Panel | null = null;

createBlockbenchMod(
    `${PACKAGE.name}:vs_face_panel`,
    {},
    () => {
        panel = new Panel('vs_face_properties', {
            name: 'VS Face Properties',
            icon: 'grain',
            condition: () => Format?.id === 'formatVS',
            default_position: {
                slot: 'right_bar',
                float_position: [0, 0],
                float_size: [300, 300],
                height: 300
            },
            component: vueComponent
        });

        // Add CSS styles
        const style = document.createElement('style');
        style.id = 'vs-face-panel-styles';
        style.textContent = `
            .vs_face_props_header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 4px 8px;
                border-bottom: 1px solid var(--color-border);
                margin-bottom: 6px;
            }
            .vs_face_props_face_label {
                font-weight: bold;
                text-transform: capitalize;
            }
            .vs_face_props_apply_all {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
                cursor: pointer;
            }
            .vs_face_props_section {
                padding: 2px 8px;
                margin-bottom: 4px;
            }
            .vs_face_props_label {
                display: block;
                font-size: 12px;
                color: var(--color-subtle_text);
                margin-bottom: 2px;
            }
            .vs_face_props_section input[type="number"],
            .vs_face_props_section select {
                width: 100%;
                box-sizing: border-box;
            }
            .vs_face_props_vector4 {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 4px;
            }
            .vs_face_props_v4_input {
                width: 100% !important;
                box-sizing: border-box;
            }
            .panel_message {
                padding: 8px;
                color: var(--color-subtle_text);
                text-align: center;
            }
        `;
        document.head.appendChild(style);

        return { panel, style };
    },
    (context) => {
        context.panel?.delete();
        removeVertexDot();
        const style = document.getElementById('vs-face-panel-styles');
        if (style) style.remove();
    }
);
