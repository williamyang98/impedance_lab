import {
  type Stackup,
  type Orientation, type LayerId, type TraceId,
  type Conductor,
  type Layer,
  type UnmaskedLayer,
  type SoldermaskLayer,
  type CoreLayer,
  type PrepregLayer,
  type HorizontalSpacing,
  type TracePosition,
  type CopperTrace,
  type CopperPlane,
  type SizeParameter, type TaperSizeParameter, type Parameter,
} from "./stackup.ts";
import { sizes } from "./viewer.ts";

export class ParameterCache<K extends string | number, V> {
  cache: Partial<Record<K, V>> = {};
  ctor: (key: K) => V;

  constructor(ctor: (key: K) => V) {
    this.ctor = ctor;
  }

  get(key: K): V {
    let value: V | undefined = this.cache[key];
    if (value !== undefined) {
      return value;
    }
    value = this.ctor(key);
    this.cache[key] = value;
    return value;
  }
}

export interface IdStore {
  own(id?: number): number;
}

export class ArenaIdStore {
  occupied: Set<number> = new Set();
  curr_head: number = 0;

  forward_head() {
    while (this.occupied.has(this.curr_head)) {
      this.curr_head += 1;
    }
  }

  borrow(): number {
    return this.curr_head;
  }

  own(id?: number): number {
    if (id !== undefined) {
      this.occupied.add(id);
      this.forward_head();
      return id;
    }
    this.occupied.add(this.curr_head);
    id = this.curr_head;
    this.curr_head += 1; // skip redundant check
    this.forward_head();
    return id;
  }

  free(id: number): boolean {
    if (!this.occupied.has(id)) return false;
    this.occupied.delete(id);
    this.curr_head = Math.min(this.curr_head, id);
    return true;
  }
}

export class BumpIdStore {
  curr_head: number = 0;

  own(id?: number): number {
    if (id !== undefined) {
      this.curr_head = Math.max(id, this.curr_head);
      return id;
    }
    id = this.curr_head;
    this.curr_head += 1;
    return id;
  }
}

export type LayerType = "unmasked" | "soldermask" | "core" | "prepreg";

const CommonRules = {
  can_layer_contain_conductor_orientation(layer: Layer, orientation: Orientation): boolean {
    switch (layer.type) {
      case "core": return false;
      case "prepreg": return true;
      case "unmasked": return layer.orientation == orientation;
      case "soldermask": return layer.orientation == orientation;
    }
  },
  will_layer_leave_conductors_floating(layer: Layer, conductors: Conductor[]): boolean {
    for (const conductor of conductors) {
      if (!this.is_conductor_in_layer(layer, conductor)) continue;
      if (!this.can_layer_contain_conductor_orientation(layer, conductor.position.orientation)) {
        return true;
      }
    }
    return false;
  },
  is_conductor_in_layer(layer: Layer, conductor: Conductor, orientation?: Orientation): boolean {
    if (layer.id != conductor.position.layer_id) return false;
    if (orientation === undefined) return true;
    return conductor.position.orientation == orientation;
  },
  are_some_conductors_in_layer(layer: Layer, conductors: Conductor[]): boolean {
    for (const conductor of conductors) {
      if (CommonRules.is_conductor_in_layer(layer, conductor)) {
        return true;
      }
    }
    return false;
  },
  is_shorting(conductors: Conductor[], top_layer?: Layer, bottom_layer?: Layer): boolean {
    if (!(top_layer && bottom_layer)) return false;

    let is_conductor_top = false;
    let is_conductor_bottom = false;
    if (top_layer) {
      for (const conductor of conductors) {
        if (this.is_conductor_in_layer(top_layer, conductor, "down")) {
          is_conductor_top = true;
          break;
        }
      }
    }
    if (bottom_layer) {
      for (const conductor of conductors) {
        if (this.is_conductor_in_layer(bottom_layer, conductor, "up")) {
          is_conductor_bottom = true;
          break;
        }
      }
    }

    return is_conductor_top && is_conductor_bottom;
  },
  can_layer_support_adjacent_layer(layer: Layer, orientation: Orientation): boolean {
    switch (layer.type) {
      case "core": return true;
      case "prepreg": return true;
      case "unmasked": return layer.orientation == orientation;
      case "soldermask": return layer.orientation == orientation;
    }
  },
};

export class StackupParameters {
  id_to_index: Partial<Record<LayerId, number>> = {};

  get_index(id: LayerId): number {
    const index  = this.id_to_index[id];
    if (index === undefined) {
      throw Error(`Failed to get layer index of layer id ${id}`);
    }
    return index;
  }

  dW: ParameterCache<number, TaperSizeParameter>;
  T: ParameterCache<number, SizeParameter>;
  SH: ParameterCache<number, SizeParameter>;
  H: ParameterCache<number, SizeParameter>;
  ER: ParameterCache<number, Parameter>;
  PH: SizeParameter;
  W: SizeParameter;
  CW: SizeParameter;
  S: SizeParameter;
  B: SizeParameter;
  CS: SizeParameter;

  constructor() {
    this.dW = new ParameterCache((i: number) => {
      return {
        parent: this,
        get name() { return `dW${this.parent.get_index(i)}`; },
        description: "Trace taper",
        get taper_suffix() { return `${this.parent.get_index(i)}`; },
        min: 0,
        value: 0,
        placeholder_value: sizes.trace_taper,
      };
    });
    this.T = new ParameterCache((i: number) => {
      return {
        parent: this,
        get name() { return `T${this.parent.get_index(i)}`; },
        description: "Trace thickness",
        min: 0,
        value: 0.035,
        placeholder_value: sizes.trace_height,
      };
    });
    this.SH = new ParameterCache((i: number) => {
      return {
        parent: this,
        get name() { return `H${this.parent.get_index(i)}` },
        description: "Soldermask thickness",
        min: 0,
        value: 0.0152,
        placeholder_value: sizes.soldermask_height,
      };
    });
    this.H = new ParameterCache((i: number) => {
      return {
        parent: this,
        get name() { return `H${this.parent.get_index(i)}`; },
        description: "Dielectric height",
        min: 0,
        value: 0.15,
        placeholder_value: sizes.core_height,
      };
    });
    this.ER = new ParameterCache((i: number) => {
      return {
        parent: this,
        get name() { return `ER${this.parent.get_index(i)}`; },
        description: "Dielectric constant",
        min: 1,
        value: 4.1,
      };
    });
    this.PH = {
      value: 0.1,
      placeholder_value: sizes.copper_layer_height,
    };
    this.W = {
      name: "W",
      description: "Trace width",
      min: 0,
      value: 0.25,
      placeholder_value: sizes.signal_trace_width,
    };
    this.CW = {
      name: "CW",
      description: "Coplanar ground width",
      min: 0,
      value: 0.25,
      placeholder_value: sizes.ground_trace_width,
    };
    this.S = {
      name: "S",
      description: "Signal separation",
      min: 0,
      value: 0.25,
      placeholder_value: sizes.signal_width_separation,
    };
    this.B = {
      name: "BS",
      description: "Broadside separation",
      min: 0,
      value: 0,
      placeholder_value: sizes.broadside_width_separation,
    };
    this.CS = {
      name: "CS",
      description: "Coplanar ground separation",
      min: 0,
      value: 0.25,
      placeholder_value: sizes.ground_width_separation,
    };
  }
}

export const create_layer = {
  core(params: StackupParameters, layer_id: LayerId): CoreLayer {
    return {
      type: "core",
      id: layer_id,
      height: params.H.get(layer_id),
      epsilon: params.ER.get(layer_id),
    };
  },
  prepreg(params: StackupParameters, layer_id: LayerId): PrepregLayer {
    return {
      type: "prepreg",
      id: layer_id,
      height: params.H.get(layer_id),
      epsilon: params.ER.get(layer_id),
      trace_height: params.T.get(layer_id),
      trace_taper: params.dW.get(layer_id),
    };
  },
  soldermask(params: StackupParameters, layer_id: LayerId, orientation: Orientation): SoldermaskLayer {
    return {
      type: "soldermask",
      id: layer_id,
      height: params.SH.get(layer_id),
      epsilon: params.ER.get(layer_id),
      trace_height: params.T.get(layer_id),
      trace_taper: params.dW.get(layer_id),
      orientation,
    };
  },
  unmasked(params: StackupParameters, layer_id: LayerId, orientation: Orientation): UnmaskedLayer {
    return {
      type: "unmasked",
      id: layer_id,
      trace_height: params.T.get(layer_id),
      trace_taper: params.dW.get(layer_id),
      orientation,
    };
  },
  with_type(params: StackupParameters, type: LayerType, layer_id: LayerId, orientation: Orientation): Layer {
    switch (type) {
      case "core": return this.core(params, layer_id);
      case "prepreg": return this.prepreg(params, layer_id);
      case "soldermask": return this.soldermask(params, layer_id, orientation);
      case "unmasked": return this.unmasked(params, layer_id, orientation);
    }
  }
}

export function create_ground_plane_conductor(params: StackupParameters, position: TracePosition): CopperPlane {
  return {
    type: "plane" ,
    position,
    height: params.PH,
    voltage: "ground",
  }
}

export abstract class StackupEditor {
  layers: Layer[] = [];
  layer_id = new ArenaIdStore();
  parameters: StackupParameters;
  plane_conductors: CopperPlane[] = [];

  constructor(parameters: StackupParameters) {
    this.parameters = parameters;
  }

  abstract get_sim_conductors(): Conductor[];
  abstract get_simulation_stackup(): Stackup;
  abstract get_viewer_stackup(): Stackup;

  // add/delete dielectric layers
  get_adjacent_layers(layer_index: number): [(Layer | undefined), (Layer | undefined)] {
    const total_layers = this.layers.length;
    const prev_layer = (layer_index > 0) ? this.layers[layer_index-1] : undefined;
    const next_layer = (layer_index < total_layers-1) ? this.layers[layer_index+1] : undefined;
    return [prev_layer, next_layer];
  }

  regenerate_layer_id_to_index() {
    // everytime a layer is removed/added we update the id to index map
    // this will be used to create new labels for the layers corresponding to their order in the stack
    for (let layer_index = 0; layer_index < this.layers.length; layer_index++) {
      const layer = this.layers[layer_index];
      this.parameters.id_to_index[layer.id] = layer_index;
    }
  }

  try_add_prepreg_layer(layer_index: number): (() => void) | undefined {
    const prev_layer = (layer_index > 0) ? this.layers[layer_index-1] : undefined;
    const curr_layer = (layer_index < this.layers.length) ? this.layers[layer_index] : undefined;
    if (prev_layer && !CommonRules.can_layer_support_adjacent_layer(prev_layer, "down")) return undefined;
    if (curr_layer && !CommonRules.can_layer_support_adjacent_layer(curr_layer, "up")) return undefined;
    const new_layer_temp = create_layer.prepreg(this.parameters, this.layer_id.borrow())
    return () => {
      this.layers.splice(layer_index, 0, new_layer_temp);
      this.layer_id.own(new_layer_temp.id);
      this.regenerate_layer_id_to_index();
    };
  }

  try_change_layer_type(layer_index: number, type: LayerType): (() => void) | undefined {
    const layer = this.layers[layer_index];
    const [prev_layer, next_layer] = this.get_adjacent_layers(layer_index);
    const new_orientation: Orientation = (layer_index == 0) ? "down" : "up";
    const new_layer_temp = create_layer.with_type(this.parameters, type, layer.id, new_orientation);

    if (prev_layer && !CommonRules.can_layer_support_adjacent_layer(new_layer_temp, "up")) return undefined;
    if (next_layer && !CommonRules.can_layer_support_adjacent_layer(new_layer_temp, "down")) return undefined;

    const conductors = this.get_sim_conductors();
    if (CommonRules.is_shorting(conductors, prev_layer, new_layer_temp)) return undefined;
    if (CommonRules.is_shorting(conductors, new_layer_temp, next_layer)) return undefined;
    if (CommonRules.will_layer_leave_conductors_floating(new_layer_temp, conductors)) return undefined;

    return () => {
      this.layers.splice(layer_index, 1, new_layer_temp);
      this.regenerate_layer_id_to_index();
    };
  }

  try_delete_layer(layer_index: number): (() => void) | undefined {
    const [prev_layer, next_layer] = this.get_adjacent_layers(layer_index);
    const layer = this.layers[layer_index];
    if (this.layers.length <= 1) return undefined;
    const conductors = this.get_sim_conductors();
    if (CommonRules.are_some_conductors_in_layer(layer, conductors)) return undefined;
    if (prev_layer && next_layer) {
      if (CommonRules.is_shorting(conductors, prev_layer, next_layer)) return undefined;
      if (!CommonRules.can_layer_support_adjacent_layer(prev_layer, "down")) return undefined;
      if (!CommonRules.can_layer_support_adjacent_layer(next_layer, "up")) return undefined;
    }
    return () => {
      this.layers.splice(layer_index, 1);
      this.layer_id.free(layer.id);
      this.regenerate_layer_id_to_index();
    }
  }

  // add/delete ground planes
  remove_plane(plane: CopperPlane) {
    const index = this.plane_conductors.indexOf(plane);
    if (index >= 0) {
      this.plane_conductors.splice(index, 1);
    }
  }

  // TODO: viewer styling and action bindings??? (why is this done separately???)
  make_plane_removable(plane: CopperPlane) {
    plane.grid = {
      override_total_divisions: 1,
    };
    plane.viewer = {
      on_click: () => this.remove_plane(plane),
    };
  }

  hide_spacings(spacings: HorizontalSpacing[]) {
    for (const spacing of spacings) {
      if (spacing.viewer === undefined) spacing.viewer = {};
      spacing.viewer.is_display = false;
    }
  }

  make_plane_conductor_selectable(plane: CopperPlane) {
    plane.viewer = {
      is_labeled: false,
      display: "selectable",
      on_click: () => {
        const sim_plane = create_ground_plane_conductor(this.parameters, plane.position);
        this.plane_conductors.push(sim_plane);
      },
    };
    plane.layout = {
      shrink_trace_layer: false,
    };
  }

  make_trace_conductor_selectable(trace: CopperTrace, group_tag: string, on_click: () => void) {
    let viewer = trace.viewer ?? {};
    viewer = {
      is_labeled: false,
      display: "selectable",
      on_click,
      group_tag,
      ...viewer,
    };
    trace.viewer = viewer;
  }

  get_sim_conductors_clickable(): Conductor[] {
    return this.get_sim_conductors()
      .map((conductor) => {
        if (conductor.type == "plane") {
          this.make_plane_removable(conductor);
        }
        return conductor;
      });
  }
}

export interface ColinearTrace {
  position: TracePosition;
  conductors: CopperTrace[];
  spacings: HorizontalSpacing[];
}

export interface ColinearTraceTemplate {
  create(params: StackupParameters, position: TracePosition, id_store: IdStore): ColinearTrace;
}

export interface ColinearLayerTemplate {
  create(params: StackupParameters, id_store: IdStore): {
    layers: Layer[],
    plane_conductors: CopperPlane[],
    trace_position: TracePosition,
  };
}

export class ColinearStackupEditor extends StackupEditor {
  trace_ids: ArenaIdStore = new ArenaIdStore();
  trace: ColinearTrace;
  trace_template: ColinearTraceTemplate;

  constructor(parameters: StackupParameters, trace_template: ColinearTraceTemplate, layer_template: ColinearLayerTemplate) {
    super(parameters);
    this.trace_template = trace_template;
    const { layers, plane_conductors, trace_position} = layer_template.create(this.parameters, this.layer_id);
    this.layers = layers;
    this.plane_conductors = plane_conductors;
    this.regenerate_layer_id_to_index();

    this.trace = this.trace_template.create(this.parameters, trace_position, this.trace_ids);
  }

  set_trace_template(trace_template: ColinearTraceTemplate) {
    this.trace_template = trace_template;
    for (const trace of this.trace.conductors) {
      this.trace_ids.free(trace.id);
    }
    this.trace = this.trace_template.create(this.parameters, this.trace.position, this.trace_ids);
  }

  override get_sim_conductors(): Conductor[] {
    return [...this.trace.conductors, ...this.plane_conductors];
  }

  get_sim_spacings(): HorizontalSpacing[] {
    return this.trace.spacings;
  }

  override get_simulation_stackup(): Stackup {
    const conductors = this.get_sim_conductors_clickable();
    const spacings = this.get_sim_spacings();
    return {
      layers: this.layers,
      spacings,
      conductors,
    }
  }

  make_colinear_trace_conductors_selectable(trace: ColinearTrace) {
    const group_tag = `${trace.position.layer_id}_${trace.position.orientation}`;
    for (const conductor of trace.conductors) {
      this.make_trace_conductor_selectable(conductor, group_tag, () => {
        for (const old_conductor of this.trace.conductors) {
          this.trace_ids.free(old_conductor.id)
        }
        const sim_trace = this.trace_template.create(this.parameters, conductor.position, this.trace_ids);
        this.trace = sim_trace;
      });
    }

    this.hide_spacings(trace.spacings);
  }

  create_parallel_spacing(left: TraceId, right: TraceId): HorizontalSpacing {
    return {
      left_trace: { id: left, attach: "left" },
      right_trace: { id: right, attach: "left" },
      width: {
        placeholder_value: 0,
      },
    }
  }

  override get_viewer_stackup(): Stackup {
    const sim_conductors = this.get_sim_conductors_clickable();
    const sim_spacings = this.get_sim_spacings();
    const viewer_conductors = [];
    const viewer_spacings = [];

    const occupied_locations: Partial<Record<LayerId, Set<Orientation>>> = {};
    for (const conductor of sim_conductors) {
      const { layer_id, orientation } = conductor.position;
      let orientations = occupied_locations[layer_id];
      if (orientations === undefined) {
        orientations = new Set<Orientation>();
        occupied_locations[layer_id] = orientations;
      }
      orientations.add(orientation);
    }
    const is_location_occupied = (layer_id: LayerId, orientation: Orientation): boolean => {
      const orientations = occupied_locations[layer_id]
      if (orientations === undefined) return false;
      return orientations.has(orientation);
    };

    const viewer_trace_ids = new BumpIdStore();
    viewer_trace_ids.curr_head = this.trace_ids.borrow();

    const orientations: Orientation[] = ["up", "down"];
    for (let layer_index = 0; layer_index < this.layers.length; layer_index++) {
      const layer = this.layers[layer_index];
      const [prev_layer, next_layer] = this.get_adjacent_layers(layer_index);
      const is_shorting = (new_conductors: Conductor[]): boolean => {
        return CommonRules.is_shorting(new_conductors, prev_layer, layer) ||
          CommonRules.is_shorting(new_conductors, layer, next_layer);
      };

      for (const orientation of orientations) {
        if (is_location_occupied(layer.id, orientation)) continue;
        if (!CommonRules.can_layer_contain_conductor_orientation(layer, orientation)) continue;

        // add regular traces
        const new_position = { layer_id: layer.id, orientation };
        const new_trace = this.trace_template.create(this.parameters, new_position, viewer_trace_ids);
        if (!is_shorting([...new_trace.conductors, ...this.plane_conductors])) {
          this.make_colinear_trace_conductors_selectable(new_trace);
          for (const conductor of new_trace.conductors) {
            viewer_conductors.push(conductor);
          }
          for (const spacing of new_trace.spacings) {
            viewer_spacings.push(spacing);
          }
          const parallel_spacing = this.create_parallel_spacing(this.trace.conductors[0].id, new_trace.conductors[0].id);
          this.hide_spacings([parallel_spacing]);
          viewer_spacings.push(parallel_spacing);
        }

        // add ground plane
        const new_plane = create_ground_plane_conductor(this.parameters, new_position);
        if (!is_shorting([...sim_conductors, new_plane])) {
          this.make_plane_conductor_selectable(new_plane);
          viewer_conductors.push(new_plane);
        }
      }
    }

    return {
      layers: this.layers,
      conductors: [...sim_conductors, ...viewer_conductors],
      spacings: [...sim_spacings, ...viewer_spacings],
    }
  }
}

export interface BroadsideTrace {
  position: TracePosition;
  conductors: CopperTrace[],
  root: CopperTrace,
  spacings: HorizontalSpacing[],
}

export interface BroadsideTraceTemplate {
  create_left(params: StackupParameters, position: TracePosition, id_store: IdStore): BroadsideTrace;
  create_right(params: StackupParameters, position: TracePosition, id_store: IdStore): BroadsideTrace;
}

export interface BroadsideLayerTemplate {
  create(params: StackupParameters, id_store: IdStore): {
    layers: Layer[],
    plane_conductors: CopperPlane[],
    left_trace_position: TracePosition,
    right_trace_position: TracePosition,
  }
}

export class BroadsideStackupEditor extends StackupEditor {
  trace_ids: ArenaIdStore = new ArenaIdStore();
  left: BroadsideTrace;
  right: BroadsideTrace;
  broadside_spacing: HorizontalSpacing;
  trace_template: BroadsideTraceTemplate;

  constructor(parameters: StackupParameters, trace_template: BroadsideTraceTemplate, layer_template: BroadsideLayerTemplate) {
    super(parameters);
    this.trace_template = trace_template;

    const {
      layers,
      plane_conductors,
      left_trace_position,
      right_trace_position,
    } = layer_template.create(this.parameters, this.layer_id);
    this.layers = layers;
    this.plane_conductors = plane_conductors;
    this.regenerate_layer_id_to_index();

    this.left = this.trace_template.create_left(this.parameters, left_trace_position, this.trace_ids);
    this.right = this.trace_template.create_right(this.parameters, right_trace_position, this.trace_ids);
    this.broadside_spacing = this.create_broadside_spacing(this.left.root.id, this.right.root.id);
  }

  set_trace_template(trace_template: BroadsideTraceTemplate) {
    this.trace_template = trace_template;
    const left_position = this.left.position;
    const right_position = this.right.position;
    this.left = this.trace_template.create_left(this.parameters, left_position, this.trace_ids);
    this.right = this.trace_template.create_right(this.parameters, right_position, this.trace_ids);
    this.broadside_spacing = this.create_broadside_spacing(this.left.root.id, this.right.root.id);
  }

  create_broadside_spacing(left_id: TraceId, right_id: TraceId): HorizontalSpacing {
    return {
      left_trace: {
        id: left_id,
        attach: "center",
      },
      right_trace: {
        id: right_id,
        attach: "center",
      },
      width: this.parameters.B,
    }
  }

  override get_sim_conductors(): Conductor[] {
    return [...this.left.conductors, ...this.right.conductors, ...this.plane_conductors];
  }

  get_sim_spacings(): HorizontalSpacing[] {
    return [...this.left.spacings, this.broadside_spacing, ...this.right.spacings];
  }

  override get_simulation_stackup(): Stackup {
    const conductors = this.get_sim_conductors_clickable()
    const spacings = this.get_sim_spacings();
    return {
      layers: this.layers,
      spacings,
      conductors,
    }
  }

  make_left_trace_selectable(left: BroadsideTrace) {
    const group_tag = `${left.position.layer_id}_${left.position.orientation}_left`;
    for (const conductor of left.conductors) {
      this.make_trace_conductor_selectable(conductor, group_tag, () => {
        for (const trace of this.left.conductors) {
          this.trace_ids.free(trace.id);
        }
        const sim_left = this.trace_template.create_left(this.parameters, left.position, this.trace_ids);
        const sim_spacing = this.create_broadside_spacing(sim_left.root.id, this.right.root.id);
        this.left = sim_left;
        this.broadside_spacing = sim_spacing;
      });
    }

    this.hide_spacings(left.spacings);
  }

  make_right_trace_selectable(right: BroadsideTrace) {
    const group_tag = `${right.position.layer_id}_${right.position.orientation}_right`;
    for (const conductor of right.conductors) {
      this.make_trace_conductor_selectable(conductor, group_tag, () => {
        for (const trace of this.right.conductors) {
          this.trace_ids.free(trace.id);
        }
        const sim_right = this.trace_template.create_right(this.parameters, right.position, this.trace_ids);
        const sim_spacing = this.create_broadside_spacing(this.left.root.id, sim_right.root.id);
        this.right = sim_right;
        this.broadside_spacing = sim_spacing;
      });
    }

    this.hide_spacings(right.spacings);
  }

  override get_viewer_stackup(): Stackup {
    const sim_conductors = this.get_sim_conductors_clickable();
    const sim_spacings = this.get_sim_spacings();
    const viewer_conductors = [];
    const viewer_spacings = [];

    const occupied_locations: Partial<Record<LayerId, Set<Orientation>>> = {};
    for (const conductor of sim_conductors) {
      const { layer_id, orientation } = conductor.position;
      let orientations = occupied_locations[layer_id];
      if (orientations === undefined) {
        orientations = new Set<Orientation>();
        occupied_locations[layer_id] = orientations;
      }
      orientations.add(orientation);
    }
    const is_location_occupied = (layer_id: LayerId, orientation: Orientation): boolean => {
      const orientations = occupied_locations[layer_id]
      if (orientations === undefined) return false;
      return orientations.has(orientation);
    };

    const viewer_trace_ids = new BumpIdStore();
    viewer_trace_ids.curr_head = this.trace_ids.borrow();

    const orientations: Orientation[] = ["up", "down"];
    for (let layer_index = 0; layer_index < this.layers.length; layer_index++) {
      const layer = this.layers[layer_index];
      const [prev_layer, next_layer] = this.get_adjacent_layers(layer_index);
      const is_shorting = (new_conductors: Conductor[]): boolean => {
        return CommonRules.is_shorting(new_conductors, prev_layer, layer) ||
          CommonRules.is_shorting(new_conductors, layer, next_layer);
      };

      for (const orientation of orientations) {
        if (is_location_occupied(layer.id, orientation)) continue;
        if (!CommonRules.can_layer_contain_conductor_orientation(layer, orientation)) continue;

        // left traces
        const new_position: TracePosition = { layer_id: layer.id, orientation };
        const new_left = this.trace_template.create_left(this.parameters, new_position, viewer_trace_ids);
        if (!is_shorting([...new_left.conductors, ...this.right.conductors, ...this.plane_conductors])) {
          this.make_left_trace_selectable(new_left);
          for (const conductor of new_left.conductors) {
            viewer_conductors.push(conductor);
          }
          for (const spacing of new_left.spacings) {
            viewer_spacings.push(spacing);
          }
          const broadside_spacing = this.create_broadside_spacing(new_left.root.id, this.right.root.id);
          this.hide_spacings([broadside_spacing]);
          viewer_spacings.push(broadside_spacing);
        }

        // right traces
        const new_right = this.trace_template.create_right(this.parameters, new_position, viewer_trace_ids);
        if (!is_shorting([...new_right.conductors, ...this.left.conductors, ...this.plane_conductors])) {
          this.make_right_trace_selectable(new_right);
          for (const conductor of new_right.conductors) {
            viewer_conductors.push(conductor);
          }
          for (const spacing of new_right.spacings) {
            viewer_spacings.push(spacing);
          }
          const broadside_spacing = this.create_broadside_spacing(this.left.root.id, new_right.root.id);
          this.hide_spacings([broadside_spacing]);
          viewer_spacings.push(broadside_spacing);
        }

        // add ground plane
        const new_plane = create_ground_plane_conductor(this.parameters, new_position);
        if (!is_shorting([...sim_conductors, new_plane])) {
          this.make_plane_conductor_selectable(new_plane);
          viewer_conductors.push(new_plane);
        }
      }
    }

    return {
      layers: this.layers,
      conductors: [...sim_conductors, ...viewer_conductors],
      spacings: [...sim_spacings, ...viewer_spacings],
    }
  }
}
