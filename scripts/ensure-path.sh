#!/usr/bin/env bash
# Finder-launched .command files get a minimal PATH — add common Node locations.
export PATH="/usr/local/bin:/opt/homebrew/bin:${HOME}/.hermes/node/bin:${PATH}"

if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
	# shellcheck disable=SC1091
	source "${HOME}/.nvm/nvm.sh"
elif [[ -x "${HOME}/.fnm/fnm" ]]; then
	eval "$("${HOME}/.fnm/fnm" env)"
elif command -v fnm >/dev/null 2>&1; then
	eval "$(fnm env)"
fi
