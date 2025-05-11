import { Editor } from "./editor.ts";
import { type TraceAlignment, type TraceType, type TraceLayoutType, StackupRules } from "./stackup.ts";
import { type LayoutInfo, type LayoutElement, type LayerInfo, type TraceInfo } from "./viewer_layout.ts";

function get_layout_elements_from_traces(traces: TraceType[], type: TraceLayoutType): LayoutElement[] {
  const elements: LayoutElement[] = [];
  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i];
    const next_trace = (i < traces.length-1) ? traces[i+1] : null;
    switch (trace) {
      case "ground": {
        elements.push({ type: "trace", width: "ground", annotation: { width: "CW", taper: "CW1" } });
        break;
      }
      case "signal": {
        elements.push({ type: "trace", width: "signal", annotation: { width: "W", taper: "W1" } });
        break;
      }
    }
    if (next_trace == null) continue;
    if (trace == "signal" && next_trace == "signal") {
      if (type != "broadside_pair") {
        elements.push({ type: "spacing", width: "signal", annotation: { width: "S" } });
      } else {
        elements.push({ type: "spacing", width: "broadside", annotation: { width: "S" } });
      }
    } else {
      elements.push({ type: "spacing", width: "ground", annotation: { width: "CS"} });
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
        const has_soldermask = layer.has_soldermask;
        layer_infos.push({
          type: "surface",
          has_soldermask,
          alignment: layer.trace_alignment,
          traces: trace_indices.map(trace_index => create_trace(layer_index, trace_index, layer.trace_alignment)),
          annotation: {
            soldermask_height: has_soldermask ? `H${layer_index}` : undefined,
            epsilon: `ER${layer_index}`,
            trace_height: "T",
          },
        })
        break;
      }
      case "inner": {
        const traces: Partial<Record<TraceAlignment, TraceInfo[]>> = {};
        const trace_heights: Partial<Record<TraceAlignment, string>> = {};
        for (const alignment of layer.trace_alignments) {
          const trace_infos = trace_indices.map(trace_index => create_trace(layer_index, trace_index, alignment));
          const has_trace_infos = trace_infos.filter(info => info != null).length > 0;
          traces[alignment] = has_trace_infos ? trace_infos : undefined;
          trace_heights[alignment] = "T";
        }
        layer_infos.push({
          type: "inner",
          traces,
          annotation: {
            dielectric_height: `H${layer_index}`,
            epsilon: `ER${layer_index}`,
            trace_heights,
          },
        });
        break;
      }
    }
  }

  const layout_type = editor.trace_layout.type;
  const layout_elements = get_layout_elements_from_traces(traces, layout_type);
  return {
    elements: layout_elements,
    layers: layer_infos,
  };
}
