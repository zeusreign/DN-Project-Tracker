// The SQL safety boundary.
//
// The model writes a SELECT; nothing here trusts it. A statement is tokenised,
// checked against an allowlist of what a read may contain, and then wrapped so
// that three things are true however it was written:
//
//   1. It reads only the five scoped views from assistant-schema.js, so this
//      reader's business-unit scope is applied by SQLite rather than by us
//      finding the right place to put a clause in someone else's text.
//   2. It cannot be more than one statement, and cannot be a write.
//   3. It cannot return more rows than the cap, whatever LIMIT it asked for.
//
// The prompt is not part of this. A model told to behave is a model that
// usually behaves; the worker is what makes it not matter.

import {
  QUERY_COLUMNS, QUERY_TABLES, FORBIDDEN_COLUMNS, FORBIDDEN_TABLES,
  scopedViews, clampLimit, RESULT_LIMIT_MAX,
} from "./assistant-schema.js";

export class SqlRejected extends Error {
  constructor(reason, detail) {
    super(reason);
    this.name = "SqlRejected";
    this.reason = reason;
    this.detail = detail || null;
  }
}

// Anything that writes, changes the schema, reaches the file system, or steps
// outside a plain read. Checked as whole words against the token stream, so a
// column called "created_at" is not mistaken for CREATE.
const BANNED = new Set([
  "insert", "update", "delete", "drop", "alter", "create", "replace", "truncate",
  "pragma", "attach", "detach", "vacuum", "reindex", "analyze",
  "begin", "commit", "rollback", "savepoint", "release", "transaction",
  "trigger", "index", "view", "table", "database", "schema", "temp", "temporary",
  "grant", "revoke", "returning", "upsert", "conflict", "do", "set",
  "load_extension", "readfile", "writefile", "edit", "fts3", "fts4", "fts5",
  "randomblob", "zeroblob", "sqlite_version", "sqlite_source_id", "sqlite_compileoption_get",
]);

// The functions a read may call. An unknown function is refused rather than
// passed through: SQLite's surface includes things that touch more than data.
const FUNCTIONS = new Set([
  "count", "sum", "avg", "min", "max", "total", "group_concat",
  "abs", "round", "cast", "coalesce", "ifnull", "nullif", "iif", "length",
  "lower", "upper", "trim", "ltrim", "rtrim", "substr", "substring", "replace_text",
  "instr", "printf", "format", "typeof", "like", "glob",
  "date", "time", "datetime", "julianday", "unixepoch", "strftime", "timediff",
  "row_number", "rank", "dense_rank", "ntile", "lag", "lead",
  "first_value", "last_value", "nth_value", "cume_dist", "percent_rank",
]);

// Tokeniser. Strings and identifiers are kept whole so that a keyword inside a
// quoted value is never read as a keyword, and a comment is refused rather than
// stripped: a comment is a place to hide something, and a read does not need one.
export function tokenise(sql) {
  const tokens = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === "-" && sql[i + 1] === "-") throw new SqlRejected("The query contains a comment.");
    if (c === "/" && sql[i + 1] === "*") throw new SqlRejected("The query contains a comment.");
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === close) {
          // '' inside a single-quoted string is an escaped quote, not the end.
          if (close === "'" && sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      if (j >= sql.length) throw new SqlRejected("The query has an unterminated quote.");
      tokens.push({ type: c === "'" ? "string" : "quoted", value: sql.slice(i + 1, j), raw: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] || ""))) {
      let j = i;
      while (j < sql.length && /[0-9.eE]/.test(sql[j])) j += 1;
      tokens.push({ type: "number", value: sql.slice(i, j), raw: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j])) j += 1;
      const value = sql.slice(i, j);
      tokens.push({ type: "word", value, lower: value.toLowerCase(), raw: value });
      i = j;
      continue;
    }
    // Two-character operators are one token: joining tokens with spaces would
    // otherwise turn <> into "< >", which is a syntax error rather than a
    // comparison, and >= into something that silently means something else.
    const pair = sql.slice(i, i + 2);
    if (["<>", "<=", ">=", "!=", "||", "<<", ">>"].includes(pair)) {
      tokens.push({ type: "punct", value: pair, raw: pair });
      i += 2;
      continue;
    }
    tokens.push({ type: "punct", value: c, raw: c });
    i += 1;
  }
  return tokens;
}

// Checks one statement and returns the identifiers it referenced, so a caller
// can report what was wrong with it rather than only that it was wrong.
export function validateSql(sql) {
  const text = String(sql || "").trim();
  if (!text) throw new SqlRejected("No query was produced.");
  if (text.length > 4000) throw new SqlRejected("The query is too long to check safely.");

  const tokens = tokenise(text);
  if (!tokens.length) throw new SqlRejected("No query was produced.");

  // One statement. A semicolon anywhere but the very end is a second statement,
  // and the end one is dropped rather than passed on, because the wrapper puts
  // this query inside another.
  const semis = tokens.filter((t) => t.type === "punct" && t.value === ";");
  const trailing = tokens[tokens.length - 1].type === "punct" && tokens[tokens.length - 1].value === ";";
  if (semis.length > 1 || (semis.length === 1 && !trailing)) {
    throw new SqlRejected("Only one statement may be run.");
  }
  const body = trailing ? tokens.slice(0, -1) : tokens;
  if (!body.length) throw new SqlRejected("No query was produced.");

  // A read begins with SELECT, or with WITH when it declares its own CTEs.
  const first = body[0];
  if (first.type !== "word" || (first.lower !== "select" && first.lower !== "with")) {
    throw new SqlRejected("Only a SELECT may be run.", first.raw);
  }

  // A quoted or bracketed identifier is refused: it is the way a reserved name
  // is smuggled past a word check, and nothing in this schema needs one.
  const quoted = body.find((t) => t.type === "quoted");
  if (quoted) throw new SqlRejected("Quoted identifiers are not allowed.", quoted.raw);

  // Parameter placeholders would collide with the bindings the wrapper adds.
  const placeholder = body.find((t) => t.type === "punct" && (t.value === "?" || t.value === ":" || t.value === "@" || t.value === "$"));
  if (placeholder) throw new SqlRejected("The query may not contain parameters.", placeholder.raw);

  const words = body.filter((t) => t.type === "word");

  // Writes, schema changes and everything else off the read path.
  const banned = words.find((t) => BANNED.has(t.lower));
  if (banned) throw new SqlRejected(`"${banned.raw.toUpperCase()}" is not allowed in a read.`, banned.raw);

  // Nothing may name a table the assistant cannot read, anywhere in the text.
  const forbiddenTable = words.find((t) => FORBIDDEN_TABLES.includes(t.lower) || t.lower.startsWith("sqlite_"));
  if (forbiddenTable) {
    throw new SqlRejected(`The assistant cannot read "${forbiddenTable.raw}".`, forbiddenTable.raw);
  }
  const forbiddenColumn = words.find((t) => FORBIDDEN_COLUMNS.includes(t.lower));
  if (forbiddenColumn) {
    throw new SqlRejected(`The column "${forbiddenColumn.raw}" is not readable.`, forbiddenColumn.raw);
  }

  // A schema-qualified name is the one way the scoped views can be stepped
  // around, so a word followed by a dot has to be a known alias or table, never
  // a schema. main.projects would reach the unscoped table.
  const names = collectNames(body);
  for (const qualifier of names.qualifiers) {
    if (["main", "temp", "sqlite_schema", "sqlite_master"].includes(qualifier.lower)) {
      throw new SqlRejected("A schema-qualified table name is not allowed.", qualifier.raw + ".");
    }
  }

  // Table positions: after FROM or JOIN. Each must be one of the five views, a
  // CTE the query declared itself, or an opening bracket for a subquery.
  for (const table of names.tables) {
    if (QUERY_TABLES.includes(table.lower) || names.ctes.has(table.lower)) continue;
    throw new SqlRejected(
      `"${table.raw}" is not a table the assistant can read. Available: ${QUERY_TABLES.join(", ")}.`,
      table.raw);
  }

  // Function calls: a word immediately followed by "(". Anything unknown is
  // refused rather than assumed harmless.
  for (const fn of names.functions) {
    if (FUNCTIONS.has(fn.lower) || names.ctes.has(fn.lower)) continue;
    throw new SqlRejected(`The function "${fn.raw}" is not available.`, fn.raw);
  }

  const tables = [...new Set(names.tables.map((t) => t.lower))];
  return {
    sql: body.map(renderToken).join(" ").replace(/\s+([,)])/g, "$1").replace(/\(\s+/g, "("),
    tables,
    ctes: [...names.ctes],
    aggregate: isAggregate(body, names),
    grouped: body.some((t, i) => t.type === "word" && t.lower === "group"
      && body[i + 1] && body[i + 1].type === "word" && body[i + 1].lower === "by"),
    // What the query is counting. The first table after FROM is the one each
    // row is one of; a join to project_updates makes rows that are updates,
    // not projects, and saying "40 projects" of 40 updates is the kind of
    // confident wrong answer this whole feature exists to avoid.
    driving: names.tables.length ? names.tables[0].lower : null,
  };
}

function renderToken(token) {
  return token.type === "string" ? `'${token.value.replace(/'/g, "''")}'` : token.raw;
}

// Walks the token stream for the three positions that matter: what is being
// read from, what the query named itself, and what is being called.
function collectNames(body) {
  const tables = [], functions = [], qualifiers = [], ctes = new Set();
  for (let i = 0; i < body.length; i += 1) {
    const token = body[i];
    if (token.type !== "word") continue;
    const next = body[i + 1];
    const previous = body[i - 1];

    // WITH name AS (, and ", name AS (" for each one after the first.
    if (token.lower === "with") {
      let j = i + 1;
      if (body[j] && body[j].type === "word" && body[j].lower === "recursive") j += 1;
      while (body[j] && body[j].type === "word") {
        ctes.add(body[j].lower);
        // Skip an optional column list, then AS ( ... ), then look for a comma.
        let depth = 0, k = j + 1;
        while (k < body.length) {
          const t = body[k];
          if (t.type === "punct" && t.value === "(") depth += 1;
          else if (t.type === "punct" && t.value === ")") {
            depth -= 1;
            if (depth === 0) { k += 1; break; }
          }
          k += 1;
        }
        if (body[k] && body[k].type === "punct" && body[k].value === ",") { j = k + 1; continue; }
        break;
      }
      continue;
    }
    if ((token.lower === "from" || token.lower === "join") && next) {
      if (next.type === "word") tables.push(next);
      continue;
    }
    if (next && next.type === "punct" && next.value === "(" && !KEYWORDS.has(token.lower)) {
      functions.push(token);
    }
    if (next && next.type === "punct" && next.value === "." ) qualifiers.push(token);
    if (previous && previous.type === "punct" && previous.value === "." ) {
      // The part after a dot is a column or a star; nothing to collect.
    }
  }
  return { tables, functions, qualifiers, ctes };
}

// Words that may be followed by "(" without being a function call.
const KEYWORDS = new Set([
  "select", "from", "where", "and", "or", "not", "in", "exists", "join", "on",
  "group", "by", "order", "having", "limit", "offset", "as", "case", "when",
  "then", "else", "end", "union", "all", "distinct", "is", "null", "like",
  "between", "asc", "desc", "left", "inner", "outer", "cross", "with", "recursive",
  "over", "partition", "rows", "range", "preceding", "following", "unbounded",
  "current", "row", "nulls", "first", "last", "collate", "escape", "cast", "filter",
  "values", "intersect", "except", "if",
]);

// A query whose result is a figure rather than a list of records: it selects
// only aggregates and has no GROUP BY. Those are answered from the one row and
// never paged, because "the total is $138m" is not a page of a larger total.
function isAggregate(body, names) {
  const hasGroup = body.some((t, i) =>
    t.type === "word" && t.lower === "group"
    && body[i + 1] && body[i + 1].type === "word" && body[i + 1].lower === "by");
  if (hasGroup) return false;
  const AGG = new Set(["count", "sum", "avg", "min", "max", "total", "group_concat"]);
  const calls = names.functions.filter((f) => AGG.has(f.lower));
  if (!calls.length) return false;
  // Every selected item has to be one, which is true when the select list
  // contains no bare column reference outside an aggregate call.
  const selectStart = body.findIndex((t) => t.type === "word" && t.lower === "select");
  const fromIndex = body.findIndex((t, i) => i > selectStart && t.type === "word" && t.lower === "from");
  if (selectStart < 0 || fromIndex < 0) return false;
  let depth = 0;
  for (let i = selectStart + 1; i < fromIndex; i += 1) {
    const t = body[i];
    if (t.type === "punct" && t.value === "(") { depth += 1; continue; }
    if (t.type === "punct" && t.value === ")") { depth -= 1; continue; }
    if (depth > 0) continue;
    if (t.type === "word" && !KEYWORDS.has(t.lower) && !AGG.has(t.lower)) {
      // An alias after AS is fine; a column reference is not.
      const previous = body[i - 1];
      if (previous && previous.type === "word" && previous.lower === "as") continue;
      if (body[i + 1] && body[i + 1].type === "punct" && body[i + 1].value === "(") continue;
      return false;
    }
  }
  return true;
}

// Takes validated SQL and produces what actually runs: the scoped views in
// front, the query as a subquery, and the cap applied outside it where the
// model cannot reach. The count comes from the same subquery, so "74 matched,
// 20 returned" is read rather than guessed - and for a GROUP BY it counts
// groups, which is the right total for that question.
export function composeQuery(validated, scope, { limit } = {}) {
  const views = scopedViews(scope);
  const inner = validated.sql;
  const capped = clampLimit(limit);
  return {
    rows: {
      sql: `${views.sql}\nSELECT * FROM (\n${inner}\n) LIMIT ?`,
      bindings: [...views.bindings, capped],
    },
    count: {
      sql: `${views.sql}\nSELECT COUNT(*) AS total FROM (\n${inner}\n)`,
      bindings: [...views.bindings],
    },
    limit: capped,
    aggregate: validated.aggregate,
  };
}

// One call: check it, wrap it, run it, and report what came back alongside what
// matched. Nothing here decides what the reader may see - scopedViews did that
// before the query was composed.
export async function runSql(db, sql, scope, { limit } = {}) {
  const validated = validateSql(sql);
  const query = composeQuery(validated, scope, { limit });
  const [rows, count] = await Promise.all([
    db.prepare(query.rows.sql).bind(...query.rows.bindings).all(),
    db.prepare(query.count.sql).bind(...query.count.bindings).first(),
  ]);
  const results = rows.results || [];
  const total = count && typeof count.total === "number" ? count.total : results.length;

  // How many distinct projects those rows are about, which is a different
  // number from how many rows there are whenever the query joined a child
  // table. Counted over the same subquery, so it is exact rather than inferred
  // from the page that came back.
  const key = projectKey(validated, results);
  let projects = null;
  if (key) {
    const distinct = await db.prepare(
      `${scopedViews(scope).sql}\nSELECT COUNT(DISTINCT ${key}) AS n FROM (\n${validated.sql}\n)`,
    ).bind(...scopedViews(scope).bindings).first().catch(() => null);
    projects = {
      matched: distinct && typeof distinct.n === "number" ? distinct.n : null,
      returned: new Set(results.map((row) => row[key]).filter((id) => id !== null && id !== undefined)).size,
    };
  }

  return {
    rows: results,
    returned: results.length,
    total,
    truncated: total > results.length,
    limit: query.limit,
    aggregate: query.aggregate,
    grouped: validated.grouped,
    // What one row is. The answerer and the UI are both told, so neither has
    // to guess from the column names.
    entity: entityOf(validated),
    entityLabel: ENTITY_LABELS[entityOf(validated)] || "records",
    projects,
    projectKey: key,
    sql: query.rows.sql,
    inner: validated.sql,
    tables: validated.tables,
  };
}

// Which column in the result identifies a project, if any. project_id is
// unambiguous. A bare id is only a project's when projects is what the query
// is driven from: on a query over project_updates, id is the update's.
function projectKey(validated, results) {
  // Read off the result's own columns rather than assumed: a query may be
  // driven from projects and still not select an id, and counting a column
  // that is not there turns a good answer into an error.
  if (!results.length) return null;
  const columns = Object.keys(results[0]);
  if (columns.includes("project_id")) return "project_id";
  if (columns.includes("id") && validated.driving === "projects") return "id";
  return null;
}

function entityOf(validated) {
  if (validated.aggregate) return "figure";
  if (validated.grouped) return "group";
  return validated.driving || "row";
}

const ENTITY_LABELS = {
  projects: "projects",
  project_updates: "activity updates",
  project_photos: "photographs",
  development_details: "development records",
  business_units: "business units",
  figure: "a single figure",
  group: "grouped totals",
  row: "records",
};

export { ENTITY_LABELS };

export { RESULT_LIMIT_MAX };

// The records the UI needs, for the projects an answer found.
//
// The model chooses its own columns, which is right for answering a question
// and wrong for the evidence panel: "SELECT id, name" is a perfectly good query
// whose rows would render as empty cards. So when a result names projects, the
// full approved projection for those ids is read back through the same scoped
// views and handed to the UI alongside the model's own rows.
//
// This cannot widen anything. It reads the scoped view by id, so an id the
// reader may not see returns nothing, and the columns are the approved ones.
export async function hydrateProjects(db, rows, scope) {
  const ids = [...new Set(rows.map((row) => row.id).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return [];
  const views = scopedViews(scope);
  const holes = ids.map(() => "?").join(", ");
  const columns = QUERY_COLUMNS.projects.join(", ");
  const { results } = await db.prepare(
    `${views.sql}\nSELECT ${columns} FROM projects WHERE id IN (${holes})`,
  ).bind(...views.bindings, ...ids).all();
  // Returned in the order the answer found them, because that order is the
  // answer: "ordered by largest budget" means the first card is the largest.
  const byId = new Map((results || []).map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}
