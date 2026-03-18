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

const assertKeyboardSidebarMarkers = (t, html) => {
	t.true(html.includes("kbd-nav-focus"));
	t.true(html.includes("kbd-nav-active-current"));
	t.true(html.includes("kbd-nav-active-different"));
	t.true(html.includes("li.isfile > a"));
	t.true(html.includes("sidebar-mode-tree"));
	t.true(html.includes("sidebar-mode-recent"));
	t.true(html.includes("sidebar-panel-recent"));
	t.true(html.includes("sidebar-recent-list"));
	t.true(html.includes("markserv.sidebarMode"));
	t.true(html.includes("getActiveNavSelector"));
	t.true(html.includes("cycleColumnFocus"));
	t.true(html.includes("COLUMN_FOCUS_CONTENT"));
	t.true(html.includes("kbd-content-focus"));
	t.true(html.includes(".nav-tree summary"));
	t.true(html.includes("stopImmediatePropagation"));
	t.true(/lowerKey === ["']b["']/.test(html));
	t.true(/lowerKey === ["']j["']/.test(html));
	t.true(/lowerKey === ["']k["']/.test(html));
	t.true(/lowerKey === ["']l["']/.test(html));
	t.true(/lowerKey === ["']enter["']/.test(html));
	t.true(html.includes("event.code"));
	t.true(html.includes("KeyJ"));
	t.true(html.includes("KeyK"));
	t.true(html.includes("ArrowDown"));
	t.true(html.includes("ArrowUp"));
	t.true(html.includes("ArrowRight"));
	t.true(html.includes("ArrowLeft"));
	t.true(html.includes("Slash"));
};

const assertMobileTreeNavMarkersForMarkdown = (t, html) => {
	t.true(html.includes("ms-mobile-tree-nav"));
	t.true(html.includes("ms-mobile-tree-prev"));
	t.true(html.includes("ms-mobile-tree-next"));
	t.true(html.includes("getTreeFileLinks"));
	t.true(html.includes("getRecentFileLinks"));
	t.true(html.includes("getCurrentTreeFileIndex"));
	t.true(html.includes("updateMobileTreeNavButtons"));
	t.true(html.includes("navigateTreeOnMobile"));
	t.true(html.includes("mobileTreePrevButton.disabled"));
	t.true(html.includes("mobileTreeNextButton.disabled"));
};

const assertNoMobileTreeNavMarkersForDirectory = (t, html) => {
	t.false(html.includes("ms-mobile-tree-nav"));
	t.false(html.includes("ms-mobile-tree-prev"));
	t.false(html.includes("ms-mobile-tree-next"));
	t.false(html.includes("updateMobileTreeNavButtons"));
};

test("renders sidebar keyboard focus mode script for markdown and directory pages", async t => {
	const port = await getPort();
	const flags = {
		dir: path.join(__dirname, ".."),
		port,
		livereloadport: false,
		address: "localhost",
		silent: true,
		browser: false,
		autoreload: false
	};

	const service = await markserv.init(flags);

	try {
		const { response: markdownResponse, body: markdownHtml } = await fetchBody(
			`http://localhost:${port}/tests/tables.md`
		);
		t.is(markdownResponse.statusCode, 200);
		assertKeyboardSidebarMarkers(t, markdownHtml);
		assertMobileTreeNavMarkersForMarkdown(t, markdownHtml);

		const { response: directoryResponse, body: directoryHtml } = await fetchBody(
			`http://localhost:${port}/tests/testdir/`
		);
		t.is(directoryResponse.statusCode, 200);
		assertKeyboardSidebarMarkers(t, directoryHtml);
		assertNoMobileTreeNavMarkersForDirectory(t, directoryHtml);
	} finally {
		await new Promise(resolve => {
			service.httpServer.close(() => {
				resolve();
			});
		});
	}
});
