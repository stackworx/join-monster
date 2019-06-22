import {
  interpretForOffsetPaging,
  interpretForKeysetPaging,
  orderColumnsToString,
} from '../shared';
import {filter} from 'lodash';

function recursiveConcat(keys: string[]): string {
  if (keys.length <= 1) {
    return keys[0];
  }
  return recursiveConcat([`CONCAT(${keys[0]}, ${keys[1]})`, ...keys.slice(2)]);
}

const q = (str: string) => `"${str}"`;

function keysetPagingSelect(
  table: string,
  whereCondition: string,
  order: any,
  limit: any,
  as: string,
  options: any = {}
) {
  let {joinCondition, joinType, extraJoin} = options;
  whereCondition = filter(whereCondition).join(' AND ') || '1 = 1';
  if (joinCondition) {
    return `\
${joinType === 'LEFT' ? 'OUTER' : 'CROSS'} APPLY (
  SELECT "${as}".*
  FROM ${table} "${as}"
  ${
    extraJoin
      ? `LEFT JOIN ${extraJoin.name} ${q(extraJoin.as)}
    ON ${extraJoin.condition}`
      : ''
  }
  WHERE ${whereCondition}
  ORDER BY ${orderColumnsToString(order.columns, q, order.table)}
  FETCH FIRST ${limit} ROWS ONLY
) ${q(as)}`;
  }
  return `\
FROM (
  SELECT "${as}".*
  FROM ${table} "${as}"
  WHERE ${whereCondition}
  ORDER BY ${orderColumnsToString(order.columns, q, order.table)}
  FETCH FIRST ${limit} ROWS ONLY
) ${q(as)}`;
}

function offsetPagingSelect(
  table: string,
  pagingWhereConditions: string,
  order: any,
  limit: any,
  offset: any,
  as: string,
  options: any = {}
) {
  let {joinCondition, joinType, extraJoin} = options;
  const whereCondition = filter(pagingWhereConditions).join(' AND ') || '1 = 1';
  if (joinCondition) {
    return `\
${joinType === 'LEFT' ? 'OUTER' : 'CROSS'} APPLY (
  SELECT "${as}".*, count(*) OVER () AS ${q('$total')}
  FROM ${table} "${as}"
  ${
    extraJoin
      ? `LEFT JOIN ${extraJoin.name} ${q(extraJoin.as)}
    ON ${extraJoin.condition}`
      : ''
  }
  WHERE ${whereCondition}
  ORDER BY ${orderColumnsToString(order.columns, q, order.table)}
  OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
) ${q(as)}`;
  }
  return `\
FROM (
  SELECT "${as}".*, count(*) OVER () AS ${q('$total')}
  FROM ${table} "${as}"
  WHERE ${whereCondition}
  ORDER BY ${orderColumnsToString(order.columns, q, order.table)}
  OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
) ${q(as)}`;
}

const dialect = (module.exports = {
  ...require('./pg'),
  name: 'oracle',

  compositeKey(parent: string, keys: string[]) {
    keys = keys.map((key) => `"${parent}"."${key}"`);
    return `NULLIF(${recursiveConcat(keys)}, '')`;
  },

  handlePaginationAtRoot: async function(
    parent: string,
    node: any,
    context: any,
    tables: string[]
  ) {
    const pagingWhereConditions = [];
    if (node.sortKey) {
      const {
        limit,
        order,
        whereCondition: whereAddendum,
      } = interpretForKeysetPaging(node, dialect);
      pagingWhereConditions.push(whereAddendum);
      if (node.where) {
        pagingWhereConditions.push(
          await node.where(`"${node.as}"`, node.args || {}, context, node)
        );
      }
      tables.push(
        keysetPagingSelect(
          node.name,
          // @ts-ignore
          pagingWhereConditions,
          order,
          limit,
          node.as
        )
      );
    } else if (node.orderBy) {
      const {limit, offset, order} = interpretForOffsetPaging(node, dialect);
      if (node.where) {
        pagingWhereConditions.push(
          await node.where(`"${node.as}"`, node.args || {}, context, node)
        );
      }
      tables.push(
        offsetPagingSelect(
          node.name,
          // @ts-ignore
          pagingWhereConditions,
          order,
          limit,
          offset,
          node.as
        )
      );
    }
  },

  handleJoinedOneToManyPaginated: async function(
    parent: any,
    node: any,
    context: any,
    tables: string[],
    joinCondition: any[]
  ) {
    const pagingWhereConditions = [
      await node.sqlJoin(
        `"${parent.as}"`,
        q(node.as),
        node.args || {},
        context,
        node
      ),
    ];
    if (node.where) {
      pagingWhereConditions.push(
        await node.where(`"${node.as}"`, node.args || {}, context, node)
      );
    }

    // which type of pagination are they using?
    if (node.sortKey) {
      const {
        limit,
        order,
        whereCondition: whereAddendum,
      } = interpretForKeysetPaging(node, dialect);
      pagingWhereConditions.push(whereAddendum);
      tables.push(
        keysetPagingSelect(
          node.name,
          // @ts-ignore
          pagingWhereConditions,
          order,
          limit,
          node.as,
          {
            joinCondition,
            joinType: 'LEFT',
          }
        )
      );
    } else if (node.orderBy) {
      const {limit, offset, order} = interpretForOffsetPaging(node, dialect);
      tables.push(
        offsetPagingSelect(
          node.name,
          // @ts-ignore
          pagingWhereConditions,
          order,
          limit,
          offset,
          node.as,
          {
            joinCondition,
            joinType: 'LEFT',
          }
        )
      );
    }
  },

  handleJoinedManyToManyPaginated: async function(
    parent: any,
    node: any,
    context: any,
    tables: string[],
    joinCondition1: any,
    joinCondition2: any
  ) {
    const pagingWhereConditions = [
      await node.junction.sqlJoins[0](
        `"${parent.as}"`,
        `"${node.junction.as}"`,
        node.args || {},
        context,
        node
      ),
    ];
    if (node.junction.where) {
      pagingWhereConditions.push(
        await node.junction.where(
          `"${node.junction.as}"`,
          node.args || {},
          context,
          node
        )
      );
    }
    if (node.where) {
      pagingWhereConditions.push(
        await node.where(`"${node.as}"`, node.args || {}, context, node)
      );
    }

    const lateralJoinOptions = {
      joinCondition: joinCondition1,
      joinType: 'LEFT',
    };
    if (node.where || node.orderBy) {
      // @ts-ignore
      lateralJoinOptions.extraJoin = {
        name: node.name,
        as: node.as,
        condition: joinCondition2,
      };
    }
    if (node.sortKey || node.junction.sortKey) {
      const {
        limit,
        order,
        whereCondition: whereAddendum,
      } = interpretForKeysetPaging(node, dialect);
      pagingWhereConditions.push(whereAddendum);
      tables.push(
        keysetPagingSelect(
          node.junction.sqlTable,
          // @ts-ignore
          pagingWhereConditions,
          order,
          limit,
          node.junction.as,
          lateralJoinOptions
        )
      );
    } else if (node.orderBy || node.junction.orderBy) {
      const {limit, offset, order} = interpretForOffsetPaging(node, dialect);
      tables.push(
        offsetPagingSelect(
          node.junction.sqlTable,
          // @ts-ignore
          pagingWhereConditions,
          order,
          limit,
          offset,
          node.junction.as,
          lateralJoinOptions
        )
      );
    }
  },

  handleBatchedOneToManyPaginated: async function(
    parent: any,
    node: any,
    context: any,
    tables: string[],
    batchScope: string[]
  ) {
    const pagingWhereConditions = [
      `"${node.as}"."${node.sqlBatch.thisKey.name}" = "temp"."value"`,
    ];
    if (node.where) {
      pagingWhereConditions.push(
        await node.where(`"${node.as}"`, node.args || {}, context, node)
      );
    }
    tables.push(`FROM (${arrToTableUnion(batchScope)}) "temp"`);
    const lateralJoinCondition = `"${node.as}"."${node.sqlBatch.thisKey.name}" = "temp"."value"`;
    if (node.sortKey) {
      const {
        limit,
        order,
        whereCondition: whereAddendum,
      } = interpretForKeysetPaging(node, dialect);
      pagingWhereConditions.push(whereAddendum);
      tables.push(
        keysetPagingSelect(
          node.name,
          // @ts-ignore
          pagingWhereConditions,
          order,
          limit,
          node.as,
          {joinCondition: lateralJoinCondition}
        )
      );
    } else if (node.orderBy) {
      const {limit, offset, order} = interpretForOffsetPaging(node, dialect);
      tables.push(
        offsetPagingSelect(
          node.name,
          // @ts-ignore
          pagingWhereConditions,
          order,
          limit,
          offset,
          node.as,
          {
            joinCondition: lateralJoinCondition,
          }
        )
      );
    }
  },

  handleBatchedManyToManyPaginated: async function(
    parent: any,
    node: any,
    context: any,
    tables: string[],
    batchScope: string[],
    joinCondition: any
  ) {
    const pagingWhereConditions = [
      `"${node.junction.as}"."${node.junction.sqlBatch.thisKey.name}" = "temp"."value"`,
    ];
    if (node.junction.where) {
      pagingWhereConditions.push(
        await node.junction.where(
          `"${node.junction.as}"`,
          node.args || {},
          context,
          node
        )
      );
    }
    if (node.where) {
      pagingWhereConditions.push(
        await node.where(`"${node.as}"`, node.args || {}, context, node)
      );
    }

    tables.push(`FROM (${arrToTableUnion(batchScope)}) "temp"`);
    const lateralJoinCondition = `"${node.junction.as}"."${node.junction.sqlBatch.thisKey.name}" = "temp"."value"`;

    const lateralJoinOptions = {
      joinCondition: lateralJoinCondition,
      joinType: 'LEFT',
    };
    if (node.where || node.orderBy) {
      // @ts-ignore
      lateralJoinOptions.extraJoin = {
        name: node.name,
        as: node.as,
        condition: joinCondition,
      };
    }
    if (node.sortKey || node.junction.sortKey) {
      const {
        limit,
        order,
        whereCondition: whereAddendum,
      } = interpretForKeysetPaging(node, dialect);
      pagingWhereConditions.push(whereAddendum);
      tables.push(
        keysetPagingSelect(
          node.junction.sqlTable,
          // @ts-ignore
          pagingWhereConditions,
          order,
          limit,
          node.junction.as,
          lateralJoinOptions
        )
      );
    } else if (node.orderBy || node.junction.orderBy) {
      const {limit, offset, order} = interpretForOffsetPaging(node, dialect);
      tables.push(
        offsetPagingSelect(
          node.junction.sqlTable,
          // @ts-ignore
          pagingWhereConditions,
          order,
          limit,
          offset,
          node.junction.as,
          lateralJoinOptions
        )
      );
    }
    tables.push(`LEFT JOIN ${node.name} "${node.as}" ON ${joinCondition}`);
  },
});

function arrToTableUnion(arr: string[]) {
  return arr
    .map(
      (val) => `
  SELECT ${val} AS "value" FROM DUAL
`
    )
    .join(' UNION ');
}
