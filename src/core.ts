const PROVIDER_KEY = "__proton_provider__";

let started = false;
const awaitStartThreads: thread[] = [];
const awaitCallbacks: (() => void)[] = [];

/**
 * Provider decorator.
 */
export function Provider() {
	return <T extends new () => InstanceType<T>>(providerClass: T) => {
		if (started) {
			error("[Proton]: Cannot create provider after Proton has started", 2);
		}
		(providerClass as Record<string, unknown>)[PROVIDER_KEY] = new providerClass();
	};
}

export namespace Proton {
	/**
	 * Start Proton. This should only be called once per
	 * environment (e.g. once on the server and once on
	 * the client). Attempts to call this more than once
	 * will throw an error.
	 *
	 * If any providers yield within their constructors,
	 * then this method will also yield.
	 *
	 * ```ts
	 * Proton.start();
	 * print("Proton started");
	 * ```
	 */
	export function start() {
		if (started) return;
		started = true;
		for (const callback of awaitCallbacks) {
			task.spawn(callback);
		}
		for (const awaitThread of awaitStartThreads) {
			task.spawn(awaitThread);
		}
		awaitCallbacks.clear();
		awaitStartThreads.clear();
	}

	/**
	 * Yields the calling thread until Proton has been
	 * fully started.
	 *
	 * ```ts
	 * Proton.awaitStart();
	 * print("Started");
	 * ```
	 */
	export function awaitStart() {
		if (started) {
			return;
		}
		const thread = coroutine.running();
		awaitStartThreads.push(thread);
		coroutine.yield();
	}

	/**
	 * Calls the callback once Proton has fully started.
	 * If Proton is already started, the callback will
	 * be spawned immediately.
	 * @param callback Callback
	 */
	export function onStart(callback: () => void) {
		if (started) {
			task.spawn(callback);
			return;
		}
		awaitCallbacks.push(callback);
	}

	/**
	 * Gets a provider within Proton.
	 *
	 * An error will be thrown if the provider does not
	 * exist.
	 *
	 * ```ts
	 * // Directly
	 * const myProvider = Proton.get(MyProvider);
	 *
	 * // From another provider
	 * class AnotherProvider {
	 * 	private readonly myProvider = Proton.get(MyProvider);
	 * }
	 * ```
	 *
	 * @param providerClass The provider class
	 * @returns The provider singleton object
	 */
	export function get<T extends new () => InstanceType<T>>(providerClass: T): InstanceType<T> {
		const provider = (providerClass as Record<string, unknown>)[PROVIDER_KEY] as InstanceType<T> | undefined;
		if (provider === undefined) {
			error(`[Proton]: Failed to find provider "${tostring(providerClass)}"`, 2);
		}
		return provider;
	}
}
