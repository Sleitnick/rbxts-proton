export interface ProtonInit {
	protonInit(): void;
}

export interface ProtonStart {
	protonStart(): void;
}

const providerClasses = new Map<new () => unknown, unknown>();

let starting = false;
let started = false;
const awaitStartThreads: thread[] = [];

export function Provider() {
	return <T extends new () => InstanceType<T>>(providerClass: T) => {
		if (starting || started) {
			error("[Proton]: Cannot create provider after Proton has started", 2);
		}
		providerClasses.set(providerClass, new providerClass());
	};
}

export namespace Proton {
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

	export function awaitStart() {
		if (started) {
			return;
		}
		const thread = coroutine.running();
		awaitStartThreads.push(thread);
		coroutine.yield();
	}

	export function get<T extends new () => InstanceType<T>>(providerClass: T): InstanceType<T> {
		const provider = providerClasses.get(providerClass) as InstanceType<T>;
		if (provider === undefined) {
			error(`[Proton]: Failed to find provider "${tostring(providerClass)}"`, 2);
		}
		return provider;
	}
}
