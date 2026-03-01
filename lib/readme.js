#!/usr/bin/env node

"use strict";

/* eslint-disable unicorn/prefer-top-level-await */

const fs = require("fs");
const path = require("path");
const meow = require("meow");

const markserv = require(path.join(__dirname, "server"));
const splash = require(path.join(__dirname, "splash"));
const cliHelp = String(fs.readFileSync(path.join(__dirname, "./cli-help.txt")));
const cliDefs = require("./cli-defs");

const cliOpts = meow(cliHelp, cliDefs);

const wasPortFlagProvided = (argv) => {
	for (const arg of argv) {
		if (arg === "-p" || arg === "--port") {
			return true;
		}

		if (arg.startsWith("--port=")) {
			return true;
		}

		if (arg.startsWith("-p") && arg !== "-p") {
			return true;
		}
	}

	return false;
};

const fileExistsSync = uri => {
	let exists;

	try {
		const stat = fs.statSync(uri);
		if (stat.isFile()) {
			exists = true;
		}
	} catch (error) {
		console.warn(`${uri} does not exist`, error);
		exists = false;
	}

	return exists;
};

const findFileUp = (dir, fileToFind) => {
	const filepath = path.join(dir, fileToFind);
	const existsHere = fileExistsSync(filepath);

	if (dir === path.sep || dir === ".") {
		return false;
	}

	if (existsHere) {
		return filepath;
	}

	const nextDirUp = path.dirname(dir);
	return findFileUp(nextDirUp, fileToFind);
};

const findReadmeFile = dir => {
	const readmeFile = findFileUp(dir, "README.md") ||
		findFileUp(dir, "readme.md") ||
		findFileUp(dir, "README.MD") ||
		findFileUp(dir, "Readme.md");
	return readmeFile;
};

const validateServerPath = (opts, cwd) => {
	let dir = opts.input[0];
	if (dir === undefined) {
		dir = cwd;
	}

	const resolvedPath = path.resolve(dir);

	dir = dir[0] === "/" ? resolvedPath : path.normalize(path.join(cwd, dir));

	return dir;
};

const run = opts => {
	splash(opts.flags);
	const cwd = process.cwd();

	opts.flags.$portProvided = wasPortFlagProvided(process.argv.slice(2));
	const validatedServerPath = validateServerPath(opts, cwd);

	const readmeFile = findReadmeFile(validatedServerPath);

	if (readmeFile) {
		opts.flags.dir = readmeFile || validateServerPath;
		opts.flags.$pathProvided = true;
		opts.flags.$openLocation = true;
	}

	return markserv.init(opts.flags);
};

const cli = !module.parent;

if (cli) {
	(async () => {
		try {
			await run(cliOpts);
		} catch (error) {
			const message =
				error && typeof error.message === "string" ? error.message : String(error);
			console.error(message);
			if (cliOpts.flags && cliOpts.flags.verbose && error && error.stack) {
				console.error(error.stack);
			}

			process.exitCode = 1;
		}
	})();
} else {
	module.exports = {run};
}

/* eslint-enable unicorn/prefer-top-level-await */
