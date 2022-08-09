import { CollectionService } from "@rbxts/services";

export interface ComponentConfig {
	/**
	 * CollectionService tag.
	 */
	tag: string;

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
export abstract class BaseComponent<T extends Instance = Instance> {
	public instance!: T;
	public tag!: string;
	abstract onStart(): void;
	abstract onStop(): void;
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

class ComponentRunner {
	private readonly compInstances = new Map<
		Instance,
		{ comp: BaseComponent; started: boolean; connections: RBXScriptConnection[] }
	>();

	constructor(config: ComponentConfig, componentClass: new () => BaseComponent) {
		const addQueue = new Map<Instance, thread>();

		const checkParent = (instance: Instance): boolean => {
			if (config.blacklistDescendants !== undefined) {
				for (const descendant of config.blacklistDescendants) {
					if (instance.IsDescendantOf(descendant)) {
						return false;
					}
				}
			}
			if (config.whitelistDescendants !== undefined) {
				for (const descendant of config.whitelistDescendants) {
					if (instance.IsDescendantOf(descendant)) {
						return true;
					}
				}
				return false;
			}
			return true;
		};

		const onInstanceAdded = (instance: Instance) => {
			const comp = new componentClass();
			comp.instance = instance;
			comp.tag = config.tag;
			const compItem = { comp, started: false, connections: new Array<RBXScriptConnection>() };
			this.compInstances.set(instance, compItem);
			if (checkParent(instance)) {
				compItem.started = true;
				task.spawn(() => comp.onStart());
			}
			if (config.whitelistDescendants !== undefined || config.blacklistDescendants !== undefined) {
				const connection = instance.AncestryChanged.Connect((_, parent) => {
					if (parent === undefined) return;
					if (checkParent(instance)) {
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
				compItem.connections.push(connection);
			}
			addQueue.delete(instance);
		};

		const queueOnInstanceAdded = (instance: Instance) => {
			if (addQueue.has(instance) || this.compInstances.has(instance)) return;
			addQueue.set(instance, task.defer(onInstanceAdded, instance));
		};

		const onInstanceRemoved = (instance: Instance) => {
			if (addQueue.has(instance)) {
				task.cancel(addQueue.get(instance)!);
				addQueue.delete(instance);
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
		};

		CollectionService.GetInstanceAddedSignal(config.tag).Connect(queueOnInstanceAdded);
		CollectionService.GetInstanceRemovedSignal(config.tag).Connect(onInstanceRemoved);

		for (const instance of CollectionService.GetTagged(config.tag)) {
			task.spawn(queueOnInstanceAdded, instance);
		}
	}

	getFromInstance(instance: Instance) {
		const compItem = this.compInstances.get(instance);
		if (compItem !== undefined && compItem.started) {
			return compItem.comp;
		}
		return undefined;
	}
}

/**
 * Component decorator.
 * @param config Component configuration
 */
export function Component(config: ComponentConfig) {
	return <T extends new () => BaseComponent>(componentClass: T) => {
		if (usedTags.has(config.tag)) {
			error(`[Proton]: Cannot have more than one component with the same tag (tag: "${config.tag}")`, 2);
		}
		const runner = new ComponentRunner(config, componentClass);
		usedTags.add(config.tag);
		componentClassToRunner.set(componentClass, runner);
	};
}
