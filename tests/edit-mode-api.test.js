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

const startService = async (dir) => {
	const port = await getPort();
	const flags = {
		dir,
		port,
		livereloadport: false,
		address: "localhost",
		silent: true,
		browser: false
	};
	const service = await markserv.init(flags);
	return {service, port};
};

const setupFixture = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "markserv-edit-"));
	const markdownPath = path.join(dir, "doc.md");
	fs.writeFileSync(
		markdownPath,
		"# Title\n\nParagraph one.\n\n- item a\n- item b\n",
		"utf8",
	);
	return {dir, markdownPath};
};

const postEdit = (port, payload) =>
	requestAsync({
		method: "POST",
		url: `http://localhost:${port}/__markserv/edit`,
		json: true,
		body: payload,
		timeout: 1000 * 2
	});

test("edit API updates a section in markdown", async t => {
	const {dir, markdownPath} = setupFixture();
	const {service, port} = await startService(dir);

	try {
		const stat = fs.statSync(markdownPath);
		const {response, body} = await postEdit(port, {
			action: "update_section",
			filePath: "/doc.md",
			sectionIndex: 1,
			markdown: "Paragraph updated.",
			baseMtimeMs: stat.mtimeMs
		});

		t.is(response.statusCode, 200);
		t.true(body.ok);
		t.true(body.saved);
		t.true(Number.isFinite(body.mtimeMs));

		const nextText = fs.readFileSync(markdownPath, "utf8");
		t.true(nextText.includes("Paragraph updated."));
	} finally {
		await closeServer(service.httpServer);
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test("edit API updates full markdown document", async t => {
	const {dir, markdownPath} = setupFixture();
	const {service, port} = await startService(dir);

	try {
		const stat = fs.statSync(markdownPath);
		const nextMarkdown = "# New Title\n\nThis file was fully replaced.\n";
		const {response, body} = await postEdit(port, {
			action: "update_document",
			filePath: "/doc.md",
			markdown: nextMarkdown,
			baseMtimeMs: stat.mtimeMs
		});

		t.is(response.statusCode, 200);
		t.true(body.ok);
		t.true(body.saved);

		const nextText = fs.readFileSync(markdownPath, "utf8");
		t.is(nextText, nextMarkdown);
	} finally {
		await closeServer(service.httpServer);
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test("edit API inserts a section below selected section", async t => {
	const {dir, markdownPath} = setupFixture();
	const {service, port} = await startService(dir);

	try {
		const stat = fs.statSync(markdownPath);
		const {response, body} = await postEdit(port, {
			action: "insert_section_after",
			filePath: "/doc.md",
			sectionIndex: 1,
			markdown: "Inserted section.",
			baseMtimeMs: stat.mtimeMs
		});

		t.is(response.statusCode, 200);
		t.true(body.ok);
		t.true(body.saved);

		const nextText = fs.readFileSync(markdownPath, "utf8");
		t.true(nextText.includes("Paragraph one.\n\nInserted section.\n\n- item a"));
	} finally {
		await closeServer(service.httpServer);
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test("edit API skips empty insert", async t => {
	const {dir, markdownPath} = setupFixture();
	const {service, port} = await startService(dir);

	try {
		const before = fs.readFileSync(markdownPath, "utf8");
		const stat = fs.statSync(markdownPath);
		const {response, body} = await postEdit(port, {
			action: "insert_section_after",
			filePath: "/doc.md",
			sectionIndex: 1,
			markdown: "   ",
			baseMtimeMs: stat.mtimeMs
		});

		t.is(response.statusCode, 200);
		t.true(body.ok);
		t.false(body.saved);

		const after = fs.readFileSync(markdownPath, "utf8");
		t.is(after, before);
	} finally {
		await closeServer(service.httpServer);
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test("edit API returns conflict when mtime changed", async t => {
	const {dir, markdownPath} = setupFixture();
	const {service, port} = await startService(dir);

	try {
		const staleMtimeMs = fs.statSync(markdownPath).mtimeMs;
		fs.appendFileSync(markdownPath, "\nextra\n", "utf8");
		const {response, body} = await postEdit(port, {
			action: "update_section",
			filePath: "/doc.md",
			sectionIndex: 1,
			markdown: "Paragraph conflict.",
			baseMtimeMs: staleMtimeMs
		});

		t.is(response.statusCode, 409);
		t.false(body.ok);
		t.true(Number.isFinite(body.mtimeMs));
	} finally {
		await closeServer(service.httpServer);
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test("edit API returns conflict when full-document mtime changed", async t => {
	const {dir, markdownPath} = setupFixture();
	const {service, port} = await startService(dir);

	try {
		const staleMtimeMs = fs.statSync(markdownPath).mtimeMs;
		fs.appendFileSync(markdownPath, "\nexternal change\n", "utf8");
		const {response, body} = await postEdit(port, {
			action: "update_document",
			filePath: "/doc.md",
			markdown: "# Conflict\n",
			baseMtimeMs: staleMtimeMs
		});

		t.is(response.statusCode, 409);
		t.false(body.ok);
		t.true(Number.isFinite(body.mtimeMs));
	} finally {
		await closeServer(service.httpServer);
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test("edit API validates markdown path", async t => {
	const {dir, markdownPath} = setupFixture();
	const txtPath = path.join(dir, "note.txt");
	fs.writeFileSync(txtPath, "hello", "utf8");
	const {service, port} = await startService(dir);

	try {
		const stat = fs.statSync(markdownPath);
		const {response, body} = await postEdit(port, {
			action: "update_section",
			filePath: "/note.txt",
			sectionIndex: 0,
			markdown: "bad",
			baseMtimeMs: stat.mtimeMs
		});

		t.is(response.statusCode, 400);
		t.false(body.ok);
	} finally {
		await closeServer(service.httpServer);
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test("edit API validates section range", async t => {
	const {dir, markdownPath} = setupFixture();
	const {service, port} = await startService(dir);

	try {
		const stat = fs.statSync(markdownPath);
		const {response, body} = await postEdit(port, {
			action: "update_section",
			filePath: "/doc.md",
			sectionIndex: 99,
			markdown: "not found",
			baseMtimeMs: stat.mtimeMs
		});

		t.is(response.statusCode, 404);
		t.false(body.ok);
	} finally {
		await closeServer(service.httpServer);
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test("edit API validates update_document payload", async t => {
	const {dir, markdownPath} = setupFixture();
	const {service, port} = await startService(dir);

	try {
		const stat = fs.statSync(markdownPath);
		const {response, body} = await postEdit(port, {
			action: "update_document",
			filePath: "/doc.md",
			baseMtimeMs: stat.mtimeMs
		});

		t.is(response.statusCode, 400);
		t.false(body.ok);
	} finally {
		await closeServer(service.httpServer);
		fs.rmSync(dir, {recursive: true, force: true});
	}
});
