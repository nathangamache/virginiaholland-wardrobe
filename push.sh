#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: ./push.sh \"commit message\""
  exit 1
fi

git add -A

if git diff --cached --quiet; then
  echo "No changes to commit."
  exit 0
fi

git commit -m "$1"
git push -u origin "$(git branch --show-current)"