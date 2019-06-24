import {Node, TableNode, UnionNode} from '../query-ast-to-sql-ast/types';

export type Quote = (value?: string) => string;

export interface DialectModule {
  name: string;

  quote: Quote;

  compositeKey(parentTable: string, name: string[]): string;

  handlePaginationAtRoot<TContext>(
    parent: TableNode | UnionNode,
    node: Node,
    context: TContext,
    tables: string[]
  ): void;

  handleBatchedOneToManyPaginated<TContext>(
    parent: TableNode | UnionNode,
    node: Node,
    context: TContext,
    tables: string[],
    batchScope: string[] | null
  ): void;

  handleJoinedManyToManyPaginated<TContext>(
    parent: TableNode | UnionNode,
    node: Node,
    context: TContext,
    tables: string[],
    joinCondition1: string,
    joinCondition2: string
  ): void;

  handleJoinedOneToManyPaginated<TContext>(
    parent: TableNode | UnionNode,
    node: Node,
    context: TContext,
    tables: string[],
    joinCondition: string
  ): void;

  handleBatchedManyToManyPaginated<TContext>(
    parent: TableNode | UnionNode,
    node: Node,
    context: TContext,
    tables: string[],
    batchScope: string[],
    joinCondition: string
  ): void;
}
