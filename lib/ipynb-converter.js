"use strict";

/* eslint-disable complexity, max-depth, unicorn/no-array-push-push, padding-line-between-statements, unicorn/no-new-array */

const { Buffer } = require("buffer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const IPYNB_CONVERTER_VERSION = "1";
const IMAGE_MAX_WIDTH = 1600;
const IMAGE_MAX_BYTES = 300 * 1024;
const WEBP_QUALITY = 82;
const JPEG_QUALITY = 82;

const SUPPORTED_IMAGE_OUTPUTS = {
	"image/png": "png",
	"image/jpeg": "jpg",
};

const toPosixPath = (filePath) => filePath.split(path.sep).join("/");

const hashString = (input) =>
	crypto.createHash("sha1").update(String(input)).digest("hex");

const ensureDirSync = (dirPath) => {
	fs.mkdirSync(dirPath, { recursive: true });
};

const readJsonFileSync = (filePath) => {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
};

const joinSource = (value) => {
	if (Array.isArray(value)) {
		return value.join("");
	}

	return typeof value === "string" ? value : "";
};

const normalizeCellSource = (value) => {
	const source = joinSource(value);
	return source.endsWith("\n") ? source.slice(0, -1) : source;
};

const decodeHtmlEntities = (value) =>
	String(value)
		.replaceAll("&nbsp;", " ")
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", "\"")
		.replaceAll("&#39;", "'");

const stripHtmlTags = (value) =>
	decodeHtmlEntities(String(value).replaceAll(/<[^>]+>/g, "")).trim();

const escapePipe = (value) => String(value).replaceAll("|", "\\|").trim();

const tableToMarkdown = (html) => {
	if (!/<table[\s>]/i.test(html)) {
		return null;
	}

	if (/<(table|tr|th|td)[^>]*(rowspan|colspan)=/i.test(html)) {
		return null;
	}

	const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
	if (!tableMatch) {
		return null;
	}

	const tableHtml = tableMatch[0];
	const rowMatches = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
	if (rowMatches.length === 0) {
		return null;
	}

	const rows = rowMatches.map((rowMatch) => {
		const rowHtml = rowMatch[0];
		const cellMatches = [...rowHtml.matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi)];
		return cellMatches.map((cellMatch) => stripHtmlTags(cellMatch[2]));
	}).filter((cells) => cells.length > 0);

	if (rows.length === 0) {
		return null;
	}

	const width = Math.max(...rows.map((cells) => cells.length));
	const normalizedRows = rows.map((cells) => {
		const next = cells.slice(0, width);
		while (next.length < width) {
			next.push("");
		}

		return next;
	});

	const header = normalizedRows[0].map(escapePipe);
	const separator = new Array(width).fill("---");
	const bodyRows = normalizedRows.slice(1).map((cells) =>
		cells.map(escapePipe),
	);

	const lines = [];
	lines.push(`| ${header.join(" | ")} |`);
	lines.push(`| ${separator.join(" | ")} |`);
	for (const bodyRow of bodyRows) {
		lines.push(`| ${bodyRow.join(" | ")} |`);
	}

	return lines.join("\n");
};

const formatTextOutputBlock = (label, value) => {
	const text = normalizeCellSource(value);
	if (text.trim() === "") {
		return "";
	}

	return [
		`#### ${label}`,
		"",
		"```text",
		text,
		"```",
	].join("\n");
};

const optimizeImageBuffer = async (buffer, imageMimeType) => {
	const inputBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
	let metadata;
	try {
		metadata = await sharp(inputBuffer).metadata();
	} catch {
		return {
			buffer: inputBuffer,
			extension: SUPPORTED_IMAGE_OUTPUTS[imageMimeType],
		};
	}

	const shouldResizeByWidth = Number.isFinite(metadata.width) && metadata.width > IMAGE_MAX_WIDTH;
	const shouldResizeByBytes = inputBuffer.length > IMAGE_MAX_BYTES;
	if (!shouldResizeByWidth && !shouldResizeByBytes) {
		return {
			buffer: inputBuffer,
			extension: SUPPORTED_IMAGE_OUTPUTS[imageMimeType],
		};
	}

	let pipeline = sharp(inputBuffer);
	if (shouldResizeByWidth) {
		pipeline = pipeline.resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true });
	}

	const fallbackExtension = SUPPORTED_IMAGE_OUTPUTS[imageMimeType];
	const canUseWebp = imageMimeType === "image/png";
	try {
		if (canUseWebp) {
			const webpBuffer = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
			return {
				buffer: webpBuffer,
				extension: "webp",
			};
		}

		const jpegBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
		return {
			buffer: jpegBuffer,
			extension: "jpg",
		};
	} catch {
		return {
			buffer: inputBuffer,
			extension: fallbackExtension,
		};
	}
};

const convertNotebookToMarkdown = async ({
	rootDir,
	notebookPath,
	cacheRootDir,
}) => {
	const absoluteRootDir = path.resolve(rootDir);
	const absoluteNotebookPath = path.resolve(notebookPath);
	const notebookStat = fs.statSync(absoluteNotebookPath);
	const notebookSource = fs.readFileSync(absoluteNotebookPath, "utf8");
	const notebook = JSON.parse(notebookSource);
	const cacheKey = hashString(absoluteNotebookPath);
	const cacheDir = path.join(cacheRootDir, cacheKey);
	const assetsDir = path.join(cacheDir, "assets");
	const renderedMarkdownPath = path.join(cacheDir, "rendered.md");
	const metaPath = path.join(cacheDir, "meta.json");
	const relativeNotebookPath = toPosixPath(
		path.relative(absoluteRootDir, absoluteNotebookPath),
	);

	const converterOptions = {
		imageMaxWidth: IMAGE_MAX_WIDTH,
		imageMaxBytes: IMAGE_MAX_BYTES,
		webpQuality: WEBP_QUALITY,
		jpegQuality: JPEG_QUALITY,
	};

	const cachedMeta = readJsonFileSync(metaPath);
	const hasFreshCache =
		cachedMeta &&
		cachedMeta.converterVersion === IPYNB_CONVERTER_VERSION &&
		cachedMeta.sourceMtimeMs === notebookStat.mtimeMs &&
		JSON.stringify(cachedMeta.converterOptions) === JSON.stringify(converterOptions) &&
		fs.existsSync(renderedMarkdownPath);

	if (hasFreshCache) {
		return {
			markdown: fs.readFileSync(renderedMarkdownPath, "utf8"),
			cacheHit: true,
			cacheDir,
			relativeNotebookPath,
		};
	}

	ensureDirSync(assetsDir);

	const lines = [];
	const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
	const codeLanguage =
		(notebook.metadata &&
			notebook.metadata.kernelspec &&
			typeof notebook.metadata.kernelspec.language === "string" &&
			notebook.metadata.kernelspec.language.trim()) ||
		"python";

	for (const [cellIndex, cell] of cells.entries()) {
		const displayCellNumber = cellIndex + 1;
		const cellType = cell && typeof cell.cell_type === "string" ? cell.cell_type : "raw";
		lines.push(`### Cell [${displayCellNumber}]`);
		lines.push("");

		if (cellType === "markdown") {
			const markdownText = normalizeCellSource(cell.source);
			if (markdownText) {
				lines.push(markdownText);
			}
			lines.push("");
			continue;
		}

		if (cellType === "code") {
			const codeText = normalizeCellSource(cell.source);
			lines.push(`\`\`\`${codeLanguage}`);
			lines.push(codeText);
			lines.push("```");
			lines.push("");

			const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
			for (const [outputIndex, output] of outputs.entries()) {
				const displayOutputNumber = outputIndex + 1;
				const outputType = output && typeof output.output_type === "string"
					? output.output_type
					: "";

				if (outputType === "stream") {
					const block = formatTextOutputBlock(
						`Output [${displayOutputNumber}]`,
						output.text,
					);
					if (block) {
						lines.push(block);
						lines.push("");
					}
					continue;
				}

				if (outputType === "error") {
					const traceback = Array.isArray(output.traceback)
						? output.traceback.join("\n")
						: joinSource(output.traceback || output.evalue || "");
					const block = formatTextOutputBlock(
						`Error [${displayOutputNumber}]`,
						traceback,
					);
					if (block) {
						lines.push(block);
						lines.push("");
					}
					continue;
				}

				const data = output && output.data && typeof output.data === "object"
					? output.data
					: {};

				const markdownData = joinSource(data["text/markdown"]);
				if (markdownData.trim() !== "") {
					lines.push(`#### Output [${displayOutputNumber}]`);
					lines.push("");
					lines.push(normalizeCellSource(markdownData));
					lines.push("");
					continue;
				}

				const htmlData = joinSource(data["text/html"]);
				if (htmlData.trim() !== "") {
					const tableMarkdown = tableToMarkdown(htmlData);
					lines.push(`#### Output [${displayOutputNumber}]`);
					lines.push("");
					if (tableMarkdown) {
						lines.push(tableMarkdown);
					} else {
						lines.push(htmlData);
					}
					lines.push("");
					continue;
				}

				let imageHandled = false;
				for (const [imageMimeType, extension] of Object.entries(SUPPORTED_IMAGE_OUTPUTS)) {
					const base64Body = joinSource(data[imageMimeType]);
					if (base64Body.trim() === "") {
						continue;
					}

					const imageBuffer = Buffer.from(base64Body, "base64");
					// eslint-disable-next-line no-await-in-loop
					const optimized = await optimizeImageBuffer(imageBuffer, imageMimeType);
					const finalExtension = optimized.extension || extension;
					const fileName = `cell-${String(displayCellNumber).padStart(3, "0")}-output-${String(displayOutputNumber).padStart(3, "0")}.${finalExtension}`;
					const outputImagePath = path.join(assetsDir, fileName);
					fs.writeFileSync(outputImagePath, optimized.buffer);
					const relativeAssetPath = toPosixPath(path.relative(absoluteRootDir, outputImagePath));
					const assetUrl = "/" + relativeAssetPath
						.split("/")
						.map((part) => encodeURIComponent(part))
						.join("/");

					lines.push(`#### Output [${displayOutputNumber}]`);
					lines.push("");
					lines.push(`![Cell ${displayCellNumber} Output ${displayOutputNumber}](${assetUrl})`);
					lines.push("");
					imageHandled = true;
					break;
				}

				if (imageHandled) {
					continue;
				}

				const plainTextData = joinSource(data["text/plain"]);
				if (plainTextData.trim() !== "") {
					const block = formatTextOutputBlock(
						`Output [${displayOutputNumber}]`,
						plainTextData,
					);
					if (block) {
						lines.push(block);
						lines.push("");
					}
				}
			}

			continue;
		}

		const rawText = normalizeCellSource(cell.source);
		if (rawText) {
			lines.push(rawText);
			lines.push("");
		}
	}

	const markdown = lines.join("\n").replaceAll(/\n{3,}/g, "\n\n").trim() + "\n";
	ensureDirSync(cacheDir);
	fs.writeFileSync(renderedMarkdownPath, markdown, "utf8");
	fs.writeFileSync(metaPath, JSON.stringify({
		converterVersion: IPYNB_CONVERTER_VERSION,
		sourcePath: relativeNotebookPath,
		sourceMtimeMs: notebookStat.mtimeMs,
		converterOptions,
		generatedAt: new Date().toISOString(),
	}, null, 2));

	return {
		markdown,
		cacheHit: false,
		cacheDir,
		relativeNotebookPath,
	};
};

module.exports = {
	convertNotebookToMarkdown,
	IPYNB_CONVERTER_VERSION,
};

/* eslint-enable complexity, max-depth, unicorn/no-array-push-push, padding-line-between-statements, unicorn/no-new-array */
