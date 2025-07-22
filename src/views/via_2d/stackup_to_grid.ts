import { type DistanceUnit, convert_distance } from "../../utility/unit_types";
import {
  GridBuilder,
  type GridBuilderConfig, type GridBuilderPadding,
  type Region, type Shape,
} from "../../app/electrostatic_2d/grid_builder.ts";
import {
  type Stackup, type Parameter,
  type ReferencePlane, Rules,
} from "./stackup.ts";
import { Profiler } from "../../utility/profiler.ts";
import { type WasmModule, ManagedObject } from "../../wasm";

function create_symmetrical_cylinder(
  y_top: number, y_bottom: number,
  r_inner: number | undefined, r_outer: number | undefined,
): Shape[] {
  const shapes: Shape[] = [];
  shapes.push({
    type: "rectangle",
    y_top,
    y_bottom,
    x_left: r_inner,
    x_right: r_outer,
  });
  shapes.push({
    type: "rectangle",
    y_top,
    y_bottom,
    x_left: r_outer !== undefined ? -r_outer : undefined,
    x_right: r_inner !== undefined ? -r_inner : undefined,
  });
  return shapes;
}

function validate_parameter(param: Parameter) {
  if (param.value === undefined) {
    param.error = "Field is required";
    throw Error(`Missing field value for ${param.name}`);
  }
  if (typeof(param.value) !== 'number') {
    param.error = "Field is required";
    throw Error(`Non number field value for ${param.name}`);
  }
  if (Number.isNaN(param.value)) {
    param.error = "Field is required";
    throw Error(`NaN field value for ${param.name}`);
  }
  if (param.min !== undefined && param.value < param.min) {
    param.error = `Value must be greater than ${param.min}`;
    throw Error(`Violated minimum value for ${param.name}`);
  }
  if (param.max !== undefined && param.value > param.max) {
    param.error = `Value must be less than ${param.max}`;
    throw Error(`Violated maximum value for ${param.name}`);
  }
  param.error = undefined;
  // type convert if parameter is valid
  return param as Parameter & { value: number };
}

// should all be in meters
export interface ViaBarrelInfo {
  height: number;
  outer_diameter: number;
  inner_diameter: number;
}

export class StackupGrid extends ManagedObject {
  grid_builder_config: GridBuilderConfig;
  grid_builder_padding: GridBuilderPadding;
  grid_builder_regions: Region[] = [];
  via_barrel_parameters: {
    height: number;
    outer_diameter: number;
    inner_diameter: number;
  };
  // handle target_unit conversion and grid_builder scale normalisation in calculations
  energy_integral_scale: number;
  epsilon_table: number[] = [1];
  voltage_table: number[] = [0, 1];
  grid_builder: GridBuilder;
  target_unit: DistanceUnit = "mm";
  readonly calculation_unit: DistanceUnit = "m";
  profiler?: Profiler;

  constructor(module: WasmModule, stackup: Stackup, profiler?: Profiler) {
    super(module);
    this.profiler = profiler;
    this.via_barrel_parameters = this.setup_create_regions(stackup);
    this.grid_builder_config = {
      minimum_grid_resolution: 1e-5,
      padding_size_multiplier: 10,
      max_x_ratio: 0.7,
      min_x_subdivisions: 10,
      max_y_ratio: 0.7,
      min_y_subdivisions: 10,
    };
    this.grid_builder_padding = {
      x_left: true,
      x_right: true,
      y_top: true,
      y_bottom: true,
    };
    this.grid_builder = new GridBuilder(
      this.module,
      this.grid_builder_regions,
      this.grid_builder_config, this.grid_builder_padding,
      this.profiler,
    );
    this.energy_integral_scale = this.grid_builder.grid_scale * convert_distance(1, this.calculation_unit, this.target_unit);
    this._child_objects.add(this.grid_builder);
    this.configure_dielectric();
    this.configure_voltage();
  }

  get grid() {
    return this.grid_builder.grid;
  }

  setup_push_epsilon(er: number, threshold?: number): number {
    threshold = threshold ?? 1e-3;
    for (let i = 0; i < this.epsilon_table.length; i++) {
      const old_er = this.epsilon_table[i];
      const delta = Math.abs(er-old_er);
      if (delta < threshold) {
        return i;
      }
    }
    const index = this.epsilon_table.length;
    this.epsilon_table.push(er);
    return index;
  }

  setup_get_parameter_value(param: Parameter): number {
    const valid_param = validate_parameter(param);
    switch (valid_param.type) {
      case "size": return convert_distance(valid_param.value, valid_param.unit, this.target_unit);
      case "epsilon": return valid_param.value;
      case "etch_factor": return valid_param.value;
    }
  }

  setup_create_regions(stackup: Stackup): ViaBarrelInfo {
    this.profiler?.begin("create_regions");
    const Dbarrel = this.setup_get_parameter_value(stackup.barrel.diameter);
    const regions = this.grid_builder_regions;

    const dielectric_bounds = {
      y_top: Infinity,
      y_bottom: -Infinity,
    };
    const create_dielectric_layer = (y_top: number, y_bottom: number, epsilon: number) => {
      dielectric_bounds.y_top = Math.min(dielectric_bounds.y_top, y_top);
      dielectric_bounds.y_bottom = Math.max(dielectric_bounds.y_bottom, y_bottom);
      const epsilon_index = this.setup_push_epsilon(epsilon);
      regions.push({
        type: "dielectric",
        dielectric_index: epsilon_index,
        shapes: create_symmetrical_cylinder(y_top, y_bottom, Dbarrel/2, undefined),
      });
    }

    const via_voltage_index = 1;
    const ground_voltage_plane_index = 0;
    const create_via_pad = (y_top: number, y_bottom: number, Dpad: number) => {
      regions.push({
        type: "voltage",
        voltage_index: via_voltage_index,
        shapes: create_symmetrical_cylinder(y_top, y_bottom, Dbarrel/2, Dpad/2),
      });
    };
    const create_plane_antipad = (y_top: number, y_bottom: number, Dantipad: number) => {
      regions.push({
        type: "voltage",
        voltage_index: ground_voltage_plane_index,
        shapes: create_symmetrical_cylinder(y_top, y_bottom, Dantipad/2, undefined),
      });
    };

    const copper_bounds = {
      y_top: Infinity,
      y_bottom: -Infinity,
    };
    const create_reference_plane = (plane: ReferencePlane, y_top: number, y_bottom: number) => {
      copper_bounds.y_top = Math.min(copper_bounds.y_top, y_top);
      copper_bounds.y_bottom = Math.max(copper_bounds.y_bottom, y_bottom);
      if (plane.Dpad) {
        const Dpad = this.setup_get_parameter_value(plane.Dpad);
        create_via_pad(y_top, y_bottom, Dpad);
      }
      // reference plane antipad
      if (plane.Dantipad) {
        const Dantipad = this.setup_get_parameter_value(plane.Dantipad);
        create_plane_antipad(y_top, y_bottom, Dantipad);
      }
    };

    // create layer dielectric, reference plane and via pads
    let y_offset = 0;
    for (let i = 0; i < stackup.layers.length; i++) {
      const layer = stackup.layers[i];
      switch (layer.type) {
        case "surface": {
          // soldermask
          let mask_height = undefined;
          if (layer.soldermask) {
            mask_height = 0;
            mask_height += this.setup_get_parameter_value(layer.soldermask.height);
            if (Rules.plane_has_copper(layer.plane)) {
              mask_height += this.setup_get_parameter_value(layer.plane.copper_thickness);
            }
            const epsilon = this.setup_get_parameter_value(layer.soldermask.epsilon)
            const y_top = y_offset;
            const y_bottom = y_top+mask_height;
            create_dielectric_layer(y_top, y_bottom, epsilon);
          }
          let trace_height = undefined;
          if (Rules.plane_has_copper(layer.plane)) {
            trace_height = this.setup_get_parameter_value(layer.plane.copper_thickness);
            let y_top = y_offset;
            const is_bottom = (i == 0); // soldermask orientation
            if (is_bottom && layer.soldermask) {
              y_top += this.setup_get_parameter_value(layer.soldermask.height);
            }
            const y_bottom = y_top+trace_height;
            create_reference_plane(layer.plane, y_top, y_bottom);
          }
          y_offset += mask_height ?? trace_height ?? 0;
          break;
        }
        case "inner": {
          // dielectric
          let height = 0;
          height += this.setup_get_parameter_value(layer.height);
          if (Rules.plane_has_copper(layer.planes.top)) {
            height += this.setup_get_parameter_value(layer.planes.copper_thickness);
          }
          if (Rules.plane_has_copper(layer.planes.bottom)) {
            height += this.setup_get_parameter_value(layer.planes.copper_thickness);
          }
          const epsilon = this.setup_get_parameter_value(layer.epsilon)
          const y_top = y_offset;
          const y_bottom = y_top+height;
          y_offset += height;
          create_dielectric_layer(y_top, y_bottom, epsilon);
          // top plane
          if (Rules.plane_has_copper(layer.planes.top)) {
            const copper_height = this.setup_get_parameter_value(layer.planes.copper_thickness);
            const y_plane_top = y_top;
            const y_plane_bottom = y_plane_top+copper_height;
            create_reference_plane(layer.planes.top, y_plane_top, y_plane_bottom);
          }
          if (Rules.plane_has_copper(layer.planes.bottom)) {
            const copper_height = this.setup_get_parameter_value(layer.planes.copper_thickness);
            const y_plane_top = y_bottom-copper_height;
            const y_plane_bottom = y_plane_top+copper_height;
            create_reference_plane(layer.planes.bottom, y_plane_top, y_plane_bottom);
          }
          break;
        }
      }
    }

    // barrel height
    const y_barrel_top = Math.min(dielectric_bounds.y_top, copper_bounds.y_top);
    const y_barrel_bottom = Math.max(dielectric_bounds.y_bottom, copper_bounds.y_bottom);
    if (!Number.isFinite(y_barrel_top) || !Number.isFinite(y_barrel_bottom)) {
      throw Error("Stackup does not have any vertical dimension. Did you forget to add layers?");
    }
    const barrel_height = y_barrel_bottom-y_barrel_top;

    // barrel dielectric
    {
      const epsilon = this.setup_get_parameter_value(stackup.barrel.epsilon);
      const epsilon_index = this.setup_push_epsilon(epsilon);
      regions.push({
        type: "dielectric",
        dielectric_index: epsilon_index,
        shapes: [
          {
            type: "rectangle",
            y_top: y_barrel_top,
            y_bottom: y_barrel_bottom,
            x_left: -Dbarrel/2,
            x_right: Dbarrel/2,
          },
        ],
      });
    }

    // barrel conductor
    const barrel_thickness = this.setup_get_parameter_value(stackup.barrel.copper_thickness);
    const Dbarrel_inner = Math.max(Dbarrel-2*barrel_thickness, 0);
    regions.push({
      type: "voltage",
      voltage_index: via_voltage_index,
      shapes: create_symmetrical_cylinder(y_barrel_top, y_barrel_bottom, Dbarrel_inner/2, Dbarrel/2),
    });

    this.profiler?.end();
    return {
      height: convert_distance(barrel_height, this.target_unit, this.calculation_unit),
      inner_diameter: convert_distance(Dbarrel_inner, this.target_unit, this.calculation_unit),
      outer_diameter: convert_distance(Dbarrel, this.target_unit, this.calculation_unit),
    };
  }

  configure_dielectric() {
    const ek_table = this.grid.ek_table.array_view;
    ek_table.set(this.epsilon_table);
  }

  configure_voltage() {
    const v_table = this.grid.v_table.array_view;
    v_table.set(this.voltage_table);
  }
}
