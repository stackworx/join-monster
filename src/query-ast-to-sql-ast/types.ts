import {
  GraphQLField,
  GraphQLInterfaceType,
  GraphQLUnionType,
  GraphQLObjectType,
} from 'graphql';

type ThunkWithArgsCtx<T, TContext, TArgs> =
  | ((args: TArgs, context: TContext) => T)
  | T;

export type SortKey = {
  order: Order;
  key: string | string[];
};

export type Order = 'ASC' | 'asc' | 'DESC' | 'desc';

export type OrderBy = {
  [key: string]: 'ASC' | 'DESC';
};

export type Where<TContext, TArgs> = (
  usersTable: string,
  args: TArgs,
  context: TContext,
  sqlASTNode: TableNode | UnionNode
) => string | false | undefined | null;

type SqlJoin<TContext, TArgs> = (
  table1: string,
  table2: string,
  args: TArgs,
  context: TContext,
  sqlASTNode: TableNode | UnionNode
) => string;

type SqlExpr<TContext, TArgs> = (
  table: string,
  args: TArgs,
  context: TContext,
  sqlASTNode: ExpressionNode
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
  uniqueKey: string | string[];
  where?: Where<TContext, TArgs>;
}

export interface NoopNode {
  parent?: Node;
  type: 'noop';
}

export interface TableNode<TContext = any, TArgs = any> {
  parent?: Node;
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
    thisKey: ColumnNode;
    parentKey: ColumnNode;
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
      thisKey: ColumnNode;
      parentKey: ColumnNode;
    };
  };
  paginate?: boolean;
  grabMany: boolean;
  orderBy?: OrderBy;
  sortKey: SortKey;
  children: Node[];
  defferedFrom?: string;
}

export interface UnionNode<TContext = any, TArgs = any>
  extends Omit<TableNode, 'type'> {
  type: 'union';
  typedChildren?: {
    [key: string]: Node[];
  };
}

export interface ColumnNode {
  parent?: Node;
  type: 'column';
  name: string;
  fieldName: string;
  as: string;
  defferedFrom?: string;
  fromOtherTable?: string;
}

export interface ColumnDepsNode {
  parent?: Node;
  type: 'columnDeps';
  fromOtherTable?: string;
  names: {[key: string]: string};
}

export interface CompositeNode {
  parent?: Node;
  type: 'composite';
  name: string[];
  fieldName: string;
  as: string;
  fromOtherTable?: string;
}

export interface ExpressionNode<TContext = any, TArgs = any> {
  parent?: Node;
  type: 'expression';
  args: TArgs;
  as: string;
  sqlExpr: SqlExpr<TArgs, TContext>;
}

export type Node =
  | NoopNode
  | TableNode
  | UnionNode
  | ColumnNode
  | ColumnDepsNode
  | CompositeNode
  | ExpressionNode;

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
  sqlExpr?: SqlExpr<TContext, TArgs>;
  sqlJoin?: SqlJoin<TContext, TArgs>;
  sqlPaginate?: boolean;
  where?: Where<TContext, TArgs>;
}

export function isTableAst(node: Node): node is TableNode {
  return (<TableNode>node).type === 'table';
}

export function isUnionAst(node: Node): node is UnionNode {
  return (<UnionNode>node).type === 'union';
}

export function isTableOrUnionAst(node: Node): node is UnionNode | TableNode {
  return isTableAst(node) || isUnionAst(node);
}

export function isNoopAst(node: Node): node is NoopNode {
  return (<NoopNode>node).type === 'noop';
}
