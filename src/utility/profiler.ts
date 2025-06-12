export class Timer {
  start_ms: number;
  end_ms?: number;

  constructor() {
    this.start_ms = performance.now();
  }

  get_current_elapsed(): number {
    this.end_ms = performance.now();
    const elapsed_ms = this.end_ms-this.start_ms;
    return elapsed_ms*1e-3;
  }
}

export class ProfilerTrace {
  label?: string;
  description?: string;
  start_ms: number;
  _end_ms?: number;
  sub_traces: ProfilerTrace[];

  constructor(label?: string, description?: string) {
    this.label = label;
    this.description = description;
    this.start_ms = performance.now();
    this.sub_traces = [];
  }

  begin() {
    this.start_ms = performance.now();
  }

  end() {
    const end_ms = performance.now();
    if (this._end_ms !== undefined) {
      throw Error(`Tried to end trace ${this.label} twice. Once at ${this.end_ms} and another at ${end_ms}`);
    }
    this._end_ms = end_ms;
  }

  get elapsed_ms(): number {
    if (this._end_ms === undefined) {
      throw Error(`Cannot get elapsed duration of trace ${this.label} that has not ended yet`);
    }
    return this._end_ms-this.start_ms;
  }

  get end_ms(): number {
    if (this._end_ms === undefined) {
      throw Error(`Cannot get end of trace ${this.label} that has not ended yet`);
    }
    return this._end_ms;
  }

  is_ended(): boolean {
    return this._end_ms !== undefined;
  }
}

function get_last_child(trace: ProfilerTrace): ProfilerTrace | undefined {
  const children = trace.sub_traces;
  const N = children.length;
  if (N <= 0) return undefined;
  return children[N-1];
}

export class Profiler {
  root_trace: ProfilerTrace;
  stack: ProfilerTrace[];
  strict: boolean; // throw error if on malformed trace

  constructor(root_label?: string) {
    this.root_trace = new ProfilerTrace(root_label ?? "root");
    this.stack = [this.root_trace];
    this.strict = false;
  }

  handle_error(error: string) {
    if (this.strict) {
      throw Error(error);
    } else {
      console.error(error);
    }
  }

  begin(label?: string, description?: string) {
    const child = new ProfilerTrace(label, description)
    if (this.stack.length <= 0) {
      this.handle_error("Tried to begin trace in profiler after it was terminated");
      return;
    }
    const parent = this.stack[this.stack.length-1];
    const last_child = get_last_child(parent);
    if (last_child && !last_child.is_ended()) {
      this.handle_error(`Tried to push new scope ${label} without ending last sibling trace ${last_child.label}`);
      last_child.end();
    }
    parent.sub_traces.push(child);
    this.stack.push(child);
  }

  rebase_current() {
    if (this.stack.length <= 0) {
      this.handle_error("Tried to rebase trace in profiler after it was terminated");
      return;
    }
    const trace = this.stack[this.stack.length-1];
    trace.begin();
  }

  end() {
    if (this.stack.length <= 0) {
      this.handle_error("Tried to end trace in profiler after it was terminated");
      return;
    }
    const parent = this.stack[this.stack.length-1];
    parent.end();
    const last_child = get_last_child(parent);
    if (last_child && !last_child.is_ended()) {
      this.handle_error(`Tried to end parent trace ${parent.label} without ending last child trace ${last_child.label}`);
      last_child.end();
    }
    this.stack.pop();
  }

  end_all() {
    while (this.stack.length > 0) {
      this.end();
    }
  }

  is_ended() {
    return this.stack.length <= 0;
  }
}
