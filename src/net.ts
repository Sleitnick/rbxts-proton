import { RunService } from "@rbxts/services";

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
