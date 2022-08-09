import { Players, RunService } from "@rbxts/services";

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

/**
 * NetEvent type.
 */
export enum NetEventType {
	/**
	 * NetEvent can send and receive from both the server and the client.
	 */
	TwoWay,

	/**
	 * NetEvent can send from the server and receive on the client.
	 */
	ServerToClient,

	/**
	 * NetEvent can send from the client and receive on the server.
	 */
	ClientToServer,
}

interface INetEventClientFire<T extends unknown[] | unknown> {
	/**
	 * Fire the event to the server with the given arguments.
	 * @param args Arguments
	 */
	fire(...args: NetworkParams<T>): void;
}

interface INetEventClientConnect<T extends unknown[] | unknown> {
	/**
	 * Listen to events coming from the server.
	 * @param handler Handle the event
	 * @returns RBXScriptConnection
	 */
	connect(handler: (...args: NetworkParams<T>) => void): RBXScriptConnection;
}

type INetEventClient<T extends unknown[] | unknown> = INetEventClientFire<T> & INetEventClientConnect<T>;

type NetEventClientExposed<T extends unknown[] | unknown, B extends NetEventType> = INetEventClient<T> &
	B extends NetEventType.TwoWay
	? INetEventClient<T>
	: B extends NetEventType.ServerToClient
	? INetEventClientConnect<T>
	: INetEventClientFire<T>;

interface INetEventServerFire<T extends unknown[] | unknown> {
	/**
	 * Fire the event to the given client(s) with the arguments.
	 * @param player Client(s)
	 * @param args Arguments
	 */
	fire(player: Player | Player[], ...args: NetworkParams<T>): void;

	/**
	 * Fire the event to all clients with the given arguments.
	 * @param args Arguments
	 */
	fireAll(...args: NetworkParams<T>): void;

	/**
	 * Fire the event to all clients _except_ the given client(s).
	 * @param exceptPlayer Client(s) to ignore
	 * @param args Arguments
	 */
	fireExcept(exceptPlayer: Player | Player[], ...args: NetworkParams<T>): void;

	/**
	 * Fire the event to each client given the predicate for each client returns `true`.
	 * @param predicate Predicate function to test if the event should be fired to the given client
	 * @param args Arguments
	 */
	fireIf(predicate: (player: Player) => boolean, ...args: NetworkParams<T>): void;
}

interface INetEventServerConnect<T extends unknown[] | unknown> {
	/**
	 * Listen to events coming from all clients.
	 * @param handler Handle the event
	 * @returns RBXScriptConnection
	 */
	connect(handler: (player: Player, ...args: NetworkParams<T>) => void): RBXScriptConnection;
}

type INetEventServer<T extends unknown[] | unknown> = INetEventServerFire<T> & INetEventServerConnect<T>;

type NetEventServerExposed<T extends unknown[] | unknown, B extends NetEventType> = INetEventServer<T> &
	B extends NetEventType.TwoWay
	? INetEventServer<T>
	: B extends NetEventType.ServerToClient
	? INetEventServerFire<T>
	: INetEventServerConnect<T>;

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

	public fire(player: Player | Player[], ...args: NetworkParams<T>) {
		if (typeOf(player) === "table") {
			for (const plr of player as Player[]) {
				this.re.FireClient(plr, ...args);
			}
		} else {
			this.re.FireClient(player as Player, ...args);
		}
	}

	public fireExcept(exceptPlayer: Player | Player[], ...args: NetworkParams<T>) {
		if (typeOf(exceptPlayer) === "table") {
			for (const player of Players.GetPlayers()) {
				if ((exceptPlayer as Player[]).includes(player)) continue;
				this.re.FireClient(player, ...args);
			}
		} else {
			for (const player of Players.GetPlayers()) {
				if (player === exceptPlayer) continue;
				this.re.FireClient(player, ...args);
			}
		}
	}

	public fireIf(predicate: (player: Player) => boolean, ...args: NetworkParams<T>) {
		for (const player of Players.GetPlayers()) {
			if (!predicate(player)) continue;
			this.re.FireClient(player, ...args);
		}
	}

	public connect(handler: (player: Player, ...args: NetworkParams<T>) => void): RBXScriptConnection {
		return this.re.OnServerEvent.Connect(handler as (player: Player, ...args: unknown[]) => void);
	}
}

class NetFunctionServer<TX extends unknown[] | unknown, RX extends unknown[] | unknown> {
	constructor(private readonly rf: RemoteFunction) {}

	/**
	 * Handle invocations to this remote function coming from clients.
	 * @param handler Handler
	 */
	public handle(handler: (player: Player, ...args: NetworkParams<TX>) => NetworkReturn<RX>) {
		this.rf.OnServerInvoke = handler as (player: Player, ...args: unknown[]) => NetworkReturn<RX>;
	}
}

class NetFunctionClient<TX extends unknown[] | unknown, RX extends unknown[] | unknown> {
	constructor(private readonly rf: RemoteFunction) {}

	/**
	 * Invoke the remote function, sending the arguments to the server.
	 * @param args TX
	 * @returns RX
	 */
	public async invoke(...args: NetworkParams<TX>): Promise<NetworkReturn<RX>> {
		return this.rf.InvokeServer(...args);
	}
}

/**
 * NetEvent represents a RemoteEvent.
 *
 * ```ts
 * export const MyEvent = new NetEvent<[message: string]>();
 * ```
 */
export class NetEvent<T extends unknown[] | unknown, B extends NetEventType = NetEventType.TwoWay> {
	private readonly re: RemoteEvent;

	/**
	 * Server API for the event. Should only be used from the server.
	 */
	public readonly server: NetEventServerExposed<T, B>;

	/**
	 * Client API for the event. Should only be used from the client.
	 */
	public readonly client: NetEventClientExposed<T, B>;

	constructor(name?: string) {
		this.re = setupRemoteObject("RemoteEvent", name);
		this.client = new NetEventClient(this.re);
		this.server = new NetEventServer(this.re);
	}
}

/**
 * NetFunction represents a RemoteFunction.
 *
 * ```ts
 * export const MyFunc = new NetFunction<void, [message: string]>();
 * ```
 */
export class NetFunction<TX extends unknown[] | unknown, RX extends unknown[] | unknown> {
	private readonly rf: RemoteFunction;

	/**
	 * Server API for the function. Should only be used from the server.
	 */
	public readonly server: NetFunctionServer<TX, RX>;

	/**
	 * Client API for the function. Should only be used from the client.
	 */
	public readonly client: NetFunctionClient<TX, RX>;

	constructor(name?: string) {
		this.rf = setupRemoteObject("RemoteFunction", name);
		this.server = new NetFunctionServer(this.rf);
		this.client = new NetFunctionClient(this.rf);
	}
}
