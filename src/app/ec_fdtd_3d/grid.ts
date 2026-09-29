import { AXES_3D, type Vec3 } from "../../utility/dim_types.ts";
import { Ndarray, type NdarrayType } from "../../utility/ndarray.ts";
import { NdGpuArray, read_gpu_buffer_through_readback } from "../../utility/gpu_common.ts";

type Size3D = Vec3<number>;

export class CpuGrid {
  size: Size3D;

  d: Vec3<Ndarray>;
  grid_lines: Vec3<Ndarray>;
  dt: number;

  sigma_k: Ndarray;
  epsilon_r: Ndarray;
  mu_r: Ndarray;

  V: Vec3<Ndarray>;
  I: Vec3<Ndarray>;

  bake_R: Vec3<Ndarray>;
  bake_C: Vec3<Ndarray>;
  bake_L: Vec3<Ndarray>;

  bake_alpha: Vec3<Ndarray>;
  bake_beta: Vec3<Ndarray>;
  bake_phi: Vec3<Ndarray>;

  constructor(size: Size3D) {
    this.size = size;

    this.d = {
      x: Ndarray.create_zeros([size.x], "f32"),
      y: Ndarray.create_zeros([size.y], "f32"),
      z: Ndarray.create_zeros([size.z], "f32"),
    };
    this.grid_lines = {
      x: Ndarray.create_zeros([size.x+1], "f32"),
      y: Ndarray.create_zeros([size.y+1], "f32"),
      z: Ndarray.create_zeros([size.z+1], "f32"),
    };
    this.dt = 1;

    const create_cell_array = (): Ndarray => {
      return Ndarray.create_zeros([size.z,size.y,size.x], "f32");
    };

    const create_edge_arrays = (): Vec3<Ndarray> => {
      return {
        x: Ndarray.create_zeros([size.z+1,size.y+1,size.x], "f32"),
        y: Ndarray.create_zeros([size.z+1,size.y,size.x+1], "f32"),
        z: Ndarray.create_zeros([size.z,size.y+1,size.x+1], "f32"),
      };
    };

    const create_face_arrays = (): Vec3<Ndarray> => {
      return {
        x: Ndarray.create_zeros([size.z,size.y,size.x+1], "f32"),
        y: Ndarray.create_zeros([size.z,size.y+1,size.x], "f32"),
        z: Ndarray.create_zeros([size.z+1,size.y,size.x], "f32"),
      };
    };

    this.sigma_k = create_cell_array();
    this.epsilon_r = create_cell_array();
    this.mu_r = create_cell_array();

    this.V = create_edge_arrays();
    this.I = create_face_arrays();

    // alpha = 1/(1+dt/RC)
    // beta = dt/C
    // phi = dt/L
    this.bake_R = create_edge_arrays();
    this.bake_C = create_edge_arrays();
    this.bake_L = create_face_arrays();
    this.bake_alpha = create_edge_arrays();
    this.bake_beta = create_edge_arrays();
    this.bake_phi = create_face_arrays();
  }

  calculate_minimum_timestep() {
    // https://en.wikipedia.org/wiki/Courant%E2%80%93Friedrichs%E2%80%93Lewy_condition#The_two_and_general_n-dimensional_case
    // satisfy courant criteria
    // Cmax >= dt*sum(ui/xi), u = speed, x = distance
    // Cmax >= dt*(c/dx + c/dy + c/dz)
    // dt <= Cmax/[c*(1/dx+1/dy+1/dz)]
    // For an explicit time marching solver Cmax=1
    // dt <= Cmax/[c*(1/dx+1/dy+1/dz)]
    // dt(max) = Cmax/[c*(1/dx(min)+1/dy(min)+1/dz(min))]
    const dx_min = this.d.x.cast(Float32Array).reduce((a, b) => Math.min(a,b), Infinity);
    const dy_min = this.d.y.cast(Float32Array).reduce((a, b) => Math.min(a,b), Infinity);
    const dz_min = this.d.z.cast(Float32Array).reduce((a, b) => Math.min(a,b), Infinity);
    if (dx_min === 0) throw Error("min(dx) is zero but must have a finite non-zero cell dimension");
    if (dy_min === 0) throw Error("min(dy) is zero but must have a finite non-zero cell dimension");
    if (dz_min === 0) throw Error("min(dz) is zero but must have a finite non-zero cell dimension");
    const Cmax = 0.98; // slightly less than 1 to guarantee stability
    const c = 299792458;
    const k_max = 1/dx_min + 1/dy_min + 1/dz_min;
    const dt_max = Cmax/(c*k_max);
    this.dt = dt_max;
  }
}

function format_size(size: Size3D) {
  return `{x:${size.x},y:${size.y},z:${size.z}}`;
}

function check_shape_match(s0: number[], s1: number[]): boolean {
  if (s0.length !== s1.length) return false;
  for (let i = 0; i < s0.length; i++) {
    if (s0[i] !== s1[i]) return false;
  }
  return true;
}

// raw_materials = cell material
// baked_materials = processed coefficients
export type GpuCopyMode = "voltage" | "current" | "raw_materials" | "baked_materials" | "grid_lines";
export const GPU_COPY_MODES: GpuCopyMode[] = ["voltage", "current", "raw_materials", "baked_materials", "grid_lines"];
type GpuCopyBuffer = {
  type: "vec";
  cpu: Vec3<Ndarray>;
  gpu: Vec3<NdGpuArray>;
} | {
  type: "buffer";
  cpu: Ndarray;
  gpu: NdGpuArray;
};

export class GpuGrid {
  size: Size3D;
  adapter: GPUAdapter;
  device: GPUDevice;

  sigma_k: NdGpuArray;
  epsilon_r: NdGpuArray;
  mu_r: NdGpuArray;
  grid_lines: Vec3<NdGpuArray>;
  d: Vec3<NdGpuArray>;
  V: Vec3<NdGpuArray>;
  I: Vec3<NdGpuArray>;
  bake_R: Vec3<NdGpuArray>;
  bake_C: Vec3<NdGpuArray>;
  bake_L: Vec3<NdGpuArray>;
  bake_alpha: Vec3<NdGpuArray>;
  bake_beta: Vec3<NdGpuArray>;
  bake_phi: Vec3<NdGpuArray>;
  readback: GPUBuffer;

  constructor(adapter: GPUAdapter, device: GPUDevice, size: Size3D) {
    this.adapter = adapter;
    this.device = device;
    this.size = size;

    let max_buffer_size = -Infinity;
    const create_buffer = (shape: number[], dtype: NdarrayType): NdGpuArray => {
      const buffer = new NdGpuArray(device, shape, dtype);
      max_buffer_size = Math.max(max_buffer_size, buffer.data.size);
      return buffer;
    };

    this.grid_lines = {
      x: create_buffer([size.x+1], "f32"),
      y: create_buffer([size.y+1], "f32"),
      z: create_buffer([size.z+1], "f32"),
    };

    this.d = {
      x: create_buffer([size.x], "f32"),
      y: create_buffer([size.y], "f32"),
      z: create_buffer([size.z], "f32"),
    };

    const create_cell_array = (): NdGpuArray => {
      return create_buffer([size.z,size.y,size.x], "f32");
    };

    const create_edge_arrays = (): Vec3<NdGpuArray> => {
      return {
        x: create_buffer([size.z+1,size.y+1,size.x], "f32"),
        y: create_buffer([size.z+1,size.y,size.x+1], "f32"),
        z: create_buffer([size.z,size.y+1,size.x+1], "f32"),
      };
    };

    const create_face_arrays = (): Vec3<NdGpuArray> => {
      return {
        x: create_buffer([size.z,size.y,size.x+1], "f32"),
        y: create_buffer([size.z,size.y+1,size.x], "f32"),
        z: create_buffer([size.z+1,size.y,size.x], "f32"),
      };
    };

    this.sigma_k = create_cell_array();
    this.epsilon_r = create_cell_array();
    this.mu_r = create_cell_array();
    this.V = create_edge_arrays();
    this.I = create_face_arrays();
    this.bake_R = create_edge_arrays();
    this.bake_C = create_edge_arrays();
    this.bake_L = create_face_arrays();
    this.bake_alpha = create_edge_arrays();
    this.bake_beta = create_edge_arrays();
    this.bake_phi = create_face_arrays();

    if (!Number.isFinite(max_buffer_size)) {
      throw Error("Unable to determine maximum buffer size for readback buffer");
    }
    this.readback = device.createBuffer({
      size: max_buffer_size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  get_buffers_from_copy_mode(mode: GpuCopyMode, cpu: CpuGrid): GpuCopyBuffer[] {
    switch (mode) {
    case "voltage": {
        return [
        { type: "vec", cpu: cpu.V, gpu: this.V }
      ];
    };
    case "current": {
      return [
        { type: "vec", cpu: cpu.I, gpu: this.I },
      ];
    };
    case "baked_materials": {
      return [
        { type: "vec", gpu: this.bake_R, cpu: cpu.bake_R },
        { type: "vec", gpu: this.bake_C, cpu: cpu.bake_C },
        { type: "vec", gpu: this.bake_L, cpu: cpu.bake_L },
        { type: "vec", gpu: this.bake_alpha, cpu: cpu.bake_alpha },
        { type: "vec", gpu: this.bake_beta, cpu: cpu.bake_beta },
        { type: "vec", gpu: this.bake_phi, cpu: cpu.bake_phi },
      ]
    };
    case "raw_materials": {
      return [
        { type: "buffer", gpu: this.sigma_k, cpu: cpu.sigma_k },
        { type: "buffer", gpu: this.epsilon_r, cpu: cpu.epsilon_r },
        { type: "buffer", gpu: this.mu_r, cpu: cpu.mu_r },
      ];
    };
    case "grid_lines": {
      return [
        { type: "vec", gpu: this.grid_lines, cpu: cpu.grid_lines },
        { type: "vec", gpu: this.d, cpu: cpu.d },
      ]
    };
    }
  }

  get_buffers_from_copy_modes(modes: Iterable<GpuCopyMode>, cpu: CpuGrid): GpuCopyBuffer[] {
    const buffers: GpuCopyBuffer[] = [];
    for (const mode of modes) {
      const mode_buffers = this.get_buffers_from_copy_mode(mode, cpu);
      for (const buffer of mode_buffers) {
        buffers.push(buffer);
      }
    }
    return buffers;
  }

  copy_from_cpu(cpu: CpuGrid, modes?: Set<GpuCopyMode>) {
    if (cpu.size.x !== this.size.x || cpu.size.y !== this.size.y || cpu.size.z !== this.size.z) {
      throw Error(`Mismatching grid size gpu is ${format_size(this.size)} but cpu was ${format_size(cpu.size)}`);
    }
    const copy_buffer = (gpu: NdGpuArray, cpu: Ndarray) => {
      if (!check_shape_match(gpu.shape, cpu.shape)) {
        throw Error(`Mismatching gpu.shape=[${gpu.shape.join(',')}] with cpu.shape=[${cpu.shape.join(',')}]`);
      }
      this.device.queue.writeBuffer(gpu.data, 0, cpu.data, 0, cpu.data.length);
    };
    const copy_field_buffers = (gpu: Vec3<NdGpuArray>, cpu: Vec3<Ndarray>) => {
      copy_buffer(gpu.x, cpu.x);
      copy_buffer(gpu.y, cpu.y);
      copy_buffer(gpu.z, cpu.z);
    };

    if (modes === undefined) {
      modes = new Set(GPU_COPY_MODES);
    }

    const buffers = this.get_buffers_from_copy_modes(modes, cpu);
    for (const buffer of buffers) {
      switch (buffer.type) {
      case "vec": {
        copy_field_buffers(buffer.gpu, buffer.cpu);
        break;
      }
      case "buffer": {
        copy_buffer(buffer.gpu, buffer.cpu);
        break;
      }
      }
    }
  }

  async copy_to_cpu(cpu: CpuGrid, modes?: Set<GpuCopyMode>) {
    if (cpu.size.x !== this.size.x || cpu.size.y !== this.size.y || cpu.size.z !== this.size.z) {
      throw Error(`Mismatching grid size gpu is ${format_size(this.size)} but cpu was ${format_size(cpu.size)}`);
    }
    const copy_buffer = async (gpu: NdGpuArray, cpu: Ndarray) => {
      if (!check_shape_match(gpu.shape, cpu.shape)) {
        throw Error(`Mismatching gpu.shape=[${gpu.shape.join(',')}] with cpu.shape=[${cpu.shape.join(',')}]`);
      }
      await read_gpu_buffer_through_readback(gpu, cpu, this.readback);
    };
    const copy_field_buffers = async (gpu: Vec3<NdGpuArray>, cpu: Vec3<Ndarray>) => {
      for (const axis of AXES_3D) {
        await copy_buffer(gpu[axis], cpu[axis]);
      }
    };

    if (modes === undefined) {
      modes = new Set(GPU_COPY_MODES);
    }

    const buffers = this.get_buffers_from_copy_modes(modes, cpu);
    for (const buffer of buffers) {
      switch (buffer.type) {
      case "vec": {
        await copy_field_buffers(buffer.gpu, buffer.cpu);
        break;
      }
      case "buffer": {
        await copy_buffer(buffer.gpu, buffer.cpu);
        break;
      }
      }
    }
  }
}
