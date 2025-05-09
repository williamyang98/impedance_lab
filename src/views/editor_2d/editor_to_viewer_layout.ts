import { Editor } from "./editor.ts";
import { type TraceAlignment, type TraceType, StackupRules } from "./stackup.ts";
import { type LayoutInfo, type LayoutElement, type LayerInfo, type TraceInfo } from "./viewer_layout.ts";

export function get_layout_elements_from_traces(traces: TraceType[]): LayoutElement[] {
  const elements: LayoutElement[] = [];
  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i];
    const next_trace = (i < traces.length-1) ? traces[i+1] : null;
    elements.push({ type: "trace", trace })
    if (next_trace == null) continue;
    if (trace == "signal" && next_trace == "signal") {
      elements.push({ type: "spacing", separation: "signal" });
    } else {
      elements.push({ type: "spacing", separation: "ground" });
    }
  }
  return elements;
}

export function get_layout_info_from_editor(editor: Editor): LayoutInfo {
  function create_trace(layer_index: number, trace_index: number, alignment: TraceAlignment): TraceInfo {
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

  const trace_layout = editor.trace_layout;
  const traces = StackupRules.get_traces_from_trace_layout(trace_layout);
  const total_traces = traces.length;
  const trace_indices = [];
  for (let i = 0; i < total_traces; i++) {
    trace_indices.push(i);
  }

  const total_layers = editor.layers.length;
  const layer_infos: LayerInfo[] = [];
  for (let layer_index = 0; layer_index < total_layers; layer_index++) {
    const layer = editor.layers[layer_index];
    switch (layer.type) {
      case "copper": {
        layer_infos.push({ type: "copper" });
        break;
      }
      case "surface": {
        const alignment: TraceAlignment = (layer_index == 0) ? "bottom" : "top";
        const has_soldermask = layer.has_soldermask;
        layer_infos.push({
          type: "surface",
          has_soldermask,
          alignment,
          traces: trace_indices.map(trace_index => create_trace(layer_index, trace_index, alignment)),
        })
        break;
      }
      case "inner": {
        layer_infos.push({
          type: "inner",
          traces: {
            top: trace_indices.map(trace_index => create_trace(layer_index, trace_index, "top")),
            bottom: trace_indices.map(trace_index => create_trace(layer_index, trace_index, "bottom")),
          }
        });
        break;
      }
    }
  }

  const layout_elements = get_layout_elements_from_traces(traces);
  return {
    elements: layout_elements,
    layers: layer_infos,
  };
}
