export function createExportCodec() {
    /**
     * Compiles groups for the outliner, preserving clothingSlot only on root groups.
     * Also sets stepParentName on root groups so they can be correctly placed in hierarchy on import.
     * @param rootGroups The root groups being exported (these should keep clothingSlot)
     * @param undo Whether this is for undo purposes
     * @param rootGroupUuids Set of UUIDs for root groups that should keep clothingSlot
     * @param parentNameMap Map of root group UUIDs to their original parent group names
     */
    function compileGroupsFrom(rootGroups: any[], undo: boolean, rootGroupUuids: Set<string>, parentNameMap: Map<string, string>): any[] {
        const result: any[] = [];
        function iterate(array: any[], save_array: any[], isRoot: boolean = false) {
            for (const element of array) {
                if (element.type === 'group') {
                    const obj = element.compile(undo);
                    // Only preserve clothingSlot on root attachment groups
                    // Clear it from nested groups to prevent duplicate attachment detection on import
                    if (!rootGroupUuids.has(element.uuid)) {
                        delete obj.clothingSlot;
                    }
                    // Set stepParentName on root groups so they can be placed correctly on import
                    // This tells the importer where this group should go in the target model's hierarchy
                    if (isRoot && rootGroupUuids.has(element.uuid)) {
                        const parentName = parentNameMap.get(element.uuid);
                        if (parentName) {
                            obj.stepParentName = parentName;
                        }
                    }
                    if (element.children.length > 0) {
                        iterate(element.children, obj.children, false);
                    }
                    save_array.push(obj);
                } else {
                    save_array.push(element.uuid);
                }
            }
        }
        iterate(rootGroups, result, true);
        return result;
    }

    // Recursive function to collect all nested elements
    function collectAllElements(nodes: any[]): any[] {
        const allElements: any[] = [];

        function traverse(node: any) {
            allElements.push(node);
            if (node.children && node.children.length > 0) {
                node.children.forEach((child: any) => traverse(child));
            }
        }

        nodes.forEach(node => traverse(node));
        return allElements;
    }

    /**
     * Collects all texture UUIDs used by the given cubes
     * @param cubes Array of cubes to check
     * @returns Set of texture UUIDs that are referenced by the cubes
     */
    function collectUsedTextureUuids(cubes: any[]): Set<string> {
        const usedUuids = new Set<string>();

        for (const cube of cubes) {
            if (!cube.faces) continue;

            for (const faceKey in cube.faces) {
                const face = cube.faces[faceKey];
                if (face && face.texture !== undefined && face.texture !== null) {
                    // face.texture can be a texture index or UUID
                    // Get the actual texture to find its UUID
                    const tex = Texture.all[face.texture] || Texture.all.find((t: any) => t.uuid === face.texture);
                    if (tex) {
                        usedUuids.add(tex.uuid);
                    }
                }
            }
        }

        return usedUuids;
    }

    return new Codec('projectSelection', {
        name: 'Blockbench Project Selection',
        extension: 'bbmodel',
        remember: true,
        export(selection: any[]) {
            Blockbench.export({
                resource_id: 'model',
                type: this.name,
                extensions: [this.extension],
                name: `${selection[0].name}_attachment.bbmodel`,
                startpath: this.startPath(),
                content: this.compile(selection)
            });
        },
        compile(selection: any[], options?: any) {
            if (!options) options = {};
            const model: any = {
                meta: {
                    format_version: '4.5',
                    model_format: Format.id,
                    box_uv: Project.box_uv
                },
                resolution: {
                    width: Project.texture_width || 16,
                    height: Project.texture_height || 16,
                },
                elements: [],
                outliner: []
            };

            // Track root group UUIDs - these are the groups that should keep their clothingSlot
            // Also track their parent names for correct hierarchy placement on import
            const rootGroupUuids = new Set<string>();
            const parentNameMap = new Map<string, string>();
            selection.forEach(el => {
                if (el instanceof Group) {
                    rootGroupUuids.add(el.uuid);
                    // Store the parent group name so the importer knows where to place this group
                    if (el.parent && el.parent instanceof Group) {
                        parentNameMap.set(el.uuid, el.parent.name);
                    }
                }
            });

            // Use the recursive function to collect all nested elements
            const allElements = collectAllElements(selection);

            // Collect all cubes from the selection
            // Strip clothingSlot from cubes to prevent them from being detected as individual attachments on import
            const cubes: any[] = [];
            allElements.forEach(el => {
                if (el instanceof Cube) {
                    cubes.push(el);
                    const saveCopy = el.getSaveCopy();
                    // Remove clothingSlot from cubes - they inherit from their parent group
                    delete saveCopy.clothingSlot;
                    model.elements.push(saveCopy);
                }
            });

            model.outliner = compileGroupsFrom(selection, true, rootGroupUuids, parentNameMap);

            // Only export textures that are actually used by the selected elements
            const usedTextureUuids = collectUsedTextureUuids(cubes);
            model.textures = [];
            Texture.all.forEach((tex: any) => {
                if (usedTextureUuids.has(tex.uuid)) {
                    const t: any = tex.getUndoCopy();
                    t.source = 'data:image/png;base64,' + tex.getBase64();
                    t.mode = 'bitmap';
                    model.textures.push(t);
                }
            });

            return compileJSON(model);
        }
    });
}
