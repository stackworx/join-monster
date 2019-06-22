import assert from 'assert';
import {filter} from 'lodash';
// @ts-ignore
import idx from 'idx';

import {validateSqlAST, inspect, wrap} from '../util';
import {
  joinPrefix,
  thisIsNotTheEndOfThisBatch,
  whereConditionIsntSupposedToGoInsideSubqueryOrOnNextBatch,
} from './shared';
import {SQLAst, Options, Dialect, DialectModule, Quote} from '../types';

export default async function stringifySqlAST<TContext>(
  topNode: SQLAst,
  context: TContext,
  options: Options
) {
  validateSqlAST(topNode);

  let dialect = options.dialectModule!!;

  if (!dialect && options.dialect) {
    dialect = require('./dialects/' + options.dialect);
  }

  // recursively figure out all the selections, joins, and where conditions that we need
  let {selections, tables, wheres, orders} = await _stringifySqlAST(
    null,
    topNode,
    [],
    context,
    [],
    [],
    [],
    [],
    // @ts-ignore
    options.batchScope,
    // @ts-ignore
    dialect
  );

  // make sure these are unique by converting to a set and then back to an array
  // e.g. we want to get rid of things like `SELECT user.id as id, user.id as id, ...`
  // GraphQL does not prevent queries with duplicate fields
  selections = [...new Set(selections)];

  // bail out if they made no selections
  if (!selections.length) return '';

  // put together the SQL query
  let sql = 'SELECT\n  ' + selections.join(',\n  ') + '\n' + tables.join('\n');

  wheres = filter(wheres);
  if (wheres.length) {
    sql += '\nWHERE ' + wheres.join(' AND ');
  }

  if (orders.length) {
    sql += '\nORDER BY ' + stringifyOuterOrder(orders, dialect.quote);
  }

  return sql;
}

async function _stringifySqlAST<TContext>(
  parent: null | SQLAst,
  node: SQLAst,
  prefix: string[],
  context: TContext,
  selections: string[],
  tables: string[],
  wheres: string[],
  orders: string[],
  batchScope: string[],
  dialect: DialectModule
): Promise<{
  selections: string[];
  tables: string[];
  wheres: string[];
  orders: string[];
}> {
  const {quote: q} = dialect;
  // @ts-ignore
  const parentTable = node.fromOtherTable || (parent && parent.as);
  switch (node.type) {
    case 'table':
      await handleTable(
        parent,
        node,
        prefix,
        context,
        selections,
        tables,
        wheres,
        orders,
        batchScope,
        dialect
      );

      // recurse thru nodes
      // @ts-ignore
      if (thisIsNotTheEndOfThisBatch(node, parent)) {
        for (let child of node.children) {
          await _stringifySqlAST(
            node,
            // @ts-ignore
            child,
            // @ts-ignore
            [...prefix, node.as],
            context,
            selections,
            tables,
            wheres,
            orders,
            null,
            dialect
          );
        }
      }

      break;
    case 'union':
      await handleTable(
        parent,
        node,
        prefix,
        context,
        selections,
        tables,
        wheres,
        orders,
        batchScope,
        dialect
      );

      // recurse thru nodes
      // @ts-ignore
      if (thisIsNotTheEndOfThisBatch(node, parent)) {
        // @ts-ignore
        for (let typeName in node.typedChildren) {
          // @ts-ignore
          for (let child of node.typedChildren[typeName]) {
            await _stringifySqlAST(
              node,
              child,
              // @ts-ignore
              [...prefix, node.as],
              context,
              selections,
              tables,
              wheres,
              orders,
              // @ts-ignore
              null,
              dialect
            );
          }
        }
        for (let child of node.children) {
          await _stringifySqlAST(
            node,
            // @ts-ignore
            child,
            // @ts-ignore
            [...prefix, node.as],
            context,
            selections,
            tables,
            wheres,
            orders,
            null,
            dialect
          );
        }
      }

      break;
    case 'column':
      selections.push(
        `${q(parentTable)}.${q(node.name)} AS ${q(
          joinPrefix(prefix) + node.as
        )}`
      );
      break;
    case 'columnDeps':
      // grab the dependant columns
      for (let name in node.names) {
        selections.push(
          `${q(parentTable)}.${q(name)} AS ${q(
            joinPrefix(prefix) + node.names[name]
          )}`
        );
      }
      break;
    case 'composite':
      selections.push(
        `${dialect.compositeKey(parentTable, node.name)} AS ${q(
          joinPrefix(prefix) + node.as
        )}`
      );
      break;
    case 'expression':
      const expr = await node.sqlExpr(
        `${q(parentTable)}`,
        node.args || {},
        context,
        node
      );
      // @ts-ignore
      selections.push(`${expr} AS ${q(joinPrefix(prefix) + node.as)}`);
      break;
    case 'noop':
      // we hit this with fields that don't need anything from SQL, they resolve independently
      // @ts-ignore
      return;
    default:
      throw new Error('unexpected/unknown node type reached: ' + inspect(node));
  }
  return {selections, tables, wheres, orders};
}

async function handleTable<TContext>(
  parent: SQLAst | null,
  node: SQLAst,
  prefix: string[],
  context: TContext,
  selections: string[],
  tables: string[],
  wheres: string[],
  orders: string[],
  batchScope: string[],
  dialect: DialectModule
) {
  const {quote: q} = dialect;
  // generate the "where" condition, if applicable
  // @ts-ignore
  if (whereConditionIsntSupposedToGoInsideSubqueryOrOnNextBatch(node, parent)) {
    // @ts-ignore
    if (idx(node, (_) => _.junction.where)) {
      wheres.push(
        // @ts-ignore
        await node.junction.where(
          // @ts-ignore
          `${q(node.junction.as)}`,
          // @ts-ignore
          node.args || {},
          context,
          node
        )
      );
    }
    // @ts-ignore
    if (node.where) {
      wheres.push(
        // @ts-ignore
        await node.where(`${q(node.as)}`, node.args || {}, context, node)
      );
    }
  }

  // @ts-ignore
  if (thisIsNotTheEndOfThisBatch(node, parent)) {
    // @ts-ignore
    if (idx(node, (_) => _.junction.orderBy)) {
      // @ts-ignore
      orders.push({
        // @ts-ignore
        table: node.junction.as,
        // @ts-ignore
        columns: node.junction.orderBy,
      });
    }
    // @ts-ignore
    if (node.orderBy) {
      // @ts-ignore
      orders.push({
        // @ts-ignore
        table: node.as,
        // @ts-ignore
        columns: node.orderBy,
      });
    }
    // @ts-ignore
    if (idx(node, (_) => _.junction.sortKey)) {
      // @ts-ignore
      orders.push({
        // @ts-ignore
        table: node.junction.as,
        // @ts-ignore
        columns: sortKeyToOrderColumns(node.junction.sortKey, node.args),
      });
    }
    // @ts-ignore
    if (node.sortKey) {
      // @ts-ignore
      orders.push({
        // @ts-ignore
        table: node.as,
        // @ts-ignore
        columns: sortKeyToOrderColumns(node.sortKey, node.args),
      });
    }
  }

  // one-to-many using JOIN
  // @ts-ignore
  if (node.sqlJoin) {
    // @ts-ignore
    const joinCondition = await node.sqlJoin(
      // @ts-ignore
      `${q(parent.as)}`,
      // @ts-ignore
      q(node.as),
      // @ts-ignore
      node.args || {},
      context,
      node
    );

    // do we need to paginate? if so this will be a lateral join
    // @ts-ignore
    if (node.paginate) {
      await dialect.handleJoinedOneToManyPaginated(
        parent,
        node,
        context,
        tables,
        joinCondition
      );

      // limit has a highly similar approach to paginating
      // @ts-ignore
    } else if (node.limit) {
      // @ts-ignore
      node.args.first = node.limit;
      await dialect.handleJoinedOneToManyPaginated(
        parent,
        node,
        context,
        tables,
        joinCondition
      );
      // otherwite, just a regular left join on the table
    } else {
      // @ts-ignore
      tables.push(`LEFT JOIN ${node.name} ${q(node.as)} ON ${joinCondition}`);
    }

    // many-to-many using batching
    // @ts-ignore
  } else if (idx(node, (_) => _.junction.sqlBatch)) {
    if (parent) {
      selections.push(
        // @ts-ignore
        `${q(parent.as)}.${q(node.junction.sqlBatch.parentKey.name)} AS ${q(
          // @ts-ignore
          joinPrefix(prefix) + node.junction.sqlBatch.parentKey.as
        )}`
      );
    } else {
      // @ts-ignore
      const joinCondition = await node.junction.sqlBatch.sqlJoin(
        // @ts-ignore
        `${q(node.junction.as)}`,
        // @ts-ignore
        q(node.as),
        // @ts-ignore
        node.args || {},
        context,
        node
      );
      // @ts-ignore
      if (node.paginate) {
        // @ts-ignore
        await dialect.handleBatchedManyToManyPaginated(
          parent,
          node,
          context,
          tables,
          batchScope,
          joinCondition
        );
        // @ts-ignore
      } else if (node.limit) {
        // @ts-ignore
        node.args.first = node.limit;
        // @ts-ignore
        await dialect.handleBatchedManyToManyPaginated(
          parent,
          node,
          context,
          tables,
          batchScope,
          joinCondition
        );
      } else {
        tables.push(
          // @ts-ignore
          `FROM ${node.junction.sqlTable} ${q(node.junction.as)}`,
          // @ts-ignore
          `LEFT JOIN ${node.name} ${q(node.as)} ON ${joinCondition}`
        );
        // ensures only the correct records are fetched using the value of the parent key
        wheres.push(
          // @ts-ignore
          `${q(node.junction.as)}.${q(
            // @ts-ignore
            node.junction.sqlBatch.thisKey.name
          )} IN (${batchScope.join(',')})`
        );
      }
    }

    // many-to-many using JOINs
    // @ts-ignore
  } else if (idx(node, (_) => _.junction.sqlTable)) {
    // @ts-ignore
    const joinCondition1 = await node.junction.sqlJoins[0](
      // @ts-ignore
      `${q(parent.as)}`,
      // @ts-ignore
      q(node.junction.as),
      // @ts-ignore
      node.args || {},
      context,
      node
    );
    // @ts-ignore
    const joinCondition2 = await node.junction.sqlJoins[1](
      // @ts-ignore
      `${q(node.junction.as)}`,
      // @ts-ignore
      q(node.as),
      // @ts-ignore
      node.args || {},
      context,
      node
    );

    // @ts-ignore
    if (node.paginate) {
      await dialect.handleJoinedManyToManyPaginated(
        parent,
        node,
        context,
        tables,
        joinCondition1,
        joinCondition2
      );
      // @ts-ignore
    } else if (node.limit) {
      // @ts-ignore
      node.args.first = node.limit;
      await dialect.handleJoinedManyToManyPaginated(
        parent,
        node,
        context,
        tables,
        joinCondition1,
        joinCondition2
      );
    } else {
      tables.push(
        // @ts-ignore
        `LEFT JOIN ${node.junction.sqlTable} ${q(
          // @ts-ignore
          node.junction.as
        )} ON ${joinCondition1}`
      );
    }
    // @ts-ignore
    tables.push(`LEFT JOIN ${node.name} ${q(node.as)} ON ${joinCondition2}`);

    // one-to-many with batching
    // @ts-ignore
  } else if (node.sqlBatch) {
    if (parent) {
      selections.push(
        // @ts-ignore
        `${q(parent.as)}.${q(node.sqlBatch.parentKey.name)} AS ${q(
          // @ts-ignore
          joinPrefix(prefix) + node.sqlBatch.parentKey.as
        )}`
      );
      // @ts-ignore
    } else if (node.paginate) {
      // @ts-ignore
      await dialect.handleBatchedOneToManyPaginated(
        parent,
        node,
        context,
        tables,
        batchScope
      );
      // @ts-ignore
    } else if (node.limit) {
      // @ts-ignore
      node.args.first = node.limit;
      await dialect.handleBatchedOneToManyPaginated(
        parent,
        node,
        context,
        tables,
        batchScope
      );
      // otherwite, just a regular left join on the table
    } else {
      // @ts-ignore
      tables.push(`FROM ${node.name} ${q(node.as)}`);
      wheres.push(
        // @ts-ignore
        `${q(node.as)}.${q(node.sqlBatch.thisKey.name)} IN (${batchScope.join(
          ','
        )})`
      );
    }
    // otherwise, we aren't joining, so we are at the "root", and this is the start of the FROM clause
    // @ts-ignore
  } else if (node.paginate) {
    await dialect.handlePaginationAtRoot(parent, node, context, tables);
    // @ts-ignore
  } else if (node.limit) {
    // @ts-ignore
    node.args.first = node.limit;
    await dialect.handlePaginationAtRoot(parent, node, context, tables);
  } else {
    assert(
      !parent,
      // @ts-ignore
      `Object type for "${node.fieldName}" table must have a "sqlJoin" or "sqlBatch"`
    );
    // @ts-ignore
    tables.push(`FROM ${node.name} ${q(node.as)}`);
  }
}

// we need one ORDER BY clause on at the very end to make sure everything comes back in the correct order
// ordering inner(sub) queries DOES NOT guarantee the order of those results in the outer query
function stringifyOuterOrder(orders: any[], q: Quote) {
  const conditions = [];
  for (let condition of orders) {
    for (let column in condition.columns) {
      const direction = condition.columns[column];
      conditions.push(`${q(condition.table)}.${q(column)} ${direction}`);
    }
  }
  return conditions.join(', ');
}

function sortKeyToOrderColumns(sortKey: any, args: any) {
  let descending = sortKey.order.toUpperCase() === 'DESC';
  if (args && args.last) {
    descending = !descending;
  }
  const orderColumns = {};
  // @ts-ignore
  for (let column of wrap(sortKey.key)) {
    // @ts-ignore
    orderColumns[column] = descending ? 'DESC' : 'ASC';
  }
  return orderColumns;
}
