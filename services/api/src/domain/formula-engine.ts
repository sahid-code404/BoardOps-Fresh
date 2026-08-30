const SCALE_DIGITS = 6;
const SCALE = 1_000_000n;
const MAX_EXPRESSION_LENGTH = 4_000;
const MAX_TOKENS = 1_000;
const MAX_DEPTH = 64;

export type FormulaReferences = {
  variableSlugs: string[];
  contextKeys: string[];
};

export type FormulaValidation = FormulaReferences & {
  valid: boolean;
  error?: string;
};

export type FormulaEvaluation = FormulaReferences & {
  valid: boolean;
  valueExact: string;
  value: number;
  error?: string;
  missingVariables: string[];
  missingContext: string[];
  resolvedValues: Record<string, string>;
};

export type FormulaEvaluationInput = {
  variables?: Record<string, string>;
  context?: Record<string, string>;
  strictMissing?: boolean;
};

type TokenType =
  | "NUMBER"
  | "STRING"
  | "IDENT"
  | "OP"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "CMP"
  | "EOF";

type Token = { type: TokenType; value: string; position: number };

type Ast =
  | { kind: "number"; value: bigint }
  | { kind: "variable"; slug: string }
  | { kind: "context"; key: string }
  | { kind: "binary"; op: string; left: Ast; right: Ast }
  | { kind: "comparison"; op: string; left: Ast; right: Ast }
  | { kind: "call"; name: string; args: Ast[] };

const SUPPORTED_FUNCTIONS = new Set([
  "ROUND",
  "FLOOR",
  "CEIL",
  "ABS",
  "MIN",
  "MAX",
  "IF",
  "SUM",
  "AVG",
  "COUNT",
  "ROUNDUP",
  "ROUNDDOWN",
  "AND",
  "OR",
  "NOT",
  "POWER",
  "SQRT",
  "MOD",
  "COALESCE",
  "NULLIF",
]);

function tokenize(expression: string): Token[] {
  if (!expression.trim()) throw new Error("Expression is required");
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Expression exceeds ${MAX_EXPRESSION_LENGTH} characters`);
  }

  const tokens: Token[] = [];
  let index = 0;
  const push = (type: TokenType, value: string, position: number) => {
    tokens.push({ type, value, position });
    if (tokens.length > MAX_TOKENS) throw new Error(`Expression exceeds ${MAX_TOKENS} tokens`);
  };

  while (index < expression.length) {
    const ch = expression.charAt(index);
    if (/\s/u.test(ch)) {
      index += 1;
      continue;
    }

    if (/[0-9]/u.test(ch) || (ch === "." && /[0-9]/u.test(expression.charAt(index + 1)))) {
      const start = index;
      let value = "";
      let dots = 0;
      while (index < expression.length && /[0-9.]/u.test(expression.charAt(index))) {
        const current = expression.charAt(index);
        if (current === ".") dots += 1;
        value += current;
        index += 1;
      }
      if (dots > 1) throw new Error(`Invalid number "${value}" at position ${start}`);
      push("NUMBER", value, start);
      continue;
    }

    if (ch === "'" || ch === '"') {
      const start = index;
      const quote = ch;
      index += 1;
      let value = "";
      while (index < expression.length && expression.charAt(index) !== quote) {
        value += expression.charAt(index);
        index += 1;
      }
      if (index >= expression.length) throw new Error(`Unterminated string at position ${start}`);
      index += 1;
      push("STRING", value, start);
      continue;
    }

    if (/[A-Za-z_]/u.test(ch)) {
      const start = index;
      let value = "";
      while (index < expression.length && /[A-Za-z0-9_]/u.test(expression.charAt(index))) {
        value += expression.charAt(index);
        index += 1;
      }
      push("IDENT", value, start);
      continue;
    }

    const two = expression.slice(index, index + 2);
    if (["<=", ">=", "==", "!="].includes(two)) {
      push("CMP", two, index);
      index += 2;
      continue;
    }
    if (ch === "<" || ch === ">") {
      push("CMP", ch, index);
      index += 1;
      continue;
    }
    if ("+-*/%".includes(ch)) {
      push("OP", ch, index);
      index += 1;
      continue;
    }
    if (ch === "(") {
      push("LPAREN", ch, index++);
      continue;
    }
    if (ch === ")") {
      push("RPAREN", ch, index++);
      continue;
    }
    if (ch === ",") {
      push("COMMA", ch, index++);
      continue;
    }
    throw new Error(`Unexpected character "${ch}" at position ${index}`);
  }

  push("EOF", "", index);
  return tokens;
}

function parseFixed(raw: string): bigint {
  const value = raw.trim();
  const match = /^([+-])?(?:(\d+)(?:\.(\d{0,6}))?|\.(\d{1,6}))$/u.exec(value);
  if (!match) {
    throw new Error(`Numeric value "${raw}" must use at most ${SCALE_DIGITS} decimal places`);
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const wholeRaw = match[2] ?? "0";
  const fractionRaw = match[3] ?? match[4] ?? "";
  const whole = BigInt(wholeRaw);
  const fraction = BigInt(fractionRaw.padEnd(SCALE_DIGITS, "0") || "0");
  return sign * (whole * SCALE + fraction);
}

function formatFixed(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fractionRaw = (absolute % SCALE).toString().padStart(SCALE_DIGITS, "0");
  const fraction = fractionRaw.replace(/0+$/u, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("Division by zero");
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let quotient = n / d;
  const remainder = n % d;
  if (remainder * 2n >= d) quotient += 1n;
  return negative ? -quotient : quotient;
}

function mul(left: bigint, right: bigint): bigint {
  return roundDiv(left * right, SCALE);
}

function div(left: bigint, right: bigint): bigint {
  return roundDiv(left * SCALE, right);
}

function integerPart(value: bigint): bigint {
  if (value % SCALE !== 0n) throw new Error("Expected an integer argument");
  return value / SCALE;
}

function floorFixed(value: bigint): bigint {
  if (value >= 0n) return (value / SCALE) * SCALE;
  const quotient = value / SCALE;
  return value % SCALE === 0n ? quotient * SCALE : (quotient - 1n) * SCALE;
}

function ceilFixed(value: bigint): bigint {
  if (value <= 0n) return (value / SCALE) * SCALE;
  const quotient = value / SCALE;
  return value % SCALE === 0n ? quotient * SCALE : (quotient + 1n) * SCALE;
}

function roundToPlaces(value: bigint, places: bigint): bigint {
  if (places < 0n || places > BigInt(SCALE_DIGITS)) {
    throw new Error(`ROUND precision must be between 0 and ${SCALE_DIGITS}`);
  }
  const factor = 10n ** BigInt(SCALE_DIGITS - Number(places));
  return roundDiv(value, factor) * factor;
}

function powFixed(base: bigint, exponentFixed: bigint): bigint {
  const exponent = integerPart(exponentFixed);
  if (exponent < -12n || exponent > 12n) throw new Error("POWER exponent must be between -12 and 12");
  if (exponent === 0n) return SCALE;
  let result = SCALE;
  const count = exponent < 0n ? -exponent : exponent;
  for (let i = 0n; i < count; i += 1n) result = mul(result, base);
  return exponent < 0n ? div(SCALE, result) : result;
}

function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("SQRT requires a non-negative value");
  if (value < 2n) return value;
  let x0 = value;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}

class Parser {
  private position = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    const token = this.tokens[this.position] ?? this.tokens.at(-1);
    if (!token) throw new Error("Formula token stream is empty");
    return token;
  }

  private next(): Token {
    const token = this.peek();
    this.position += 1;
    return token;
  }

  private nested<T>(callback: () => T): T {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) throw new Error(`Expression nesting exceeds ${MAX_DEPTH}`);
    try {
      return callback();
    } finally {
      this.depth -= 1;
    }
  }

  parse(): Ast {
    const node = this.parseComparison();
    const trailing = this.peek();
    if (trailing.type !== "EOF") {
      throw new Error(`Unexpected token "${trailing.value}" at position ${trailing.position}`);
    }
    return node;
  }

  private parseComparison(): Ast {
    let left = this.parseAdditive();
    while (this.peek().type === "CMP") {
      const op = this.next().value;
      const right = this.parseAdditive();
      left = { kind: "comparison", op, left, right };
    }
    return left;
  }

  private parseAdditive(): Ast {
    let left = this.parseMultiplicative();
    while (this.peek().type === "OP" && ["+", "-"].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): Ast {
    let left = this.parseUnary();
    while (this.peek().type === "OP" && ["*", "/", "%"].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): Ast {
    if (this.peek().type === "OP" && this.peek().value === "-") {
      this.next();
      return { kind: "binary", op: "-", left: { kind: "number", value: 0n }, right: this.parseUnary() };
    }
    if (this.peek().type === "OP" && this.peek().value === "+") {
      this.next();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Ast {
    const token = this.peek();
    if (token.type === "NUMBER") {
      this.next();
      return { kind: "number", value: parseFixed(token.value) };
    }

    if (token.type === "IDENT") {
      this.next();
      const rawName = token.value;
      const name = rawName.toUpperCase();
      if (name === "VAR") {
        if (this.peek().type !== "LPAREN") throw new Error("Expected ( after var");
        this.next();
        const slug = this.next();
        if (slug.type !== "STRING" || !slug.value.trim()) throw new Error("var() requires a non-empty string slug");
        if (this.peek().type !== "RPAREN") throw new Error("Expected ) after var slug");
        this.next();
        return { kind: "variable", slug: slug.value };
      }

      if (this.peek().type === "LPAREN") {
        if (!SUPPORTED_FUNCTIONS.has(name)) throw new Error(`Unknown function "${rawName}"`);
        this.next();
        const args: Ast[] = [];
        if (this.peek().type !== "RPAREN") {
          args.push(this.nested(() => this.parseComparison()));
          while (this.peek().type === "COMMA") {
            this.next();
            args.push(this.nested(() => this.parseComparison()));
          }
        }
        if (this.peek().type !== "RPAREN") throw new Error(`Expected ) after ${name} arguments`);
        this.next();
        return { kind: "call", name, args };
      }

      // Bare identifiers are deliberate runtime context variables (for example
      // morning_count, meal_charges or paid_amount). The golden seed uses them,
      // but its browser parser rejected them and forced monthly-close fallback.
      return { kind: "context", key: rawName };
    }

    if (token.type === "LPAREN") {
      this.next();
      const node = this.nested(() => this.parseComparison());
      if (this.peek().type !== "RPAREN") throw new Error("Expected )");
      this.next();
      return node;
    }

    throw new Error(`Unexpected token "${token.value}" at position ${token.position}`);
  }
}

function parse(expression: string): Ast {
  return new Parser(tokenize(expression)).parse();
}

function collectReferences(node: Ast, variables: Set<string>, context: Set<string>) {
  switch (node.kind) {
    case "variable":
      variables.add(node.slug);
      return;
    case "context":
      context.add(node.key);
      return;
    case "binary":
    case "comparison":
      collectReferences(node.left, variables, context);
      collectReferences(node.right, variables, context);
      return;
    case "call":
      node.args.forEach((arg) => collectReferences(arg, variables, context));
      return;
    case "number":
      return;
  }
}

function referencesFor(node: Ast): FormulaReferences {
  const variables = new Set<string>();
  const context = new Set<string>();
  collectReferences(node, variables, context);
  return {
    variableSlugs: [...variables],
    contextKeys: [...context],
  };
}

type EvalState = {
  variables: Record<string, string>;
  context: Record<string, string>;
  strictMissing: boolean;
  missingVariables: Set<string>;
  missingContext: Set<string>;
  resolvedValues: Record<string, string>;
};

function requiredArg(args: readonly bigint[], index: number, functionName: string): bigint {
  const value = args[index];
  if (value === undefined) throw new Error(`${functionName} argument ${index + 1} is missing`);
  return value;
}

function evaluateNode(node: Ast, state: EvalState): bigint {
  switch (node.kind) {
    case "number":
      return node.value;
    case "variable": {
      const raw = state.variables[node.slug];
      if (raw === undefined) {
        state.missingVariables.add(node.slug);
        if (state.strictMissing) throw new Error(`Variable "${node.slug}" is missing`);
        state.resolvedValues[node.slug] = "0";
        return 0n;
      }
      state.resolvedValues[node.slug] = raw;
      return parseFixed(raw);
    }
    case "context": {
      const raw = state.context[node.key];
      if (raw === undefined) {
        state.missingContext.add(node.key);
        if (state.strictMissing) throw new Error(`Runtime value "${node.key}" is missing`);
        return 0n;
      }
      return parseFixed(raw);
    }
    case "binary": {
      const left = evaluateNode(node.left, state);
      const right = evaluateNode(node.right, state);
      switch (node.op) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return mul(left, right);
        case "/": return div(left, right);
        case "%":
          if (right === 0n) throw new Error("Modulo by zero");
          return left % right;
        default: throw new Error(`Unknown operator ${node.op}`);
      }
    }
    case "comparison": {
      const left = evaluateNode(node.left, state);
      const right = evaluateNode(node.right, state);
      const result = node.op === ">" ? left > right
        : node.op === "<" ? left < right
          : node.op === ">=" ? left >= right
            : node.op === "<=" ? left <= right
              : node.op === "==" ? left === right
                : node.op === "!=" ? left !== right
                  : false;
      return result ? SCALE : 0n;
    }
    case "call": {
      const args = node.args.map((arg) => evaluateNode(arg, state));
      switch (node.name) {
        case "ROUND": {
          if (args.length < 1 || args.length > 2) throw new Error("ROUND(x, n?) requires 1 or 2 arguments");
          const value = requiredArg(args, 0, "ROUND");
          const places = args.length === 2 ? integerPart(requiredArg(args, 1, "ROUND")) : 0n;
          return roundToPlaces(value, places);
        }
        case "FLOOR":
          if (args.length !== 1) throw new Error("FLOOR(x) requires 1 argument");
          return floorFixed(requiredArg(args, 0, "FLOOR"));
        case "CEIL":
          if (args.length !== 1) throw new Error("CEIL(x) requires 1 argument");
          return ceilFixed(requiredArg(args, 0, "CEIL"));
        case "ABS": {
          if (args.length !== 1) throw new Error("ABS(x) requires 1 argument");
          const value = requiredArg(args, 0, "ABS");
          return value < 0n ? -value : value;
        }
        case "MIN": {
          if (args.length === 0) throw new Error("MIN requires at least 1 argument");
          const first = requiredArg(args, 0, "MIN");
          return args.slice(1).reduce((minimum, value) => value < minimum ? value : minimum, first);
        }
        case "MAX": {
          if (args.length === 0) throw new Error("MAX requires at least 1 argument");
          const first = requiredArg(args, 0, "MAX");
          return args.slice(1).reduce((maximum, value) => value > maximum ? value : maximum, first);
        }
        case "IF":
          if (args.length !== 3) throw new Error("IF(cond, then, else) requires 3 arguments");
          return requiredArg(args, 0, "IF") !== 0n
            ? requiredArg(args, 1, "IF")
            : requiredArg(args, 2, "IF");
        case "SUM":
          return args.reduce((sum, value) => sum + value, 0n);
        case "AVG":
          if (args.length === 0) return 0n;
          return roundDiv(args.reduce((sum, value) => sum + value, 0n), BigInt(args.length));
        case "COUNT":
          return BigInt(args.length) * SCALE;
        case "ROUNDUP":
          if (args.length !== 1) throw new Error("ROUNDUP(x) requires 1 argument");
          return ceilFixed(requiredArg(args, 0, "ROUNDUP"));
        case "ROUNDDOWN":
          if (args.length !== 1) throw new Error("ROUNDDOWN(x) requires 1 argument");
          return floorFixed(requiredArg(args, 0, "ROUNDDOWN"));
        case "AND":
          return args.every((value) => value !== 0n) ? SCALE : 0n;
        case "OR":
          return args.some((value) => value !== 0n) ? SCALE : 0n;
        case "NOT":
          if (args.length !== 1) throw new Error("NOT(x) requires 1 argument");
          return requiredArg(args, 0, "NOT") === 0n ? SCALE : 0n;
        case "POWER":
          if (args.length !== 2) throw new Error("POWER(x, y) requires 2 arguments");
          return powFixed(requiredArg(args, 0, "POWER"), requiredArg(args, 1, "POWER"));
        case "SQRT": {
          if (args.length !== 1) throw new Error("SQRT(x) requires 1 argument");
          const value = requiredArg(args, 0, "SQRT");
          if (value < 0n) throw new Error("SQRT requires a non-negative value");
          return integerSqrt(value * SCALE);
        }
        case "MOD": {
          if (args.length !== 2) throw new Error("MOD(x, y) requires 2 arguments");
          const left = requiredArg(args, 0, "MOD");
          const right = requiredArg(args, 1, "MOD");
          if (right === 0n) throw new Error("MOD division by zero");
          return left % right;
        }
        case "COALESCE":
          return args.find((value) => value !== 0n) ?? 0n;
        case "NULLIF": {
          if (args.length !== 2) throw new Error("NULLIF(x, y) requires 2 arguments");
          const left = requiredArg(args, 0, "NULLIF");
          const right = requiredArg(args, 1, "NULLIF");
          return left === right ? 0n : left;
        }
        default:
          throw new Error(`Unsupported function ${node.name}`);
      }
    }
  }
}

export function validateFormula(expression: string): FormulaValidation {
  try {
    const ast = parse(expression);
    return { valid: true, ...referencesFor(ast) };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
      variableSlugs: [],
      contextKeys: [],
    };
  }
}

export function evaluateFormula(
  expression: string,
  input: FormulaEvaluationInput = {},
): FormulaEvaluation {
  let references: FormulaReferences = { variableSlugs: [], contextKeys: [] };
  try {
    const ast = parse(expression);
    references = referencesFor(ast);
    const state: EvalState = {
      variables: input.variables ?? {},
      context: input.context ?? {},
      strictMissing: input.strictMissing ?? true,
      missingVariables: new Set<string>(),
      missingContext: new Set<string>(),
      resolvedValues: {},
    };
    const result = evaluateNode(ast, state);
    const exact = formatFixed(result);
    return {
      valid: true,
      valueExact: exact,
      value: Number(exact),
      ...references,
      missingVariables: [...state.missingVariables],
      missingContext: [...state.missingContext],
      resolvedValues: state.resolvedValues,
    };
  } catch (error) {
    return {
      valid: false,
      valueExact: "0",
      value: 0,
      error: error instanceof Error ? error.message : String(error),
      ...references,
      missingVariables: [],
      missingContext: [],
      resolvedValues: {},
    };
  }
}

export function normalizeNumericVariable(value: string, maxDecimals: number): string | null {
  const trimmed = value.trim();
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/u.exec(trimmed);
  if (!match || (match[3]?.length ?? 0) > maxDecimals) return null;
  const wholeRaw = match[2];
  if (!wholeRaw) return null;

  try {
    const sign = match[1] === "-" ? "-" : "";
    const whole = BigInt(wholeRaw).toString();
    const fraction = (match[3] ?? "").replace(/0+$/u, "");
    return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
  } catch {
    return null;
  }
}
