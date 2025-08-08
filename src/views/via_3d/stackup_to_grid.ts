import { type DistanceUnit, convert_distance } from "../../utility/unit_types";
import {
  GridBuilder,
  type GridBuilderConfig, type GridBuilderPadding,
  type Region,
} from "../../app/electrostatic_3d/grid_builder.ts";
import {
  CpuGrid, GpuGrid,
} from "../../app/electrostatic_3d/grid.ts";
import {
  Stackup, type Parameter,
  type ReferencePlane,
} from "../via_2d/stackup.ts";
import { Profiler } from "../../utility/profiler.ts";
import type { Size3D } from "../../wgpu_kernels/electrostatic_3d/index.ts";

function validate_parameter(param: Parameter) {
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

// should all be in meters
export interface ViaBarrelInfo {
  height: number;
  outer_diameter: number;
  inner_diameter: number;
}

export class StackupGrid {
  gpu_device: GPUDevice;
  gpu_grid: GpuGrid;
  grid_builder_config: GridBuilderConfig;
  grid_builder_padding: GridBuilderPadding;
  grid_builder_regions: Region[] = [];
  via_barrel_parameters: ViaBarrelInfo;
  v_input: number = 1;

  // handle target_unit conversion and grid_builder scale normalisation in calculations
  grid_scale: number;
  grid_builder: GridBuilder;
  target_unit: DistanceUnit = "mm";
  readonly calculation_unit: DistanceUnit = "m";
  profiler?: Profiler;
  // cache parameter values to avoid recomputation of complex min/max bounds
  parameter_cache = new Map<Parameter, number>();

  constructor(gpu_device: GPUDevice, stackup: Stackup, grid_builder_config: GridBuilderConfig, profiler?: Profiler) {
    this.gpu_device = gpu_device;
    this.profiler = profiler;
    this.grid_builder_config = grid_builder_config;
    this.via_barrel_parameters = this.setup_create_regions(stackup);
    this.grid_builder_padding = {
      x: { min: true, max: true },
      y: { min: true, max: true },
      z: { min: true, max: true },
    };
    this.grid_builder = new GridBuilder(
      this.grid_builder_regions,
      this.grid_builder_config, this.grid_builder_padding,
      this.profiler,
    );
    this.grid_scale = this.grid_builder.grid_scale * convert_distance(1, this.calculation_unit, this.target_unit);
    this.gpu_grid = new GpuGrid(this.size, this.gpu_device);
    this.gpu_grid.from_cpu(this.cpu_grid);
  }

  get cpu_grid(): CpuGrid {
    return this.grid_builder.grid;
  }

  get size(): Size3D {
    return this.cpu_grid.size;
  }

  setup_get_parameter_value(param: Parameter): number {
    let value = this.parameter_cache.get(param);
    if (value !== undefined) return value;
    const valid_param = validate_parameter(param);
    switch (valid_param.type) {
      case "epsilon":
      case "etch_factor": {
        value = valid_param.value;
        break;
      }
      case "size": {
        value = convert_distance(valid_param.value, valid_param.unit, this.target_unit);
        break;
      }
    }
    this.parameter_cache.set(param, value);
    return value;
  }

  setup_create_regions(stackup: Stackup): ViaBarrelInfo {
    this.profiler?.begin("create_regions");
    const Dbarrel = this.setup_get_parameter_value(stackup.barrel.diameter);
    const regions = this.grid_builder_regions;

    const dielectric_bounds = {
      z_top: Infinity,
      z_bottom: -Infinity,
    };
    const create_dielectric_layer = (z_top: number, z_bottom: number, epsilon: number) => {
      dielectric_bounds.z_top = Math.min(dielectric_bounds.z_top, z_top);
      dielectric_bounds.z_bottom = Math.max(dielectric_bounds.z_bottom, z_bottom);
      regions.push({
        type: "dielectric",
        epsilon,
        shapes: [
          {
            type: "cuboid",
            start: { z: z_top },
            end: { z: z_bottom },
            config: {},
          },
        ],
      });
    }

    const via_voltage = this.v_input;
    const ground_voltage = 0;
    const create_plane_antipad = (z_top: number, z_bottom: number, Dantipad: number) => {
      // create plane
      regions.push({
        type: "voltage",
        voltage: ground_voltage,
        shapes: [
          {
            type: "cuboid",
            start: { z: z_top },
            end: { z: z_bottom },
            config: {},
          },
        ],
      });
      // create antipad inside plane
      regions.push({
        type: "voltage",
        voltage: null,
        ignore_boundary: {
          x: {
            min: true,
            max: true,
          },
          y: {
            min: true,
            max: true,
          },
        },
        shapes: [
          {
            type: "cylinder",
            center: {
              x: 0,
              y: 0,
              z: z_top,
            },
            radius: Dantipad/2,
            length: z_bottom-z_top,
            axis: "z",
            config: {},
          },
        ],
      });
    };
    const create_via_pad = (z_top: number, z_bottom: number, Dpad: number) => {
      regions.push({
        type: "voltage",
        voltage: via_voltage,
        shapes: [
          {
            type: "cylinder",
            center: {
              x: 0,
              y: 0,
              z: z_top,
            },
            radius: Dpad/2,
            length: z_bottom-z_top,
            axis: "z",
            config: {},
          },
        ],
      });
    };

    const copper_bounds = {
      z_top: Infinity,
      z_bottom: -Infinity,
    };
    const push_copper_bounds = (z_top: number, z_bottom: number) => {
      copper_bounds.z_top = Math.min(copper_bounds.z_top, z_top);
      copper_bounds.z_bottom = Math.max(copper_bounds.z_bottom, z_bottom);
    };

    const create_reference_plane = (plane: ReferencePlane, y_top: number, y_bottom: number) => {
      push_copper_bounds(y_top, y_bottom);
      // must create antipad before pad to avoid antipad drill removing pad
      if (plane.has_plane) {
        const Dantipad = this.setup_get_parameter_value(plane.Dantipad);
        create_plane_antipad(y_top, y_bottom, Dantipad);
      }
      if (plane.has_pad) {
        const Dpad = this.setup_get_parameter_value(plane.Dpad);
        create_via_pad(y_top, y_bottom, Dpad);
      }
    };

    // create layer dielectric, reference plane and via pads
    let z_offset = 0;
    for (let i = 0; i < stackup.layers.length; i++) {
      const layer = stackup.layers[i];
      switch (layer.type) {
        case "surface": {
          // soldermask
          let mask_height = undefined;
          if (layer.has_soldermask) {
            mask_height = 0;
            mask_height += this.setup_get_parameter_value(layer.soldermask_height);
            if (layer.plane.has_copper) {
              mask_height += this.setup_get_parameter_value(layer.copper_thickness);
            }
            const epsilon = this.setup_get_parameter_value(layer.soldermask_epsilon)
            const z_top = z_offset;
            const z_bottom = z_top+mask_height;
            create_dielectric_layer(z_top, z_bottom, epsilon);
          }
          let trace_height = undefined;
          if (layer.plane.has_copper) {
            trace_height = this.setup_get_parameter_value(layer.copper_thickness);
            let z_top = z_offset;
            if (layer.orientation === "bottom" && layer.has_soldermask) {
              z_top += this.setup_get_parameter_value(layer.soldermask_height);
            }
            const z_bottom = z_top+trace_height;
            create_reference_plane(layer.plane, z_top, z_bottom);
          }
          z_offset += mask_height ?? trace_height ?? 0;
          break;
        }
        case "inner": {
          // dielectric
          let height = 0;
          height += this.setup_get_parameter_value(layer.height);
          if (layer.planes.top.has_copper) {
            height += this.setup_get_parameter_value(layer.planes.copper_thickness);
          }
          if (layer.planes.bottom.has_copper) {
            height += this.setup_get_parameter_value(layer.planes.copper_thickness);
          }
          const epsilon = this.setup_get_parameter_value(layer.epsilon)
          const z_top = z_offset;
          const z_bottom = z_top+height;
          z_offset += height;
          create_dielectric_layer(z_top, z_bottom, epsilon);
          push_copper_bounds(z_top, z_bottom);
          // top plane
          if (layer.planes.top.has_copper) {
            const copper_height = this.setup_get_parameter_value(layer.planes.copper_thickness);
            const z_plane_top = z_top;
            const z_plane_bottom = z_plane_top+copper_height;
            create_reference_plane(layer.planes.top, z_plane_top, z_plane_bottom);
          }
          if (layer.planes.bottom.has_copper) {
            const copper_height = this.setup_get_parameter_value(layer.planes.copper_thickness);
            const z_plane_top = z_bottom-copper_height;
            const z_plane_bottom = z_plane_top+copper_height;
            create_reference_plane(layer.planes.bottom, z_plane_top, z_plane_bottom);
          }
          break;
        }
      }
    }

    // barrel height
    const z_barrel_top = copper_bounds.z_top;
    const z_barrel_bottom = copper_bounds.z_bottom;
    if (!Number.isFinite(z_barrel_top) || !Number.isFinite(z_barrel_bottom)) {
      throw Error("Stackup does not have any vertical dimension. Did you forget to add layers?");
    }
    const barrel_height = z_barrel_bottom-z_barrel_top;

    // barrel dielectric
    {
      const epsilon = this.setup_get_parameter_value(stackup.barrel.epsilon);
      regions.push({
        type: "dielectric",
        epsilon,
        shapes: [
          {
            type: "cylinder",
            center: {
              x: 0,
              y: 0,
              z: z_barrel_top,
            },
            axis: "z",
            radius: Dbarrel/2,
            length: z_barrel_bottom-z_barrel_top,
            config: {},
          },
        ],
      });
    }

    // barrel conductor
    const barrel_thickness = this.setup_get_parameter_value(stackup.barrel.copper_thickness);
    const Dbarrel_inner = Math.max(Dbarrel-2*barrel_thickness, 0);
    {
      // fill entire barrel
      regions.push({
        type: "voltage",
        voltage: via_voltage,
        shapes: [
          {
            type: "cylinder",
            center: {
              x: 0,
              y: 0,
              z: z_barrel_top,
            },
            length: z_barrel_bottom-z_barrel_top,
            radius: Dbarrel/2,
            axis: "z",
            config: {},
          },
        ],
      });
      // drill hole through barrel
      regions.push({
        type: "voltage",
        voltage: null,
        ignore_boundary: {
          x: {
            min: true,
            max: true,
          },
          y: {
            min: true,
            max: true,
          },
        },
        shapes: [
          {
            type: "cylinder",
            center: {
              x: 0,
              y: 0,
              z: z_barrel_top,
            },
            length: z_barrel_bottom-z_barrel_top,
            radius: Dbarrel_inner/2,
            axis: "z",
            config: {},
          },
        ],
      });
    }

    this.profiler?.end();
    return {
      height: convert_distance(barrel_height, this.target_unit, this.calculation_unit),
      inner_diameter: convert_distance(Dbarrel_inner, this.target_unit, this.calculation_unit),
      outer_diameter: convert_distance(Dbarrel, this.target_unit, this.calculation_unit),
    };
  }
}
