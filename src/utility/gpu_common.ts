import { get_dtype_size, Ndarray, type NdarrayType } from "../utility/ndarray.ts";
import { type Vec2 } from "../utility/dim_types";
import * as cstruct from "../utility/cstruct.ts";

export interface GpuRenderTexture {
  texture: GPUTexture;
  texture_view: GPUTextureView;
  size: Vec2<number>;
}

const Matrix3x3f =
  cstruct.matrix(cstruct.primitive("f32"), [3,4]) // each row padded with extra 4 bytes
  .layout()
  .gpu_buffer();

export class GpuCamera2D {
  mat3x3f: InstanceType<typeof Matrix3x3f>;
  view: {
    aspect_ratio: number;
    zoom: number;
    offset: Vec2<number>;
  };

  constructor(device: GPUDevice) {
    this.mat3x3f = new Matrix3x3f(device);
    this.view = {
      aspect_ratio: 1.0,
      zoom: 1.0,
      offset: { x: 0.0, y: 0.0 },
    };
  }

  get gpu_buffer(): GPUBuffer {
    return this.mat3x3f.gpu_buffer;
  }

  get array_buffer(): ArrayBuffer {
    return this.mat3x3f.array_buffer;
  }

  write_to_gpu() {
    // x' = H/W * z*(x + x0) = H/W*z*x + H/W*z*x0
    // y' = z*(y+y0) = z*y + z*y0
    // [x', y', 1.0] = A * [x, y, 1.0]
    const view = this.view;
    const mvp = this.mat3x3f.view;
    mvp[0][0] = view.zoom/view.aspect_ratio;
    mvp[0][2] = view.zoom/view.aspect_ratio*view.offset.x;
    mvp[1][1] = view.zoom;
    mvp[1][2] = view.zoom*view.offset.y;
    mvp[2][2] = 1.0;
    this.mat3x3f.write_to_gpu();
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
  device: GPUDevice;
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
    this.device = device;
    this.data = data;
    this.dtype = dtype;
    this.shape = shape;
  }
}

export async function read_gpu_buffer_through_readback(gpu: NdGpuArray, cpu: Ndarray, readback_buffer: GPUBuffer) {
  const required_usage_flags = GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;
  const provided_usage_flags = readback_buffer.usage & required_usage_flags;
  if (provided_usage_flags !== required_usage_flags) {
    throw Error(`Expected readback buffer to have usage flags ${required_usage_flags} but got ${provided_usage_flags}`);
  }

  const device = gpu.device;
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
  if (readback_buffer.size < total_bytes) {
    throw Error(`Readback buffer of size ${readback_buffer.size} bytes is too small to copy gpu buffer of sise ${total_bytes}`);
  }

  // copy to readback buffer
  const command_encoder = device.createCommandEncoder();
  command_encoder.copyBufferToBuffer(gpu.data, 0, readback_buffer, 0, total_bytes);
  device.queue.submit([command_encoder.finish()]);
  // map readback to cpu buffer
  await readback_buffer.mapAsync(GPUMapMode.READ);
  const mapped_view = readback_buffer.getMappedRange();
  const dst_view = new Uint8Array(cpu.data.buffer, 0, total_bytes);
  const src_view = new Uint8Array(mapped_view, 0, total_bytes);
  dst_view.set(src_view);
  readback_buffer.unmap();
}
