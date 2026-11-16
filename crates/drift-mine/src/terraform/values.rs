//! What the repository's own files settle of a Terraform expression: a literal, a
//! `local`, a `variable` with a `default` that nothing in the repository sets again
//! (a `.tfvars` file, a `module` block that calls the module, Terragrunt `inputs`),
//! simple string interpolation of those, `each` and `count` of an instance, and the
//! few functions that only change a value's type (`toset`, `tolist`, `tomap`).
//!
//! Anything else is not worked out, and the error names the expression: a value a
//! deployment chooses (a variable without a default, one a `.tfvars` file sets, the
//! attribute of another resource) is not in the files, so whatever rests on it stays
//! unknown, never a guess.

use std::collections::BTreeMap;

/// A value, as far as the files settle it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Val {
    Str(String),
    /// A number, as written.
    Num(String),
    Bool(bool),
    Null,
    List(Vec<Val>),
    Map(BTreeMap<String, Val>),
}

impl Val {
    /// The value as a string, where Terraform would make it one.
    pub(super) fn text(&self) -> Option<String> {
        match self {
            Val::Str(s) | Val::Num(s) => Some(s.clone()),
            Val::Bool(b) => Some(b.to_string()),
            _ => None,
        }
    }

    /// A list of strings (a set or a tuple of them).
    pub(super) fn texts(&self) -> Option<Vec<String>> {
        match self {
            Val::List(items) => items.iter().map(Val::text).collect(),
            _ => None,
        }
    }

    /// A boolean, as Terraform converts one (`"true"` is true).
    pub(super) fn truth(&self) -> Option<bool> {
        match self {
            Val::Bool(b) => Some(*b),
            Val::Str(s) if s == "true" => Some(true),
            Val::Str(s) if s == "false" => Some(false),
            _ => None,
        }
    }
}

/// What a module's expressions may name: its locals and variables, and the
/// variables something else in the repository sets.
pub(super) struct Env<'a> {
    pub locals: &'a BTreeMap<String, String>,
    /// Each variable with its `default`, as written.
    pub variables: &'a BTreeMap<String, Option<String>>,
    /// The variables set from outside the module, with where.
    pub set_outside: &'a BTreeMap<String, String>,
}

/// One instance of a resource: what `each` and `count` are in it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct Inst {
    pub each: Option<(Val, Val)>,
    pub count: Option<usize>,
}

/// More instances than any resource is written with: not expanded.
const MAX_INSTANCES: usize = 64;

/// The instances of `count` / `for_each` (`meta` and the expression), or why they are
/// not known. No meta-argument: one instance.
pub(super) fn instances(meta: Option<(&str, &str)>, env: &Env<'_>) -> Result<Vec<Inst>, String> {
    let Some((name, expr)) = meta else {
        return Ok(vec![Inst::default()]);
    };
    let at = |why: String| format!("`{name} = {expr}`: {why}");
    let v = eval(expr, env, &Inst::default()).map_err(at)?;
    let out: Vec<Inst> = match (name, &v) {
        ("count", Val::Num(n)) => {
            let n: usize = n
                .parse()
                .map_err(|_| at(format!("{n} is not a count Drift expands")))?;
            (0..n)
                .map(|i| Inst {
                    each: None,
                    count: Some(i),
                })
                .collect()
        }
        ("for_each", Val::Map(m)) => m
            .iter()
            .map(|(k, v)| Inst {
                each: Some((Val::Str(k.clone()), v.clone())),
                count: None,
            })
            .collect(),
        ("for_each", Val::List(items)) => {
            let mut keys: Vec<String> = items
                .iter()
                .map(|i| {
                    i.text()
                        .ok_or_else(|| at("an element is not a string".into()))
                })
                .collect::<Result<_, _>>()?;
            keys.sort();
            keys.dedup();
            keys.into_iter()
                .map(|k| Inst {
                    each: Some((Val::Str(k.clone()), Val::Str(k))),
                    count: None,
                })
                .collect()
        }
        _ => return Err(at("it is not a number, a list or a map".into())),
    };
    if out.len() > MAX_INSTANCES {
        return Err(at(format!(
            "{} instances, more than Drift expands",
            out.len()
        )));
    }
    Ok(out)
}

/// The value of `expr` in the module `env`, for the instance `inst`; why not, naming
/// the expression, when the files do not settle it.
pub(super) fn eval(expr: &str, env: &Env<'_>, inst: &Inst) -> Result<Val, String> {
    let mut p = P {
        c: expr.chars().collect(),
        at: 0,
        env,
        inst,
        depth: 0,
    };
    let v = p.expr()?;
    p.space();
    if p.at < p.c.len() {
        return Err(p.unread());
    }
    Ok(v)
}

/// Deeper than locals are written: a local that names itself.
const MAX_DEPTH: usize = 32;

struct P<'a> {
    c: Vec<char>,
    at: usize,
    env: &'a Env<'a>,
    inst: &'a Inst,
    depth: usize,
}

impl P<'_> {
    fn whole(&self) -> String {
        self.c.iter().collect()
    }

    /// The expression is outside what Drift works out.
    fn unread(&self) -> String {
        format!("`{}` is not an expression Drift works out", self.whole())
    }

    fn peek(&self) -> Option<char> {
        self.c.get(self.at).copied()
    }

    fn space(&mut self) {
        while self.peek().is_some_and(char::is_whitespace) {
            self.at += 1;
        }
    }

    fn eat(&mut self, s: &str) -> bool {
        self.space();
        let n = s.chars().count();
        if self.c.len() >= self.at + n && self.c[self.at..self.at + n].iter().copied().eq(s.chars())
        {
            self.at += n;
            true
        } else {
            false
        }
    }

    fn ident(&mut self) -> String {
        self.space();
        let mut out = String::new();
        while let Some(c) = self
            .peek()
            .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        {
            if out.is_empty() && (c.is_ascii_digit() || c == '-') {
                break;
            }
            out.push(c);
            self.at += 1;
        }
        out
    }

    fn expr(&mut self) -> Result<Val, String> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(self.unread());
        }
        let cond = self.compare();
        let out = if self.eat("?") {
            let yes = self.expr();
            if !self.eat(":") {
                return Err(self.unread());
            }
            let no = self.expr();
            match cond?.truth() {
                Some(true) => yes,
                Some(false) => no,
                None => Err(self.unread()),
            }
        } else {
            cond
        };
        self.depth -= 1;
        out
    }

    fn compare(&mut self) -> Result<Val, String> {
        let left = self.postfix()?;
        for (op, same) in [("==", true), ("!=", false)] {
            if self.eat(op) {
                let right = self.postfix()?;
                return Ok(Val::Bool((left == right) == same));
            }
        }
        Ok(left)
    }

    fn postfix(&mut self) -> Result<Val, String> {
        let mut v = self.primary()?;
        loop {
            self.space();
            if self.peek() == Some('.') && self.c.get(self.at + 1) != Some(&'.') {
                self.at += 1;
                let key = self.ident();
                if key.is_empty() {
                    return Err(self.unread());
                }
                v = self.index(v, &Val::Str(key))?;
            } else if self.peek() == Some('[') {
                self.at += 1;
                if self.eat("*") {
                    return Err(self.unread());
                }
                let key = self.expr()?;
                if !self.eat("]") {
                    return Err(self.unread());
                }
                v = self.index(v, &key)?;
            } else {
                return Ok(v);
            }
        }
    }

    fn index(&self, v: Val, key: &Val) -> Result<Val, String> {
        let found = match (&v, key) {
            (Val::Map(m), k) => k.text().and_then(|k| m.get(&k).cloned()),
            (Val::List(items), Val::Num(n)) => {
                n.parse::<usize>().ok().and_then(|i| items.get(i).cloned())
            }
            _ => None,
        };
        found.ok_or_else(|| {
            format!(
                "`{}` names an element its value does not have",
                self.whole()
            )
        })
    }

    fn primary(&mut self) -> Result<Val, String> {
        self.space();
        match self.peek() {
            None => Err(self.unread()),
            Some('"') => self.string(),
            Some('(') => {
                self.at += 1;
                let v = self.expr()?;
                if !self.eat(")") {
                    return Err(self.unread());
                }
                Ok(v)
            }
            Some('[') => {
                self.at += 1;
                let mut items = Vec::new();
                loop {
                    if self.eat("]") {
                        return Ok(Val::List(items));
                    }
                    items.push(self.expr()?);
                    if self.eat(",") {
                        continue;
                    }
                    if self.eat("]") {
                        return Ok(Val::List(items));
                    }
                    return Err(self.unread());
                }
            }
            Some('{') => {
                self.at += 1;
                let mut m = BTreeMap::new();
                loop {
                    if self.eat("}") {
                        return Ok(Val::Map(m));
                    }
                    self.space();
                    let key = if self.peek() == Some('"') {
                        self.string()?.text().ok_or_else(|| self.unread())?
                    } else {
                        let k = self.ident();
                        if k.is_empty() {
                            return Err(self.unread());
                        }
                        k
                    };
                    if !self.eat("=") && !self.eat(":") {
                        return Err(self.unread());
                    }
                    let v = self.expr()?;
                    m.insert(key, v);
                    self.eat(",");
                }
            }
            Some(c) if c.is_ascii_digit() || c == '-' => {
                let mut n = String::new();
                while let Some(c) = self
                    .peek()
                    .filter(|c| c.is_ascii_digit() || *c == '.' || (*c == '-' && n.is_empty()))
                {
                    n.push(c);
                    self.at += 1;
                }
                if n == "-" {
                    return Err(self.unread());
                }
                Ok(Val::Num(n))
            }
            Some(_) => {
                let start = self.at;
                let word = self.ident();
                match word.as_str() {
                    "" => Err(self.unread()),
                    "true" => Ok(Val::Bool(true)),
                    "false" => Ok(Val::Bool(false)),
                    "null" => Ok(Val::Null),
                    "toset" | "tolist" | "tomap" if self.eat("(") => {
                        let v = self.expr()?;
                        if !self.eat(")") {
                            return Err(self.unread());
                        }
                        Ok(match (word.as_str(), v) {
                            ("toset", Val::List(mut items)) => {
                                let mut seen = Vec::new();
                                items.retain(|i| {
                                    let new = !seen.contains(i);
                                    seen.push(i.clone());
                                    new
                                });
                                Val::List(items)
                            }
                            (_, v) => v,
                        })
                    }
                    "var" | "local" | "each" | "count" if self.peek() == Some('.') => {
                        self.at += 1;
                        let name = self.ident();
                        self.named(&word, &name)
                    }
                    _ => {
                        // A reference to something that is not a value of the files (a
                        // resource's attribute, a data source, a module output) or a
                        // function Drift does not apply.
                        let mut end = self.at;
                        while self
                            .c
                            .get(end)
                            .is_some_and(|c| c.is_alphanumeric() || "_-.[]\"*".contains(*c))
                        {
                            end += 1;
                        }
                        let shown: String = self.c[start..end].iter().collect();
                        Err(format!(
                            "`{shown}` is not a value the repository's files settle"
                        ))
                    }
                }
            }
        }
    }

    fn named(&self, kind: &str, name: &str) -> Result<Val, String> {
        match kind {
            "var" => {
                let env = self.env;
                // `*`: a `.tfvars` file that is not read may set any of them.
                if let Some(at) = env
                    .set_outside
                    .get(name)
                    .or_else(|| env.set_outside.get("*"))
                {
                    return Err(format!(
                        "`var.{name}` is set in {at}, so which value it has is not known"
                    ));
                }
                match env.variables.get(name) {
                    Some(Some(default)) => self.nested(default, &Inst::default()),
                    Some(None) => Err(format!("`var.{name}` has no default")),
                    None => Err(format!("`var.{name}` is not declared in its module")),
                }
            }
            "local" => match self.env.locals.get(name) {
                Some(expr) => self.nested(expr, &Inst::default()),
                None => Err(format!("`local.{name}` is not in its module")),
            },
            "each" => match (&self.inst.each, name) {
                (Some((k, _)), "key") => Ok(k.clone()),
                (Some((_, v)), "value") => Ok(v.clone()),
                _ => Err(format!("`each.{name}` is not known here")),
            },
            _ => match (self.inst.count, name) {
                (Some(i), "index") => Ok(Val::Num(i.to_string())),
                _ => Err(format!("`count.{name}` is not known here")),
            },
        }
    }

    /// The value of another expression of the module (a local, a default), at one
    /// more depth.
    fn nested(&self, expr: &str, inst: &Inst) -> Result<Val, String> {
        if self.depth > MAX_DEPTH {
            return Err(format!("`{expr}` names itself"));
        }
        let mut p = P {
            c: expr.chars().collect(),
            at: 0,
            env: self.env,
            inst,
            depth: self.depth + 1,
        };
        let v = p.expr()?;
        p.space();
        if p.at < p.c.len() {
            return Err(p.unread());
        }
        Ok(v)
    }

    /// A quoted string, its interpolations worked out.
    fn string(&mut self) -> Result<Val, String> {
        self.at += 1;
        let mut out = String::new();
        loop {
            let Some(c) = self.peek() else {
                return Err(self.unread());
            };
            self.at += 1;
            match c {
                '"' => return Ok(Val::Str(out)),
                '\\' => {
                    let e = self.peek().ok_or_else(|| self.unread())?;
                    self.at += 1;
                    out.push(match e {
                        'n' => '\n',
                        't' => '\t',
                        'r' => '\r',
                        other => other,
                    });
                }
                '$' | '%' if self.peek() == Some(c) && self.c.get(self.at + 1) == Some(&'{') => {
                    // `$${` and `%%{` are the characters themselves.
                    self.at += 1;
                    out.push(c);
                }
                '%' if self.peek() == Some('{') => return Err(self.unread()),
                '$' if self.peek() == Some('{') => {
                    self.at += 1;
                    let v = self.expr()?;
                    if !self.eat("}") {
                        return Err(self.unread());
                    }
                    out.push_str(&v.text().ok_or_else(|| {
                        format!(
                            "`{}` interpolates a value that is not a string",
                            self.whole()
                        )
                    })?);
                }
                c => out.push(c),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_eval(expr: &str, inst: &Inst) -> Result<Val, String> {
        let locals: BTreeMap<String, String> = [
            ("prefix".to_string(), "\"/api\"".to_string()),
            (
                "paths".to_string(),
                "[\"${local.prefix}/*\", \"/health\"]".to_string(),
            ),
            ("me".to_string(), "local.me".to_string()),
        ]
        .into();
        let variables: BTreeMap<String, Option<String>> = [
            ("internal".to_string(), Some("true".to_string())),
            (
                "svc".to_string(),
                Some("{ a = \"/a/*\", b = \"/b/*\" }".to_string()),
            ),
            ("set".to_string(), Some("\"x\"".to_string())),
            ("none".to_string(), None),
        ]
        .into();
        let outside: BTreeMap<String, String> =
            [("set".to_string(), "prod.tfvars".to_string())].into();
        let env = Env {
            locals: &locals,
            variables: &variables,
            set_outside: &outside,
        };
        eval(expr, &env, inst)
    }

    #[test]
    fn what_the_files_settle_is_worked_out_and_the_rest_named() {
        let s = |x: &str| Val::Str(x.to_string());
        let none = Inst::default();
        assert_eq!(
            env_eval("local.paths", &none),
            Ok(Val::List(vec![s("/api/*"), s("/health")]))
        );
        assert_eq!(env_eval("var.internal", &none), Ok(Val::Bool(true)));
        assert_eq!(env_eval("var.svc[\"b\"]", &none), Ok(s("/b/*")));
        assert_eq!(env_eval("var.svc.a", &none), Ok(s("/a/*")));
        assert_eq!(
            env_eval("var.internal ? \"yes\" : \"no\"", &none),
            Ok(s("yes"))
        );
        assert_eq!(
            env_eval("toset([\"a\", \"a\"])", &none),
            Ok(Val::List(vec![s("a")]))
        );
        let each = Inst {
            each: Some((s("a"), s("/a/*"))),
            count: None,
        };
        assert_eq!(
            env_eval("[each.value]", &each),
            Ok(Val::List(vec![s("/a/*")]))
        );
        assert!(
            env_eval("var.set", &none)
                .unwrap_err()
                .contains("prod.tfvars")
        );
        assert!(
            env_eval("var.none", &none)
                .unwrap_err()
                .contains("has no default")
        );
        assert!(env_eval("local.me", &none).is_err());
        assert!(
            env_eval("aws_lb.main.arn", &none)
                .unwrap_err()
                .contains("`aws_lb.main.arn`")
        );
        assert!(env_eval("lookup(var.svc, \"a\")", &none).is_err());
        assert!(env_eval("\"%{if true}x%{endif}\"", &none).is_err());
        assert_eq!(env_eval("\"$${x}\"", &none), Ok(s("${x}")));
    }

    #[test]
    fn count_and_for_each_expand_over_what_the_files_settle() {
        let locals = BTreeMap::new();
        let variables: BTreeMap<String, Option<String>> =
            [("n".to_string(), Some("2".to_string()))].into();
        let outside = BTreeMap::new();
        let env = Env {
            locals: &locals,
            variables: &variables,
            set_outside: &outside,
        };
        assert_eq!(instances(Some(("count", "var.n")), &env).unwrap().len(), 2);
        assert_eq!(
            instances(Some(("for_each", "toset([\"b\", \"a\"])")), &env)
                .unwrap()
                .len(),
            2
        );
        let e = instances(Some(("for_each", "var.paths")), &env).unwrap_err();
        assert!(e.starts_with("`for_each = var.paths`: "), "{e}");
    }
}
