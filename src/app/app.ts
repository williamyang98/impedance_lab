import { Ndarray } from "./ndarray.ts";
import {
  KernelCurrentSource,
  KernelUpdateElectricField,
  KernelUpdateMagneticField,
  KernelCopyToTexture,
  ShaderRenderTexture,
} from "./kernels.ts";

type Elements = {
  canvas_context: GPUCanvasContext;
  on_update: (curr_step: number, total_steps: number, time_taken: number, total_cells: number) => void;
};

let run_app = async (elements: Elements) => {
  if (!navigator.gpu) {
    throw Error("WebGPU not supported.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw Error("Couldn't request WebGPU adapter.");
  }

  const device = await adapter.requestDevice();

  let grid_size: [number, number, number] = [16,128,256];
  let [Nx,Ny,Nz] = grid_size;

  let total_cells = grid_size.reduce((a,b) => a*b, 1);
  let total_dims = 3;

  let cpu_E = Ndarray.create_zeros([...grid_size, total_dims], "f32");
  let cpu_H = Ndarray.create_zeros([...grid_size, total_dims], "f32");
  let cpu_A0 = Ndarray.create_zeros(grid_size, "f32");
  let cpu_A1 = Ndarray.create_zeros(grid_size, "f32");
  var cpu_b0 = 0;
  // a0 = 1/(1+sigma_k/e_k*dt)
  // a1 = 1/(e_k*d_xyz) * dt
  // b0 = 1/(mu_k*d_xyz) * dt

  let e_0 = 8.85e-12;
  let mu_0 = 1.26e-6;
  let dt = 1e-12;
  let d_xyz = 1e-3;

  let sigma_k = Ndarray.create_zeros(grid_size, "f32");
  let e_k = Ndarray.create_zeros(grid_size, "f32");
  e_k.fill(e_0);
  let mu_k = mu_0;

  var source_signal: number[] = [];
  var source_size: [number, number, number] = [0,0,0];
  var source_offset: [number, number, number] = [0,0,0];

  {
    let plane_height = 1;
    let plane_border = 20;
    let signal_height = 1;
    //let signal_width = 10;
    let signal_width = 20;
    let separation_height = 5;
    let x_start = 4;
    // ground plane
    sigma_k.lo([x_start,plane_border,plane_border]).hi([plane_height,Ny-plane_border*2,Nz-plane_border*2]).fill(1e8);
    // dielectric
    e_k.lo([x_start+plane_height,plane_border,plane_border]).hi([separation_height,Ny-plane_border*2,Nz-plane_border*2]).fill(e_0*4.1);
    // single ended transmission line
    sigma_k.lo([x_start+plane_height+separation_height,Math.floor(Ny/2-signal_width/2),plane_border]).hi([signal_height,signal_width,Nz-plane_border*2]).fill(1e8);
    // source
    source_offset = [x_start+plane_height,Math.floor(Ny/2-signal_width/2),Math.floor(Nz/2)];
    source_size = [separation_height,signal_width,1];
    source_signal = [];
    {
      let period = 256;
      for (let i = 0; i < period; i++) {
        let dt = Math.PI*i/period;
        let amplitude = Math.sin(dt)**2;
        source_signal.push(amplitude);
      }
    }
    // terminator resistors
    {
      //let resistance = 78.338/2; // w=10
      let resistance = 53.864/2; // w=20
      let thickness = 1;
      let area = (signal_width*d_xyz)*(thickness*d_xyz);
      let length = separation_height*d_xyz;
      let sigma = length/(resistance*area);
      sigma_k.lo([x_start+plane_height,Math.floor(Ny/2-signal_width/2),plane_border]).hi([separation_height,signal_width,thickness]).fill(sigma);
      sigma_k.lo([x_start+plane_height,Math.floor(Ny/2-signal_width/2),Nz-plane_border-thickness]).hi([separation_height,signal_width,thickness]).fill(sigma);
    }
  }

  for (let x = 0; x < Nx; x++) {
    for (let y = 0; y < Ny; y++) {
      for (let z = 0; z < Nz; z++) {
        let i = [x,y,z];
        cpu_A0.set(i, 1/(1+sigma_k.get(i)/e_k.get(i)*dt));
        cpu_A1.set(i, dt/(e_k.get(i)*d_xyz));
      }
    }
  }
  cpu_b0 = dt/(mu_k*d_xyz);

  let gpu_E = device.createBuffer({
    size: cpu_E.data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  let gpu_H = device.createBuffer({
    size: cpu_H.data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  let gpu_A0 = device.createBuffer({
    size: cpu_A0.data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  let gpu_A1 = device.createBuffer({
    size: cpu_A1.data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  let gpu_E_readback = device.createBuffer({
    size: cpu_E.data.byteLength,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  let gpu_b0 = cpu_b0;
  device.queue.writeBuffer(gpu_A0, 0, cpu_A0.data, 0, cpu_A0.data.length);
  device.queue.writeBuffer(gpu_A1, 0, cpu_A1.data, 0, cpu_A1.data.length);

  elements.canvas_context.configure({
    device: device,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: "premultiplied",
  });
  let gpu_display_texture = device.createTexture({
    dimension: "2d",
    format: "rgba8unorm",
    mipLevelCount: 1,
    sampleCount: 1,
    size: [Nz, Ny, 1],
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  let gpu_display_texture_view = gpu_display_texture.createView({ dimension: "2d" });

  let source_workgroup_size: [number, number, number] = [16,16,1];
  let grid_workgroup_size: [number, number, number] = [1,1,256];
  let texture_copy_workgroup_size: [number, number] = [1, 256];

  let kernel_current_source = new KernelCurrentSource(source_workgroup_size, device);
  let kernel_update_e_field = new KernelUpdateElectricField(grid_workgroup_size, device);
  let kernel_update_h_field = new KernelUpdateMagneticField(grid_workgroup_size, device);
  let kernel_copy_to_texture = new KernelCopyToTexture(texture_copy_workgroup_size, device);
  let shader_render_texture = new ShaderRenderTexture(device);

  let update_description = (curr_step: number, total_steps: number, ms_start: number) => {
    let ms_end = performance.now();
    let ms_elapsed = ms_end-ms_start;
    elements.on_update(curr_step, total_steps, ms_elapsed*1e-3, total_cells);
  };

  {
    let ms_start = performance.now();
    let total_steps = 8192;
    for (let i = 0; i < total_steps; i++) {
      const command_encoder = device.createCommandEncoder();
      if (i < source_signal.length) {
        let e0 = source_signal[i];
        kernel_current_source.create_pass(command_encoder, gpu_E, e0, grid_size, source_offset, source_size);
      }
      kernel_update_e_field.create_pass(command_encoder, gpu_E, gpu_H, gpu_A0, gpu_A1, grid_size);
      kernel_update_h_field.create_pass(command_encoder, gpu_H, gpu_E, gpu_b0, grid_size);
      device.queue.submit([command_encoder.finish()]);

      if (i % 128 == 0) {
        const command_encoder = device.createCommandEncoder();
        let copy_x = Math.floor(Nx/2);
        let scale = 10**(-0.3);
        let axis_mode = 0;
        kernel_copy_to_texture.create_pass(command_encoder, gpu_E, gpu_display_texture_view, grid_size, copy_x, scale, axis_mode);
        // NOTE: canvas texture view has to be retrieved here since the browser swaps it out in the swapchain
        let canvas_texture_view = elements.canvas_context.getCurrentTexture().createView();
        shader_render_texture.create_pass(command_encoder, canvas_texture_view, gpu_display_texture_view);
        device.queue.submit([command_encoder.finish()]);
        await device.queue.onSubmittedWorkDone();

        update_description(i+1, total_steps, ms_start);
      }
    }
    await device.queue.onSubmittedWorkDone();
    update_description(total_steps, total_steps, ms_start);
  }
};

export default run_app;
