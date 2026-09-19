import { KernelCalculateResidual } from './kernel_residual.ts';
import { KernelJacobiSmooth } from './kernel_jacobi_smooth.ts';
import { Ndarray, type NdarrayType } from '../../utility/ndarray.ts';
import { type Vec3 } from '../../utility/dim_types';
import { NdGpuArray } from '../../utility/gpu_common.ts';

type Size3D = Vec3<number>;

export class CpuGrid {
  size: Size3D;
  v: Ndarray;
  r: Ndarray;
  b: Ndarray;
  mask: Ndarray;
  dx: Ndarray;
  dy: Ndarray;
  dz: Ndarray;
  x: Ndarray;
  y: Ndarray;
  z: Ndarray;
  er: Ndarray;

  static readonly total_mask_bits = 32;

  constructor(size: Size3D) {
    this.size = size;

    const total_nodes = (size.x+1)*(size.y+1)*(size.z+1);
    this.v = Ndarray.create_zeros([size.z+1,size.y+1,size.x+1], "f32");
    this.r = Ndarray.create_zeros([size.z+1,size.y+1,size.x+1], "f32");
    this.b = Ndarray.create_zeros([size.z+1,size.y+1,size.x+1], "f32");
    this.er = Ndarray.create_zeros([size.z,size.y,size.x], "f32");
    this.mask = Ndarray.create_zeros([Math.ceil(total_nodes/CpuGrid.total_mask_bits)], "u32");
    this.dx = Ndarray.create_zeros([size.x], "f32");
    this.dy = Ndarray.create_zeros([size.y], "f32");
    this.dz = Ndarray.create_zeros([size.z], "f32");
    this.x = Ndarray.create_zeros([size.x+1], "f32");
    this.y = Ndarray.create_zeros([size.y+1], "f32");
    this.z = Ndarray.create_zeros([size.z+1], "f32");
  }
}

export class GpuGrid {
  size: Size3D;
  device: GPUDevice;
  v_in: NdGpuArray;
  v_out: NdGpuArray;
  r: NdGpuArray;
  b: NdGpuArray;
  mask: NdGpuArray;
  dx: NdGpuArray;
  dy: NdGpuArray;
  dz: NdGpuArray;
  x: NdGpuArray;
  y: NdGpuArray;
  z: NdGpuArray;
  er: NdGpuArray;
  readback: GPUBuffer;

  constructor(size: Size3D, device: GPUDevice) {
    this.size = size;
    this.device = device;
    let max_buffer_size = -Infinity;
    const create_buffer = (shape: number[], dtype: NdarrayType): NdGpuArray => {
      const buffer = new NdGpuArray(device, shape, dtype);
      max_buffer_size = Math.max(max_buffer_size, buffer.data.size);
      return buffer;
    };
    const total_nodes = (size.x+1)*(size.y+1)*(size.z+1);
    this.v_in = create_buffer([size.z+1,size.y+1,size.x+1], "f32");
    this.v_out = create_buffer([size.z+1,size.y+1,size.x+1], "f32");
    this.r = create_buffer([size.z+1,size.y+1,size.x+1], "f32");
    this.b = create_buffer([size.z+1,size.y+1,size.x+1], "f32");
    this.mask = create_buffer([Math.ceil(total_nodes/CpuGrid.total_mask_bits)], "u32");
    this.er = create_buffer([size.z,size.y,size.x], "f32");
    this.dx = create_buffer([size.x], "f32");
    this.dy = create_buffer([size.y], "f32");
    this.dz = create_buffer([size.z], "f32");
    this.x = create_buffer([size.x+1], "f32");
    this.y = create_buffer([size.y+1], "f32");
    this.z = create_buffer([size.z+1], "f32");
    if (!Number.isFinite(max_buffer_size)) {
      throw Error("Unable to determine maximum buffer size for readback buffer");
    }
    this.readback = device.createBuffer({
      size: max_buffer_size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  swap_voltage_buffer() {
    const tmp = this.v_in;
    this.v_in = this.v_out;
    this.v_out = tmp;
  }

  from_cpu(cpu: CpuGrid) {
    const write_buffer = (gpu: NdGpuArray, cpu: Ndarray) => {
      if (gpu.dtype !== cpu.dtype) {
        throw Error(`Mismatch between dtypes with cpu=${cpu.dtype} and gpu=${gpu.dtype}`);
      }
      function is_shape_equal(s0: number[], s1: number[]) {
        if (s0.length !== s1.length) return false;
        for (let i = 0; i < s0.length; i++) {
          if (s0[i] !== s1[i]) return false;
        }
        return true;
      }
      if (!is_shape_equal(cpu.shape, gpu.shape)) {
        throw Error(`Mismatch between shapes with cpu=[${cpu.shape.join(',')}] and gpu=[${gpu.shape.join(',')}]`);
      }
      this.device.queue.writeBuffer(gpu.data, 0, cpu.data, 0, cpu.data.length);
    };
    write_buffer(this.v_in, cpu.v);
    write_buffer(this.r, cpu.r);
    write_buffer(this.b, cpu.b);
    write_buffer(this.mask, cpu.mask);
    write_buffer(this.er, cpu.er);
    write_buffer(this.dx, cpu.dx);
    write_buffer(this.dy, cpu.dy);
    write_buffer(this.dz, cpu.dz);
    write_buffer(this.x, cpu.x);
    write_buffer(this.y, cpu.y);
    write_buffer(this.z, cpu.z);
  }

  async to_cpu(cpu: CpuGrid) {
    const read_buffer = async (gpu: NdGpuArray, cpu: Ndarray) => {
      if (gpu.dtype !== cpu.dtype) {
        throw Error(`Mismatch between dtypes with cpu=${cpu.dtype} and gpu=${gpu.dtype}`);
      }
      function is_shape_equal(s0: number[], s1: number[]) {
        if (s0.length !== s1.length) return false;
        for (let i = 0; i < s0.length; i++) {
          if (s0[i] !== s1[i]) return false;
        }
        return true;
      }
      if (!is_shape_equal(cpu.shape, gpu.shape)) {
        throw Error(`Mismatch between shapes with cpu=[${cpu.shape.join(',')}] and gpu=[${gpu.shape.join(',')}]`);
      }
      const total_bytes = gpu.data.size;
      // copy to readback buffer
      const command_encoder = this.device.createCommandEncoder();
      command_encoder.copyBufferToBuffer(gpu.data, 0, this.readback, 0, total_bytes);
      this.device.queue.submit([command_encoder.finish()]);
      // map readback to cpu buffer
      await this.readback.mapAsync(GPUMapMode.READ);
      const mapped_view = this.readback.getMappedRange();
      const dst_view = new Uint8Array(cpu.data.buffer, 0, total_bytes);
      const src_view = new Uint8Array(mapped_view, 0, total_bytes);
      dst_view.set(src_view);
      this.readback.unmap();
    };
    await read_buffer(this.v_in, cpu.v);
    await read_buffer(this.r, cpu.r);
  }
}

export class GpuEngine {
  device: GPUDevice;
  kernel_jacobi_smooth: KernelJacobiSmooth;
  kernel_calculate_residual: KernelCalculateResidual;

  constructor(device: GPUDevice) {
    this.device = device;
    const workgroup_size: Size3D = { x: 16, y: 16, z: 1 };
    this.kernel_jacobi_smooth = new KernelJacobiSmooth(workgroup_size, this.device);
    this.kernel_calculate_residual = new KernelCalculateResidual(workgroup_size, this.device);
  }

  jacobi_smooth(command_encoder: GPUCommandEncoder, grid: GpuGrid, beta: number) {
    this.kernel_jacobi_smooth.create_pass(
      command_encoder,
      grid.v_out, grid.v_in, grid.b, grid.mask,
      grid.dx, grid.dy, grid.dz,
      grid.size,
      beta,
    );
    grid.swap_voltage_buffer();
  }

  calculate_residual(command_encoder: GPUCommandEncoder, grid: GpuGrid) {
    this.kernel_calculate_residual.create_pass(
      command_encoder,
      grid.r, grid.v_in, grid.b, grid.mask,
      grid.dx, grid.dy, grid.dz,
      grid.size,
    );
  }
}
