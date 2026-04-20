import fs from "fs";
import os from "os";
import path from "path";
import test from "ava";
import cli from "../lib/cli";

const captureConsole = async (fn) => {
	const lines = [];
	const originalLog = console.log;
	console.log = (...args) => {
		lines.push(args.join(" "));
	};

	try {
		const result = await fn();
		return {result, lines};
	} finally {
		console.log = originalLog;
	}
};

test("root add/list/remove manages the registry file", async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markserv-cli-"));
	const rootDir = path.join(tempDir, "project");
	const secondRootDir = path.join(tempDir, "notes");
	const registryPath = path.join(tempDir, "roots.json");
	const rootDirInput = path.relative(process.cwd(), rootDir);
	const secondRootDirInput = path.relative(process.cwd(), secondRootDir);
	fs.mkdirSync(rootDir, {recursive: true});
	fs.mkdirSync(secondRootDir, {recursive: true});

	try {
		await captureConsole(() =>
			cli.run({
				input: ["root", "add", rootDirInput],
				flags: {
					registry: registryPath,
					silent: true,
					slug: "project",
					title: "Project Root",
				},
			}),
		);

		await captureConsole(() =>
			cli.run({
				input: ["root", "add", secondRootDirInput],
				flags: {
					registry: registryPath,
					silent: true,
					slug: "notes",
					title: "Notes Root",
				},
			}),
		);

		const listResult = await captureConsole(() =>
			cli.run({
				input: ["root", "list"],
				flags: {
					registry: registryPath,
					silent: true,
				},
			}),
		);

		t.true(listResult.lines.some((line) => line.includes("Project Root\tproject")));
		t.true(listResult.lines.some((line) => line.includes("Notes Root\tnotes")));

		const registryAfterAdd = JSON.parse(fs.readFileSync(registryPath, "utf8"));
		t.is(registryAfterAdd.roots.length, 2);
		t.truthy(registryAfterAdd.roots[0].theme);
		t.truthy(registryAfterAdd.roots[1].theme);
		t.not(registryAfterAdd.roots[0].theme, registryAfterAdd.roots[1].theme);

		await captureConsole(() =>
			cli.run({
				input: ["root", "remove", "project"],
				flags: {
					registry: registryPath,
					silent: true,
				},
			}),
		);

		await captureConsole(() =>
			cli.run({
				input: ["root", "remove", "notes"],
				flags: {
					registry: registryPath,
					silent: true,
				},
			}),
		);

		const registryData = JSON.parse(fs.readFileSync(registryPath, "utf8"));
		t.deepEqual(registryData.roots, []);
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});
