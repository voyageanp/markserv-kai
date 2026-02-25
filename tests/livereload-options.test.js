import net from "net";
import path from "path";
import test from "ava";
import getPort from "get-port";
import markserv from "../lib/server";

const closeServer = server =>
	new Promise((resolve) => {
		server.close(resolve);
	});

const isPortAvailable = port =>
	new Promise((resolve) => {
		const probe = net.createServer();
		probe.once("error", () => resolve(false));
		probe.listen(port, () => {
			probe.close(() => resolve(true));
		});
	});

const findAvailablePortInRange = async (start, end) => {
	for (let port = start; port <= end; port++) {
		// eslint-disable-next-line no-await-in-loop
		if (await isPortAvailable(port)) {
			return port;
		}
	}

	return false;
};

test("resolveLiveReloadPort falls back when requested port is in use", async t => {
	const requestedPort = await findAvailablePortInRange(35_729, 35_739);
	if (!requestedPort) {
		t.pass();
		return;
	}

	const blocker = net.createServer();
	await new Promise((resolve) => {
		blocker.listen(requestedPort, resolve);
	});

	try {
		const port = await markserv.resolveLiveReloadPort(requestedPort, {silent: true});
		t.not(port, requestedPort);
		t.true(port > 0);
	} finally {
		await closeServer(blocker);
	}
});

test("autoreload false disables LiveReload", async t => {
	const port = await getPort();
	const flags = {
		dir: path.join(__dirname, ".."),
		port,
		livereloadport: 35_729,
		autoreload: false,
		address: "localhost",
		silent: true,
		browser: false
	};

	const service = await markserv.init(flags);

	t.is(service.liveReloadPort, false);
	t.is(service.liveReloadServer, undefined);

	await closeServer(service.httpServer);
});
