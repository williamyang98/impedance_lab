import { sizes } from "./viewer.ts";
import {
  type LayerId,
  type SizeParameter, type TaperSizeParameter, type Parameter, type EpsilonParameter,
} from "./stackup.ts";

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

  for_each(func: (param: Parameter) => void) {
    for (const param of this.cache.values()) {
      func(param);
    }
  }
}

type RequiresParent = { parent: StackupParameters };
export class StackupParameters {
  id_to_index: Partial<Record<LayerId, number>> = {};
  required_trace_widths = new Set<SizeParameter>();
  required_trace_tapers = new Set<TaperSizeParameter>();
  minimum_feature_size: number = 0.001;

  get_index(id: LayerId): number {
    const index  = this.id_to_index[id];
    if (index === undefined) {
      throw Error(`Failed to get layer index of layer id ${id}`);
    }
    return index;
  }

  dW: ParameterCache<number, TaperSizeParameter & RequiresParent>;
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

  constructor() {
    this.dW = new ParameterCache((i: number) => {
      return {
        type: "taper",
        parent: this,
        get name() { return `dW${this.parent.get_index(i)}`; },
        description: "Trace taper",
        get taper_suffix() { return `${this.parent.get_index(i)}`; },
        min: 0,
        get max(): number | undefined {
          // maximum taper size is equal to minimum trace width
          let min_trace_width = Infinity;
          for (const param of this.parent.required_trace_widths) {
            if (param.value !== undefined) {
              min_trace_width = Math.min(min_trace_width, param.value);
            }
          }
          if (min_trace_width != Infinity) return min_trace_width;
          return undefined;
        },
        value: 0,
        placeholder_value: sizes.trace_taper,
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
        value: 0.035,
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
        value: 0.015,
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
        value: 0.15,
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
      value: 0.1,
      placeholder_value: sizes.copper_layer_height,
    };
    this.W = {
      parent: this,
      type: "size",
      name: "W",
      description: "Trace width",
      get min(): number {
        // minimum trace width is equal to maximum taper size
        let max_taper_size = 0;
        for (const param of this.parent.required_trace_tapers) {
          if (param.value !== undefined) {
            max_taper_size = Math.max(max_taper_size, param.value);
          }
        }
        const min_trace_width = this.parent.minimum_feature_size;
        return Math.max(min_trace_width, max_taper_size);
      },
      value: 0.25,
      placeholder_value: sizes.signal_trace_width,
      impedance_correlation: "negative",
    };
    this.CW = {
      parent: this,
      type: "size",
      name: "CW",
      description: "Coplanar ground width",
      get min(): number {
        // minimum trace width is equal to maximum taper size
        let max_taper_size = 0;
        for (const param of this.parent.required_trace_tapers) {
          if (param.value !== undefined) {
            max_taper_size = Math.max(max_taper_size, param.value);
          }
        }
        const min_trace_width = this.parent.minimum_feature_size;
        return Math.max(min_trace_width, max_taper_size);
      },
      value: 0.25,
      placeholder_value: sizes.ground_trace_width,
      impedance_correlation: "negative",
    };
    this.S = {
      parent: this,
      type: "size",
      name: "S",
      description: "Signal separation",
      get min(): number { return this.parent.minimum_feature_size; },
      value: 0.25,
      placeholder_value: sizes.signal_width_separation,
      impedance_correlation: "positive",
    };
    this.B = {
      parent: this,
      type: "size",
      name: "BS",
      description: "Broadside separation",
      min: 0,
      value: 0,
      placeholder_value: sizes.broadside_width_separation,
      impedance_correlation: "positive",
    };
    this.CS = {
      parent: this,
      type: "size",
      name: "CS",
      description: "Coplanar ground separation",
      get min(): number { return this.parent.minimum_feature_size; },
      value: 0.25,
      placeholder_value: sizes.ground_width_separation,
      impedance_correlation: "positive",
    };
  }

  for_each(func: (param: Parameter) => void) {
    this.dW.for_each(func);
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
}
