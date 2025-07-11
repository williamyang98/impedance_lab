// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce_animation_frame<T extends (...args: any[]) => void>(fn: T, override?: boolean) {
  override = override ?? false;
  let current_animation_frame: number | null = null;
  return (...args: Parameters<T>) => {
    if (current_animation_frame !== null) {
      if (!override) return;
      cancelAnimationFrame(current_animation_frame);
    }
    current_animation_frame = requestAnimationFrame(() => {
      fn(...args);
      current_animation_frame = null;
    });
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce_animation_frame_async<T extends (...args: any[]) => Promise<void>>(fn: T, override?: boolean) {
  override = override ?? false;
  let current_animation_frame: number | null = null;
  return (...args: Parameters<T>) => {
    if (current_animation_frame !== null) {
      if (!override) return;
      cancelAnimationFrame(current_animation_frame);
    }
    current_animation_frame = requestAnimationFrame(() => {
      fn(...args)
        .then(() => {
          current_animation_frame = null;
        })
        .catch((error) => {
          console.error(`Failed to execute debounced animation frame async function: ${String(error)}`);
        });
    });
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce_timeout<T extends (...args: any[]) => void>(fn: T, timeout_ms: number) {
  let current_timeout: number | null = null;
  return (...args: Parameters<T>) => {
    if (current_timeout !== null) return;
    current_timeout = setTimeout(() => {
      current_timeout = null;
    }, timeout_ms);
    fn(...args);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce_timeout_async<T extends (...args: any[]) => Promise<void>>(fn: T, timeout_ms: number) {
  let current_timeout: number | null = null;
  return (...args: Parameters<T>) => {
    if (current_timeout !== null) return;
    current_timeout = setTimeout(() => {
      current_timeout = null;
    }, timeout_ms);
    void fn(...args);
  }
}
