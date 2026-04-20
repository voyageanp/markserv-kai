"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { getUnusedThemeId, hasThemeId } = require("./themes");

const REGISTRY_VERSION = 1;

const getDefaultRegistryPath = () =>
	path.join(os.homedir(), ".config", "markserv", "roots.json");

const resolveRegistryPath = (registryPath) =>
	path.resolve(registryPath || getDefaultRegistryPath());

const ensureParentDir = (filePath) => {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const normalizeBooleanFlag = (value, fallback) => {
	if (value === undefined) {
		return fallback;
	}

	return Boolean(value);
};

const slugifyRootName = (value) => String(value || "")
	.trim()
	.toLowerCase()
	.replaceAll(/[^a-z\d]+/g, "-")
	.replaceAll(/^-+|-+$/g, "");

const validateRootEntry = (root, index) => {
	if (!root || typeof root !== "object") {
		throw new Error(`Invalid root entry at index ${index}.`);
	}

	if (!root.slug || typeof root.slug !== "string") {
		throw new Error(`Root entry at index ${index} is missing slug.`);
	}

	if (!root.title || typeof root.title !== "string") {
		throw new Error(`Root entry "${root.slug}" is missing title.`);
	}

	if (!root.dir || typeof root.dir !== "string") {
		throw new Error(`Root entry "${root.slug}" is missing dir.`);
	}
};

const normalizeRootEntry = (root, index) => {
	validateRootEntry(root, index);

	return {
		slug: root.slug,
		title: root.title,
		dir: path.resolve(root.dir),
		theme: typeof root.theme === "string" ? root.theme : "",
		flags: {
			markdownOnlyDir: normalizeBooleanFlag(
				root.flags && root.flags.markdownOnlyDir,
				false,
			),
			showAllDir: normalizeBooleanFlag(
				root.flags && (root.flags.showAllDir ?? root.flags.showalldir),
				false,
			),
		},
	};
};

const normalizeRegistry = (data) => {
	if (!data || typeof data !== "object") {
		return {
			version: REGISTRY_VERSION,
			roots: [],
		};
	}

	const version = data.version === undefined ? REGISTRY_VERSION : data.version;
	if (version !== REGISTRY_VERSION) {
		throw new Error(`Unsupported registry version: ${version}`);
	}

	const roots = Array.isArray(data.roots)
		? data.roots.map(normalizeRootEntry)
		: [];
	const slugs = new Set();

	for (const root of roots) {
		if (slugs.has(root.slug)) {
			throw new Error(`Duplicate root slug in registry: ${root.slug}`);
		}

		slugs.add(root.slug);
	}

	return {
		version,
		roots,
	};
};

const loadRegistry = (registryPath) => {
	const resolvedPath = resolveRegistryPath(registryPath);
	if (!fs.existsSync(resolvedPath)) {
		return {
			path: resolvedPath,
			data: normalizeRegistry(),
		};
	}

	const raw = fs.readFileSync(resolvedPath, "utf8");
	const parsed = raw.trim() === "" ? {} : JSON.parse(raw);

	return {
		path: resolvedPath,
		data: normalizeRegistry(parsed),
	};
};

const saveRegistry = (registryPath, data) => {
	const resolvedPath = resolveRegistryPath(registryPath);
	const normalized = normalizeRegistry(data);
	ensureParentDir(resolvedPath);
	fs.writeFileSync(
		resolvedPath,
		JSON.stringify(normalized, null, "\t") + "\n",
		"utf8",
	);

	return {
		path: resolvedPath,
		data: normalized,
	};
};

const getRootTitleFromDir = (dirPath) => path.basename(path.resolve(dirPath));

const createRootEntry = ({ dir, slug, title, flags, theme }) => {
	const absoluteDir = path.resolve(dir);
	const derivedSlug = slugifyRootName(slug || path.basename(absoluteDir));
	if (!derivedSlug) {
		throw new Error("Could not derive slug for root.");
	}

	return normalizeRootEntry({
		slug: derivedSlug,
		title: title || getRootTitleFromDir(absoluteDir),
		dir: absoluteDir,
		theme: rootInputTheme({theme}),
		flags,
	});
};

const rootInputTheme = (rootInput) =>
	rootInput && typeof rootInput.theme === "string" ? rootInput.theme : "";

const resolveRootTheme = (existingRoots, requestedTheme) => {
	if (requestedTheme) {
		if (!hasThemeId(requestedTheme)) {
			throw new Error(`Unknown theme id: ${requestedTheme}`);
		}

		if (existingRoots.some((root) => root.theme === requestedTheme)) {
			throw new Error(`Root theme already exists: ${requestedTheme}`);
		}

		return requestedTheme;
	}

	const nextTheme = getUnusedThemeId(existingRoots.map((root) => root.theme));
	if (!nextTheme) {
		throw new Error("No unique themes left to assign.");
	}

	return nextTheme;
};

const assignUniqueThemes = (roots) => {
	const usedThemeIds = new Set();

	return roots.map((root) => {
		const requestedTheme = rootInputTheme(root);
		if (hasThemeId(requestedTheme) && !usedThemeIds.has(requestedTheme)) {
			usedThemeIds.add(requestedTheme);
			return {
				...root,
				theme: requestedTheme,
			};
		}

		const nextTheme = getUnusedThemeId([...usedThemeIds]);
		if (!nextTheme) {
			throw new Error("No unique themes left to assign.");
		}

		usedThemeIds.add(nextTheme);
		return {
			...root,
			theme: nextTheme,
		};
	});
};

const addRootToRegistry = (registryPath, rootInput) => {
	const { path: resolvedPath, data } = loadRegistry(registryPath);
	const nextRoot = createRootEntry({
		...rootInput,
		theme: resolveRootTheme(data.roots, rootInputTheme(rootInput)),
	});

	if (data.roots.some((root) => root.slug === nextRoot.slug)) {
		throw new Error(`Root slug already exists: ${nextRoot.slug}`);
	}

	const nextData = {
		...data,
		roots: [...data.roots, nextRoot].sort((rootA, rootB) =>
			rootA.slug.localeCompare(rootB.slug)
		),
	};

	return saveRegistry(resolvedPath, nextData);
};

const ensureRegistryThemes = (registryPath) => {
	const { path: resolvedPath, data } = loadRegistry(registryPath);
	const themedRoots = assignUniqueThemes(data.roots);
	const changed = themedRoots.some((root, index) => root.theme !== data.roots[index].theme);

	if (!changed) {
		return {
			path: resolvedPath,
			data,
			changed: false,
		};
	}

	const nextData = {
		...data,
		roots: themedRoots,
	};

	return {
		...saveRegistry(resolvedPath, nextData),
		changed: true,
	};
};

const removeRootFromRegistry = (registryPath, slug) => {
	const { path: resolvedPath, data } = loadRegistry(registryPath);
	const nextRoots = data.roots.filter((root) => root.slug !== slug);
	if (nextRoots.length === data.roots.length) {
		throw new Error(`Root slug not found: ${slug}`);
	}

	return saveRegistry(resolvedPath, {
		...data,
		roots: nextRoots,
	});
};

const watchRegistry = (registryPath, onChange) => {
	const resolvedPath = resolveRegistryPath(registryPath);
	let lastSerialized = "";

	const readSerialized = () => {
		try {
			if (!fs.existsSync(resolvedPath)) {
				return JSON.stringify(normalizeRegistry());
			}

			return JSON.stringify(loadRegistry(resolvedPath).data);
		} catch {
			return null;
		}
	};

	lastSerialized = readSerialized();

	const listener = () => {
		const nextSerialized = readSerialized();
		if (!nextSerialized || nextSerialized === lastSerialized) {
			return;
		}

		lastSerialized = nextSerialized;
		onChange(loadRegistry(resolvedPath));
	};

	fs.watchFile(resolvedPath, { interval: 500, persistent: false }, listener);

	return () => {
		fs.unwatchFile(resolvedPath, listener);
	};
};

module.exports = {
	REGISTRY_VERSION,
	getDefaultRegistryPath,
	resolveRegistryPath,
	slugifyRootName,
	loadRegistry,
	saveRegistry,
	createRootEntry,
	addRootToRegistry,
	ensureRegistryThemes,
	removeRootFromRegistry,
	watchRegistry,
};
