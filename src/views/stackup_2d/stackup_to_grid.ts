import { type EpsilonParameter, type Voltage } from "./stackup.ts";
import { ManagedObject, WasmModule } from "../../wasm/index.ts";
import { type ConductorLayout, type StackupLayout } from "./layout.ts";
import { Float32ModuleNdarray } from "../../utility/module_ndarray.ts";

import { Grid } from "../../app/electrostatic_2d/grid.ts";
import {
  GridBuilder, type GridBuilderConfig, type GridBuilderPadding,
  type Region, type Shape,
} from "../../app/electrostatic_2d/grid_builder.ts";
import { Profiler } from "../../utility/profiler.ts";

type EpsilonCategory = "soldermask" | "core";

interface EpsilonValue {
  category: EpsilonCategory;
  value: number;
}

export interface StackupGridConfig extends GridBuilderConfig {
  min_epsilon_resolution: number; // smallest possible difference in dielectric epsilon values before they are considered the same
  signal_amplitude: number; // voltage value to use for +/- signals
}

export class StackupGrid extends ManagedObject {
  layout: StackupLayout;
  voltage_indexes: {
    v_table: Record<Voltage, number>,
    v_set: Set<Voltage>,
  };
  epsilon_indexes: {
    ek_table: EpsilonValue[];
    soldermask_indices: Set<number>;
  };
  config: StackupGridConfig;
  grid_builder_regions: Region[] = [];
  grid_builder_padding: GridBuilderPadding = {};
  grid_builder: GridBuilder;
  profiler?: Profiler;

  constructor(
    module: WasmModule,
    layout: StackupLayout,
    get_epsilon: (param: EpsilonParameter) => number,
    profiler: Profiler | undefined,
    config: StackupGridConfig,
  ) {
    super(module);
    this.profiler = profiler;
    this.config = config;
    this.layout = layout;
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
    this.setup_push_epsilon(er_air, "soldermask");

    // create grid
    this.setup_create_grid_builder_dielectric_regions(get_epsilon);
    this.setup_create_grid_builder_voltage_regions();
    this.setup_create_grid_builder_padding();
    this.grid_builder = new GridBuilder(
      this.module,
      this.grid_builder_regions,
      this.config, this.grid_builder_padding,
      this.profiler,
    );
    this._child_objects.add(this.grid_builder);

    // fit voltage and epsilon_k table
    this.grid.v_table = Float32ModuleNdarray.from_shape(this.module, [3]);
    this.grid.ek_table = Float32ModuleNdarray.from_shape(this.module, [this.epsilon_indexes.ek_table.length]);
  }

  get grid(): Grid {
    return this.grid_builder.grid;
  }

  setup_create_grid_builder_dielectric_regions(get_epsilon: (param: EpsilonParameter) => number) {
    this.profiler?.begin("create_dielectric_regions");
    for (const layout of this.layout.layers) {
      switch (layout.type) {
        case "unmasked": break;
        case "soldermask": {
          const layer = layout.parent;
          const epsilon = get_epsilon(layer.epsilon);
          const epsilon_index = this.setup_push_epsilon(epsilon, "soldermask");
          const shapes: Shape[] = [];
          const mask = layout.mask;
          if (mask) {
            for (const trace of mask.traces) {
              shapes.push({
                type: "triangle",
                x_base: trace.x_left,
                x_tip: trace.x_left_taper,
                y_base: trace.y_base,
                y_tip: trace.y_taper,
              });
              shapes.push({
                type: "rectangle",
                x_left: trace.x_left_taper,
                x_right: trace.x_right_taper,
                y_top: Math.min(trace.y_base, trace.y_taper),
                y_bottom: Math.max(trace.y_base, trace.y_taper),
              });
              shapes.push({
                type: "triangle",
                x_base: trace.x_right,
                x_tip: trace.x_right_taper,
                y_base: trace.y_base,
                y_tip: trace.y_taper,
              });
            }
            const surface = mask.surface;
            shapes.push({
              type: "rectangle",
              y_top: surface.y_start,
              y_bottom: surface.y_start+surface.height,
            });
          }
          this.grid_builder_regions.push({
            type: "dielectric",
            epsilon_index,
            shapes,
          });
          break;
        }
        case "core": // @fallthrough
        case "prepreg": {
          const layer = layout.parent;
          const epsilon = get_epsilon(layer.epsilon);
          const epsilon_index = this.setup_push_epsilon(epsilon, "core");
          this.grid_builder_regions.push({
            type: "dielectric",
            epsilon_index,
            shapes: [
              {
                type: "rectangle",
                y_top: layout.bounding_box.y_start,
                y_bottom: layout.bounding_box.y_start+layout.bounding_box.height,
              },
            ],
          });
          break;
        }
      }
    }
    this.profiler?.end();
  }

  setup_create_grid_builder_voltage_regions() {
    this.profiler?.begin("create_voltage_regions");
    for (const layout of this.layout.conductors) {
      switch (layout.type) {
        case "plane": {
          const plane = layout.parent;
          const voltage_index = this.setup_push_voltage(plane.voltage);
          const shape = layout.shape;
          this.grid_builder_regions.push({
            type: "voltage",
            voltage_index,
            shapes: [
              {
                type: "rectangle",
                y_top: shape.y_start,
                y_bottom: shape.y_start+shape.height,
                min_y_gridlines: 2,
              }
            ],
          });
          break;
        }
        case "trace": {
          const trace = layout.parent;
          const voltage_index = this.setup_push_voltage(trace.voltage);
          const shape = layout.shape;
          this.grid_builder_regions.push({
            type: "voltage",
            voltage_index,
            shapes: [
              {
                type: "triangle",
                x_base: shape.x_left,
                x_tip: shape.x_left_taper,
                y_base: shape.y_base,
                y_tip: shape.y_taper,
              },
              {
                type: "rectangle",
                x_left: shape.x_left_taper,
                x_right: shape.x_right_taper,
                y_top: Math.min(shape.y_base, shape.y_taper),
                y_bottom: Math.max(shape.y_base, shape.y_taper),
              },
              {
                type: "triangle",
                x_base: shape.x_right,
                x_tip: shape.x_right_taper,
                y_base: shape.y_base,
                y_tip: shape.y_taper,
              },
            ],
          });
          break;
        }
      }
    }
    this.profiler?.end();
  }

  setup_create_grid_builder_padding() {
    this.profiler?.begin("create_grid_builder_padding");
    const padding = this.grid_builder_padding;
    // always pad x-axis
    padding.x_left = true;
    padding.x_right = true;

    // sort conductors by y position and check if ends are shielded by ground planes
    // if they are then avoid padding along y-axis past that direction
    const get_sort_value = (conductor: ConductorLayout): number => {
      switch (conductor.type) {
        case "plane": return conductor.shape.y_start;
        case "trace": return Math.min(conductor.shape.y_base, conductor.shape.y_taper);
      }
    };

    const sorted_conductors = this.layout.conductors.slice().sort((a, b) => {
      return get_sort_value(a) - get_sort_value(b);
    });

    if (sorted_conductors.at(0)?.type !== "plane") {
      padding.y_top = true;
    }

    if (sorted_conductors.at(sorted_conductors.length-1)?.type !== "plane") {
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
