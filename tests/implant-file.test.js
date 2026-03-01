import fs from "fs";
import path from "path";
import request from "request";
import test from "ava";
import getPort from "get-port";
import markserv from "../lib/server";

const normalizeDynamicFields = html =>
	html
		.replaceAll(/PID:[\s\d]+</g, "PID: N/A<")
		.replaceAll(/"mtimeMs":[\d.]+/g, "\"mtimeMs\":0");

test.cb("start service and get text file", t => {
	t.plan(3);

	const expected = String(
		fs.readFileSync(
			path.join(__dirname, "implant-file.expected.html")
		)
	);

	const dir = path.join(__dirname);

	getPort().then(port => {
		const flags = {
			port,
			dir,
			livereloadport: false,
			address: "localhost",
			silent: true,
			browser: false
		};

		const done = () => {
			t.end();
		};

		markserv.init(flags).then(service => {
			const closeServer = () => {
				service.httpServer.close(done);
			};

			const opts = {
				url: `http://localhost:${port}/implant-file.render-fixture.md`,
				timeout: 1000 * 2
			};

			request(opts, (err, res, body) => {
				if (err) {
					t.fail(err);
					closeServer();
				}

				// Write expected:
				// fs.writeFileSync(path.join(__dirname, 'implant-file.expected.html'), body)

				const normalizedBody = normalizeDynamicFields(body);
				const normalizedExpected = normalizeDynamicFields(expected);
				t.is(normalizedBody, normalizedExpected);
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
