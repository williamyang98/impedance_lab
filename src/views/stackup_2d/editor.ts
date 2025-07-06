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
  type LayerType,
} from "./stackup.ts";
import { type IdStore, ArenaIdStore, BumpIdStore } from "./id_store.ts";
import { StackupParameters } from "./parameters.ts";

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

export function create_plane(params: StackupParameters, position: TracePosition): CopperPlane {
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

  regenerate_trace_parameter_constraints() {
    // keep track of which parameters effect trace and taper geometry
    this.parameters.required_trace_widths.clear();
    this.parameters.required_trace_tapers.clear();
    for (const conductor of this.get_sim_conductors()) {
      if (conductor.type == "trace") {
        this.parameters.required_trace_widths.add(conductor.width);
        this.parameters.required_trace_tapers.add(this.parameters.dW.get(conductor.position.layer_id));
      }
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
  remove_plane(position: TracePosition) {
    const index = this.plane_conductors.findIndex(plane => {
      return plane.position.layer_id == position.layer_id &&
        plane.position.orientation == position.orientation;
    });
    if (index >= 0) {
      this.plane_conductors.splice(index, 1);
    }
  }

  // viewer styling and action bindings
  hide_spacing(spacing: HorizontalSpacing): HorizontalSpacing {
    if (spacing.viewer === undefined) spacing.viewer = {};
    spacing.viewer.is_display = false;
    return spacing;
  }

  make_plane_removable(plane: CopperPlane): CopperPlane {
    plane.grid = {
      override_total_divisions: 1,
    };
    plane.viewer = {
      on_click: () => this.remove_plane(plane.position),
    };
    return plane;
  }

  make_plane_selectable(plane: CopperPlane): CopperPlane {
    plane.viewer = {
      is_labeled: false,
      display: "selectable",
      on_click: () => {
        const sim_plane = create_plane(this.parameters, plane.position);
        this.plane_conductors.push(sim_plane);
      },
    };
    plane.layout = {
      shrink_trace_layer: false,
    };
    return plane;
  }

  make_trace_selectable(trace: CopperTrace, group_tag: string, on_click: () => void): CopperTrace {
    trace.viewer = {
      ...trace.viewer,
      is_labeled: false,
      display: "selectable",
      on_click,
      group_tag,
    };
    return trace;
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
    this.regenerate_trace_parameter_constraints();
  }

  set_trace_template(trace_template: ColinearTraceTemplate) {
    this.trace_template = trace_template;
    for (const trace of this.trace.conductors) {
      this.trace_ids.free(trace.id);
    }
    this.trace = this.trace_template.create(this.parameters, this.trace.position, this.trace_ids);
    this.regenerate_trace_parameter_constraints();
  }

  override get_sim_conductors(): Conductor[] {
    return [...this.trace.conductors, ...this.plane_conductors];
  }

  get_sim_spacings(): HorizontalSpacing[] {
    return this.trace.spacings;
  }

  override get_simulation_stackup(): Stackup {
    const conductors = this.get_sim_conductors();
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
      this.make_trace_selectable(conductor, group_tag, () => {
        for (const old_conductor of this.trace.conductors) {
          this.trace_ids.free(old_conductor.id)
        }
        const sim_trace = this.trace_template.create(this.parameters, conductor.position, this.trace_ids);
        this.trace = sim_trace;
        this.regenerate_trace_parameter_constraints();
      });
    }
    for (const spacing of trace.spacings) {
      this.hide_spacing(spacing);
    }
  }

  create_parallel_spacing(left: TraceId, right: TraceId): HorizontalSpacing {
    return {
      left_trace: { id: left, attach: "left" },
      right_trace: { id: right, attach: "left" },
      width: {
        type: "size",
        unit: "mm", // pointless field since this width is only for stackup viewer
        placeholder_value: 0,
      },
    }
  }

  override get_viewer_stackup(): Stackup {
    const sim_conductors = this.get_sim_conductors();
    const sim_spacings = this.get_sim_spacings();
    const viewer_conductors = [];
    const viewer_spacings = [];

    for (let conductor of sim_conductors) {
      if (conductor.type == "plane") {
        conductor = this.make_plane_removable({ ...conductor })
      }
      viewer_conductors.push(conductor);
    }

    for (const spacing of sim_spacings) {
      viewer_spacings.push(spacing);
    }

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
          this.hide_spacing(parallel_spacing);
          viewer_spacings.push(parallel_spacing);
        }

        // add ground plane
        const new_plane = create_plane(this.parameters, new_position);
        if (!is_shorting([...sim_conductors, new_plane])) {
          this.make_plane_selectable(new_plane);
          viewer_conductors.push(new_plane);
        }
      }
    }

    return {
      layers: this.layers,
      conductors: viewer_conductors,
      spacings: viewer_spacings,
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
    this.regenerate_trace_parameter_constraints();
  }

  set_trace_template(trace_template: BroadsideTraceTemplate) {
    this.trace_template = trace_template;
    const left_position = this.left.position;
    const right_position = this.right.position;
    this.left = this.trace_template.create_left(this.parameters, left_position, this.trace_ids);
    this.right = this.trace_template.create_right(this.parameters, right_position, this.trace_ids);
    this.broadside_spacing = this.create_broadside_spacing(this.left.root.id, this.right.root.id);
    this.regenerate_trace_parameter_constraints();
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
    const conductors = this.get_sim_conductors()
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
      this.make_trace_selectable(conductor, group_tag, () => {
        for (const trace of this.left.conductors) {
          this.trace_ids.free(trace.id);
        }
        const sim_left = this.trace_template.create_left(this.parameters, left.position, this.trace_ids);
        const sim_spacing = this.create_broadside_spacing(sim_left.root.id, this.right.root.id);
        this.left = sim_left;
        this.broadside_spacing = sim_spacing;
        this.regenerate_trace_parameter_constraints();
      });
    }
    for (const spacing of left.spacings) {
      this.hide_spacing(spacing);
    }
  }

  make_right_trace_selectable(right: BroadsideTrace) {
    const group_tag = `${right.position.layer_id}_${right.position.orientation}_right`;
    for (const conductor of right.conductors) {
      this.make_trace_selectable(conductor, group_tag, () => {
        for (const trace of this.right.conductors) {
          this.trace_ids.free(trace.id);
        }
        const sim_right = this.trace_template.create_right(this.parameters, right.position, this.trace_ids);
        const sim_spacing = this.create_broadside_spacing(this.left.root.id, sim_right.root.id);
        this.right = sim_right;
        this.broadside_spacing = sim_spacing;
        this.regenerate_trace_parameter_constraints();
      });
    }
    for (const spacing of right.spacings) {
      this.hide_spacing(spacing);
    }
  }

  override get_viewer_stackup(): Stackup {
    const sim_conductors = this.get_sim_conductors();
    const sim_spacings = this.get_sim_spacings();
    const viewer_conductors = [];
    const viewer_spacings = [];

    for (let conductor of sim_conductors) {
      if (conductor.type == "plane") {
        conductor = this.make_plane_removable({ ...conductor })
      }
      viewer_conductors.push(conductor);
    }

    for (const spacing of sim_spacings) {
      viewer_spacings.push(spacing);
    }

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
          this.hide_spacing(broadside_spacing);
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
          this.hide_spacing(broadside_spacing);
          viewer_spacings.push(broadside_spacing);
        }

        // add ground plane
        const new_plane = create_plane(this.parameters, new_position);
        if (!is_shorting([...sim_conductors, new_plane])) {
          this.make_plane_selectable(new_plane);
          viewer_conductors.push(new_plane);
        }
      }
    }

    return {
      layers: this.layers,
      conductors: viewer_conductors,
      spacings: viewer_spacings,
    }
  }
}
