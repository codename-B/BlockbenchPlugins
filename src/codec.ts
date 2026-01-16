import { ex } from "./export";
import { im } from "./import";
import { schema } from "./generated/vs_shape_schema";
import Ajv from "ajv";
import { VS_Shape } from "./vs_shape_def";
import JSON5 from "json5";

export const codecVS = new Codec("codecVS", {
    name: "Vintage Story Codec",
    extension: "json",
    remember: true,
    load_filter: {
        extensions: ["json"],
        type: 'text',
        condition(model) {
            const content = JSON5.parse(model);
            if (!content || typeof content !== 'object') return false;
            if (!content.elements || !Array.isArray(content.elements)) return false;
            if (!content.textures || typeof content.textures !== 'object') return false;
            return validate_json(content);
        }
    },
    compile(options) {
        return autoStringify(ex(options));
    },
    parse(data, file_path, _add) {
        im(JSON5.parse(data) as VS_Shape, file_path, false);
    },
});

function validate_json(content) {
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const valid = validate(content);
    if (!valid) console.log(validate.errors);
    return valid;
}