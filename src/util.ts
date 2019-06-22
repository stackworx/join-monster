import util from 'util';
import assert from 'assert';
// @ts-ignore
import nesthydrationjs from 'nesthydrationjs';
import stringifySQL from './stringifiers/dispatcher';
import resolveUnions from './resolve-unions';
import deprecate from 'deprecate';
const debug = require('debug')('join-monster');

import defineObjectShape from './define-object-shape';
import {Options, SQLAst, DbCall, ShapeDefinition} from './types';

const NestHydrationJS = nesthydrationjs();

export function emphasize(str: string, colorCode = 33) {
  return `\n\x1b[1;${colorCode}m${str}\x1b[0m\n`;
}

export function inspect(obj: any, options = {}) {
  return util.inspect(obj, {depth: 12, ...options});
}

// really? yes, really
export function last(arr: any[]) {
  return arr[arr.length - 1];
}

export function wrap(maybeArr: unknown) {
  // @ts-ignore
  if (maybeArr.constructor === Array) {
    return maybeArr;
  }
  return [maybeArr];
}

export function isEmptyArray(val: unknown) {
  return Array.isArray(val) && val.length === 0;
}

export function ensure(obj: any, prop: string, name: string) {
  if (!obj[prop]) {
    throw new Error(
      `property "${prop}" must be defined on object: ${name ||
        util.inspect(obj)}`
    );
  }
  return obj[prop];
}

export function unthunk(val: unknown, ...args: any[]) {
  return typeof val === 'function' ? val(...args) : val;
}

export function validateSqlAST(topNode: SQLAst) {
  // TODO: this could be a bit more comprehensive
  // @ts-ignore
  assert(topNode.sqlJoin == null, 'root level field can not have "sqlJoin"');
}

export function objToCursor(obj: any) {
  const str = JSON.stringify(obj);
  return Buffer.from(str).toString('base64');
}

export function cursorToObj(cursor: string) {
  const str = Buffer.from(cursor, 'base64').toString();
  return JSON.parse(str);
}

// wrap in a pair of single quotes for the SQL if needed
export function maybeQuote(value: any, dialectName?: string) {
  if (value == null) {
    return 'NULL';
  }

  if (typeof value === 'number') return value;
  if (value && typeof value.toSQL === 'function') return value.toSQL();
  if (
    value instanceof Buffer &&
    typeof value === 'object' &&
    typeof value.toString === 'function'
  ) {
    return `X'${value.toString('hex')}'`;
  }
  if (
    dialectName === 'oracle' &&
    value.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(.\d+)?Z?/)
  ) {
    return value.replace(
      /(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(.\d+)?Z?/,
      "TIMESTAMP '$1 $2$3 UTC'"
    );
  }

  // Picked from https://github.com/brianc/node-postgres/blob/876018/lib/client.js#L235..L260
  // Ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
  let hasBackslash = false;
  let escaped = "'";

  for (let i = 0; i < value.length; i++) {
    let c = value[i];
    if (c === "'") {
      escaped += c + c;
    } else if (c === '\\') {
      escaped += c + c;
      hasBackslash = true;
    } else {
      escaped += c;
    }
  }

  escaped += "'";

  if (hasBackslash === true) {
    escaped = ' E' + escaped;
  }

  return escaped;
}

function getDialectName(options: Options) {
  if (options.dialectModule) {
    return options.dialectModule.name;
  }
  return options.dialect || 'sqlite3';
}

export function buildWhereFunction(
  // TODO: type
  type: any,
  // TODO: type
  condition: any,
  options: Options
) {
  const name = getDialectName(options);
  if (typeof condition === 'function') {
    return condition;
    // otherwise, we'll assume they gave us the value(s) of the unique key.
  }
  // determine the type of quotes necessary to escape the uniqueKey column
  const quote = ['mysql', 'mysql8', 'mariadb'].includes(name) ? '`' : '"';

  // determine the unique key so we know what to search by
  const uniqueKey = type._typeConfig.uniqueKey;

  // handle composite keys
  if (Array.isArray(uniqueKey)) {
    // it must have a corresponding array of values
    assert.equal(
      condition.length,
      uniqueKey.length,
      `The unique key for the "${type.name}" type is a composite. You must provide an array of values for each column.`
    );
    return (table: string) =>
      uniqueKey
        .map(
          (key, i) =>
            `${table}.${quote}${key}${quote} = ${maybeQuote(condition[i])}`
        )
        .join(' AND ');
    // single keys are simple
  }
  return (table: string) =>
    `${table}.${quote}${uniqueKey}${quote} = ${maybeQuote(condition)}`;
}

// handles the different callback signatures and return values.
export function handleUserDbCall(
  dbCall: DbCall,
  sql: string,
  sqlAST: SQLAst,
  shapeDefinition: ShapeDefinition
) {
  // if there are two args, we're in "callback mode"
  if (dbCall.length === 2) {
    // wrap it in a promise
    return new Promise((resolve, reject) => {
      // wait for them to call "done"
      dbCall(sql, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          rows = validate(rows);
          if (debug.enabled) {
            debug(emphasize('RAW_DATA'), inspect(rows.slice(0, 8)));
            debug(`${rows.length} rows...`);
          }
          const data = NestHydrationJS.nest(rows, shapeDefinition);
          resolveUnions(data, sqlAST);
          if (debug.enabled) {
            debug(emphasize('SHAPED_DATA'), inspect(data));
          }
          resolve(data);
        }
      });
    });
  }

  // otherwise, we are expecting a promise of the data
  // @ts-ignore
  const result: Promise<any[]> = dbCall(sql);
  if (typeof result.then === 'function') {
    return result.then((rows: any[]) => {
      rows = validate(rows);
      if (debug.enabled) {
        debug(emphasize('RAW DATA'), inspect(rows.slice(0, 8)));
        debug(`${rows.length} rows...`);
      }
      // hydrate the data
      // take that shape definition we produced and pass it to the NestHydrationJS library
      const data = NestHydrationJS.nest(rows, shapeDefinition);
      resolveUnions(data, sqlAST);
      if (debug.enabled) {
        debug(emphasize('SHAPED_DATA'), inspect(data));
      }
      return data;
    });
  }
  throw new Error('must return a promise of the data or use the callback');
}

// validate the data they gave us
function validate(rows: any[] | {rows: any[]}) {
  // its supposed to be an array of objects
  if (Array.isArray(rows)) return rows;
  // a check for the most common error. a lot of ORMs return an object with the desired data on the `rows` property
  if (rows && rows.rows) return rows.rows;

  throw new Error(
    `"dbCall" function must return/resolve an array of objects where each object is a row from the result set.
    Instead got ${util.inspect(rows, {depth: 3})}`
  );
}

export async function compileSqlAST(
  sqlAST: SQLAst,
  context: any,
  options: Options
) {
  if (debug.enabled) {
    debug(emphasize('SQL_AST'), inspect(sqlAST));
  }

  // now convert the "SQL AST" to sql
  options.dialect = options.dialect || 'sqlite3';
  if (options.dialect === 'standard') {
    deprecate(
      'dialect "standard" is deprecated, because there is no true implementation of the SQL standard',
      '"sqlite3" is the default'
    );
    options.dialect = 'sqlite3';
  }
  const sql = await stringifySQL(sqlAST, context, options);
  if (debug.enabled) {
    debug(emphasize('SQL'), sql);
  }

  // figure out the shape of the object and define it so later we can pass it to
  // NestHydration library so it can hydrate the data
  const shapeDefinition = defineObjectShape(sqlAST);
  if (debug.enabled) {
    debug(emphasize('SHAPE_DEFINITION'), inspect(shapeDefinition));
  }
  return {sql, shapeDefinition};
}
