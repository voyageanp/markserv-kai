import path from "path";
import request from "request";
import test from "ava";
import getPort from "get-port";
import markserv from "../lib/server";

const THEME_PALETTE = [
	{ id: "dracula", bg: "#282A36", fg: "#F8F8F2" },
	{ id: "atom-one-dark", bg: "#282C34", fg: "#ABB2BF" },
	{ id: "monokai-pro", bg: "#2D2A2E", fg: "#FCFCFA" },
	{ id: "ayu-dark", bg: "#0F1419", fg: "#E6E1CF" },
	{ id: "material-deprecated", bg: "#263238", fg: "#EEFFFF" },
	{ id: "synthwave-84", bg: "#241B2F", fg: "#F7F1FF" },
	{ id: "tokyo-night", bg: "#1A1B26", fg: "#C0CAF5" },
	{ id: "noctis", bg: "#1B1D2B", fg: "#C5C8E6" },
	{ id: "gruvbox-dark", bg: "#282828", fg: "#EBDBB2" },
	{ id: "jellyfish", bg: "#1E1E2E", fg: "#EAEAF2" },
	{ id: "tiny-light", bg: "#F8F9FB", fg: "#2A2F3A" },
	{ id: "laserwave", bg: "#120B2E", fg: "#F4EEFF" },
	{ id: "outrun", bg: "#160F29", fg: "#F3ECFF" },
	{ id: "tokyo-hack", bg: "#0B1116", fg: "#D3F6E5" },
	{ id: "vitesse-theme", bg: "#121212", fg: "#DBD7CA" },
	{ id: "pink-cat-boo", bg: "#24172A", fg: "#FFE8F4" },
	{ id: "shades-of-purple", bg: "#2D2B55", fg: "#FFFFFF" },
	{ id: "lunar-pink", bg: "#221628", fg: "#FDEBFF" },
	{ id: "xcode-default", bg: "#292A30", fg: "#ECEFF4" },
	{ id: "everforest", bg: "#2D353B", fg: "#D3C6AA" },
	{ id: "beautiful-dracula", bg: "#1E1F29", fg: "#F8F8F2" },
];

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

test("serves theme-aware css with random startup theme", async t => {
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
		const address = service.httpServer.address();
		const actualPort =
			address && typeof address === "object" ? address.port : port;
		const { response, body } = await fetchBody(
			`http://localhost:${actualPort}/lib/templates/markserv.css`
		);
		const markerMatch = body.match(/\/\* markserv-theme:([a-z\d-]+) \*\//);
		const servedThemeId = markerMatch ? markerMatch[1] : null;
		const expectedTheme = THEME_PALETTE.find((theme) => theme.id === servedThemeId);

		t.is(response.statusCode, 200);
		t.truthy(expectedTheme);
		t.true(body.includes(`--bg: ${expectedTheme.bg};`));
		t.true(body.includes(`--fg: ${expectedTheme.fg};`));
		t.true(body.includes(".hljs {"));
		t.true(body.includes("color: var(--fg);"));
	} finally {
		await new Promise(resolve => {
			service.httpServer.close(() => {
				resolve();
			});
		});
	}
});
