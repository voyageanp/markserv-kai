"use strict";

const http = require("http");
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
		const decodedUrl = getPathFromUrl(decodeURIComponent(req.originalUrl));
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
				.then(markdownToHTML)
				.then((html) => implant(html, implantHandlers, implantOpts).then(
					(output) => {
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
							hasNavTree: navTree !== "",
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
					},
				))
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

const startConnectApp = (liveReloadPort, httpRequestHandler) => connect()
	.use(
		connectLiveReload({
			port: liveReloadPort,
		}),
	)
	.use("/", httpRequestHandler);

const startHTTPServer = (connectApp, port, flags) => {
	const httpServer = connectApp ? http.createServer(connectApp) : http.createServer();

	httpServer.listen(port, flags.address);
	return httpServer;
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
	msg(
		"livereload",
		chalk`{grey communicating on port: ${style.port(liveReloadPort)}}`,
		flags,
	);

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
	const liveReloadPort = flags.livereloadport;
	const httpPort = flags.port;

	const httpRequestHandler = createRequestHandler(flags);
	const connectApp = startConnectApp(liveReloadPort, httpRequestHandler);
	const httpServer = await startHTTPServer(connectApp, httpPort, flags);

	let liveReloadServer;
	if (liveReloadPort && liveReloadPort !== "false") {
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
	init,
};
