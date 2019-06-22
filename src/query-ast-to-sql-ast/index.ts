import assert from 'assert';
import {flatMap} from 'lodash';
import deprecate from 'deprecate';
import {getArgumentValues} from 'graphql/execution/values';
// @ts-ignore
import idx from 'idx';
import {FieldNode, SelectionNode} from 'graphql/language/ast';
import {
  GraphQLResolveInfo,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLField,
} from 'graphql/type/definition';

import {Options, DbCall, OrderBy, SQLAst} from '../types';
import AliasNamespace from '../alias-namespace';
import {wrap, ensure, unthunk, inspect} from '../util';
import {any} from 'bluebird';

class SQLASTNode {
  constructor(parentNode: SQLASTNode | null, props?: any) {
    Object.defineProperty(this, 'parent', {
      enumerable: false,
      value: parentNode,
    });

    for (let prop in props) {
      // @ts-ignore
      this[prop] = props[prop];
    }
  }
}

// an enumeration of all the types that can map to SQL tables
const TABLE_TYPES = [
  'GraphQLObjectType',
  'GraphQLUnionType',
  'GraphQLInterfaceType',
];

function mergeAll(fieldNodes: ReadonlyArray<FieldNode>) {
  const newFieldNodes = [...fieldNodes];
  while (newFieldNodes.length > 1) {
    newFieldNodes.push(merge(newFieldNodes.pop(), newFieldNodes.pop()));
  }
  return newFieldNodes;
}

function merge(dest: any, src: any) {
  return {
    ...dest,
    selectionSet: {
      ...dest.selectionSet,
      selections: [
        ...dest.selectionSet.selections,
        ...src.selectionSet.selections,
      ],
    },
  };
}

export function queryASTToSqlAST<TContext>(
  resolveInfo: GraphQLResolveInfo,
  options: Options,
  context: TContext
) {
  // this is responsible for all the logic regarding creating SQL aliases
  // we need varying degrees of uniqueness and readability
  // force oracle to minify, because it has this 30-character limit on column identifiers
  const namespace = new AliasNamespace(
    options.dialect === 'oracle' ? true : options.minify
  );

  // we'll build up the AST representing the SQL recursively
  // @ts-ignore
  const sqlAST: SQLAst = {};

  // v0.8 changed the "fieldASTs" property to "fieldNodes". we want to support both
  let fieldNodes: ReadonlyArray<FieldNode> =
    // @ts-ignore
    resolveInfo.fieldNodes || resolveInfo.fieldASTs;

  // fieldNodes is usually an array of 1 GraphQL node. If a field is requested twice *without* aliases, both nodes will be in this array
  // we need to merge it into one
  fieldNodes = mergeAll(fieldNodes);
  assert.equal(
    fieldNodes.length,
    1,
    'We thought this would always have a length of 1. FIX ME!!'
  );

  // this represents the parsed query
  const queryAST = fieldNodes[0];
  // resolveInfo.parentType is from the schema, its the GraphQLObjectType that is parent to the current field
  // this allows us to get the field definition of the current field so we can grab that extra metadata
  // e.g. sqlColumn or sqlJoin, etc.
  const parentType = resolveInfo.parentType;
  populateASTNode.call(
    resolveInfo,
    queryAST,
    parentType,
    sqlAST,
    namespace,
    0,
    options,
    context
  );

  // make sure they started this party on a table, interface or union.
  assert.ok(
    ['table', 'union'].indexOf(sqlAST.type!!) > -1,
    'Must call joinMonster in a resolver on a field where the type is decorated with "sqlTable".'
  );

  // make sure each "sqlDep" is only specified once at each level. also assign it an alias
  pruneDuplicateSqlDeps(sqlAST, namespace);

  return sqlAST;
}

export function populateASTNode<TContext>(
  this: GraphQLResolveInfo,
  queryASTNode: FieldNode,
  parentTypeNode: GraphQLObjectType,
  // TODO: type
  sqlASTNode: {type?: string},
  namespace: AliasNamespace,
  depth: number,
  options: Options,
  context: TContext
) {
  // first, get the name of the field being queried
  const fieldName = queryASTNode.name.value;

  // if this is an internal field (say, for introspection "__typename"), lets ignore it
  if (/^__/.test(fieldName)) {
    sqlASTNode.type = 'noop';
    return;
  }

  // then, get the field from the schema definition
  // TODO: is there alternative?
  // @ts-ignore
  let field: GraphQLField = parentTypeNode._fields[fieldName];
  if (!field) {
    throw new Error(
      `The field "${fieldName}" is not in the ${parentTypeNode.name} type.`
    );
  }

  let fieldIncludes;
  // @ts-ignore
  if (idx(sqlASTNode, (_) => _.parent.junction.include[fieldName])) {
    // @ts-ignore
    fieldIncludes = sqlASTNode.parent.junction.include[fieldName];
    field = {
      ...field,
      ...fieldIncludes,
    };
    // @ts-ignore
    sqlASTNode.fromOtherTable = sqlASTNode.parent.junction.as;
  }

  // allow for explicit ignoring of fields
  if (field.jmIgnoreAll) {
    sqlASTNode.type = 'noop';
    return;
  }

  // this flag will keep track of whether multiple rows are needed
  let grabMany = false;
  // the actual type might be wrapped in a GraphQLNonNull type
  let gqlType = stripNonNullType(field.type);

  // @ts-ignore
  sqlASTNode.args = getArgumentValues(field, queryASTNode, this.variableValues);

  // if list then mark flag true & get the type inside the GraphQLList container type
  if (gqlType.constructor.name === 'GraphQLList') {
    gqlType = stripNonNullType(gqlType.ofType);
    grabMany = true;
  }

  // if its a relay connection, there are several things we need to do
  if (
    gqlType.constructor.name === 'GraphQLObjectType' &&
    gqlType._fields.edges &&
    gqlType._fields.pageInfo
  ) {
    grabMany = true;
    // grab the types and fields inside the connection
    const stripped = stripRelayConnection(
      gqlType,
      queryASTNode,
      this.fragments
    );
    // reassign those
    gqlType = stripNonNullType(stripped.gqlType);
    queryASTNode = stripped.queryASTNode;
    // we'll set a flag for pagination.
    if (field.sqlPaginate) {
      // @ts-ignore
      sqlASTNode.paginate = true;
    }
  } else if (field.sqlPaginate) {
    throw new Error(
      `To paginate the ${gqlType.name} type, it must be a GraphQLObjectType that fulfills the relay spec.
      The type must have a "pageInfo" and "edges" field. https://facebook.github.io/relay/graphql/connections.htm`
    );
  }
  // the typeConfig has all the keyes from the GraphQLObjectType definition
  const config = gqlType._typeConfig;

  // is this a table in SQL?
  if (
    !field.jmIgnoreTable &&
    TABLE_TYPES.includes(gqlType.constructor.name) &&
    config.sqlTable
  ) {
    if (depth >= 1) {
      assert(
        !field.junctionTable,
        '"junctionTable" has been replaced with a new API.'
      );
      assert(
        field.sqlJoin || field.sqlBatch || field.junction,
        `If an Object type maps to a SQL table and has a child which is another Object type that also maps to a SQL table,
        you must define "sqlJoin", "sqlBatch", or "junction" on that field to tell joinMonster how to fetch it.
        Or you can ignore it with "jmIgnoreTable". Check the "${fieldName}" field on the "${parentTypeNode.name}" type.`
      );
    }
    handleTable.call(
      // @ts-ignore
      this,
      // @ts-ignore
      sqlASTNode,
      queryASTNode,
      field,
      gqlType,
      namespace,
      grabMany,
      depth,
      options,
      context
    );
    // is this a computed column from a raw expression?
  } else if (field.sqlExpr) {
    sqlASTNode.type = 'expression';
    // @ts-ignore
    sqlASTNode.sqlExpr = field.sqlExpr;
    // @ts-ignore
    let aliasFrom = (sqlASTNode.fieldName = field.name);
    // @ts-ignore
    if (sqlASTNode.defferedFrom) {
      aliasFrom += '@' + parentTypeNode.name;
    }
    // @ts-ignore
    sqlASTNode.as = namespace.generate('column', aliasFrom);
    // is it just a column? if they specified a sqlColumn or they didn't define a resolver, yeah
  } else if (field.sqlColumn || !field.resolve) {
    sqlASTNode.type = 'column';
    // @ts-ignore
    sqlASTNode.name = field.sqlColumn || field.name;
    // @ts-ignore
    let aliasFrom = (sqlASTNode.fieldName = field.name);
    // @ts-ignore
    if (sqlASTNode.defferedFrom) {
      aliasFrom += '@' + parentTypeNode.name;
    }
    // @ts-ignore
    sqlASTNode.as = namespace.generate('column', aliasFrom);
    // or maybe it just depends on some SQL columns
  } else if (field.sqlDeps) {
    sqlASTNode.type = 'columnDeps';
    // @ts-ignore
    sqlASTNode.names = field.sqlDeps;
    // maybe this node wants no business with your SQL, because it has its own resolver
  } else {
    sqlASTNode.type = 'noop';
  }
}

function handleTable<TContext>(
  this: GraphQLResolveInfo,
  sqlASTNode: SQLAst,
  queryASTNode: FieldNode,
  field: GraphQLField<any, any>,
  gqlType: GraphQLOutputType,
  namespace: AliasNamespace,
  grabMany: boolean,
  depth: number,
  options: Options,
  context: TContext
) {
  // @ts-ignore
  const config = gqlType._typeConfig;

  sqlASTNode.type = 'table';
  // @ts-ignore
  const sqlTable = unthunk(config.sqlTable, sqlASTNode.args || {}, context);
  // @ts-ignore
  sqlASTNode.name = sqlTable;

  // the graphQL field name will be the default alias for the table
  // if thats taken, this function will just add an underscore to the end to make it unique
  // @ts-ignore
  sqlASTNode.as = namespace.generate('table', field.name);

  // @ts-ignore
  if (field.orderBy && !sqlASTNode.orderBy) {
    // @ts-ignore
    sqlASTNode.orderBy = handleOrderBy(
      // @ts-ignore
      unthunk(field.orderBy, sqlASTNode.args || {}, context)
    );
  }

  // tables have child fields, lets push them to an array
  // @ts-ignore
  const children = (sqlASTNode.children = sqlASTNode.children || []);

  // @ts-ignore
  sqlASTNode.fieldName = field.name;
  // @ts-ignore
  sqlASTNode.grabMany = grabMany;

  // @ts-ignore
  if (field.where) {
    // @ts-ignore
    sqlASTNode.where = field.where;
  }

  /*
   * figure out if they are doing one-to-many/many-to-many or join/batch
   * and collect the relevant info
   */

  // are they doing a one-to-many sql join?
  // @ts-ignore
  if (field.sqlJoin) {
    // @ts-ignore
    sqlASTNode.sqlJoin = field.sqlJoin;
    // or a many-to-many?
    // @ts-ignore
  } else if (field.junction) {
    const junctionTable = unthunk(
      // @ts-ignore
      ensure(field.junction, 'sqlTable'),
      // @ts-ignore
      sqlASTNode.args || {},
      context
    );
    // @ts-ignore
    const junction = (sqlASTNode.junction = {
      sqlTable: junctionTable,
      as: namespace.generate('table', junctionTable),
    });
    // @ts-ignore
    if (field.junction.include) {
      // @ts-ignore
      junction.include = unthunk(
        // @ts-ignore
        field.junction.include,
        // @ts-ignore
        sqlASTNode.args || {},
        context
      );
    }

    // @ts-ignore
    if (field.junction.orderBy) {
      // @ts-ignore
      junction.orderBy = handleOrderBy(
        // @ts-ignore
        unthunk(field.junction.orderBy, sqlASTNode.args || {}, context)
      );
    }

    // @ts-ignore
    if (field.junction.where) {
      // @ts-ignore
      junction.where = field.junction.where;
    }
    // are they joining or batching?
    // @ts-ignore
    if (field.junction.sqlJoins) {
      // @ts-ignore
      junction.sqlJoins = field.junction.sqlJoins;
      // @ts-ignore
    } else if (field.junction.sqlBatch) {
      children.push({
        // @ts-ignore
        ...keyToASTChild(ensure(field.junction, 'uniqueKey'), namespace),
        fromOtherTable: junction.as,
      });
      // @ts-ignore
      junction.sqlBatch = {
        // @ts-ignore
        sqlJoin: ensure(field.junction.sqlBatch, 'sqlJoin'),
        thisKey: {
          ...columnToASTChild(
            // @ts-ignore
            ensure(field.junction.sqlBatch, 'thisKey'),
            namespace
          ),
          fromOtherTable: junction.as,
        },
        parentKey: columnToASTChild(
          // @ts-ignore
          ensure(field.junction.sqlBatch, 'parentKey'),
          namespace
        ),
      };
    } else {
      throw new Error('junction requires either a `sqlJoins` or `sqlBatch`');
    }
    // or are they doing a one-to-many with batching
    // @ts-ignore
  } else if (field.sqlBatch) {
    // @ts-ignore
    sqlASTNode.sqlBatch = {
      // @ts-ignore
      thisKey: columnToASTChild(ensure(field.sqlBatch, 'thisKey'), namespace),
      parentKey: columnToASTChild(
        // @ts-ignore
        ensure(field.sqlBatch, 'parentKey'),
        namespace
      ),
    };
  }

  // @ts-ignore
  if (field.limit) {
    // @ts-ignore
    assert(field.orderBy, '`orderBy` is required with `limit`');
    // @ts-ignore
    sqlASTNode.limit = unthunk(field.limit, sqlASTNode.args || {}, context);
  }

  // @ts-ignore
  if (sqlASTNode.paginate) {
    getSortColumns(field, sqlASTNode, context);
  }

  /*
   * figure out the necessary children. this includes the columns join monster needs, the ones the user needs,
   * and finding out how to map those to the field names
   */

  // the NestHydrationJS library only treats the first column as the unique identifier, therefore we
  // need whichever column that the schema specifies as the unique one to be the first child
  // @ts-ignore
  children.push(keyToASTChild(ensure(config, 'uniqueKey'), namespace));

  if (config.alwaysFetch) {
    // @ts-ignore
    for (let column of wrap(config.alwaysFetch)) {
      children.push(columnToASTChild(column, namespace));
    }
  }

  // this was created for helping resolve types in union types
  // its been generalized to `alwaysFetch`, as its a useful feature for more than just unions
  if (
    config.typeHint &&
    ['GraphQLUnionType', 'GraphQLInterfaceType'].includes(
      gqlType.constructor.name
    )
  ) {
    deprecate('`typeHint` is deprecated. Use `alwaysFetch` instead.');
    children.push(columnToASTChild(config.typeHint, namespace));
  }

  // go handle the pagination information
  // @ts-ignore
  if (sqlASTNode.paginate) {
    handleColumnsRequiredForPagination(sqlASTNode, namespace);
  }

  if (queryASTNode.selectionSet) {
    if (
      gqlType.constructor.name === 'GraphQLUnionType' ||
      gqlType.constructor.name === 'GraphQLInterfaceType'
    ) {
      // union types have special rules for the child fields in join monster
      sqlASTNode.type = 'union';
      // @ts-ignore
      sqlASTNode.typedChildren = {};
      handleUnionSelections.call(
        // @ts-ignore
        this,
        sqlASTNode,
        children,
        queryASTNode.selectionSet.selections,
        gqlType,
        namespace,
        depth,
        options,
        context
      );
    } else {
      handleSelections.call(
        // @ts-ignore
        this,
        sqlASTNode,
        children,
        queryASTNode.selectionSet.selections,
        gqlType,
        namespace,
        depth,
        options,
        context
      );
    }
  }
}

// we need to collect all fields from all the fragments requested in the union type and ask for them in SQL
function handleUnionSelections<TContext>(
  this: GraphQLResolveInfo,
  sqlASTNode: SQLAst,
  children: any[],
  selections: ReadonlyArray<SelectionNode>,
  gqlType: GraphQLOutputType,
  namespace: AliasNamespace,
  depth: number,
  options: Options,
  context: TContext,
  internalOptions = {}
) {
  for (let selection of selections) {
    // we need to figure out what kind of selection this is
    switch (selection.kind) {
      case 'Field':
        // has this field been requested once already? GraphQL does not protect against duplicates so we have to check for it
        const existingNode = children.find(
          (child) =>
            // @ts-ignore
            child.fieldName === selection.name.value && child.type === 'table'
        );
        let newNode = new SQLASTNode(sqlASTNode);
        if (existingNode) {
          newNode = existingNode;
        } else {
          children.push(newNode);
        }
        // @ts-ignore
        if (internalOptions.defferedFrom) {
          // @ts-ignore
          newNode.defferedFrom = internalOptions.defferedFrom;
        }
        populateASTNode.call(
          // @ts-ignore
          this,
          selection,
          // @ts-ignore
          gqlType,
          newNode,
          namespace,
          depth + 1,
          options,
          context
        );
        break;
      // if its an inline fragment, it has some fields and we gotta recurse thru all them
      case 'InlineFragment':
        {
          // @ts-ignore
          const selectionNameOfType = selection.typeCondition.name.value;
          // normally, we would scan for the extra join-monster data on the current gqlType.
          // but the gqlType is the Union. The data isn't there, its on each of the types that make up the union
          // lets find that type and handle the selections based on THAT type instead
          // @ts-ignore
          const deferredType = this.schema._typeMap[selectionNameOfType];
          const deferToObjectType =
            deferredType.constructor.name === 'GraphQLObjectType';
          const handler = deferToObjectType
            ? handleSelections
            : handleUnionSelections;
          if (deferToObjectType) {
            // @ts-ignore
            const typedChildren = sqlASTNode.typedChildren;
            children = typedChildren[deferredType.name] =
              typedChildren[deferredType.name] || [];
            // @ts-ignore
            internalOptions.defferedFrom = gqlType;
          }
          handler.call(
            // @ts-ignore
            this,
            sqlASTNode,
            children,
            selection.selectionSet.selections,
            deferredType,
            namespace,
            depth,
            options,
            context,
            internalOptions
          );
        }
        break;
      // if its a named fragment, we need to grab the fragment definition by its name and recurse over those fields
      case 'FragmentSpread':
        {
          const fragmentName = selection.name.value;
          // @ts-ignore
          const fragment = this.fragments[fragmentName];
          const fragmentNameOfType = fragment.typeCondition.name.value;
          // @ts-ignore
          const deferredType = this.schema._typeMap[fragmentNameOfType];
          const deferToObjectType =
            deferredType.constructor.name === 'GraphQLObjectType';
          const handler = deferToObjectType
            ? handleSelections
            : handleUnionSelections;
          if (deferToObjectType) {
            // @ts-ignore
            const typedChildren = sqlASTNode.typedChildren;
            children = typedChildren[deferredType.name] =
              typedChildren[deferredType.name] || [];
            // @ts-ignore
            internalOptions.defferedFrom = gqlType;
          }
          handler.call(
            // @ts-ignore
            this,
            sqlASTNode,
            children,
            fragment.selectionSet.selections,
            deferredType,
            namespace,
            depth,
            options,
            context,
            internalOptions
          );
        }
        break;
      /* istanbul ignore next */
      default:
        // @ts-ignore
        throw new Error('Unknown selection kind: ' + selection.kind);
    }
  }
}

// the selections could be several types, recursively handle each type here
function handleSelections<TContext>(
  this: GraphQLResolveInfo,
  sqlASTNode: SQLAst,
  children: any[],
  selections: ReadonlyArray<SelectionNode>,
  gqlType: GraphQLOutputType,
  namespace: AliasNamespace,
  depth: number,
  options: Options,
  context: TContext,
  internalOptions = {}
) {
  for (let selection of selections) {
    // we need to figure out what kind of selection this is
    switch (selection.kind) {
      // if its another field, recurse through that
      case 'Field':
        // has this field been requested once already? GraphQL does not protect against duplicates so we have to check for it
        const existingNode = children.find(
          (child) =>
            // @ts-ignore
            child.fieldName === selection.name.value && child.type === 'table'
        );
        let newNode = new SQLASTNode(sqlASTNode);
        if (existingNode) {
          newNode = existingNode;
        } else {
          children.push(newNode);
        }
        // @ts-ignore
        if (internalOptions.defferedFrom) {
          // @ts-ignore
          newNode.defferedFrom = internalOptions.defferedFrom;
        }
        populateASTNode.call(
          // @ts-ignore
          this,
          selection,
          // @ts-ignore
          gqlType,
          newNode,
          namespace,
          depth + 1,
          options,
          context
        );
        break;
      // if its an inline fragment, it has some fields and we gotta recurse thru all them
      case 'InlineFragment':
        {
          // check to make sure the type of this fragment (or one of the interfaces it implements) matches the type being queried
          // @ts-ignore
          const selectionNameOfType = selection.typeCondition.name.value;
          // @ts-ignore
          const sameType = selectionNameOfType === gqlType.name;
          // @ts-ignore
          const interfaceType = (gqlType._interfaces || [])
            // @ts-ignore
            .map((iface) => iface.name)
            .includes(selectionNameOfType);
          if (sameType || interfaceType) {
            handleSelections.call(
              // @ts-ignore
              this,
              sqlASTNode,
              children,
              selection.selectionSet.selections,
              gqlType,
              namespace,
              depth,
              options,
              context,
              internalOptions
            );
          }
        }
        break;
      // if its a named fragment, we need to grab the fragment definition by its name and recurse over those fields
      case 'FragmentSpread':
        {
          const fragmentName = selection.name.value;
          // @ts-ignore
          const fragment = this.fragments[fragmentName];
          // make sure fragment type (or one of the interfaces it implements) matches the type being queried
          const fragmentNameOfType = fragment.typeCondition.name.value;
          // @ts-ignore
          const sameType = fragmentNameOfType === gqlType.name;
          const interfaceType =
            // @ts-ignore
            gqlType._interfaces
              // @ts-ignore
              .map((iface) => iface.name)
              .indexOf(fragmentNameOfType) >= 0;
          if (sameType || interfaceType) {
            handleSelections.call(
              // @ts-ignore
              this,
              sqlASTNode,
              children,
              fragment.selectionSet.selections,
              gqlType,
              namespace,
              depth,
              options,
              context,
              internalOptions
            );
          }
        }
        break;
      /* istanbul ignore next */
      default:
        // @ts-ignore
        throw new Error('Unknown selection kind: ' + selection.kind);
    }
  }
}

// tell the AST we need a column that perhaps the user didnt ask for, but may be necessary for join monster to ID
// objects or associate ones across batches
function columnToASTChild(columnName: string, namespace: AliasNamespace) {
  return {
    type: 'column',
    name: columnName,
    fieldName: columnName,
    as: namespace.generate('column', columnName),
  };
}

// generate a name for a composite key based on the individual column names smashed together
// slice them to help prevent exceeding oracle's 30-char identifier limit
function toClumsyName(keyArr: string[]) {
  return keyArr.map((name) => name.slice(0, 3)).join('#');
}

// keys are necessary for deduplication during the hydration process
// this will handle singular or composite keys
function keyToASTChild(key: string, namespace: AliasNamespace) {
  if (typeof key === 'string') {
    return columnToASTChild(key, namespace);
  }
  if (Array.isArray(key)) {
    const clumsyName = toClumsyName(key);
    return {
      type: 'composite',
      name: key,
      fieldName: clumsyName,
      as: namespace.generate('column', clumsyName),
    };
  }
}

function handleColumnsRequiredForPagination(
  sqlASTNode: SQLAst,
  namespace: AliasNamespace
) {
  // @ts-ignore
  if (sqlASTNode.sortKey || idx(sqlASTNode, (_) => _.junction.sortKey)) {
    // @ts-ignore
    const sortKey = sqlASTNode.sortKey || sqlASTNode.junction.sortKey;
    assert(sortKey.order, '"sortKey" must have "order"');
    // this type of paging uses the "sort key(s)". we need to get this in order to generate the cursor
    // @ts-ignore
    for (let column of wrap(ensure(sortKey, 'key'))) {
      const newChild = columnToASTChild(column, namespace);
      // if this joining on a "through-table", the sort key is on the threw table instead of this node's parent table
      // @ts-ignore
      if (!sqlASTNode.sortKey) {
        // @ts-ignore
        newChild.fromOtherTable = sqlASTNode.junction.as;
      }
      // @ts-ignore
      sqlASTNode.children.push(newChild);
    }
    // @ts-ignore
  } else if (sqlASTNode.orderBy || idx(sqlASTNode, (_) => _.junction.orderBy)) {
    // this type of paging can visit arbitrary pages, so lets provide the total number of items
    // on this special "$total" column which we will compute in the query
    const newChild = columnToASTChild('$total', namespace);
    // @ts-ignore
    if (sqlASTNode.junction) {
      // @ts-ignore
      newChild.fromOtherTable = sqlASTNode.junction.as;
    }

    // @ts-ignore
    sqlASTNode.children.push(newChild);
  }
}

// if its a connection type, we need to look up the Node type inside their to find the relevant SQL info
function stripRelayConnection(
  gqlType: GraphQLOutputType,
  queryASTNode: FieldNode,
  fragments: GraphQLResolveInfo['fragments']
) {
  // get the GraphQL Type inside the list of edges inside the Node from the schema definition
  // @ts-ignore
  const edgeType: GraphQLOutputType = stripNonNullType(
    // @ts-ignore
    gqlType._fields.edges.type
  );
  const strippedType = stripNonNullType(
    // @ts-ignore
    stripNonNullType(edgeType.ofType)._fields.node.type
  );
  // let's remember those arguments on the connection
  const args = queryASTNode.arguments;
  // and then find the fields being selected on the underlying type, also buried within edges and Node
  const edges = spreadFragments(
    // @ts-ignore
    queryASTNode.selectionSet.selections,
    fragments,
    // @ts-ignore
    gqlType.name
    // @ts-ignore
  ).find((selection) => selection.name.value === 'edges');
  if (edges) {
    // @ts-ignore
    queryASTNode =
      spreadFragments(
        // @ts-ignore
        edges.selectionSet.selections,
        fragments,
        // @ts-ignore
        gqlType.name
        // @ts-ignore
      ).find((selection) => selection.name.value === 'node') || {};
  } else {
    // @ts-ignore
    queryASTNode = {};
  }
  // place the arguments on this inner field, so our SQL AST picks it up later
  // @ts-ignore
  queryASTNode.arguments = args;
  return {gqlType: strippedType, queryASTNode};
}

function stripNonNullType(type: GraphQLOutputType) {
  // @ts-ignore
  return type.constructor.name === 'GraphQLNonNull' ? type.ofType : type;
}

// go through and make sure se only ask for each sqlDep once per table
export function pruneDuplicateSqlDeps(
  sqlAST: SQLAst,
  namespace: AliasNamespace
) {
  const childrenToLoopOver = [];
  // @ts-ignore
  if (sqlAST.children) {
    // @ts-ignore
    childrenToLoopOver.push(sqlAST.children);
  }
  // @ts-ignore
  if (sqlAST.typedChildren) {
    // @ts-ignore
    childrenToLoopOver.push(...Object.values(sqlAST.typedChildren));
  }

  for (let children of childrenToLoopOver) {
    // keep track of all the dependent columns at this depth in a Set
    // use one Set per table. usually the table is the same. but sometimes they are pulling in data from
    // a junction table.
    const depsByTable = {};

    // loop thru each child which has "columnDeps", remove it from the tree, and add it to the set
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child.type === 'columnDeps') {
        const keyName = child.fromOtherTable || '';
        // @ts-ignore
        child.names.forEach((name) => {
          // @ts-ignore
          if (!depsByTable[keyName]) {
            // @ts-ignore
            depsByTable[keyName] = new Set();
          }
          // @ts-ignore
          depsByTable[keyName].add(name);
        });
        children.splice(i, 1);
        // or if its another table, recurse on it
      } else if (child.type === 'table' || child.type === 'union') {
        pruneDuplicateSqlDeps(child, namespace);
      }
    }

    // now that we collected the "columnDeps", add them all to one node
    // the "names" property will put all the column names in an object as keys
    // the values of this object will be the SQL alias
    for (let table in depsByTable) {
      const newNode = new SQLASTNode(sqlAST, {
        type: 'columnDeps',
        names: {},
        fromOtherTable: table || null,
      });
      // @ts-ignore
      depsByTable[table].forEach((name) => {
        // @ts-ignore
        newNode.names[name] = namespace.generate('column', name);
      });
      children.push(newNode);
    }
  }
}

// @ts-ignore
function getSortColumns(field, sqlASTNode, context) {
  if (field.sortKey) {
    sqlASTNode.sortKey = unthunk(field.sortKey, sqlASTNode.args || {}, context);
  }
  if (field.orderBy) {
    sqlASTNode.orderBy = handleOrderBy(
      unthunk(field.orderBy, sqlASTNode.args || {}, context)
    );
  }
  if (field.junction) {
    if (field.junction.sortKey) {
      sqlASTNode.junction.sortKey = unthunk(
        field.junction.sortKey,
        sqlASTNode.args || {},
        context
      );
    }
    if (field.junction.orderBy) {
      sqlASTNode.junction.orderBy = handleOrderBy(
        unthunk(field.junction.orderBy, sqlASTNode.args || {}, context)
      );
    }
  }
  if (!sqlASTNode.sortKey && !sqlASTNode.orderBy) {
    if (sqlASTNode.junction) {
      if (!sqlASTNode.junction.sortKey && !sqlASTNode.junction.orderBy) {
        throw new Error(
          '"sortKey" or "orderBy" required if "sqlPaginate" is true'
        );
      }
    } else {
      throw new Error(
        '"sortKey" or "orderBy" required if "sqlPaginate" is true'
      );
    }
  }
  // @ts-ignore
  if (sqlASTNode.sortKey && idx(sqlASTNode, (_) => _.junction.sortKey)) {
    throw new Error('"sortKey" must be on junction or main table, not both');
  }
  // @ts-ignore
  if (sqlASTNode.orderBy && idx(sqlASTNode, (_) => _.junction.orderBy)) {
    throw new Error('"orderBy" must be on junction or main table, not both');
  }
}

// instead of fields, selections can be fragments, which is another group of selections
// fragments can be arbitrarily nested
// this function recurses through and gets the relevant fields
function spreadFragments(
  selections: ReadonlyArray<SelectionNode>,
  fragments: GraphQLResolveInfo['fragments'],
  typeName: string
): FieldNode[] {
  return flatMap(selections, (selection) => {
    switch (selection.kind) {
      case 'FragmentSpread':
        const fragmentName = selection.name.value;
        const fragment = fragments[fragmentName];
        return spreadFragments(
          fragment.selectionSet.selections,
          fragments,
          typeName
        );
      case 'InlineFragment':
        // @ts-ignore
        if (selection.typeCondition.name.value === typeName) {
          return spreadFragments(
            selection.selectionSet.selections,
            fragments,
            typeName
          );
        }
        return [];

      default:
        return selection;
    }
  });
}

export function handleOrderBy(orderBy?: OrderBy | string) {
  if (!orderBy) return undefined;
  const orderColumns: OrderBy = {};
  if (typeof orderBy === 'object') {
    for (let column in orderBy) {
      let direction = orderBy[column].toUpperCase();
      if (direction !== 'ASC' && direction !== 'DESC') {
        throw new Error(direction + ' is not a valid sorting direction');
      }
      orderColumns[column] = direction;
    }
  } else if (typeof orderBy === 'string') {
    orderColumns[orderBy] = 'ASC';
  } else {
    throw new Error('"orderBy" is invalid type: ' + inspect(orderBy));
  }
  return orderColumns;
}
