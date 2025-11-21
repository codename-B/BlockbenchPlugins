declare var Panel: any;
declare var Toolbar: any;
declare var Interface: any;
declare var Outliner: any;
declare var Group: any;
declare var Canvas: any;
declare var Blockbench: any;
declare var updateSelection: any;

import { exportAttachmentsVS } from './export_attachment_vs';
import { exportAttachmentsBB } from './export_attachment_bb';
import { deleteSection } from './delete_section';
import { findAttachments } from './discovery';

/**
 * Recursively gets all elements within a group.
 * @param {Group} group The group to traverse.
 * @returns {Array<object>} A flat array of all elements in the group.
 */
function getAllElementsInGroup(group: any) {
    const elements: any[] = [];
    function traverse(node: any) {
        elements.push(node);
        if (node instanceof Group && Array.isArray(node.children)) {
            node.children.forEach(traverse);
        }
    }
    traverse(group);
    return elements;
}

/**
 * Updates the outliner selection with the provided elements.
 * @param {Array<object>} elements The elements to select.
 */
function updateOutlinerSelection(elements: any[]) {
    Outliner.selected.empty();
    elements.forEach((element: any) => {
        Outliner.selected.safePush(element);
    });
    (updateSelection as any)();
}


const vuePanel = {
    template: `
        <div>
            <div v-if="sections.every(s => s.groups.length === 0)" class="panel_placeholder">
                <i class="material-icons">folder</i>
                <p>No attachments found in model.</p>
                <p>Create a group with a name containing one of the slot keywords (e.g., "Outerwear", "Top", "Boot").</p>
            </div>
            <div v-else>
                <div v-for="section in sections.filter(s => s.groups.length > 0)" :key="section.slot" class="attachment-section">
                    <h2 @click="toggleSection(section.slot)" :class="{ collapsed: !isSectionOpen(section.slot) }">
                        <i class="material-icons expand_icon">
                        {{ isSectionOpen(section.slot) ? 'arrow_drop_down' : 'arrow_right' }}
                        </i>
                        {{ section.slot }}
                        <span class="attachment-count">{{ section.groups.length }}</span>
                        
                        <span class="section-buttons">
                            <i class="material-icons" @click.stop="selectSection(section.groups)" title="Select all elements in this section">select_all</i>
                            <i class="material-icons" @click.stop="toggleVisibility(section.groups, !getSectionVisibility(section.groups))" :title="getSectionVisibility(section.groups) ? 'Hide all elements in this section' : 'Show all elements in this section'">
                                {{ getSectionVisibility(section.groups) ? 'visibility' : 'visibility_off' }}
                            </i>
                            <i class="material-icons" @click.stop="exportBB(section.groups)" title="Export to .bbmodel">save</i>
                            <i class="material-icons" @click.stop="exportVS(section.groups)" title="Export as VS .json">file_download</i>
                            <i class="material-icons" @click.stop="deleteSection(section.groups)" title="Delete all elements in this section">delete</i>
                        </span>
                    </h2>
                    <ul v-if="isSectionOpen(section.slot)">
                        <li v-for="group in section.groups" 
                            :key="group.uuid"
                            :class="{ selected: isSelected(group) }"
                            class="outliner_object"
                            @click="selectGroup(group)">
                            
                            <span class="outliner_object_name">
                                <i class="icon material-icons">folder</i>
                                {{ group.name }}
                            </span>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    `,
    data: () => ({
        sections: [],
        openSections: []
    }),
    methods: {
        /**
         * Exports the given groups to a .bbmodel file.
         * @param {Array<Group>} groups The groups to export.
         */
        exportBB(groups: any[]) {
            exportAttachmentsBB(groups);
        },
        /**
         * Exports the given groups to a Vintage Story .json file.
         * @param {Array<Group>} groups The groups to export.
         */
        exportVS(groups: any[]) {
            exportAttachmentsVS(groups);
        },
        /**
         * Deletes the given groups from the project.
         * @param {Array<Group>} groups The groups to delete.
         */
        deleteSection(groups: any[]) {
            deleteSection(groups);
        },
        /**
         * Updates the list of attachments by calling the discovery function.
         */
        updateAttachments() {
            (this as any).sections = findAttachments();
        },
        /**
         * Toggles the visibility of a section in the panel.
         * @param {string} slot The slot name of the section to toggle.
         */
        toggleSection(slot: string) {
            const index = (this as any).openSections.indexOf(slot);
            if (index > -1) {
                (this as any).openSections.splice(index, 1);
            } else {
                (this as any).openSections.push(slot);
            }
        },
        /**
         * Checks if a section is open in the panel.
         * @param {string} slot The slot name of the section.
         * @returns {boolean} True if the section is open, false otherwise.
         */
        isSectionOpen(slot: string) {
            return (this as any).openSections.includes(slot);
        },
        /**
         * Selects all elements within a group.
         * @param {Group} group The group to select.
         */
        selectGroup(group: any) {
            const allElements = getAllElementsInGroup(group);
            updateOutlinerSelection(allElements);
        },
        /**
         * Checks if a group is selected in the outliner.
         * @param {Group} group The group to check.
         * @returns {boolean} True if the group is selected, false otherwise.
         */
        isSelected(group: any) {
            return Outliner.selected.includes(group);
        },
        /**
         * Toggles the visibility of all elements in the given groups.
         * @param {Array<Group>} groups The groups to toggle visibility for.
         * @param {boolean} isVisible The desired visibility state.
         */
        toggleVisibility(groups: any[], isVisible: boolean) {
            groups.forEach(group => {
                (this as any)._walk(group, (node: any) => {
                    if (typeof node.toggleVisibility === 'function') {
                        if (node.visibility !== isVisible) node.toggleVisibility(isVisible);
                    } else if ('visibility' in node) {
                        node.visibility = isVisible;
                    }
                });
            });
            Canvas.updateVisibility?.();
            Canvas.updateAll?.();
        },
        /**
         * Traverses a node and its children, applying a callback to each.
         * @param {object} node The node to start traversal from.
         * @param {function} callback The function to apply to each node.
         */
        _walk(node: any, callback: (n: any) => {}) {
            callback(node);
            if (node instanceof Group && Array.isArray(node.children)) {
                node.children.forEach(child => (this as any)._walk(child, callback));
            }
        },
        /**
         * Selects all elements in all groups of a section.
         * @param {Array<Group>} groups The groups in the section.
         */
        selectSection(groups: any[]) {
            const allElements = groups.flatMap(group => getAllElementsInGroup(group));
            updateOutlinerSelection(allElements);
        },
        /**
         * Gets the visibility state of a section.
         * @param {Array<Group>} groups The groups in the section.
         * @returns {boolean} True if all groups are visible, false otherwise.
         */
        getSectionVisibility(groups: any[]) {
            return groups.every(group => group.visibility);
        }
    },
    mounted() {
        (this as any).refresh = () => (this as any).updateAttachments();
        (this as any).refresh();

        (this as any)._bbListeners = [
            ['update_outliner', (this as any).refresh],
            ['load_project', (this as any).refresh],
            ['select_project', (this as any).refresh],
            ['new_project', (this as any).refresh],
            ['update_selection', (this as any).refresh],
            ['undo', (this as any).refresh],
            ['redo', (this as any).refresh]
        ];

        (this as any)._bbListeners.forEach(([evt, fn]: [string, any]) => Blockbench.on(evt, fn));
    },
    beforeUnmount() {
        if ((this as any)._bbListeners) {
            (this as any)._bbListeners.forEach(([evt, fn]: [string, any]) => Blockbench.removeListener(evt, fn));
        }
    },
    // Vue 2 compatibility
    beforeDestroy() {
        if ((this as any)._bbListeners) {
            (this as any)._bbListeners.forEach(([evt, fn]: [string, any]) => Blockbench.removeListener(evt, fn));
        }
    }
};

/**
 * Creates and configures the Attachments panel.
 * @param {object} import_action - The import action
 * @returns {Panel} A new Blockbench Panel instance.
 */
export function createAttachmentsPanel(actions: any) {
    const toolbar = new Toolbar('attachments_toolbar', {
        children: []
    });

    // Add the action to the toolbar
    if (actions.importBB) {
        toolbar.add(actions.importBB);
    }
    if (actions.importVS) {
        toolbar.add(actions.importVS);
    }

    console.log('Toolbar created:', toolbar);
    console.log('Toolbar children after add:', toolbar.children);

    const panel = new Panel('attachments_panel', {
        name: 'Attachments',
        icon: 'attach_file',
        default_position: {
            slot: 'right_bar',
            float_position: [0, 0],
            float_size: [300, 400],
            height: 400
        },
        toolbars: [toolbar],
        component: vuePanel
    });

    // Store reference in Interface.Panels for easy access
    Interface.Panels.attachments_panel = panel;

    console.log('Attachments panel created:', panel);

    return panel;
}
