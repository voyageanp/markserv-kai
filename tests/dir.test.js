import path from "path";
import request from "request";
import test from "ava";
import getPort from "get-port";
import markserv from "../lib/server";

test.cb("start service and get directory listing", t => {
	t.plan(5);

	const dir = path.join(__dirname, "..");

	getPort().then(port => {
		const flags = {
			port,
			dir,
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
				url: `http://localhost:${port}/tests/testdir/`,
				timeout: 1000 * 2
			};

			request(opts, (err, res, body) => {
				if (err) {
					t.fail(err);
					closeServer();
				}

				t.true(body.includes("<h1 class=\"icon folder\">"));
				t.true(body.includes("tests/testdir/"));
				t.true(body.includes("file1.md"));
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
