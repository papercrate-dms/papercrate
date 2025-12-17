#!/bin/bash
set -e

echo "Waiting for Postgres..."
until pg_isready -h postgres -U papercrate; do
  sleep 1
done

echo "Running migrations..."
diesel migration run

echo "Building binaries for first run..."
cargo build --bin backend --bin worker --bin webdav

echo "Starting supervisord..."
exec supervisord -c supervisord.conf
