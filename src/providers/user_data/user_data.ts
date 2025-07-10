import { type DistanceUnit, distance_units } from "../../views/stackup_2d/unit_types.ts";
import { type StackupGridConfig } from "../../views/stackup_2d/grid.ts";
import {
  type ComputeBenchmarkConfig,
  type MemoryBandwidthBenchmarkConfig,
} from "../../views/gpu_benchmark/config.ts";

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

export const keys = {
  is_dark_mode: "is_dark_mode",
  size_unit: "size_unit",
  copper_thickness_unit: "copper_thickness_unit",
  mesh_2d_config: {
    minimum_grid_resolution: "mesh_2d.minimum_grid_resolution",
    padding_size_multiplier: "mesh_2d.padding_size_multiplier",
    max_x_ratio: "mesh_2d.max_x_ratio",
    min_x_subdivisions: "mesh_2d.min_x_subdivisions",
    max_y_ratio: "mesh_2d.max_y_ratio",
    min_y_subdivisions: "mesh_2d.min_y_subdivisions",
    min_epsilon_resolution: "mesh_2d.min_epsilon_resolution",
    signal_amplitude: "mesh_2d.signal_amplitude",
  },
  compute_benchmark_config: {
    total_compute_units: "compute_benchmark.total_compute_units",
    total_warmup_steps: "compute_benchmark.total_warmup_steps",
    total_warm_steps: "compute_benchmark.total_warm_steps",
    work_multiplier: "compute_benchmark.work_multiplier",
    is_running: "compute_benchmark.is_running",
  },
  memory_bandwidth: {
    total_transfers: "memory_bandwidth_benchmark.total_transfers",
  },
};

export class UserData {
  storage: Storage;
  _is_dark_mode: BooleanEntry;
  _size_unit: DistanceEntry;
  _copper_thickness_unit: DistanceEntry;
  stackup_2d_mesh_config: Stackup2DMeshConfig;
  compute_benchmark_config: UserComputeBenchmarkConfig;
  memory_bandwidth_benchmark_config: UserMemoryBandwidthBenchmarkConfig;

  constructor(storage: Storage) {
    this.storage = storage;
    this._is_dark_mode = new BooleanEntry(storage, keys.is_dark_mode, false);
    this._size_unit = new DistanceEntry(storage, keys.size_unit, "mm");
    this._copper_thickness_unit = new DistanceEntry(storage, keys.copper_thickness_unit, "oz");
    this.stackup_2d_mesh_config = new Stackup2DMeshConfig(storage);
    this.compute_benchmark_config = new UserComputeBenchmarkConfig(storage);
    this.memory_bandwidth_benchmark_config = new UserMemoryBandwidthBenchmarkConfig(storage);
  }

  get is_dark_mode(): boolean { return this._is_dark_mode.value; }
  set is_dark_mode(value: boolean) { this._is_dark_mode.value = value; }
  get size_unit(): DistanceUnit { return this._size_unit.value; }
  set size_unit(value: DistanceUnit) { this._size_unit.value = value; }
  get copper_thickness_unit(): DistanceUnit { return this._copper_thickness_unit.value; }
  set copper_thickness_unit(value: DistanceUnit) { this._copper_thickness_unit.value = value; }
}

export class Stackup2DMeshConfig implements StackupGridConfig {
  storage: Storage;
  _minimum_grid_resolution: NumberEntry;
  _padding_size_multiplier: NumberEntry;
  _max_x_ratio: NumberEntry;
  _min_x_subdivisions: NumberEntry;
  _max_y_ratio: NumberEntry;
  _min_y_subdivisions: NumberEntry;
  _min_epsilon_resolution: NumberEntry;
  _signal_amplitude: NumberEntry;

  constructor(storage: Storage) {
    this.storage = storage;
    const K = keys.mesh_2d_config;
    this._minimum_grid_resolution = new NumberEntry(storage, K.minimum_grid_resolution, 0.001, "float");
    this._padding_size_multiplier = new NumberEntry(storage, K.padding_size_multiplier, 5, "float");
    this._max_x_ratio = new NumberEntry(storage, K.max_x_ratio, 0.7, "float");
    this._min_x_subdivisions = new NumberEntry(storage, K.min_x_subdivisions, 5, "integer");
    this._max_y_ratio = new NumberEntry(storage, K.max_y_ratio, 0.7, "float");
    this._min_y_subdivisions = new NumberEntry(storage, K.min_y_subdivisions, 5, "integer");
    this._min_epsilon_resolution = new NumberEntry(storage, K.min_epsilon_resolution, 0.01, "float");
    this._signal_amplitude = new NumberEntry(storage, K.signal_amplitude, 1, "float");
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

export class UserComputeBenchmarkConfig implements ComputeBenchmarkConfig {
  storage: Storage;
  _total_compute_units: NumberEntry;
  _total_warmup_steps: NumberEntry;
  _total_warm_steps: NumberEntry;
  _work_multiplier: NumberEntry;

  constructor(storage: Storage) {
    this.storage = storage;
    const K = keys.compute_benchmark_config;
    this._total_compute_units = new NumberEntry(storage, K.total_compute_units, 12, "integer");
    this._total_warmup_steps = new NumberEntry(storage, K.total_warmup_steps, 4, "integer");
    this._total_warm_steps = new NumberEntry(storage, K.total_warm_steps, 8, "integer");
    this._work_multiplier = new NumberEntry(storage, K.work_multiplier, 1, "integer");
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

  constructor(storage: Storage) {
    this.storage = storage;
    const K = keys.memory_bandwidth;
    this._total_transfers = new NumberEntry(storage, K.total_transfers, 30, "integer");
  }

  get total_transfers(): number { return this._total_transfers.value; }
  set total_transfers(value: number) { this._total_transfers.value = value; }
}
