import {graphql} from 'graphql';
import schemaBasic from '../test-api/schema-basic/index';
import {partial} from 'lodash';

const run = partial(graphql, schemaBasic);

test('should handle data from the junction table', async () => {
  const query = `{
    user(id: 3) {
      fullName
      following {
        id
        intimacy
      }
    }
  }`;
  const {data, errors} = await run(query);
  expect(errors).toBeUndefined();
  const expected = {
    user: {
      fullName: 'foo bar',
      following: [
        {
          id: 1,
          intimacy: 'acquaintance',
        },
        {
          id: 2,
          intimacy: 'best',
        },
      ],
    },
  };
  expect(expected).toEqual(data);
});
