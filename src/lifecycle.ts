type LifecycleCallback<T> = (...args: Parameters<T>) => void;

/**
 * The execution behavior of a custom lifecycle.
 */
export enum LifecycleBehavior {
	/**
	 * Execute the lifecycle callbacks one-by-one.
	 */
	Series,

	/**
	 * Execute the lifecycle callbacks all at the same
	 * time. This calls the callbacks using `task.spawn`
	 * internally.
	 */
	Concurrent,
}

/**
 * Custom lifecycle for Proton providers.
 */
export class Lifecycle<T extends LifecycleCallback<T>> {
	private callbacks: T[] = [];
	private onRegisteredCallbacks: ((c: T) => void)[] = [];
	private onUnregisteredCallbacks: ((c: T) => void)[] = [];

	/**
	 * Constructs a new lifecycle
	 * @param behavior Execution behavior (defaults to `LifecycleBehavior.Concurrent`)
	 */
	constructor(behavior: LifecycleBehavior = LifecycleBehavior.Concurrent) {
		switch (behavior) {
			case LifecycleBehavior.Series:
				this.fire = this.fireSeries;
				break;
			case LifecycleBehavior.Concurrent:
				this.fire = this.fireConcurrent;
				break;
		}
	}

	private callOnUnregisteredCallbacks(callback: T): void {
		for (const onUnregistered of this.onUnregisteredCallbacks) {
			onUnregistered(callback);
		}
	}

	private fireConcurrent(...args: Parameters<T>): void {
		for (const callback of this.callbacks) {
			task.spawn(callback, ...args);
		}
	}

	private fireSeries(...args: Parameters<T>): void {
		for (const callback of this.callbacks) {
			callback(...args);
		}
	}

	/**
	 * Fire the lifecycle.
	 * @param args Arguments passed to the registered callbacks.
	 */
	fire(...args: Parameters<T>): void {}

	/**
	 * Register a lifecycle. This is usually only called from
	 * the `@OnLifecycle` decorator.
	 * @param callback Callback
	 */
	register(callback: T): void {
		this.callbacks.push(callback);
		for (const onRegistered of this.onRegisteredCallbacks) {
			onRegistered(callback);
		}
	}

	/**
	 * Unregister a lifecycle.
	 * @param callback Callback to unregister
	 */
	unregister(callback: T): void {
		const index = this.callbacks.indexOf(callback);
		if (index === -1) return;
		this.callbacks.unorderedRemove(index);
		this.callOnUnregisteredCallbacks(callback);
	}

	/**
	 * Unregister all callbacks.
	 */
	unregisterAll(): void {
		for (const callback of this.callbacks) {
			this.callOnUnregisteredCallbacks(callback);
		}
		this.callbacks.clear();
	}

	/**
	 * Listen to when a callback is registered.
	 * @param callback Registered callback.
	 * @returns `() => void` cleanup function (call to stop listening to `onRegistered`)
	 */
	onRegistered(callback: (c: T) => void) {
		this.onRegisteredCallbacks.push(callback);
		return () => {
			const index = this.onRegisteredCallbacks.indexOf(callback);
			if (index === -1) return;
			this.onRegisteredCallbacks.unorderedRemove(index);
		};
	}

	/**
	 * Listen to when a callback is unregistered.
	 * @param callback Unregistered callback.
	 * @returns `() => void` cleanup function (call to stop listening to `onUnregistered`)
	 */
	onUnregistered(callback: (c: T) => void) {
		this.onUnregisteredCallbacks.push(callback);
		return () => {
			const index = this.onUnregisteredCallbacks.indexOf(callback);
			if (index === -1) return;
			this.onUnregisteredCallbacks.unorderedRemove(index);
		};
	}
}

/**
 * OnLifecycle decorator.
 * @param lifecycle Attached lifecycle
 */
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
