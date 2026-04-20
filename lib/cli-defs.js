module.exports = {
	flags: {
		port: {
			alias: "p",
			default: "8642"
		},

		livereloadport: {
			alias: "l",
			default: 35_729
		},

		browser: {
			alias: "b",
			default: true
		},

		autoreload: {
			default: "manual"
		},

		address: {
			alias: "a",
			default: "localhost"
		},

		silent: {
			alias: "s",
			default: false
		},

		verbose: {
			alias: "v",
			default: false
		},
		showalldir: {
			default: false
		},
		markdownOnlyDir: {
			default: false
		},

		poll: {
			default: true
		},

		registry: {
			default: ""
		},

		slug: {
			default: ""
		},

		title: {
			default: ""
		},

		theme: {
			default: ""
		}
	}
};
