import { GPUTimer } from "./gpu_timer.ts";

export interface MemoryBandwidthBenchmarkConfig {
  total_transfers: number;
}

export interface MemoryBandwidthBenchmarkResult {
  curr_step?: number;
  total_steps?: number;
  bandwidth?: number;
  error?: string;
}

export class MemoryBandwidthBenchmark {
  device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  get buffer_size(): number {
    return this.device.limits.maxStorageBufferBindingSize;
  }

  async run_benchmark(result: MemoryBandwidthBenchmarkResult, config: MemoryBandwidthBenchmarkConfig) {
    const buffer_size = this.buffer_size;
    const gpu_buffer = this.device.createBuffer({
      size: buffer_size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const cpu_buffer = this.device.createBuffer({
      size: buffer_size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const kernel_timer = new GPUTimer(this.device, 2);
    const total_steps = config.total_transfers;
    result.curr_step = 0;
    result.total_steps = total_steps;
    result.bandwidth = undefined;
    result.error = undefined;

    try {
      const command_encoder = this.device.createCommandEncoder();
      command_encoder.beginComputePass({
        timestampWrites: kernel_timer.get_timestamp_writes(0),
      }).end();
      for (let i = 0; i < total_steps; i++) {
        command_encoder.copyBufferToBuffer(gpu_buffer, cpu_buffer, buffer_size);
        await cpu_buffer.mapAsync(GPUMapMode.READ, 0, buffer_size);
        result.curr_step = i+1;
        cpu_buffer.unmap();
      }
      command_encoder.beginComputePass({
        timestampWrites: kernel_timer.get_timestamp_writes(1),
      }).end();
      kernel_timer.enqueue_read(command_encoder);
      this.device.queue.submit([command_encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();

      const timestamps = await kernel_timer.read_timestamps();
      const elapsed_ns = timestamps[1].start_ns - timestamps[0].end_ns;
      const elapsed = Number(elapsed_ns)*1e-9;

      const bandwidth = (this.buffer_size*total_steps)/elapsed;
      result.bandwidth = bandwidth;
    } catch (error) {
      result.error = String(error);
    } finally {
      gpu_buffer.destroy();
      cpu_buffer.destroy();
      kernel_timer.destroy();
    }
  }
}
