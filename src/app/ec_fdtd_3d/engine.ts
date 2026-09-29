import { type Axis3D, type Vec3 } from "../../utility/dim_types.ts";
import { KernelApplyCurrentSource, Params as CurrentSourceParams } from "./kernel_apply_current_source.ts";
import { KernelUpdateVoltage } from "./kernel_update_voltage.ts";
import { KernelUpdateCurrent } from "./kernel_update_current.ts";
import { BakeCellMaterialsParams, KernelBakeCellMaterials } from "./kernel_bake_cell_materials.ts";
import { CpuGrid, GpuGrid } from "./grid.ts";

type Size3D = Vec3<number>;

export interface SimulationSource {
  current_id: number;
  offset: Size3D;
  size: Size3D;
  direction: Axis3D;
}

export class Timer {
  start_millis?: number;
  end_millis?: number;

  get elapsed_seconds() {
    if (this.start_millis === undefined) return undefined;
    if (this.end_millis === undefined) return undefined;
    return (this.end_millis-this.start_millis)*1e-3;
  }

  reset() {
    this.end_millis = undefined;
    this.start_millis = undefined;
  }

  trigger() {
    const now_millis = performance.now();
    if (this.start_millis === undefined) {
      this.start_millis = now_millis;
    }
    this.end_millis = now_millis;
  }
}

export class SimulationSetup {
  size: Size3D;
  cpu: CpuGrid;
  gpu: GpuGrid;
  sources: SimulationSource[];
  source_values: Partial<Record<number, number[]>>;
  current_step: number;
  maximum_steps: number = 0;
  timer: Timer;

  constructor(adapter: GPUAdapter, device: GPUDevice, size: Size3D) {
    this.size = size;
    this.cpu = new CpuGrid(size);
    this.gpu = new GpuGrid(adapter, device, size);
    this.sources = [];
    this.current_step = 0;
    this.timer = new Timer();
    this.source_values = {};
  }
}

export class GpuEngine {
  adapter: GPUAdapter;
  device: GPUDevice;

  kernel_bake_cell_materials: KernelBakeCellMaterials;
  kernel_apply_current_source: KernelApplyCurrentSource;
  kernel_update_voltage: KernelUpdateVoltage;
  kernel_update_current: KernelUpdateCurrent;
  bake_cell_materials_params: BakeCellMaterialsParams;
  current_source_params: CurrentSourceParams[];

  constructor(adapter: GPUAdapter, device: GPUDevice) {
    this.adapter = adapter;
    this.device = device;
    const source_workgroup_size: Size3D = { x: 16, y: 16, z: 1 };
    const grid_workgroup_size: Size3D = { x: 16, y: 16, z: 1 };
    this.kernel_bake_cell_materials = new KernelBakeCellMaterials(grid_workgroup_size, device);
    this.kernel_apply_current_source = new KernelApplyCurrentSource(source_workgroup_size, device);
    this.kernel_update_voltage = new KernelUpdateVoltage(grid_workgroup_size, device);
    this.kernel_update_current = new KernelUpdateCurrent(grid_workgroup_size, device);
    this.current_source_params = [];
    this.bake_cell_materials_params = new BakeCellMaterialsParams(device);
  }

  async bake_cell_materials(setup: SimulationSetup) {
    const params = this.bake_cell_materials_params;
    const view = params.view;
    view.grid_size.x = setup.size.x;
    view.grid_size.y = setup.size.y;
    view.grid_size.z = setup.size.z;
    view.dt = setup.cpu.dt;
    view.max_R = 1.0e10;
    view.max_L = 1.0e10;
    params.write_to_gpu();

    const command_encoder = this.device.createCommandEncoder();
    setup.gpu.copy_from_cpu(setup.cpu, new Set(["grid_lines", "raw_materials"]));
    this.kernel_bake_cell_materials.create_pass(command_encoder, params, setup.gpu);
    this.device.queue.submit([command_encoder.finish()]);
    await setup.gpu.copy_to_cpu(setup.cpu, new Set(["baked_materials"]));
  }

  step_fdtd(setup: SimulationSetup) {
    const sources = setup.sources;
    const gpu = setup.gpu;
    setup.timer.trigger();

    const command_encoder = this.device.createCommandEncoder();
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const values = setup.source_values[source.current_id];
      if (values === undefined) continue;
      const value = values.at(setup.current_step);
      if (value === undefined) continue;

      let source_params = this.current_source_params.at(i);
      if (source_params === undefined) {
        source_params = new CurrentSourceParams(this.device);
        this.current_source_params.push(source_params);
      }

      const V = gpu.V[source.direction];
      const beta = gpu.bake_beta[source.direction];
      source_params.view.data_size.x = V.shape[2];
      source_params.view.data_size.y = V.shape[1];
      source_params.view.data_size.z = V.shape[0];
      source_params.view.source_offset.x = source.offset.x;
      source_params.view.source_offset.y = source.offset.y;
      source_params.view.source_offset.z = source.offset.z;
      source_params.view.source_size.x = source.size.x;
      source_params.view.source_size.y = source.size.y;
      source_params.view.source_size.z = source.size.z;
      source_params.view.i_source = value;
      source_params.write_to_gpu();

      this.kernel_apply_current_source.create_pass(command_encoder, V, beta, source_params);
    }
    this.kernel_update_voltage.create_pass(command_encoder, gpu.V, gpu.I, gpu.bake_alpha, gpu.bake_beta, gpu.size);
    this.kernel_update_current.create_pass(command_encoder, gpu.I, gpu.V, gpu.bake_phi, gpu.size);
    this.device.queue.submit([command_encoder.finish()]);
    setup.current_step += 1;
    setup.timer.trigger();
  }

  async copy_voltage_current_to_cpu(setup: SimulationSetup) {
    await setup.gpu.copy_to_cpu(setup.cpu, new Set(["voltage", "current"]));
  }

  reset_voltage_current(setup: SimulationSetup) {
    setup.gpu.copy_from_cpu(setup.cpu, new Set(["voltage", "current"]));
    setup.current_step = 0;
    setup.timer.reset();
  }
}
