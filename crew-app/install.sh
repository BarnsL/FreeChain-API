#!/bin/sh
set -eu
command -v node >/dev/null 2>&1 || { echo 'Install Node.js 20 or newer first.' >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)' || { echo 'Node.js 20 or newer is required.' >&2; exit 1; }
command -v kirocrew >/dev/null 2>&1 || { echo 'Open a terminal with the Kiro Crew CLI on PATH, then rerun this installer.' >&2; exit 1; }
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
kirocrew app install "$directory"
printf '%s\n' 'FreeChain installed. Open Kiro Crew Library, grant app trust if requested, and enable FreeChain.' 'Add provider credentials on Providers. No standalone server or npm install is required.'
