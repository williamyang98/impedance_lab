import { StructView } from "../../utility/cstyle_struct.ts";

export type BenchmarkType = "f32" | "f16" | "u32" | "i32";

interface BenchmarkComputePipeline {
  shader_source: string;
  shader_module: GPUShaderModule;
  compute_pipeline: GPUComputePipeline;
}

export class KernelBenchmark {
  device: GPUDevice;
  compute_pipelines = new Map<BenchmarkType, BenchmarkComputePipeline>();
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  workgroup_size: number = 256;
  inner_loop_count: number = 512;
  iops_per_loop: number = 4;
  simd_width: number = 4;
  params = new StructView({
    loop_count: "s32",
    init_value: "f32",
  });
  params_uniform: GPUBuffer;

  constructor(device: GPUDevice) {
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({ bindGroupLayouts: [this.bind_group_layout] });
  }

  get_type_size_bytes(type: BenchmarkType): number {
    switch (type) {
      case "f16": return 2;
      case "f32": return 4;
      case "u32": return 4;
      case "i32": return 4;
    }
  }

  get_inner_loop_code(type: BenchmarkType): string {
    switch (type) {
      case "f16": // @fallthrough
      case "f32": {
        return /* wgsl */`
          x = fma(y,x,y);
          y = fma(x,y,x);
        `;
      }
      case "u32": // @fallthrough
      case "i32": {
        return /* wgsl */`
          x = y*x + y;
          y = x*y + x;
        `;
      }
    }
  }

  get_benchmark_pipeline(type: BenchmarkType): BenchmarkComputePipeline {
    let pipeline = this.compute_pipelines.get(type);
    if (pipeline === undefined) {
      const shader_source = /* wgsl */ `
        ${type === 'f16' ? 'enable f16;' : ''}

        struct Params {
          loop_count: i32,
          init_value: f32,
        }

        @group(0) @binding(0) var<uniform> params: Params;
        @group(0) @binding(1) var<storage,read_write> A: array<vec4<${type}>>;

        override workgroup_size = 256;
        override inner_loop_count = 512;

        @compute
        @workgroup_size(workgroup_size,1,1)
        fn main(@builtin(global_invocation_id) _gid: vec3<u32>, @builtin(local_invocation_id) _lid: vec3<u32>) {
          let lid = _lid.x;

          var v = ${type}(params.init_value);
          var x = vec4<${type}>(v, v+1, v+2, v+3);
          var y = vec4<${type}>(${type}(lid));
          for (var iter = 0; iter < params.loop_count; iter++) {
            for (var inner = 0; inner < inner_loop_count; inner++) {
              ${this.get_inner_loop_code(type)}
            }
          }
          let gid = _gid.x;
          A[gid] = y;
        }
      `;
      const shader_module = this.device.createShaderModule({ code: shader_source });
      const compute_pipeline = this.device.createComputePipeline({
        layout: this.pipeline_layout,
        compute: {
          module: shader_module,
          entryPoint: "main",
          constants: {
            workgroup_size: this.workgroup_size,
            inner_loop_count: this.inner_loop_count,
          },
        },
      });
      pipeline = {
        shader_source,
        shader_module,
        compute_pipeline,
      }
      this.compute_pipelines.set(type, pipeline);
    }
    return pipeline;
  }

  get_init_value(type: BenchmarkType): number {
    switch (type) {
      case "f16": return 1.3;
      case "f32": return 1.3;
      case "u32": return 4;
      case "i32": return -2;
    }
  }

  create_pass(
    compute_pass: GPUComputePassEncoder,
    gpu_A: GPUBuffer,
    length: number, type: BenchmarkType,
    loop_count: number,
  ) {
    const dispatch_size = Math.ceil(length/this.workgroup_size/this.simd_width);

    this.params.set("loop_count", loop_count);
    this.params.set("init_value", this.get_init_value(type));
    this.device.queue.writeBuffer(this.params_uniform, 0, this.params.buffer, 0, this.params.buffer.byteLength);

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.params_uniform, offset: 0, size: this.params_uniform.size },
        },
        {
          binding: 1,
          resource: { buffer: gpu_A, offset: 0, size: gpu_A.size },
        },
      ],
    });

    const benchmark_pipeline = this.get_benchmark_pipeline(type);
    compute_pass.setPipeline(benchmark_pipeline.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size, 1, 1);
  }
}
