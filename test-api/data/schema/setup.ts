import Knex from 'knex';
import assert from 'assert';

import migrate from '../migrate';

import {MYSQL_URL, PG_URL, ORACLE_URL} from '../../urls';

export default async function setup(db: string, name: string): Promise<Knex> {
  if (db === 'oracle') {
    console.log('building oracle');
    const [password, connectString] = ORACLE_URL!!.split('@');
    const knex = require('knex')({
      client: 'oracledb',
      connection: {
        user: name,
        password,
        connectString,
        stmtCacheSize: 0,
      },
    });

    await migrate(db, knex);
    return knex;
  }

  if (db === 'pg') {
    assert(
      PG_URL,
      'Must provide environment variable PG_URL, e.g. "postgres://user:pass@localhost/"'
    );
    const knex = require('knex')({
      client: 'pg',
      connection: PG_URL + name,
    });

    await migrate(db, knex);
    return knex;
  }

  if (db === 'mysql') {
    assert(
      MYSQL_URL,
      'Must provide environment variable MYSQL_URL, e.g. "mysql://user:pass@localhost/"'
    );
    const knex = require('knex')({
      client: 'mysql',
      connection: MYSQL_URL + name,
    });

    await migrate(db, knex);
    return knex;
  }

  if (db === 'sqlite3') {
    const knex = require('knex')({
      client: 'sqlite3',
      connection: {
        // TODO: change to in-memory?
        filename: __dirname + `/../db/${name}-data.sl3`,
      },
      useNullAsDefault: true,
    });

    await migrate(db, knex);
    return knex;
  }

  throw new Error(`do not recognize database "${db}"`);
}
