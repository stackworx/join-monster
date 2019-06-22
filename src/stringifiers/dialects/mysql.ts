// @ts-ignore
function quote(str: string) {
  return `\`${str}\``;
}

module.exports = {
  ...require('./mixins/pagination-not-supported'),

  name: 'mysql',

  quote,

  compositeKey(parent: any, keys: string[]) {
    keys = keys.map((key) => `${quote(parent)}.${quote(key)}`);
    return `CONCAT(${keys.join(', ')})`;
  },
};
