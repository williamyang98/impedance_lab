import {
  type Stackup,
  type Orientation, type LayerId, type TraceId,
  type Conductor,
  type Layer,
  type HorizontalSpacing,
} from "./stackup.ts";
import { sizes } from "./viewer.ts";

class ParameterCache<K, V> {
  cache: Partial<Record<string | number, V>> = {};
  get_hash: (key: K) => string | number;
  get_default_value: (key: K) => V;

  constructor(get_hash: (key: K) => string | number, get_default_value: (key: K) => V) {
    this.get_hash = get_hash;
    this.get_default_value = get_default_value;
  }

  get(key: K): V {
    const hash = this.get_hash(key);
    let value = this.cache[hash];
    if (value !== undefined) {
      return value;
    }
    value = this.get_default_value(key);
    this.cache[hash] = value;
    return value;
  }
}

interface IdStore {
  own(id?: number): number;
}

class ArenaIdStore {
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

class BumpIdStore {
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
      if (!this.can_layer_contain_conductor_orientation(layer, conductor.orientation)) {
        return true;
      }
    }
    return false;
  },
  is_conductor_in_layer(layer: Layer, conductor: Conductor, orientation?: Orientation): boolean {
    if (layer.id != conductor.layer_id) return false;
    if (orientation === undefined) return true;
    return conductor.orientation == orientation;
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

function create_layer_parameters_cache() {
  const id_to_index: Partial<Record<LayerId, number>> = {};
  const get_index = (id: LayerId): number => {
    const index  = id_to_index[id];
    if (index === undefined) {
      throw Error(`Failed to get layer index of layer id ${id}`);
    }
    return index;
  }

  return {
    id_to_index,
    dW: new ParameterCache(
      (i: number) => i,
      (i: number) => {
        return {
          get name() { return `dW${get_index(i)}`; },
          description: "Trace taper",
          get taper_suffix() { return `${get_index(i)}`; },
          min: 0,
          value: 0,
          placeholder_value: sizes.trace_taper,
        };
      },
    ),
    T: new ParameterCache(
      (i: number) => i,
      (i: number) => {
        return {
          get name() { return `T${get_index(i)}`; },
          description: "Trace thickness",
          min: 0,
          value: 0.035,
          placeholder_value: sizes.trace_height,
        };
      },
    ),
    SH: new ParameterCache(
      (i: number) => i,
      (i: number) => {
        return {
          get name() { return `H${get_index(i)}` },
          description: "Soldermask thickness",
          min: 0,
          value: 0.0152,
          placeholder_value: sizes.soldermask_height,
        };
      },
    ),
    H: new ParameterCache(
      (i: number) => i,
      (i: number) => {
        return {
          get name() { return `H${get_index(i)}`; },
          description: "Dielectric height",
          min: 0,
          value: 0.15,
          placeholder_value: sizes.core_height,
        };
      },
    ),
    ER: new ParameterCache(
      (i: number) => i,
      (i: number) => {
        return {
          get name() { return `ER${get_index(i)}`; },
          description: "Dielectric constant",
          min: 1,
          value: 4.1,
        };
      },
    ),
  }
}

function create_conductor_parameters() {
  return {
    PH: { value: 0.1, placeholder_value: sizes.copper_layer_height },
    W: {
        name: "W",
        description: "Trace width",
        min: 0,
        value: 0.25,
        placeholder_value: sizes.signal_trace_width,
    },
    CW: {
      name: "CW",
      description: "Coplanar ground width",
      min: 0,
      value: 0.25,
      placeholder_value: sizes.ground_trace_width,
    },
    S: {
      name: "S",
      description: "Signal separation",
      min: 0,
      value: 0.25,
      placeholder_value: sizes.signal_width_separation,
    },
    B: {
      name: "S",
      description: "Broadside separation",
      min: 0,
      value: 0,
      placeholder_value: sizes.broadside_width_separation,
    },
    CS: {
      name: "CS",
      description: "Coplanar ground separation",
      min: 0,
      value: 0.25,
      placeholder_value: sizes.ground_width_separation,
    },
  }
}

export abstract class VerticalStackupEditor {
  layers: Layer[] = [];
  layer_id = new ArenaIdStore();
  layer_parameters_cache = create_layer_parameters_cache();

  constructor() {}

  abstract get_sim_conductors(): Conductor[];

  get_adjacent_layers(layer_index: number): [(Layer | undefined), (Layer | undefined)] {
    const total_layers = this.layers.length;
    const prev_layer = (layer_index > 0) ? this.layers[layer_index-1] : undefined;
    const next_layer = (layer_index < total_layers-1) ? this.layers[layer_index+1] : undefined;
    return [prev_layer, next_layer];
  }

  regenerate_layer_id_to_index() {
    for (let layer_index = 0; layer_index < this.layers.length; layer_index++) {
      const layer = this.layers[layer_index];
      this.layer_parameters_cache.id_to_index[layer.id] = layer_index;
    }
  }

  create_layer(type: LayerType, layer_id: LayerId, orientation: Orientation): Layer {
    const P = this.layer_parameters_cache;
    switch (type) {
      case "core": {
        return {
          type: "core",
          id: layer_id,
          height: P.H.get(layer_id),
          epsilon: P.ER.get(layer_id),
        };
      }
      case "prepreg": {
        return {
          type: "prepreg",
          id: layer_id,
          height: P.H.get(layer_id),
          epsilon: P.ER.get(layer_id),
          trace_height: P.T.get(layer_id),
          trace_taper: P.dW.get(layer_id),
        };
      }
      case "soldermask": {
        return {
          type: "soldermask",
          id: layer_id,
          height: P.SH.get(layer_id),
          epsilon: P.ER.get(layer_id),
          trace_height: P.T.get(layer_id),
          trace_taper: P.dW.get(layer_id),
          orientation,
        };
      }
      case "unmasked": {
        return {
          type: "unmasked",
          id: layer_id,
          trace_height: P.T.get(layer_id),
          trace_taper: P.dW.get(layer_id),
          orientation,
        };
      }
    }
  }

  try_add_prepreg_layer(layer_index: number): (() => void) | undefined {
    const prev_layer = (layer_index > 0) ? this.layers[layer_index-1] : undefined;
    const curr_layer = (layer_index < this.layers.length) ? this.layers[layer_index] : undefined;
    if (prev_layer && !CommonRules.can_layer_support_adjacent_layer(prev_layer, "down")) return undefined;
    if (curr_layer && !CommonRules.can_layer_support_adjacent_layer(curr_layer, "up")) return undefined;
    const new_layer_temp = this.create_layer("prepreg", this.layer_id.borrow(), "down")
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
    const new_layer_temp = this.create_layer(type, layer.id, new_orientation);

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

  abstract get_simulation_stackup(): Stackup;
  abstract get_viewer_stackup(): Stackup;
}

type TraceConductor = Conductor & { type: "trace" };
type PlaneConductor = Conductor & { type: "plane" };

interface ColinearTrace {
  layer_id: LayerId;
  orientation: Orientation;
  conductors: TraceConductor[];
  spacings: HorizontalSpacing[];
}

export abstract class ColinearSignalEditor extends VerticalStackupEditor {
  conductor_parameters = create_conductor_parameters();
  trace_ids: ArenaIdStore = new ArenaIdStore();
  trace: ColinearTrace;
  plane_conductors: PlaneConductor[];

  constructor() {
    super();
    const trace_layer_id = this.layer_id.own();
    this.layers.push(this.create_layer("soldermask", trace_layer_id, "down"));
    this.layers.push(this.create_layer("core", this.layer_id.own(), "down"));
    const plane_layer_id = this.layer_id.own();
    this.layers.push(this.create_layer("unmasked", plane_layer_id, "up"));
    this.regenerate_layer_id_to_index();

    {
      const trace = this.create_colinear_traces(trace_layer_id, "down", this.trace_ids);
      const plane = this.create_ground_plane_conductor(plane_layer_id, "up");
      this.trace = trace;
      this.plane_conductors = [plane];
    }
  }

  remove_plane(plane: PlaneConductor) {
    const index = this.plane_conductors.indexOf(plane);
    if (index >= 0) {
      this.plane_conductors.splice(index, 1);
    }
  }

  abstract create_colinear_traces(layer_id: LayerId, orientation: Orientation, ids: IdStore): ColinearTrace;

  create_ground_plane_conductor(layer_id: LayerId, orientation: Orientation): PlaneConductor {
    return {
      type: "plane",
      layer_id,
      orientation,
      height: this.conductor_parameters.PH,
      voltage: 0,
    }
  }

  override get_sim_conductors(): Conductor[] {
    return [...this.trace.conductors, ...this.plane_conductors];
  }

  get_sim_spacings(): HorizontalSpacing[] {
    return this.trace.spacings;
  }

  make_plane_removable(plane: PlaneConductor) {
    plane.grid = {
      override_total_divisions: 3,
    };
    plane.viewer = {
      on_click: () => this.remove_plane(plane),
    };
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

  override get_simulation_stackup(): Stackup {
    const conductors = this.get_sim_conductors_clickable();
    const spacings = this.get_sim_spacings();
    return {
      layers: this.layers,
      spacings,
      conductors,
    }
  }

  hide_spacings(spacings: HorizontalSpacing[]) {
    for (const spacing of spacings) {
      if (spacing.viewer === undefined) spacing.viewer = {};
      spacing.viewer.is_display = false;
    }
  }

  make_trace_conductors_selectable(trace: ColinearTrace) {
    for (const conductor of trace.conductors) {
      let viewer = conductor.viewer ?? {};
      viewer = {
        is_labeled: false,
        display: "selectable",
        on_click: () => {
          for (const old_conductor of this.trace.conductors) {
            this.trace_ids.free(old_conductor.id)
          }
          const sim_trace = this.create_colinear_traces(conductor.layer_id, conductor.orientation, this.trace_ids);
          this.trace = sim_trace;
        },
        ...viewer,
      };
      conductor.viewer = viewer;
    }

    this.hide_spacings(trace.spacings);
  }

  make_plane_conductor_selectable(plane: PlaneConductor) {
    plane.viewer = {
      is_labeled: false,
      display: "selectable",
      on_click: () => {
        const sim_plane = this.create_ground_plane_conductor(plane.layer_id, plane.orientation);
        this.plane_conductors.push(sim_plane);
      },
    };
    plane.layout = {
      shrink_trace_layer: false,
    };
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
      const { layer_id, orientation } = conductor;
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
        const new_trace = this.create_colinear_traces(layer.id, orientation, viewer_trace_ids);
        if (!is_shorting([...new_trace.conductors, ...this.plane_conductors])) {
          this.make_trace_conductors_selectable(new_trace);
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
        const new_plane = this.create_ground_plane_conductor(layer.id, orientation);
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

export class CoplanarDifferentialPairEditor extends ColinearSignalEditor {
  constructor() {
    super();
  }

  override create_colinear_traces(layer_id: LayerId, orientation: Orientation, id_store: IdStore): ColinearTrace {
    const ids = Array.from({ length: 4 }, (_) => id_store.own());
    const p = this.conductor_parameters;
    const conductors: TraceConductor[] = [
      { type: "trace", id: ids[0], layer_id, orientation, width: p.CW, voltage: 0 },
      { type: "trace", id: ids[1], layer_id, orientation, width: p.W, voltage: 1 },
      { type: "trace", id: ids[2], layer_id, orientation, width: p.W, voltage: -1 },
      { type: "trace", id: ids[3], layer_id, orientation, width: p.CW, voltage: 0 },
    ];
    const spacings: HorizontalSpacing[] = [
      { left_trace: { id: ids[0], attach: "right" }, right_trace: { id: ids[1], attach: "left" }, width: p.CS },
      { left_trace: { id: ids[1], attach: "right" }, right_trace: { id: ids[2], attach: "left" }, width: p.S },
      { left_trace: { id: ids[2], attach: "right" }, right_trace: { id: ids[3], attach: "left" }, width: p.CS },
    ];
    return { layer_id, orientation, conductors, spacings };
  }
}

export class DifferentialPairEditor extends ColinearSignalEditor {
  constructor() {
    super();
  }

  override create_colinear_traces(layer_id: LayerId, orientation: Orientation, id_store: IdStore): ColinearTrace {
    const ids = Array.from({ length: 2 }, (_) => id_store.own());
    const p = this.conductor_parameters;
    const conductors: TraceConductor[] = [
      { type: "trace", id: ids[0], layer_id, orientation, width: p.W, voltage: 1 },
      { type: "trace", id: ids[1], layer_id, orientation, width: p.W, voltage: -1 },
    ];
    const spacings: HorizontalSpacing[] = [
      { left_trace: { id: ids[0], attach: "right" }, right_trace: { id: ids[1], attach: "left" }, width: p.S },
    ];
    return { layer_id, orientation, conductors, spacings };
  }
}

export class SingleEndedEditor extends ColinearSignalEditor {
  constructor() {
    super();
  }

  override create_colinear_traces(layer_id: LayerId, orientation: Orientation, id_store: IdStore): ColinearTrace {
    const ids = Array.from({ length: 1 }, (_) => id_store.own());
    const p = this.conductor_parameters;
    const conductors: TraceConductor[] = [
      { type: "trace", id: ids[0], layer_id, orientation, width: p.W, voltage: 1 },
    ];
    const spacings: HorizontalSpacing[] = [];
    return { layer_id, orientation, conductors, spacings };
  }
}

export class CoplanarSingleEndedEditor extends ColinearSignalEditor {
  constructor() {
    super();
  }

  override create_colinear_traces(layer_id: LayerId, orientation: Orientation, id_store: IdStore): ColinearTrace {
    const ids = Array.from({ length: 3 }, (_) => id_store.own());
    const p = this.conductor_parameters;
    const conductors: TraceConductor[] = [
      { type: "trace", id: ids[0], layer_id, orientation, width: p.CW, voltage: 0 },
      { type: "trace", id: ids[1], layer_id, orientation, width: p.W, voltage: 1 },
      { type: "trace", id: ids[2], layer_id, orientation, width: p.CW, voltage: 0 },
    ];
    const spacings: HorizontalSpacing[] = [
      { left_trace: { id: ids[0], attach: "right" }, right_trace: { id: ids[1], attach: "left" }, width: p.CS },
      { left_trace: { id: ids[1], attach: "right" }, right_trace: { id: ids[2], attach: "left" }, width: p.CS },
    ];
    return { layer_id, orientation, conductors, spacings };
  }
}

interface BroadsideTrace {
  layer_id: LayerId;
  orientation: Orientation;
  conductors: TraceConductor[],
  root: TraceConductor,
  spacings: HorizontalSpacing[],
}

export abstract class BroadsideSignalEditor extends VerticalStackupEditor {
  conductor_parameters = create_conductor_parameters();
  trace_ids: ArenaIdStore = new ArenaIdStore();
  left: BroadsideTrace;
  right: BroadsideTrace;
  broadside_spacing: HorizontalSpacing;
  plane_conductors: PlaneConductor[];

  constructor() {
    super();

    const left_id = this.layer_id.own();
    this.layers.push(this.create_layer("soldermask", left_id, "down"));
    this.layers.push(this.create_layer("core", this.layer_id.own(), "down"));
    const right_id = this.layer_id.own();
    this.layers.push(this.create_layer("soldermask", right_id, "up"));
    this.regenerate_layer_id_to_index();

    const left = this.create_left_traces(left_id, "down", this.trace_ids);
    const right = this.create_right_traces(right_id, "up", this.trace_ids);
    const broadside_spacing = this.create_broadside_spacing(left.root.id, right.root.id);
    this.left = left;
    this.right = right;
    this.broadside_spacing = broadside_spacing;
    this.plane_conductors = [];
  }

  remove_plane(plane: PlaneConductor) {
    const index = this.plane_conductors.indexOf(plane);
    if (index >= 0) {
      this.plane_conductors.splice(index, 1);
    }
  }

  abstract create_left_traces(layer_id: LayerId, orientation: Orientation, id_store: IdStore): BroadsideTrace;

  abstract create_right_traces(layer_id: LayerId, orientation: Orientation, id_store: IdStore): BroadsideTrace;

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
      width: this.conductor_parameters.B,
    }
  }

  create_ground_plane_conductor(layer_id: LayerId, orientation: Orientation): Conductor & { type: "plane"} {
    return {
      type: "plane",
      layer_id,
      orientation,
      height: this.conductor_parameters.PH,
      voltage: 0,
    }
  }

  override get_sim_conductors(): Conductor[] {
    return [...this.left.conductors, ...this.right.conductors, ...this.plane_conductors];
  }

  get_sim_spacings(): HorizontalSpacing[] {
    return [...this.left.spacings, this.broadside_spacing, ...this.right.spacings];
  }

  make_plane_removable(plane: PlaneConductor) {
    plane.grid = {
      override_total_divisions: 3,
    };
    plane.viewer = {
      on_click: () => this.remove_plane(plane),
    };
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

  override get_simulation_stackup(): Stackup {
    const conductors = this.get_sim_conductors_clickable()
    const spacings = this.get_sim_spacings();
    return {
      layers: this.layers,
      spacings,
      conductors,
    }
  }

  hide_spacings(spacings: HorizontalSpacing[]) {
    for (const spacing of spacings) {
      if (spacing.viewer === undefined) spacing.viewer = {};
      spacing.viewer.is_display = false;
    }
  }

  make_left_trace_selectable(left: BroadsideTrace) {
    for (const conductor of left.conductors) {
      let viewer = conductor.viewer ?? {};
      viewer = {
        is_labeled: false,
        display: "selectable",
        on_click: () => {
          for (const trace of this.left.conductors) {
            this.trace_ids.free(trace.id);
          }
          const sim_left = this.create_left_traces(left.layer_id, left.orientation, this.trace_ids);
          const sim_spacing = this.create_broadside_spacing(sim_left.root.id, this.right.root.id);
          this.left = sim_left;
          this.broadside_spacing = sim_spacing;
        },
        ...viewer,
      };
      conductor.viewer = viewer;
    }

    this.hide_spacings(left.spacings);
  }

  make_right_trace_selectable(right: BroadsideTrace) {
    for (const conductor of right.conductors) {
      let viewer = conductor.viewer ?? {};
      viewer = {
        is_labeled: false,
        display: "selectable",
        on_click: () => {
          for (const trace of this.right.conductors) {
            this.trace_ids.free(trace.id);
          }
          const sim_right = this.create_right_traces(right.layer_id, right.orientation, this.trace_ids);
          const sim_spacing = this.create_broadside_spacing(this.left.root.id, sim_right.root.id);
          this.right = sim_right;
          this.broadside_spacing = sim_spacing;
        },
        ...viewer,
      };
      conductor.viewer = viewer;
    }

    this.hide_spacings(right.spacings);
  }

  make_plane_conductor_selectable(plane: Conductor & { type: "plane"}) {
    plane.viewer = {
      is_labeled: false,
      display: "selectable",
      on_click: () => {
        const sim_plane = this.create_ground_plane_conductor(plane.layer_id, plane.orientation);
        this.plane_conductors.push(sim_plane);
      },
    };
    plane.layout = {
      shrink_trace_layer: false,
    };
  }

  override get_viewer_stackup(): Stackup {
    const sim_conductors = this.get_sim_conductors_clickable();
    const sim_spacings = this.get_sim_spacings();
    const viewer_conductors = [];
    const viewer_spacings = [];

    const occupied_locations: Partial<Record<LayerId, Set<Orientation>>> = {};
    for (const conductor of sim_conductors) {
      const { layer_id, orientation } = conductor;
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

        // // left traces
        const new_left = this.create_left_traces(layer.id, orientation, viewer_trace_ids);
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
        const new_right = this.create_right_traces(layer.id, orientation, viewer_trace_ids);
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
        const new_plane = this.create_ground_plane_conductor(layer.id, orientation);
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

export class BroadsideCoplanarDifferentialPairEditor extends BroadsideSignalEditor {
  constructor() {
    super();
  }

  create_traces(layer_id: LayerId, orientation: Orientation, signal_voltage: number, id_store: IdStore): BroadsideTrace {
    const ids = Array.from({ length: 3 }, (_) => id_store.own());
    const p = this.conductor_parameters;
    const conductors: TraceConductor[] = [
      { type: "trace", id: ids[0], layer_id, orientation, width: p.CW, voltage: 0 },
      { type: "trace", id: ids[1], layer_id, orientation, width: p.W, voltage: signal_voltage },
      { type: "trace", id: ids[2], layer_id, orientation, width: p.CW, voltage: 0 },
    ];
    const root = conductors[1];
    const spacings: HorizontalSpacing[] = [
      { left_trace: { id: ids[0], attach: "right" }, right_trace: { id: ids[1], attach: "left" }, width: p.CS },
      { left_trace: { id: ids[1], attach: "right" }, right_trace: { id: ids[2], attach: "left" }, width: p.CS },
    ];
    return { layer_id, orientation, root, conductors, spacings };
  }

  override create_left_traces(layer_id: LayerId, orientation: Orientation, id_store: IdStore): BroadsideTrace {
    return this.create_traces(layer_id, orientation, 1, id_store);
  }

  override create_right_traces(layer_id: LayerId, orientation: Orientation, id_store: IdStore): BroadsideTrace {
    return this.create_traces(layer_id, orientation, -1, id_store);
  }
}

export class BroadsideDifferentialPairEditor extends BroadsideSignalEditor {
  constructor() {
    super();
  }

  create_traces(layer_id: LayerId, orientation: Orientation, signal_voltage: number, id_store: IdStore): BroadsideTrace {
    const ids = Array.from({ length: 1 }, (_) => id_store.own());
    const p = this.conductor_parameters;
    const conductors: TraceConductor[] = [
      { type: "trace", id: ids[0], layer_id, orientation, width: p.W, voltage: signal_voltage },
    ];
    const root = conductors[0];
    const spacings: HorizontalSpacing[] = [];
    return { layer_id, orientation, root, conductors, spacings };
  }

  override create_left_traces(layer_id: LayerId, orientation: Orientation, id_store: IdStore): BroadsideTrace {
    return this.create_traces(layer_id, orientation, 1, id_store);
  }

  override create_right_traces(layer_id: LayerId, orientation: Orientation, id_store: IdStore): BroadsideTrace {
    return this.create_traces(layer_id, orientation, -1, id_store);
  }
}
