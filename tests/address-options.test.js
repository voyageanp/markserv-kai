import path from "path";
import test from "ava";
import getPort from "get-port";
import markserv from "../lib/server";

test("invalid bind address surfaces a helpful error", async t => {
	const port = await getPort();

	const error = await t.throwsAsync(() =>
		markserv.init({
			dir: path.join(__dirname, ".."),
			port,
			livereloadport: false,
			address: "203.0.113.99",
			silent: true,
			browser: false,
			autoreload: false,
		}),
	);

	t.is(error.code, "EADDRNOTAVAIL");
	t.true(error.message.includes("Address not available"));
	t.true(error.message.includes("--address or MARKSERV_ADDRESS"));
});
