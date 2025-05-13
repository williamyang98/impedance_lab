export type Id = number;

export type LayerType = "surface" | "inner" | "copper";
export const layer_types: LayerType[] = ["surface", "inner", "copper"];
export type TraceAlignment = "top" | "bottom";
export const trace_alignments: TraceAlignment[] = ["top", "bottom"];

export interface SurfaceLayer {
  has_soldermask: boolean;
  trace_alignment: TraceAlignment;
}

export interface InnerLayer {
  trace_alignments: Set<TraceAlignment>;
}

export type LayerDescriptor =
  { type: "surface" } & SurfaceLayer |
  { type: "inner" } & InnerLayer |
  { type: "copper" };

export type Layer = LayerDescriptor & { id: Id };

export interface TracePosition {
  layer_id: Id;
  alignment: TraceAlignment;
}

export interface SingleEndedTrace {
  position: TracePosition;
  has_coplanar_ground: boolean;
}

export interface CoplanarDifferentialPair {
  position: TracePosition;
  has_coplanar_ground: boolean;
}

export interface BroadsideDifferentialPair {
  left_position: TracePosition;
  right_position: TracePosition;
  has_coplanar_ground: boolean;
}

export type TraceLayoutType = "single_ended" | "coplanar_pair" | "broadside_pair";
export const trace_layout_types: TraceLayoutType[] = ["single_ended", "coplanar_pair", "broadside_pair"];
export type TraceLayout =
  { type: "single_ended" } & SingleEndedTrace |
  { type: "coplanar_pair" } & CoplanarDifferentialPair |
  { type: "broadside_pair" } & BroadsideDifferentialPair;

export interface Stackup {
  layers: Layer[];
  trace_layout: TraceLayout;
}

export type TraceType = "signal" | "ground";
export type SpacingType = "signal" | "ground" | "broadside";
export type LayoutItem =
  { type: "trace", trace: TraceType } |
  { type: "spacing", spacing: SpacingType };

export function get_layout_items_from_trace_types(trace_types: TraceType[], layout_type: TraceLayoutType): LayoutItem[] {
  const elements: LayoutItem[] = [];
  for (let trace_index = 0; trace_index < trace_types.length; trace_index++) {
    const trace_type = trace_types[trace_index];
    const next_trace_type = (trace_index < trace_types.length-1) ? trace_types[trace_index+1] : null;
    // trace
    elements.push({ type: "trace", trace: trace_type })
    // spacing
    if (next_trace_type == null) continue;
    if (trace_type == "signal" && next_trace_type == "signal") {
      if (layout_type == "broadside_pair") {
        elements.push({ type: "spacing", spacing: "broadside" });
      } else {
        elements.push({ type: "spacing", spacing: "signal" });
      }
    } else {
      elements.push({ type: "spacing", spacing: "ground" });
    }
  }
  return elements;
}

export class StackupRules {
  static get_layout_items_from_trace_layout(layout: TraceLayout): LayoutItem[] {
    const trace_types = this.get_traces_from_trace_layout(layout);
    return get_layout_items_from_trace_types(trace_types, layout.type);
  }

  static get_traces_from_trace_layout(layout: TraceLayout): TraceType[] {
    switch (layout.type) {
      case "single_ended": {
        let traces: TraceType[] = ["signal"];
        if (layout.has_coplanar_ground) {
          traces = ["ground", ...traces, "ground"];
        }
        return traces;
      }
      case "coplanar_pair": {
        let traces: TraceType[] = ["signal", "signal"];
        if (layout.has_coplanar_ground) {
          traces = ["ground", ...traces, "ground"];
        }
        return traces;
      }
      case "broadside_pair": {
        let traces: TraceType[] = ["signal", "signal"];
        if (layout.has_coplanar_ground) {
          traces = ["ground", ...traces, "ground"];
        }
        return traces;
      }
    }
  }

  static is_trace_alignment_in_layer(layer: LayerDescriptor, alignment: TraceAlignment): boolean {
    switch (layer.type) {
      case "copper": return false;
      case "inner": return layer.trace_alignments.has(alignment);
      case "surface": return layer.trace_alignment == alignment;
    }
  }

  static can_layer_support_adjacent_layer(layer: LayerDescriptor, is_other_above: boolean): boolean {
    switch (layer.type) {
      case "copper": return true;
      case "inner": return true;
      case "surface": {
        switch (layer.trace_alignment) {
          case "bottom": return !is_other_above;
          case "top": return is_other_above;
        }
      }
    }
  }

  static is_shorting(layout: TraceLayout, top_layer?: Layer, bottom_layer?: Layer): boolean {
    // avoid broadside pairs from shorting each other
    if (
      layout.type == "broadside_pair" &&
      layout.right_position.layer_id == layout.left_position.layer_id &&
      layout.right_position.alignment == layout.left_position.alignment
    ) {
      return true;
    }
    // detect if adjacent layers are shorting
    if (top_layer && bottom_layer) {
      const is_signal_top = this.is_voltage_in_layer(top_layer, layout, undefined, "bottom");
      const is_signal_bottom = this.is_voltage_in_layer(bottom_layer, layout, undefined, "top");
      return is_signal_top && is_signal_bottom;
    }
    return false;
  }

  static is_voltage_in_layer(layer: Layer, layout: TraceLayout, trace_index?: number, alignment?: TraceAlignment): boolean {
    if (layer.type == "copper") return true;
    return this.is_trace_layout_in_layer(layer, layout, trace_index, alignment);
  }

  static is_trace_layout_in_layer(layer: Layer, layout: TraceLayout, trace_index?: number, alignment?: TraceAlignment): boolean {
    switch (layout.type) {
      case "single_ended": {
        if (layout.position.layer_id != layer.id) return false;
        if (alignment && !(alignment == layout.position.alignment)) return false;
        return true;
      }
      case "coplanar_pair": {
        if (layout.position.layer_id != layer.id) return false;
        if (alignment && !(alignment == layout.position.alignment)) return false;
        return true;
      }
      case "broadside_pair": {
        const check_position = (position: TracePosition) => {
          if (position.layer_id != layer.id) return false;
          if (alignment && !(alignment == position.alignment)) return false;
          return true;
        };
        const total_traces = this.get_traces_from_trace_layout(layout).length;
        if (trace_index === undefined) {
          return check_position(layout.left_position) || check_position(layout.right_position);
        } else if (trace_index < total_traces/2) {
          return check_position(layout.left_position);
        } else {
          return check_position(layout.right_position);
        }
      }
    }
  }

  // maps 1 to 1 against get_traces_from_trace_layout()
  static get_layout_trace_positions(layout: TraceLayout): TracePosition[] {
    switch (layout.type) {
      case "single_ended": {
        let positions = [layout.position];
        if (layout.has_coplanar_ground) {
          positions = [layout.position, ...positions, layout.position];
        }
        return positions;
      }
      case "coplanar_pair": {
        let positions = [layout.position, layout.position];
        if (layout.has_coplanar_ground) {
          positions = [layout.position, ...positions, layout.position];
        }
        return positions;
      }
      case "broadside_pair": {
        let positions = [layout.left_position, layout.right_position];
        if (layout.has_coplanar_ground) {
          positions = [layout.left_position, ...positions, layout.right_position];
        }
        return positions;
      }
    }
  }

  // like get_layout_trace_positions but only distinctly different locations
  static get_layout_trace_unique_positions(layout: TraceLayout): TracePosition[] {
    switch (layout.type) {
      case "single_ended": return [layout.position];
      case "coplanar_pair": return [layout.position];
      case "broadside_pair": return [layout.left_position, layout.right_position];
    }
  }

  static is_trace_layout_floating_in_layer(layer: Layer, layout: TraceLayout): boolean {
    const positions = StackupRules.get_layout_trace_unique_positions(layout);
    for (const position of positions) {
      if (position.layer_id != layer.id) continue;
      if (!StackupRules.is_trace_alignment_in_layer(layer, position.alignment)) return true;
    }
    return false;
  }

  static move_trace_layout(layout: TraceLayout, layer_id: Id, trace_index: number, alignment: TraceAlignment): TraceLayout {
    switch (layout.type) {
      case "single_ended": return { ...layout, position: { layer_id, alignment } };
      case "coplanar_pair": return { ...layout, position: { layer_id, alignment } };
      case "broadside_pair": {
        const total_traces = this.get_traces_from_trace_layout(layout).length;
        const is_left = trace_index < total_traces/2;
        if (is_left) {
          return { ...layout, left_position: { layer_id, alignment } };
        } else {
          return { ...layout, right_position: { layer_id, alignment } };
        }
      }
    }
  }

  static find_valid_trace_layout(type: TraceLayoutType, layers: Layer[]): (TraceLayout | null) {
    switch (type) {
      case "single_ended": // @fallthrough
      case "coplanar_pair": {
        const total_layers = layers.length;
        for (let i = 0; i < total_layers; i++) {
          const layer = layers[i];
          const prev_layer = (i > 0) ? layers[i-1] : null;
          const next_layer = (i < total_layers-1) ? layers[i+1] : null;
          for (const alignment of trace_alignments) {
            if (!this.is_trace_alignment_in_layer(layer, alignment)) continue;
            const trace_layout: TraceLayout = {
              type,
              position: { layer_id: layer.id, alignment },
              has_coplanar_ground: false,
            };
            if (prev_layer && this.is_shorting(trace_layout, prev_layer, layer)) continue;
            if (next_layer && this.is_shorting(trace_layout, layer, next_layer)) continue;
            return trace_layout;
          }
        }
        return null;
      }
      case "broadside_pair": {
        const total_layers = layers.length;
        // search left
        for (let left_i = 0; left_i < total_layers; left_i++) {
          const left_layer = layers[left_i];
          const left_prev_layer = (left_i > 0) ? layers[left_i-1] : null;
          const left_next_layer = (left_i < total_layers-1) ? layers[left_i+1] : null;
          for (const left_alignment of trace_alignments) {
            if (!this.is_trace_alignment_in_layer(left_layer, left_alignment)) continue;
            // search right
            for (let right_i = left_i; right_i < total_layers; right_i++) {
              const right_layer = layers[right_i];
              const right_prev_layer = (right_i > 0) ? layers[right_i-1] : null;
              const right_next_layer = (right_i < total_layers-1) ? layers[right_i+1] : null;
              for (const right_alignment of trace_alignments) {
                if (!this.is_trace_alignment_in_layer(right_layer, right_alignment)) continue;
                const trace_layout: TraceLayout = {
                  type,
                  left_position: { layer_id: left_layer.id, alignment: left_alignment },
                  right_position: { layer_id: right_layer.id, alignment: right_alignment },
                  has_coplanar_ground: false,
                };
                if (this.is_shorting(trace_layout, undefined, undefined)) continue;
                if (left_prev_layer && this.is_shorting(trace_layout, left_prev_layer, left_layer)) continue;
                if (left_next_layer && this.is_shorting(trace_layout, left_layer, left_next_layer)) continue;
                if (right_prev_layer && this.is_shorting(trace_layout, right_prev_layer, right_layer)) continue;
                if (right_next_layer && this.is_shorting(trace_layout, right_layer, right_next_layer)) continue;
                return trace_layout;
              }
            }
          }
        }
        return null;
      }
    }
  }
}
