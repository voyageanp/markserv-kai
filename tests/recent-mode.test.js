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

test("renders recent mode list with top 10 markdown files sorted by mtime desc", async t => {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "markserv-recent-"));
	const baseTime = new Date("2026-01-01T00:00:00.000Z").getTime();
	let service = null;

	try {
		for (let index = 1; index <= 12; index++) {
			const fileName = `file-${String(index).padStart(2, "0")}.md`;
			const filePath = path.join(rootDir, fileName);
			fs.writeFileSync(filePath, `# ${fileName}\n`, "utf8");
			const mtime = new Date(baseTime + (index * 1000));
			fs.utimesSync(filePath, mtime, mtime);
		}

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

		const { response, body } = await fetchBody(`http://localhost:${port}/file-01.md`);
		t.is(response.statusCode, 200);
		t.true(body.includes("sidebar-recent-list"));
		t.true(body.includes("markserv.sidebarMode"));

		const recentListStart = body.indexOf("<ul class=\"sidebar-recent-list\">");
		t.true(recentListStart >= 0);
		const recentListEnd = body.indexOf("</ul>", recentListStart);
		t.true(recentListEnd > recentListStart);
		const recentListHtml = body.slice(recentListStart, recentListEnd);

		const recentItemCount = (recentListHtml.match(/class="sidebar-recent-item/g) || []).length;
		t.is(recentItemCount, 10);

		const expectedOrder = [
			"file-12.md",
			"file-11.md",
			"file-10.md",
			"file-09.md",
			"file-08.md",
			"file-07.md",
			"file-06.md",
			"file-05.md",
			"file-04.md",
			"file-03.md",
		];

		let previousIndex = -1;
		for (const fileName of expectedOrder) {
			const marker = `href="/${fileName}"`;
			const position = recentListHtml.indexOf(marker);
			t.true(position > previousIndex);
			previousIndex = position;
		}

		t.false(recentListHtml.includes("href=\"/file-01.md\""));
		t.false(recentListHtml.includes("href=\"/file-02.md\""));
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
