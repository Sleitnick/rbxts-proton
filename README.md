# Proton

Proton is an easy-to-use framework for Roblox game development.

Like the proton of an atom, Proton aims at adding stability to your game development, all while only remaining a portion of the whole. Use Proton to structure and connect the top-level design of your game.

## Providers

Providers are the core of Proton. A provider _provides_ a specific service or utility to your game. For example, a game might have a `DataProvider` (or `DataService`/`DataManager`/etc.) that provides the logic for handling data for players in the game.

### Structure
The minimum structure of a provider looks like the following:
```ts
import { Provider } from "@rbxts/proton";

@Provider()
export class MyProvider {}
```

That's it. The `@Provider()` decorator communicates data about the class to Proton, but does _not_ mutate the given provider at all. Proton will create a singleton of the provider once Proton is started.

### Extensible
Providers can have any number of methods or fields added to them. They're just plain classes. Add anything to them.

```ts
@Provider()
export class MyProvider {
	private message = "hello!";
	helloWorld() {
		print(this.message);
	}
}
```

### Built-in Lifecycles
Proton also provides two core lifecycle methods. These are optional. When Proton is started, all `protonInit` methods are called concurrently. Proton will yield itself until all `protonInit` methods have fully completed. If even one fails, Proton will stop and the error will be thrown. If all succeed, Proton will concurrently call all `protonStart` methods. Proton does not care if the `protonStart` methods ever stop, so they can run loops or yield indefinitely.

```ts
import { ProtonInit, ProtonStart, Provider } from "shared/proton";

@Provider()
export class MyProvider implements ProtonInit, ProtonStart {
	protonInit() {
		print("MyProvider initialized");
	}
	protonStart() {
		print("MyProvider started");
	}
}
```

## Starting Proton

From both a server and client script, call the `Proton.start()` method. The method will yield until all `protonInit` methods have been completed and after all `protonStart` methods have been started.

```ts
import { Proton } from "shared/proton";

Proton.start();
```

If another script requires Proton to be started, `Proton.awaitStart()` can be used, which will yield until Proton is fully started.

```ts
import { Proton } from "shared/proton";

Proton.awaitStart();
```

### Loading Providers
Modules are not magically loaded. Thus, if your providers exist in their own modules but are never imported by any running code, then Proton will never see them and they will not start. This is common for top-level providers that no other code relies on. In such cases, they must be explicitly imported:

```ts
import { Proton } from "shared/proton";

// e.g.
import "./providers/my-provider.ts"

Proton.start();
```

## Getting a Provider

Once Proton is started, use `Proton.get()` to get a provider:

```ts
const myProvider = Proton.get(MyProvider);
myProvider.helloWorld();
```

Providers can also access other providers:

```ts
@Provider()
export class AnotherProvider implements ProtonStart {
	private readonly myProvider = Proton.get(MyProvider);

	protonStart() {
		// Other providers are safe to use once the
		// `protonStart` stage is reached.
		myProvider.helloWorld();
	}
}
```

## Network

The recommended way to do networking in Proton is to create a `network.ts` file in a shared directory (e.g. accessible from both the server and the client), and then create a `Network` namespace with the desired `NetEvent` and `NetFunction` objects. Optionally, multiple different namespaces can be created to separate between network functionality.

```ts
// shared/network.ts
import { NetEvent, NetEventBehavior, NetFunction } from "./proton";

export namespace Network {
	// Send a message to a player
	export const sendMessageToPlayer = new NetEvent<[message: string], NetEventBehavior.ServerToClient>();

	// Get fireBullet from player
	export const fireBullet = new NetEvent<[pos: Vector3, dir: Vector3], NetEventBehavior.ClientToServer>();

	// Allow client to fetch some data
	export const getData = new NetFunction<void, [data: string]>();

	// Client sends request to buy something
	export const buy = new NetFunction<[item: string, category: string], [bought: boolean]>();

	// Client gets sent multiple variables
	export const getMultiple = new NetFunction<void, [msg1: string, msg2: string, msg3: string]>();
}
```

Example of the above Network setup being consumed:

```ts
// server

Network.sendMessageToPlayer.server.fire(somePlayer, "hello world!");
Network.fireBullet.server.connect((pos, dir) => {
	// Handle bullet being fired
});
Network.getData.server.handle((player) => {
	return "Some data";
});
Network.buy.server.handle((player, item, category) => {
	// Buy item
	return false;
});
Network.getMultiple.handle((player) => {
	return ["hello", "world", "how are you"] as LuaTuple<[string, string, string]>;
});
```

```ts
// client

Network.sendMessageToPlayer.client.connect((message) => {
	print(message);
});
Network.fireBullet.client.fire(new Vector3(), Vector3.zAxis);
const data = Network.getData.client.fire();
const [msg1, msg2, msg3] = Network.getMultiple.client.fire();
```

## Lifecycles

Custom lifecycles can be added. At their core, lifecycles are just special event dispatchers that can hook onto a class method. For example, here is a lifecycle that is fired every Heartbeat.

```ts
// shared/lifecycles.ts
import { Lifecycle, LifecycleBehavior } from "./proton";

export interface OnHeartbeat {
	onHeartbeat(dt: number): void;
}

export const HeartbeatLifecycle = new Lifecycle<OnHeartbeat["onHeartbeat"]>(LifecycleBehavior.Concurrent);

RunService.Heartbeat.Connect((dt) => heartbeat.fire(dt));
```

A provider can then hook into the lifecycle:

```ts
@Provider()
export class MyProvider implements OnHeartbeat {
	@OnLifecycle(HeartbeatLifecycle)
	onHeartbeat(dt: number) {
		print("Update", dt);
	}
}
```

Here is a more complex lifecycle that is fired when a player enters the game.

```ts
// shared/lifecycles.ts
export interface OnPlayerAdded {
	onPlayerAdded(player: Player): void;
}

export const PlayerAddedLifecycle = new Lifecycle<OnPlayerAdded["onPlayerAdded"]>(LifecycleBehavior.Concurrent);

// Trigger lifecycle for all current players and all future players:
Players.PlayerAdded.Connect((player) => playerAdded.fire(player));
for (const player of Players.GetPlayers()) {
	playerAdded.fire(player);
}

// Trigger lifecycle for all players for any new callbacks that get registered later on during runtime:
playerAdded.onRegistered((callback) => {
	for (const player of Players.GetPlayers()) {
		task.spawn(callback, player);
	}
});
```

```ts
@Provider()
export class MyProvider implements OnPlayerAdded {
	@OnLifecycle(PlayerAddedLifecycle)
	onPlayerAdded(player: Player) {
		print(`Player entered the game: ${player}`);
	}
}
```
