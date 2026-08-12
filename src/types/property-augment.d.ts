/**
 * blockbench-types omits `PropertyOptions.inputs` (which Blockbench uses to render a property
 * as a field in the element panel) and `PropertyOptions.onChange`. Declared here so the VS
 * property definitions typecheck.
 */

interface PropertyPanelInput {
    label?: string;
    type?: string;
    options?: Record<string, string> | (() => Record<string, string>);
}

declare global {
    interface PropertyOptions {
        inputs?: Record<string, { input: PropertyPanelInput }>;
        onChange?(this: any, value?: any): void;
    }
}

export {};
