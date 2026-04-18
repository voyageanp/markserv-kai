import fs from "fs";
import os from "os";
import path from "path";
import request from "request";
import test from "ava";
import getPort from "get-port";
import markserv from "../lib/server";

const fetchBody = (url) =>
	new Promise((resolve, reject) => {
		request({ url, timeout: 1000 * 2 }, (error, response, body) => {
			if (error) {
				reject(error);
				return;
			}

			resolve({ response, body });
		});
	});

test("buildMarkdownDirectoryIndex tracks only directories with markdown descendants", t => {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "markserv-md-only-index-"));

	try {
		fs.mkdirSync(path.join(rootDir, "docs"), { recursive: true });
		fs.mkdirSync(path.join(rootDir, "packages", "pkg-a"), { recursive: true });
		fs.mkdirSync(path.join(rootDir, "src", "components"), { recursive: true });
		fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });

		fs.writeFileSync(path.join(rootDir, "docs", "guide.md"), "# Guide\n", "utf8");
		fs.writeFileSync(path.join(rootDir, "packages", "pkg-a", "README.md"), "# Package\n", "utf8");
		fs.writeFileSync(path.join(rootDir, "src", "components", "index.js"), "export {};\n", "utf8");

		const index = markserv.buildMarkdownDirectoryIndex(rootDir);

		t.true(index.includedDirs.has(path.resolve(rootDir)));
		t.true(index.includedDirs.has(path.join(rootDir, "docs")));
		t.true(index.includedDirs.has(path.join(rootDir, "packages")));
		t.true(index.includedDirs.has(path.join(rootDir, "packages", "pkg-a")));
		t.false(index.includedDirs.has(path.join(rootDir, "src")));
		t.false(index.includedDirs.has(path.join(rootDir, "notes")));
	} finally {
		fs.rmSync(rootDir, { recursive: true, force: true });
	}
});

test("markdown-only-dir mode hides directories without markdown descendants from root listing", async t => {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "markserv-md-only-mode-"));
	let service = null;

	try {
		fs.mkdirSync(path.join(rootDir, "docs"), { recursive: true });
		fs.mkdirSync(path.join(rootDir, "notes"), { recursive: true });
		fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });

		fs.writeFileSync(path.join(rootDir, "docs", "guide.md"), "# Guide\n", "utf8");
		fs.writeFileSync(path.join(rootDir, "notes", "todo.txt"), "todo\n", "utf8");
		fs.writeFileSync(path.join(rootDir, "src", "index.js"), "console.log('x');\n", "utf8");

		const port = await getPort();
		service = await markserv.init({
			dir: rootDir,
			port,
			livereloadport: false,
			address: "localhost",
			silent: true,
			browser: false,
			autoreload: false,
			markdownOnlyDir: true,
		});

		const { response, body } = await fetchBody(`http://localhost:${port}/`);
		t.is(response.statusCode, 200);
		t.true(body.includes("docs/"));
		t.false(body.includes("notes/"));
		t.false(body.includes("src/"));
	} finally {
		if (service && service.httpServer) {
			await new Promise((resolve) => {
				service.httpServer.close(() => {
					resolve();
				});
			});
		}

		fs.rmSync(rootDir, { recursive: true, force: true });
	}
});
