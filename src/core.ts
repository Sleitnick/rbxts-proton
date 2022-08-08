export interface ProtonStart {
	/**
	 * Proton lifecycle method. `protonStart` is fired
	 * when Proton is started. All `protonStart` methods
	 * are fired in their own threads using `task.spawn`
	 * internally. This also means that these methods
	 * do not need to return at any point (e.g. they can
	 * run loops forever without blocking other providers).
	 */
	protonStart(): void;
}

const providerClasses = new Map<new () => unknown, unknown>();

let started = false;
const awaitStartThreads: thread[] = [];

/**
 * Provider decorator.
 */
export function Provider() {
	return <T extends new () => InstanceType<T>>(providerClass: T) => {
		if (started) {
			error("[Proton]: Cannot create provider after Proton has started", 2);
		}
		providerClasses.set(providerClass, new providerClass());
	};
}

export namespace Proton {
	/**
	 * Start Proton. This should only be called once per
	 * environment (e.g. once on the server and once on
	 * the client). Attempts to call this more than once
	 * will throw an error.
	 *
	 * Yields until all providers have been initialized
	 * and started.
	 *
	 * If a provider's `protonInit` method throws an error,
	 * then the whole startup process will be aborted.
	 *
	 * ```ts
	 * print("Starting...");
	 * Proton.start();
	 * print("Proton started");
	 * ```
	 */
	export function start() {
		if (started) return;

		// Start providers:
		for (const [providerClass, provider] of providerClasses) {
			const p = provider as object;
			if ("protonStart" in p) {
				task.spawn(() => {
					debug.setmemorycategory(tostring(providerClass));
					(p as ProtonStart).protonStart();
				});
			}
		}

		started = true;

		for (const awaitThread of awaitStartThreads) {
			task.spawn(awaitThread);
		}
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
		const provider = providerClasses.get(providerClass) as InstanceType<T>;
		if (provider === undefined) {
			error(`[Proton]: Failed to find provider "${tostring(providerClass)}"`, 2);
		}
		return provider;
	}
}
