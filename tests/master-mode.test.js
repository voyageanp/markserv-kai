import fs from "fs";
import os from "os";
import path from "path";
import request from "request";
import test from "ava";
import getPort from "get-port";
import markserv from "../lib/server";

const closeServer = server =>
	new Promise((resolve) => {
		server.close(resolve);
	});

const requestAsync = options =>
	new Promise((resolve, reject) => {
		request(options, (error, response, body) => {
			if (error) {
				reject(error);
				return;
			}

			resolve({response, body});
		});
	});

const createRootDir = (baseDir, name, markdown) => {
	const dir = path.join(baseDir, name);
	fs.mkdirSync(dir, {recursive: true});
	fs.writeFileSync(path.join(dir, "doc.md"), markdown, "utf8");
	return dir;
};

const writeRegistry = (registryPath, roots) => {
	fs.mkdirSync(path.dirname(registryPath), {recursive: true});
	fs.writeFileSync(
		registryPath,
		JSON.stringify({
			version: 1,
			roots,
		}, null, "\t") + "\n",
		"utf8",
	);
};

test("master mode serves registry index and root-scoped markdown", async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markserv-master-"));
	const registryPath = path.join(tempDir, "config", "roots.json");
	const alphaDir = createRootDir(tempDir, "alpha", "# Alpha\n\nbody\n");
	const betaDir = createRootDir(tempDir, "beta", "# Beta\n\nbody\n");
	writeRegistry(registryPath, [
		{
			slug: "alpha",
			title: "Alpha Root",
			dir: alphaDir,
		},
		{
			slug: "beta",
			title: "Beta Root",
			dir: betaDir,
		},
	]);

	const port = await getPort();
	const service = await markserv.init({
		dir: tempDir,
		registry: registryPath,
		master: true,
		port,
		livereloadport: false,
		address: "localhost",
		silent: true,
		browser: false,
		autoreload: false,
	});

	try {
		const indexResponse = await requestAsync({
			url: `http://localhost:${port}/`,
			timeout: 1000 * 2,
		});
		t.is(indexResponse.response.statusCode, 200);
		t.true(indexResponse.body.includes("Alpha Root"));
		t.true(indexResponse.body.includes("Jump Into Your Roots"));
		t.true(indexResponse.body.includes("/roots/alpha/"));
		t.true(indexResponse.body.includes("/roots/beta/"));

		const docResponse = await requestAsync({
			url: `http://localhost:${port}/roots/alpha/doc.md`,
			timeout: 1000 * 2,
		});
		t.is(docResponse.response.statusCode, 200);
		t.true(docResponse.body.includes("/roots/alpha/__markserv/edit"));
		t.true(docResponse.body.includes(`href="http://localhost:${port}/"`));
		t.true(docResponse.body.includes("Back To Hub"));

		const betaDocResponse = await requestAsync({
			url: `http://localhost:${port}/roots/beta/doc.md`,
			timeout: 1000 * 2,
		});
		const registryAfterStart = JSON.parse(fs.readFileSync(registryPath, "utf8"));
		const alphaThemeId = docResponse.body.match(/\/\* markserv-theme:([a-z\d-]+) \*\//);
		const betaThemeId = betaDocResponse.body.match(/\/\* markserv-theme:([a-z\d-]+) \*\//);
		t.truthy(alphaThemeId);
		t.truthy(betaThemeId);
		t.not(alphaThemeId[1], betaThemeId[1]);
		t.truthy(registryAfterStart.roots[0].theme);
		t.truthy(registryAfterStart.roots[1].theme);
		t.not(registryAfterStart.roots[0].theme, registryAfterStart.roots[1].theme);
	} finally {
		service.stopRegistryWatcher();
		await closeServer(service.httpServer);
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});

test("master mode hot-reloads registry changes", async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markserv-master-"));
	const registryPath = path.join(tempDir, "config", "roots.json");
	const alphaDir = createRootDir(tempDir, "alpha", "# Alpha\n");
	const betaDir = createRootDir(tempDir, "beta", "# Beta\n");
	writeRegistry(registryPath, [
		{
			slug: "alpha",
			title: "Alpha Root",
			dir: alphaDir,
		},
	]);

	const port = await getPort();
	const service = await markserv.init({
		dir: tempDir,
		registry: registryPath,
		master: true,
		port,
		livereloadport: false,
		address: "localhost",
		silent: true,
		browser: false,
		autoreload: false,
	});

	try {
		writeRegistry(registryPath, [
			{
				slug: "alpha",
				title: "Alpha Root",
				dir: alphaDir,
			},
			{
				slug: "beta",
				title: "Beta Root",
				dir: betaDir,
			},
		]);

		await new Promise((resolve) => {
			setTimeout(resolve, 700);
		});

		let body = "";
		for (let attempt = 0; attempt < 40; attempt++) {
			// eslint-disable-next-line no-await-in-loop
			const response = await requestAsync({
				url: `http://localhost:${port}/`,
				timeout: 1000 * 2,
			});
			body = response.body;
			if (body.includes("Beta Root")) {
				break;
			}

			// eslint-disable-next-line no-await-in-loop
			await new Promise((resolve) => {
				setTimeout(resolve, 250);
			});
		}

		t.true(body.includes("Beta Root"));
	} finally {
		service.stopRegistryWatcher();
		await closeServer(service.httpServer);
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});
