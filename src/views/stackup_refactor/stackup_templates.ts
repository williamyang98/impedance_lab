import {
  type Stackup,
  // type Parameter, type SizeParameter, type TaperSizeParameter,
  // type Orientation, type LayerId, type TraceId,
  // type CopperTrace, type CopperPlane, type Conductor,
  // type UnmaskedLayer, type SoldermaskLayer, type PrepregLayer, type CoreLayer, type Layer,
  // type HorizontalSpacing,
} from "./stackup.ts";
import { sizes } from "./viewer.ts";

const P = {
  dW: (i: number) => {
    return {
      name: `dW${i}`,
      description: "Trace taper",
      taper_suffix: `${i}`,
      min: 0,
      placeholder_value: sizes.trace_taper,
    };
  },
  PH: () => {
    return { value: 0.1, placeholder_value: sizes.copper_layer_height };
  },
  T: (i?: number) => {
    return {
      name: `T${i||''}`,
      description: "Trace thickness",
      min: 0,
      placeholder_value: sizes.trace_height,
    };
  },
  SH: (i?: number) => {
    return {
      name: `H${i||''}`,
      description: "Soldermask thickness",
      min: 0,
      placeholder_value: sizes.soldermask_height,
    };
  },
  H: (i?: number) => {
    return {
      name: `H${i||''}`,
      description: "Dielectric height",
      min: 0,
      placeholder_value: sizes.core_height,
    };
  },
  ER: (i?: number) => {
    return {
      name: `ER${i||''}`,
      description: "Dielectric constant",
      min: 1,
    };
  },
  W: () => {
    return {
      name: "W",
      description: "Trace width",
      min: 0,
      placeholder_value: sizes.signal_trace_width,
    };
  },
  CW: () => {
    return {
      name: "CW",
      description: "Coplanar ground width",
      min: 0,
      placeholder_value: sizes.ground_trace_width,
    };
  },
  S: () => {
    return {
      name: "S",
      description: "Signal separation",
      min: 0,
      placeholder_value: sizes.signal_width_separation,
    };
  },
  B: () => {
    return {
      name: "S",
      description: "Broadside separation",
      min: 0,
      placeholder_value: sizes.broadside_width_separation,
    };
  },
  CS: () => {
    return {
      name: "CS",
      description: "Coplanar ground separation",
      min: 0,
      placeholder_value: sizes.ground_width_separation,
    };
  },
};

export const stackup: Stackup = ((): Stackup => {
  const p = {
    T: P.T(), PH: P.PH(), dW: P.dW(1),
    H1: P.H(1), ER1: P.ER(1),
    H2: P.H(2), ER2: P.ER(2),
    W: P.W(), CW: P.CW(),
    S: P.S(), CS: P.CS(),
  };
  return {
    layers: [
      { id: 0, type: "unmasked", trace_height: p.T, trace_taper: p.dW, orientation: "down" },
      { id: 1, type: "core", epsilon: p.ER1, height: p.H1 },
      { id: 3, type: "core", epsilon: p.ER2, height: p.H2 },
      { id: 2, type: "unmasked", trace_height: p.T, trace_taper: p.dW, orientation: "up" },
    ],
    conductors: [
      { type: "trace", id: 1, layer_id: 0, orientation: "down", width: p.W, voltage: 1 },
      { type: "trace", id: 2, layer_id: 0, orientation: "down", width: p.W, voltage: -1 },
      { type: "trace", id: 0, layer_id: 0, orientation: "down", width: p.CW, voltage: 0 },
      { type: "trace", id: 3, layer_id: 0, orientation: "down", width: p.CW, voltage: 0 },
      { type: "plane", layer_id: 2, orientation: "up", voltage: 0, height: p.PH },
    ],
    spacings: [
      { left_trace: { id: 1, attach: "right" }, right_trace: { id: 2, attach: "left" }, width: p.S },
      { left_trace: { id: 0, attach: "right" }, right_trace: { id: 1, attach: "left" }, width: p.CS },
      { left_trace: { id: 2, attach: "right" }, right_trace: { id: 3, attach: "left" }, width: p.CS },
    ]
  }
}) ();
