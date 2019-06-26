// Default connection strings for docker-compose setup
export const {
  MYSQL_URL = 'mysql://root:testrootpassword@localhost:23306/',
  PG_URL = 'postgres://testuser:testpassword@localhost:25432/',
  ORACLE_URL,
  // TODO oracle and mssql
} = process.env;
