import { KernelCalculateResidual, KernelJacobiSmooth, type Size3D } from '../../wgpu_kernels/electrostatic_3d';
import { Ndarray } from '../../utility/ndarray';

export class CpuGrid {
  size: Size3D;
  x: Ndarray;
  r: Ndarray;
  b: Ndarray;
  mask: Ndarray;
  dx: Ndarray;
  dy: Ndarray;
  dz: Ndarray;

  constructor(size: Size3D) {
    this.size = size;

    const total_cells = size.x*size.y*size.z;
    this.x = Ndarray.create_zeros([size.z,size.y,size.x], "f32");
    this.r = Ndarray.create_zeros([size.z,size.y,size.x], "f32");
    this.b = Ndarray.create_zeros([size.z,size.y,size.x], "f32");
    this.mask = Ndarray.create_zeros([Math.ceil(total_cells/32)], "u32");
    this.dx = Ndarray.create_zeros([size.x-1], "f32");
    this.dy = Ndarray.create_zeros([size.y-1], "f32");
    this.dz = Ndarray.create_zeros([size.z-1], "f32");
  }
}

export class GpuGrid {
  size: Size3D;
  device: GPUDevice;
  xin: GPUBuffer;
  xout: GPUBuffer;
  r: GPUBuffer;
  b: GPUBuffer;
  mask: GPUBuffer;
  dx: GPUBuffer;
  dy: GPUBuffer;
  dz: GPUBuffer;
  readback: GPUBuffer;

  constructor(size: Size3D, device: GPUDevice) {
    this.size = size;
    this.device = device;
    const create_buffer = (size: number): GPUBuffer => {
      const buffer = device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      return buffer;
    };
    const total_cells = size.x*size.y*size.z;
    this.xin = create_buffer(total_cells*4);
    this.xout = create_buffer(total_cells*4);
    this.r = create_buffer(total_cells*4);
    this.b = create_buffer(total_cells*4);
    this.mask = create_buffer(Math.ceil(total_cells/8));
    this.dx = create_buffer((size.x-1)*4);
    this.dy = create_buffer((size.y-1)*4);
    this.dz = create_buffer((size.z-1)*4);
    this.readback = device.createBuffer({
      size: total_cells*4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  swap() {
    const tmp = this.xin;
    this.xin = this.xout;
    this.xout = tmp;
  }

  from_cpu(cpu: CpuGrid) {
    const write_buffer = (gpu: GPUBuffer, cpu: Ndarray) => {
      this.device.queue.writeBuffer(gpu, 0, cpu.data, 0, cpu.data.length);
    };
    write_buffer(this.xin, cpu.x);
    write_buffer(this.r, cpu.r);
    write_buffer(this.b, cpu.b);
    write_buffer(this.mask, cpu.mask);
    write_buffer(this.dx, cpu.dx);
    write_buffer(this.dy, cpu.dy);
    write_buffer(this.dz, cpu.dz);
  }

  async to_cpu(cpu: CpuGrid) {
    const read_buffer = async (gpu: GPUBuffer, cpu: Ndarray) => {
      if (gpu.size !== cpu.data.byteLength) {
        throw Error(`Mismatching size between gpu buffer (${gpu.size}B) and cpu buffer (${cpu.data.byteLength}B)`);
      }
      const total_bytes = gpu.size;
      // copy to readback buffer
      const command_encoder = this.device.createCommandEncoder();
      command_encoder.copyBufferToBuffer(gpu, 0, this.readback, 0, total_bytes);
      this.device.queue.submit([command_encoder.finish()]);
      // map readback to cpu buffer
      await this.readback.mapAsync(GPUMapMode.READ);
      const mapped_view = this.readback.getMappedRange();
      const dst_view = new Uint8Array(cpu.data.buffer, 0, total_bytes);
      const src_view = new Uint8Array(mapped_view, 0, total_bytes);
      dst_view.set(src_view);
      this.readback.unmap();
    };
    await read_buffer(this.xin, cpu.x);
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

  jacobi_smooth(command_encoder: GPUCommandEncoder, grid: GpuGrid, total_steps: number) {
    const jacobi_smooth_beta = 0.95;
    for (let i = 0; i < total_steps; i++) {
      this.kernel_jacobi_smooth.create_pass(
        command_encoder,
        grid.xout, grid.xin, grid.b, grid.mask,
        grid.dx, grid.dy, grid.dz,
        grid.size,
        jacobi_smooth_beta,
      );
      grid.swap();
    }
  }

  calculate_residual(command_encoder: GPUCommandEncoder, grid: GpuGrid) {
    this.kernel_calculate_residual.create_pass(
      command_encoder,
      grid.r, grid.xin, grid.b, grid.mask,
      grid.dx, grid.dy, grid.dz,
      grid.size,
    );
  }
}
