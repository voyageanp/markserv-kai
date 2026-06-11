#!/usr/bin/env node

"use strict";

/* eslint-disable unicorn/prefer-top-level-await */

const path = require("path");
const fs = require("fs");
const meow = require("meow");
const open = require("open");

const markserv = require(path.join(__dirname, "server"));
const registry = require(path.join(__dirname, "registry"));
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

const wasAddressFlagProvided = (argv) => {
	for (const arg of argv) {
		if (arg === "-a" || arg === "--address") {
			return true;
		}

		if (arg.startsWith("--address=")) {
			return true;
		}

		if (arg.startsWith("-a") && arg !== "-a") {
			return true;
		}
	}

	return false;
};

const validateServerPath = (serverPath, cwd) => {
	if (serverPath === cwd) {
		return cwd;
	}

	if (path.isAbsolute(serverPath)) {
		return path.normalize(serverPath);
	}

	return path.normalize(path.join(cwd, serverPath));
};

const run = opts => {
	splash(opts.flags);

	const cwd = process.cwd();
	opts.flags.$portProvided = wasPortFlagProvided(process.argv.slice(2));

	// Support MARKSERV_ADDRESS env var so the address doesn't appear in shell history
	if (!wasAddressFlagProvided(process.argv.slice(2)) && process.env.MARKSERV_ADDRESS) {
		opts.flags.address = process.env.MARKSERV_ADDRESS;
	}

	const [command, subcommand, ...rest] = opts.input;
	const registryPath = registry.resolveRegistryPath(opts.flags.registry);

	if (command === "master") {
		opts.flags.master = true;
		opts.flags.registry = registryPath;
		opts.flags.dir = cwd;
		opts.flags.$pathProvided = false;
		opts.flags.$openLocation = false;
		return markserv.init(opts.flags);
	}

	if (command === "autostart") {
		const runAutostart = require("./autostart");
		return runAutostart(subcommand);
	}

	if (command === "root") {
		return runRootCommand({
			subcommand,
			args: rest,
			cwd,
			flags: opts.flags,
			registryPath,
		});
	}

	let dir = command;
	if (dir === undefined) {
		dir = cwd;
	}

	const validatedServerPath = validateServerPath(dir, cwd);
	opts.flags.dir = validatedServerPath;
	opts.flags.$pathProvided = true;
	opts.flags.$openLocation = true;

	return markserv.init(opts.flags);
};

const requireDirectory = directoryPath => {
	let stat;
	try {
		stat = fs.statSync(directoryPath);
	} catch {
		throw new Error(`Directory not found: ${directoryPath}`);
	}

	if (!stat.isDirectory()) {
		throw new Error(`Not a directory: ${directoryPath}`);
	}
};

const runRootCommand = async ({subcommand, args, cwd, flags, registryPath}) => {
	if (subcommand === "add") {
		const dirInput = args[0];
		if (!dirInput) {
			throw new Error("Usage: markserv root add <dir> [--slug <slug>] [--title <title>]");
		}

		const dir = validateServerPath(dirInput, cwd);
		requireDirectory(dir);
		const result = registry.addRootToRegistry(registryPath, {
			dir,
			slug: flags.slug,
			title: flags.title,
			theme: flags.theme,
			flags: {
				markdownOnlyDir: flags.markdownOnlyDir,
				showAllDir: flags.showalldir,
			},
		});
		console.log(`Added root ${path.basename(dir)} as ${result.data.roots.find(root => root.dir === path.resolve(dir)).slug}`);
		return result;
	}

	if (subcommand === "remove") {
		const slug = args[0];
		if (!slug) {
			throw new Error("Usage: markserv root remove <slug>");
		}

		registry.removeRootFromRegistry(registryPath, slug);
		console.log(`Removed root ${slug}`);
		return {removed: slug};
	}

	if (subcommand === "list") {
		const {data} = registry.loadRegistry(registryPath);
		for (const root of data.roots) {
			console.log([root.title, root.slug, root.dir].join("\t"));
		}

		return data.roots;
	}

	if (subcommand === "open") {
		const slug = args[0];
		if (!slug) {
			throw new Error("Usage: markserv root open <slug>");
		}

		const {data} = registry.loadRegistry(registryPath);
		const root = data.roots.find(entry => entry.slug === slug);
		if (!root) {
			throw new Error(`Root slug not found: ${slug}`);
		}

		await open(root.dir);
		return root;
	}

	throw new Error("Usage: markserv root <add|remove|list|open> ...");
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
