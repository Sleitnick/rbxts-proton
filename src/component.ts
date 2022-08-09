import { CollectionService } from "@rbxts/services";

export interface ComponentConfig {
	/**
	 * CollectionService tag.
	 */
	tag?: string;

	/**
	 * Descendant whitelist. Component will only be active
	 * if it is a descendant of one of the instances in
	 * this list.
	 */
	whitelistDescendants?: Instance[];

	/**
	 * Descendant blacklist. Component will only be
	 * active if it is _not_ a descendant of any of the
	 * instances in this list.
	 */
	blacklistDescendants?: Instance[];
}

const usedTags = new Set<string>();
const componentClassToRunner = new Map<new () => BaseComponent, ComponentRunner>();

/**
 * Base class for components. All components should
 * extend from this class.
 *
 * ```ts
 * class MyComponent extends BaseComponent<BasePart> {
 * 	onStart() {}
 * 	onStop() {}
 * }
 * ```
 */
export abstract class BaseComponent<I extends Instance = Instance> {
	/**
	 * Attached instance.
	 */
	public instance!: I;

	/**
	 * CollectionService tag.
	 */
	public tag!: string;

	/**
	 * Called when the instance is started. This can be called multiple
	 * times within the lifetime of the class instance. However, it is
	 * guaranteed that `onStop()` will be called in-between calls.
	 */
	abstract onStart(): void;

	/**
	 * Called when the instance is stopped. This can be called multiple
	 * times within the lifetime of the class instance. Therefore, it is
	 * important that this method is idempotent.
	 */
	abstract onStop(): void;
}

class ComponentRunner {
	private readonly compInstances = new Map<
		Instance,
		{ comp: BaseComponent; started: boolean; connections: RBXScriptConnection[] }
	>();
	private readonly addQueue = new Map<Instance, thread>();

	constructor(private readonly config: ComponentConfig, private readonly componentClass: new () => BaseComponent) {
		if (config.tag !== undefined) {
			CollectionService.GetInstanceAddedSignal(config.tag).Connect((instance) =>
				this.queueOnInstanceAdded(instance),
			);
			CollectionService.GetInstanceRemovedSignal(config.tag).Connect((instance) =>
				this.onInstanceRemoved(instance),
			);
			for (const instance of CollectionService.GetTagged(config.tag)) {
				task.spawn(() => this.queueOnInstanceAdded(instance));
			}
		}
	}

	private checkParent(instance: Instance): boolean {
		if (this.config.blacklistDescendants !== undefined) {
			for (const descendant of this.config.blacklistDescendants) {
				if (instance.IsDescendantOf(descendant)) {
					return false;
				}
			}
		}
		if (this.config.whitelistDescendants !== undefined) {
			for (const descendant of this.config.whitelistDescendants) {
				if (instance.IsDescendantOf(descendant)) {
					return true;
				}
			}
			return false;
		}
		return true;
	}

	private onInstanceAdded(instance: Instance) {
		const comp = new this.componentClass();
		comp.instance = instance;
		comp.tag = this.config.tag ?? "";
		const compItem = { comp, started: false, connections: new Array<RBXScriptConnection>() };
		this.compInstances.set(instance, compItem);
		if (this.checkParent(instance)) {
			compItem.started = true;
			task.spawn(() => comp.onStart());
		}
		if (this.config.whitelistDescendants !== undefined || this.config.blacklistDescendants !== undefined) {
			const ancestryConnection = instance.AncestryChanged.Connect((_, parent) => {
				if (parent === undefined) return;
				if (this.checkParent(instance)) {
					if (!compItem.started) {
						compItem.started = true;
						task.spawn(() => comp.onStart());
					}
				} else {
					if (compItem.started) {
						compItem.started = false;
						task.spawn(() => comp.onStop());
					}
				}
			});
			compItem.connections.push(ancestryConnection);
		}
		this.addQueue.delete(instance);
		return comp;
	}

	private queueOnInstanceAdded(instance: Instance) {
		if (this.addQueue.has(instance) || this.compInstances.has(instance)) return;
		this.addQueue.set(
			instance,
			task.defer(() => this.onInstanceAdded(instance)),
		);
	}

	private onInstanceRemoved(instance: Instance) {
		if (this.addQueue.has(instance)) {
			task.cancel(this.addQueue.get(instance)!);
			this.addQueue.delete(instance);
		}
		const compItem = this.compInstances.get(instance);
		if (compItem !== undefined) {
			this.compInstances.delete(instance);
			if (compItem.started) {
				task.spawn(() => compItem.comp.onStop());
			}
			for (const connection of compItem.connections) {
				connection.Disconnect();
			}
		}
	}

	getFromInstance(instance: Instance) {
		const compItem = this.compInstances.get(instance);
		if (compItem !== undefined && compItem.started) {
			return compItem.comp;
		}
		return undefined;
	}

	forceSpawn(instance: Instance) {
		if (this.config.tag !== undefined) {
			error("[Proton]: Component with a configured tag cannot be spawned", 2);
		}
		return this.getFromInstance(instance) ?? this.onInstanceAdded(instance);
	}

	forceDespawn(instance: Instance) {
		if (this.config.tag !== undefined) {
			error("[Proton]: Component with a configured tag cannot be despawned", 2);
		}
		this.onInstanceRemoved(instance);
	}
}

/**
 * Component decorator.
 * @param config Component configuration
 */
export function Component(config: ComponentConfig) {
	return <B extends new () => BaseComponent>(componentClass: B) => {
		if (config.tag !== undefined && usedTags.has(config.tag)) {
			error(`[Proton]: Cannot have more than one component with the same tag (tag: "${config.tag}")`, 2);
		}
		const runner = new ComponentRunner(config, componentClass);
		componentClassToRunner.set(componentClass, runner);
		if (config.tag !== undefined) {
			usedTags.add(config.tag);
		}
	};
}

/**
 * Get a component attached to the given instance. Returns
 * `undefined` if nothing is found.
 *
 * ```ts
 * const component = getComponent(MyComponent, someInstance);
 * ```
 *
 * @param componentClass Component class
 * @param instance Roblox instance
 * @returns Component or undefined
 */
export function getComponent<I extends C["instance"], C extends BaseComponent>(
	componentClass: new () => C,
	instance: I,
) {
	return componentClassToRunner.get(componentClass)?.getFromInstance(instance) as C | undefined;
}

/**
 * Add a component manually (bypass CollectionService).
 * @param componentClass Component class
 * @param instance Instance
 */
export function addComponent<I extends C["instance"], C extends BaseComponent>(
	componentClass: new () => C,
	instance: I,
) {
	const runner = componentClassToRunner.get(componentClass);
	if (runner === undefined) {
		error("[Proton]: Component class not set up");
	}
	return runner.forceSpawn(instance) as C;
}

/**
 * Remove a component manually.
 * @param componentClass Component class
 * @param instance Instance
 */
export function removeComponent<I extends C["instance"], C extends BaseComponent>(
	componentClass: new () => C,
	instance: I,
) {
	const runner = componentClassToRunner.get(componentClass);
	if (runner === undefined) {
		error("[Proton]: Component class not set up");
	}
	runner.forceDespawn(instance);
}
