import { type DistanceUnit, distance_units } from "../../views/stackup_2d/unit_types.ts";

export const keys = {
  is_dark_mode: "is_dark_mode",
  size_unit: "size_unit",
  copper_thickness_unit: "copper_thickness_unit",
};

function try_into_distance_unit(value: string | null, default_value: DistanceUnit): DistanceUnit {
  if (value === null) return default_value;
  for (const unit of distance_units) {
    if (value === unit) return value;
  }
  return default_value;
}

export class UserData {
  storage: Storage;
  _is_dark_mode: boolean;
  _size_unit: DistanceUnit;
  _copper_thickness_unit: DistanceUnit;

  constructor(storage: Storage) {
    this.storage = storage;

    this._is_dark_mode = storage.getItem(keys.is_dark_mode) === "true";
    this._size_unit = try_into_distance_unit(storage.getItem(keys.size_unit), "mm");
    this._copper_thickness_unit = try_into_distance_unit(storage.getItem(keys.copper_thickness_unit), "mm");
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
