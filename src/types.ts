export type Dialect =
  | 'standard'
  | 'pg'
  | 'oracle'
  | 'mariadb'
  | 'mysql'
  | 'sqlite3';

export type Quote = (val: string) => string;

export interface DialectModule {
  name: string;
  quote: Quote;
  compositeKey(table: string, name: string): string;

  handleJoinedOneToManyPaginated(
    parent: any,
    node: any,
    context: any,
    tables: string[],
    joinCondition: any
  ): Promise<string>;

  handleJoinedManyToManyPaginated(
    parent: any,
    node: any,
    context: any,
    tables: string[],
    joinCondition1: any,
    joinCondition2: any
  ): Promise<string>;

  handleBatchedOneToManyPaginated(
    parent: any,
    node: any,
    context: any,
    tables: string[],
    batchScope: string[]
  ): Promise<string>;

  handlePaginationAtRoot(
    parent: any,
    node: any,
    context: any,
    tables: string[]
  ): Promise<string>;
}

export interface Options {
  minify?: boolean;
  dialect?: Dialect;
  // TODO: type
  dialectModule?: DialectModule;
}

type Order = 'ASC' | 'asc' | 'DESC' | 'desc';
type ThunkWithArgsCtx<T, TContext, TArgs> =
  | ((args: TArgs, context: TContext) => T)
  | T;

type Rows = any;
type DbCallCallback = (
  sql: string,
  done: (err?: any, rows?: Rows) => void
) => void;
type DbCallPromise = (sql: string) => Promise<Rows>;
export type DbCall = DbCallCallback | DbCallPromise;

export type OrderBy = {
  [key: string]: 'ASC' | 'DESC';
};

export type Where<TContext, TArgs> = (
  usersTable: string,
  args: TArgs,
  context: TContext,
  sqlASTNode: any
) => string | void;

type SqlJoin<TContext, TArgs> = (
  table1: string,
  table2: string,
  args: TArgs,
  context: TContext,
  sqlASTNode: any
) => string;

interface SqlBatch {
  thisKey: string;
  parentKey: string;
  sqlJoin: SqlJoin<any, any>;
}

export interface ShapeDefinition {}

export type SQLAst =
  | {type: 'noop'}
  | {type: 'column'; name: string; fieldName: string; as: string}
  | {
      type: 'columnDeps';
      names: {[key: string]: string};
    }
  | {
      type: 'table';
      name: string;
      fieldName: string;
      sqlJoin?: SqlJoin<any, any>;
      where?: Where<any, any>;
      sqlBatch?: {
        thisKey: string;
        parentKey: string;
        sqlJoin: SqlJoin<any, any>;
      };
      junction?: {
        include?: ThunkWithArgsCtx<
          {
            sqlColumn?: string;
            sqlExpr?: string;
            sqlDeps?: string | string[];
          },
          any,
          any
        >;
        orderBy?: ThunkWithArgsCtx<OrderBy, any, any>;
        sortKey?: ThunkWithArgsCtx<
          {
            order: Order;
            key: string | string[];
          },
          any,
          any
        >;
        sqlBatch?: SqlBatch;
        sqlJoins?: [SqlJoin<any, any>, SqlJoin<any, any>];
        sqlTable: ThunkWithArgsCtx<string, any, any>;
        uniqueKey?: string | string[];
        where?: Where<any, any>;
      };
      paginate?: boolean;
      grabMany: boolean;
      orderBy?: OrderBy;
      children: Array<SQLAst | string>[];
    }
  | {
      // TODO: union
      paginate: any;
      type: 'union';
      fieldName: string;
      sqlJoin?: SqlJoin<any, any>;
      where?: Where<any, any>;
      children: Array<SQLAst | string>[];
      sqlBatch?: {
        thisKey: string;
        parentKey: string;
        sqlJoin: SqlJoin<any, any>;
      };
      junction?: {
        include?: ThunkWithArgsCtx<
          {
            sqlColumn?: string;
            sqlExpr?: string;
            sqlDeps?: string | string[];
          },
          any,
          any
        >;
        orderBy?: ThunkWithArgsCtx<OrderBy, any, any>;
        sortKey?: ThunkWithArgsCtx<
          {
            order: Order;
            key: string | string[];
          },
          any,
          any
        >;
        sqlBatch?: SqlBatch;
        sqlJoins?: [SqlJoin<any, any>, SqlJoin<any, any>];
        sqlTable: ThunkWithArgsCtx<string, any, any>;
        uniqueKey?: string | string[];
        where?: Where<any, any>;
      };
    }
  | {
      // TODO paginate
      paginate: any;
      type: '????';
    }
  | {
      type: 'composite';
      name: 'string';
      as: 'string';
    }
  | {
      type: 'expression';
      args: any;
      sqlExpr(table: string, args: any, context: any, node: any): string;
    };
