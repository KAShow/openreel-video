/**
 * Safe evaluator for user-supplied motion expression code.
 *
 * Replaces `new Function(...)` compilation, which executed expression code
 * with full page privileges (RCE via imported/pasted project files). This
 * module parses the expression into an AST first and evaluates it against a
 * restricted scope with no access to globals, prototypes, or host objects:
 *
 * - Identifiers resolve only from the caller-provided scope (plus locally
 *   declared variables); anything else is a runtime error.
 * - Property access is limited to own properties of scope-provided plain
 *   objects (e.g. `Math`, layer handles) and `length` of strings/arrays.
 *   `constructor`, `prototype`, and `__proto__` are always rejected, and
 *   property access on function values is rejected outright.
 * - No object/array/function literals, no `new`, no loops, no `delete`,
 *   no assignment to undeclared identifiers.
 * - Caps: code length, parser nesting depth, AST node count, evaluation
 *   steps, and re-entrant evaluation depth.
 */

export interface SafeExpressionScope {
  readonly [key: string]: unknown;
}

export type CompiledSafeExpression = (scope: SafeExpressionScope) => unknown;

const MAX_CODE_LENGTH = 10_000;

/** Shared cap so import-time sanitization matches the evaluator's limit. */
export const SAFE_EXPRESSION_MAX_CODE_LENGTH = MAX_CODE_LENGTH;
const MAX_PARSE_DEPTH = 200;
const MAX_NODE_COUNT = 5_000;
const MAX_EVAL_STEPS = 100_000;
const MAX_RUN_DEPTH = 64;

class ReturnSignal {
  constructor(readonly value: unknown) {}
}

type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "**"
  | "<"
  | ">"
  | "<="
  | ">="
  | "=="
  | "!="
  | "==="
  | "!==";

type Node =
  | { type: "Num"; value: number }
  | { type: "Str"; value: string }
  | { type: "Bool"; value: boolean }
  | { type: "Null" }
  | { type: "Undefined" }
  | { type: "Ident"; name: string }
  | { type: "Member"; object: Node; property: string }
  | { type: "Computed"; object: Node; property: Node }
  | { type: "Call"; callee: Node; args: readonly Node[] }
  | { type: "Unary"; op: "-" | "+" | "!" | "typeof"; argument: Node }
  | {
      type: "Binary";
      op: BinaryOp;
      left: Node;
      right: Node;
    }
  | { type: "Logical"; op: "&&" | "||"; left: Node; right: Node }
  | { type: "Conditional"; test: Node; consequent: Node; alternate: Node }
  | { type: "Assign"; name: string; value: Node };

type Statement =
  | { type: "ExprStmt"; expression: Node }
  | { type: "VarDecl"; name: string; init: Node | null }
  | { type: "Return"; argument: Node | null }
  | { type: "If"; test: Node; consequent: readonly Statement[]; alternate: readonly Statement[] | null }
  | { type: "Program"; body: readonly Statement[] };

interface Token {
  readonly kind: "num" | "str" | "ident" | "keyword" | "punct" | "eof";
  readonly value: string;
  readonly pos: number;
}

const KEYWORDS = new Set([
  "var",
  "let",
  "const",
  "return",
  "if",
  "else",
  "true",
  "false",
  "null",
  "undefined",
  "typeof",
  // Everything below is reserved but unsupported: the parser rejects these
  // tokens wherever they appear, which keeps constructs like `new`, `delete`,
  // `in`, function creation, and loops out of the language by construction.
  "delete",
  "in",
  "instanceof",
  "new",
  "this",
  "function",
  "class",
  "extends",
  "super",
  "import",
  "export",
  "default",
  "switch",
  "case",
  "break",
  "continue",
  "do",
  "while",
  "for",
  "of",
  "try",
  "catch",
  "finally",
  "throw",
  "void",
  "with",
  "yield",
  "await",
]);

const BLOCKED_PROPERTY_NAMES = new Set(["constructor", "prototype", "__proto__"]);

function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  const push = (kind: Token["kind"], value: string, at: number): void => {
    tokens.push({ kind, value, pos: at });
  };
  while (pos < code.length) {
    const char = code[pos];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      pos += 1;
      continue;
    }
    if (char === "/" && code[pos + 1] === "/") {
      while (pos < code.length && code[pos] !== "\n") pos += 1;
      continue;
    }
    if (char === "/" && code[pos + 1] === "*") {
      const end = code.indexOf("*/", pos + 2);
      if (end === -1) throw new Error("Unterminated block comment");
      pos = end + 2;
      continue;
    }
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(code[pos + 1] ?? ""))) {
      const start = pos;
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(code.slice(pos));
      if (!match) throw new Error(`Malformed number at position ${pos}`);
      pos += match[0].length;
      push("num", match[0], start);
      continue;
    }
    if (char === '"' || char === "'") {
      const start = pos;
      pos += 1;
      let out = "";
      while (pos < code.length && code[pos] !== char) {
        const current = code[pos];
        if (current === "\\") {
          const escaped = code[pos + 1];
          if (escaped === undefined) throw new Error("Unterminated string literal");
          if (escaped === "u") {
            const hex = code.slice(pos + 2, pos + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new Error("Malformed unicode escape in string literal");
            }
            out += String.fromCharCode(parseInt(hex, 16));
            pos += 6;
            continue;
          }
          const escapes: Record<string, string> = {
            n: "\n",
            t: "\t",
            r: "\r",
            b: "\b",
            f: "\f",
            v: "\v",
            "0": "\0",
          };
          out += escapes[escaped] ?? escaped;
          pos += 2;
          continue;
        }
        if (current === "\n") throw new Error("Unterminated string literal");
        out += current;
        pos += 1;
      }
      if (pos >= code.length) throw new Error("Unterminated string literal");
      pos += 1;
      push("str", out, start);
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = pos;
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(code.slice(pos));
      if (!match) throw new Error(`Malformed identifier at position ${pos}`);
      pos += match[0].length;
      push(KEYWORDS.has(match[0]) ? "keyword" : "ident", match[0], start);
      continue;
    }
    const operators = [
      "===",
      "!==",
      "**",
      "==",
      "!=",
      "<=",
      ">=",
      "&&",
      "||",
      "=>",
      "+",
      "-",
      "*",
      "/",
      "%",
      "<",
      ">",
      "!",
      "?",
      ":",
      "=",
      "(",
      ")",
      "[",
      "]",
      "{",
      "}",
      ",",
      ";",
      ".",
    ];
    const op = operators.find((candidate) => code.startsWith(candidate, pos));
    if (!op) throw new Error(`Unexpected character "${char}" at position ${pos}`);
    pos += op.length;
    push("punct", op, pos - op.length);
    continue;
  }
  push("eof", "", pos);
  return tokens;
}

interface ParseState {
  readonly tokens: readonly Token[];
  index: number;
  depth: number;
  nodes: number;
}

const current = (state: ParseState): Token => state.tokens[state.index];

const advance = (state: ParseState): Token => state.tokens[state.index++];

function expectPunct(state: ParseState, value: string): void {
  const token = current(state);
  if (token.kind !== "punct" || token.value !== value) {
    throw new Error(`Expected "${value}" but found "${token.value || "end of code"}"`);
  }
  advance(state);
}

function makeNode(state: ParseState): void {
  state.nodes += 1;
  if (state.nodes > MAX_NODE_COUNT) {
    throw new Error(`Expression exceeds the maximum of ${MAX_NODE_COUNT} nodes`);
  }
}

function enterDepth(state: ParseState): void {
  state.depth += 1;
  if (state.depth > MAX_PARSE_DEPTH) {
    throw new Error(`Expression nesting exceeds the maximum depth of ${MAX_PARSE_DEPTH}`);
  }
}

function leaveDepth(state: ParseState): void {
  state.depth -= 1;
}

const canStartExpression = (token: Token): boolean =>
  (token.kind === "num" ||
    token.kind === "str" ||
    token.kind === "ident" ||
    (token.kind === "keyword" &&
      (token.value === "true" ||
        token.value === "false" ||
        token.value === "null" ||
        token.value === "undefined" ||
        token.value === "typeof"))) ||
  (token.kind === "punct" && (token.value === "(" || token.value === "-"));

function parseProgram(code: string): Statement {
  const state: ParseState = { tokens: tokenize(code), index: 0, depth: 0, nodes: 0 };
  const body: Statement[] = [];
  while (current(state).kind !== "eof") {
    body.push(parseStatement(state));
  }
  return { type: "Program", body };
}

function parseStatement(state: ParseState): Statement {
  const token = current(state);
  if (token.kind === "keyword") {
    if (token.value === "const" || token.value === "let" || token.value === "var") {
      advance(state);
      const nameToken = advance(state);
      if (nameToken.kind !== "ident") {
        throw new Error("Variable declaration requires an identifier");
      }
      let init: Node | null = null;
      if (current(state).kind === "punct" && current(state).value === "=") {
        advance(state);
        init = parseExpression(state);
      }
      consumeStatementEnd(state);
      makeNode(state);
      return { type: "VarDecl", name: nameToken.value, init };
    }
    if (token.value === "return") {
      advance(state);
      let argument: Node | null = null;
      if (canStartExpression(current(state))) {
        argument = parseExpression(state);
      }
      consumeStatementEnd(state);
      makeNode(state);
      return { type: "Return", argument };
    }
    if (token.value === "if") {
      advance(state);
      expectPunct(state, "(");
      const test = parseExpression(state);
      expectPunct(state, ")");
      const consequent = parseStatementList(state);
      let alternate: readonly Statement[] | null = null;
      if (current(state).kind === "keyword" && current(state).value === "else") {
        advance(state);
        alternate = parseStatementList(state);
      }
      makeNode(state);
      return { type: "If", test, consequent, alternate };
    }
  }
  if (token.kind === "punct" && token.value === "{") {
    return { type: "Program", body: parseStatementList(state) };
  }
  const expression = parseExpression(state);
  consumeStatementEnd(state);
  makeNode(state);
  return { type: "ExprStmt", expression };
}

function parseStatementList(state: ParseState): readonly Statement[] {
  if (current(state).kind === "punct" && current(state).value === "{") {
    advance(state);
    const body: Statement[] = [];
    while (
      !(current(state).kind === "punct" && current(state).value === "}")
    ) {
      if (current(state).kind === "eof") throw new Error("Unterminated block");
      body.push(parseStatement(state));
    }
    advance(state);
    return body;
  }
  return [parseStatement(state)];
}

function consumeStatementEnd(state: ParseState): void {
  while (current(state).kind === "punct" && current(state).value === ";") {
    advance(state);
  }
}

function parseExpression(state: ParseState): Node {
  return parseAssignment(state);
}

function parseAssignment(state: ParseState): Node {
  enterDepth(state);
  try {
    const left = parseConditional(state);
    const token = current(state);
    if (token.kind === "punct" && token.value === "=") {
      if (left.type !== "Ident") {
        throw new Error("Assignment target must be a simple identifier");
      }
      advance(state);
      const value = parseAssignment(state);
      makeNode(state);
      return { type: "Assign", name: left.name, value };
    }
    return left;
  } finally {
    leaveDepth(state);
  }
}

function parseConditional(state: ParseState): Node {
  enterDepth(state);
  try {
    const test = parseBinary(state, 0);
    if (current(state).kind === "punct" && current(state).value === "?") {
      advance(state);
      const consequent = parseAssignment(state);
      expectPunct(state, ":");
      const alternate = parseAssignment(state);
      makeNode(state);
      return { type: "Conditional", test, consequent, alternate };
    }
    return test;
  } finally {
    leaveDepth(state);
  }
}

const BINARY_PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "===": 3,
  "!==": 3,
  "<": 4,
  ">": 4,
  "<=": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
  "**": 7,
};

function parseBinary(state: ParseState, minPrecedence: number): Node {
  enterDepth(state);
  try {
    let left = parseUnary(state);
    for (;;) {
      const token = current(state);
      if (token.kind !== "punct") break;
      if (token.value === "&&" || token.value === "||") {
        const precedence = BINARY_PRECEDENCE[token.value];
        if (precedence <= minPrecedence) break;
        advance(state);
        const right = parseBinary(state, precedence);
        makeNode(state);
        left = { type: "Logical", op: token.value, left, right };
        continue;
      }
      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence <= minPrecedence) break;
      advance(state);
      const right =
        token.value === "**"
          ? parseBinary(state, precedence - 1)
          : parseBinary(state, precedence);
      makeNode(state);
      left = { type: "Binary", op: token.value as BinaryOp, left, right };
    }
    return left;
  } finally {
    leaveDepth(state);
  }
}

function parseUnary(state: ParseState): Node {
  enterDepth(state);
  try {
    const token = current(state);
    if (
      (token.kind === "punct" && (token.value === "-" || token.value === "+" || token.value === "!")) ||
      (token.kind === "keyword" && token.value === "typeof")
    ) {
      advance(state);
      const argument = parseUnary(state);
      makeNode(state);
      return {
        type: "Unary",
        op: token.value as "-" | "+" | "!" | "typeof",
        argument,
      };
    }
    return parsePostfix(state);
  } finally {
    leaveDepth(state);
  }
}

function parsePostfix(state: ParseState): Node {
  enterDepth(state);
  try {
    let node = parsePrimary(state);
    for (;;) {
      const token = current(state);
      if (token.kind === "punct" && token.value === ".") {
        advance(state);
        const property = advance(state);
        if (property.kind !== "ident" && property.kind !== "keyword") {
          throw new Error("Expected a property name after '.'");
        }
        makeNode(state);
        node = { type: "Member", object: node, property: property.value };
        continue;
      }
      if (token.kind === "punct" && token.value === "[") {
        advance(state);
        const property = parseExpression(state);
        expectPunct(state, "]");
        makeNode(state);
        node = { type: "Computed", object: node, property };
        continue;
      }
      if (token.kind === "punct" && token.value === "(") {
        advance(state);
        const args: Node[] = [];
        while (!(current(state).kind === "punct" && current(state).value === ")")) {
          args.push(parseAssignment(state));
          if (current(state).kind === "punct" && current(state).value === ",") {
            advance(state);
          } else if (
            !(current(state).kind === "punct" && current(state).value === ")")
          ) {
            throw new Error('Expected "," or ")" in argument list');
          }
        }
        advance(state);
        makeNode(state);
        node = { type: "Call", callee: node, args };
        continue;
      }
      break;
    }
    return node;
  } finally {
    leaveDepth(state);
  }
}

function parsePrimary(state: ParseState): Node {
  enterDepth(state);
  try {
    const token = current(state);
    if (token.kind === "num") {
      advance(state);
      makeNode(state);
      return { type: "Num", value: Number(token.value) };
    }
    if (token.kind === "str") {
      advance(state);
      makeNode(state);
      return { type: "Str", value: token.value };
    }
    if (token.kind === "ident") {
      advance(state);
      makeNode(state);
      return { type: "Ident", name: token.value };
    }
    if (token.kind === "keyword") {
      if (token.value === "true" || token.value === "false") {
        advance(state);
        makeNode(state);
        return { type: "Bool", value: token.value === "true" };
      }
      if (token.value === "null") {
        advance(state);
        makeNode(state);
        return { type: "Null" };
      }
      if (token.value === "undefined") {
        advance(state);
        makeNode(state);
        return { type: "Undefined" };
      }
    }
    if (token.kind === "punct" && token.value === "(") {
      advance(state);
      const inner = parseExpression(state);
      expectPunct(state, ")");
      return inner;
    }
    throw new Error(`Unexpected token "${token.value || "end of code"}"`);
  } finally {
    leaveDepth(state);
  }
}

let runDepth = 0;
let stepsRemaining = 0;

function step(): void {
  stepsRemaining -= 1;
  if (stepsRemaining < 0) {
    throw new Error("Expression exceeded the evaluation step limit");
  }
}

interface EvalState {
  readonly locals: Map<string, unknown>;
  readonly scope: SafeExpressionScope;
}

function evaluateProgram(program: Statement, scope: SafeExpressionScope): unknown {
  runDepth += 1;
  if (runDepth > MAX_RUN_DEPTH) {
    runDepth -= 1;
    throw new Error("Expression exceeded the evaluation nesting limit");
  }
  if (runDepth === 1) {
    stepsRemaining = MAX_EVAL_STEPS;
  }
  try {
    if (program.type !== "Program") throw new Error("Invalid program");
    if (program.body.length === 1 && program.body[0].type === "ExprStmt") {
      return evaluateNode((program.body[0] as { type: "ExprStmt"; expression: Node }).expression, {
        locals: new Map(),
        scope,
      });
    }
    const state: EvalState = { locals: new Map(), scope };
    try {
      for (const statement of program.body) {
        evaluateStatement(statement, state);
      }
      return undefined;
    } catch (signal) {
      if (signal instanceof ReturnSignal) return signal.value;
      throw signal;
    }
  } finally {
    runDepth -= 1;
    if (runDepth === 0) stepsRemaining = 0;
  }
}

function evaluateStatement(statement: Statement, state: EvalState): void {
  switch (statement.type) {
    case "Program":
      for (const inner of statement.body) evaluateStatement(inner, state);
      return;
    case "ExprStmt":
      evaluateNode(statement.expression, state);
      return;
    case "VarDecl": {
      const value = statement.init ? evaluateNode(statement.init, state) : undefined;
      state.locals.set(statement.name, value);
      return;
    }
    case "Return":
      throw new ReturnSignal(
        statement.argument ? evaluateNode(statement.argument, state) : undefined,
      );
    case "If": {
      const test = evaluateNode(statement.test, state);
      if (test) {
        for (const inner of statement.consequent) evaluateStatement(inner, state);
      } else if (statement.alternate) {
        for (const inner of statement.alternate) evaluateStatement(inner, state);
      }
      return;
    }
  }
}

function evaluateNode(node: Node, state: EvalState): unknown {
  step();
  switch (node.type) {
    case "Num":
      return node.value;
    case "Str":
      return node.value;
    case "Bool":
      return node.value;
    case "Null":
      return null;
    case "Undefined":
      return undefined;
    case "Ident":
      return resolveIdentifier(node.name, state);
    case "Member":
      return getMember(evaluateNode(node.object, state), node.property);
    case "Computed": {
      const target = evaluateNode(node.object, state);
      const key = evaluateNode(node.property, state);
      if (typeof key === "number" && Array.isArray(target)) {
        return target[key];
      }
      if (typeof key === "string") {
        return getMember(target, key);
      }
      throw new Error("Computed property access requires a string key");
    }
    case "Call": {
      const callee = evaluateNode(node.callee, state);
      if (typeof callee !== "function") {
        throw new Error("Attempted to call a value that is not a function");
      }
      const args = node.args.map((argument) => evaluateNode(argument, state));
      return callee(...args);
    }
    case "Unary": {
      if (node.op === "typeof" && node.argument.type === "Ident") {
        try {
          return typeof resolveIdentifier(node.argument.name, state);
        } catch {
          return "undefined";
        }
      }
      const value = evaluateNode(node.argument, state);
      switch (node.op) {
        case "-":
          return -(value as number);
        case "+":
          return +(value as number);
        case "!":
          return !value;
        case "typeof":
          return typeof value;
      }
    }
    case "Binary": {
      const left = evaluateNode(node.left, state);
      const right = evaluateNode(node.right, state);
      switch (node.op) {
        case "+":
          return (left as never) + (right as never);
        case "-":
          return (left as number) - (right as number);
        case "*":
          return (left as number) * (right as number);
        case "/":
          return (left as number) / (right as number);
        case "%":
          return (left as number) % (right as number);
        case "**":
          return (left as number) ** (right as number);
        case "<":
          return (left as never) < (right as never);
        case ">":
          return (left as never) > (right as never);
        case "<=":
          return (left as never) <= (right as never);
        case ">=":
          return (left as never) >= (right as never);
        case "==":
          return left == right;
        case "!=":
          return left != right;
        case "===":
          return left === right;
        case "!==":
          return left !== right;
      }
    }
    case "Logical": {
      const left = evaluateNode(node.left, state);
      if (node.op === "&&") return left ? evaluateNode(node.right, state) : left;
      return left ? left : evaluateNode(node.right, state);
    }
    case "Conditional":
      return evaluateNode(node.test, state)
        ? evaluateNode(node.consequent, state)
        : evaluateNode(node.alternate, state);
    case "Assign": {
      if (!state.locals.has(node.name)) {
        throw new Error(`Assignment to undeclared variable "${node.name}"`);
      }
      const value = evaluateNode(node.value, state);
      state.locals.set(node.name, value);
      return value;
    }
  }
}

function resolveIdentifier(name: string, state: EvalState): unknown {
  if (state.locals.has(name)) {
    return state.locals.get(name);
  }
  if (Object.prototype.hasOwnProperty.call(state.scope, name)) {
    return state.scope[name];
  }
  throw new Error(`${name} is not defined`);
}

function getMember(target: unknown, key: string): unknown {
  if (BLOCKED_PROPERTY_NAMES.has(key)) {
    throw new Error(`Access to property "${key}" is not allowed`);
  }
  if (typeof target === "function") {
    throw new Error("Property access on function values is not allowed");
  }
  if (target === null || target === undefined) {
    throw new Error(`Property access "${key}" on ${String(target)} is not allowed`);
  }
  if (typeof target === "string") {
    if (key === "length") return target.length;
    throw new Error(`String property "${key}" is not allowed`);
  }
  if (typeof target === "number" || typeof target === "boolean" || typeof target === "bigint") {
    throw new Error(`Property "${key}" is not allowed on primitive values`);
  }
  if (Array.isArray(target)) {
    if (key === "length") return target.length;
    if (/^\d+$/.test(key)) return target[Number(key)];
    throw new Error(`Array property "${key}" is not allowed`);
  }
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    return (target as Record<string, unknown>)[key];
  }
  throw new Error(`Property "${key}" is not defined`);
}

export function compileSafeExpression(code: string): CompiledSafeExpression {
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error(`Expression code exceeds the maximum length of ${MAX_CODE_LENGTH} characters`);
  }
  const program = parseProgram(code);
  return (scope: SafeExpressionScope): unknown => evaluateProgram(program, scope);
}
