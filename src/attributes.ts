type AttributeRecord<K extends string, T extends AttributeValue> = { [P in K]: T };

/**
 * Attributes wrapper class. Enforces default attribute values
 * and attribute typings.
 *
 * ```ts
 * const attrs = new Attributes(myInstance, {
 * 	name: "default_name",
 * 	points: 0,
 * 	xp: 0,
 * 	cool: false,
 * });
 *
 * print(attrs.attributes.points);
 * attrs.set("points", 10);
 * attrs.destroy();
 * ```
 */
export class Attributes<T extends AttributeRecord<string, AttributeValue>, I extends Instance = Instance> {
	/**
	 * Attributes bound to the instance. This is a readonly
	 * dictionary. To set the value of an attribute, use
	 * the `set()` method.
	 */
	public readonly attributes: Readonly<T>;
	private readonly attr: { [key: string]: AttributeValue | undefined } = {};

	private readonly connections: RBXScriptConnection[] = [];
	private readonly onChangedCallbacks = new Map<keyof T, ((newValue: never, oldValue: never) => void)[]>();

	constructor(private readonly instance: I, defaultAttributes: T) {
		const attrBound = instance.GetAttributes();
		for (const [k, v] of pairs(defaultAttributes)) {
			const key = k as string;
			const val = v as AttributeValue;
			const bound = attrBound.get(key);
			if (bound !== undefined) {
				this.attr[key] = bound;
			} else {
				this.attr[key] = val;
				instance.SetAttribute(key, val);
			}
			const connection = instance.GetAttributeChangedSignal(key).Connect(() => {
				this.handleOnChange(key, instance.GetAttribute(key));
			});
			this.connections.push(connection);
		}
		this.attributes = this.attr as T;
	}

	private handleOnChange(key: string, newValue: AttributeValue | undefined): boolean {
		const oldValue = this.attr[key];
		if (newValue === oldValue) return false;
		this.attr[key] = newValue;
		const callbacks = this.onChangedCallbacks.get(key);
		if (callbacks) {
			for (const callback of callbacks as ((
				newVal: AttributeValue | undefined,
				oldVal: AttributeValue | undefined,
			) => void)[]) {
				task.spawn(callback, newValue, oldValue);
			}
		}
		return true;
	}

	/**
	 * Set the value of an attribute.
	 *
	 * ```ts
	 * attrs.set("points", 10);
	 * ```
	 *
	 * @param key Attribute name
	 * @param value Attribute value
	 */
	public set<K extends keyof T>(key: K, value: T[K]): void {
		const changed = this.handleOnChange(key as string, value);
		if (!changed) return;
		this.instance.SetAttribute(key as string, value);
	}

	/**
	 * Listen for changes of a given attribute.
	 *
	 * ```ts
	 * attrs.onChanged("points", (newPoints, oldPoints) => {
	 * 	print(`Points changed from ${oldPoints} to ${newPoints}`);
	 * });
	 * ```
	 *
	 * @param key Attribute name
	 * @param handler Callback
	 * @returns Cleanup function
	 */
	public onChanged<K extends keyof T>(
		key: K,
		handler: (newValue: T[K] | undefined, oldValue: T[K] | undefined) => void,
	) {
		let callbacks = this.onChangedCallbacks.get(key);
		if (callbacks === undefined) {
			callbacks = [];
			this.onChangedCallbacks.set(key, callbacks);
		}
		callbacks.push(handler);
		return () => {
			const index = callbacks!.indexOf(handler);
			if (index === -1) return;
			callbacks?.unorderedRemove(index);
		};
	}

	/**
	 * Observe the value of a given attribute. Similar to `onChange()`,
	 * except it also fires immediately with the given attribute value.
	 *
	 * ```ts
	 * attrs.observe("points", (points) => print(`Points: ${points}`));
	 * ```
	 *
	 * @param key Attribute name
	 * @param observer Observer function
	 * @returns Cleanup function
	 */
	public observe<K extends keyof T>(key: K, observer: (value: T[K] | undefined) => void) {
		task.spawn(observer, this.attributes[key]);
		return this.onChanged(key, (newValue) => observer(newValue));
	}

	/**
	 * Clean up this Attributes instance. This disconnects all
	 * of the connections that listen for changed attributes.
	 *
	 * If the attached instance of this Attributes object was
	 * destroyed, then this method does not need to be called.
	 *
	 * This does _not_ clear the attributes on the given instance.
	 */
	public destroy(): void {
		for (const connection of this.connections) {
			connection.Disconnect();
		}
		this.connections.clear();
		this.onChangedCallbacks.clear();
	}
}
