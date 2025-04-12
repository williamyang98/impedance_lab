import { Ndarray } from "./ndarray.ts";
import {
  KernelCurrentSource,
  KernelUpdateElectricField,
  KernelUpdateMagneticField,
  KernelCopyToTexture,
  ShaderRenderTexture,
} from "./kernels.ts";

export class SimulationGrid {
  size: [number, number, number];
  total_cells: number;
  init_e_field: Ndarray;
  init_h_field: Ndarray;
  init_sigma_k: Ndarray;
  init_epsilon_k: Ndarray;
  init_mu_k: number;
  init_d_xyz: number;
  init_dt: number;

  bake_a0: Ndarray;
  bake_a1: Ndarray;
  bake_b0: number;

  constructor(size: [number, number, number]) {
    this.size = size;
    this.total_cells = size.reduce((a,b) => a*b, 1);
    const total_dims = 3;

    this.init_e_field = Ndarray.create_zeros([...size, total_dims], "f32");
    this.init_h_field = Ndarray.create_zeros([...size, total_dims], "f32");
    this.init_sigma_k = Ndarray.create_zeros(size, "f32");
    this.init_epsilon_k = Ndarray.create_zeros(size, "f32");
    this.init_mu_k = 1;
    this.init_d_xyz = 1;
    this.init_dt = 1;

    this.bake_a0 = Ndarray.create_zeros(size, "f32");
    this.bake_a1 = Ndarray.create_zeros(size, "f32");
    this.bake_b0 = 0;
  }

  bake() {
    // a0 = 1/(1+sigma_k/e_k*dt)
    // a1 = 1/(e_k*d_xyz) * dt
    // b0 = 1/(mu_k*d_xyz) * dt
    const dt = this.init_dt;
    const d_xyz = this.init_d_xyz;
    const epsilon_0 = 8.85e-12;
    const mu_0 = 1.26e-6;
    const mu_k = this.init_mu_k*mu_0;

    const [Nx,Ny,Nz] = this.size;
    for (let x = 0; x < Nx; x++) {
      for (let y = 0; y < Ny; y++) {
        for (let z = 0; z < Nz; z++) {
          const i = [x,y,z];
          const epsilon_k = this.init_epsilon_k.get(i)*epsilon_0;
          const sigma_k = this.init_sigma_k.get(i);
          const a0 = 1/(1+sigma_k/epsilon_k*dt);
          const a1 = dt/(epsilon_k*d_xyz);
          this.bake_a0.set(i, a0);
          this.bake_a1.set(i, a1);
        }
      }
    }
    this.bake_b0 = dt/(mu_k*d_xyz);
  }
}

export class SimulationSource {
  signal: number[] = [];
  offset: [number, number, number] = [0,0,0];
  size: [number, number, number] = [0,0,0];
}

export interface SimulationSetup {
  grid: SimulationGrid;
  sources: SimulationSource[];
}

export const create_simulation_setup = (): SimulationSetup => {
  const grid_size: [number, number, number] = [16,128,256];
  const grid = new SimulationGrid(grid_size);

  const [Nx,Ny,Nz] = grid_size;
  grid.init_dt = 1e-12;
  grid.init_d_xyz = 1e-3;
  grid.init_epsilon_k.fill(1.0);
  grid.init_sigma_k.fill(0.0);
  grid.init_mu_k = 1.0;

  const plane_height = 1;
  const plane_border = 20;
  const signal_height = 1;
  // let signal_width = 10;
  const signal_width = 20;
  const separation_height = 5;
  const x_start = Math.floor(Nx/2 - (plane_height+separation_height+signal_height)/2);
  // ground plane
  grid.init_sigma_k
    .lo([x_start, plane_border, plane_border])
    .hi([plane_height, Ny-plane_border*2, Nz-plane_border*2])
    .fill(1e8);
  // dielectric
  grid.init_epsilon_k
    .lo([x_start+plane_height, plane_border, plane_border])
    .hi([separation_height, Ny-plane_border*2, Nz-plane_border*2])
    .fill(4.1);
  // single ended transmission line
  grid.init_sigma_k
    .lo([x_start+plane_height+separation_height, Math.floor(Ny/2-signal_width/2), plane_border])
    .hi([signal_height, signal_width, Nz-plane_border*2])
    .fill(1e8);
  // source
  const source = new SimulationSource();
  const period = 256;
  for (let i = 0; i < period; i++) {
    const dt = Math.PI*i/period;
    const amplitude = Math.sin(dt)**2;
    source.signal.push(amplitude);
  }
  source.offset = [x_start+plane_height, Math.floor(Ny/2-signal_width/2), Math.floor(Nz/2)];
  source.size = [separation_height, signal_width, 1];
  // terminator resistors
  {
    // let resistance = 78.338/2; // w=10
    const resistance = 53.864/2; // w=20
    const thickness = 1;
    const area = (signal_width*grid.init_d_xyz)*(thickness*grid.init_d_xyz);
    const length = separation_height*grid.init_d_xyz;
    const sigma = length/(resistance*area);
    grid.init_sigma_k
      .lo([x_start+plane_height,Math.floor(Ny/2-signal_width/2),plane_border])
      .hi([separation_height,signal_width,thickness])
      .fill(sigma);
    grid.init_sigma_k
      .lo([x_start+plane_height, Math.floor(Ny/2-signal_width/2), Nz-plane_border-thickness])
      .hi([separation_height, signal_width, thickness])
      .fill(sigma);
  }

  grid.bake();
  return {
    grid,
    sources: [source],
  };
};

export class GpuFdtdEngine {
  canvas_context: GPUCanvasContext;
  adapter: GPUAdapter;
  device: GPUDevice;
  setup: SimulationSetup;

  e_field: GPUBuffer;
  h_field: GPUBuffer;
  bake_a0: GPUBuffer;
  bake_a1: GPUBuffer;
  bake_b0: number;

  display_texture: GPUTexture;
  display_texture_view: GPUTextureView;

  kernel_current_source: KernelCurrentSource;
  kernel_update_e_field: KernelUpdateElectricField;
  kernel_update_h_field: KernelUpdateMagneticField;
  kernel_copy_to_texture: KernelCopyToTexture;
  shader_render_texture: ShaderRenderTexture;

  constructor(canvas_context: GPUCanvasContext, adapter: GPUAdapter, device: GPUDevice, setup: SimulationSetup) {
    this.canvas_context = canvas_context;
    this.adapter = adapter;
    this.device = device;
    this.setup = setup;

    const create_from_ndarray = (arr: Ndarray): GPUBuffer => {
      const buffer = device.createBuffer({
        size: arr.data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      device.queue.writeBuffer(buffer, 0, arr.data, 0, arr.data.length);
      return buffer;
    };

    this.e_field = create_from_ndarray(setup.grid.init_e_field);
    this.h_field = create_from_ndarray(setup.grid.init_h_field);
    this.bake_a0 = create_from_ndarray(setup.grid.bake_a0);
    this.bake_a1 = create_from_ndarray(setup.grid.bake_a1);
    this.bake_b0 = setup.grid.bake_b0;

    const [_Nx,Ny,Nz] = setup.grid.size;
    canvas_context.configure({
      device: device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: "premultiplied",
    });
    this.display_texture = device.createTexture({
      dimension: "2d",
      format: "rgba8unorm",
      mipLevelCount: 1,
      sampleCount: 1,
      size: [Nz, Ny, 1],
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.display_texture_view = this.display_texture.createView({ dimension: "2d" });

    const source_workgroup_size: [number, number, number] = [16,16,1];
    const grid_workgroup_size: [number, number, number] = [1,1,256];
    const texture_copy_workgroup_size: [number, number] = [1, 256];
    this.kernel_current_source = new KernelCurrentSource(source_workgroup_size, device);
    this.kernel_update_e_field = new KernelUpdateElectricField(grid_workgroup_size, device);
    this.kernel_update_h_field = new KernelUpdateMagneticField(grid_workgroup_size, device);
    this.kernel_copy_to_texture = new KernelCopyToTexture(texture_copy_workgroup_size, device);
    this.shader_render_texture = new ShaderRenderTexture(device);
  }

  step_fdtd(timestep: number) {
    const command_encoder = this.device.createCommandEncoder();
    const grid_size = this.setup.grid.size;
    for (const source of this.setup.sources) {
      if (timestep < source.signal.length) {
        const e0 = source.signal[timestep];
        this.kernel_current_source.create_pass(command_encoder, this.e_field, e0, grid_size, source.offset, source.size);
      }
    }
    this.kernel_update_e_field.create_pass(command_encoder, this.e_field, this.h_field, this.bake_a0, this.bake_a1, grid_size);
    this.kernel_update_h_field.create_pass(command_encoder, this.h_field, this.e_field, this.bake_b0, grid_size);
    this.device.queue.submit([command_encoder.finish()]);
  }

  async update_display() {
    const grid_size = this.setup.grid.size;
    const [Nx,_Ny,_Nz] = grid_size;

    const command_encoder = this.device.createCommandEncoder();
    const copy_x = Math.floor(Nx/2);
    const scale = 10**(-0.3);
    const axis_mode = 0;
    this.kernel_copy_to_texture.create_pass(
      command_encoder,
      this.e_field, this.display_texture_view, grid_size,
      copy_x, scale, axis_mode,
    );
    // NOTE: canvas texture view has to be retrieved here since the browser swaps it out in the swapchain
    const canvas_texture_view = this.canvas_context.getCurrentTexture().createView();
    this.shader_render_texture.create_pass(command_encoder, canvas_texture_view, this.display_texture_view);
    this.device.queue.submit([command_encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
  }
}
