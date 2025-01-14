import {GraphQLObjectType, GraphQLString} from 'graphql';
import {globalIdField} from 'graphql-relay';
import {nodeInterface} from './Node';
import {q} from '../shared';

const {DB} = process.env;

const ContextPost = new GraphQLObjectType({
  description:
    'A post from a user. This object is used in a context test and must be given a context.table to resolve.',
  name: 'ContextPost',
  interfaces: () => [nodeInterface],
  sqlTable: (_, context) => `(SELECT * FROM ${q(context.table, DB)})`,
  uniqueKey: 'id',
  fields: () => ({
    id: {
      ...globalIdField(),
      sqlDeps: ['id'],
    },
    body: {
      description: 'The content of the post',
      type: GraphQLString,
    },
  }),
});

export default ContextPost;
