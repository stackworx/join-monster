#!/bin/bash
docker-compose -f scripts/docker-compose.yml exec postgres psql -c "CREATE DATABASE test1 LC_COLLATE 'en_US.utf8';" -U testuser
docker-compose -f scripts/docker-compose.yml exec postgres psql -c "CREATE DATABASE test2 LC_COLLATE 'en_US.utf8';" -U testuser
docker-compose -f scripts/docker-compose.yml exec postgres psql -c "CREATE DATABASE demo LC_COLLATE 'en_US.utf8';" -U testuser
docker-compose -f scripts/docker-compose.yml exec mysql bash -c 'echo "CREATE DATABASE test1" | mysql -uroot -ptestrootpassword'
docker-compose -f scripts/docker-compose.yml exec mysql bash -c 'echo "CREATE DATABASE test2" | mysql -uroot -ptestrootpassword'