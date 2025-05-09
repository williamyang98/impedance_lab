import {
  type Id, type Layer, type LayerDescriptor,
  type TraceAlignment, type TraceLayout, type TraceLayoutType,
  type Stackup, StackupRules,
} from "./stackup.ts";

export class IdGenerator {
  head: Id = 0;
  own_id(): Id {
    const id = this.head;
    this.head += 1;
    return id;
  }
  borrow_id(): Id {
    return this.head;
  }
}

export class Editor implements Stackup {
  layer_id_gen = new IdGenerator();
  layers: Layer[] = [];
  trace_layout: TraceLayout;

  constructor() {
    const layer = this.add_layer(0);
    const trace_layout: TraceLayout = {
      type: "single_ended",
      position:  { layer_id: layer.id, alignment: "top" },
      has_coplanar_ground: false,
    };
    this.trace_layout = trace_layout;
  }

  _get_adjacent_layers(layer_index: number): [(Layer | undefined), (Layer | undefined)] {
    const total_layers = this.layers.length;
    const prev_layer = (layer_index > 0) ? this.layers[layer_index-1] : undefined;
    const next_layer = (layer_index < total_layers-1) ? this.layers[layer_index+1] : undefined;
    return [prev_layer, next_layer];
  }

  add_layer(index: number): Layer {
    const id = this.layer_id_gen.own_id();
    const layer: Layer = { id, type: "inner", trace_alignments: new Set(["top", "bottom"]) };
    this.layers.splice(index, 0, layer);
    return layer;
  }

  can_change_layer_type(layer_index: number, descriptor: LayerDescriptor): boolean {
    const [prev_layer, next_layer] = this._get_adjacent_layers(layer_index);
    const layer = this.layers[layer_index];
    const new_layer_temp = { id: layer.id, ...descriptor };

    if (prev_layer && StackupRules.is_shorting(this.trace_layout, prev_layer, new_layer_temp)) return false;
    if (next_layer && StackupRules.is_shorting(this.trace_layout, new_layer_temp, next_layer)) return false;
    if (StackupRules.is_trace_layout_floating_in_layer(new_layer_temp, this.trace_layout)) return false;
    if (prev_layer && !StackupRules.can_layer_support_adjacent_layer(new_layer_temp, true)) return false;
    if (next_layer && !StackupRules.can_layer_support_adjacent_layer(new_layer_temp, false)) return false;

    return true;
  }

  change_layer_type(layer_index: number, descriptor: LayerDescriptor) {
    const layer = this.layers[layer_index];
    const new_layer = { id: layer.id, ...descriptor };
    this.layers.splice(layer_index, 1, new_layer);
  }

  can_add_above(): boolean {
    const layer = this.layers[0];
    return StackupRules.can_layer_support_adjacent_layer(layer, true);
  }

  can_add_layer_below(layer_index: number) {
    const layer = this.layers[layer_index];
    return StackupRules.can_layer_support_adjacent_layer(layer, false)
  }

  can_remove_layer(layer_index: number): boolean {
    const [prev_layer, next_layer] = this._get_adjacent_layers(layer_index);
    const layer = this.layers[layer_index];
    if (this.layers.length <= 1) return false;
    if (StackupRules.is_trace_layout_in_layer(layer, this.trace_layout, undefined, undefined)) return false;
    if (prev_layer && next_layer) {
      if (StackupRules.is_shorting(this.trace_layout, prev_layer, next_layer )) return false;
      if (!StackupRules.can_layer_support_adjacent_layer(prev_layer, false)) return false;
      if (!StackupRules.can_layer_support_adjacent_layer(next_layer, true)) return false;
    }
    return true;
  }

  remove_layer(layer_index: number) {
    this.layers.splice(layer_index, 1);
  }

  is_trace_in_layer(layer_index: number, trace_index?: number, alignment?: TraceAlignment): boolean {
    const layer = this.layers[layer_index];
    return StackupRules.is_trace_layout_in_layer(layer, this.trace_layout, trace_index, alignment);
  }

  can_move_trace_here(layer_index: number, trace_index: number, alignment: TraceAlignment): boolean {
    const [prev_layer, next_layer] = this._get_adjacent_layers(layer_index);
    const layer = this.layers[layer_index];
    const new_trace_temp = StackupRules.move_trace_layout(this.trace_layout, layer.id, trace_index, alignment);

    if (StackupRules.is_shorting(new_trace_temp)) return false;
    if (prev_layer && StackupRules.is_shorting(new_trace_temp, prev_layer, layer)) return false;
    if (next_layer && StackupRules.is_shorting(new_trace_temp, layer, next_layer)) return false;
    if (StackupRules.is_trace_layout_floating_in_layer(layer, new_trace_temp)) return false;
    return true;
  }

  move_trace_here(layer_index: number, trace_index: number, alignment: TraceAlignment) {
    const layer = this.layers[layer_index];
    const new_trace = StackupRules.move_trace_layout(this.trace_layout, layer.id, trace_index, alignment);
    this.trace_layout = new_trace;
  }

  can_change_trace_layout(type: TraceLayoutType): boolean {
    return StackupRules.find_valid_trace_layout(type, this.layers) !== null;
  }

  change_trace_layout_type(type: TraceLayoutType) {
    const new_trace_layout = StackupRules.find_valid_trace_layout(type, this.layers);
    if (new_trace_layout !== null) {
      this.trace_layout = new_trace_layout;
    }
  }
}
