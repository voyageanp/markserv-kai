#!/usr/bin/env node

"use strict";

/* eslint-disable unicorn/prefer-top-level-await */

const path = require("path");
const fs = require("fs");
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

const validateServerPath = (serverPath, cwd) => {
	if (serverPath === cwd) {
		return cwd;
	}

	let validatedPath;

	if (serverPath[0]) {
		validatedPath = path.normalize(path.join(cwd, serverPath));
	}

	if (serverPath[0] === "/" || serverPath[0] === ".") {
		validatedPath = path.normalize(path.join(cwd, serverPath));
	}

	return validatedPath;
};

const run = opts => {
	splash(opts.flags);

	const cwd = process.cwd();
	opts.flags.$portProvided = wasPortFlagProvided(process.argv.slice(2));

	let dir = opts.input[0];
	if (dir === undefined) {
		dir = cwd;
	}

	const validatedServerPath = validateServerPath(dir, cwd);
	opts.flags.dir = validatedServerPath;
	opts.flags.$pathProvided = true;
	opts.flags.$openLocation = true;

	return markserv.init(opts.flags);
};

const cli = !module.parent;

if (cli) {
	// Run without args (process.argv will be picked up)
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
