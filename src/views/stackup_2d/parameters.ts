import { UserData } from "../../providers/user_data/user_data.ts";
import { stackup_sizes as sizes } from "./stackup_to_visualiser.ts";
import {
  type LayerId,
  type Parameter, type SizeParameter, type EtchFactorParameter, type EpsilonParameter,
} from "./stackup.ts";
import { convert_distance, type DistanceUnit } from "../../utility/unit_types.ts";

export class ParameterCache<K extends string | number, V extends Parameter> {
  cache = new Map<K, V>();
  ctor: (key: K) => V;

  constructor(ctor: (key: K) => V) {
    this.ctor = ctor;
  }

  get(key: K): V {
    let value = this.cache.get(key);
    if (value !== undefined) {
      return value;
    }
    value = this.ctor(key);
    this.cache.set(key, value);
    return value;
  }

  for_each(func: (param: V) => void) {
    for (const param of this.cache.values()) {
      func(param);
    }
  }
}

type RequiresParent = { parent: StackupParameters };
export class StackupParameters {
  id_to_index: Partial<Record<LayerId, number>> = {};
  required_trace_widths = new Set<SizeParameter>();
  required_etch_factors = new Set<number>();
  minimum_feature_size: number = 1e-4;
  user_data: UserData;

  get_index(id: LayerId): number {
    const index  = this.id_to_index[id];
    if (index === undefined) {
      throw Error(`Failed to get layer index of layer id ${id}`);
    }
    return index;
  }

  etch_factor: ParameterCache<number, EtchFactorParameter & RequiresParent>;
  T: ParameterCache<number, SizeParameter & RequiresParent>;
  SH: ParameterCache<number, SizeParameter & RequiresParent>;
  H: ParameterCache<number, SizeParameter & RequiresParent>;
  ER: ParameterCache<number, EpsilonParameter & RequiresParent>;
  PH: SizeParameter;
  W: SizeParameter & RequiresParent;
  CW: SizeParameter & RequiresParent;
  S: SizeParameter & RequiresParent;
  B: SizeParameter & RequiresParent;
  CS: SizeParameter & RequiresParent;

  readonly size_unit_options: DistanceUnit[] = [
    "cm", "mm", "um", "inch", "mil", "thou",
  ];

  readonly copper_thickness_unit_options: DistanceUnit[] = [
    "cm", "mm", "um", "inch", "mil", "thou", "oz",
  ];

  constructor(user_data: UserData) {
    this.user_data = user_data;

    const create_default_distance = (value: number, unit: DistanceUnit, target_unit: DistanceUnit) => {
      const new_value = convert_distance(value, unit, target_unit);
      return { value: new_value, unit: target_unit };
    };

    const create_trace_width = (name: string, description: string) => {
      return {
        type: "size" as const,
        parent: this,
        name,
        description,
        get min(): number {
          // minimum trace width is equal to maximum taper size
          let max_taper_size = 0;
          for (const i of this.parent.required_etch_factors) {
            const etch_factor_param = this.parent.etch_factor.get(i);
            const trace_height_param = this.parent.T.get(i);
            if (trace_height_param.value === undefined) continue;
            if (etch_factor_param.value === undefined) continue;
            const trace_height = convert_distance(trace_height_param.value, trace_height_param.unit, this.unit);
            const etch_factor = etch_factor_param.value;
            const taper_size = 2*etch_factor*trace_height;
            max_taper_size = Math.max(max_taper_size, taper_size);
          }
          const min_trace_width = this.parent.minimum_feature_size;
          return Math.max(min_trace_width, max_taper_size);
        },
        ...create_default_distance(0.25, "mm", this.size_unit),
        placeholder_value: sizes.signal_trace_width,
        impedance_correlation: "negative" as const,
      }
    };

    this.etch_factor = new ParameterCache((i: number) => {
      return {
        type: "etch_factor",
        parent: this,
        get name() { return `EF${this.parent.get_index(i)}`; },
        description: "Trace taper",
        get taper_suffix() { return `${this.parent.get_index(i)}`; },
        min: 0,
        get max(): number | undefined {
          const trace_thickness_param = this.parent.T.get(i);
          if (trace_thickness_param.value === undefined) return undefined;
          const trace_thickness = convert_distance(trace_thickness_param.value, trace_thickness_param.unit, this.parent.size_unit);

          // maximum taper size is equal to minimum trace width
          let min_trace_width = Infinity;
          for (const param of this.parent.required_trace_widths) {
            if (param.value !== undefined) {
              const trace_width = convert_distance(param.value, param.unit, this.parent.size_unit);
              min_trace_width = Math.min(min_trace_width, trace_width);
            }
          }
          if (min_trace_width === Infinity) return undefined;
          const max_etch_factor = 0.5*min_trace_width/trace_thickness;
          return max_etch_factor;
        },
        ...create_default_distance(0, "mm", this.size_unit),
        placeholder_value: sizes.etch_factor,
        impedance_correlation: "positive",
      };
    });
    this.T = new ParameterCache((i: number) => {
      return {
        type: "size",
        parent: this,
        get name() { return `T${this.parent.get_index(i)}`; },
        description: "Trace thickness",
        get min(): number { return this.parent.minimum_feature_size; },
        ...create_default_distance(1, "oz", this.copper_thickness_unit),
        placeholder_value: sizes.trace_height,
        impedance_correlation: "negative",
      };
    });
    this.SH = new ParameterCache((i: number) => {
      return {
        type: "size",
        parent: this,
        get name() { return `H${this.parent.get_index(i)}` },
        description: "Soldermask thickness",
        get min(): number { return this.parent.minimum_feature_size; },
        ...create_default_distance(0.015, "mm", this.size_unit),
        placeholder_value: sizes.soldermask_height,
        impedance_correlation: "negative",
      };
    });
    this.H = new ParameterCache((i: number) => {
      return {
        type: "size",
        parent: this,
        get name() { return `H${this.parent.get_index(i)}`; },
        description: "Dielectric height",
        get min(): number { return this.parent.minimum_feature_size; },
        ...create_default_distance(0.15, "mm", this.size_unit),
        placeholder_value: sizes.core_height,
        impedance_correlation: "positive",
      };
    });
    this.ER = new ParameterCache((i: number) => {
      return {
        type: "epsilon",
        parent: this,
        get name() { return `ER${this.parent.get_index(i)}`; },
        description: "Dielectric constant",
        min: 1,
        value: 4.1,
        impedance_correlation: "negative",
      };
    });
    this.PH = {
      type: "size",
      ...create_default_distance(1, "oz", this.copper_thickness_unit),
      placeholder_value: sizes.copper_layer_height,
    };
    this.W = create_trace_width("W", "Trace width");
    this.CW = create_trace_width("CW", "Coplanar ground width");
    this.S = {
      parent: this,
      type: "size",
      name: "S",
      description: "Signal separation",
      get min(): number { return this.parent.minimum_feature_size; },
      ...create_default_distance(0.25, "mm", this.size_unit),
      placeholder_value: sizes.signal_width_separation,
      impedance_correlation: "positive",
    };
    this.B = {
      parent: this,
      type: "size",
      name: "BS",
      description: "Broadside separation",
      min: 0,
      ...create_default_distance(0, "mm", this.size_unit),
      placeholder_value: sizes.broadside_width_separation,
      impedance_correlation: "positive",
    };
    this.CS = {
      parent: this,
      type: "size",
      name: "CS",
      description: "Coplanar ground separation",
      get min(): number { return this.parent.minimum_feature_size; },
      ...create_default_distance(0.25, "mm", this.size_unit),
      placeholder_value: sizes.ground_width_separation,
      impedance_correlation: "positive",
    };
  }

  for_each(func: (param: Parameter) => void) {
    this.etch_factor.for_each(func);
    this.T.for_each(func);
    this.SH.for_each(func);
    this.H.for_each(func);
    this.ER.for_each(func);
    func(this.PH);
    func(this.W);
    func(this.CW);
    func(this.S);
    func(this.B);
    func(this.CS);
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

  get_simulation_parameter(param: Parameter): number {
    const valid_param = this.validate_parameter(param);
    switch (valid_param.type) {
      case "size": {
        // convert to common unit for entire simulation
        const value = convert_distance(valid_param.value, valid_param.unit, this.size_unit);
        return value;
      }
      case "etch_factor": return valid_param.value;
      case "epsilon": return valid_param.value;
    }
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
    this.SH.for_each(update_param);
    this.H.for_each(update_param);
    update_param(this.W);
    update_param(this.CW);
    update_param(this.S);
    update_param(this.B);
    update_param(this.CS);
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
    this.T.for_each(update_param);
    update_param(this.PH);
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
