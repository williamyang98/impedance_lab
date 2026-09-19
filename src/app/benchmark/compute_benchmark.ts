import { KernelComputeBenchmark, type ComputeBenchmarkType } from "./kernel_compute_benchmark.ts";
import { GPUTimer } from "./gpu_timer.ts";

export interface ComputeBenchmarkConfig {
  total_compute_units: number;
  total_warmup_steps: number;
  total_warm_steps: number;
  work_multiplier: number;
}

export interface ComputeBenchmarkResult {
  type: ComputeBenchmarkType;
  is_supported: boolean;
  base_outer_loops: number;
  curr_step?: number;
  total_steps?: number;
  iop_rate?: number;
  iop_unit: string;
  error?: string;
}

export class ComputeBenchmark {
  device: GPUDevice;
  kernel: KernelComputeBenchmark;

  constructor(device: GPUDevice) {
    this.device = device;
    this.kernel = new KernelComputeBenchmark(device);
  }

  get_supported_benchmarks(): ComputeBenchmarkResult[] {
    const features = this.device.features as ReadonlySet<GPUFeatureName>;
    const benchmarks: ComputeBenchmarkResult[] = [];
    benchmarks.push(
      { type: "f16", base_outer_loops: 4, iop_unit: "Flop/s", is_supported: features.has("shader-f16") },
      { type: "f32", base_outer_loops: 2, iop_unit: "Flop/s", is_supported: true },
      { type: "u32", base_outer_loops: 1, iop_unit: "Iop/s", is_supported: true },
      { type: "i32", base_outer_loops: 1, iop_unit: "Iop/s", is_supported: true },
    )
    return benchmarks;
  }

  async run_benchmark(result: ComputeBenchmarkResult, config: ComputeBenchmarkConfig) {
    const total_workgroups_per_compute_unit = 2048;
    const total_elements = config.total_compute_units*total_workgroups_per_compute_unit*this.kernel.workgroup_size;
    const total_steps = config.total_warmup_steps + config.total_warm_steps;
    const total_outer_loops = result.base_outer_loops*config.work_multiplier;

    result.curr_step = 0;
    result.total_steps = total_steps;
    result.iop_rate = undefined;
    result.error = undefined;
    if (!result.is_supported) return;

    const type_size_bytes = this.kernel.get_type_size_bytes(result.type);
    const gpu_A = this.device.createBuffer({
      size: total_elements*type_size_bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const gpu_timer = new GPUTimer(this.device, 1);
    try {
      const samples_ns: bigint[] = [];
      for (let i = 0; i < total_steps; i++) {
        const command_encoder = this.device.createCommandEncoder();
        const compute_pass = command_encoder.beginComputePass({
          timestampWrites: gpu_timer.get_timestamp_writes(0),
        });
        this.kernel.create_pass(compute_pass, gpu_A, total_elements, result.type, total_outer_loops);
        compute_pass.end();
        gpu_timer.enqueue_read(command_encoder);
        this.device.queue.submit([command_encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();

        const timestamps = await gpu_timer.read_timestamps();
        const elapsed_ns = timestamps[0].elapsed_ns;
        samples_ns.push(elapsed_ns);
        result.curr_step = i+1;
      }

      const warm_samples = samples_ns.slice(config.total_warmup_steps).map(ns => Number(ns)*1e-9);
      const avg_elapsed = warm_samples.reduce((a,b) => a+b, 0)/warm_samples.length;
      const iops_per_element = total_outer_loops*this.kernel.iops_per_loop*this.kernel.inner_loop_count;
      const iop_rate = iops_per_element*total_elements/avg_elapsed;
      result.iop_rate = iop_rate;
    } catch (error) {
      result.error = String(error);
    } finally {
      gpu_A.destroy();
      gpu_timer.destroy();
    }
  }
}

