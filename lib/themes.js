"use strict";

const THEME_IDS = [
	"dracula",
	"atom-one-dark",
	"monokai-pro",
	"ayu-dark",
	"material-deprecated",
	"synthwave-84",
	"tokyo-night",
	"noctis",
	"gruvbox-dark",
	"jellyfish",
	"tiny-light",
	"laserwave",
	"outrun",
	"tokyo-hack",
	"vitesse-theme",
	"pink-cat-boo",
	"shades-of-purple",
	"lunar-pink",
	"xcode-default",
	"everforest",
	"beautiful-dracula",
];

const hasThemeId = (themeId) =>
	typeof themeId === "string" && THEME_IDS.includes(themeId);

const getUnusedThemeId = (usedThemeIds) => {
	const used = new Set(
		Array.isArray(usedThemeIds) ? usedThemeIds.filter(Boolean) : [],
	);

	return THEME_IDS.find((themeId) => !used.has(themeId)) || "";
};

module.exports = {
	THEME_IDS,
	hasThemeId,
	getUnusedThemeId,
};
