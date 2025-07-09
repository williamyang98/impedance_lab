import { type DistanceUnit, distance_units } from "../../views/stackup_2d/unit_types.ts";
import { type StackupGridConfig } from "../../views/stackup_2d/grid.ts";

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
};

function try_into_distance_unit(storage: Storage, key: string, default_value: DistanceUnit): DistanceUnit {
  const value = storage.getItem(key);
  if (value === null) return default_value;
  for (const unit of distance_units) {
    if (value === unit) return value;
  }
  return default_value;
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

export class Stackup2DMeshConfig implements StackupGridConfig {
  storage: Storage;

  _minimum_grid_resolution: number;
  _padding_size_multiplier: number;
  _max_x_ratio: number;
  _min_x_subdivisions: number;
  _max_y_ratio: number;
  _min_y_subdivisions: number;
  _min_epsilon_resolution: number;
  _signal_amplitude: number;

  _keys = keys.mesh_2d_config;

  constructor(storage: Storage) {
    this.storage = storage;
    this._minimum_grid_resolution = try_into_number(storage, this._keys.minimum_grid_resolution, 0.001, "float");
    this._padding_size_multiplier = try_into_number(storage, this._keys.padding_size_multiplier, 5, "float");
    this._max_x_ratio = try_into_number(storage, this._keys.max_x_ratio, 0.7, "float");
    this._min_x_subdivisions = try_into_number(storage, this._keys.min_x_subdivisions, 5, "integer");
    this._max_y_ratio = try_into_number(storage, this._keys.max_y_ratio, 0.7, "float");
    this._min_y_subdivisions = try_into_number(storage, this._keys.min_y_subdivisions, 5, "integer");
    this._min_epsilon_resolution = try_into_number(storage, this._keys.min_epsilon_resolution, 0.01, "float");
    this._signal_amplitude = try_into_number(storage, this._keys.signal_amplitude, 1, "float");
  }

  get minimum_grid_resolution() { return this._minimum_grid_resolution; }
  get padding_size_multiplier() { return this._padding_size_multiplier; }
  get max_x_ratio() { return this._max_x_ratio; }
  get min_x_subdivisions() { return this._min_x_subdivisions; }
  get max_y_ratio() { return this._max_y_ratio; }
  get min_y_subdivisions() { return this._min_y_subdivisions; }
  get min_epsilon_resolution() { return this._min_epsilon_resolution; }
  get signal_amplitude() { return this._signal_amplitude; }

  set minimum_grid_resolution(value: number) {
    this._minimum_grid_resolution = value;
    this.storage.setItem(this._keys.minimum_grid_resolution, value.toString());
  }
  set padding_size_multiplier(value: number) {
    this._padding_size_multiplier = value;
    this.storage.setItem(this._keys.padding_size_multiplier, value.toString());
  }
  set max_x_ratio(value: number) {
    this._max_x_ratio = value;
    this.storage.setItem(this._keys.max_x_ratio, value.toString());
  }
  set min_x_subdivisions(value: number) {
    this._min_x_subdivisions = value;
    this.storage.setItem(this._keys.min_x_subdivisions, value.toString());
  }
  set max_y_ratio(value: number) {
    this._max_y_ratio = value;
    this.storage.setItem(this._keys.max_y_ratio, value.toString());
  }
  set min_y_subdivisions(value: number) {
    this._min_y_subdivisions = value;
    this.storage.setItem(this._keys.min_y_subdivisions, value.toString());
  }
  set min_epsilon_resolution(value: number) {
    this._min_epsilon_resolution = value;
    this.storage.setItem(this._keys.min_epsilon_resolution, value.toString());
  }
  set signal_amplitude(value: number) {
    this._signal_amplitude = value;
    this.storage.setItem(this._keys.signal_amplitude, value.toString());
  }
}

export class UserData {
  storage: Storage;
  _is_dark_mode: boolean;
  _size_unit: DistanceUnit;
  _copper_thickness_unit: DistanceUnit;
  stackup_2d_mesh_config: Stackup2DMeshConfig;

  constructor(storage: Storage) {
    this.storage = storage;

    this._is_dark_mode = storage.getItem(keys.is_dark_mode) === "true";
    this._size_unit = try_into_distance_unit(storage, keys.size_unit, "mm");
    this._copper_thickness_unit = try_into_distance_unit(storage, keys.copper_thickness_unit, "oz");
    this.stackup_2d_mesh_config = new Stackup2DMeshConfig(storage);
  }

  get is_dark_mode(): boolean {
    return this._is_dark_mode;
  }

  set is_dark_mode(value: boolean) {
    this.storage.setItem(keys.is_dark_mode, value ? "true" : "false");
  }

  get size_unit(): DistanceUnit {
    return this._size_unit;
  }

  set size_unit(value: DistanceUnit) {
    this.storage.setItem(keys.size_unit, value);
  }

  get copper_thickness_unit(): DistanceUnit {
    return this._copper_thickness_unit;
  }

  set copper_thickness_unit(value: DistanceUnit) {
    this.storage.setItem(keys.copper_thickness_unit, value);
  }
}
