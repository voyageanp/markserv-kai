"use strict";

const http = require("http");
const net = require("net");
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

const MARKSERV_LIVE_RELOAD_PORT_MIN = 35_729;
const MARKSERV_LIVE_RELOAD_PORT_MAX = 35_739;
const MAX_EDIT_REQUEST_BODY_BYTES = 1_048_576;
const THEME_ASCII_WORD_ART = {
	DRACULA: ` ___    ____    ____    __  __ __  _       ____ 
|   \\  |    \\  /    |  /  ]|  |  || |     /    |
|    \\ |  D  )|  o  | /  / |  |  || |    |  o  |
|  D  ||    / |     |/  /  |  |  || |___ |     |
|     ||    \\ |  _  /   \\_ |  :  ||     ||  _  |
|     ||  .  \\|  |  \\     ||     ||     ||  |  |
|_____||__|\\_||__|__|\\____| \\__,_||_____||__|__|`,
	ATOM: `  ____  ______   ___   ___ ___ 
 /    ||      | /   \\ |   |   |
|  o  ||      ||     || _   _ |
|     ||_|  |_||  O  ||  \\_/  |
|  _  |  |  |  |     ||   |   |
|  |  |  |  |  |     ||   |   |
|__|__|  |__|   \\___/ |___|___|`,
	ONE: `  ___   ____     ___ 
 /   \\ |    \\   /  _]
|     ||  _  | /  [_ 
|  O  ||  |  ||    _]
|     ||  |  ||   [_ 
|     ||  |  ||     |
 \\___/ |__|__||_____|`,
	DARK: ` ___     ____  ____   __  _ 
|   \\   /    ||    \\ |  |/ ]
|    \\ |  o  ||  D  )|  ' / 
|  D  ||     ||    / |    \\ 
|     ||  _  ||    \\ |     |
|     ||  |  ||  .  \\|  .  |
|_____||__|__||__|\\_||__|\\_|`,
	MONOKAI: ` ___ ___   ___   ____    ___   __  _   ____  ____ 
|   |   | /   \\ |    \\  /   \\ |  |/ ] /    ||    |
| _   _ ||     ||  _  ||     ||  ' / |  o  | |  | 
|  \\_/  ||  O  ||  |  ||  O  ||    \\ |     | |  | 
|   |   ||     ||  |  ||     ||     ||  _  | |  | 
|   |   ||     ||  |  ||     ||  .  ||  |  | |  | 
|___|___| \\___/ |__|__| \\___/ |__|\\_||__|__||____|`,
	PRO: ` ____  ____   ___  
|    \\|    \\ /   \\ 
|  o  )  D  )     |
|   _/|    /|  O  |
|  |  |    \\|     |
|  |  |  .  \\     |
|__|  |__|\\_|\\___/`,
	AYU: `  ____  __ __  __ __ 
 /    ||  |  ||  |  |
|  o  ||  |  ||  |  |
|     ||  ~  ||  |  |
|  _  ||___, ||  :  |
|  |  ||     ||     |
|__|__||____/  \\__,_|`,
	MATERIAL: ` ___ ___   ____  ______    ___  ____   ____   ____  _     
|   |   | /    ||      |  /  _]|    \\ |    | /    || |    
| _   _ ||  o  ||      | /  [_ |  D  ) |  | |  o  || |    
|  \\_/  ||     ||_|  |_||    _]|    /  |  | |     || |___ 
|   |   ||  _  |  |  |  |   [_ |    \\  |  | |  _  ||     |
|   |   ||  |  |  |  |  |     ||  .  \\ |  | |  |  ||     |
|___|___||__|__|  |__|  |_____||__|\\_||____||__|__||_____|`,
	DEPRECATED: ` ___      ___  ____  ____     ___    __   ____  ______    ___  ___   
|   \\    /  _]|    \\|    \\   /  _]  /  ] /    ||      |  /  _]|   \\  
|    \\  /  [_ |  o  )  D  ) /  [_  /  / |  o  ||      | /  [_ |    \\ 
|  D  ||    _]|   _/|    / |    _]/  /  |     ||_|  |_||    _]|  D  |
|     ||   [_ |  |  |    \\ |   [_/   \\_ |  _  |  |  |  |   [_ |     |
|     ||     ||  |  |  .  \\|     \\     ||  |  |  |  |  |     ||     |
|_____||_____||__|  |__|\\_||_____|\\____||__|__|  |__|  |_____||_____|`,
	SYNTHWAVE: `  _____ __ __  ____   ______  __ __  __    __   ____  __ __    ___ 
 / ___/|  |  ||    \\ |      ||  |  ||  |__|  | /    ||  |  |  /  _]
(   \\_ |  |  ||  _  ||      ||  |  ||  |  |  ||  o  ||  |  | /  [_ 
 \\__  ||  ~  ||  |  ||_|  |_||  _  ||  |  |  ||     ||  |  ||    _]
 /  \\ ||___, ||  |  |  |  |  |  |  ||  \`  '  ||  _  ||  :  ||   [_ 
 \\    ||     ||  |  |  |  |  |  |  | \\      / |  |  | \\   / |     |
  \\___||____/ |__|__|  |__|  |__|__|  \\_/\\_/  |__|__|  \\_/  |_____|`,
	TOKYO: ` ______   ___   __  _  __ __   ___  
|      | /   \\ |  |/ ]|  |  | /   \\ 
|      ||     ||  ' / |  |  ||     |
|_|  |_||  O  ||    \\ |  ~  ||  O  |
  |  |  |     ||     ||___, ||     |
  |  |  |     ||  .  ||     ||     |
  |__|   \\___/ |__|\\_||____/  \\___/`,
	NIGHT: ` ____   ____   ____  __ __  ______ 
|    \\ |    | /    ||  |  ||      |
|  _  | |  | |   __||  |  ||      |
|  |  | |  | |  |  ||  _  ||_|  |_|
|  |  | |  | |  |_ ||  |  |  |  |  
|  |  | |  | |     ||  |  |  |  |  
|__|__||____||___,_||__|__|  |__|`,
	NOCTIS: ` ____    ___     __ ______  ____ _____
|    \\  /   \\   /  ]      ||    / ___/
|  _  ||     | /  /|      | |  (   \\_ 
|  |  ||  O  |/  / |_|  |_| |  |\\__  |
|  |  ||     /   \\_  |  |   |  |/  \\ |
|  |  ||     \\     | |  |   |  |\\    |
|__|__| \\___/ \\____| |__|  |____|\\___|`,
	GRUVBOX: `  ____  ____  __ __  __ __  ____    ___   __ __ 
 /    ||    \\|  |  ||  |  ||    \\  /   \\ |  |  |
|   __||  D  )  |  ||  |  ||  o  )|     ||  |  |
|  |  ||    /|  |  ||  |  ||     ||  O  ||_   _|
|  |_ ||    \\|  :  ||  :  ||  O  ||     ||     |
|     ||  .  \\     | \\   / |     ||     ||  |  |
|___,_||__|\\_|\\__,_|  \\_/  |_____| \\___/ |__|__|`,
	JELLYFISH: `  ____    ___  _      _      __ __  _____  ____ _____ __ __ 
 |    |  /  _]| |    | |    |  |  ||     ||    / ___/|  |  |
 |__  | /  [_ | |    | |    |  |  ||   __| |  (   \\_ |  |  |
 __|  ||    _]| |___ | |___ |  ~  ||  |_   |  |\\__  ||  _  |
/  |  ||   [_ |     ||     ||___, ||   _]  |  |/  \\ ||  |  |
\\  \`  ||     ||     ||     ||     ||  |    |  |\\    ||  |  |
 \\____j|_____||_____||_____||____/ |__|   |____|\\___||__|__|`,
	TINY: ` ______  ____  ____   __ __ 
|      ||    ||    \\ |  |  |
|      | |  | |  _  ||  |  |
|_|  |_| |  | |  |  ||  ~  |
  |  |   |  | |  |  ||___, |
  |  |   |  | |  |  ||     |
  |__|  |____||__|__||____/`,
	LIGHT: ` _      ____   ____  __ __  ______ 
| |    |    | /    ||  |  ||      |
| |     |  | |   __||  |  ||      |
| |___  |  | |  |  ||  _  ||_|  |_|
|     | |  | |  |_ ||  |  |  |  |  
|     | |  | |     ||  |  |  |  |  
|_____||____||___,_||__|__|  |__|`,
	84: ` __ __  _  _   
|  |  || || |  
|  |  || || |_ 
|  _  ||__   _|
|  |  |   | |  
|  |  |   | |  
|__|__|   |_|`,
	LASERWAVE: ` _       ____  _____   ___  ____  __    __   ____  __ __    ___ 
| |     /    |/ ___/  /  _]|    \\|  |__|  | /    ||  |  |  /  _]
| |    |  o  (   \\_  /  [_ |  D  )  |  |  ||  o  ||  |  | /  [_ 
| |___ |     |\\__  ||    _]|    /|  |  |  ||     ||  |  ||    _]
|     ||  _  |/  \\ ||   [_ |    \\|  \`  '  ||  _  ||  :  ||   [_ 
|     ||  |  |\\    ||     ||  .  \\\\      / |  |  | \\   / |     |
|_____||__|__| \\___||_____||__|\\_| \\_/\\_/  |__|__|  \\_/  |_____|`,
	OUTRUN: `  ___   __ __  ______  ____  __ __  ____  
 /   \\ |  |  ||      ||    \\|  |  ||    \\ 
|     ||  |  ||      ||  D  )  |  ||  _  |
|  O  ||  |  ||_|  |_||    /|  |  ||  |  |
|     ||  :  |  |  |  |    \\|  :  ||  |  |
|     ||     |  |  |  |  .  \\     ||  |  |
 \\___/  \\__,_|  |__|  |__|\\_|\\__,_||__|__|`,
	HACK: ` __ __   ____    __  __  _ 
|  |  | /    |  /  ]|  |/ ]
|  |  ||  o  | /  / |  ' / 
|  _  ||     |/  /  |    \\ 
|  |  ||  _  /   \\_ |     |
|  |  ||  |  \\     ||  .  |
|__|__||__|__|\\____||__|\\_|`,
	VITESSE: ` __ __  ____  ______    ___  _____ _____   ___ 
|  |  ||    ||      |  /  _]/ ___// ___/  /  _]
|  |  | |  | |      | /  [_(   \\_(   \\_  /  [_ 
|  |  | |  | |_|  |_||    _]\\__  |\\__  ||    _]
|  :  | |  |   |  |  |   [_ /  \\ |/  \\ ||   [_ 
 \\   /  |  |   |  |  |     |\\    |\\    ||     |
  \\_/  |____|  |__|  |_____| \\___| \\___||_____|`,
	THEME: ` ______  __ __    ___  ___ ___    ___ 
|      ||  |  |  /  _]|   |   |  /  _]
|      ||  |  | /  [_ | _   _ | /  [_ 
|_|  |_||  _  ||    _]|  \\_/  ||    _]
  |  |  |  |  ||   [_ |   |   ||   [_ 
  |  |  |  |  ||     ||   |   ||     |
  |__|  |__|__||_____||___|___||_____|`,
	PINK: ` ____ ____  ____   __  _ 
|    \\    ||    \\ |  |/ ]
|  o  )  | |  _  ||  ' / 
|   _/|  | |  |  ||    \\ 
|  |  |  | |  |  ||     |
|  |  |  | |  |  ||  .  |
|__| |____||__|__||__|\\_|`,
	CAT: `    __   ____  ______ 
   /  ] /    ||      |
  /  / |  o  ||      |
 /  /  |     ||_|  |_|
/   \\_ |  _  |  |  |  
\\     ||  |  |  |  |  
 \\____||__|__|  |__|`,
	BOO: ` ____    ___    ___  
|    \\  /   \\  /   \\ 
|  o  )|     ||     |
|     ||  O  ||  O  |
|  O  ||     ||     |
|     ||     ||     |
|_____| \\___/  \\___/`,
	SHADES: `  _____ __ __   ____  ___      ___  _____
 / ___/|  |  | /    ||   \\    /  _]/ ___/
(   \\_ |  |  ||  o  ||    \\  /  [_(   \\_ 
 \\__  ||  _  ||     ||  D  ||    _]\\__  |
 /  \\ ||  |  ||  _  ||     ||   [_ /  \\ |
 \\    ||  |  ||  |  ||     ||     |\\    |
  \\___||__|__||__|__||_____||_____| \\___|`,
	OF: `  ___   _____ 
 /   \\ |     |
|     ||   __|
|  O  ||  |_  
|     ||   _] 
|     ||  |   
 \\___/ |__|`,
	PURPLE: ` ____  __ __  ____   ____  _        ___ 
|    \\|  |  ||    \\ |    \\| |      /  _]
|  o  )  |  ||  D  )|  o  ) |     /  [_ 
|   _/|  |  ||    / |   _/| |___ |    _]
|  |  |  :  ||    \\ |  |  |     ||   [_ 
|  |  |     ||  .  \\|  |  |     ||     |
|__|   \\__,_||__|\\_||__|  |_____||_____|`,
	LUNAR: ` _      __ __  ____    ____  ____  
| |    |  |  ||    \\  /    ||    \\ 
| |    |  |  ||  _  ||  o  ||  D  )
| |___ |  |  ||  |  ||     ||    / 
|     ||  :  ||  |  ||  _  ||    \\ 
|     ||     ||  |  ||  |  ||  .  \\
|_____| \\__,_||__|__||__|__||__|\\_|`,
	XCODE: ` __ __    __   ___   ___      ___ 
|  |  |  /  ] /   \\ |   \\    /  _]
|  |  | /  / |     ||    \\  /  [_ 
|_   _|/  /  |  O  ||  D  ||    _]
|     /   \\_ |     ||     ||   [_ 
|  |  \\     ||     ||     ||     |
|__|__|\\____| \\___/ |_____||_____|`,
	DEFAULT: ` ___      ___  _____   ____  __ __  _     ______ 
|   \\    /  _]|     | /    ||  |  || |   |      |
|    \\  /  [_ |   __||  o  ||  |  || |   |      |
|  D  ||    _]|  |_  |     ||  |  || |___|_|  |_|
|     ||   [_ |   _] |  _  ||  :  ||     | |  |  
|     ||     ||  |   |  |  ||     ||     | |  |  
|_____||_____||__|   |__|__| \\__,_||_____| |__|`,
	EVERFOREST: `   ___ __ __    ___  ____   _____   ___   ____     ___  _____ ______ 
  /  _]  |  |  /  _]|    \\ |     | /   \\ |    \\   /  _]/ ___/|      |
 /  [_|  |  | /  [_ |  D  )|   __||     ||  D  ) /  [_(   \\_ |      |
|    _]  |  ||    _]|    / |  |_  |  O  ||    / |    _]\\__  ||_|  |_|
|   [_|  :  ||   [_ |    \\ |   _] |     ||    \\ |   [_ /  \\ |  |  |  
|     |\\   / |     ||  .  \\|  |   |     ||  .  \\|     |\\    |  |  |  
|_____| \\_/  |_____||__|\\_||__|    \\___/ |__|\\_||_____| \\___|  |__|`,
	BEAUTIFUL: ` ____     ___   ____  __ __  ______  ____  _____  __ __  _     
|    \\   /  _] /    ||  |  ||      ||    ||     ||  |  || |    
|  o  ) /  [_ |  o  ||  |  ||      | |  | |   __||  |  || |    
|     ||    _]|     ||  |  ||_|  |_| |  | |  |_  |  |  || |___ 
|  O  ||   [_ |  _  ||  :  |  |  |   |  | |   _] |  :  ||     |
|     ||     ||  |  ||     |  |  |   |  | |  |   |     ||     |
|_____||_____||__|__| \\__,_|  |__|  |____||__|    \\__,_||_____|`,
};
const THEME_ASCII_WORDS = {
	dracula: ["DRACULA"],
	"atom-one-dark": ["ATOM", "ONE", "DARK"],
	"monokai-pro": ["MONOKAI", "PRO"],
	"ayu-dark": ["AYU"],
	"material-deprecated": ["MATERIAL", "DEPRECATED"],
	"synthwave-84": ["SYNTHWAVE", "84"],
	"tokyo-night": ["TOKYO", "NIGHT"],
	noctis: ["NOCTIS"],
	"gruvbox-dark": ["GRUVBOX"],
	jellyfish: ["JELLYFISH"],
	"tiny-light": ["TINY", "LIGHT"],
	laserwave: ["LASERWAVE"],
	outrun: ["OUTRUN"],
	"tokyo-hack": ["TOKYO", "HACK"],
	"vitesse-theme": ["VITESSE", "THEME"],
	"pink-cat-boo": ["PINK", "CAT", "BOO"],
	"shades-of-purple": ["SHADES", "OF", "PURPLE"],
	"lunar-pink": ["LUNAR", "PINK"],
	"xcode-default": ["XCODE", "DEFAULT"],
	everforest: ["EVERFOREST"],
	"beautiful-dracula": ["BEAUTIFUL", "DRACULA"],
};
const DARK_THEMES = [
	{
		id: "dracula",
		name: "Dracula",
		cssVars: {
			"--bg": "#282A36",
			"--bg0_h": "#21222C",
			"--bg1": "#343746",
			"--bg2": "#44475A",
			"--fg": "#F8F8F2",
			"--gray": "#6272A4",
			"--red": "#FF5555",
			"--green": "#50FA7B",
			"--yellow": "#F1FA8C",
			"--blue": "#8BE9FD",
			"--purple": "#BD93F9",
			"--aqua": "#8BE9FD",
			"--orange": "#FFB86C",
			"--border": "#44475A",
		},
	},
	{
		id: "atom-one-dark",
		name: "Atom One Dark",
		cssVars: {
			"--bg": "#282C34",
			"--bg0_h": "#21252B",
			"--bg1": "#323842",
			"--bg2": "#3A404B",
			"--fg": "#ABB2BF",
			"--gray": "#5C6370",
			"--red": "#E06C75",
			"--green": "#98C379",
			"--yellow": "#E5C07B",
			"--blue": "#61AFEF",
			"--purple": "#C678DD",
			"--aqua": "#56B6C2",
			"--orange": "#D19A66",
			"--border": "#3A404B",
		},
	},
	{
		id: "monokai-pro",
		name: "Monokai Pro",
		cssVars: {
			"--bg": "#2D2A2E",
			"--bg0_h": "#221F22",
			"--bg1": "#3A373D",
			"--bg2": "#45424A",
			"--fg": "#FCFCFA",
			"--gray": "#939293",
			"--red": "#FF6188",
			"--green": "#A9DC76",
			"--yellow": "#FFD866",
			"--blue": "#78DCE8",
			"--purple": "#AB9DF2",
			"--aqua": "#78DCE8",
			"--orange": "#FC9867",
			"--border": "#45424A",
		},
	},
	{
		id: "ayu-dark",
		name: "Ayu Dark",
		cssVars: {
			"--bg": "#0F1419",
			"--bg0_h": "#0B1015",
			"--bg1": "#182028",
			"--bg2": "#202A33",
			"--fg": "#E6E1CF",
			"--gray": "#5C6773",
			"--red": "#F07178",
			"--green": "#B8CC52",
			"--yellow": "#FFB454",
			"--blue": "#59C2FF",
			"--purple": "#D2A6FF",
			"--aqua": "#95E6CB",
			"--orange": "#FF8F40",
			"--border": "#202A33",
		},
	},
	{
		id: "material-deprecated",
		name: "Material Theme",
		cssVars: {
			"--bg": "#263238",
			"--bg0_h": "#1E272C",
			"--bg1": "#32424A",
			"--bg2": "#3B4D57",
			"--fg": "#EEFFFF",
			"--gray": "#546E7A",
			"--red": "#F07178",
			"--green": "#C3E88D",
			"--yellow": "#FFCB6B",
			"--blue": "#82AAFF",
			"--purple": "#C792EA",
			"--aqua": "#89DDFF",
			"--orange": "#F78C6C",
			"--border": "#3B4D57",
		},
	},
	{
		id: "synthwave-84",
		name: "SynthWave '84",
		cssVars: {
			"--bg": "#241B2F",
			"--bg0_h": "#1E1627",
			"--bg1": "#34294F",
			"--bg2": "#42335E",
			"--fg": "#F7F1FF",
			"--gray": "#7A6E9B",
			"--red": "#F97EED",
			"--green": "#72F1B8",
			"--yellow": "#FFCC00",
			"--blue": "#36F9F6",
			"--purple": "#FF7EDB",
			"--aqua": "#36F9F6",
			"--orange": "#FEA352",
			"--border": "#42335E",
		},
	},
	{
		id: "tokyo-night",
		name: "Tokyo Night",
		cssVars: {
			"--bg": "#1A1B26",
			"--bg0_h": "#16161E",
			"--bg1": "#24283B",
			"--bg2": "#2F354F",
			"--fg": "#C0CAF5",
			"--gray": "#565F89",
			"--red": "#F7768E",
			"--green": "#9ECE6A",
			"--yellow": "#E0AF68",
			"--blue": "#7AA2F7",
			"--purple": "#BB9AF7",
			"--aqua": "#7DCFFF",
			"--orange": "#FF9E64",
			"--border": "#2F354F",
		},
	},
	{
		id: "noctis",
		name: "Noctis",
		cssVars: {
			"--bg": "#1B1D2B",
			"--bg0_h": "#151725",
			"--bg1": "#25283D",
			"--bg2": "#313553",
			"--fg": "#C5C8E6",
			"--gray": "#6E7294",
			"--red": "#FF7A93",
			"--green": "#8BE9A8",
			"--yellow": "#FFD479",
			"--blue": "#6BB4FF",
			"--purple": "#C79BFF",
			"--aqua": "#62E6D7",
			"--orange": "#FFB26B",
			"--border": "#313553",
		},
	},
	{
		id: "gruvbox-dark",
		name: "Gruvbox",
		cssVars: {
			"--bg": "#282828",
			"--bg0_h": "#1D2021",
			"--bg1": "#3C3836",
			"--bg2": "#504945",
			"--fg": "#EBDBB2",
			"--gray": "#928374",
			"--red": "#FB4934",
			"--green": "#B8BB26",
			"--yellow": "#FABD2F",
			"--blue": "#83A598",
			"--purple": "#D3869B",
			"--aqua": "#8EC07C",
			"--orange": "#FE8019",
			"--border": "#504945",
		},
	},
	{
		id: "jellyfish",
		name: "JellyFish",
		cssVars: {
			"--bg": "#1E1E2E",
			"--bg0_h": "#171722",
			"--bg1": "#2A2A3C",
			"--bg2": "#36364A",
			"--fg": "#EAEAF2",
			"--gray": "#8A8AA3",
			"--red": "#FF8FA3",
			"--green": "#7EF5C3",
			"--yellow": "#FFD166",
			"--blue": "#76C7FF",
			"--purple": "#C6A0FF",
			"--aqua": "#67E8F9",
			"--orange": "#FFB86B",
			"--border": "#36364A",
		},
	},
	{
		id: "tiny-light",
		name: "Tiny Light",
		cssVars: {
			"--bg": "#F8F9FB",
			"--bg0_h": "#EEF1F6",
			"--bg1": "#E6EAF2",
			"--bg2": "#DDE3EE",
			"--fg": "#2A2F3A",
			"--gray": "#6B7486",
			"--red": "#D7263D",
			"--green": "#2EAD6F",
			"--yellow": "#C18A00",
			"--blue": "#2F6FEB",
			"--purple": "#7C4DFF",
			"--aqua": "#0EA5A8",
			"--orange": "#C26A00",
			"--border": "#D0D7E2",
		},
	},
	{
		id: "laserwave",
		name: "LaserWave",
		cssVars: {
			"--bg": "#120B2E",
			"--bg0_h": "#0B0720",
			"--bg1": "#22134A",
			"--bg2": "#2F1C5F",
			"--fg": "#F4EEFF",
			"--gray": "#8A7AB0",
			"--red": "#FF5DA2",
			"--green": "#7CFFB2",
			"--yellow": "#FFD36E",
			"--blue": "#57E8FF",
			"--purple": "#C792FF",
			"--aqua": "#5EF0D1",
			"--orange": "#FF9E64",
			"--border": "#2F1C5F",
		},
	},
	{
		id: "outrun",
		name: "Outrun",
		cssVars: {
			"--bg": "#160F29",
			"--bg0_h": "#100A1E",
			"--bg1": "#251848",
			"--bg2": "#31205A",
			"--fg": "#F3ECFF",
			"--gray": "#8D7DB6",
			"--red": "#FF4D8B",
			"--green": "#71F79F",
			"--yellow": "#FFC857",
			"--blue": "#38E9FF",
			"--purple": "#B980FF",
			"--aqua": "#5CF2E3",
			"--orange": "#FF9B5E",
			"--border": "#31205A",
		},
	},
	{
		id: "tokyo-hack",
		name: "Tokyo Hack",
		cssVars: {
			"--bg": "#0B1116",
			"--bg0_h": "#060B0F",
			"--bg1": "#112029",
			"--bg2": "#16313D",
			"--fg": "#D3F6E5",
			"--gray": "#4F6C6E",
			"--red": "#FF6B6B",
			"--green": "#78F281",
			"--yellow": "#D9FF70",
			"--blue": "#4DD9FF",
			"--purple": "#A489FF",
			"--aqua": "#56F2C2",
			"--orange": "#FFA65C",
			"--border": "#16313D",
		},
	},
	{
		id: "vitesse-theme",
		name: "Vitesse Theme",
		cssVars: {
			"--bg": "#121212",
			"--bg0_h": "#0D0D0D",
			"--bg1": "#1E1E1E",
			"--bg2": "#282828",
			"--fg": "#DBD7CA",
			"--gray": "#8C887D",
			"--red": "#CB7676",
			"--green": "#4D9375",
			"--yellow": "#D8A657",
			"--blue": "#6394BF",
			"--purple": "#B39DF3",
			"--aqua": "#5EAAB5",
			"--orange": "#D4976C",
			"--border": "#303030",
		},
	},
	{
		id: "pink-cat-boo",
		name: "Pink-Cat-Boo",
		cssVars: {
			"--bg": "#24172A",
			"--bg0_h": "#1B1120",
			"--bg1": "#32203A",
			"--bg2": "#41284B",
			"--fg": "#FFE8F4",
			"--gray": "#9E7F97",
			"--red": "#FF7AB6",
			"--green": "#8BF5B8",
			"--yellow": "#FFD07A",
			"--blue": "#7EC8FF",
			"--purple": "#D78CFF",
			"--aqua": "#79F0E3",
			"--orange": "#FFAE7A",
			"--border": "#41284B",
		},
	},
	{
		id: "shades-of-purple",
		name: "Shades of Purple",
		cssVars: {
			"--bg": "#2D2B55",
			"--bg0_h": "#201E43",
			"--bg1": "#3A376B",
			"--bg2": "#4A4680",
			"--fg": "#FFFFFF",
			"--gray": "#B3B1D9",
			"--red": "#FF628C",
			"--green": "#A5FF90",
			"--yellow": "#FFEE80",
			"--blue": "#82AAFF",
			"--purple": "#D6ACFF",
			"--aqua": "#6FE8FF",
			"--orange": "#FF9D00",
			"--border": "#4A4680",
		},
	},
	{
		id: "lunar-pink",
		name: "Lunar Pink",
		cssVars: {
			"--bg": "#221628",
			"--bg0_h": "#180F1D",
			"--bg1": "#2F1D37",
			"--bg2": "#3D2448",
			"--fg": "#FDEBFF",
			"--gray": "#A186AD",
			"--red": "#FF84B7",
			"--green": "#8EF4C6",
			"--yellow": "#FFD782",
			"--blue": "#93C8FF",
			"--purple": "#E09BFF",
			"--aqua": "#85F2E5",
			"--orange": "#FFB27A",
			"--border": "#3D2448",
		},
	},
	{
		id: "xcode-default",
		name: "Xcode Default",
		cssVars: {
			"--bg": "#292A30",
			"--bg0_h": "#212228",
			"--bg1": "#353640",
			"--bg2": "#424450",
			"--fg": "#ECEFF4",
			"--gray": "#9AA3B2",
			"--red": "#FF8170",
			"--green": "#78C2A4",
			"--yellow": "#D9B44A",
			"--blue": "#4EA1FF",
			"--purple": "#C792EA",
			"--aqua": "#7FDBCA",
			"--orange": "#FF9F43",
			"--border": "#424450",
		},
	},
	{
		id: "everforest",
		name: "Everforest",
		cssVars: {
			"--bg": "#2D353B",
			"--bg0_h": "#232A2E",
			"--bg1": "#343F44",
			"--bg2": "#3D484D",
			"--fg": "#D3C6AA",
			"--gray": "#859289",
			"--red": "#E67E80",
			"--green": "#A7C080",
			"--yellow": "#DBBC7F",
			"--blue": "#7FBBB3",
			"--purple": "#D699B6",
			"--aqua": "#83C092",
			"--orange": "#E69875",
			"--border": "#4F585E",
		},
	},
	{
		id: "beautiful-dracula",
		name: "Beautiful Dracula",
		cssVars: {
			"--bg": "#1E1F29",
			"--bg0_h": "#171822",
			"--bg1": "#2B2D3A",
			"--bg2": "#383A4C",
			"--fg": "#F8F8F2",
			"--gray": "#7A7E9E",
			"--red": "#FF6E96",
			"--green": "#6BFFB3",
			"--yellow": "#FFE97D",
			"--blue": "#83D0FF",
			"--purple": "#C7A0FF",
			"--aqua": "#79F0FF",
			"--orange": "#FFB86C",
			"--border": "#383A4C",
		},
	},
];
const MARKSERV_CSS_PATH = path.join(__dirname, "templates", "markserv.css");
const BASE_MARKSERV_CSS = fs.readFileSync(MARKSERV_CSS_PATH, "utf8");

const pickRandomTheme = () =>
	DARK_THEMES[Math.floor(Math.random() * DARK_THEMES.length)];

const escapeForCssString = (value) =>
	String(value)
		.replaceAll("\\", "\\\\")
		.replaceAll("\r", "")
		.replaceAll("\n", "\\A")
		.replaceAll("\"", "\\\"");

const buildThemeAscii = (themeId) => {
	const words = THEME_ASCII_WORDS[themeId] || [];
	const blocks = words
		.map((word) => THEME_ASCII_WORD_ART[word])
		.filter(Boolean);

	return blocks.length > 0 ? blocks.join("\n\n") : "";
};

const hexToRgb = (hex) => {
	if (typeof hex !== "string") {
		return null;
	}

	const trimmed = hex.trim();
	const match = trimmed.match(/^#([\da-f]{6})$/i);
	if (!match) {
		return null;
	}

	const value = match[1];
	return {
		r: Number.parseInt(value.slice(0, 2), 16),
		g: Number.parseInt(value.slice(2, 4), 16),
		b: Number.parseInt(value.slice(4, 6), 16),
	};
};

const getSidebarAsciiColor = (bgHex) => {
	const rgb = hexToRgb(bgHex);
	if (!rgb) {
		return "#D7DCE6";
	}

	const brightness = ((rgb.r * 299) + (rgb.g * 587) + (rgb.b * 114)) * 0.001;
	return brightness < 160 ? "#D7DCE6" : "#5E677A";
};

const getTitleGlowColor = (accentHex) => {
	const rgb = hexToRgb(accentHex);
	if (!rgb) {
		return "rgba(255, 215, 0, 0.35)";
	}

	return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`;
};

const buildThemeCssOverride = (theme) => {
	const vars = Object.entries({
		...theme.cssVars,
		"--sidebar-ascii-color": getSidebarAsciiColor(theme.cssVars["--bg"]),
		"--title-glow": getTitleGlowColor(theme.cssVars["--yellow"]),
		"--theme-ascii": `"${escapeForCssString(buildThemeAscii(theme.id))}"`,
	})
		.map(([key, value]) => `  ${key}: ${value};`)
		.join("\n");

	return [
		`/* markserv-theme:${theme.id} */`,
		":root {",
		vars,
		"}",
		".hljs {",
		"  color: var(--fg);",
		"  background: var(--bg0_h);",
		"}",
		".hljs-comment, .hljs-quote { color: var(--gray); }",
		".hljs-keyword, .hljs-selector-tag, .hljs-subst { color: var(--red); }",
		".hljs-title, .hljs-section, .hljs-attribute { color: var(--blue); }",
		".hljs-string, .hljs-doctag, .hljs-literal, .hljs-regexp { color: var(--green); }",
		".hljs-number, .hljs-symbol, .hljs-bullet, .hljs-built_in, .hljs-builtin-name { color: var(--orange); }",
		".hljs-meta, .hljs-type, .hljs-class .hljs-title { color: var(--yellow); }",
		".hljs-emphasis { color: var(--aqua); }",
		".hljs-strong { color: var(--purple); }",
		"",
	].join("\n");
};

const buildThemeAwareMarkservCss = (theme) => {
	const selectedTheme = theme || DARK_THEMES[0];
	return `${BASE_MARKSERV_CSS}\n\n${buildThemeCssOverride(selectedTheme)}`;
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

const faviconPath = path.join(__dirname, "icons", "markserv-mk.svg");
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

const isFalseFlag = (value) => value === false || value === "false";

const parsePort = (value) => {
	if (typeof value === "number" && Number.isInteger(value)) {
		return value;
	}

	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isInteger(parsed)) {
			return parsed;
		}
	}

	return false;
};

const isValidPort = (value) =>
	Number.isInteger(value) && value > 0 && value <= 65_535;

const isPortAvailable = (port) =>
	new Promise((resolve) => {
		const probe = net.createServer();
		probe.unref();

		probe.once("error", () => {
			resolve(false);
		});

		probe.once("listening", () => {
			probe.close(() => {
				resolve(true);
			});
		});

		probe.listen(port);
	});

const getEphemeralPort = () =>
	new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.unref();

		probe.once("error", reject);
		probe.listen(0, () => {
			const addressInfo = probe.address();
			const port =
				addressInfo && typeof addressInfo === "object"
					? addressInfo.port
					: false;
			probe.close(() => resolve(port));
		});
	});

const resolveLiveReloadPort = async (requestedPort, flags) => {
	const parsedRequestedPort = parsePort(requestedPort);
	const candidatePorts = [];
	const checkedPorts = new Set();

	if (isValidPort(parsedRequestedPort)) {
		candidatePorts.push(parsedRequestedPort);
		checkedPorts.add(parsedRequestedPort);
	}

	for (
		let port = MARKSERV_LIVE_RELOAD_PORT_MIN;
		port <= MARKSERV_LIVE_RELOAD_PORT_MAX;
		port++
	) {
		if (!checkedPorts.has(port)) {
			candidatePorts.push(port);
		}
	}

	for (const port of candidatePorts) {
		// eslint-disable-next-line no-await-in-loop
		if (await isPortAvailable(port)) {
			if (
				isValidPort(parsedRequestedPort) &&
				port !== parsedRequestedPort
			) {
				warnmsg(
					"livereload",
					`port ${parsedRequestedPort} is in use, fallback to ${port}`,
					flags,
				);
			}

			return port;
		}
	}

	const fallbackPort = await getEphemeralPort();
	if (!isValidPort(fallbackPort)) {
		throw new Error("Could not allocate a free LiveReload port.");
	}

	warnmsg(
		"livereload",
		`ports ${MARKSERV_LIVE_RELOAD_PORT_MIN}-${MARKSERV_LIVE_RELOAD_PORT_MAX} are in use, fallback to ${fallbackPort}`,
		flags,
	);

	return fallbackPort;
};

const getMarkdownLineParts = (markdownText) => {
	const hasTrailingNewline = markdownText.endsWith("\n");
	const newline = markdownText.includes("\r\n") ? "\r\n" : "\n";
	const lines = markdownText.length === 0 ? [] : markdownText.split(/\r?\n/);

	if (hasTrailingNewline) {
		lines.pop();
	}

	return {
		lines,
		hasTrailingNewline,
		newline,
	};
};

const joinMarkdownLines = (lines, newline, hasTrailingNewline) => {
	let output = lines.join(newline);
	if (hasTrailingNewline) {
		output += newline;
	}

	return output;
};

const collectMarkdownSectionsFromTokens = (markdownText, tokens, setIndexAttr) => {
	const { lines } = getMarkdownLineParts(markdownText);
	const sections = [];
	let sectionIndex = 0;

	for (const token of tokens) {
		if (
			!token.block ||
			token.nesting !== 1 ||
			token.level !== 0 ||
			!Array.isArray(token.map)
		) {
			continue;
		}

		const [startLine, endLine] = token.map;
		if (setIndexAttr) {
			token.attrSet("data-ms-section-index", String(sectionIndex));
		}

		sections.push({
			index: sectionIndex,
			startLine,
			endLine,
			rawMarkdown: lines.slice(startLine, endLine).join("\n"),
		});
		sectionIndex++;
	}

	return sections;
};

const renderMarkdownWithSections = (markdownText) => {
	const tokens = md.parse(markdownText, {});
	const sections = collectMarkdownSectionsFromTokens(markdownText, tokens, true);
	const html = md.renderer.render(tokens, md.options, {});

	return {
		html,
		sections,
	};
};

const getMarkdownSections = (markdownText) => {
	const tokens = md.parse(markdownText, {});
	return collectMarkdownSectionsFromTokens(markdownText, tokens, false);
};

const toPosixPath = (filePath) => filePath.split(path.sep).join("/");

const toEditableRequestPath = (rootDir, absoluteFilePath) =>
	"/" + toPosixPath(path.relative(rootDir, absoluteFilePath));

const toScriptJson = (value) =>
	JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");

const sendJson = (res, statusCode, payload) => {
	res.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
	});
	res.end(JSON.stringify(payload));
};

const readJsonRequestBody = (req, maxBytes = MAX_EDIT_REQUEST_BODY_BYTES) =>
	new Promise((resolve, reject) => {
		let size = 0;
		let body = "";
		let settled = false;

		const finish = (err, value) => {
			if (settled) {
				return;
			}

			settled = true;
			if (err) {
				reject(err);
				return;
			}

			resolve(value);
		};

		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > maxBytes) {
				finish(new Error("Request body is too large."));
				return;
			}

			body += chunk.toString("utf8");
		});

		req.on("end", () => {
			if (size > maxBytes) {
				return;
			}

			try {
				const parsed = body.length > 0 ? JSON.parse(body) : {};
				finish(null, parsed);
			} catch (error) {
				finish(error);
			}
		});

		req.on("error", (error) => {
			finish(error);
		});
	});

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

const normalizeEditableFilePath = (rootDir, requestPath) => {
	if (typeof requestPath !== "string" || requestPath.trim() === "") {
		return false;
	}

	const rawPath = requestPath.startsWith("/") ? requestPath.slice(1) : requestPath;
	let decodedPath;
	try {
		decodedPath = decodeURIComponent(rawPath);
	} catch {
		return false;
	}

	const absoluteRootDir = path.resolve(rootDir);
	const absolutePath = path.resolve(absoluteRootDir, decodedPath);
	if (
		absolutePath !== absoluteRootDir &&
		!absolutePath.startsWith(absoluteRootDir + path.sep)
	) {
		return false;
	}

	return absolutePath;
};

const isSectionEditAction = (action) =>
	action === "update_section" || action === "insert_section_after";

const isDocumentEditAction = (action) => action === "update_document";

// eslint-disable-next-line complexity
const applyMarkdownEdit = ({ rootDir, payload }) => {
	const {
		action,
		filePath: requestFilePath,
		sectionIndex,
		markdown,
		baseMtimeMs,
	} = payload || {};

	if (!isSectionEditAction(action) && !isDocumentEditAction(action)) {
		return {
			statusCode: 400,
			payload: { ok: false, error: "Unsupported edit action." },
		};
	}

	if (
		isSectionEditAction(action) &&
		(!Number.isInteger(sectionIndex) || sectionIndex < 0)
	) {
		return {
			statusCode: 400,
			payload: { ok: false, error: "sectionIndex must be a non-negative integer." },
		};
	}

	if (typeof markdown !== "string") {
		return {
			statusCode: 400,
			payload: { ok: false, error: "markdown must be a string." },
		};
	}

	if (!Number.isFinite(baseMtimeMs)) {
		return {
			statusCode: 400,
			payload: { ok: false, error: "baseMtimeMs must be a number." },
		};
	}

	const absoluteFilePath = normalizeEditableFilePath(rootDir, requestFilePath);
	if (!absoluteFilePath || !isType(fileTypes.markdown, absoluteFilePath)) {
		return {
			statusCode: 400,
			payload: { ok: false, error: "filePath must point to a Markdown file." },
		};
	}

	let stat;
	try {
		stat = fs.statSync(absoluteFilePath);
	} catch (error) {
		if (error.code === "ENOENT") {
			return {
				statusCode: 404,
				payload: { ok: false, error: "Markdown file does not exist." },
			};
		}

		return {
			statusCode: 500,
			payload: { ok: false, error: "Could not access the Markdown file." },
		};
	}

	if (!stat.isFile()) {
		return {
			statusCode: 400,
			payload: { ok: false, error: "filePath must be a file." },
		};
	}

	if (stat.mtimeMs !== baseMtimeMs) {
		return {
			statusCode: 409,
			payload: {
				ok: false,
				error: "Markdown file changed on disk. Reload before saving.",
				mtimeMs: stat.mtimeMs,
			},
		};
	}

	let markdownSource;
	try {
		markdownSource = fs.readFileSync(absoluteFilePath, "utf8");
	} catch {
		return {
			statusCode: 500,
			payload: { ok: false, error: "Could not read the Markdown file." },
		};
	}

	let nextSource;
	if (isDocumentEditAction(action)) {
		nextSource = markdown;
	} else {
		const sections = getMarkdownSections(markdownSource);
		const targetSection = sections[sectionIndex];
		if (!targetSection) {
			return {
				statusCode: 404,
				payload: { ok: false, error: "sectionIndex is out of range." },
			};
		}

		if (action === "insert_section_after" && markdown.trim() === "") {
			return {
				statusCode: 200,
				payload: {
					ok: true,
					saved: false,
					mtimeMs: stat.mtimeMs,
				},
			};
		}

		const { lines, newline, hasTrailingNewline } = getMarkdownLineParts(markdownSource);
		const replacementLines = markdown.length === 0 ? [] : markdown.split(/\r?\n/);
		let nextLines;

		if (action === "update_section") {
			nextLines = [
				...lines.slice(0, targetSection.startLine),
				...replacementLines,
				...lines.slice(targetSection.endLine),
			];
		} else {
			nextLines = [
				...lines.slice(0, targetSection.endLine),
				"",
				...replacementLines,
				...lines.slice(targetSection.endLine),
			];
		}

		nextSource = joinMarkdownLines(nextLines, newline, hasTrailingNewline);
	}

	if (nextSource === markdownSource) {
		return {
			statusCode: 200,
			payload: {
				ok: true,
				saved: false,
				mtimeMs: stat.mtimeMs,
			},
		};
	}

	try {
		fs.writeFileSync(absoluteFilePath, nextSource, "utf8");
	} catch {
		return {
			statusCode: 500,
			payload: { ok: false, error: "Could not write to the Markdown file." },
		};
	}

	let nextStat;
	try {
		nextStat = fs.statSync(absoluteFilePath);
	} catch {
		return {
			statusCode: 500,
			payload: { ok: false, error: "Could not read updated file metadata." },
		};
	}

	return {
		statusCode: 200,
		payload: {
			ok: true,
			saved: true,
			mtimeMs: nextStat.mtimeMs,
		},
	};
};

// Http_request_handler: handles all the browser requests
const createRequestHandler = (flags, runtimeState = {}) => {
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
	const markservCssRelPath = path.normalize(path.join("templates", "markserv.css"));

	const getCurrentThemeCss = () =>
		buildThemeAwareMarkservCss(runtimeState.theme);

	return (req, res) => {
		const requestUrl = req.originalUrl || req.url || "/";
		let decodedUrl;
		try {
			decodedUrl = getPathFromUrl(decodeURIComponent(requestUrl));
		} catch {
			decodedUrl = getPathFromUrl(requestUrl);
		}

		if (req.method === "POST" && decodedUrl === "/__markserv/edit") {
			readJsonRequestBody(req)
				.then((payload) => {
					const result = applyMarkdownEdit({
						rootDir: dir,
						payload,
					});
					sendJson(res, result.statusCode, result.payload);
				})
				.catch((error) => {
					sendJson(res, 400, {
						ok: false,
						error: error.message || "Invalid JSON payload.",
					});
				});
			return;
		}

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

			if (path.normalize(markservFilePath) === markservCssRelPath) {
				res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
				res.end(getCurrentThemeCss());
				return;
			}

			send(req, markservRelFilePath).pipe(res);
			return;
		}

		const prettyPath = filePath;
		if (path.resolve(filePath) === path.resolve(MARKSERV_CSS_PATH)) {
			res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
			res.end(getCurrentThemeCss());
			return;
		}

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
				.then((markdownSource) => {
					const rendered = renderMarkdownWithSections(markdownSource);
					const editData = {
						filePath: toEditableRequestPath(dir, filePath),
						mtimeMs: stat.mtimeMs,
						documentMarkdown: markdownSource,
						sections: rendered.sections,
					};

					return implant(
						rendered.html,
						implantHandlers,
						implantOpts,
					).then((output) => ({
						output,
						editDataJson: toScriptJson(editData),
					}));
				})
				.then(({ output, editDataJson }) => {
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
						title: path.basename(path.resolve(dir)),
						content: output,
						navTree,
						rootDirStem: path.basename(path.resolve(dir)),
						hasSidebar: true,
						hasNavTree: navTree !== "",
						editDataJson,
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
				})
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
					title: path.basename(path.resolve(dir)),
					navTree,
					rootDirStem: path.basename(path.resolve(dir)),
					hasSidebar: true,
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

const startConnectApp = (liveReloadPort, httpRequestHandler) => {
	const connectApp = connect();

	if (isValidPort(liveReloadPort)) {
		connectApp.use(
			connectLiveReload({
				port: liveReloadPort,
			}),
		);
	}

	return connectApp.use("/", httpRequestHandler);
};

const listen = (server, port, host) =>
	new Promise((resolve, reject) => {
		const onError = (error) => {
			server.off("listening", onListening);
			reject(error);
		};

		const onListening = () => {
			server.off("error", onError);
			resolve();
		};

		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});

const startHTTPServer = async (connectApp, requestedPort, flags) => {
	const parsedRequestedPort = parsePort(requestedPort);
	if (!isValidPort(parsedRequestedPort)) {
		throw new Error(`Invalid port: ${requestedPort}`);
	}

	const portWasExplicitlyProvided = flags && flags.$portProvided === true;

	const makeHttpServer = () => (
		connectApp ? http.createServer(connectApp) : http.createServer()
	);

	const candidatePorts = [parsedRequestedPort];
	if (!portWasExplicitlyProvided) {
		const maxAttempts = 10;
		for (
			let port = parsedRequestedPort + 1;
			port <= 65_535 && candidatePorts.length < maxAttempts;
			port++
		) {
			candidatePorts.push(port);
		}
	}

	let lastError;
	for (const port of candidatePorts) {
		const httpServer = makeHttpServer();

		try {
			// eslint-disable-next-line no-await-in-loop
			await listen(httpServer, port, flags.address);

			if (port !== parsedRequestedPort) {
				warnmsg(
					"server",
					`port ${parsedRequestedPort} is in use, fallback to ${port}`,
					flags,
				);
			}

			httpServer.on("error", (error) => {
				errormsg("server", error.message, flags, error);
			});

			return { httpServer, port };
		} catch (error) {
			lastError = error;

			if (error && error.code === "EADDRINUSE") {
				continue;
			}

			throw error;
		}
	}

	if (
		!portWasExplicitlyProvided &&
		lastError &&
		lastError.code === "EADDRINUSE"
	) {
		const ephemeralPort = await getEphemeralPort();
		if (!isValidPort(ephemeralPort)) {
			throw lastError;
		}

		const httpServer = makeHttpServer();
		await listen(httpServer, ephemeralPort, flags.address);
		warnmsg(
			"server",
			`port ${parsedRequestedPort} is in use, fallback to ${ephemeralPort}`,
			flags,
		);

		httpServer.on("error", (error) => {
			errormsg("server", error.message, flags, error);
		});

		return { httpServer, port: ephemeralPort };
	}

	if (
		portWasExplicitlyProvided &&
		lastError &&
		lastError.code === "EADDRINUSE"
	) {
		const error = new Error(
			`Port ${parsedRequestedPort} is already in use. Try another port with -p/--port, or stop the process using it.`,
		);
		error.code = lastError.code;
		error.errno = lastError.errno;
		error.syscall = lastError.syscall;
		error.address = lastError.address;
		error.port = lastError.port;
		throw error;
	}

	throw lastError || new Error("Could not start HTTP server.");
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
	if (isValidPort(liveReloadPort)) {
		msg(
			"livereload",
			chalk`{grey communicating on port: ${style.port(liveReloadPort)}}`,
			flags,
		);
	} else {
		msg("livereload", chalk`{grey disabled}`, flags);
	}

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
	const liveReloadEnabled =
		!isFalseFlag(flags.livereloadport) && !isFalseFlag(flags.autoreload);
	const liveReloadPort = liveReloadEnabled
		? await resolveLiveReloadPort(flags.livereloadport, flags)
		: false;
	const requestedHttpPort = flags.port;

	const runtimeState = {
		httpPort: parsePort(requestedHttpPort),
		theme: pickRandomTheme(),
	};
	const httpRequestHandler = createRequestHandler(flags, runtimeState);
	const connectApp = startConnectApp(liveReloadPort, httpRequestHandler);
	const { httpServer, port: httpPort } = await startHTTPServer(
		connectApp,
		requestedHttpPort,
		flags,
	);
	runtimeState.httpPort = httpPort;

	let liveReloadServer;
	if (isValidPort(liveReloadPort)) {
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
		liveReloadPort,
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
	resolveLiveReloadPort,
	init,
};
