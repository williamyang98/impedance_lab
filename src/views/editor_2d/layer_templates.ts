import { type LayerDescriptor, trace_alignments } from "./stackup.ts";

export type LayerTemplate = "core" | "prepreg" | "copper" | "soldermask" | "unmasked";
export const layer_templates: LayerTemplate[] = ["core", "prepreg", "copper", "soldermask", "unmasked"];

export function layer_descriptor_to_template(layer: LayerDescriptor): LayerTemplate {
  switch (layer.type) {
    case "copper": return "copper";
    case "surface": return layer.has_soldermask ? "soldermask" : "unmasked";
    case "inner": {
      for (const alignment of trace_alignments) {
        if (!layer.trace_alignments.has(alignment)) return "core"
      }
      return "prepreg";
    }
  }
}

export function layer_template_to_descriptor(layer_index: number, template: LayerTemplate): LayerDescriptor {
  switch (template) {
    case "core": return {
      type: "inner",
      trace_alignments: new Set(),
    };
    case "prepreg": return {
      type: "inner",
      trace_alignments: new Set(["top", "bottom"]),
    };
    case "copper": return {
      type: "copper",
    };
    case "soldermask": return {
      type: "surface",
      has_soldermask: true,
      trace_alignment: layer_index == 0 ? "bottom" : "top",
    };
    case "unmasked": return {
      type: "surface",
      has_soldermask: false,
      trace_alignment: layer_index == 0 ? "bottom" : "top",
    };
  }
}
