/**
 * ESLint rule: no-jwt-in-resolved-scope (ScalingCFO pattern, PRD-002b FR-9 / AC-5).
 *
 * Fails the build if a credential-bearing property is assigned into a Sport
 * `ResolvedScope` / `CiypScope` construction. Every string-valued scope key is
 * projected verbatim onto the `ai_trace` audit row (decision #19), so a JWT / token /
 * secret / API key placed in scope LEAKS to the audit log forever. Credentials ride the
 * request-scoped ALS (`request-context.ts`) instead — never the scope.
 *
 * Heuristic: flag a property whose KEY NAME looks credential-shaped when its enclosing
 * object literal is "scope-shaped":
 *   - annotated `: ResolvedScope` / `: CiypScope`, or cast `as ResolvedScope`/`as CiypScope`;
 *   - assigned to a variable whose name contains "scope" (case-insensitive);
 *   - returned from a function/method named `resolveScope`.
 */

const CREDENTIAL_KEY_SUBSTRINGS = [
  'jwt',
  'token',
  'secret',
  'password',
  'passwd',
  'apikey',
  'api_key',
  'bearer',
  'authorization',
  'credential',
  'claims',
  'access_key',
  'privatekey',
  'private_key',
];

function keyName(prop) {
  if (!prop || prop.type !== 'Property') return undefined;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') return prop.key.value;
  return undefined;
}

function looksCredential(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return CREDENTIAL_KEY_SUBSTRINGS.some((s) => lower.includes(s));
}

function typeRefName(typeAnn) {
  // TSTypeReference → typeName Identifier
  const ref = typeAnn?.type === 'TSTypeAnnotation' ? typeAnn.typeAnnotation : typeAnn;
  if (ref?.type === 'TSTypeReference' && ref.typeName?.type === 'Identifier') {
    return ref.typeName.name;
  }
  return undefined;
}

const SCOPE_TYPES = new Set(['ResolvedScope', 'CiypScope']);

function isScopeShaped(objExpr) {
  const parent = objExpr.parent;
  if (!parent) return false;

  // `as ResolvedScope` / `as CiypScope`
  if (parent.type === 'TSAsExpression' && SCOPE_TYPES.has(typeRefName(parent.typeAnnotation))) {
    return true;
  }

  // `const scope: CiypScope = { ... }` or `const anythingScope = { ... }`
  if (parent.type === 'VariableDeclarator') {
    if (parent.id?.type === 'Identifier') {
      if (SCOPE_TYPES.has(typeRefName(parent.id.typeAnnotation))) return true;
      if (/scope/i.test(parent.id.name)) return true;
    }
  }

  // `return { ... }` inside a `resolveScope` function/method
  if (parent.type === 'ReturnStatement') {
    let n = parent;
    while (n) {
      if (
        (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression') &&
        n.id?.name === 'resolveScope'
      ) {
        return true;
      }
      if (n.type === 'MethodDefinition' && n.key?.type === 'Identifier' && n.key.name === 'resolveScope') {
        return true;
      }
      if (
        n.type === 'Property' &&
        n.key?.type === 'Identifier' &&
        n.key.name === 'resolveScope' &&
        (n.value?.type === 'FunctionExpression' || n.value?.type === 'ArrowFunctionExpression')
      ) {
        return true;
      }
      n = n.parent;
    }
  }

  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow credential-bearing keys in a Sport ResolvedScope/CiypScope (they leak to ai_traces).',
    },
    schema: [],
    messages: {
      credentialInScope:
        "credential-shaped key '{{name}}' assigned into a resolved scope — it would be projected onto the ai_trace audit row. Carry credentials via the request-scoped ALS (request-context.ts), never in scope.",
    },
  },
  create(context) {
    return {
      ObjectExpression(node) {
        if (!isScopeShaped(node)) return;
        for (const prop of node.properties) {
          const name = keyName(prop);
          if (looksCredential(name)) {
            context.report({ node: prop, messageId: 'credentialInScope', data: { name } });
          }
        }
      },
    };
  },
};

export default {
  rules: {
    'no-jwt-in-resolved-scope': rule,
  },
};
