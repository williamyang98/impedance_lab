import { type DistanceUnit, distance_units } from "../../utility/unit_types.ts";
import { type GridBuilderConfig as GridBuilderConfig2D } from "../../app/electrostatic_2d/grid_builder.ts";
import {
  type GridBuilderConfig as GridBuilderConfig3D,
  type AxisValue, axes as axes_3d,
} from "../../app/electrostatic_3d/grid_builder.ts";
import {
  type ComputeBenchmarkConfig,
  type MemoryBandwidthBenchmarkConfig,
} from "../../views/gpu_benchmark/config.ts";
import { type ParameterSearchConfig } from "../../views/parameter_search/search.ts";

function try_into_distance_unit(storage: Storage, key: string, default_value: DistanceUnit): DistanceUnit {
  const value = storage.getItem(key);
  if (value === null) return default_value;
  for (const unit of distance_units) {
    if (value === unit) return value;
  }
  return default_value;
}

class DistanceEntry {
  storage: Storage;
  key: string;
  _value: DistanceUnit;

  constructor(storage: Storage, key: string, default_value: DistanceUnit) {
    this.storage = storage;
    this.key = key;
    this._value = try_into_distance_unit(storage, key, default_value);
  }

  get value(): DistanceUnit {
    return this._value;
  }

  set value(value: DistanceUnit) {
    this._value = value;
    this.storage.setItem(this.key, value);
  }
}

function try_into_number(storage: Storage, key: string, default_value: number, type?: "float" | "integer"): number {
  type = type ?? "float";
  const value = storage.getItem(key);
  if (value === null) return default_value;
  let num = undefined;
  try {
    num = type === "float" ? Number.parseFloat(value) : Number.parseInt(value);
    return num;
  } catch (error) {
    console.error(`Failed to read key='${key}' value='${value}' as ${type}: ${String(error)}`);
  }
  return default_value;
}

class NumberEntry {
  storage: Storage;
  key: string;
  _value: number;
  type: "float" | "integer";

  constructor(storage: Storage, key: string, default_value: number, type: "float" | "integer") {
    this.storage = storage;
    this.key = key;
    this._value = try_into_number(storage, key, default_value, type);
    this.type = type;
  }

  get value(): number {
    return this._value;
  }

  set value(value: number) {
    if (this.type === "integer" && !Number.isInteger(value)) {
      console.warn(`Tried to set key='${this.key}' to non-integer value: ${value.toPrecision(3)}`);
      value = Math.round(value);
    }
    this._value = value;
    this.storage.setItem(this.key, value.toString());
  }
}

function try_into_boolean(storage: Storage, key: string, defualt_value: boolean): boolean {
  const value = storage.getItem(key);
  if (value === null) return defualt_value;
  return value === "true";
}

class BooleanEntry {
  storage: Storage;
  key: string;
  _value: boolean;

  constructor(storage: Storage, key: string, default_value: boolean) {
    this.storage = storage;
    this.key = key;
    this._value = try_into_boolean(storage, key, default_value);
  }

  get value(): boolean {
    return this._value;
  }

  set value(value: boolean) {
    this._value = value;
    this.storage.setItem(this.key, value ? "true" : "false");
  }
}

export class UserData {
  storage: Storage;
  _is_dark_mode: BooleanEntry;
  _size_unit: DistanceEntry;
  _copper_thickness_unit: DistanceEntry;
  grid_builder_config_2d: GridBuilderUserData2D;
  grid_builder_config_3d: GridBuilderUserData3D;
  compute_benchmark_config: UserComputeBenchmarkConfig;
  memory_bandwidth_benchmark_config: UserMemoryBandwidthBenchmarkConfig;
  parameter_search_config: UserParameterSearchConfig;

  constructor(storage: Storage) {
    this.storage = storage;
    this._is_dark_mode = new BooleanEntry(storage, "is_dark_mode", false);
    this._size_unit = new DistanceEntry(storage, "size_unit", "mm");
    this._copper_thickness_unit = new DistanceEntry(storage, "copper_thickness_unit", "oz");
    this.grid_builder_config_2d = new GridBuilderUserData2D(storage, "grid_builder_config_2d");
    this.grid_builder_config_3d = new GridBuilderUserData3D(storage, "grid_builder_config_3d");
    this.compute_benchmark_config = new UserComputeBenchmarkConfig(storage, "gpu.compute_benchmark");
    this.memory_bandwidth_benchmark_config = new UserMemoryBandwidthBenchmarkConfig(storage, "gpu.memory_bandwidth_benchmark");
    this.parameter_search_config = new UserParameterSearchConfig(storage, "parameter_search");
  }

  get is_dark_mode(): boolean { return this._is_dark_mode.value; }
  set is_dark_mode(value: boolean) { this._is_dark_mode.value = value; }
  get size_unit(): DistanceUnit { return this._size_unit.value; }
  set size_unit(value: DistanceUnit) { this._size_unit.value = value; }
  get copper_thickness_unit(): DistanceUnit { return this._copper_thickness_unit.value; }
  set copper_thickness_unit(value: DistanceUnit) { this._copper_thickness_unit.value = value; }

  readonly size_unit_options: DistanceUnit[] = [
    "cm", "mm", "um", "inch", "mil", "thou",
  ];

  readonly copper_thickness_unit_options: DistanceUnit[] = [
    "cm", "mm", "um", "inch", "mil", "thou", "oz",
  ];

}

export class GridBuilderUserData2D implements GridBuilderConfig2D {
  storage: Storage;
  _minimum_grid_resolution: NumberEntry;
  _padding_size_multiplier: NumberEntry;
  _max_x_ratio: NumberEntry;
  _min_x_subdivisions: NumberEntry;
  _max_y_ratio: NumberEntry;
  _min_y_subdivisions: NumberEntry;
  _min_epsilon_resolution: NumberEntry;
  _signal_amplitude: NumberEntry;

  constructor(storage: Storage, prefix: string) {
    this.storage = storage;
    const get_name = (name: string) => `${prefix}.${name}`;
    this._minimum_grid_resolution = new NumberEntry(storage, get_name("minimum_grid_resolution"), 0.0001, "float");
    this._padding_size_multiplier = new NumberEntry(storage, get_name("padding_size_multiplier"), 5, "float");
    this._max_x_ratio = new NumberEntry(storage, get_name("max_x_ratio"), 0.7, "float");
    this._min_x_subdivisions = new NumberEntry(storage, get_name("min_x_subdivisions"), 10, "integer");
    this._max_y_ratio = new NumberEntry(storage, get_name("max_y_ratio"), 0.7, "float");
    this._min_y_subdivisions = new NumberEntry(storage, get_name("min_y_subdivisions"), 10, "integer");
    this._min_epsilon_resolution = new NumberEntry(storage, get_name("min_epsilon_resolution"), 0.01, "float");
    this._signal_amplitude = new NumberEntry(storage, get_name("signal_amplitude"), 1, "float");
  }

  get minimum_grid_resolution() { return this._minimum_grid_resolution.value; }
  set minimum_grid_resolution(value: number) { this._minimum_grid_resolution.value = value; }
  get padding_size_multiplier() { return this._padding_size_multiplier.value; }
  set padding_size_multiplier(value: number) { this._padding_size_multiplier.value = value; }
  get max_x_ratio() { return this._max_x_ratio.value; }
  set max_x_ratio(value: number) { this._max_x_ratio.value = value; }
  get min_x_subdivisions() { return this._min_x_subdivisions.value; }
  set min_x_subdivisions(value: number) { this._min_x_subdivisions.value = value; }
  get max_y_ratio() { return this._max_y_ratio.value; }
  set max_y_ratio(value: number) { this._max_y_ratio.value = value; }
  get min_y_subdivisions() { return this._min_y_subdivisions.value; }
  set min_y_subdivisions(value: number) { this._min_y_subdivisions.value = value; }
  get min_epsilon_resolution() { return this._min_epsilon_resolution.value; }
  set min_epsilon_resolution(value: number) { this._min_epsilon_resolution.value = value; }
  get signal_amplitude() { return this._signal_amplitude.value; }
  set signal_amplitude(value: number) { this._signal_amplitude.value = value; }
}

export class GridBuilderUserData3D implements GridBuilderConfig3D {
  storage: Storage;
  _minimum_grid_resolution: NumberEntry;
  _padding_size_multiplier: NumberEntry;
  _mesh: AxisValue<{
    max_ratio: NumberEntry,
    min_subdivisions: NumberEntry,
  }>;
  mesh: AxisValue<{ max_ratio: number, min_subdivisions: number }>;

  constructor(storage: Storage, prefix: string) {
    this.storage = storage;
    const get_name = (name: string) => `${prefix}.${name}`;
    this._minimum_grid_resolution = new NumberEntry(storage, get_name("minimum_grid_resolution"), 0.0001, "float");
    this._padding_size_multiplier = new NumberEntry(storage, get_name("padding_size_multiplier"), 5, "float");

    const _mesh: Partial<typeof this._mesh> = {};
    for (const axis of axes_3d) {
      _mesh[axis] = {
        max_ratio: new NumberEntry(storage, get_name(`max_${axis}_ratio`), 0.7, "float"),
        min_subdivisions: new NumberEntry(storage, get_name(`min_${axis}_subdivisions`), 5, "integer"),
      };
    }
    this._mesh = _mesh as typeof this._mesh;

    const mesh: Partial<typeof this.mesh> = {};
    for (const axis of axes_3d) {
      const parent = this._mesh[axis];
      const config = {
        parent,
        get max_ratio() { return this.parent.max_ratio.value; },
        set max_ratio(value: number) { this.parent.max_ratio.value = value; },
        get min_subdivisions() { return this.parent.min_subdivisions.value; },
        set min_subdivisions(value: number) { this.parent.min_subdivisions.value = value; },
      };
      mesh[axis] = config;
    }
    this.mesh = mesh as typeof this.mesh;
  }

  get minimum_grid_resolution() { return this._minimum_grid_resolution.value; }
  set minimum_grid_resolution(value: number) { this._minimum_grid_resolution.value = value; }
  get padding_size_multiplier() { return this._padding_size_multiplier.value; }
  set padding_size_multiplier(value: number) { this._padding_size_multiplier.value = value; }

}

export class UserComputeBenchmarkConfig implements ComputeBenchmarkConfig {
  storage: Storage;
  _total_compute_units: NumberEntry;
  _total_warmup_steps: NumberEntry;
  _total_warm_steps: NumberEntry;
  _work_multiplier: NumberEntry;

  constructor(storage: Storage, prefix: string) {
    const get_name = (name: string) => `${prefix}.${name}`;
    this.storage = storage;
    this._total_compute_units = new NumberEntry(storage, get_name("total_compute_units"), 12, "integer");
    this._total_warmup_steps = new NumberEntry(storage, get_name("total_warmup_steps"), 4, "integer");
    this._total_warm_steps = new NumberEntry(storage, get_name("total_warm_steps"), 8, "integer");
    this._work_multiplier = new NumberEntry(storage, get_name("work_multiplier"), 1, "integer");
  }

  get total_compute_units(): number { return this._total_compute_units.value; };
  set total_compute_units(value: number) { this._total_compute_units.value = value; };
  get total_warmup_steps(): number { return this._total_warmup_steps.value; };
  set total_warmup_steps(value: number) { this._total_warmup_steps.value = value; };
  get total_warm_steps(): number { return this._total_warm_steps.value; };
  set total_warm_steps(value: number) { this._total_warm_steps.value = value; };
  get work_multiplier(): number { return this._work_multiplier.value; };
  set work_multiplier(value: number) { this._work_multiplier.value = value; };
}

export class UserMemoryBandwidthBenchmarkConfig implements MemoryBandwidthBenchmarkConfig {
  storage: Storage;
  _total_transfers: NumberEntry;

  constructor(storage: Storage, prefix: string) {
    this.storage = storage;
    const get_name = (name: string) => `${prefix}.${name}`;
    this._total_transfers = new NumberEntry(storage, get_name("total_transfers"), 30, "integer");
  }

  get total_transfers(): number { return this._total_transfers.value; }
  set total_transfers(value: number) { this._total_transfers.value = value; }
}

export class UserParameterSearchConfig implements ParameterSearchConfig {
  storage: Storage;
  _max_steps: NumberEntry;
  _impedance_tolerance: NumberEntry;
  _search_precision: NumberEntry;

  constructor(storage: Storage, prefix: string) {
    this.storage = storage;
    const get_name = (name: string) => `${prefix}.${name}`;
    this._max_steps = new NumberEntry(storage, get_name("max_steps"), 16, "integer");
    this._impedance_tolerance = new NumberEntry(storage, get_name("impedance_tolerance"), 0.1, "float");
    this._search_precision = new NumberEntry(storage, get_name("search_precision"), 0.001, "float");
  }

  get max_steps(): number { return this._max_steps.value; }
  set max_steps(value: number) { this._max_steps.value = value; }
  get impedance_tolerance(): number { return this._impedance_tolerance.value; }
  set impedance_tolerance(value: number) { this._impedance_tolerance.value = value; }
  get search_precision(): number { return this._search_precision.value; }
  set search_precision(value: number) { this._search_precision.value = value; }
}
