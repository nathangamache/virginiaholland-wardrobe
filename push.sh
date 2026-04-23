#!/bin/bash

# Exit if no commit message provided
if [ -z "$1" ]; then
  echo "Usage: ./push.sh \"commit message\""
  exit 1
fi

# Add all changes
git add -A

# Commit
git commit -m "$1"

# Push to current branch
git push