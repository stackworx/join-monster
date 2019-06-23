import {graphql} from 'graphql';
import schemaBasic from '../test-api/schema-basic/index';

test('it should get user 1 with comments and particular posts', async () => {
  const query = ` {
    user(id: 1) {
      comments {
        id
        post {
          comments {
            id
          }
        }
      }
    }
  }`;
  const {data, errors} = await graphql(schemaBasic, query);
  expect(errors).toBeUndefined();
  const expected = {
    user: {
      comments: [
        {
          id: 1,
          post: {
            comments: [{id: 3}, {id: 2}, {id: 1}],
          },
        },
        {
          id: 4,
          post: {
            comments: [{id: 8}, {id: 7}, {id: 6}, {id: 5}, {id: 4}],
          },
        },
        {
          id: 6,
          post: {
            comments: [{id: 8}, {id: 7}, {id: 6}, {id: 5}, {id: 4}],
          },
        },
        {
          id: 8,
          post: {
            comments: [{id: 8}, {id: 7}, {id: 6}, {id: 5}, {id: 4}],
          },
        },
      ],
    },
  };

  expect(expected).toEqual(data);
});

test('it should get user 1 with comments and particular posts with active comments', async () => {
  const query = `{
    user(id: 1) {
      comments {
        id
        post {
          comments (active: true) {
            id
          }
        }
      }
    }
  }`;
  const {data, errors} = await graphql(schemaBasic, query);
  expect(errors).toBeUndefined();
  const expected = {
    user: {
      comments: [
        {
          id: 1,
          post: {
            comments: [{id: 3}, {id: 1}],
          },
        },
        {
          id: 4,
          post: {
            comments: [{id: 8}, {id: 6}, {id: 5}, {id: 4}],
          },
        },
        {
          id: 6,
          post: {
            comments: [{id: 8}, {id: 6}, {id: 5}, {id: 4}],
          },
        },
        {
          id: 8,
          post: {
            comments: [{id: 8}, {id: 6}, {id: 5}, {id: 4}],
          },
        },
      ],
    },
  };

  expect(expected).toEqual(data);
});
