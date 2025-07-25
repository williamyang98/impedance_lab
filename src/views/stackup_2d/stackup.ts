import { ArenaIdStore } from "../../utility/id_store.ts";
import { type DistanceUnit } from "../../utility/unit_types.ts";
import { WeakRefArray } from "../../utility/weakref_array.ts";
import { convert_distance } from "../../utility/unit_types.ts";

// types of parameters
export interface FormParameter {
  label?: string;
  description?: string;
  value?: number;
  min?: number;
  max?: number;
  error?: string;
  impedance_correlation?: "positive" | "negative";
  is_changed(): boolean;
  mark_unchanged(): void;
}

export interface SizeParameter extends FormParameter {
  readonly type: "size";
  old_value?: number;
  old_unit?: DistanceUnit;
  unit: DistanceUnit;
}

export interface EtchFactorParameter extends FormParameter {
  readonly type: "etch_factor"; // W-W0 = dW0 = 2*T*etch_factor
  old_value?: number;
}

export interface EpsilonParameter extends FormParameter {
  readonly type: "epsilon";
  old_value?: number;
}

export type Parameter = SizeParameter | EtchFactorParameter | EpsilonParameter;
export type Orientation = "top" | "bottom";
export type LayerId = number;

export interface EtchWidth {
  value?: number;
  unit: DistanceUnit;
}

function create_etch_width(trace_height: SizeParameter, etch_factor: EtchFactorParameter): EtchWidth {
  let value = undefined;
  if (trace_height.value !== undefined && etch_factor.value !== undefined) {
    value = trace_height.value*etch_factor.value*2;
  }
  return { value, unit: trace_height.unit };
}

// layers
export interface SurfaceLayer {
  readonly type: "surface",
  id: LayerId;
  orientation: Orientation;
  soldermask_height: SizeParameter;
  epsilon: EpsilonParameter;
  trace_height: SizeParameter;
  etch_factor: EtchFactorParameter;
  get etch_width(): EtchWidth;
  has_plane: boolean;
  get add_plane(): (() => void) | undefined;
  get delete_plane(): (() => void) | undefined;
  get delete(): (() => void) | undefined;
  get has_traces(): boolean;
  has_soldermask: boolean;
}

export interface InnerLayer {
  readonly type: "inner",
  id: LayerId;
  dielectric_height: SizeParameter;
  epsilon: EpsilonParameter;
  trace_height: SizeParameter;
  etch_factor: EtchFactorParameter;
  get etch_width(): EtchWidth;
  has_plane: Record<Orientation, boolean>;
  has_traces: Readonly<Record<Orientation, boolean>>;
  add_plane: Readonly<Record<Orientation, (() => void) | undefined>>;
  delete_plane: Readonly<Record<Orientation, (() => void) | undefined>>;
  get delete(): (() => void) | undefined;
}

export type Layer = SurfaceLayer | InnerLayer;
export type LayerType = "surface" | "inner";

export interface Position {
  layer_id: LayerId;
  orientation: Orientation;
}

export function is_same_position(p0: Position, p1: Position): boolean {
  if (p0.layer_id !== p1.layer_id) return false;
  if (p0.orientation !== p1.orientation) return false;
  return true;
}

class SizeParameters extends WeakRefArray<SizeParameter> {
  _unit: DistanceUnit;

  constructor(default_unit: DistanceUnit) {
    super();
    this._unit = default_unit;
  }

  override push(size: SizeParameter) {
    this.convert(size);
    super.push(size);
  }

  set unit(unit: DistanceUnit) {
    this._unit = unit;
    this.compact();
    for (const size of this.deref()) {
      this.convert(size);
    }
  }

  get unit(): DistanceUnit {
    return this._unit;
  }

  convert(size: SizeParameter) {
    if (size.value === undefined) return;
    const new_value = convert_distance(size.value, size.unit, this._unit);
    size.value = new_value;
    size.unit = this._unit;
  }
}

export abstract class LayerStackup {
  layers: Layer[] = [];
  layer_id_store = new ArenaIdStore();
  layer_id_to_index = new Map<LayerId, number>();
  parameters = {
    size: new SizeParameters("mm"),
    copper_thickness: new SizeParameters("oz"),
  };
  minimum_feature_size: number = 1e-5;

  set size_unit(unit: DistanceUnit) {
    this.parameters.size.unit = unit;
  }

  get size_unit(): DistanceUnit {
    return this.parameters.size.unit;
  }

  set copper_thickness_unit(unit: DistanceUnit) {
    this.parameters.copper_thickness.unit = unit;
  }

  get copper_thickness_unit(): DistanceUnit {
    return this.parameters.copper_thickness.unit;
  }


  abstract has_traces(position: Position): boolean;

  get_layer_index(id: LayerId): number {
    const index = this.layer_id_to_index.get(id);
    if (index === undefined) throw Error(`Got invalid layer id: ${id}`);
    return index;
  }

  get_layer_at_index(index: number): Layer | undefined {
    if (index < 0 || index >= this.layers.length) return undefined;
    return this.layers[index];
  }

  get_layer_by_id(id: LayerId): Layer {
    const index = this.get_layer_index(id);
    return this.layers[index];
  }

  get_adjacent_position(position: Position): Position | undefined {
    const layer_index = this.get_layer_index(position.layer_id);
    let adjacent_orientation = undefined as (Orientation | undefined);
    let adjacent_layer_id = undefined as (LayerId | undefined);
    switch (position.orientation) {
      case "top": {
        adjacent_orientation = "bottom";
        adjacent_layer_id = this.get_layer_at_index(layer_index-1)?.id;
        break;
      }
      case "bottom": {
        adjacent_orientation = "top";
        adjacent_layer_id = this.get_layer_at_index(layer_index+1)?.id;
        break;
      }
    }
    if (adjacent_layer_id === undefined) return undefined;
    return { layer_id: adjacent_layer_id, orientation: adjacent_orientation };
  }

  // planes
  has_plane(position: Position): boolean {
    const layer_index = this.get_layer_index(position.layer_id);
    const layer = this.layers[layer_index];
    switch (layer.type) {
      case "surface": return layer.has_plane && (layer.orientation === position.orientation);
      case "inner": return layer.has_plane[position.orientation];
    }
  }

  can_add_plane(position: Position): boolean {
    if (this.has_traces(position)) return false;
    const adjacent_position = this.get_adjacent_position(position);
    if (adjacent_position === undefined) return true;
    return !this.has_traces(adjacent_position);
  }

  add_plane(position: Position) {
    const layer_index = this.get_layer_index(position.layer_id);
    const layer = this.layers[layer_index];
    switch (layer.type) {
      case "surface": {
        layer.has_plane = true;
        break;
      }
      case "inner": {
        layer.has_plane[position.orientation] = true;
        break;
      }
    }
  }

  can_delete_plane(_position: Position): boolean {
    return true;
  }

  delete_plane(position: Position) {
    const layer_index = this.get_layer_index(position.layer_id);
    const layer = this.layers[layer_index];
    switch (layer.type) {
      case "surface": {
        layer.has_plane = false;
        break;
      }
      case "inner": {
        layer.has_plane[position.orientation] = false;
        break;
      }
    }
  }

  // layers
  can_delete_layer(index: number): boolean {
    const layer = this.layers[index];
    const layer_id = layer.id;
    // if layer has traces inside
    switch (layer.type) {
      case "surface": {
        if (this.has_traces({ layer_id, orientation: layer.orientation })) {
          return false;
        }
        break;
      }
      case "inner": {
        if (this.has_traces({ layer_id, orientation: "top" })) return false;
        if (this.has_traces({ layer_id, orientation: "bottom" })) return false;
        break;
      }
    }

    const prev_layer = this.get_layer_at_index(index-1);
    const next_layer = this.get_layer_at_index(index+1);

    // avoid dangling surface layer
    if (prev_layer?.type === "surface" && next_layer === undefined) return false;
    if (next_layer?.type === "surface" && prev_layer === undefined) return false;

    // check if removing layer will cause a short circuit
    if (prev_layer === undefined || next_layer === undefined) return true;
    const prev_position: Position = { layer_id: prev_layer.id, orientation: "bottom" };
    const next_position: Position = { layer_id: next_layer.id, orientation: "top" };
    const prev_has_plane = this.has_plane(prev_position);
    const prev_has_trace = this.has_traces(prev_position);
    const next_has_plane = this.has_plane(next_position);
    const next_has_trace = this.has_traces(next_position);
    // ground planes can touch each other, but traces cannot touch other traces or planes in a different layer
    if ((prev_has_plane || prev_has_trace) && next_has_trace) return false;
    if ((next_has_plane || next_has_trace) && prev_has_trace) return false;
    return true;
  }

  delete_layer(index: number): void {
    const layer = this.layers[index];
    this.layers.splice(index, 1);
    this.layer_id_store.free(layer.id);
    this.regenerate_layer_id_to_index();
  }

  create_size_parameter(value: number, unit: DistanceUnit): SizeParameter {
    return {
      type: "size" as const,
      value, unit,
      old_value: undefined as (number | undefined),
      old_unit: undefined as (DistanceUnit | undefined),
      is_changed(): boolean {
        if (this.value !== this.old_value) return true;
        if (this.unit !== this.old_unit) return true;
        return false;
      },
      mark_unchanged() {
        this.old_value = this.value;
        this.old_unit = this.unit;
      },
    }
  }

  create_dielectric_height(layer_id: LayerId, value: number, unit: DistanceUnit): SizeParameter {
    const size = {
      ...this.create_size_parameter(value, unit),
      parent: this,
      get label(): string {
        const layer_index = this.parent.get_layer_index(layer_id);
        return `H${layer_index}`;
      },
      get min(): number { return this.parent.minimum_feature_size; },
      impedance_correlation: "positive" as const,
    };
    this.parameters.size.push(size);
    return size;
  }

  create_trace_height(layer_id: LayerId, value: number, unit: DistanceUnit): SizeParameter {
    const trace_height = {
      ...this.create_size_parameter(value, unit),
      parent: this,
      get label(): string {
        const layer_index = this.parent.get_layer_index(layer_id);
        return `T${layer_index}`;
      },
      get min(): number { return this.parent.minimum_feature_size; },
      impedance_correlation: "negative" as const,
    };
    this.parameters.copper_thickness.push(trace_height);
    return trace_height;
  }

  create_epsilon(layer_id: LayerId, value: number): EpsilonParameter {
    const epsilon = {
      parent: this,
      type: "epsilon" as const,
      get label(): string {
        const layer_index = this.parent.get_layer_index(layer_id);
        return `ER${layer_index}`;
      },
      value,
      min: 1,
      old_value: undefined as (number | undefined),
      is_changed() {
        return this.value !== this.old_value;
      },
      mark_unchanged() {
        this.old_value = this.value;
      },
      impedance_correlation: "negative" as const,
    };
    return epsilon;
  }

  create_etch_factor(layer_id: LayerId): EtchFactorParameter {
    const etch_factor = {
      parent: this,
      type: "etch_factor" as const,
      get label(): string {
        const layer_index = this.parent.get_layer_index(layer_id);
        return `EF${layer_index}`;
      },
      value: 0,
      min: 0,
      old_value: undefined as (number | undefined),
      is_changed() {
        return this.value !== this.old_value;
      },
      mark_unchanged() {
        this.old_value = this.value;
      },
      impedance_correlation: "positive" as const,
    };
    return etch_factor;
  }

  create_surface_layer(orientation: Orientation, id?: LayerId): SurfaceLayer {
    if (id === undefined) {
      id = this.layer_id_store.own();
    }
    const soldermask_height = this.create_dielectric_height(id, 0.015, "mm");
    const trace_height = this.create_trace_height(id, 1, "oz");
    const epsilon = this.create_epsilon(id, 3.3);
    const etch_factor = this.create_etch_factor(id);
    const position: Position = { layer_id: id, orientation };
    const layer = {
      type: "surface" as const,
      parent: this,
      id,
      soldermask_height,
      epsilon,
      orientation,
      etch_factor,
      trace_height,
      has_plane: false,
      has_soldermask: false,
      get etch_width() { return create_etch_width(this.trace_height, this.etch_factor); },
      get has_traces(): boolean {
        return this.parent.has_traces(position);
      },
      get add_plane() {
        if (!this.parent.can_add_plane(position)) {
          return undefined;
        }
        return () => { this.parent.add_plane(position); };
      },
      get delete_plane() {
        if (!this.parent.can_delete_plane(position)) {
          return undefined;
        }
        return () => { this.parent.delete_plane(position); };
      },
      get delete() {
        const layer_index = this.parent.get_layer_index(id);
        if (!this.parent.can_delete_layer(layer_index)) return undefined;
        return () => { this.parent.delete_layer(layer_index); };
      },
    };
    return layer;
  }

  create_inner_layer(id?: LayerId): InnerLayer {
    if (id === undefined) {
      id = this.layer_id_store.own();
    }
    const dielectric_height = this.create_dielectric_height(id, 0.15, "mm");
    const trace_height = this.create_trace_height(id, 1, "oz");
    const epsilon = this.create_epsilon(id, 4.1);
    const etch_factor = this.create_etch_factor(id);
    const layer = {
      type: "inner" as const,
      parent: this,
      id,
      dielectric_height,
      epsilon,
      etch_factor,
      trace_height,
      has_plane: {
        top: false,
        bottom: false,
      },
      has_traces: {
        parent: this,
        get top() { return this.parent.has_traces({ layer_id: id, orientation: "top" }); },
        get bottom() { return this.parent.has_traces({ layer_id: id, orientation: "bottom" }); },
      },
      add_plane: {
        parent: this,
        get top() {
          const position: Position = { layer_id: id, orientation: "top" };
          if (!this.parent.can_add_plane(position)) return undefined;
          return () => { this.parent.add_plane(position); };
        },
        get bottom() {
          const position: Position = { layer_id: id, orientation: "bottom" };
          if (!this.parent.can_add_plane(position)) return undefined;
          return () => { this.parent.add_plane(position); };
        },
      },
      delete_plane: {
        parent: this,
        get top() {
          const position: Position = { layer_id: id, orientation: "top" };
          if (!this.parent.can_delete_plane(position)) return undefined;
          return () => { this.parent.delete_plane(position); };
        },
        get bottom() {
          const position: Position = { layer_id: id, orientation: "bottom" };
          if (!this.parent.can_delete_plane(position)) return undefined;
          return () => { this.parent.delete_plane(position); };
        },
      },
      get delete() {
        const layer_index = this.parent.get_layer_index(id);
        if (!this.parent.can_delete_layer(layer_index)) return undefined;
        return () => { this.parent.delete_layer(layer_index); };
      },
      get etch_width() { return create_etch_width(this.trace_height, this.etch_factor); },
    };
    return layer;
  }

  can_add_inner_layer(index: number): boolean {
    const N = this.layers.length;
    if (index === 0 && this.get_layer_at_index(index)?.type === "surface") return false;
    if (index === N && this.get_layer_at_index(index-1)?.type === "surface") return false;
    return true;
  }

  add_inner_layer(index: number) {
    const layer = this.create_inner_layer();
    this.layers.splice(index, 0, layer);
    this.regenerate_layer_id_to_index();
  }

  get_layer_types(index: number): LayerType[] {
    const layer = this.layers[index];
    const layer_id = layer.id;
    switch (layer.type) {
      case "surface": return ["surface", "inner"];
      case "inner": {
        // surface layer needs support
        const new_orientation = (index === 0) ? "bottom" : "top";
        const new_position: Position = { layer_id: layer.id, orientation: new_orientation };
        let adjacent_layer = undefined;
        {
          const adjacent_position = this.get_adjacent_position(new_position);
          if (adjacent_position !== undefined) {
            const adjacent_layer_index = this.get_layer_index(adjacent_position.layer_id);
            adjacent_layer = this.layers[adjacent_layer_index];
          }
        }
        if (adjacent_layer?.type !== "inner") {
          return ["inner"];
        }
        // dont delete traces in new surface layer
        const removed_orientation = (index === 0) ? "top" : "bottom";
        const position: Position = { layer_id, orientation: removed_orientation };
        if (this.has_traces(position)) {
          return ["inner"];
        }
        return ["inner", "surface"];
      }
    }
  }

  set_layer_type(index: number, type: LayerType) {
    const layer = this.layers[index];
    switch (type) {
      case "inner": {
        if (layer.type === type) return;
        const new_layer = this.create_inner_layer(layer.id);
        new_layer.has_plane[layer.orientation] = layer.has_plane;
        this.layers.splice(index, 1, new_layer);
        break;
      }
      case "surface": {
        if (layer.type === type) return;
        const orientation: Orientation = (index === 0) ? "bottom" : "top";
        const new_layer = this.create_surface_layer(orientation, layer.id);
        new_layer.has_plane = layer.has_plane[orientation];
        this.layers.splice(index, 1, new_layer);
        break;
      }
    }
  }

  regenerate_layer_id_to_index() {
    this.layer_id_to_index.clear();
    this.layers.forEach((layer, index) => {
      this.layer_id_to_index.set(layer.id, index);
    });
  }
}

// conductors
export type Voltage = "ground" | "positive" | "negative";
export interface Trace {
  width: SizeParameter;
  voltage: Voltage;
}

export type SpacingMode = "trace" | "coplanar";
export interface Spacing {
  readonly mode: SpacingMode;
  width: SizeParameter;
}

export interface LayerTraces {
  position: Position;
  traces: Trace[];
  spacings: Spacing[];
}

export type ColinearLayout = "single" | "differential" | "coplanar_single" | "coplanar_differential";
export class ColinearStackup extends LayerStackup {
  readonly type = "colinear";
  _trace_position?: Position;
  trace_width: SizeParameter;
  coplanar_width: SizeParameter;
  trace_spacing: Spacing;
  coplanar_spacing: Spacing;
  layouts: Record<ColinearLayout, LayerTraces>;
  selected_layout: ColinearLayout = "single";

  constructor() {
    super();
    this.trace_width = this.create_trace_width("W", 0.25, "mm");
    this.coplanar_width = this.create_trace_width("CW", 0.5, "mm");
    this.trace_spacing = this.create_spacing("trace", 0.25, "mm");
    this.coplanar_spacing = this.create_spacing("coplanar", 0.35, "mm");

    const single_layout = {
      parent: this,
      get position() { return this.parent.trace_position; },
      traces: [
        { width: this.trace_width, voltage: "positive" as const },
      ],
      spacings: [],
    };

    const differential_layout = {
      parent: this,
      get position() { return this.parent.trace_position; },
      traces: [
        { width: this.trace_width, voltage: "positive" as const },
        { width: this.trace_width, voltage: "negative" as const },
      ],
      spacings: [this.trace_spacing],
    };

    const coplanar_single_layout = {
      parent: this,
      get position() { return this.parent.trace_position; },
      traces: [
        { width: this.coplanar_width, voltage: "ground" as const },
        { width: this.trace_width, voltage: "positive" as const },
        { width: this.coplanar_width, voltage: "ground" as const },
      ],
      spacings: [this.coplanar_spacing, this.coplanar_spacing],
    };

    const coplanar_differential_layout = {
      parent: this,
      get position() { return this.parent.trace_position; },
      traces: [
        { width: this.coplanar_width, voltage: "ground" as const },
        { width: this.trace_width, voltage: "positive" as const },
        { width: this.trace_width, voltage: "negative" as const },
        { width: this.coplanar_width, voltage: "ground" as const },
      ],
      spacings: [this.coplanar_spacing, this.trace_spacing, this.coplanar_spacing],
    };

    this.layouts = {
      single: single_layout,
      differential: differential_layout,
      coplanar_single: coplanar_single_layout,
      coplanar_differential: coplanar_differential_layout,
    };
  }

  override has_traces(position: Position): boolean {
    return is_same_position(this.trace_position, position);
  }

  create_trace_width(label: string, value: number, unit: DistanceUnit): SizeParameter {
    const width = {
      ...this.create_size_parameter(value, unit),
      parent: this,
      label,
      get min(): number | undefined {
        const position = this.parent.trace_position;
        const layer_index = this.parent.get_layer_index(position.layer_id);
        const layer = this.parent.layers[layer_index];
        const etch_width = layer.etch_width;
        if (etch_width.value === undefined) return;
        return convert_distance(etch_width.value, etch_width.unit, this.unit);
      },
      impedance_correlation: "negative" as const,
    };
    this.parameters.size.push(width);
    return width;
  }

  create_spacing(mode: SpacingMode, value: number, unit: DistanceUnit): Spacing {
    const label = mode === "trace" ? "S" : "CS";
    const width = {
      ...this.create_size_parameter(value, unit),
      parent: this,
      label,
      mode,
      get min(): number { return this.parent.minimum_feature_size; },
      impedance_correlation: "positive" as const,
    };
    const spacing = { width, mode };
    this.parameters.size.push(width);
    return spacing;
  }

  get trace_layout(): LayerTraces {
    return this.layouts[this.selected_layout];
  }

  get trace_position(): Position {
    if (this._trace_position === undefined) {
      throw Error("Tried to get trace position before it was defined");
    }
    return this._trace_position;
  }

  can_move_trace(position: Position): boolean {
    if (this.has_plane(position)) return false;
    const adjacent_position = this.get_adjacent_position(position);
    if (adjacent_position !== undefined) {
      if (this.has_plane(adjacent_position)) return false;
    }
    return true;
  }

  move_trace(position: Position) {
    this._trace_position = position;
  }
}

export type BroadsidePair = "left" | "right";
export function get_opposite_pair(pair: BroadsidePair): BroadsidePair {
  switch (pair) {
    case "left": return "right";
    case "right": return "left";
  }
}
export interface BroadsideLayerTraces extends LayerTraces {
  broadside_index: number;
}
export type BroadsideTraces = Record<BroadsidePair, BroadsideLayerTraces>;
export type BroadsideLayout = "pair" | "coplanar_pair" | "mirrored_pair" | "mirrored_coplanar_pair";
export class BroadsideStackup extends LayerStackup {
  readonly type = "broadside";
  _trace_positions: Record<BroadsidePair, Position | undefined>;
  trace_width: SizeParameter;
  coplanar_width: SizeParameter;
  trace_spacing: Spacing;
  coplanar_spacing: Spacing;
  broadside_spacing: SizeParameter;
  layouts: Record<BroadsideLayout, BroadsideTraces>;
  selected_layout: BroadsideLayout = "pair";

  constructor() {
    super();
    this.trace_width = this.create_trace_width("W", 0.25, "mm");
    this.coplanar_width = this.create_trace_width("CW", 0.5, "mm");
    this.trace_spacing = this.create_spacing("trace", 0.25, "mm");
    this.coplanar_spacing = this.create_spacing("coplanar", 0.35, "mm");
    this.broadside_spacing = {
      ...this.create_size_parameter(0, "mm"),
      type: "size" as const,
      label: "BS",
      impedance_correlation: "positive",
    };
    this.parameters.size.push(this.broadside_spacing);

    const get_voltage = (polarity: boolean): Voltage => {
      return polarity ? "positive" : "negative";
    }
    const get_pair_layout = (pair: BroadsidePair) => {
      return {
        parent: this,
        get position() { return this.parent.get_trace_position(pair); },
        traces: [
          { width: this.trace_width, voltage: get_voltage(pair === "left") },
        ],
        spacings: [],
        broadside_index: 0,
      };
    };

    const get_coplanar_pair_layout = (pair: BroadsidePair) => {
      return {
        parent: this,
        get position() { return this.parent.get_trace_position(pair);
        },
        traces: [
          { width: this.coplanar_width, voltage: "ground" as const },
          { width: this.trace_width, voltage: get_voltage(pair === "left") },
          { width: this.coplanar_width, voltage: "ground" as const },
        ],
        spacings: [this.coplanar_spacing, this.coplanar_spacing],
        broadside_index: 1,
      };
    };

    const get_mirrored_pair_layout = (pair: BroadsidePair) => {
      return {
        parent: this,
        get position() { return this.parent.get_trace_position(pair); },
        traces: [
          { width: this.trace_width, voltage: get_voltage(pair === "left") },
          { width: this.trace_width, voltage: get_voltage(pair === "right") },
        ],
        spacings: [this.trace_spacing],
        broadside_index: 0,
      };
    };

    const get_mirrored_coplanar_pair_layout = (pair: BroadsidePair) => {
      return {
        parent: this,
        get position() { return this.parent.get_trace_position(pair); },
        traces: [
          { width: this.coplanar_width, voltage: "ground" as const },
          { width: this.trace_width, voltage: get_voltage(pair === "left") },
          { width: this.trace_width, voltage: get_voltage(pair === "right") },
          { width: this.coplanar_width, voltage: "ground" as const },
        ],
        spacings: [this.coplanar_spacing, this.trace_spacing, this.coplanar_spacing],
        broadside_index: 1,
      };
    };

    const create_layout = (getter: (pair: BroadsidePair) => BroadsideLayerTraces): BroadsideTraces => {
      return {
        left: getter("left"),
        right: getter("right"),
      };
    };

    this.layouts = {
      pair: create_layout(get_pair_layout),
      coplanar_pair: create_layout(get_coplanar_pair_layout),
      mirrored_pair: create_layout(get_mirrored_pair_layout),
      mirrored_coplanar_pair: create_layout(get_mirrored_coplanar_pair_layout),
    };
    this._trace_positions = {
      left: undefined,
      right: undefined,
    }
  }

  create_trace_width(label: string, value: number, unit: DistanceUnit): SizeParameter {
    const width = {
      ...this.create_size_parameter(value, unit),
      type: "size" as const,
      parent: this,
      label,
      get min(): number | undefined {
        let max_etch_width = 0;
        const get_etch_width = (pair: BroadsidePair) => {
          const position = this.parent.get_trace_position(pair);
          const layer_index = this.parent.get_layer_index(position.layer_id);
          const layer = this.parent.layers[layer_index];
          const etch_width = layer.etch_width;
          if (etch_width.value === undefined) return;
          const value = convert_distance(etch_width.value, etch_width.unit, this.unit);
          max_etch_width = Math.max(value, max_etch_width);
        }
        get_etch_width("left");
        get_etch_width("right");
        return max_etch_width;
      },
      impedance_correlation: "negative" as const,
    };
    this.parameters.size.push(width);
    return width;
  }

  create_spacing(mode: SpacingMode, value: number, unit: DistanceUnit): Spacing {
    const label = mode === "trace" ? "S" : "CS";
    const width = {
      ...this.create_size_parameter(value, unit),
      parent: this,
      label,
      mode,
      get min(): number { return this.parent.minimum_feature_size; },
      impedance_correlation: "positive" as const,
    };
    const spacing = { width, mode };
    this.parameters.size.push(width);
    return spacing;
  }

  override has_traces(position: Position): boolean {
    if (this.has_traces_pair(position, "left")) return true;
    if (this.has_traces_pair(position, "right")) return true;
    return false;
  }

  has_traces_pair(position: Position, pair: BroadsidePair): boolean {
    const trace_position = this.get_trace_position(pair);
    return is_same_position(trace_position, position);
  }

  get trace_layout(): BroadsideTraces {
    return this.layouts[this.selected_layout];
  }

  get_trace_position(pair: BroadsidePair): Position {
    const position = this._trace_positions[pair];
    if (position === undefined) {
      throw Error(`Tried to get ${pair} trace position before it was defined`);
    }
    return position;
  }

  can_move_trace(position: Position, pair: BroadsidePair): boolean {
    const opposite_pair = get_opposite_pair(pair);
    if (this.has_plane(position)) return false;
    if (this.has_traces_pair(position, opposite_pair)) return false;
    const adjacent_position = this.get_adjacent_position(position);
    if (adjacent_position !== undefined) {
      if (this.has_plane(adjacent_position)) return false;
      if (this.has_traces_pair(adjacent_position, opposite_pair)) return false;
    }
    return true;
  }

  move_trace(position: Position, pair: BroadsidePair) {
    this._trace_positions[pair] = position;
  }
}

export type Stackup = ColinearStackup | BroadsideStackup;
export type StackupType = "colinear" | "broadside";
export const stackup_types: StackupType[] = ["colinear", "broadside"];
