#!/bin/bash
# Double-click this file in Finder to set up and run Pi Desktop PWA.
TARGET="$(readlink "$0" 2>/dev/null || echo "$0")"
cd "$(dirname "$TARGET")"
exec ./scripts/run.sh
