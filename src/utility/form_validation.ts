export type InstanceKey<T,V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];

export type NumberValidator<V extends (number | undefined) = number> = (value: V, min?: number, max?: number, step?: number) => void;

export interface FormField {
  get is_valid(): boolean;
}

export class NumberField<T,V extends (number | undefined) = number> implements FormField {
  instance: T;
  key: InstanceKey<T,V>;
  validator?: NumberValidator<V>;
  name?: string;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
  _value?: V;

  constructor(
    instance:T, key: InstanceKey<T,V>,
    name?: string, min?: number, max?: number, step?: number,
    validator?: NumberValidator<V>,
  ) {
    this.instance = instance;
    this.name = name;
    this.key = key;
    this.min = min;
    this.max = max;
    this.step = step;
    this.validator = validator;
    this._value = instance[this.key] as V;
  }

  set value(value: V) {
    this._value = value;
    try {
      this.validator?.(value, this.min, this.max, this.step);
      this.instance[this.key] = value as T[typeof this.key];
      this.error = undefined;
    } catch (error) {
      this.error = (error as Error).message;
    }
  }

  get value(): V | undefined {
    return this._value;
  }

  get is_valid(): boolean {
    return this.error === undefined;
  }
}

export function integer_validator(value: number, min?: number, max?: number, _step?: number) {
  if (typeof(value) !== 'number') throw Error("Field is required");
  if (Number.isNaN(value)) throw Error("Field is required");
  if (!Number.isInteger(value)) throw Error("Must be an integer");
  if (min !== undefined && value < min) throw Error(`Must be greater than or equal to ${min}`);
  if (max !== undefined && value > max) throw Error(`Must be less than or equal to ${max}`);
};

export function float_validator(value: number, min?: number, max?: number, _step?: number) {
  if (typeof(value) !== 'number') throw Error("Field is required");
  if (Number.isNaN(value)) throw Error("Field is required");
  if (min !== undefined && value < min) throw Error(`Must be greater than or equal to ${min}`);
  if (max !== undefined && value > max) throw Error(`Must be less than or equal to ${max}`);
}
