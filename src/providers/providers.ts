import { inject, type Ref } from "vue";
import { ToastManager } from "./toast/toast.ts";

export const providers = {
  get toast_manager(): Ref<ToastManager> {
    const value = inject<Ref<ToastManager>>("toast_manager");
    if (value === undefined) throw Error("Expected toast_manager to be injected from provider");
    return value;
  },
  get gpu_device(): Ref<GPUDevice> {
    const value = inject<Ref<GPUDevice | undefined>>("gpu_device");
    if (value === undefined) throw Error("Expected gpu_device to be injected from provider");
    if (value.value === undefined) throw Error("gpu_device has not been initialised yet");
    return value as Ref<GPUDevice>;
  },
  get gpu_adapter(): Ref<GPUAdapter> {
    const value = inject<Ref<GPUAdapter | undefined>>("gpu_adapter");
    if (value === undefined) throw Error("Expected gpu_adapter to be injected from provider");
    if (value.value === undefined) throw Error("gpu_adapter has not been initialised yet");
    return value as Ref<GPUAdapter>;
  },
}
