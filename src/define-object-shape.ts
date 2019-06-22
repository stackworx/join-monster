import {validateSqlAST, inspect} from './util';
// @ts-ignore
import idx from 'idx';
import {SQLAst} from './types';

// generate an object that defines the correct nesting shape for our GraphQL
// this will be used by the library NestHydrationJS, check out their docs
export default function defineObjectShape(topNode: SQLAst) {
  validateSqlAST(topNode);
  return _defineObjectShape(null, '', topNode);
}

function _defineObjectShape(parent: any, prefix: any, node: any) {
  // if this table has a parent, prefix with the parent name and 2 underscores
  const prefixToPass = parent ? prefix + node.as + '__' : prefix;

  const fieldDefinition = {};

  for (let child of node.children) {
    switch (child.type) {
      case 'column':
        // @ts-ignore
        fieldDefinition[child.fieldName] = prefixToPass + child.as;
        break;
      case 'composite':
        // @ts-ignore
        fieldDefinition[child.fieldName] = prefixToPass + child.as;
        break;
      case 'columnDeps':
        for (let name in child.names) {
          // @ts-ignore
          fieldDefinition[name] = prefixToPass + child.names[name];
        }
        break;
      case 'expression':
        // @ts-ignore
        fieldDefinition[child.fieldName] = prefixToPass + child.as;
        break;
      case 'union':
      case 'table':
        if (child.sqlBatch) {
          // @ts-ignore
          fieldDefinition[child.sqlBatch.parentKey.fieldName] =
            prefixToPass + child.sqlBatch.parentKey.as;
        } else {
          const definition = _defineObjectShape(node, prefixToPass, child);
          // @ts-ignore
          fieldDefinition[child.fieldName] = definition;
        }
        break;
      case 'noop':
        void 0;
        break;
      /* istanbul ignore next */
      default:
        throw new Error(`invalid SQLASTNode type: ${inspect(child.type)}`);
    }
  }

  for (let typeName in node.typedChildren || {}) {
    const suffix = '@' + typeName;
    for (let child of node.typedChildren[typeName]) {
      switch (child.type) {
        case 'column':
          // @ts-ignore
          fieldDefinition[child.fieldName + suffix] = prefixToPass + child.as;
          break;
        case 'composite':
          // @ts-ignore
          fieldDefinition[child.fieldName + suffix] = prefixToPass + child.as;
          break;
        case 'columnDeps':
          for (let name in child.names) {
            // @ts-ignore
            fieldDefinition[name + suffix] = prefixToPass + child.names[name];
          }
          break;
        case 'expression':
          // @ts-ignore
          fieldDefinition[child.fieldName + suffix] = prefixToPass + child.as;
          break;
        case 'union':
        case 'table':
          if (child.sqlBatch) {
            // @ts-ignore
            fieldDefinition[child.sqlBatch.parentKey.fieldName + suffix] =
              prefixToPass + child.sqlBatch.parentKey.as;
            // @ts-ignore
          } else if (idx(child, (_) => _.junction.sqlBatch)) {
            // @ts-ignore
            fieldDefinition[
              // @ts-ignore
              child.junction.sqlBatch.parentKey.fieldName + suffix
            ] = prefixToPass + child.junction.sqlBatch.parentKey.as;
          } else {
            const definition = _defineObjectShape(node, prefixToPass, child);
            // @ts-ignore
            fieldDefinition[child.fieldName + suffix] = definition;
          }
          break;
        case 'noop':
          void 0;
          break;
        /* istanbul ignore next */
        default:
          throw new Error(`invalid SQLASTNode type: ${inspect(child.type)}`);
      }
    }
  }

  // if we need many, just wrap the field definition in an array
  if (node.grabMany) {
    return [fieldDefinition];
    // otherwise, it will just grab the first result
  }
  return fieldDefinition;
}
