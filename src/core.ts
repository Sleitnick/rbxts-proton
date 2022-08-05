export interface ProtonInit {
	/**
	 * Proton lifecycle method. `protonInit` is fired
	 * when `Proton.start()` is called. All providers
	 * will run their `protonInit` methods concurrently.
	 *
	 * If an error is thrown in `protonInit`, Proton
	 * will stop.
	 */
	protonInit(): void;
}

export interface ProtonStart {
	/**
	 * Proton lifecycle method. `protonStart` is fired
	 * _after_ all `protonInit` methods have finished
	 * executing. All providers will run their `protonStart`
	 * methods concurrently. Proton fire-and-forgets
	 * this method, so it is safe to yield indefinitely or
	 * loop forever.
	 */
	protonStart(): void;
}

const providerClasses = new Map<new () => unknown, unknown>();

let starting = false;
let started = false;
const awaitStartThreads: thread[] = [];

/**
 * Provider decorator.
 */
export function Provider() {
	return <T extends new () => InstanceType<T>>(providerClass: T) => {
		if (starting || started) {
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
		if (starting || started) return;
		starting = true;
		const thread = coroutine.running();

		// Init providers:
		let numInitProviders = 0;
		let completedInit = 0;
		for (const [providerClass, provider] of providerClasses) {
			const p = provider as object;
			if ("protonInit" in p) {
				numInitProviders++;
				task.spawn(() => {
					debug.setmemorycategory(tostring(providerClass));
					(p as ProtonInit).protonInit();
					debug.resetmemorycategory();
					completedInit++;
					if (completedInit === numInitProviders && coroutine.status(thread) === "suspended") {
						task.spawn(thread);
					}
				});
			}
		}

		// Wait for init step to be completed:
		if (completedInit !== numInitProviders) {
			coroutine.yield();
		}

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

		starting = false;
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
	 * When accessing providers outside of any other
	 * provider, it is good practice to ensure that
	 * Proton is fully started, which ensures that the
	 * providers have been fully initialized.
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
