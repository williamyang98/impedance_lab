import { StructView, type StructFieldType } from "../utility/cstyle_struct";
import { get_dtype_size, Ndarray, type NdarrayType } from "../utility/ndarray.ts";
import { type Vec2 } from "../utility/dim_types";

export interface GpuRenderTexture {
  texture: GPUTexture;
  texture_view: GPUTextureView;
  size: Vec2<number>;
}

export class GpuUniform<T extends Record<string, StructFieldType | StructFieldType[]>> {
  device: GPUDevice;
  cpu: StructView<T>;
  gpu: GPUBuffer;

  constructor(device: GPUDevice, fields: T) {
    this.device = device;
    this.cpu = new StructView(fields);
    this.gpu = device.createBuffer({
      size: this.cpu.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  write_to_gpu() {
    this.device.queue.writeBuffer(this.gpu, 0, this.cpu.buffer, 0, this.cpu.buffer.byteLength);
  }
}

export class GpuCamera2D {
  device: GPUDevice;
  cpu: {
    aspect_ratio: number;
    zoom: number;
    offset: Vec2<number>;
  };
  cpu_buffer: Ndarray;
  gpu: GPUBuffer;

  constructor(device: GPUDevice) {
    this.device = device;
    this.cpu = {
      aspect_ratio: 1.0,
      zoom: 1.0,
      offset: { x: 0.0, y: 0.0 },
    };
    this.cpu_buffer = Ndarray.create_zeros([3,4], "f32"); // mat3x3<f32> with each row std140 padded to 4 x 4 bytes
    this.gpu = device.createBuffer({
      size: this.cpu_buffer.data.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  write_to_gpu() {
    // x' = H/W * z*(x + x0) = H/W*z*x + H/W*z*x0
    // y' = z*(y+y0) = z*y + z*y0
    // [x', y', 1.0] = A * [x, y, 1.0]
    this.cpu_buffer.fill(0.0);
    this.cpu_buffer.set([0,0], this.cpu.zoom/this.cpu.aspect_ratio);
    this.cpu_buffer.set([0,2], this.cpu.zoom/this.cpu.aspect_ratio*this.cpu.offset.x);

    this.cpu_buffer.set([1,1], this.cpu.zoom);
    this.cpu_buffer.set([1,2], this.cpu.zoom*this.cpu.offset.y);

    this.cpu_buffer.set([2,2], 1.0);

    const cpu = this.cpu_buffer.data;
    this.device.queue.writeBuffer(this.gpu, 0, cpu.buffer, 0, cpu.byteLength);
  }
}

export interface GpuMesh {
  device: GPUDevice;
  vertex_buffer: GPUBuffer;
  index_buffer: GPUBuffer;
  vertex_buffer_layout: GPUVertexBufferLayout;
  index_format: GPUIndexFormat;
  total_indices: number;
}

export function create_square_mesh(device: GPUDevice): GpuMesh {
  const vertices = new Float32Array([
    0.0, 0.0,
    0.0, 1.0,
    1.0, 1.0,
    1.0, 0.0,
  ]);
  const indices = new Uint16Array([
    0, 1, 2,
    0, 2, 3,
  ]);
  const vertex_buffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const index_buffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertex_buffer, 0, vertices, 0, vertices.length);
  device.queue.writeBuffer(index_buffer, 0, indices, 0, indices.length);

  const vertex_buffer_layout: GPUVertexBufferLayout = {
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x2" },
    ],
    arrayStride: 8,
    stepMode: "vertex",
  };
  const index_format: GPUIndexFormat = "uint16";
  const total_indices = indices.length;
  return {
    device,
    vertex_buffer,
    index_buffer,
    vertex_buffer_layout,
    index_format,
    total_indices,
  }
}

export interface ArrowConfig {
  arrow_height: number;
  quiver_width: number;
}

export function create_arrow_mesh(device: GPUDevice, config: ArrowConfig): GpuMesh {
  const vertices = new Float32Array([
    // arrow tip
     0.0, 1.0,
    -1.0, 1.0-config.arrow_height,
     1.0, 1.0-config.arrow_height,
    // quiver body
    -config.quiver_width/2, 1.0-config.arrow_height,
     config.quiver_width/2, 1.0-config.arrow_height,
    -config.quiver_width/2, -1,
     config.quiver_width/2, -1,
  ]);
  const indices = new Uint16Array([
    // arrow tip
    0, 1, 2,
    // quiver body
    3, 4, 5,
    4, 5, 6,
    // padding to align to 4byte boundary
    0,
  ]);
  const vertex_buffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const index_buffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertex_buffer, 0, vertices, 0, vertices.length);
  device.queue.writeBuffer(index_buffer, 0, indices, 0, indices.length);

  const vertex_buffer_layout: GPUVertexBufferLayout = {
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x2" }, // position
    ],
    arrayStride: 8,
    stepMode: "vertex",
  };
  const index_format: GPUIndexFormat = "uint16";
  const total_indices = indices.length;
  return {
    device,
    vertex_buffer,
    index_buffer,
    vertex_buffer_layout,
    index_format,
    total_indices,
  }
}

export class NdGpuArray {
  data: GPUBuffer;
  dtype: NdarrayType;
  shape: number[];

  constructor(device: GPUDevice, shape: number[], dtype: NdarrayType) {
    const elem_size_bytes = get_dtype_size(dtype);
    const total_elements = shape.reduce((a,b) => a*b, 1);
    const byte_length = total_elements*elem_size_bytes;
    const data = device.createBuffer({
      size: byte_length,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.data = data;
    this.dtype = dtype;
    this.shape = shape;
  }
}
