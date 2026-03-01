"use strict";

const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");
const os = require("os");
const chalk = require("chalk");
const opn = require("open");
const Promise = require("bluebird");
const connect = require("connect");
const less = require("less");
const send = require("send");
const liveReload = require("livereload");
const connectLiveReload = require("connect-livereload");
const implant = require("implant");
const deepmerge = require("deepmerge");
const handlebars = require("handlebars");
const MarkdownIt = require("markdown-it");
const mdItAnchor = require("markdown-it-anchor");
const mdItTaskLists = require("markdown-it-task-lists");
const mdItTOC = require("markdown-it-table-of-contents");
const mdItEmoji = require("markdown-it-emoji");
const mdItMathJax = require("markdown-it-mathjax");
const emojiRegex = require("emoji-regex")();
const analyzeDeps = require("analyze-deps");
const promptly = require("promptly");
const isOnline = require("is-online");

const pkg = require(path.join("..", "package.json"));

const style = {
	link: chalk.blueBright.underline.italic,
	github: chalk.blue.underline.italic,
	address: chalk.greenBright.underline.italic,
	port: chalk.reset.cyanBright,
	pid: chalk.reset.cyanBright,
};

const MARKSERV_LIVE_RELOAD_PORT_MIN = 35_729;
const MARKSERV_LIVE_RELOAD_PORT_MAX = 35_739;
const MAX_EDIT_REQUEST_BODY_BYTES = 1_048_576;

const slugify = (text) => (
	text
		.toLowerCase()
		.replaceAll(/\s/g, "-")
	// Remove punctuations other than hyphen and underscore
		.replaceAll(
			/[`~!@#$%^&*()+=<>?,./:;"'|{}[\]\\\u2000-\u206F\u2E00-\u2E7F]/g,
			"",
		)
	// Remove emojis
		.replace(emojiRegex, "")
	// Remove CJK punctuations
		.replaceAll(
			/[\u3000。？！，、；：“”【】（）〔〕［］﹃﹄‘’﹁﹂—…－～《》〈〉「」]/g,
			"",
		)
);

// Markdown Extension Types
const fileTypes = {
	markdown: [
		".markdown",
		".mdown",
		".mkdn",
		".md",
		".mkd",
		".mdwn",
		".mdtxt",
		".mdtext",
		".text",
	],

	html: [".html", ".htm"],

	watch: [
		".sass",
		".less",
		".js",
		".css",
		".json",
		".gif",
		".png",
		".jpg",
		".jpeg",
	],

	exclusions: ["node_modules/", ".git/"],
};

const md = new MarkdownIt({
	linkify: false,
	html: true,
	highlight(str, lang) {
		const hljs = require("highlight.js");
		if (lang && hljs.getLanguage(lang)) {
			try {
				return hljs.highlight(str, { language: lang }).value;
			} catch {}
		}

		return ""; // use internal default escaping
	},
})
	.use(mdItAnchor, { slugify })
	.use(mdItTaskLists)
	.use(mdItEmoji)
	.use(mdItMathJax())
	.use(mdItTOC, {
		includeLevel: [1, 2, 3, 4, 5, 6],
		slugify,
	});

// Custom link renderer to only allow .md and web links
const defaultLinkOpenRender =
	md.renderer.rules.link_open ||
	((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
	const aIndex = tokens[idx].attrIndex("href");
	if (aIndex >= 0) {
		const href = tokens[idx].attrs[aIndex][1];
		const isWebLink = /^(https?|mailto|tel):/i.test(href);

		// Remove query and fragments for extension check
		const cleanHref = href.split(/[?#]/)[0];
		const isMdLink = fileTypes.markdown.some((ext) =>
			cleanHref.toLowerCase().endsWith(ext),
		);
		const isAnchor = href.startsWith("#");

		if (!isWebLink && !isMdLink && !isAnchor) {
			tokens[idx].hidden = true;
			// Find matching link_close
			let level = 1;
			for (let i = idx + 1; i < tokens.length; i++) {
				if (tokens[i].type === "link_open") {
					level++;
				}

				if (tokens[i].type === "link_close") {
					level--;
				}

				if (level === 0) {
					tokens[i].hidden = true;
					break;
				}
			}

			return "";
		}
	}

	return defaultLinkOpenRender(tokens, idx, options, env, self);
};

const defaultLinkCloseRender =
	md.renderer.rules.link_close ||
	((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_close = (tokens, idx, options, env, self) => {
	if (tokens[idx].hidden) {
		return "";
	}

	return defaultLinkCloseRender(tokens, idx, options, env, self);
};

fileTypes.watch = fileTypes.watch
	.concat(fileTypes.markdown)
	.concat(fileTypes.html);

const materialIcons = require(
	path.join(__dirname, "icons", "material-icons.json"),
);

const faviconPath = path.join(__dirname, "icons", "markserv.svg");
const faviconData = fs.readFileSync(faviconPath);

const log = (str, flags, err) => {
	if (flags && flags.silent) {
		return;
	}

	if (str) {
		console.log(str);
	}

	if (err) {
		console.error(err);
	}
};

const msg = (type, msg, flags) => {
	if (type === "github") {
		return log(chalk`{bgYellow.black     GitHub  } ` + msg, flags);
	}

	log(chalk`{bgGreen.black   Markserv  }{white  ${type}: }` + msg, flags);
};

const errormsg = (type, msg, flags, err) =>
	log(chalk`{bgRed.white   Markserv  }{red  ${type}: }` + msg, flags, err);

const warnmsg = (type, msg, flags, err) =>
	log(chalk`{bgYellow.black   Markserv  }{yellow  ${type}: }` + msg, flags, err);

const isType = (exts, filePath) => {
	const fileExt = path.parse(filePath).ext;
	return exts.includes(fileExt);
};

const isFalseFlag = (value) => value === false || value === "false";

const parsePort = (value) => {
	if (typeof value === "number" && Number.isInteger(value)) {
		return value;
	}

	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isInteger(parsed)) {
			return parsed;
		}
	}

	return false;
};

const isValidPort = (value) =>
	Number.isInteger(value) && value > 0 && value <= 65_535;

const isPortAvailable = (port) =>
	new Promise((resolve) => {
		const probe = net.createServer();
		probe.unref();

		probe.once("error", () => {
			resolve(false);
		});

		probe.once("listening", () => {
			probe.close(() => {
				resolve(true);
			});
		});

		probe.listen(port);
	});

const getEphemeralPort = () =>
	new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.unref();

		probe.once("error", reject);
		probe.listen(0, () => {
			const addressInfo = probe.address();
			const port =
				addressInfo && typeof addressInfo === "object"
					? addressInfo.port
					: false;
			probe.close(() => resolve(port));
		});
	});

const resolveLiveReloadPort = async (requestedPort, flags) => {
	const parsedRequestedPort = parsePort(requestedPort);
	const candidatePorts = [];
	const checkedPorts = new Set();

	if (isValidPort(parsedRequestedPort)) {
		candidatePorts.push(parsedRequestedPort);
		checkedPorts.add(parsedRequestedPort);
	}

	for (
		let port = MARKSERV_LIVE_RELOAD_PORT_MIN;
		port <= MARKSERV_LIVE_RELOAD_PORT_MAX;
		port++
	) {
		if (!checkedPorts.has(port)) {
			candidatePorts.push(port);
		}
	}

	for (const port of candidatePorts) {
		// eslint-disable-next-line no-await-in-loop
		if (await isPortAvailable(port)) {
			if (
				isValidPort(parsedRequestedPort) &&
				port !== parsedRequestedPort
			) {
				warnmsg(
					"livereload",
					`port ${parsedRequestedPort} is in use, fallback to ${port}`,
					flags,
				);
			}

			return port;
		}
	}

	const fallbackPort = await getEphemeralPort();
	if (!isValidPort(fallbackPort)) {
		throw new Error("Could not allocate a free LiveReload port.");
	}

	warnmsg(
		"livereload",
		`ports ${MARKSERV_LIVE_RELOAD_PORT_MIN}-${MARKSERV_LIVE_RELOAD_PORT_MAX} are in use, fallback to ${fallbackPort}`,
		flags,
	);

	return fallbackPort;
};

const getMarkdownLineParts = (markdownText) => {
	const hasTrailingNewline = markdownText.endsWith("\n");
	const newline = markdownText.includes("\r\n") ? "\r\n" : "\n";
	const lines = markdownText.length === 0 ? [] : markdownText.split(/\r?\n/);

	if (hasTrailingNewline) {
		lines.pop();
	}

	return {
		lines,
		hasTrailingNewline,
		newline,
	};
};

const joinMarkdownLines = (lines, newline, hasTrailingNewline) => {
	let output = lines.join(newline);
	if (hasTrailingNewline) {
		output += newline;
	}

	return output;
};

const collectMarkdownSectionsFromTokens = (markdownText, tokens, setIndexAttr) => {
	const { lines } = getMarkdownLineParts(markdownText);
	const sections = [];
	let sectionIndex = 0;

	for (const token of tokens) {
		if (
			!token.block ||
			token.nesting !== 1 ||
			token.level !== 0 ||
			!Array.isArray(token.map)
		) {
			continue;
		}

		const [startLine, endLine] = token.map;
		if (setIndexAttr) {
			token.attrSet("data-ms-section-index", String(sectionIndex));
		}

		sections.push({
			index: sectionIndex,
			startLine,
			endLine,
			rawMarkdown: lines.slice(startLine, endLine).join("\n"),
		});
		sectionIndex++;
	}

	return sections;
};

const renderMarkdownWithSections = (markdownText) => {
	const tokens = md.parse(markdownText, {});
	const sections = collectMarkdownSectionsFromTokens(markdownText, tokens, true);
	const html = md.renderer.render(tokens, md.options, {});

	return {
		html,
		sections,
	};
};

const getMarkdownSections = (markdownText) => {
	const tokens = md.parse(markdownText, {});
	return collectMarkdownSectionsFromTokens(markdownText, tokens, false);
};

const toPosixPath = (filePath) => filePath.split(path.sep).join("/");

const toEditableRequestPath = (rootDir, absoluteFilePath) =>
	"/" + toPosixPath(path.relative(rootDir, absoluteFilePath));

const toScriptJson = (value) =>
	JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");

const sendJson = (res, statusCode, payload) => {
	res.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
	});
	res.end(JSON.stringify(payload));
};

const readJsonRequestBody = (req, maxBytes = MAX_EDIT_REQUEST_BODY_BYTES) =>
	new Promise((resolve, reject) => {
		let size = 0;
		let body = "";
		let settled = false;

		const finish = (err, value) => {
			if (settled) {
				return;
			}

			settled = true;
			if (err) {
				reject(err);
				return;
			}

			resolve(value);
		};

		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > maxBytes) {
				finish(new Error("Request body is too large."));
				return;
			}

			body += chunk.toString("utf8");
		});

		req.on("end", () => {
			if (size > maxBytes) {
				return;
			}

			try {
				const parsed = body.length > 0 ? JSON.parse(body) : {};
				finish(null, parsed);
			} catch (error) {
				finish(error);
			}
		});

		req.on("error", (error) => {
			finish(error);
		});
	});

// MarkdownToHTML: turns a Markdown file into HTML content
const markdownToHTML = (markdownText) =>
	new Promise((resolve, reject) => {
		let result;

		try {
			result = md.render(markdownText);
		} catch (error) {
			return reject(error);
		}

		resolve(result);
	});

// GetFile: reads utf8 content from a file
const getFile = (path) =>
	new Promise((resolve, reject) => {
		fs.readFile(path, "utf8", (err, data) => {
			if (err) {
				return reject(err);
			}

			resolve(data);
		});
	});

// Get Custom Less CSS to use in all Markdown files
const buildLessStyleSheet = (cssPath) =>
	getFile(cssPath)
		.then((data) => less.render(data))
		.then((data) => data.css);

const baseTemplate = (templateUrl, handlebarData) =>
	new Promise((resolve, reject) => {
		getFile(templateUrl)
			.then((source) => {
				const template = handlebars.compile(source);
				const output = template(handlebarData);
				resolve(output);
			})
			.catch(reject);
	});

const lookUpIconClass = (path, type) => {
	let iconDef;

	if (type === "folder") {
		iconDef = materialIcons.folderNames[path];

		if (!iconDef) {
			iconDef = "folder";
		}
	}

	if (type === "file") {
		// Try extensions first
		const ext = path.slice(path.lastIndexOf(".") + 1);
		iconDef = materialIcons.fileExtensions[ext];

		// Then try applying the filename
		if (!iconDef) {
			iconDef = materialIcons.fileNames[path];
		}

		if (!iconDef) {
			iconDef = "file";
		}
	}

	return iconDef;
};

const dirToHtml = (filePath) => {
	const urls = fs.readdirSync(filePath);

	let list = "<ul>\n";

	let prettyPath = "/" + path.relative(process.cwd(), filePath);
	if (prettyPath[prettyPath.length] !== "/") {
		prettyPath += "/";
	}

	if (prettyPath.slice(-2, 2) === "//") {
		prettyPath = prettyPath.slice(0, -1);
	}

	for (const subPath of urls) {
		if (subPath.charAt(0) === ".") {
			continue;
		}

		const dir = fs.statSync(path.join(filePath, subPath)).isDirectory();
		let href;
		if (dir) {
			href = subPath + "/";
			list += `\t<li class="folder"><a href="${href}">${href}</a></li> \n`;
		} else {
			if (!isType(fileTypes.markdown, path.join(filePath, subPath))) {
				continue;
			}

			href = subPath;
			lookUpIconClass(href, "file");
			list += `\t<li class="isfile"><a href="${href}">${href}</a></li> \n`;
		}
	}

	list += "</ul>\n";

	return list;
};

const buildNavTreeHtml = (rootDir, currentDir, flags, basePath = "/") => {
	const excludeDirs = new Set(["node_modules"]);
	const { showalldir } = flags;

	const readDirRecursive = (dir, pathPrefix) => {
		let result = "";
		let urls;
		try {
			urls = fs.readdirSync(dir);
		} catch {
			return { html: "", hasMd: false };
		}

		const subDirs = [];
		const mdFiles = [];
		let hasMdInThisDir = false;

		for (const subPath of urls) {
			if (subPath.charAt(0) === ".") {
				continue;
			}

			if (excludeDirs.has(subPath)) {
				continue;
			}

			const fullPath = path.join(dir, subPath);
			try {
				const isDir = fs.statSync(fullPath).isDirectory();
				if (isDir) {
					subDirs.push(subPath);
				} else if (isType(fileTypes.markdown, fullPath)) {
					mdFiles.push(subPath);
					hasMdInThisDir = true;
				}
			} catch {}
		}

		subDirs.sort();
		mdFiles.sort();

		let childrenHtml = "";
		let anyChildHasMd = hasMdInThisDir;

		for (const subDir of subDirs) {
			const fullSubPath = path.join(dir, subDir);
			const res = readDirRecursive(fullSubPath, pathPrefix + subDir + "/");
			if (res.hasMd || showalldir) {
				const isOpen =
					currentDir === fullSubPath ||
					currentDir.startsWith(fullSubPath + path.sep);
				childrenHtml += `\t<li><details ${isOpen ? "open" : ""}><summary class="folder"><span>${subDir}</span></summary>\n`;
				childrenHtml += res.html;
				childrenHtml += "\t</details></li>\n";
				if (res.hasMd) {
					anyChildHasMd = true;
				}
			}
		}

		for (const mdFile of mdFiles) {
			const href = pathPrefix + mdFile;
			lookUpIconClass(href, "file");
			const isCurrent = currentDir === path.join(dir, mdFile);
			childrenHtml += `\t<li class="isfile ${isCurrent ? "current" : ""}"><a href="${href}">${mdFile}</a></li>\n`;
		}

		if (childrenHtml) {
			result = "<ul class=\"nav-tree\">\n" + childrenHtml + "</ul>\n";
		}

		return { html: result, hasMd: anyChildHasMd };
	};

	const finalResult = readDirRecursive(rootDir, basePath);
	return finalResult.hasMd || showalldir ? finalResult.html : "";
};

// Remove URL params from file being fetched
const getPathFromUrl = (url) => url.split(/[?#]/)[0];

const markservPageObject = {
	lib(dir, opts) {
		const relPath = path.join("lib", opts.rootRelUrl);
		return relPath;
	},
};

const secureUrl = (url) => {
	const encodedUrl = encodeURI(url.replaceAll("%", "%25"));
	return encodedUrl;
};

// Create breadcrumb trail tracks
const createBreadcrumbs = (path) => {
	const crumbs = [
		{
			href: "/",
			text: "./",
		},
	];

	const dirParts = path.replaceAll(/(^\/+|\/+$)/g, "").split("/");
	const urlParts = dirParts.map(secureUrl);

	if (path.length === 0) {
		return crumbs;
	}

	let collectPath = "/";

	for (const [i, dirName] of dirParts.entries()) {
		const fullLink = collectPath + urlParts[i] + "/";

		const crumb = {
			href: fullLink,
			text: dirName + "/",
		};

		crumbs.push(crumb);
		collectPath = fullLink;
	}

	return crumbs;
};

const normalizeEditableFilePath = (rootDir, requestPath) => {
	if (typeof requestPath !== "string" || requestPath.trim() === "") {
		return false;
	}

	const rawPath = requestPath.startsWith("/") ? requestPath.slice(1) : requestPath;
	let decodedPath;
	try {
		decodedPath = decodeURIComponent(rawPath);
	} catch {
		return false;
	}

	const absoluteRootDir = path.resolve(rootDir);
	const absolutePath = path.resolve(absoluteRootDir, decodedPath);
	if (
		absolutePath !== absoluteRootDir &&
		!absolutePath.startsWith(absoluteRootDir + path.sep)
	) {
		return false;
	}

	return absolutePath;
};

const isSectionEditAction = (action) =>
	action === "update_section" || action === "insert_section_after";

const isDocumentEditAction = (action) => action === "update_document";

// eslint-disable-next-line complexity
const applyMarkdownEdit = ({ rootDir, payload }) => {
	const {
		action,
		filePath: requestFilePath,
		sectionIndex,
		markdown,
		baseMtimeMs,
	} = payload || {};

	if (!isSectionEditAction(action) && !isDocumentEditAction(action)) {
		return {
			statusCode: 400,
			payload: { ok: false, error: "Unsupported edit action." },
		};
	}

	if (
		isSectionEditAction(action) &&
		(!Number.isInteger(sectionIndex) || sectionIndex < 0)
	) {
		return {
			statusCode: 400,
			payload: { ok: false, error: "sectionIndex must be a non-negative integer." },
		};
	}

	if (typeof markdown !== "string") {
		return {
			statusCode: 400,
			payload: { ok: false, error: "markdown must be a string." },
		};
	}

	if (!Number.isFinite(baseMtimeMs)) {
		return {
			statusCode: 400,
			payload: { ok: false, error: "baseMtimeMs must be a number." },
		};
	}

	const absoluteFilePath = normalizeEditableFilePath(rootDir, requestFilePath);
	if (!absoluteFilePath || !isType(fileTypes.markdown, absoluteFilePath)) {
		return {
			statusCode: 400,
			payload: { ok: false, error: "filePath must point to a Markdown file." },
		};
	}

	let stat;
	try {
		stat = fs.statSync(absoluteFilePath);
	} catch (error) {
		if (error.code === "ENOENT") {
			return {
				statusCode: 404,
				payload: { ok: false, error: "Markdown file does not exist." },
			};
		}

		return {
			statusCode: 500,
			payload: { ok: false, error: "Could not access the Markdown file." },
		};
	}

	if (!stat.isFile()) {
		return {
			statusCode: 400,
			payload: { ok: false, error: "filePath must be a file." },
		};
	}

	if (stat.mtimeMs !== baseMtimeMs) {
		return {
			statusCode: 409,
			payload: {
				ok: false,
				error: "Markdown file changed on disk. Reload before saving.",
				mtimeMs: stat.mtimeMs,
			},
		};
	}

	let markdownSource;
	try {
		markdownSource = fs.readFileSync(absoluteFilePath, "utf8");
	} catch {
		return {
			statusCode: 500,
			payload: { ok: false, error: "Could not read the Markdown file." },
		};
	}

	let nextSource;
	if (isDocumentEditAction(action)) {
		nextSource = markdown;
	} else {
		const sections = getMarkdownSections(markdownSource);
		const targetSection = sections[sectionIndex];
		if (!targetSection) {
			return {
				statusCode: 404,
				payload: { ok: false, error: "sectionIndex is out of range." },
			};
		}

		if (action === "insert_section_after" && markdown.trim() === "") {
			return {
				statusCode: 200,
				payload: {
					ok: true,
					saved: false,
					mtimeMs: stat.mtimeMs,
				},
			};
		}

		const { lines, newline, hasTrailingNewline } = getMarkdownLineParts(markdownSource);
		const replacementLines = markdown.length === 0 ? [] : markdown.split(/\r?\n/);
		let nextLines;

		if (action === "update_section") {
			nextLines = [
				...lines.slice(0, targetSection.startLine),
				...replacementLines,
				...lines.slice(targetSection.endLine),
			];
		} else {
			nextLines = [
				...lines.slice(0, targetSection.endLine),
				"",
				...replacementLines,
				...lines.slice(targetSection.endLine),
			];
		}

		nextSource = joinMarkdownLines(nextLines, newline, hasTrailingNewline);
	}

	if (nextSource === markdownSource) {
		return {
			statusCode: 200,
			payload: {
				ok: true,
				saved: false,
				mtimeMs: stat.mtimeMs,
			},
		};
	}

	try {
		fs.writeFileSync(absoluteFilePath, nextSource, "utf8");
	} catch {
		return {
			statusCode: 500,
			payload: { ok: false, error: "Could not write to the Markdown file." },
		};
	}

	let nextStat;
	try {
		nextStat = fs.statSync(absoluteFilePath);
	} catch {
		return {
			statusCode: 500,
			payload: { ok: false, error: "Could not read updated file metadata." },
		};
	}

	return {
		statusCode: 200,
		payload: {
			ok: true,
			saved: true,
			mtimeMs: nextStat.mtimeMs,
		},
	};
};

// Http_request_handler: handles all the browser requests
const createRequestHandler = (flags) => {
	let { dir } = flags;
	const isDir = fs.statSync(dir).isDirectory();
	if (!isDir) {
		dir = path.parse(flags.dir).dir;
	}

	flags.$openLocation = path.relative(dir, flags.dir);

	const implantOpts = {
		maxDepth: 10,
	};

	const implantHandlers = {
		markserv: (prop) =>
			new Promise((resolve) => {
				if (Reflect.has(markservPageObject, prop)) {
					const value = path.relative(dir, __dirname);
					return resolve(value);
				}

				resolve(false);
			}),

		file: (url, opts) =>
			new Promise((resolve) => {
				const absUrl = path.join(opts.baseDir, url);
				getFile(absUrl)
					.then((data) => {
						msg("implant", style.link(absUrl), flags);
						resolve(data);
					})
					.catch((error) => {
						warnmsg(
							"implant 404",
							style.link(absUrl),
							flags,
							error,
						);
						resolve(false);
					});
			}),

		less: (url, opts) =>
			new Promise((resolve) => {
				const absUrl = path.join(opts.baseDir, url);
				buildLessStyleSheet(absUrl)
					.then((data) => {
						msg("implant", style.link(absUrl), flags);
						resolve(data);
					})
					.catch((error) => {
						warnmsg(
							"implant 404",
							style.link(absUrl),
							flags,
							error,
						);
						resolve(false);
					});
			}),

		markdown: (url, opts) =>
			new Promise((resolve) => {
				const absUrl = path.join(opts.baseDir, url);
				getFile(absUrl)
					.then(markdownToHTML)
					.then((data) => {
						msg("implant", style.link(absUrl), flags);
						resolve(data);
					})
					.catch((error) => {
						warnmsg(
							"implant 404",
							style.link(absUrl),
							flags,
							error,
						);
						resolve(false);
					});
			}),

		html: (url, opts) =>
			new Promise((resolve) => {
				const absUrl = path.join(opts.baseDir, url);
				getFile(absUrl)
					.then((data) => {
						msg("implant", style.link(absUrl), flags);
						resolve(data);
					})
					.catch((error) => {
						warnmsg(
							"implant 404",
							style.link(absUrl),
							flags,
							error,
						);
						resolve(false);
					});
			}),
	};

	const markservUrlLead = "%7Bmarkserv%7D";

	return (req, res) => {
		const requestUrl = req.originalUrl || req.url || "/";
		let decodedUrl;
		try {
			decodedUrl = getPathFromUrl(decodeURIComponent(requestUrl));
		} catch {
			decodedUrl = getPathFromUrl(requestUrl);
		}

		if (req.method === "POST" && decodedUrl === "/__markserv/edit") {
			readJsonRequestBody(req)
				.then((payload) => {
					const result = applyMarkdownEdit({
						rootDir: dir,
						payload,
					});
					sendJson(res, result.statusCode, result.payload);
				})
				.catch((error) => {
					sendJson(res, 400, {
						ok: false,
						error: error.message || "Invalid JSON payload.",
					});
				});
			return;
		}

		const filePath = path.normalize(unescape(dir) + unescape(decodedUrl));
		const baseDir = path.parse(filePath).dir;
		implantOpts.baseDir = baseDir;

		const errorPage = (code, filePath, err) => {
			errormsg(code, filePath, flags, err);

			const templateUrl = path.join(__dirname, "templates/error.html");
			const fileName = path.parse(filePath).base;
			const referer = unescape(
				req.headers.referer || path.parse(decodedUrl).dir + "/",
			);
			const errorMsg = md.utils.escapeHtml(err.message);
			const errorStack = md.utils.escapeHtml(String(err.stack));

			const handlebarData = {
				pid: process.pid || "N/A",
				code,
				fileName,
				filePath,
				errorMsg,
				errorStack,
				referer,
			};

			return baseTemplate(templateUrl, handlebarData).then((final) => {
				res.writeHead(200, {
					"content-type": "text/html; charset=utf-8",
				});
				res.end(final);
			});
		};

		if (flags.verbose) {
			msg("request", filePath, flags);
		}

		const isMarkservUrl = req.url.includes(markservUrlLead);
		if (isMarkservUrl) {
			const markservFilePath = req.url.split(markservUrlLead)[1];
			const markservRelFilePath = path.join(__dirname, markservFilePath);
			if (flags.verbose) {
				msg("{markserv url}", style.link(markservRelFilePath), flags);
			}

			send(req, markservRelFilePath).pipe(res);
			return;
		}

		const prettyPath = filePath;

		let stat;
		let isDir;
		let isMarkdown;
		let isHtml;

		try {
			stat = fs.statSync(filePath);
			isDir = stat.isDirectory();
			if (!isDir) {
				isMarkdown = isType(fileTypes.markdown, filePath);
				isHtml = isType(fileTypes.html, filePath);
			}
		} catch (error) {
			const fileName = path.parse(filePath).base;
			if (fileName === "favicon.ico") {
				res.writeHead(200, { "Content-Type": "image/x-icon" });
				res.write(faviconData);
				res.end();
				return;
			}

			errormsg("404", filePath, flags, error);
			errorPage(404, filePath, error);
			return;
		}

		// Markdown: Browser is requesting a Markdown file
		if (isMarkdown) {
			msg("markdown", style.link(prettyPath), flags);
			getFile(filePath)
				.then((markdownSource) => {
					const rendered = renderMarkdownWithSections(markdownSource);
					const editData = {
						filePath: toEditableRequestPath(dir, filePath),
						mtimeMs: stat.mtimeMs,
						documentMarkdown: markdownSource,
						sections: rendered.sections,
					};

					return implant(
						rendered.html,
						implantHandlers,
						implantOpts,
					).then((output) => ({
						output,
						editDataJson: toScriptJson(editData),
					}));
				})
				.then(({ output, editDataJson }) => {
					const templateUrl = path.join(
						__dirname,
						"templates/markdown.html",
					);
					const navTree = buildNavTreeHtml(
						dir,
						filePath,
						flags,
						"/",
					);

					const handlebarData = {
						title: path.parse(filePath).base,
						content: output,
						navTree,
						rootDirStem: path.basename(path.resolve(dir)),
						hasSidebar: true,
						hasNavTree: navTree !== "",
						editDataJson,
						pid: process.pid || "N/A",
					};

					return baseTemplate(
						templateUrl,
						handlebarData,
					).then((final) => {
						const lvl2Dir = path.parse(templateUrl).dir;
						const lvl2Opts = deepmerge(implantOpts, {
							baseDir: lvl2Dir,
						});

						return implant(
							final,
							implantHandlers,
							lvl2Opts,
						).then((output) => {
							res.writeHead(200, {
								"content-type": "text/html",
							});
							res.end(output);
						});
					});
				})
				.catch((error) => {
					console.error(error);
				});
		} else if (isHtml) {
			msg("html", style.link(prettyPath), flags);
			getFile(filePath)
				.then((html) => implant(html, implantHandlers, implantOpts).then(
					(output) => {
						res.writeHead(200, {
							"content-type": "text/html",
						});
						res.end(output);
					},
				))
				.catch((error) => {
					console.error(error);
				});
		} else if (isDir) {
			try {
				// Index: Browser is requesting a Directory Index
				msg("dir", style.link(prettyPath), flags);

				const templateUrl = path.join(
					__dirname,
					"templates/directory.html",
				);
				const navTree = buildNavTreeHtml(dir, filePath, flags, "/");

				const handlebarData = {
					dirname: path.parse(filePath).dir,
					content: dirToHtml(filePath),
					title: path.parse(filePath).base,
					navTree,
					rootDirStem: path.basename(path.resolve(dir)),
					hasSidebar: true,
					hasNavTree: navTree !== "",
					pid: process.pid || "N/A",
					breadcrumbs: createBreadcrumbs(
						path.relative(dir, filePath),
					),
				};

				return baseTemplate(templateUrl, handlebarData).then(
					(final) => {
						const lvl2Dir = path.parse(templateUrl).dir;
						const lvl2Opts = deepmerge(implantOpts, {
							baseDir: lvl2Dir,
						});
						return implant(final, implantHandlers, lvl2Opts)
							.then((output) => {
								res.writeHead(200, {
									"content-type": "text/html",
								});
								res.end(output);
							})
							.catch((error) => {
								console.error(error);
							});
					},
				);
			} catch (error) {
				errorPage(500, filePath, error);
			}
		} else {
			// Other: Browser requests other MIME typed file (handled by 'send')
			msg("file", style.link(prettyPath), flags);
			send(req, filePath, { dotfiles: "allow" }).pipe(res);
		}
	};
};

const startConnectApp = (liveReloadPort, httpRequestHandler) => {
	const connectApp = connect();

	if (isValidPort(liveReloadPort)) {
		connectApp.use(
			connectLiveReload({
				port: liveReloadPort,
			}),
		);
	}

	return connectApp.use("/", httpRequestHandler);
};

const listen = (server, port, host) =>
	new Promise((resolve, reject) => {
		const onError = (error) => {
			server.off("listening", onListening);
			reject(error);
		};

		const onListening = () => {
			server.off("error", onError);
			resolve();
		};

		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});

const startHTTPServer = async (connectApp, requestedPort, flags) => {
	const parsedRequestedPort = parsePort(requestedPort);
	if (!isValidPort(parsedRequestedPort)) {
		throw new Error(`Invalid port: ${requestedPort}`);
	}

	const portWasExplicitlyProvided = flags && flags.$portProvided === true;

	const makeHttpServer = () => (
		connectApp ? http.createServer(connectApp) : http.createServer()
	);

	const candidatePorts = [parsedRequestedPort];
	if (!portWasExplicitlyProvided) {
		const maxAttempts = 10;
		for (
			let port = parsedRequestedPort + 1;
			port <= 65_535 && candidatePorts.length < maxAttempts;
			port++
		) {
			candidatePorts.push(port);
		}
	}

	let lastError;
	for (const port of candidatePorts) {
		const httpServer = makeHttpServer();

		try {
			// eslint-disable-next-line no-await-in-loop
			await listen(httpServer, port, flags.address);

			if (port !== parsedRequestedPort) {
				warnmsg(
					"server",
					`port ${parsedRequestedPort} is in use, fallback to ${port}`,
					flags,
				);
			}

			httpServer.on("error", (error) => {
				errormsg("server", error.message, flags, error);
			});

			return { httpServer, port };
		} catch (error) {
			lastError = error;

			if (error && error.code === "EADDRINUSE") {
				continue;
			}

			throw error;
		}
	}

	if (
		!portWasExplicitlyProvided &&
		lastError &&
		lastError.code === "EADDRINUSE"
	) {
		const ephemeralPort = await getEphemeralPort();
		if (!isValidPort(ephemeralPort)) {
			throw lastError;
		}

		const httpServer = makeHttpServer();
		await listen(httpServer, ephemeralPort, flags.address);
		warnmsg(
			"server",
			`port ${parsedRequestedPort} is in use, fallback to ${ephemeralPort}`,
			flags,
		);

		httpServer.on("error", (error) => {
			errormsg("server", error.message, flags, error);
		});

		return { httpServer, port: ephemeralPort };
	}

	if (
		portWasExplicitlyProvided &&
		lastError &&
		lastError.code === "EADDRINUSE"
	) {
		const error = new Error(
			`Port ${parsedRequestedPort} is already in use. Try another port with -p/--port, or stop the process using it.`,
		);
		error.code = lastError.code;
		error.errno = lastError.errno;
		error.syscall = lastError.syscall;
		error.address = lastError.address;
		error.port = lastError.port;
		throw error;
	}

	throw lastError || new Error("Could not start HTTP server.");
};

const startLiveReloadServer = (liveReloadPort, flags) => {
	let { dir } = flags;
	const isDir = fs.statSync(dir).isDirectory();
	if (!isDir) {
		dir = path.parse(flags.dir).dir;
	}

	const exts = fileTypes.watch.map((type) => type.slice(1));
	const exclusions = fileTypes.exclusions.map((exPath) => path.join(dir, exPath));

	return liveReload
		.createServer({
			exts,
			exclusions,
			port: liveReloadPort,
		})
		.watch(path.resolve(dir));
};

const logActiveServerInfo = async (
	serveURL,
	httpPort,
	liveReloadPort,
	flags,
) => {
	const dir = path.resolve(flags.dir);

	const githubLink = "github.com/markserv";

	msg("address", style.address(serveURL), flags);

	if (flags.address === "0.0.0.0") {
		const interfaces = os.networkInterfaces();
		for (const name of Object.keys(interfaces)) {
			for (const iface of interfaces[name]) {
				if (iface.family === "IPv4" && !iface.internal) {
					msg(
						"address",
						style.address(`http://${iface.address}:${httpPort}`),
						flags,
					);
				}
			}
		}
	}

	msg("path", chalk`{grey ${style.address(dir)}}`, flags);
	if (isValidPort(liveReloadPort)) {
		msg(
			"livereload",
			chalk`{grey communicating on port: ${style.port(liveReloadPort)}}`,
			flags,
		);
	} else {
		msg("livereload", chalk`{grey disabled}`, flags);
	}

	if (process.pid) {
		msg(
			"process",
			chalk`{grey your pid is: ${style.pid(process.pid)}}`,
			flags,
		);
		msg(
			"stop",
			chalk`{grey press {magenta [Ctrl + C]} or type {magenta "sudo kill -9 ${process.pid}"}}`,
			flags,
		);
	}

	msg(
		"github",
		chalk`Contribute on Github - {yellow.underline ${githubLink}}`,
		flags,
	);
};

const checkForUpgrade = () =>
	new Promise((resolve, reject) => {
		const packageJson = {
			dependencies: {
				markserv: pkg.version,
			},
		};

		analyzeDeps(packageJson)
			.then((analysis) => {
				const { latest } = analysis.dependencies.markserv;

				switch (analysis.dependencies.markserv.status) {
					case "error": {
						resolve(false);
						break;
					}

					case "latest": {
						resolve(false);
						break;
					}

					case "not-latest": {
						resolve(latest);
						break;
					}

					default: {
						resolve(false);
						break;
					}
				}
			})
			.catch((error) => {
				console.log("err");
				reject(error);
			});
	});

const doUpgrade = (newerVersion, flags) => {
	const { spawn } = require("child_process");

	msg(chalk.bgRed("✨UPGRADE✨"), "Upgrade beginning...", flags);
	const ls = spawn("npm", ["i", "-g", `markserv@${newerVersion}`], {
		stdio: [0, 1, 2],
	});

	ls.on("exit", (code) => {
		if (code) {
			return msg(
				chalk.bgRed("✨UPGRADE✨"),
				"Markserv could not upgrade.",
				flags,
			);
		}

		msg(chalk.bgRed("✨UPGRADE✨"), "Upgrade finished!", flags);
	});
};

const optionalUpgrade = async (flags) => {
	if (flags.silent) {
		return;
	}

	msg("upgrade", "checking for upgrade...", flags);

	return checkForUpgrade(flags)
		.then(async (version) => {
			if (version === false) {
				msg("upgrade", "no upgrade available", flags);
				return;
			}

			msg(
				chalk.bgRed("✨UPGRADE✨"),
				`Markserv version: ${version} is available!`,
				flags,
			);

			const logInstallNotes = () => {
				msg(
					chalk.bgRed("✨UPGRADE✨"),
					"Upgrade cancelled. To upgrade manually:",
					flags,
				);
				msg(
					chalk.bgRed("✨UPGRADE✨"),
					chalk`{bgYellow.black.bold  npm i -g markserv@${version} }`,
					flags,
				);
				msg(
					chalk.bgRed("✨UPGRADE✨"),
					chalk`{bgYellow.black.bold  yarn global add markserv@${version} }`,
					flags,
				);
			};

			const choice = await promptly.choose(
				chalk`{bgGreen.black   Markserv  } {bgRed ✨UPGRADE✨}: Do you want to upgrade automatically? (y/n)`,
				["y", "n"],
			);

			if (choice === "y") {
				return doUpgrade(version, flags);
			}

			logInstallNotes();
		})
		.catch((error) => {
			console.error(error);
		});
};

const init = async (flags) => {
	const liveReloadEnabled =
		!isFalseFlag(flags.livereloadport) && !isFalseFlag(flags.autoreload);
	const liveReloadPort = liveReloadEnabled
		? await resolveLiveReloadPort(flags.livereloadport, flags)
		: false;
	const requestedHttpPort = flags.port;

	const httpRequestHandler = createRequestHandler(flags);
	const connectApp = startConnectApp(liveReloadPort, httpRequestHandler);
	const { httpServer, port: httpPort } = await startHTTPServer(
		connectApp,
		requestedHttpPort,
		flags,
	);

	let liveReloadServer;
	if (isValidPort(liveReloadPort)) {
		liveReloadServer = await startLiveReloadServer(liveReloadPort, flags);
	}

	const serveURL = "http://" + flags.address + ":" + httpPort;

	// Log server info to CLI
	logActiveServerInfo(serveURL, httpPort, liveReloadPort, flags);

	let launchUrl = false;
	if (flags.$openLocation || flags.$pathProvided) {
		launchUrl = serveURL + "/" + flags.$openLocation;
	}

	const service = {
		pid: process.pid,
		httpServer,
		liveReloadServer,
		liveReloadPort,
		connectApp,
		launchUrl,
	};

	const launchBrowser = () => {
		if (flags.browser === false || flags.browser === "false") {
			return;
		}

		if (launchUrl) {
			opn(launchUrl);
		}
	};

	// Only check for upgrades when online
	isOnline({ timeout: 5 }).then(() => {
		optionalUpgrade(flags);
	});
	launchBrowser();

	return service;
};

module.exports = {
	getFile,
	markdownToHTML,
	resolveLiveReloadPort,
	init,
};
