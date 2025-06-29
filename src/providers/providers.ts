import { inject, type Ref, type ComputedRef } from "vue";
import { ToastManager } from "./toast/toast.ts";

export const providers = {
  get toast_manager(): Ref<ToastManager> {
    const value = inject<Ref<ToastManager>>("toast_manager");
    if (value === undefined) throw Error("Expected toast_manager to be injected from provider");
    return value;
  },
  get gpu_device(): ComputedRef<GPUDevice> {
    const value = inject<ComputedRef<GPUDevice>>("gpu_device");
    if (value === undefined) throw Error("Expected gpu_device to be injected from provider");
    return value;
  },
  get gpu_adapter(): ComputedRef<GPUAdapter> {
    const value = inject<ComputedRef<GPUAdapter>>("gpu_adapter");
    if (value === undefined) throw Error("Expected gpu_adapter to be injected from provider");
    return value;
  },
}
