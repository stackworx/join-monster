import path from 'path';

import {MYSQL_URL, PG_URL, ORACLE_URL} from '../urls';

const dbType = process.env.DB;

const connection =
  process.env.NODE_ENV !== 'test'
    ? pgUrl(process.env.PAGINATE ? 'test2' : 'test1')
    : dbType === 'PG'
    ? pgUrl(process.env.PAGINATE ? 'test2' : 'test1')
    : dbType === 'MYSQL'
    ? mysqlUrl(process.env.PAGINATE ? 'test2' : 'test1')
    : dbType === 'ORACLE'
    ? oracleUrl(process.env.PAGINATE ? 'test2' : 'test1')
    : {filename: path.join(__dirname, '../data/db/test1-data.sl3')};

let client = 'sqlite3';
if (process.env.NODE_ENV !== 'test') {
  client = 'pg';
} else if (dbType === 'PG') {
  client = 'pg';
} else if (dbType === 'MYSQL') {
  client = 'mysql';
} else if (dbType === 'ORACLE') {
  client = 'oracledb';
}

// console.log('connection to', {client, connection});
export default require('knex')({
  client,
  connection,
  useNullAsDefault: true,
});

function pgUrl(dbName) {
  return PG_URL + dbName;
}

function mysqlUrl(dbName) {
  return MYSQL_URL + dbName;
}

function oracleUrl(dbName) {
  const [password, connectString] = ORACLE_URL!!.split('@');
  return {user: dbName, password, connectString, stmtCacheSize: 0};
}
