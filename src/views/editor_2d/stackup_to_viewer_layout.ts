import {
  type TraceAlignment, type TraceType, type SpacingType,
  type LayoutItem,
  type Stackup,
  StackupRules,
} from "./stackup.ts";
import {
  type ViewerLayout, type LayoutElement, type LayerElement, type TraceElement,
} from "./viewer_layout.ts";
import { Editor } from "./editor.ts";

export interface AnnotationConfig {
  trace_width: (index: number, type: TraceType) => string;
  trace_taper: (index: number, type: TraceType) => string;
  separation_width: (index: number, type: SpacingType) => string;
  layer_dielectric_height: (layer_index: number) => string;
  layer_epsilon: (layer_index: number) => string;
  layer_trace_height: (layer_index: number, alignment: TraceAlignment) => string;
}

export function get_default_annotation_config(): AnnotationConfig {
  return {
    trace_width(_index: number, type: TraceType): string {
      switch (type) {
        case "signal": return "W";
        case "ground": return "CW";
      }
    },
    trace_taper(_index: number, type: TraceType): string {
      switch (type) {
        case "signal": return "W1";
        case "ground": return "CW1";
      }
    },
    separation_width(_index: number, type: SpacingType): string {
      switch (type) {
        case "signal": return "S";
        case "ground": return "CS";
        case "broadside": return "S";
      }
    },
    layer_dielectric_height(layer_index: number): string {
      return `H${layer_index+1}`;
    },
    layer_epsilon(layer_index: number): string {
      return `ER${layer_index+1}`;
    },
    layer_trace_height(_layer_index: number, _alignment: TraceAlignment): string {
      return "T";
    },
  }
}

export function get_layout_elements_from_layout_items(
  items: LayoutItem[], config: AnnotationConfig,
): LayoutElement[] {
  const elements: LayoutElement[] = [];
  let trace_index = 0;
  for (const item of items) {
    switch (item.type) {
      case "trace": {
        elements.push({
          type: "trace",
          width: item.trace,
          annotation: {
            width: config.trace_width(trace_index, item.trace),
            taper: config.trace_taper(trace_index, item.trace),
          },
        });
        trace_index++;
        break;
      }
      case "spacing": {
        elements.push({
          type: "spacing",
          width: item.spacing,
          annotation: {
            width: config.separation_width(trace_index-1, item.spacing),
          },
        });
        break;
      }
    }
  }
  return elements;
}

export function get_viewer_layout_from_stackup(
  stackup: Stackup,
  config: AnnotationConfig,
  create_trace_element?: (layer_index: number, trace_index: number, alignment: TraceAlignment) => TraceElement,
): ViewerLayout {
  const { trace_layout, layers } = stackup;
  const traces = StackupRules.get_traces_from_trace_layout(trace_layout);
  const total_traces = traces.length;

  // default trace element creator
  create_trace_element ||= (layer_index: number, trace_index: number, alignment: TraceAlignment) => {
    const layer = layers[layer_index];
      if (StackupRules.is_voltage_in_layer(layer, trace_layout, trace_index, alignment)) {
        return { type: "solid" };
      }
      return null;
  };

  const create_trace_elements = (layer_index: number, alignment: TraceAlignment): TraceElement[] => {
    const trace_infos: TraceElement[] = [];
    for (let trace_index = 0; trace_index < total_traces; trace_index++) {
      trace_infos.push(create_trace_element(layer_index, trace_index, alignment));
    }
    return trace_infos;
  };

  const total_layers = layers.length;
  const layer_elements: LayerElement[] = [];
  for (let layer_index = 0; layer_index < total_layers; layer_index++) {
    const layer = layers[layer_index];
    switch (layer.type) {
      case "copper": {
        layer_elements.push({ type: "copper" });
        break;
      }
      case "surface": {
        layer_elements.push({
          type: "surface",
          has_soldermask: layer.has_soldermask,
          alignment: layer.trace_alignment,
          trace_elements: create_trace_elements(layer_index, layer.trace_alignment),
          annotation: {
            soldermask_height: layer.has_soldermask ? config.layer_dielectric_height(layer_index) : undefined,
            epsilon: config.layer_epsilon(layer_index),
            trace_height: config.layer_trace_height(layer_index, layer.trace_alignment),
          },
        })
        break;
      }
      case "inner": {
        const traces: Partial<Record<TraceAlignment, TraceElement[]>> = {};
        const trace_heights: Partial<Record<TraceAlignment, string>> = {};
        for (const alignment of layer.trace_alignments) {
          const trace_infos = create_trace_elements(layer_index, alignment);
          const total_traces_present = trace_infos.filter(info => info != null).length;
          if (total_traces_present > 0) {
            traces[alignment] = trace_infos;
            trace_heights[alignment] = config.layer_trace_height(layer_index, alignment);
          }
        }
        layer_elements.push({
          type: "inner",
          trace_elements: traces,
          annotation: {
            dielectric_height: config.layer_dielectric_height(layer_index),
            epsilon: config.layer_epsilon(layer_index),
            trace_heights,
          },
        });
        break;
      }
    }
  }

  const layout_items = StackupRules.get_layout_items_from_trace_layout(trace_layout);
  const layout_elements = get_layout_elements_from_layout_items(layout_items, config);
  return {
    layout_elements: layout_elements,
    layer_elements: layer_elements,
  };
}

export function get_viewer_layout_from_editor(editor: Editor, config: AnnotationConfig): ViewerLayout {
  const create_trace_element = (layer_index: number, trace_index: number, alignment: TraceAlignment): TraceElement => {
    if (editor.is_trace_in_layer(layer_index, trace_index, alignment)) {
      return { type: "solid" };
    }
    if (editor.can_move_trace_here(layer_index, trace_index, alignment)) {
      return {
        type: "selectable",
        on_click: () => editor.move_trace_here(layer_index, trace_index, alignment),
      }
    }
    return null;
  };
  return get_viewer_layout_from_stackup(editor, config, create_trace_element);
}
