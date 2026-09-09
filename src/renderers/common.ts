import { StructView, type StructFieldType } from "../utility/cstyle_struct";
import { get_dtype_size, type NdarrayType } from "../utility/ndarray.ts";
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
