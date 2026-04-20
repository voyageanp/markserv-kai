import net from "net";
import path from "path";
import test from "ava";
import getPort from "get-port";
import markserv from "../lib/server";

const closeServer = server =>
	new Promise((resolve) => {
		server.close(resolve);
	});

test("HTTP server fails instead of falling back when requested port is in use", async t => {
	const port = await getPort();
	const blocker = net.createServer();
	await new Promise((resolve) => {
		blocker.listen(port, "127.0.0.1", resolve);
	});

	try {
		const error = await t.throwsAsync(() =>
			markserv.init({
				dir: path.join(__dirname, ".."),
				port,
				livereloadport: false,
				address: "127.0.0.1",
				silent: true,
				browser: false,
				autoreload: false,
			}),
		);

		t.is(error.code, "EADDRINUSE");
		t.true(error.message.includes(`Port ${port} is already in use.`));
	} finally {
		await closeServer(blocker);
	}
});
