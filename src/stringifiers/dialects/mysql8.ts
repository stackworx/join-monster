// @ts-ignore
function quote(str: string) {
  return `\`${str}\``;
}

module.exports = {
  ...require('./mariadb'),

  name: 'mysql8',

  quote,

  compositeKey(parent: any, keys: string[]) {
    keys = keys.map((key) => `${quote(parent)}.${quote(key)}`);
    return `CONCAT(${keys.join(', ')})`;
  },
};
