# Markserv Multi-Root

## Overview

`markserv master` starts one server that serves multiple registered roots.

- `/` shows the registered root list
- `/roots/<slug>/...` serves each root
- use one fixed port such as `8642`

## Start Master

```sh
markserv master -a localhost -p 8642
```

If you publish it through Tailscale:

```sh
tailscale serve localhost:8642
```

## Add Roots

```sh
markserv root add ~/workspace/project-a --slug project-a --title "Project A"
markserv root add ~/workspace/project-b --slug project-b --title "Project B"
```

## Manage Roots

List roots:

```sh
markserv root list
```

Remove a root:

```sh
markserv root remove project-a
```

Open a root directory locally:

```sh
markserv root open project-a
```

## Registry

The default registry path is:

```text
~/.config/markserv/roots.json
```

You can override it:

```sh
markserv master --registry /path/to/roots.json
markserv root add ~/workspace/project --registry /path/to/roots.json
```

## Notes

- HTTP port is fixed; if the port is already in use, startup fails
- LiveReload port is also fixed; no automatic fallback
- registry changes are reloaded by the master server
