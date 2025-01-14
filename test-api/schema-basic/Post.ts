import {
  GraphQLObjectType,
  GraphQLList,
  GraphQLString,
  GraphQLInt,
  GraphQLBoolean,
} from 'graphql';

import User from './User';
import Comment from './Comment';
import {q, bool} from '../shared';
import Authored from './Authored/Interface';

const {STRATEGY, DB} = process.env;

const Post: GraphQLObjectType = new GraphQLObjectType({
  description: 'A post from a user',
  name: 'Post',
  sqlTable: q('posts', DB),
  uniqueKey: 'id',
  interfaces: () => [Authored],
  // @ts-ignore
  fields: () => ({
    id: {
      type: GraphQLInt,
    },
    body: {
      description: 'The content of the post',
      type: GraphQLString,
    },
    authorId: {
      type: GraphQLInt,
      sqlColumn: 'author_id',
    },
    author: {
      description: 'The user that created the post',
      type: User,
      ...(STRATEGY === 'batch'
        ? {
            sqlBatch: {
              thisKey: 'id',
              parentKey: 'author_id',
            },
          }
        : {
            sqlJoin: (postTable, userTable) =>
              `${postTable}.${q('author_id', DB)} = ${userTable}.${q(
                'id',
                DB
              )}`,
          }),
    },
    comments: {
      description: 'The comments on this post',
      type: new GraphQLList(Comment),
      args: {
        active: {type: GraphQLBoolean},
        asc: {type: GraphQLBoolean},
      },
      orderBy: (args) => ({id: args.asc ? 'asc' : 'desc'}),
      ...(['batch', 'mix'].includes(STRATEGY!!)
        ? {
            sqlBatch: {
              thisKey: 'post_id',
              parentKey: 'id',
            },
            where: (table, args) =>
              args.active
                ? `${table}.${q('archived', DB)} = ${bool(false, DB)}`
                : null,
          }
        : {
            sqlJoin: (postTable, commentTable, args) =>
              `${commentTable}.${q('post_id', DB)} = ${postTable}.${q(
                'id',
                DB
              )} ${
                args.active
                  ? `AND ${commentTable}.${q('archived', DB)} = ${bool(
                      false,
                      DB
                    )}`
                  : ''
              }`,
          }),
    },
    numComments: {
      description: 'How many comments this post has',
      type: GraphQLInt,
      // you can info from a correlated subquery
      sqlExpr: (table) =>
        `(SELECT count(*) from ${q('comments', DB)} WHERE ${table}.${q(
          'id',
          DB
        )} = ${q('comments', DB)}.${q('post_id', DB)})`,
    },
    archived: {
      type: GraphQLBoolean,
    },
  }),
});

export default Post;
