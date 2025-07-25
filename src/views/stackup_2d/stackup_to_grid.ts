import {
  type Stackup,
  type Parameter,
  type SurfaceLayer, type InnerLayer, type Position,
  type BroadsidePair, type LayerTraces, type Voltage,

} from "./stackup.ts";
import { ManagedObject, WasmModule } from "../../wasm/index.ts";
import { Grid } from "../../app/electrostatic_2d/grid.ts";
import {
  GridBuilder, type GridBuilderConfig, type GridBuilderPadding,
  type Region, type Shape,
} from "../../app/electrostatic_2d/grid_builder.ts";
import { Profiler } from "../../utility/profiler.ts";
import { convert_distance, type DistanceUnit } from "../../utility/unit_types.ts";

type EpsilonCategory = "soldermask" | "core";

interface EpsilonValue {
  category: EpsilonCategory;
  value: number;
}

export interface StackupGridConfig extends GridBuilderConfig {
  min_epsilon_resolution: number; // smallest possible difference in dielectric epsilon values before they are considered the same
  signal_amplitude: number; // voltage value to use for +/- signals
}

function validate_parameter(param: Parameter): Parameter & { value: number } {
  if (param.value === undefined) {
    param.error = "Field is required";
    throw Error(`Missing field value for ${param.label}`);
  }
  if (typeof(param.value) !== 'number') {
    param.error = "Field is required";
    throw Error(`Non number field value for ${param.label}`);
  }
  if (Number.isNaN(param.value)) {
    param.error = "Field is required";
    throw Error(`NaN field value for ${param.label}`);
  }
  if (param.min !== undefined && param.value < param.min) {
    param.error = `Value must be greater than ${param.min}`;
    throw Error(`Violated minimum value for ${param.label}`);
  }
  if (param.max !== undefined && param.value > param.max) {
    param.error = `Value must be less than ${param.max}`;
    throw Error(`Violated maximum value for ${param.label}`);
  }
  param.error = undefined;
  // type convert if parameter is valid
  return param as Parameter & { value: number };
}

interface TraceXRegion {
  x_left: number;
  x_right: number;
  voltage_index: number;
}

interface ColinearTracesXRegion {
  readonly type: "colinear";
  traces: TraceXRegion[];
}

interface BroadsideTracesXRegion {
  readonly type: "broadside";
  traces: Record<BroadsidePair,TraceXRegion[]>;
}

type TracesXRegion = ColinearTracesXRegion | BroadsideTracesXRegion;
type ConductorType = "traces" | "plane";

export class StackupGrid extends ManagedObject {
  stackup: Stackup;
  target_unit: DistanceUnit;
  conductor_stackup: ConductorType[] = [];
  voltage_indexes: {
    v_table: Record<Voltage, number>,
    v_set: Set<Voltage>,
  };
  epsilon_indexes: {
    ek_table: EpsilonValue[];
    soldermask_indices: Set<number>;
  };
  config: StackupGridConfig;
  traces_x_region: TracesXRegion;
  grid_builder_regions: Region[] = [];
  grid_builder_padding: GridBuilderPadding = {};
  grid_builder: GridBuilder;
  used_parameters = new Set<Parameter>();
  profiler?: Profiler;

  constructor(
    module: WasmModule,
    stackup: Stackup, config: StackupGridConfig,
    profiler: Profiler | undefined,
  ) {
    super(module);
    this.stackup = stackup;
    this.target_unit = stackup.size_unit;
    this.profiler = profiler;
    this.config = config;
    this.voltage_indexes = {
      v_table: {
        "ground": 0,
        "positive": 1,
        "negative": 2,
      },
      v_set: new Set(),
    };
    this.epsilon_indexes = {
      ek_table: [],
      soldermask_indices: new Set(),
    };
    // test stackup in air
    const er_air = 1.0;
    this.setup_push_epsilon(er_air, "core");

    // create grid
    this.traces_x_region = this.setup_create_traces_x_region();
    this.setup_create_grid_builder_layers();
    this.setup_create_grid_builder_padding();
    this.grid_builder = new GridBuilder(
      this.module,
      this.grid_builder_regions,
      this.config, this.grid_builder_padding,
      this.profiler,
    );
    this._child_objects.add(this.grid_builder);
  }

  get grid(): Grid {
    return this.grid_builder.grid;
  }

  get_parameter_value(param: Parameter): number {
    const valid_param = validate_parameter(param);
    this.used_parameters.add(param);
    switch (valid_param.type) {
      case "etch_factor": return valid_param.value;
      case "epsilon": return valid_param.value;
      case "size": {
        const size = convert_distance(valid_param.value, valid_param.unit, this.target_unit);
        return size;
      }
    }
  }

  setup_create_traces_x_region(): TracesXRegion {
    const get_traces = (layout: LayerTraces): TraceXRegion[] => {
      const regions: TraceXRegion[] = [];
      let x_offset = 0;
      const Ntraces = layout.traces.length;
      const Nspacings = layout.spacings.length;
      if (Ntraces !== (Nspacings+1)) {
        throw Error(`Expected number of traces ${Ntraces} to be number of spacings ${Nspacings} + 1`);
      }
      for (let i = 0; i < Ntraces; i++) {
        const trace = layout.traces[i];
        {
          const voltage_index = this.setup_push_voltage(trace.voltage);
          const width = this.get_parameter_value(trace.width);
          const x_left = x_offset;
          const x_right = x_left + width;
          regions.push({ x_left, x_right, voltage_index });
          x_offset += width;
        }
        const spacing = layout.spacings.at(i);
        if (spacing !== undefined) {
          const width = this.get_parameter_value(spacing.width);
          x_offset += width;
        }
      }
      return regions;
    };

    switch (this.stackup.type) {
      case "colinear": {
        const traces = get_traces(this.stackup.trace_layout);
        return {
          type: "colinear" as const,
          traces,
        };
      }
      case "broadside": {
        const left_traces = get_traces(this.stackup.trace_layout.left);
        const right_traces = get_traces(this.stackup.trace_layout.right);
        const broadside_spacing = this.get_parameter_value(this.stackup.broadside_spacing);
        let right_traces_offset = undefined as (number | undefined);
        // determine offset
        {
          const left_trace = left_traces[this.stackup.trace_layout.left.broadside_index];
          const right_trace = left_traces[this.stackup.trace_layout.right.broadside_index];
          const x_left = (left_trace.x_left+left_trace.x_right)/2;
          const x_right = (right_trace.x_left+right_trace.x_right)/2;
          const new_x_right = x_left+broadside_spacing;
          right_traces_offset = new_x_right-x_right;
        }
        // offset right pair traces
        {
          for (const trace of right_traces) {
            trace.x_left += right_traces_offset;
            trace.x_right += right_traces_offset;
          }
        }
        return {
          type: "broadside" as const,
          traces: {
            left: left_traces,
            right: right_traces,
          },
        };
      }
    }
  }

  get_trace_x_regions(position: Position): TraceXRegion[] | undefined {
    switch (this.traces_x_region.type) {
      case "colinear": {
        if (this.traces_x_region.type !== this.stackup.type) {
          throw Error(`Mismatch between stackup type (${this.stackup.type}) and x trace region type (${this.traces_x_region.type})`)
        }
        if (this.stackup.has_traces(position)) {
          return this.traces_x_region.traces;
        }
        return undefined;
      }
      case "broadside": {
        if (this.traces_x_region.type !== this.stackup.type) {
          throw Error(`Mismatch between stackup type (${this.stackup.type}) and x trace region type (${this.traces_x_region.type})`)
        }
        if (this.stackup.has_traces_pair(position, "left")) {
          return this.traces_x_region.traces["left"];
        }
        if (this.stackup.has_traces_pair(position, "right")) {
          return this.traces_x_region.traces["right"];
        }
        return undefined;
      }
    }
  }

  setup_create_voltage_plane(y_offset: number): number {
    const plane_height = 1e-3;
    const voltage_index = this.setup_push_voltage("ground");
    this.grid_builder_regions.push({
      type: "voltage",
      voltage_index,
      shapes: [
        {
          type: "rectangle",
          y_top: y_offset,
          y_bottom: y_offset+plane_height,
          min_y_gridlines: 2,
        }
      ],
    });
    this.conductor_stackup.push("plane");
    return plane_height;
  }

  setup_create_trace_shape(trace: TraceXRegion, y_base: number, y_taper: number, etch_factor: number): Shape[] {
    const x_left = trace.x_left;
    const x_right = trace.x_right;
    const height = Math.abs(y_base-y_taper);
    const etch_width = height*etch_factor;
    const x_left_taper = x_left+etch_width;
    const x_right_taper = x_right-etch_width;
    const shapes: Shape[] = [];
    shapes.push({
      type: "triangle",
      x_base: x_left,
      x_tip: x_left_taper,
      y_base: y_base,
      y_tip: y_taper,
    });
    shapes.push({
      type: "rectangle",
      x_left: x_left_taper,
      x_right: x_right_taper,
      y_top: Math.min(y_base, y_taper),
      y_bottom: Math.max(y_base, y_taper),
    });
    shapes.push({
      type: "triangle",
      x_base: x_right,
      x_tip: x_right_taper,
      y_base: y_base,
      y_tip: y_taper,
    });
    return shapes;
  }

  setup_create_trace(trace: TraceXRegion, y_base: number, y_taper: number, etch_factor: number) {
    const shapes = this.setup_create_trace_shape(trace, y_base, y_taper, etch_factor);
    this.grid_builder_regions.push({
      type: "voltage",
      shapes,
      voltage_index: trace.voltage_index,
    });
  }

  setup_create_traces(traces: TraceXRegion[], y_base: number, y_taper: number, etch_factor: number) {
    for (const trace of traces) {
      this.setup_create_trace(trace, y_base, y_taper, etch_factor);
    }
    this.conductor_stackup.push("traces");
  }

  setup_create_soldermask(
    traces: TraceXRegion[],
    y_surface: number, y_base: number, y_taper: number,
    etch_factor: number, epsilon_index: number,
  ) {
    const shapes: Shape[] = [];
    for (const trace of traces) {
      const trace_shapes = this.setup_create_trace_shape(trace, y_base, y_taper, etch_factor);
      shapes.push(...trace_shapes);
    }
    shapes.push({
      type: "rectangle",
      y_top: Math.min(y_surface, y_base),
      y_bottom: Math.max(y_surface, y_base),
    });
    this.grid_builder_regions.push({
      type: "dielectric",
      shapes,
      dielectric_index: epsilon_index,
    });
  }

  setup_create_grid_builder_surface_layer(y_offset: number, layer: SurfaceLayer): number {
    // copper plane replaces entire surface region
    const has_plane = layer.has_plane;
    if (has_plane) {
      return this.setup_create_voltage_plane(y_offset);
    }

    const traces = this.get_trace_x_regions({ layer_id: layer.id, orientation: layer.orientation });
    if (traces === undefined) {
      // flat soldermask region only
      if (layer.has_soldermask) {
        const height = this.get_parameter_value(layer.soldermask_height);
        const epsilon = this.get_parameter_value(layer.epsilon);
        const epsilon_index = this.setup_push_epsilon(epsilon, "soldermask");
        this.grid_builder_regions.push({
          type: "dielectric",
          dielectric_index: epsilon_index,
          shapes: [
            {
              type: "rectangle",
              y_top: y_offset,
              y_bottom: y_offset+height,
            },
          ],
        });
        return height;
      } else {
      // nothing region
        return 0;
      }
    }

    // determine layer height
    let soldermask_height = undefined;
    if (layer.has_soldermask) {
      soldermask_height = this.get_parameter_value(layer.soldermask_height);
    }
    const trace_height = this.get_parameter_value(layer.trace_height);
    const y_top = y_offset;
    const height = trace_height + (soldermask_height ?? 0);
    const y_bottom = y_top+height;

    // create traces
    const etch_factor = this.get_parameter_value(layer.etch_factor);
    {
      let y_base = undefined;
      let y_taper = undefined;
      switch (layer.orientation) {
        case "top": {
          y_base = y_top;
          y_taper = y_base+trace_height;
          break;
        }
        case "bottom": {
          y_taper = y_bottom-trace_height;
          y_base = y_bottom;
          break;
        }
      }
      this.setup_create_traces(traces, y_base, y_taper, etch_factor);
    }

    // create soldermask
    if (soldermask_height !== undefined) {
      let y_surface = undefined;
      let y_base = undefined;
      let y_taper = undefined;
      switch (layer.orientation) {
        case "top": {
          y_surface = y_top;
          y_base = y_top+soldermask_height;
          y_taper = y_base+trace_height+soldermask_height;
          break;
        }
        case "bottom": {
          y_taper = y_bottom-trace_height-soldermask_height;
          y_base = y_bottom-soldermask_height;
          y_surface = y_bottom;
          break;
        }
      }
      const epsilon = this.get_parameter_value(layer.epsilon);
      const epsilon_index = this.setup_push_epsilon(epsilon, "soldermask");
      this.setup_create_soldermask(traces, y_surface, y_base, y_taper, etch_factor, epsilon_index);
    }

    return height;
  }

  setup_create_grid_builder_inner_layer(y_offset: number, layer: InnerLayer): number {
    const y_top = y_offset;
    const top_traces = this.get_trace_x_regions({ layer_id: layer.id, orientation: "top" });
    const bottom_traces = this.get_trace_x_regions({ layer_id: layer.id, orientation: "bottom" });
    if (layer.has_plane.top) {
      y_offset += this.setup_create_voltage_plane(y_offset);
    } else if (top_traces !== undefined) {
      const height = this.get_parameter_value(layer.trace_height);
      const y_base = y_offset;
      const y_taper = y_base+height;
      const etch_factor = this.get_parameter_value(layer.etch_factor);
      this.setup_create_traces(top_traces, y_base, y_taper, etch_factor);
      y_offset += height;
    }
    y_offset += this.get_parameter_value(layer.dielectric_height);
    if (layer.has_plane.bottom) {
      y_offset += this.setup_create_voltage_plane(y_offset);
    } else if (bottom_traces !== undefined) {
      const height = this.get_parameter_value(layer.trace_height);
      const y_taper = y_offset;
      const y_base = y_taper+height;
      const etch_factor = this.get_parameter_value(layer.etch_factor);
      this.setup_create_traces(bottom_traces, y_base, y_taper, etch_factor);
      y_offset += height;
    }
    const y_bottom = y_offset;
    const height = y_bottom-y_top;
    const epsilon = this.get_parameter_value(layer.epsilon);
    const epsilon_index = this.setup_push_epsilon(epsilon, "core");
    this.grid_builder_regions.push({
      type: "dielectric",
      dielectric_index: epsilon_index,
      shapes: [
        {
          type: "rectangle",
          y_top,
          y_bottom,
        },
      ],
    });
    return height;
  }

  setup_create_grid_builder_layers() {
    this.profiler?.begin("create_layers");
    let y_offset = 0;
    for (const layer of this.stackup.layers) {
      this.profiler?.begin(`create_${layer.type}_layer`);
      switch (layer.type) {
        case "surface": {
          y_offset += this.setup_create_grid_builder_surface_layer(y_offset, layer);
          break;
        }
        case "inner": {
          y_offset += this.setup_create_grid_builder_inner_layer(y_offset, layer);
          break;
        }
      }
      this.profiler?.end();
    }
    this.profiler?.end();
  }

  setup_create_grid_builder_padding() {
    this.profiler?.begin("create_grid_builder_padding");
    const padding = this.grid_builder_padding;
    // always pad x-axis
    padding.x_left = true;
    padding.x_right = true;

    if (this.conductor_stackup.at(0) !== "plane") {
      padding.y_top = true;
    }
    if (this.conductor_stackup.at(-1) !== "plane") {
      padding.y_bottom = true;
    }
    this.profiler?.end();
  }

  setup_push_epsilon(epsilon_k: number, category: EpsilonCategory): number {
    const ek_table = this.epsilon_indexes.ek_table;
    for (let i = 0; i < ek_table.length; i++) {
      const elem = ek_table[i];
      if (elem.category != category) continue;
      const delta = Math.abs(elem.value-epsilon_k);
      if (delta < this.config.min_epsilon_resolution) return i;
    }
    const index = ek_table.length;
    ek_table.push({
      category,
      value: epsilon_k,
    });
    if (category === "soldermask") {
      this.epsilon_indexes.soldermask_indices.add(index);
    }
    return index;
  }

  setup_push_voltage(voltage: Voltage): number {
    this.voltage_indexes.v_set.add(voltage);
    return this.voltage_indexes.v_table[voltage];
  }

  is_differential_pair(): boolean {
    const v_set =  this.voltage_indexes.v_set;
    return v_set.has("positive") && v_set.has("negative");
  }

  has_soldermask(): boolean {
    return this.epsilon_indexes.soldermask_indices.size > 0;
  }

  configure_odd_mode_diffpair_voltage() {
    const v_table = this.grid.v_table.array_view;
    v_table[0] = 0;
    v_table[1] = this.config.signal_amplitude;
    v_table[2] = -this.config.signal_amplitude;
    this.grid.v_input = 2*this.config.signal_amplitude;
  }

  configure_even_mode_diffpair_voltage() {
    const v_table = this.grid.v_table.array_view;
    v_table[0] = 0;
    v_table[1] = this.config.signal_amplitude;
    v_table[2] = this.config.signal_amplitude;
    this.grid.v_input = 2*this.config.signal_amplitude;
  }

  configure_single_ended_voltage() {
    const v_table = this.grid.v_table.array_view;
    v_table[0] = 0;
    v_table[1] = this.config.signal_amplitude;
    v_table[2] = 0;
    this.grid.v_input = this.config.signal_amplitude;
  }

  configure_masked_dielectric() {
    const src_ek_table = this.epsilon_indexes.ek_table;
    const dst_ek_table = this.grid.ek_table.array_view;
    for (let i = 0; i < src_ek_table.length; i++) {
      const ek = src_ek_table[i];
      dst_ek_table[i] = ek.value;
    }
  }

  configure_unmasked_dielectric() {
    const src_ek_table = this.epsilon_indexes.ek_table;
    const dst_ek_table = this.grid.ek_table.array_view;
    const soldermask_indices = this.epsilon_indexes.soldermask_indices;
    const er0 = src_ek_table[0].value;
    for (let i = 0; i < src_ek_table.length; i++) {
      const ek = soldermask_indices.has(i) ? er0 : src_ek_table[i].value;
      dst_ek_table[i] = ek;
    }
  }
}
