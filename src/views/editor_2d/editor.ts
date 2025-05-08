export type Id = number;

export class IdGenerator {
  curr: Id = 0;
  get_id(): Id {
    const id = this.curr++;
    return id;
  }
}

export type LayerType = "soldermask" | "air" | "copper" | "dielectric";
export const layer_types: LayerType[] = ["soldermask", "air", "copper", "dielectric"];
export type TraceAlignment = "top" | "bottom";
export const trace_alignments: TraceAlignment[] = ["top", "bottom"];

export interface Layer {
  id: Id;
  type: LayerType;
}

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
}

export type SignalType = "single" | "coplanar_pair" | "broadside_pair";
export const signal_types: SignalType[] = ["single", "coplanar_pair", "broadside_pair"];
export type SignalTrace =
  { type: "single" } & SingleEndedTrace |
  { type: "coplanar_pair" } & CoplanarDifferentialPair |
  { type: "broadside_pair" } & BroadsideDifferentialPair;

export class Editor {
  layer_table: Record<number, Layer> = {};
  layers: Layer[] = [];
  layer_id_gen = new IdGenerator();
  signal: SignalTrace;

  constructor() {
    const layer = this.add_layer(0);
    const signal: SignalTrace = {
      type: "single",
      position:  { layer_id: layer.id, alignment: "top" },
      has_coplanar_ground: false,
    };
    this.signal = signal;
  }

  add_layer(index: number): Layer {
    const id = this.layer_id_gen.get_id();
    const layer: Layer = { id, type: "dielectric" };
    this.layer_table[id] = layer;
    this.layers.splice(index, 0, layer);
    return layer;
  }

  is_signal_in_layer(index: number, alignment?: TraceAlignment): boolean {
    const layer = this.layers[index];
    if (layer.type == "copper") return false;
    switch (this.signal.type) {
      case "single": // @fallthrough
      case "coplanar_pair": {
        const position = this.signal.position;
        if (position.layer_id != layer.id) return false;
        if (alignment === undefined) return true;
        return position.alignment == alignment;
      }
      case "broadside_pair": {
        if (this.signal.left_position.layer_id == layer.id) {
          const position = this.signal.left_position;
          if (alignment == undefined) return true;
          if (position.alignment == alignment) return true;
        }
        if (this.signal.right_position.layer_id == layer.id) {
          const position = this.signal.right_position;
          if (alignment == undefined) return true;
          if (position.alignment == alignment) return true;
        }
        return false;
      }
    }
  }

  is_broadside_signal_in_layer(index: number, alignment: TraceAlignment, is_left: boolean): boolean {
    const layer = this.layers[index];
    if (this.signal.type != "broadside_pair") return false;

    if (is_left) {
      const position = this.signal.left_position;
      return position.layer_id == layer.id && position.alignment == alignment;
    } else {
      const position = this.signal.right_position;
      return position.layer_id == layer.id && position.alignment == alignment;
    }
  }

  is_valid_layer_type(index: number, type: LayerType): boolean {
    const total_layers = this.layers.length;
    const layer = this.layers[index];
    switch (type) {
    case "dielectric": return true;
    case "copper": {
      // avoid shorting out signal traces
      if (this.is_signal_in_layer(index)) return false;
      if ((index > 0) && this.is_signal_in_layer(index-1, "bottom")) return false;
      if ((index < total_layers-1) && this.is_signal_in_layer(index+1, "top")) return false;
      return true;
    }
    case "air": // @fallthrough
    case "soldermask": {
      if (total_layers < 2) return false;
      // make sure we aren't forcing broadside signal traces to collapse down into one alignment
      if (layer.type == "dielectric") {
        if (this.is_signal_in_layer(index, "top") && this.is_signal_in_layer(index, "bottom")) {
          return false;
        }
      }
      // only allow air/soldermask layers on top and bottom of stackup if it is supported by an adjacent dielectric layer
      if (index == 0) return this.layers[index+1].type == "dielectric";
      if (index == total_layers-1) return this.layers[index-1].type == "dielectric";
      return false;
    }
    }
  }

  set_layer_type(index: number, type: LayerType) {
    const total_layers = this.layers.length;
    const layer = this.layers[index];

    // move signal traces to appropriate alignment
    if (layer.type == "dielectric" && (type == "air" || type == "soldermask")) {
      const collapse_alignment = (new_alignment: TraceAlignment) => {
        switch (this.signal.type) {
          case "single": // @fallthrough
          case "coplanar_pair": {
            if (this.signal.position.layer_id == layer.id) this.signal.position.alignment = new_alignment;
            break;
          }
          case "broadside_pair": {
            if (this.signal.left_position.layer_id == layer.id) this.signal.left_position.alignment = new_alignment;
            if (this.signal.right_position.layer_id == layer.id) this.signal.right_position.alignment = new_alignment;
            break;
          }
        }
      }
      if (index == 0) collapse_alignment("bottom");
      if (index == total_layers-1) collapse_alignment("top");
    }
    layer.type = type;
  }

  can_add_above(): boolean {
    const layer = this.layers[0];
    return layer.type == 'dielectric';
  }

  can_add_layer_below(index: number) {
    const total_layers = this.layers.length;
    const layer = this.layers[index];
    if (layer.type !== 'dielectric' && index == total_layers-1) {
      return false;
    }
    return true;
  }

  is_valid_signal_alignment(index: number, type: TraceAlignment): boolean {
    const total_layers = this.layers.length;
    const layer = this.layers[index];
    if (layer.type == "copper") return false;
    // prevent shorting to existing signal
    if (this.is_signal_in_layer(index, type)) return false;
    // prevent shorts to adjacent copper layers
    if (index > 0 && type == "top" && this.layers[index-1].type == "copper") return false;
    if (index < total_layers-1 && type == "bottom" && this.layers[index+1].type == "copper") return false;
    // only allow traces on air/soldermask layers to be attached to adjacent layer
    if (layer.type == "air" || layer.type == "soldermask") {
      if (index == 0) return type == "bottom";
      if (index == total_layers-1) return type == "top";
      console.warn(`Got an air/soldermask layer at an unexpected index=${index}, total_layers=${total_layers}`);
      return false;
    }
    return true;
  }

  can_remove_layer(index: number): boolean {
    const total_layers = this.layers.length;
    if (total_layers == 1) return false;
    if (this.is_signal_in_layer(index)) return false;

    // prevent soldermask/air layer collapsing onto a non-dielectric layer
    const prev_layer = (index-1 >= 0) ? this.layers[index-1] : null;
    const next_layer = (index+1 <= total_layers-1) ? this.layers[index+1] : null;
    if ((prev_layer?.type == "air" || prev_layer?.type == "soldermask") && next_layer?.type != "dielectric") {
      return false;
    }
    if ((next_layer?.type == "air" || next_layer?.type == "soldermask") && prev_layer?.type != "dielectric") {
      return false;
    }

    // prevent removal of layer from shorting a signal
    const is_top_signal = (index-1) >= 0 && this.is_signal_in_layer(index-1, "bottom");
    const is_bottom_signal = (index+1) <= total_layers-1 && this.is_signal_in_layer(index+1, "top");
    // we perform this wierd xor to allow for copper on copper layers
    if (is_top_signal && (is_bottom_signal || next_layer?.type == "copper")) return false;
    if (is_bottom_signal && (is_top_signal || prev_layer?.type == "copper")) return false;
    return true;
  }

  remove_layer(index: number) {
    const layer = this.layers[index];
    if (this.is_signal_in_layer(index)) {
      console.error(`Attempted to remove a layer with a signal on it. index=${index}, id=${layer.id}`);
      return;
    }
    delete this.layer_table[layer.id];
    this.layers.splice(index, 1);
  }

  move_single_layer_signal(index: number, alignment: TraceAlignment) {
    const layer = this.layers[index];
    if (this.signal.type == "broadside_pair") {
      console.error("Just tried to move a broadside pair to a single layer and alignment");
      return;
    }
    this.signal.position.layer_id = layer.id;
    this.signal.position.alignment = alignment;
  }

  move_broadside_signal(index: number, alignment: TraceAlignment, is_left: boolean) {
    const layer = this.layers[index];
    if (this.signal.type != "broadside_pair") {
      console.error("Just tried to move a broadside pair to a single layer and alignment");
      return;
    }
    if (is_left) {
      this.signal.left_position.layer_id = layer.id;
      this.signal.left_position.alignment = alignment;
    } else {
      this.signal.right_position.layer_id = layer.id;
      this.signal.right_position.alignment = alignment;
    }
  }

  set_signal_type(type: SignalType) {
    if (this.signal.type == type) return;
    if (type == "single" || type == "coplanar_pair") {
      // collapse down to single layer and alignment
      const has_coplanar_ground = this.signal.type == "broadside_pair" ? false : this.signal.has_coplanar_ground;
      if (this.signal.type == "broadside_pair") {
        const position = this.signal.left_position;
        this.signal = { type, position, has_coplanar_ground };
      } else {
        const position = this.signal.position;
        this.signal = { type, position, has_coplanar_ground };
      }
    } else {
      // only do this if it's possible to assign the left and right traces to non-shorting locations
      const positions = this.get_broadside_pair_possible_locations();
      if (positions.length >= 2) {
        const left_position = positions[0];
        const right_position = positions[1];
        this.signal = { type, left_position, right_position };
      } else {
        console.warn("Failed to find enough layers to convert to broadside pair");
      }
    }
  }

  set_signal_has_coplanar_ground(has_coplanar_ground: boolean) {
    if (this.signal.type == "broadside_pair") return;
    this.signal = { ...this.signal, has_coplanar_ground };
  }

  get_broadside_pair_possible_locations(max_count?: number): TracePosition[] {
    max_count = max_count ?? 2;

    const positions: TracePosition[] = [];
    const total_layers = this.layers.length;
    for (let i = 0; i < total_layers; i++) {
      const layer = this.layers[i];
      if (layer.type == "copper") continue;
      const prev_layer = (i > 0) ? this.layers[i-1] : null;
      const next_layer = (i < total_layers-1) ? this.layers[i+1] : null;
      if (prev_layer?.type != "copper" && !(prev_layer === null && (layer.type == "air" || layer.type == "soldermask"))) {
        positions.push({ layer_id: layer.id, alignment: "top" });
      }
      if (next_layer?.type != "copper" && !(next_layer === null && (layer.type == "air" || layer.type == "soldermask"))) {
        positions.push({ layer_id: layer.id, alignment: "bottom" });
      }
      if (positions.length >= max_count) break;
    }
    return positions;
  }
}
