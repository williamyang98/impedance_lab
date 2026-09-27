
export interface AppGpuFeature {
  name: GPUFeatureName;
  required: boolean;
}

export const app_gpu_features: AppGpuFeature[] = [
  { name: "shader-f16", required: false },
  { name: "timestamp-query", required: true },
];

export async function app_request_gpu_device_from_adapter(adapter: GPUAdapter): Promise<GPUDevice> {
  const requested_features: GPUFeatureName[] = [];
  for (const feature of app_gpu_features) {
    const has_feature = adapter.features.has(feature.name);
    if (!has_feature && feature.required) {
      throw Error(`Adapter is missing required feature: '${feature.name}'`);
    }
    if (has_feature) {
      requested_features.push(feature.name);
    }
  }

  const device = await adapter.requestDevice({
    requiredFeatures: requested_features,
    requiredLimits: {
      maxStorageBuffersPerShaderStage: 16, // for complex shaders and kernels that require many buffers
    },
  });

  return device;
}
