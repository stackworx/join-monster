import {
  keysetPagingSelect,
  offsetPagingSelect,
  interpretForOffsetPaging,
  interpretForKeysetPaging,
  generateCastExpressionFromValueType,
} from '../shared';

const dialect = (module.exports = {
  name: 'pg',

  quote(str: string) {
    return `"${str}"`;
  },

  compositeKey(parent: string, keys: string[]) {
    keys = keys.map((key) => `"${parent}"."${key}"`);
    return `NULLIF(CONCAT(${keys.join(', ')}), '')`;
  },

  handleJoinedOneToManyPaginated: async function(
    parent: any,
    node: any,
    context: any,
    tables: string[],
    joinCondition: any
  ) {
    const pagingWhereConditions = [
      await node.sqlJoin(
        `"${parent.as}"`,
        `"${node.as}"`,
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
        // @ts-ignore
      } = interpretForKeysetPaging(node, dialect);
      pagingWhereConditions.push(whereAddendum);
      tables.push(
        keysetPagingSelect(
          node.name,
          pagingWhereConditions,
          order,
          limit,
          node.as,
          {joinCondition, joinType: 'LEFT'}
        )
      );
    } else if (node.orderBy) {
      // @ts-ignore
      const {limit, offset, order} = interpretForOffsetPaging(node, dialect);
      tables.push(
        offsetPagingSelect(
          node.name,
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

  handleBatchedManyToManyPaginated: async function(
    parent: any,
    node: any,
    context: any,
    tables: string[],
    batchScope: string[],
    joinCondition: any
  ) {
    const thisKeyOperand = generateCastExpressionFromValueType(
      `"${node.junction.as}"."${node.junction.sqlBatch.thisKey.name}"`,
      batchScope[0]
    );
    const pagingWhereConditions = [
      `${thisKeyOperand} = temp."${node.junction.sqlBatch.parentKey.name}"`,
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

    const tempTable = `FROM (VALUES ${batchScope.map(
      (val) => `(${val})`
    )}) temp("${node.junction.sqlBatch.parentKey.name}")`;
    tables.push(tempTable);
    const lateralJoinCondition = `${thisKeyOperand} = temp."${node.junction.sqlBatch.parentKey.name}"`;

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
        // @ts-ignore
      } = interpretForKeysetPaging(node, dialect);
      pagingWhereConditions.push(whereAddendum);
      tables.push(
        keysetPagingSelect(
          node.junction.sqlTable,
          pagingWhereConditions,
          order,
          limit,
          node.junction.as,
          lateralJoinOptions
        )
      );
    } else if (node.orderBy || node.junction.orderBy) {
      // @ts-ignore
      const {limit, offset, order} = interpretForOffsetPaging(node, dialect);
      tables.push(
        offsetPagingSelect(
          node.junction.sqlTable,
          pagingWhereConditions,
          order,
          limit,
          offset,
          node.junction.as,
          lateralJoinOptions
        )
      );
    }
    tables.push(`LEFT JOIN ${node.name} AS "${node.as}" ON ${joinCondition}`);
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
        // @ts-ignore
      } = interpretForKeysetPaging(node, dialect);
      pagingWhereConditions.push(whereAddendum);
      tables.push(
        keysetPagingSelect(
          node.junction.sqlTable,
          pagingWhereConditions,
          order,
          limit,
          node.junction.as,
          lateralJoinOptions
        )
      );
    } else if (node.orderBy || node.junction.orderBy) {
      // @ts-ignore
      const {limit, offset, order} = interpretForOffsetPaging(node, dialect);
      tables.push(
        offsetPagingSelect(
          node.junction.sqlTable,
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

  handlePaginationAtRoot: async function(
    parent: any,
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
        // @ts-ignore
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
          pagingWhereConditions,
          order,
          limit,
          node.as
        )
      );
    } else if (node.orderBy) {
      // @ts-ignore
      const {limit, offset, order} = interpretForOffsetPaging(node, dialect);
      if (node.where) {
        pagingWhereConditions.push(
          await node.where(`"${node.as}"`, node.args || {}, context, node)
        );
      }
      tables.push(
        offsetPagingSelect(
          node.name,
          pagingWhereConditions,
          order,
          limit,
          offset,
          node.as
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
    const thisKeyOperand = generateCastExpressionFromValueType(
      `"${node.as}"."${node.sqlBatch.thisKey.name}"`,
      batchScope[0]
    );
    const pagingWhereConditions = [
      `${thisKeyOperand} = temp."${node.sqlBatch.parentKey.name}"`,
    ];
    if (node.where) {
      pagingWhereConditions.push(
        await node.where(`"${node.as}"`, node.args || {}, context, node)
      );
    }
    const tempTable = `FROM (VALUES ${batchScope.map(
      (val) => `(${val})`
    )}) temp("${node.sqlBatch.parentKey.name}")`;
    tables.push(tempTable);
    const lateralJoinCondition = `${thisKeyOperand} = temp."${node.sqlBatch.parentKey.name}"`;
    if (node.sortKey) {
      const {
        limit,
        order,
        whereCondition: whereAddendum,
        // @ts-ignore
      } = interpretForKeysetPaging(node, dialect);
      pagingWhereConditions.push(whereAddendum);
      tables.push(
        keysetPagingSelect(
          node.name,
          pagingWhereConditions,
          order,
          limit,
          node.as,
          {joinCondition: lateralJoinCondition}
        )
      );
    } else if (node.orderBy) {
      // @ts-ignore
      const {limit, offset, order} = interpretForOffsetPaging(node, dialect);
      tables.push(
        offsetPagingSelect(
          node.name,
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
});
