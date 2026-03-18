import fs from "fs";
import os from "os";
import path from "path";
import request from "request";
import test from "ava";
import sharp from "sharp";
import getPort from "get-port";
import markserv from "../lib/server";

const fetchBody = (url) =>
	new Promise((resolve, reject) => {
		request({ url, timeout: 1000 * 3 }, (error, response, body) => {
			if (error) {
				reject(error);
				return;
			}

			resolve({ response, body });
		});
	});

const closeService = async (service) => {
	if (!service || !service.httpServer) {
		return;
	}

	await new Promise((resolve) => {
		service.httpServer.close(() => {
			resolve();
		});
	});
};

const buildNotebookFixture = async (dir, fileName = "sample.ipynb") => {
	const imageBuffer = await sharp({
		create: {
			width: 2400,
			height: 1200,
			channels: 3,
			background: { r: 255, g: 64, b: 128 },
		},
	}).png().toBuffer();

	const notebook = {
		cells: [
			{
				cell_type: "markdown",
				metadata: {},
				source: [
					"# Notebook Title\n",
					"Rendered from ipynb.\n",
				],
			},
			{
				cell_type: "code",
				metadata: {},
				execution_count: 1,
				source: ["print('hello')\n"],
				outputs: [
					{
						output_type: "stream",
						name: "stdout",
						text: ["hello\n"],
					},
					{
						output_type: "execute_result",
						execution_count: 1,
						data: {
							"text/html": "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
						},
						metadata: {},
					},
					{
						output_type: "display_data",
						data: {
							"image/png": imageBuffer.toString("base64"),
						},
						metadata: {},
					},
				],
			},
		],
		metadata: {
			kernelspec: {
				name: "python3",
				language: "python",
				display_name: "Python 3",
			},
		},
		nbformat: 4,
		nbformat_minor: 5,
	};

	const notebookPath = path.join(dir, fileName);
	fs.writeFileSync(notebookPath, JSON.stringify(notebook, null, 2), "utf8");
	return notebookPath;
};

test("notebook mode off does not create cache during normal markdown/directory requests", async t => {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "markserv-notebook-off-"));
	let service = null;

	try {
		fs.writeFileSync(path.join(rootDir, "doc.md"), "# Doc\n", "utf8");
		await buildNotebookFixture(rootDir);

		const port = await getPort();
		service = await markserv.init({
			dir: rootDir,
			port,
			livereloadport: false,
			address: "localhost",
			silent: true,
			browser: false,
			autoreload: false,
		});

		const markdownRes = await fetchBody(`http://localhost:${port}/doc.md`);
		t.is(markdownRes.response.statusCode, 200);

		const dirRes = await fetchBody(`http://localhost:${port}/`);
		t.is(dirRes.response.statusCode, 200);

		const cacheRootDir = path.join(rootDir, ".markserv-cache");
		t.false(fs.existsSync(cacheRootDir));
	} finally {
		await closeService(service);
		fs.rmSync(rootDir, { recursive: true, force: true });
	}
});

test("notebook route converts on demand, reuses cache, and refreshes on source mtime update", async t => {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "markserv-notebook-on-"));
	let service = null;

	try {
		const notebookPath = await buildNotebookFixture(rootDir);
		const notebookRelPath = "sample.ipynb";
		const notebookUrlPath = encodeURIComponent(notebookRelPath);
		const routeUrl = (port) =>
			`http://localhost:${port}/__markserv/ipynb-render?path=${notebookUrlPath}&mode=on`;

		const port = await getPort();
		service = await markserv.init({
			dir: rootDir,
			port,
			livereloadport: false,
			address: "localhost",
			silent: true,
			browser: false,
			autoreload: false,
		});

		const firstResponse = await fetchBody(routeUrl(port));
		t.is(firstResponse.response.statusCode, 200);
		t.true(firstResponse.body.includes("Cell [1]"));

		const cacheIpynbDir = path.join(rootDir, ".markserv-cache", "ipynb");
		t.true(fs.existsSync(cacheIpynbDir));
		const cacheDirs = fs.readdirSync(cacheIpynbDir);
		t.is(cacheDirs.length, 1);

		const cacheDir = path.join(cacheIpynbDir, cacheDirs[0]);
		const renderedMarkdownPath = path.join(cacheDir, "rendered.md");
		const renderedMarkdown = fs.readFileSync(renderedMarkdownPath, "utf8");
		t.true(renderedMarkdown.includes("### Cell [1]"));
		t.true(renderedMarkdown.includes("| A | B |"));
		t.regex(renderedMarkdown, /!\[Cell 2 Output 3]\(\/\.markserv-cache\/ipynb\/.*\/assets\/.*\)/);

		const assetsDir = path.join(cacheDir, "assets");
		const assetFiles = fs.readdirSync(assetsDir);
		t.true(assetFiles.length > 0);
		const firstAssetPath = path.join(assetsDir, assetFiles[0]);
		const assetMeta = await sharp(firstAssetPath).metadata();
		t.true(Number.isFinite(assetMeta.width));
		t.true(assetMeta.width <= 1600);

		const firstRenderedStat = fs.statSync(renderedMarkdownPath);

		await new Promise((resolve) => {
			setTimeout(resolve, 30);
		});
		const secondResponse = await fetchBody(routeUrl(port));
		t.is(secondResponse.response.statusCode, 200);
		const secondRenderedStat = fs.statSync(renderedMarkdownPath);
		t.is(secondRenderedStat.mtimeMs, firstRenderedStat.mtimeMs);

		await new Promise((resolve) => {
			setTimeout(resolve, 30);
		});
		fs.appendFileSync(notebookPath, "\n", "utf8");
		const sourceStat = fs.statSync(notebookPath);
		fs.utimesSync(notebookPath, sourceStat.atime, new Date(sourceStat.mtimeMs + 1000));

		const thirdResponse = await fetchBody(routeUrl(port));
		t.is(thirdResponse.response.statusCode, 200);
		const thirdRenderedStat = fs.statSync(renderedMarkdownPath);
		t.true(thirdRenderedStat.mtimeMs > secondRenderedStat.mtimeMs);
	} finally {
		await closeService(service);
		fs.rmSync(rootDir, { recursive: true, force: true });
	}
});

test("sidebar ships ipynb links and notebook mode client markers", async t => {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "markserv-notebook-sidebar-"));
	let service = null;

	try {
		fs.writeFileSync(path.join(rootDir, "doc.md"), "# Doc\n", "utf8");
		await buildNotebookFixture(rootDir);

		const port = await getPort();
		service = await markserv.init({
			dir: rootDir,
			port,
			livereloadport: false,
			address: "localhost",
			silent: true,
			browser: false,
			autoreload: false,
		});

		const pageResponse = await fetchBody(`http://localhost:${port}/doc.md`);
		t.is(pageResponse.response.statusCode, 200);
		t.true(pageResponse.body.includes("sidebar-notebook-off"));
		t.true(pageResponse.body.includes("sidebar-notebook-on"));
		t.true(pageResponse.body.includes("markserv.ipynbMode"));
		t.true(pageResponse.body.includes("data-ms-file-type=\"ipynb\""));
		t.true(pageResponse.body.includes("/__markserv/ipynb-render?path=sample.ipynb&mode=on"));

		const noModeResponse = await fetchBody(
			`http://localhost:${port}/__markserv/ipynb-render?path=sample.ipynb`,
		);
		t.is(noModeResponse.response.statusCode, 400);
		t.true(noModeResponse.body.includes("mode=on"));
	} finally {
		await closeService(service);
		fs.rmSync(rootDir, { recursive: true, force: true });
	}
});
