declare var Codec: any;
declare var Project: any;
declare var Texture: any;
declare var Cube: any;
declare var Group: any;
declare var Outliner: any;
declare var Format: any;
declare var Blockbench: any;

declare function compileJSON(model: any): string;

export function createExportCodec() {
    function compileGroupsFrom(rootGroups: any[], undo: boolean) {
        var result: any[] = [];
        function iterate(array: any[], save_array: any[]) {
            for (var element of array) {
                if (element.type === 'group') {
                    var obj = element.compile(undo);
                    if (element.children.length > 0) {
                        iterate(element.children, obj.children);
                    }
                    save_array.push(obj);
                } else {
                    save_array.push(element.uuid);
                }
            }
        }
        iterate(rootGroups, result);
        return result;
    }

    // Recursive function to collect all nested elements
    function collectAllElements(nodes: any[]) {
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
            var model: any = {
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
    
            // Use the recursive function to collect all nested elements
            const allElements = collectAllElements(selection);
    
            // Add all cubes to the model, regardless of nesting level
            allElements.forEach(el => {
                if (el instanceof Cube) {
                    model.elements.push(el.getSaveCopy());
                }
            });
    
            model.outliner = compileGroupsFrom(selection, true);
    
            model.textures = [];
            Texture.all.forEach(tex => {
                var t: any = tex.getUndoCopy();
                t.source = 'data:image/png;base64,'+tex.getBase64();
                t.mode = 'bitmap';
                model.textures.push(t);
            });
    
            return compileJSON(model);
        }
    });
}
