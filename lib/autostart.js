"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const {execSync} = require("child_process");

const LABEL = "io.markserv.master";
const PLIST_NAME = `${LABEL}.plist`;
const PLIST_DIR = path.join(os.homedir(), "Library", "LaunchAgents");
const PLIST_PATH = path.join(PLIST_DIR, PLIST_NAME);

const buildPlist = () => {
	const nodePath = process.execPath;
	const cliPath = path.resolve(__dirname, "cli.js");

	return [
		"<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
		"<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
		"<plist version=\"1.0\">",
		"<dict>",
		"    <key>Label</key>",
		`    <string>${LABEL}</string>`,
		"",
		"    <key>ProgramArguments</key>",
		"    <array>",
		`        <string>${nodePath}</string>`,
		`        <string>${cliPath}</string>`,
		"        <string>master</string>",
		"    </array>",
		"",
		"    <key>RunAtLoad</key>",
		"    <true/>",
		"",
		"    <key>KeepAlive</key>",
		"    <true/>",
		"",
		"    <key>StandardOutPath</key>",
		"    <string>/tmp/markserv-master.log</string>",
		"",
		"    <key>StandardErrorPath</key>",
		"    <string>/tmp/markserv-master.error.log</string>",
		"",
		"    <key>EnvironmentVariables</key>",
		"    <dict>",
		"        <key>PATH</key>",
		`        <string>${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin</string>`,
		"        <key>HOME</key>",
		`        <string>${os.homedir()}</string>`,
		"    </dict>",
		"</dict>",
		"</plist>",
		"",
	].join("\n");
};

const isLoaded = () => {
	try {
		const output = execSync("launchctl list", {encoding: "utf8"});
		return output.includes(LABEL);
	} catch {
		return false;
	}
};

const autostartOn = () => {
	if (process.platform !== "darwin") {
		console.error("autostart is only supported on macOS.");
		return;
	}

	if (fs.existsSync(PLIST_PATH)) {
		console.log(`Already enabled: ${PLIST_PATH}`);
		console.log("Run 'markserv autostart off' first to re-create.");
		return;
	}

	fs.mkdirSync(PLIST_DIR, {recursive: true});
	fs.writeFileSync(PLIST_PATH, buildPlist(), "utf8");
	console.log(`Created: ${PLIST_PATH}`);

	try {
		execSync(`launchctl load "${PLIST_PATH}"`, {stdio: "inherit"});
		console.log("Loaded. markserv master will start on login.");
	} catch (error) {
		console.error("launchctl load failed:", error.message);
	}
};

const autostartOff = () => {
	if (process.platform !== "darwin") {
		console.error("autostart is only supported on macOS.");
		return;
	}

	if (!fs.existsSync(PLIST_PATH)) {
		console.log("Already disabled: no plist found.");
		return;
	}

	try {
		execSync(`launchctl unload "${PLIST_PATH}"`, {stdio: "inherit"});
		console.log("Unloaded.");
	} catch {
		// May already be unloaded — continue to remove the file.
	}

	fs.unlinkSync(PLIST_PATH);
	console.log(`Removed: ${PLIST_PATH}`);
	console.log("autostart disabled.");
};

const autostartStatus = () => {
	if (process.platform !== "darwin") {
		console.error("autostart is only supported on macOS.");
		return;
	}

	const plistExists = fs.existsSync(PLIST_PATH);
	const loaded = isLoaded();

	console.log(`plist:  ${plistExists ? PLIST_PATH : "not found"}`);
	console.log(`loaded: ${loaded ? "yes" : "no"}`);

	if (plistExists && !loaded) {
		console.log("\nHint: plist exists but is not loaded. Run 'markserv autostart off' then 'markserv autostart on'.");
	}
};

const runAutostart = subcommand => {
	if (subcommand === "on") {
		return autostartOn();
	}

	if (subcommand === "off") {
		return autostartOff();
	}

	if (subcommand === "status" || subcommand === undefined) {
		return autostartStatus();
	}

	throw new Error("Usage: markserv autostart <on|off|status>");
};

module.exports = runAutostart;
