import {
  type HorizontalSpacing,
  type Voltage,
  type TracePosition,
  type Layer,
  type CopperTrace,
  type CopperPlane,
} from "./stackup.ts";
import {
  create_layer,
  create_plane,
  type ColinearTrace,
  type ColinearLayerTemplate,
  type ColinearTraceTemplate,
  type BroadsideTrace,
  type BroadsideLayerTemplate,
  type BroadsideTraceTemplate,
} from "./editor.ts";
import { StackupParameters } from "./parameters.ts";
import { type IdStore } from "./id_store.ts";

export const colinear_trace_templates = {
  "pair": {
    create(params: StackupParameters, position: TracePosition, id_store: IdStore): ColinearTrace {
      const ids = Array.from({ length: 2 }, (_) => id_store.own());
      const conductors: CopperTrace[] = [
        { type: "trace", id: ids[0], position, width: params.W, voltage: "positive" },
        { type: "trace", id: ids[1], position, width: params.W, voltage: "negative" },
      ];
      const spacings: HorizontalSpacing[] = [
        { left_trace: { id: ids[0], attach: "right" }, right_trace: { id: ids[1], attach: "left" }, width: params.S },
      ];
      return { position, conductors, spacings };
    }
  } as ColinearTraceTemplate,
  "coplanar pair": {
    create(params: StackupParameters, position: TracePosition, id_store: IdStore): ColinearTrace {
      const ids = Array.from({ length: 4 }, (_) => id_store.own());
      const conductors: CopperTrace[] = [
        { type: "trace", id: ids[0], position, width: params.CW, voltage: "ground" },
        { type: "trace", id: ids[1], position, width: params.W, voltage: "positive" },
        { type: "trace", id: ids[2], position, width: params.W, voltage: "negative" },
        { type: "trace", id: ids[3], position, width: params.CW, voltage: "ground" },
      ];
      const spacings: HorizontalSpacing[] = [
        { left_trace: { id: ids[0], attach: "right" }, right_trace: { id: ids[1], attach: "left" }, width: params.CS },
        { left_trace: { id: ids[1], attach: "right" }, right_trace: { id: ids[2], attach: "left" }, width: params.S },
        { left_trace: { id: ids[2], attach: "right" }, right_trace: { id: ids[3], attach: "left" }, width: params.CS },
      ];
      return { position, conductors, spacings };
    }
  } as ColinearTraceTemplate,
  "single ended": {
    create(params: StackupParameters, position: TracePosition, id_store: IdStore): ColinearTrace {
      const ids = Array.from({ length: 1 }, (_) => id_store.own());
      const conductors: CopperTrace[] = [
        { type: "trace", id: ids[0], position, width: params.W, voltage: "positive" },
      ];
      const spacings: HorizontalSpacing[] = [];
      return { position, conductors, spacings };

    }
  } as ColinearTraceTemplate,
  "coplanar single ended": {
    create(params: StackupParameters, position: TracePosition, id_store: IdStore): ColinearTrace {
      const ids = Array.from({ length: 3 }, (_) => id_store.own());
      const conductors: CopperTrace[] = [
        { type: "trace", id: ids[0], position, width: params.CW, voltage: "ground" },
        { type: "trace", id: ids[1], position, width: params.W, voltage: "positive" },
        { type: "trace", id: ids[2], position, width: params.CW, voltage: "ground" },
      ];
      const spacings: HorizontalSpacing[] = [
        { left_trace: { id: ids[0], attach: "right" }, right_trace: { id: ids[1], attach: "left" }, width: params.CS },
        { left_trace: { id: ids[1], attach: "right" }, right_trace: { id: ids[2], attach: "left" }, width: params.CS },
      ];
      return { position, conductors, spacings };
    }
  } as ColinearTraceTemplate,
};

export const colinear_layer_templates = {
  "microstrip": {
    create(params: StackupParameters, id_store: IdStore): {
      layers: Layer[],
      plane_conductors: CopperPlane[],
      trace_position: TracePosition,
    } {
      const layer_0 = create_layer.soldermask(params, id_store.own(), "down");
      const layer_1 = create_layer.core(params, id_store.own());
      const layer_2 = create_layer.unmasked(params, id_store.own(), "up");

      const plane = create_plane(params, { layer_id: layer_2.id, orientation: layer_2.orientation });

      return {
        layers: [layer_0, layer_1, layer_2],
        plane_conductors: [plane],
        trace_position: { layer_id: layer_0.id, orientation: layer_0.orientation },
      };
    },
  } as ColinearLayerTemplate,
  "stripline": {
    create(params: StackupParameters, id_store: IdStore): {
      layers: Layer[],
      plane_conductors: CopperPlane[],
      trace_position: TracePosition,
    } {
      const layer_0 = create_layer.prepreg(params, id_store.own());
      const layer_1 = create_layer.core(params, id_store.own());
      const layer_2 = create_layer.unmasked(params, id_store.own(), "up");

      const top_plane = create_plane(params, { layer_id: layer_0.id, orientation: "up" });
      const bottom_plane = create_plane(params, { layer_id: layer_2.id, orientation: layer_2.orientation });

      return {
        layers: [layer_0, layer_1, layer_2],
        plane_conductors: [top_plane, bottom_plane],
        trace_position: { layer_id: layer_0.id, orientation: "down" },
      };
    },
  } as ColinearLayerTemplate,
}

export const broadside_layer_templates = {
  "microstrip": {
    create(params: StackupParameters, id_store: IdStore): {
      layers: Layer[],
      plane_conductors: CopperPlane[],
      left_trace_position: TracePosition,
      right_trace_position: TracePosition,
    } {
      const layer_0 = create_layer.soldermask(params, id_store.own(), "down");
      const layer_1 = create_layer.core(params, id_store.own());
      const layer_2 = create_layer.soldermask(params, id_store.own(), "up");

      return {
        layers: [layer_0, layer_1, layer_2],
        plane_conductors: [],
        left_trace_position: { layer_id: layer_0.id, orientation: layer_0.orientation },
        right_trace_position: { layer_id: layer_2.id, orientation: layer_2.orientation },
      };
    }
  } as BroadsideLayerTemplate,
  "stripline": {
    create(params: StackupParameters, id_store: IdStore): {
      layers: Layer[],
      plane_conductors: CopperPlane[],
      left_trace_position: TracePosition,
      right_trace_position: TracePosition,
    } {
      const layer_0 = create_layer.prepreg(params, id_store.own());
      const layer_1 = create_layer.core(params, id_store.own());
      const layer_2 = create_layer.prepreg(params, id_store.own());

      const top_plane = create_plane(params, { layer_id: layer_0.id, orientation: "up" });
      const bottom_plane = create_plane(params, { layer_id: layer_2.id, orientation: "down" });

      return {
        layers: [layer_0, layer_1, layer_2],
        plane_conductors: [top_plane, bottom_plane],
        left_trace_position: { layer_id: layer_0.id, orientation: "down" },
        right_trace_position: { layer_id: layer_2.id, orientation: "up" },
      };
    }
  } as BroadsideLayerTemplate,
};

function get_opposite_voltage(voltage: Voltage): Voltage {
  if (voltage !== "positive" && voltage !== "negative") {
    throw Error(`Cannot get the opposite voltage for ${voltage}`)
  }
  return (voltage == "positive") ? "negative" : "positive";
}

type SymmetricalBroadsideTraceTemplate = BroadsideTraceTemplate & {
  create_traces: (params: StackupParameters, position: TracePosition, signal_voltage: Voltage, id_store: IdStore) => BroadsideTrace;
}

export const broadside_trace_templates = {
  "pair": {
    create_traces(params: StackupParameters, position: TracePosition, signal_voltage: Voltage, id_store: IdStore): BroadsideTrace {
      const ids = Array.from({ length: 1 }, (_) => id_store.own());
      const conductors: CopperTrace[] = [
        { type: "trace", id: ids[0], position, width: params.W, voltage: signal_voltage },
      ];
      const root = conductors[0];
      const spacings: HorizontalSpacing[] = [];
      return { position, root, conductors, spacings };
    },
    create_left(params: StackupParameters, position: TracePosition, id_store: IdStore): BroadsideTrace {
      return this.create_traces(params, position, "positive", id_store);
    },
    create_right(params: StackupParameters, position: TracePosition, id_store: IdStore): BroadsideTrace {
      return this.create_traces(params, position, "negative", id_store);
    },
  } as SymmetricalBroadsideTraceTemplate,
  "coplanar pair": {
    create_traces(params: StackupParameters, position: TracePosition, signal_voltage: Voltage, id_store: IdStore): BroadsideTrace {
      const ids = Array.from({ length: 3 }, (_) => id_store.own());
      const conductors: CopperTrace[] = [
        { type: "trace", id: ids[0], position, width: params.CW, voltage: "ground" },
        { type: "trace", id: ids[1], position, width: params.W, voltage: signal_voltage },
        { type: "trace", id: ids[2], position, width: params.CW, voltage: "ground" },
      ];
      const root = conductors[1];
      const spacings: HorizontalSpacing[] = [
        { left_trace: { id: ids[0], attach: "right" }, right_trace: { id: ids[1], attach: "left" }, width: params.CS },
        { left_trace: { id: ids[1], attach: "right" }, right_trace: { id: ids[2], attach: "left" }, width: params.CS },
      ];
      return { position, root, conductors, spacings };
    },
    create_left(params: StackupParameters, position: TracePosition, id_store: IdStore): BroadsideTrace {
      return this.create_traces(params, position, "positive", id_store);
    },
    create_right(params: StackupParameters, position: TracePosition, id_store: IdStore): BroadsideTrace {
      return this.create_traces(params, position, "negative", id_store);
    },
  } as SymmetricalBroadsideTraceTemplate,
  "mirrored pair": {
    create_traces(params: StackupParameters, position: TracePosition, signal_voltage: Voltage, id_store: IdStore): BroadsideTrace {
      const ids = Array.from({ length: 2 }, (_) => id_store.own());
      const conductors: CopperTrace[] = [
        { type: "trace", id: ids[0], position, width: params.W, voltage: signal_voltage },
        { type: "trace", id: ids[1], position, width: params.W, voltage: get_opposite_voltage(signal_voltage) },
      ];
      const root = conductors[0];
      const spacings: HorizontalSpacing[] = [
        { left_trace: { id: ids[0], attach: "right" }, right_trace: { id: ids[1], attach: "left" }, width: params.S },
      ];
      return { position, root, conductors, spacings };
    },
    create_left(params: StackupParameters, position: TracePosition, id_store: IdStore): BroadsideTrace {
      return this.create_traces(params, position, "positive", id_store);
    },
    create_right(params: StackupParameters, position: TracePosition, id_store: IdStore): BroadsideTrace {
      return this.create_traces(params, position, "negative", id_store);
    },
  } as SymmetricalBroadsideTraceTemplate,
  "coplanar mirrored pair": {
    create_traces(params: StackupParameters, position: TracePosition, signal_voltage: Voltage, id_store: IdStore): BroadsideTrace {
      const ids = Array.from({ length: 4 }, (_) => id_store.own());
      const conductors: CopperTrace[] = [
        { type: "trace", id: ids[0], position, width: params.CW, voltage: "ground" },
        { type: "trace", id: ids[1], position, width: params.W, voltage: signal_voltage },
        { type: "trace", id: ids[2], position, width: params.W, voltage: get_opposite_voltage(signal_voltage) },
        { type: "trace", id: ids[3], position, width: params.CW, voltage: "ground" },
      ];
      const root = conductors[1];
      const spacings: HorizontalSpacing[] = [
        { left_trace: { id: ids[0], attach: "right" }, right_trace: { id: ids[1], attach: "left" }, width: params.CS },
        { left_trace: { id: ids[1], attach: "right" }, right_trace: { id: ids[2], attach: "left" }, width: params.S },
        { left_trace: { id: ids[2], attach: "right" }, right_trace: { id: ids[3], attach: "left" }, width: params.CS },
      ];
      return { position, root, conductors, spacings };
    },
    create_left(params: StackupParameters, position: TracePosition, id_store: IdStore): BroadsideTrace {
      return this.create_traces(params, position, "positive", id_store);
    },
    create_right(params: StackupParameters, position: TracePosition, id_store: IdStore): BroadsideTrace {
      return this.create_traces(params, position, "negative", id_store);
    },
  } as SymmetricalBroadsideTraceTemplate,
};
