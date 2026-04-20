import path from "path";
import request from "request";
import test from "ava";
import getPort from "get-port";
import markserv from "../lib/server";

test.cb("start service and receive tables markdown", t => {
	t.plan(5);

	const dir = path.join(__dirname, "..");

	getPort().then(port => {
		const flags = {
			dir,
			port,
			livereloadport: false,
			address: "localhost",
			silent: true
		};

		const done = () => {
			t.end();
		};

		markserv.init(flags).then(service => {
			const closeServer = () => {
				service.httpServer.close(done);
			};

			const opts = {
				url: `http://localhost:${port}/tests/tables.md`,
				timeout: 1000 * 2
			};

			request(opts, (err, res, body) => {
				if (err) {
					t.fail(err);
					closeServer();
				}

				t.true(body.includes("Colons can be used to align columns."));
				t.true(body.includes("Edit OFF"));
				t.true(body.includes("/__markserv/edit"));
				t.is(res.statusCode, 200);
				t.pass();
				closeServer();
			});
		}).catch(error => {
			t.fail(error);
			t.end();
		});
	});
});
