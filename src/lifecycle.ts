type LifecycleCallback<T> = (...args: Parameters<T>) => void;

export enum LifecycleBehavior {
	Series,
	Concurrent,
}

export class Lifecycle<T extends LifecycleCallback<T>> {
	private callbacks: T[] = [];
	private onRegisteredCallbacks: ((c: T) => void)[] = [];
	private onUnregisteredCallbacks: ((c: T) => void)[] = [];
	constructor(behavior: LifecycleBehavior = LifecycleBehavior.Series) {
		switch (behavior) {
			case LifecycleBehavior.Series:
				this.fire = this.fireSeries;
				break;
			case LifecycleBehavior.Concurrent:
				this.fire = this.fireConcurrent;
				break;
		}
	}
	private callOnUnregisteredCallbacks(callback: T) {
		for (const onUnregistered of this.onUnregisteredCallbacks) {
			onUnregistered(callback);
		}
	}
	private fireConcurrent(...args: Parameters<T>) {
		for (const callback of this.callbacks) {
			task.spawn(callback, ...args);
		}
	}
	private fireSeries(...args: Parameters<T>) {
		for (const callback of this.callbacks) {
			callback(...args);
		}
	}
	fire(...args: Parameters<T>): void {}
	register(callback: T) {
		this.callbacks.push(callback);
		for (const onRegistered of this.onRegisteredCallbacks) {
			onRegistered(callback);
		}
	}
	unregister(callback: T) {
		const index = this.callbacks.indexOf(callback);
		if (index === -1) return;
		this.callbacks.unorderedRemove(index);
		this.callOnUnregisteredCallbacks(callback);
	}
	unregisterAll() {
		for (const callback of this.callbacks) {
			this.callOnUnregisteredCallbacks(callback);
		}
		this.callbacks.clear();
	}
	onRegistered(callback: (c: T) => void) {
		this.onRegisteredCallbacks.push(callback);
		return () => {
			const index = this.onRegisteredCallbacks.indexOf(callback);
			if (index === -1) return;
			this.onRegisteredCallbacks.unorderedRemove(index);
		};
	}
	onUnregistered(callback: (c: T) => void) {
		this.onUnregisteredCallbacks.push(callback);
		return () => {
			const index = this.onUnregisteredCallbacks.indexOf(callback);
			if (index === -1) return;
			this.onUnregisteredCallbacks.unorderedRemove(index);
		};
	}
}

export function OnLifecycle<T extends LifecycleCallback<T>>(lifecycle: Lifecycle<T>) {
	return (
		target: InferThis<(this: defined, ...args: Parameters<T>) => void>,
		property: string,
		descriptor: TypedPropertyDescriptor<(this: defined, ...args: Parameters<T>) => void>,
	) => {
		lifecycle.register(((...args: Parameters<T>) => {
			descriptor.value(target, ...args);
		}) as T);
	};
}
