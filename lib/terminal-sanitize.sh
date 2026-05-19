#!/bin/bash
# terminal-sanitize.sh - portable terminal output cleanup helpers

strip-terminal-control() {
    if command -v perl >/dev/null 2>&1; then
        perl -pe 's/\e\[[0-?]*[ -\/]*[@-~]//g; s/\e\][^\a]*(?:\a|\e\\)//g; s/[\x00-\x08\x0B-\x1F\x7F]//g'
        return 0
    fi

    awk '
        {
            gsub(/\033\[[0-?]*[ -\/]*[@-~]/, "")
            gsub(/\033\][^\007]*(\007|\033\\)/, "")
            gsub(/[\001-\010\013-\037\177]/, "")
            print
        }
    '
}
