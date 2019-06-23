import {
  GraphQLField,
  GraphQLInterfaceType,
  GraphQLUnionType,
  GraphQLObjectType,
} from 'graphql';

export type Quote = (va?: string) => string;

export interface DialectModule {
  name: string;

  quote: Quote;

  compositeKey(parentTable: string, name: string[]): string;

  handlePaginationAtRoot<TContext>(
    parent: Table_SQL_AST | Union_SQL_AST,
    node: SQL_AST,
    context: TContext,
    tables: string[]
  ): void;

  handleBatchedOneToManyPaginated<TContext>(
    parent: Table_SQL_AST | Union_SQL_AST,
    node: SQL_AST,
    context: TContext,
    tables: string[],
    batchScope: string[] | null
  ): void;

  handleJoinedManyToManyPaginated<TContext>(
    parent: Table_SQL_AST | Union_SQL_AST,
    node: SQL_AST,
    context: TContext,
    tables: string[],
    joinCondition1: string,
    joinCondition2: string
  ): void;

  handleJoinedOneToManyPaginated<TContext, TArgs>(
    parent: Table_SQL_AST | Union_SQL_AST,
    node: SQL_AST,
    context: TContext,
    tables: string[],
    joinCondition: string
  ): void;

  handleBatchedManyToManyPaginated<TContext, TArgs>(
    parent: Table_SQL_AST | Union_SQL_AST,
    node: SQL_AST,
    context: TContext,
    tables: string[],
    batchScope: string[],
    joinCondition: string
  ): void;
}

export type Dialect = 'pg' | 'oracle' | 'mariadb' | 'mysql' | 'sqlite3';
export type JoinMonsterOptions = {
  minify: boolean;
  dialect: Dialect;
  dialectModule: DialectModule;
};

type Order = 'ASC' | 'asc' | 'DESC' | 'desc';
type ThunkWithArgsCtx<T, TContext, TArgs> =
  | ((args: TArgs, context: TContext) => T)
  | T;

export type OrderBy = {
  [key: string]: 'ASC' | 'DESC';
};

export type SortKey = {
  order: Order;
  key: string | string[];
};

export type Where<TContext, TArgs> = (
  usersTable: string,
  args: TArgs,
  context: TContext,
  // TODO
  sqlASTNode: any
) => string | false | undefined | null;

type SqlJoin<TContext, TArgs> = (
  table1: string,
  table2: string,
  args: TArgs,
  context: TContext,
  // TODO
  sqlASTNode: any
) => string;

interface SqlJunctionInclude {
  sqlColumn?: string;
  sqlExpr?: string;
  sqlDeps?: string | string[];
}

export interface SqlJunction<TContext, TArgs> {
  include?: ThunkWithArgsCtx<SqlJunctionInclude, TContext, TArgs>;
  orderBy?: ThunkWithArgsCtx<OrderBy, TContext, TArgs>;
  sortKey?: ThunkWithArgsCtx<
    {
      order: Order;
      key: string | string[];
    },
    TContext,
    TArgs
  >;
  sqlBatch?: {
    thisKey: string;
    parentKey: string;
    sqlJoin: SqlJoin<TContext, TArgs>;
  };
  sqlJoins?: [SqlJoin<TContext, TArgs>, SqlJoin<TContext, TArgs>];
  sqlTable: ThunkWithArgsCtx<string, TContext, TArgs>;
  uniqueKey?: string | string[];
  where?: Where<TContext, TArgs>;
}

export interface Noop_SQL_AST {
  parent?: SQL_AST;
  type: 'noop';
}

export interface Table_SQL_AST<TContext = any, TArgs = any> {
  parent?: SQL_AST;
  type: 'table';
  as: 'string';
  args: TArgs;
  name: string;
  limit?: string;
  fieldName: string;
  where?: Where<TContext, TArgs>;
  // TODO: these 3 can't all be present
  sqlJoin?: SqlJoin<TContext, TArgs>;
  sqlBatch?: {
    thisKey: Column_SQL_AST;
    parentKey: Column_SQL_AST;
  };
  junction?: {
    sqlTable: string;
    as: string;

    include?: SqlJunctionInclude;
    sqlJoins?: SqlJunction<TContext, TArgs>['sqlJoins'];
    orderBy?: OrderBy;
    where?: Where<TContext, TArgs>;
    sortKey?: SortKey;
    sqlBatch?: {
      sqlJoin: SqlJoin<TContext, TArgs>;
      thisKey: Column_SQL_AST;
      parentKey: Column_SQL_AST;
    };
  };
  paginate?: boolean;
  grabMany: boolean;
  orderBy?: OrderBy;
  sortKey: SortKey;
  children: SQL_AST[];
  defferedFrom?: string;
}

export interface Union_SQL_AST<TContext = any, TArgs = any>
  extends Omit<Table_SQL_AST, 'type'> {
  type: 'union';
  typedChildren?: {
    [key: string]: SQL_AST[];
  };
}

export interface Column_SQL_AST {
  parent?: SQL_AST;
  type: 'column';
  name: string;
  fieldName: string;
  as: string;
  defferedFrom?: string;
  fromOtherTable?: string;
}

export interface ColumnDeps_SQL_AST {
  parent?: SQL_AST;
  type: 'columnDeps';
  fromOtherTable?: string;
  names: {[key: string]: string};
}

export interface Composite_SQL_AST {
  parent?: SQL_AST;
  type: 'composite';
  name: string[];
  fieldName: string;
  as: string;
  fromOtherTable?: string;
}

export interface Expression_SQL_AST<TContext = any, TArgs = any> {
  parent?: SQL_AST;
  type: 'expression';
  args: TArgs;
  as: string;
  sqlExpr(table: string, args: TArgs, context: TContext, node: any): string;
}

export type SQL_AST =
  | Noop_SQL_AST
  | Table_SQL_AST
  | Union_SQL_AST
  | Column_SQL_AST
  | ColumnDeps_SQL_AST
  | Composite_SQL_AST
  | Expression_SQL_AST;

export interface JoinMonsterObjectExtensions<TSource, TContext> {
  alwaysFetch?: string;
  sqlTable?: ThunkWithArgsCtx<string, any, TContext>;
  uniqueKey?: string | string[];
}

// TODO make these real types
export interface JoinMonsterGraphQLObjectTypeConfig<TSource, TContext>
  extends JoinMonsterObjectExtensions<TSource, TContext>,
    GraphQLObjectType {}

export interface JoinMonsterGraphQLUnionTypeConfig<TSource, TContext>
  extends JoinMonsterObjectExtensions<TSource, TContext>,
    GraphQLUnionType {}

export interface JoinMonsterGraphQLInterfaceTypeConfig<TSource, TContext>
  extends JoinMonsterObjectExtensions<TSource, TContext>,
    GraphQLInterfaceType {}

export interface JoinMonsterFieldConfig<
  TSource = any,
  TContext = any,
  TArgs = any
> extends GraphQLField<TSource, TContext, TArgs> {
  jmIgnoreAll?: boolean;
  jmIgnoreTable?: boolean;
  junction?: SqlJunction<TContext, TArgs>;
  limit?: ThunkWithArgsCtx<number, any, TContext>;
  orderBy?: ThunkWithArgsCtx<OrderBy, TContext, TArgs>;
  sortKey?: ThunkWithArgsCtx<
    {
      order: Order;
      key: string | string[];
    },
    TContext,
    TArgs
  >;
  sqlBatch?: {
    thisKey: string;
    parentKey: string;
    sqlJoin: SqlJoin<TContext, TArgs>;
  };
  sqlColumn?: string;
  sqlDeps?: string[];
  sqlExpr?: (
    table: string,
    args: TArgs,
    context: TContext,
    sqlASTNode: any
  ) => string;
  sqlJoin?: SqlJoin<TContext, TArgs>;
  sqlPaginate?: boolean;
  where?: Where<TContext, TArgs>;
}

export function isTableAst(node: SQL_AST): node is Table_SQL_AST {
  return (<Table_SQL_AST>node).type === 'table';
}

export function isUnionAst(node: SQL_AST): node is Union_SQL_AST {
  return (<Union_SQL_AST>node).type === 'union';
}

export function isTableOrUnionAst(
  node: SQL_AST
): node is Union_SQL_AST | Table_SQL_AST {
  return isTableAst(node) || isUnionAst(node);
}

export function isNoopAst(node: SQL_AST): node is Noop_SQL_AST {
  return (<Noop_SQL_AST>node).type === 'noop';
}
