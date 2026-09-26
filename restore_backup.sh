#!/usr/bin/env bash
set -e

echo "Restoring to stable checkpoint v1-stable-point..."
git reset --hard v1-stable-point
git clean -fd
echo "Restored successfully to stable version!"
