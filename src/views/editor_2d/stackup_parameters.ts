import {
  type Stackup, type Id, StackupRules, type LayoutItem, type TraceType, type SpacingType, type TraceAlignment,
} from "./stackup.ts";

import { type AnnotationConfig } from "./stackup_to_viewer_layout.ts";

// import {
//   GridLines, RegionGrid, normalise_regions,
//   get_voltage_transform,
//   sdf_slope_bottom_left,
//   sdf_slope_bottom_right,
//   sdf_slope_top_left,
//   sdf_slope_top_right,
// } from "../../engine/grid_2d.ts";

export interface Parameter {
  label: string;
  value?: number;
  min?: number;
  max?: number;
}

export interface LayerParameters {
  epsilon?: Parameter;
  height?: Parameter;
  trace_height?: Parameter;
  trace_taper?: Parameter;
}

export interface TraceParameters {
  coplanar_width?: Parameter;
  coplanar_separation?: Parameter;
  signal_width?: Parameter;
  signal_separation?: Parameter;
}

export interface StackupParameters {
  layer_parameters: LayerParameters[];
  trace_parameters: TraceParameters;
  taper_ids: Partial<Record<Id, number>>;
}

export function get_stackup_parameters_from_stackup(stackup: Stackup, include_missing_traces?: boolean): StackupParameters {
  const { trace_layout, layers } = stackup;

  const taper_ids: Partial<Record<Id, number>> = {};
  let taper_id = 0;

  const layer_parameters: LayerParameters[] = [];
  let layer_id = 0;
  for (const layer of layers) {
    const params: LayerParameters = {};
    // copper layer shouldn't have any parameters
    if (layer.type == "copper") {
      layer_parameters.push(params);
      continue;
    };

    layer_id++;
    const has_dielectric =
      layer.type == "inner" ||
      (layer.type == "surface" && layer.has_soldermask);
    if (has_dielectric) {
      params.height = {
        label: `H${layer_id}`,
        min: 0,
      };
      params.epsilon = {
        label: `ER${layer_id}`,
        min: 1,
      };
    }

    const has_trace = StackupRules.is_trace_layout_in_layer(layer, trace_layout);
    if (has_trace) {
      taper_id++;
      params.trace_taper = {
        label: `dW${taper_id}`,
        min: 0,
        value: 0,
      };
      taper_ids[layer.id] = taper_id;
    }

    // inner dielectric material with trace positions should include trace height parameters
    const has_trace_height =
      has_trace ||
      (layer.type == "inner" && layer.trace_alignments.size > 0) ||
      include_missing_traces;
    if (has_trace_height) {
      params.trace_height = {
        label: `T${layer_id}`,
        min: 0,
      };
    }

    layer_parameters.push(params);
  }

  const trace_parameters: TraceParameters = {};
  if (trace_layout.has_coplanar_ground) {
    trace_parameters.coplanar_width = {
      label: "CW",
      min: 0,
    };
    trace_parameters.coplanar_separation = {
      label: "CS",
      min: 0,
    };
  }

  const items = StackupRules.get_layout_items_from_trace_layout(trace_layout);
  function filter_one(filter: (item: LayoutItem) => boolean) {
    for (const item of items)  {
      if (filter(item)) return true;
    }
    return false;
  }
  if (filter_one(item => item.type == "trace" && item.trace == "signal")) {
    trace_parameters.signal_width = {
      label: "W",
      min: 0,
    };
  }
  if (filter_one(item => item.type == "trace" && item.trace == "ground")) {
    trace_parameters.coplanar_width = {
      label: "CW",
      min: 0,
    };
  }
  if (filter_one(item => item.type == "spacing" && (item.spacing == "signal" || item.spacing == "broadside"))) {
    trace_parameters.signal_separation = {
      label: "S",
      min: 0,
    };
  }
  if (filter_one(item => item.type == "spacing" && item.spacing == "ground")) {
    trace_parameters.coplanar_separation = {
      label: "CS",
      min: 0,
    };
  }

  return {
    layer_parameters,
    trace_parameters,
    taper_ids,
  };
}

export function get_annotation_config_from_stackup_parameters(
  stackup: Stackup,
  stackup_parameters: StackupParameters,
): AnnotationConfig {
  const { trace_parameters, layer_parameters, taper_ids } = stackup_parameters;
  const trace_positions = StackupRules.get_layout_trace_positions(stackup.trace_layout);

  function create_taper_label(label: string | undefined, id: number): string | undefined {
    if (label === undefined) return undefined;
    return `${label}${id}`;
  }

  return {
    trace_width: (_trace_index: number, type: TraceType): string | undefined => {
      switch (type) {
        case "signal": return trace_parameters.signal_width?.label;
        case "ground": return trace_parameters.coplanar_width?.label;
      }
    },
    trace_taper: (trace_index: number, type: TraceType): string | undefined => {
      const position = trace_positions[trace_index];
      const taper_id = taper_ids[position.layer_id];
      if (taper_id === undefined) return undefined;
      switch (type) {
        case "signal": return create_taper_label(trace_parameters.signal_width?.label, taper_id);
        case "ground": return create_taper_label(trace_parameters.coplanar_width?.label, taper_id);
      }
    },
    separation_width: (_trace_index: number, type: SpacingType): string | undefined => {
      switch (type) {
        case "signal": return trace_parameters.signal_separation?.label;
        case "ground": return trace_parameters.coplanar_separation?.label;
        case "broadside": return trace_parameters.signal_separation?.label;
      }
    },
    layer_dielectric_height: (layer_index: number): string | undefined => {
      const params = layer_parameters[layer_index];
      return params.height?.label;
    },
    layer_epsilon: (layer_index: number): string | undefined => {
      const params = layer_parameters[layer_index];
      return params.epsilon?.label;
    },
    layer_trace_height: (layer_index: number, _alignment: TraceAlignment): string | undefined => {
      const params = layer_parameters[layer_index];
      return params.trace_height?.label;
    },
  }
}
