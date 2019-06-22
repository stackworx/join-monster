import {uniq, chain, map, groupBy, forIn} from 'lodash';
// @ts-ignore
import idx from 'idx';

import arrToConnection from '../array-to-connection';
import {handleUserDbCall, maybeQuote, wrap, compileSqlAST} from '../util';
import {Options, DbCall, SQLAst} from '../types';

async function nextBatch<TContext>(
  sqlAST: SQLAst,
  data: any,
  dbCall: DbCall,
  context: TContext,
  options: Options
) {
  // paginated fields are wrapped in connections. strip those off for the batching
  // @ts-ignore
  if (sqlAST.paginate) {
    if (Array.isArray(data)) {
      data = chain(data)
        .flatMap('edges')
        .map('node')
        .value();
    } else {
      data = map(data.edges, 'node');
    }
  }
  if (!data || (Array.isArray(data) && data.length === 0)) {
    return;
  }

  // @ts-ignore
  const children = sqlAST.children;
  // @ts-ignore
  Object.values(sqlAST.typedChildren || {}).forEach((typedChildren) =>
    // @ts-ignore
    children.push(...typedChildren)
  );

  // loop through all the child fields that are tables
  return Promise.all(
    // @ts-ignore
    children.map((childAST) =>
      nextBatchChild(childAST, data, dbCall, context, options)
    )
  );
}

// processes a single child of the batch
async function nextBatchChild<TContext>(
  childAST: SQLAst,
  data: any,
  dbCall: DbCall,
  context: TContext,
  options: Options
) {
  if (childAST.type !== 'table' && childAST.type !== 'union') return;

  const fieldName = childAST.fieldName;

  // see if any begin a new batch
  // @ts-ignore
  if (childAST.sqlBatch || idx(childAST, (_) => _.junction.sqlBatch)) {
    let thisKey;
    // @ts-ignore
    let parentKey;
    if (childAST.sqlBatch) {
      // if so, we know we'll need to get the key for matching with the parent key
      // @ts-ignore
      childAST.children.push(childAST.sqlBatch.thisKey);
      // @ts-ignore
      thisKey = childAST.sqlBatch.thisKey.fieldName;
      // @ts-ignore
      parentKey = childAST.sqlBatch.parentKey.fieldName;
    } else if (idx(childAST, (_: any) => _.junction.sqlBatch)) {
      // @ts-ignore
      childAST.children.push(childAST.junction.sqlBatch.thisKey);
      // @ts-ignore
      thisKey = childAST.junction.sqlBatch.thisKey.fieldName;
      // @ts-ignore
      parentKey = childAST.junction.sqlBatch.parentKey.fieldName;
    }

    if (Array.isArray(data)) {
      // the "batch scope" is teh set of values to match this key against from the previous batch
      // @ts-ignore
      const batchScope = uniq(data.map((obj) => maybeQuote(obj[parentKey])));
      // generate the SQL, with the batch scope values incorporated in a WHERE IN clause
      const {sql, shapeDefinition} = await compileSqlAST(childAST, context, {
        ...options,
        // @ts-ignore
        batchScope,
      });
      // grab the data
      let newData = await handleUserDbCall(
        dbCall,
        sql,
        childAST,
        // @ts-ignore
        wrap(shapeDefinition)
      );
      // group the rows by the key so we can match them with the previous batch
      newData = groupBy(newData, thisKey);
      // but if we paginate, we must convert to connection type first
      if (childAST.paginate) {
        forIn(newData, (group, key, obj) => {
          obj[key] = arrToConnection(group, childAST);
        });
      }
      // if we they want many rows, give them an array
      // @ts-ignore
      if (childAST.grabMany) {
        for (let obj of data) {
          obj[fieldName] =
            newData[obj[parentKey]] ||
            (childAST.paginate ? {total: 0, edges: []} : []);
        }
      } else {
        let matchedData = [];
        for (let obj of data) {
          const ob = newData[obj[parentKey]];
          if (ob) {
            obj[fieldName] = arrToConnection(
              newData[obj[parentKey]][0],
              childAST
            );
            matchedData.push(obj);
          } else {
            obj[fieldName] = null;
          }
        }
        data = matchedData;
      }

      // move down a level and recurse
      const nextLevelData = chain(data)
        .filter((obj) => obj != null)
        .flatMap((obj) => obj[fieldName])
        .filter((obj) => obj != null)
        .value();
      return nextBatch(childAST, nextLevelData, dbCall, context, options);
    }
    const batchScope = [maybeQuote(data[parentKey])];
    const {sql, shapeDefinition} = await compileSqlAST(childAST, context, {
      ...options,
      // @ts-ignore
      batchScope,
    });
    let newData = await handleUserDbCall(
      dbCall,
      sql,
      childAST,
      // @ts-ignore
      wrap(shapeDefinition)
    );
    newData = groupBy(newData, thisKey);
    if (childAST.paginate) {
      const targets = newData[data[parentKey]];
      data[fieldName] = arrToConnection(targets, childAST);
      // @ts-ignore
    } else if (childAST.grabMany) {
      data[fieldName] = newData[data[parentKey]] || [];
    } else {
      const targets = newData[data[parentKey]] || [];
      data[fieldName] = targets[0];
    }
    if (data) {
      return nextBatch(childAST, data[fieldName], dbCall, context, options);
    }

    // otherwise, just bypass this and recurse down to the next level
  } else if (Array.isArray(data)) {
    const nextLevelData = chain(data)
      .filter((obj) => obj != null)
      .flatMap((obj) => obj[fieldName])
      .filter((obj) => obj != null)
      .value();
    return nextBatch(childAST, nextLevelData, dbCall, context, options);
  } else if (data) {
    return nextBatch(childAST, data[fieldName], dbCall, context, options);
  }
}

export default nextBatch;
