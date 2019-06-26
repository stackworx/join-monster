#!/bin/bash
set -e

docker-compose -f scripts/docker-compose.yml down 
yarn db:start
yarn db:schema
yarn db-build

./bin/test
