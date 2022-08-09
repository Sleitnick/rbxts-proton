export namespace ProtonUtil {
	/**
	 * Load Mode for `ProtonUtil.loadModules()` function.
	 */
	export enum LoadMode {
		/**
		 * Only iterate over direct children instances.
		 */
		Children,

		/**
		 * Iterate over all descendant instances.
		 */
		Descendants,
	}

	/**
	 * Load all modules within the parent of the calling script.
	 * An optional `matchName` and `loadMode` can be provided
	 * to help dictate the load behavior.
	 *
	 * ```ts
	 * // Load all children ModuleScripts
	 * ProtonUtil.loadModules();
	 *
	 * // Load all descendant ModuleScripts
	 * ProtonUtil.loadModules(undefined, ProtonUtil.LoadMode.Descendants);
	 *
	 * // Load all ModuleScripts that end with '-service'
	 * ProtonUtil.loadModules("%-service$", ProtonUtil.LoadMode.Descendants);
	 * ```
	 *
	 * @param matchName Only load ModuleScripts that match the given pattern
	 * @param loadMode LoadMode enum to indicate scanning direct children or all descendants
	 */
	export function loadModules(parent: Instance, matchName?: string, loadMode: LoadMode = LoadMode.Children) {
		const instances = loadMode === LoadMode.Children ? parent.GetChildren() : parent.GetDescendants();
		for (const instance of instances) {
			if (instance.IsA("ModuleScript")) {
				if (matchName === undefined || instance.Name.match(matchName)[0] !== undefined) {
					require(instance);
				}
			}
		}
	}
}
