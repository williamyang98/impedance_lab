import type { UserData } from "../../providers/user_data/user_data";
import { convert_distance, type DistanceUnit } from "../../utility/unit_types.ts";
import { type EpsilonParameter, type LayerId, type Parameter, type Position, type SizeParameter } from "./stackup.ts";

export class ParameterCache<K, V extends Parameter> {
  cache = new Map<string | number, V>();
  get_key: (key: K) => string | number;
  ctor: (key: K) => V;

  constructor(get_key: typeof this.get_key, ctor: typeof this.ctor) {
    this.get_key = get_key;
    this.ctor = ctor;
  }

  get(key: K): V {
    const i = this.get_key(key);
    let value = this.cache.get(i);
    if (value !== undefined) {
      return value;
    }
    value = this.ctor(key);
    this.cache.set(i, value);
    return value;
  }

  delete(key: K): boolean {
    const i = this.get_key(key);
    return this.cache.delete(i);
  }

  for_each(func: (param: V) => void) {
    for (const param of this.cache.values()) {
      func(param);
    }
  }
}

export function get_position_key(position: Position): string {
  return `${position.layer_id}_${position.orientation}`;
}

function create_default_distance(value: number, unit: DistanceUnit, target_unit: DistanceUnit) {
  const new_value = convert_distance(value, unit, target_unit);
  return { value: new_value, unit: target_unit };
};

type RequiresParent = { parent: StackupParameters };
export class StackupParameters {
  id_to_index = new Map<LayerId, number>();
  minimum_feature_size: number = 1e-4;
  user_data: UserData;

  soldermask_height: ParameterCache<LayerId, SizeParameter & RequiresParent>;
  dielectric_height: ParameterCache<LayerId, SizeParameter & RequiresParent>;
  dielectric_copper_height: ParameterCache<LayerId, SizeParameter & RequiresParent>;
  dielectric_epsilon: ParameterCache<LayerId, EpsilonParameter & RequiresParent>;
  via_pad_diameter: ParameterCache<Position, SizeParameter & RequiresParent>;
  plane_antipad_diameter: ParameterCache<Position, SizeParameter & RequiresParent>;
  barrel_diameter: SizeParameter & RequiresParent;
  barrel_thickness: SizeParameter & RequiresParent;
  barrel_epsilon: EpsilonParameter & RequiresParent;

  constructor(user_data: UserData) {
    this.user_data = user_data;
    this.soldermask_height = new ParameterCache(
      (key: LayerId) => key,
      (i: LayerId) => {
        return {
          type: "size" as const,
          parent: this,
          get name() { return `H${this.parent.get_index(i)}`; },
          description: "Soldermask height",
          get min() { return this.parent.minimum_feature_size; },
          ...create_default_distance(0.015, "mm", this.size_unit),
          impedance_correlation: "negative",
        }
      },
    );
    this.dielectric_height = new ParameterCache(
      (key: LayerId) => key,
      (i: LayerId) => {
        return {
          type: "size" as const,
          parent: this,
          get name() { return `H${this.parent.get_index(i)}`; },
          description: "Dielectric height",
          get min() { return this.parent.minimum_feature_size; },
          ...create_default_distance(0.15, "mm", this.size_unit),
          impedance_correlation: "positive",
        }
      },
    );
    this.dielectric_copper_height = new ParameterCache(
      (key: LayerId) => key,
      (i: LayerId) => {
        return {
          type: "size" as const,
          parent: this,
          get name() { return `T${this.parent.get_index(i)}`; },
          description: "Plane thickness",
          get min() { return this.parent.minimum_feature_size; },
          ...create_default_distance(1, "oz", this.copper_thickness_unit),
          impedance_correlation: "negative",
        }
      },
    );
    this.dielectric_epsilon = new ParameterCache(
      (key: LayerId) => key,
      (i: LayerId) => {
        return {
          type: "epsilon" as const,
          parent: this,
          get name() { return `ER${this.parent.get_index(i)}`; },
          description: "Dielectric constant",
          min: 1,
          value: 4.1,
          impedance_correlation: "negative",
        }
      },
    );
    this.via_pad_diameter = new ParameterCache(
      (key: Position) => get_position_key(key),
      (position: Position) => {
        return {
          type: "size" as const,
          parent: this,
          get name() { return `D${this.parent.get_index(position.layer_id)}_pad`; },
          description: "Via diameter",
          min: 0,
          get max(): number | undefined {
            const Dantipad_param = this.parent.plane_antipad_diameter.get(position);
            if (Dantipad_param.value === undefined) return undefined;
            const Dantipad = convert_distance(Dantipad_param.value, Dantipad_param.unit, this.unit);
            return Dantipad;
          },
          ...create_default_distance(0.25, "mm", this.size_unit),
          impedance_correlation: "negative",
        };
      },
    );
    this.plane_antipad_diameter = new ParameterCache(
      (key: Position) => get_position_key(key),
      (position: Position) => {
        return {
          type: "size" as const,
          parent: this,
          get name() { return `D${this.parent.get_index(position.layer_id)}_antipad`; },
          description: "Antipad diameter",
          get min(): number {
            const Dpad_param = this.parent.via_pad_diameter.get(position);
            if (Dpad_param.value === undefined) return 0;
            const Dpad = convert_distance(Dpad_param.value, Dpad_param.unit, this.unit);
            return Dpad;
          },
          ...create_default_distance(0.35, "mm", this.size_unit),
          impedance_correlation: "positive",
        };
      },
    );
    this.barrel_diameter = {
      type: "size" as const,
      parent: this,
      name: "Dbarrel",
      description: "Via barrel diameter",
      min: 0,
      get max(): number | undefined {
        let min_diameter = Infinity;
        this.parent.via_pad_diameter.for_each(param => {
          if (param.value === undefined) return;
          const value = convert_distance(param.value, param.unit, this.unit);
          min_diameter = Math.min(min_diameter, value);
        });
        this.parent.plane_antipad_diameter.for_each(param => {
          if (param.value === undefined) return;
          const value = convert_distance(param.value, param.unit, this.unit);
          min_diameter = Math.min(min_diameter, value);
        });
        if (!Number.isFinite(min_diameter)) return undefined;
        return min_diameter;
      },
      ...create_default_distance(0.15, "mm", this.size_unit),
      impedance_correlation: "negative",
    };
    this.barrel_thickness = {
      type: "size" as const,
      parent: this,
      name: "Tbarrel",
      description: "Via barrel copper thickness",
      min: 0,
      get max(): number | undefined {
        const Dbarrel_param = this.parent.barrel_diameter;
        if (Dbarrel_param.value === undefined) return undefined;
        const value = convert_distance(Dbarrel_param.value, Dbarrel_param.unit, this.unit);
        return value/2;
      },
      ...create_default_distance(0.25, "oz", this.copper_thickness_unit),
      impedance_correlation: "negative",
    };
    this.barrel_epsilon = {
      type: "epsilon" as const,
      parent: this,
      name: "ER_barrel",
      description: "Barrel filling dielectric constant",
      min: 0,
      value: 3.3,
      impedance_correlation: "negative",
    };
  }

  get_index(id: LayerId): number {
    const index = this.id_to_index.get(id);
    if (index === undefined) {
      throw Error(`Failed to get layer index of layer id ${id}`);
    }
    return index;
  }

  get size_unit(): DistanceUnit {
    return this.user_data.size_unit;
  }

  set size_unit(new_unit: DistanceUnit) {
    this.user_data.size_unit = new_unit;
    const update_param = (param: SizeParameter) => {
      const old_unit = param.unit;
      param.unit = new_unit;
      if (param.value !== undefined) {
        const new_value = convert_distance(param.value, old_unit, new_unit);
        param.value = new_value;
      }
    };
    this.soldermask_height.for_each(update_param);
    this.dielectric_height.for_each(update_param);
    this.via_pad_diameter.for_each(update_param);
    this.plane_antipad_diameter.for_each(update_param);
    update_param(this.barrel_diameter);
  }

  get copper_thickness_unit(): DistanceUnit {
    return this.user_data.copper_thickness_unit;
  }

  set copper_thickness_unit(new_unit: DistanceUnit) {
    this.user_data.copper_thickness_unit = new_unit;
    const update_param = (param: SizeParameter) => {
      const old_unit = param.unit;
      param.unit = new_unit;
      if (param.value !== undefined) {
        const new_value = convert_distance(param.value, old_unit, new_unit);
        param.value = new_value;
      }
    };
    this.dielectric_copper_height.for_each(update_param);
    update_param(this.barrel_thickness);
  }

  get size_unit_options() {
    return this.user_data.size_unit_options;
  }

  get copper_thickness_unit_options() {
    return this.user_data.copper_thickness_unit_options;
  }

  delete_layer_id(layer_id: LayerId) {
    this.soldermask_height.delete(layer_id);
    this.dielectric_height.delete(layer_id);
    this.dielectric_copper_height.delete(layer_id);
    this.dielectric_epsilon.delete(layer_id);
    this.via_pad_diameter.delete({ layer_id, orientation: "top" });
    this.via_pad_diameter.delete({ layer_id, orientation: "bottom" });
    this.plane_antipad_diameter.delete({ layer_id, orientation: "top" });
    this.plane_antipad_diameter.delete({ layer_id, orientation: "bottom" });
    this.id_to_index.delete(layer_id);
  }

  for_each(func: (param: Parameter) => void) {
    this.soldermask_height.for_each(func);
    this.dielectric_height.for_each(func);
    this.dielectric_copper_height.for_each(func);
    this.via_pad_diameter.for_each(func);
    this.plane_antipad_diameter.for_each(func);
    func(this.barrel_diameter);
    func(this.barrel_thickness);
    func(this.barrel_epsilon);
  }

  validate_parameter(param: Parameter): Parameter & { value: number } {
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

  mark_parameter_unchanged(param: Parameter) {
    param.old_value = param.value;
    param.error = undefined;
    if (param.type === "size") {
      param.old_unit = param.unit;
    }
  }

  mark_parameter_changed(param: Parameter) {
    param.old_value = undefined;
    param.error = undefined;
    if (param.type === "size") {
      param.old_unit = undefined;
    }
  }
}
