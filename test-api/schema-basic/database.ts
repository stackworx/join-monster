import path from 'path';

import {MYSQL_URL, PG_URL, ORACLE_URL} from '../urls';

const dbType = process.env.DB;

const connection =
  process.env.NODE_ENV !== 'test'
    ? {filename: path.join(__dirname, '../data/db/test1-data.sl3')}
    : dbType === 'PG'
    ? pgUrl('test1')
    : dbType === 'MYSQL'
    ? mysqlUrl('test1')
    : dbType === 'ORACLE'
    ? oracleUrl('test1')
    : {filename: path.join(__dirname, '../data/db/test1-data.sl3')};

let client = 'sqlite3';
if (dbType === 'PG') {
  client = 'pg';
} else if (dbType === 'MYSQL') {
  client = 'mysql';
} else if (dbType === 'ORACLE') {
  client = 'oracledb';
}

// console.log('connection to', {client, connection});
export default require('knex')({client, connection, useNullAsDefault: true});

function pgUrl(dbName: string) {
  return PG_URL + dbName;
}

function mysqlUrl(dbName: string) {
  return MYSQL_URL + dbName;
}

function oracleUrl(dbName: string) {
  const [password, connectString] = ORACLE_URL!!.split('@');
  return {user: dbName, password, connectString, stmtCacheSize: 0};
}
