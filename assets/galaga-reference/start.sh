#!/bin/sh
# Serves this folder on a free localhost port (exclusive bind, see serve.py) and opens the browser.
cd "$(dirname "$0")" || exit 1
exec python3 serve.py "$@"
