import { RunService } from "@rbxts/services";

const providerClasses = new Map<new () => unknown, unknown>();

let starting = false;
let started = false;
const awaitStartThreads: thread[] = [];

function awaitSeedAttr(): number {
	let seed = script.GetAttribute("s");
	while (seed === undefined) {
		task.wait();
		seed = script.GetAttribute("s");
	}
	script.SetAttribute("s", undefined);
	return seed as number;
}

const seed = RunService.IsServer() ? DateTime.now().UnixTimestamp : awaitSeedAttr();

let netFolder: Folder;
if (RunService.IsServer()) {
	netFolder = new Instance("Folder");
	netFolder.Name = "ProtonNet";
	netFolder.Parent = script;
	script.SetAttribute("s", seed);
} else {
	netFolder = script.WaitForChild("ProtonNet") as Folder;
}

export function Provider() {
	return <T extends new () => InstanceType<T>>(providerClass: T) => {
		if (starting || started) {
			error("[Proton]: Cannot create provider after Proton has started", 2);
		}
		providerClasses.set(providerClass, new providerClass());
	};
}

export interface ProtonInit {
	protonInit(): void;
}

export interface ProtonStart {
	protonStart(): void;
}

type NetworkParams<T> = Parameters<
	T extends unknown[]
		? (...args: T) => void
		: T extends void
		? () => void
		: T extends unknown
		? (arg: T) => void
		: () => void
>;

type NetworkReturn<T> = T extends [infer A] ? A : T extends unknown[] ? LuaTuple<T> : T;

const networkNames = new Set<string>();

function generateNetworkName(data: string): string {
	const sum = data.byte(1, data.size()).reduce((accumulator, val) => accumulator + val);
	const nameSeed = seed + sum;
	const rng = new Random(nameSeed);
	const nameArray: number[] = [];
	for (let i = 0; i < 16; i++) {
		nameArray.push(rng.NextInteger(33, 126));
	}
	let iter = 0;
	const baseName = string.char(...nameArray);
	let name = baseName;
	while (networkNames.has(name)) {
		name = `${baseName}${iter}`;
		iter++;
	}
	networkNames.add(name);
	return name;
}

function setupRemoteObject<T extends "RemoteEvent" | "RemoteFunction">(
	className: T,
	name?: string,
): CreatableInstances[T] {
	if (name === undefined || !RunService.IsStudio()) {
		const [s, l] = debug.info(2, "sl");
		name = generateNetworkName(`${s}${l}`);
	}
	name = `r/${name}`;
	let remote: CreatableInstances[T];
	if (RunService.IsServer()) {
		remote = new Instance(className);
		remote.Name = name;
		remote.Parent = netFolder;
	} else {
		remote = netFolder.WaitForChild(name) as CreatableInstances[T];
	}
	return remote;
}

export enum NetEventBehavior {
	TwoWay,
	ServerToClient,
	ClientToServer,
}

interface INetEventClientFire<T extends unknown[] | unknown> {
	fire(...args: NetworkParams<T>): void;
}

interface INetEventClientConnect<T extends unknown[] | unknown> {
	connect(handler: (...args: NetworkParams<T>) => void): RBXScriptConnection;
}

type INetEventClient<T extends unknown[] | unknown> = INetEventClientFire<T> & INetEventClientConnect<T>;

type NetEventClientExposed<T extends unknown[] | unknown, B extends NetEventBehavior> = INetEventClient<T> &
	B extends NetEventBehavior.TwoWay
	? INetEventClient<T>
	: B extends NetEventBehavior.ServerToClient
	? INetEventClientConnect<T>
	: INetEventClientFire<T>;

interface INetEventServerFire<T extends unknown[] | unknown> {
	fire(player: Player, ...args: NetworkParams<T>): void;
	fireAll(...args: NetworkParams<T>): void;
}

interface INetEventServerConnect<T extends unknown[] | unknown> {
	connect(handler: (player: Player, ...args: NetworkParams<T>) => void): RBXScriptConnection;
}

type INetEventServer<T extends unknown[] | unknown> = INetEventServerFire<T> & INetEventServerConnect<T>;

type NetEventServerExposed<T extends unknown[] | unknown, B extends NetEventBehavior> = INetEventServer<T> &
	B extends NetEventBehavior.TwoWay
	? INetEventServer<T>
	: B extends NetEventBehavior.ServerToClient
	? INetEventServerFire<T>
	: INetEventServerConnect<T>;

class NetEventClient<T extends unknown[] | unknown> implements INetEventClient<T> {
	constructor(private readonly re: RemoteEvent) {}
	public fire(...args: NetworkParams<T>) {
		this.re.FireServer(...args);
	}
	public connect(handler: (...args: NetworkParams<T>) => void): RBXScriptConnection {
		return this.re.OnClientEvent.Connect(handler);
	}
}

class NetEventServer<T extends unknown[] | unknown> implements INetEventServer<T> {
	constructor(private readonly re: RemoteEvent) {}
	public fireAll(...args: NetworkParams<T>) {
		this.re.FireAllClients(...args);
	}
	public fire(player: Player, ...args: NetworkParams<T>) {
		this.re.FireClient(player, ...args);
	}
	public connect(handler: (player: Player, ...args: NetworkParams<T>) => void): RBXScriptConnection {
		return this.re.OnServerEvent.Connect(handler as (player: Player, ...args: unknown[]) => void);
	}
}

export class NetEvent<T extends unknown[] | unknown, B extends NetEventBehavior = NetEventBehavior.TwoWay> {
	private readonly re: RemoteEvent;
	public readonly client: NetEventClientExposed<T, B>;
	public readonly server: NetEventServerExposed<T, B>;
	constructor(name?: string) {
		this.re = setupRemoteObject("RemoteEvent", name);
		this.client = new NetEventClient(this.re);
		this.server = new NetEventServer(this.re);
	}
}

class NetFunctionServer<TX extends unknown[] | unknown, RX extends unknown[] | unknown> {
	constructor(private readonly rf: RemoteFunction) {}
	public handle(handler: (player: Player, ...args: NetworkParams<TX>) => NetworkReturn<RX>) {
		this.rf.OnServerInvoke = handler as (player: Player, ...args: unknown[]) => NetworkReturn<RX>;
	}
}

class NetFunctionClient<TX extends unknown[] | unknown, RX extends unknown[] | unknown> {
	constructor(private readonly rf: RemoteFunction) {}
	public fire(...args: NetworkParams<TX>): NetworkReturn<RX> {
		return this.rf.InvokeServer(...args);
	}
}

export class NetFunction<TX extends unknown[] | unknown, RX extends unknown[] | unknown> {
	private readonly rf: RemoteFunction;
	public readonly server: NetFunctionServer<TX, RX>;
	public readonly client: NetFunctionClient<TX, RX>;
	constructor(name?: string) {
		this.rf = setupRemoteObject("RemoteFunction", name);
		this.server = new NetFunctionServer(this.rf);
		this.client = new NetFunctionClient(this.rf);
	}
}

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
