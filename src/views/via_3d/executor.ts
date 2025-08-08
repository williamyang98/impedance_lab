import { StackupGrid } from "./stackup_to_grid.ts";
import { GpuEngine } from "../../app/electrostatic_3d/grid.ts";
import { ToastManager } from "../../providers/toast/toast.ts";
import { type ImpedanceResult, calculate_via_impedance } from "./impedance.ts";
import type { Profiler } from "../../utility/profiler.ts";
import type { Size3D } from "../../wgpu_kernels/electrostatic_3d/index.ts";

export interface RunStatus {
  curr_step: number;
  total_steps: number;
};

export interface ExecutorControls {
  total_steps: number;
  run_status?: RunStatus;
  stride_size: number;
}

export function calculate_ideal_total_steps(size: Size3D): number {
  const D = Math.ceil((size.x*size.x + size.y*size.y + size.z*size.z)**0.5);
  const total_bounces = 16;
  return D*total_bounces*2;
}

export class Executor {
  gpu_device: GPUDevice;
  gpu_engine: GpuEngine;
  controls: ExecutorControls;

  constructor(gpu_device: GPUDevice, controls: ExecutorControls) {
    this.controls = controls;
    this.gpu_device = gpu_device;
    this.gpu_engine = new GpuEngine(this.gpu_device);
  }

  async run(stackup_grid: StackupGrid, toast?: ToastManager, profiler?: Profiler): Promise<ImpedanceResult> {
    if (stackup_grid.gpu_device !== this.gpu_device) {
      throw Error("Mismatching gpu devices between stackup and engine")
    }

    const stride_size = this.controls.stride_size;
    const total_strides = Math.ceil(this.controls.total_steps/stride_size);
    const total_steps = stride_size*total_strides;
    this.controls.run_status = {
      curr_step: 0,
      total_steps,
    };

    const gpu_grid = stackup_grid.gpu_grid;
    const cpu_grid = stackup_grid.cpu_grid;

    const gpu_solve_metadata = {
      "Current Step": undefined as (undefined | string),
      "Current Stride": undefined as (undefined | string),
      "Total Steps": String(total_steps),
      "Stride Size": String(stride_size),
      "Total Strides": String(total_strides),
    };
    profiler?.begin("gpu_solve", undefined, gpu_solve_metadata);
    for (let i = 0; i < total_strides; i++) {
      {
        const command_encoder = this.gpu_device.createCommandEncoder();
        for (let j = 0; j < stride_size; j++) {
          const beta = 0.95;
          this.gpu_engine.jacobi_smooth(command_encoder, gpu_grid, beta);
        }
        this.gpu_device.queue.submit([command_encoder.finish()]);
        await this.gpu_device.queue.onSubmittedWorkDone();
      }
      const curr_step = (i+1)*stride_size;
      this.controls.run_status.curr_step = curr_step;
      gpu_solve_metadata["Current Stride"] = String(i+1);
      gpu_solve_metadata["Current Step"] = String(curr_step);
    }
    profiler?.end();
    toast?.info(`GPU engine ran ${total_steps} steps`);

    profiler?.begin("calculate_residual");
    {
      const command_encoder = this.gpu_device.createCommandEncoder();
      this.gpu_engine.calculate_residual(command_encoder, gpu_grid);
      this.gpu_device.queue.submit([command_encoder.finish()]);
      await this.gpu_device.queue.onSubmittedWorkDone();
    }
    profiler?.end();

    profiler?.begin("cpu_copy");
    await gpu_grid.to_cpu(cpu_grid);
    await this.gpu_device.queue.onSubmittedWorkDone();
    profiler?.end();

    profiler?.begin("calculate_impedance");
    const measurement = calculate_via_impedance(stackup_grid, profiler);
    profiler?.end();

    return measurement;
  }
}
