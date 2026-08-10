#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ajv/dist/compile/codegen/code.js
var require_code = __commonJS({
  "node_modules/ajv/dist/compile/codegen/code.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.regexpCode = exports2.getEsmExportName = exports2.getProperty = exports2.safeStringify = exports2.stringify = exports2.strConcat = exports2.addCodeArg = exports2.str = exports2._ = exports2.nil = exports2._Code = exports2.Name = exports2.IDENTIFIER = exports2._CodeOrName = void 0;
    var _CodeOrName = class {
    };
    exports2._CodeOrName = _CodeOrName;
    exports2.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
    var Name = class extends _CodeOrName {
      constructor(s) {
        super();
        if (!exports2.IDENTIFIER.test(s))
          throw new Error("CodeGen: name must be a valid identifier");
        this.str = s;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        return false;
      }
      get names() {
        return { [this.str]: 1 };
      }
    };
    exports2.Name = Name;
    var _Code = class extends _CodeOrName {
      constructor(code) {
        super();
        this._items = typeof code === "string" ? [code] : code;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        if (this._items.length > 1)
          return false;
        const item = this._items[0];
        return item === "" || item === '""';
      }
      get str() {
        var _a;
        return (_a = this._str) !== null && _a !== void 0 ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
      }
      get names() {
        var _a;
        return (_a = this._names) !== null && _a !== void 0 ? _a : this._names = this._items.reduce((names, c) => {
          if (c instanceof Name)
            names[c.str] = (names[c.str] || 0) + 1;
          return names;
        }, {});
      }
    };
    exports2._Code = _Code;
    exports2.nil = new _Code("");
    function _(strs, ...args) {
      const code = [strs[0]];
      let i = 0;
      while (i < args.length) {
        addCodeArg(code, args[i]);
        code.push(strs[++i]);
      }
      return new _Code(code);
    }
    exports2._ = _;
    var plus = new _Code("+");
    function str(strs, ...args) {
      const expr = [safeStringify(strs[0])];
      let i = 0;
      while (i < args.length) {
        expr.push(plus);
        addCodeArg(expr, args[i]);
        expr.push(plus, safeStringify(strs[++i]));
      }
      optimize(expr);
      return new _Code(expr);
    }
    exports2.str = str;
    function addCodeArg(code, arg) {
      if (arg instanceof _Code)
        code.push(...arg._items);
      else if (arg instanceof Name)
        code.push(arg);
      else
        code.push(interpolate(arg));
    }
    exports2.addCodeArg = addCodeArg;
    function optimize(expr) {
      let i = 1;
      while (i < expr.length - 1) {
        if (expr[i] === plus) {
          const res = mergeExprItems(expr[i - 1], expr[i + 1]);
          if (res !== void 0) {
            expr.splice(i - 1, 3, res);
            continue;
          }
          expr[i++] = "+";
        }
        i++;
      }
    }
    function mergeExprItems(a, b) {
      if (b === '""')
        return a;
      if (a === '""')
        return b;
      if (typeof a == "string") {
        if (b instanceof Name || a[a.length - 1] !== '"')
          return;
        if (typeof b != "string")
          return `${a.slice(0, -1)}${b}"`;
        if (b[0] === '"')
          return a.slice(0, -1) + b.slice(1);
        return;
      }
      if (typeof b == "string" && b[0] === '"' && !(a instanceof Name))
        return `"${a}${b.slice(1)}`;
      return;
    }
    function strConcat(c1, c2) {
      return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str`${c1}${c2}`;
    }
    exports2.strConcat = strConcat;
    function interpolate(x) {
      return typeof x == "number" || typeof x == "boolean" || x === null ? x : safeStringify(Array.isArray(x) ? x.join(",") : x);
    }
    function stringify(x) {
      return new _Code(safeStringify(x));
    }
    exports2.stringify = stringify;
    function safeStringify(x) {
      return JSON.stringify(x).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    }
    exports2.safeStringify = safeStringify;
    function getProperty(key) {
      return typeof key == "string" && exports2.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
    }
    exports2.getProperty = getProperty;
    function getEsmExportName(key) {
      if (typeof key == "string" && exports2.IDENTIFIER.test(key)) {
        return new _Code(`${key}`);
      }
      throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
    }
    exports2.getEsmExportName = getEsmExportName;
    function regexpCode(rx) {
      return new _Code(rx.toString());
    }
    exports2.regexpCode = regexpCode;
  }
});

// node_modules/ajv/dist/compile/codegen/scope.js
var require_scope = __commonJS({
  "node_modules/ajv/dist/compile/codegen/scope.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ValueScope = exports2.ValueScopeName = exports2.Scope = exports2.varKinds = exports2.UsedValueState = void 0;
    var code_1 = require_code();
    var ValueError = class extends Error {
      constructor(name) {
        super(`CodeGen: "code" for ${name} not defined`);
        this.value = name.value;
      }
    };
    var UsedValueState;
    (function(UsedValueState2) {
      UsedValueState2[UsedValueState2["Started"] = 0] = "Started";
      UsedValueState2[UsedValueState2["Completed"] = 1] = "Completed";
    })(UsedValueState || (exports2.UsedValueState = UsedValueState = {}));
    exports2.varKinds = {
      const: new code_1.Name("const"),
      let: new code_1.Name("let"),
      var: new code_1.Name("var")
    };
    var Scope = class {
      constructor({ prefixes, parent } = {}) {
        this._names = {};
        this._prefixes = prefixes;
        this._parent = parent;
      }
      toName(nameOrPrefix) {
        return nameOrPrefix instanceof code_1.Name ? nameOrPrefix : this.name(nameOrPrefix);
      }
      name(prefix) {
        return new code_1.Name(this._newName(prefix));
      }
      _newName(prefix) {
        const ng = this._names[prefix] || this._nameGroup(prefix);
        return `${prefix}${ng.index++}`;
      }
      _nameGroup(prefix) {
        var _a, _b;
        if (((_b = (_a = this._parent) === null || _a === void 0 ? void 0 : _a._prefixes) === null || _b === void 0 ? void 0 : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix)) {
          throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
        }
        return this._names[prefix] = { prefix, index: 0 };
      }
    };
    exports2.Scope = Scope;
    var ValueScopeName = class extends code_1.Name {
      constructor(prefix, nameStr) {
        super(nameStr);
        this.prefix = prefix;
      }
      setValue(value2, { property, itemIndex }) {
        this.value = value2;
        this.scopePath = (0, code_1._)`.${new code_1.Name(property)}[${itemIndex}]`;
      }
    };
    exports2.ValueScopeName = ValueScopeName;
    var line = (0, code_1._)`\n`;
    var ValueScope = class extends Scope {
      constructor(opts) {
        super(opts);
        this._values = {};
        this._scope = opts.scope;
        this.opts = { ...opts, _n: opts.lines ? line : code_1.nil };
      }
      get() {
        return this._scope;
      }
      name(prefix) {
        return new ValueScopeName(prefix, this._newName(prefix));
      }
      value(nameOrPrefix, value2) {
        var _a;
        if (value2.ref === void 0)
          throw new Error("CodeGen: ref must be passed in value");
        const name = this.toName(nameOrPrefix);
        const { prefix } = name;
        const valueKey = (_a = value2.key) !== null && _a !== void 0 ? _a : value2.ref;
        let vs = this._values[prefix];
        if (vs) {
          const _name = vs.get(valueKey);
          if (_name)
            return _name;
        } else {
          vs = this._values[prefix] = /* @__PURE__ */ new Map();
        }
        vs.set(valueKey, name);
        const s = this._scope[prefix] || (this._scope[prefix] = []);
        const itemIndex = s.length;
        s[itemIndex] = value2.ref;
        name.setValue(value2, { property: prefix, itemIndex });
        return name;
      }
      getValue(prefix, keyOrRef) {
        const vs = this._values[prefix];
        if (!vs)
          return;
        return vs.get(keyOrRef);
      }
      scopeRefs(scopeName, values = this._values) {
        return this._reduceValues(values, (name) => {
          if (name.scopePath === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return (0, code_1._)`${scopeName}${name.scopePath}`;
        });
      }
      scopeCode(values = this._values, usedValues, getCode) {
        return this._reduceValues(values, (name) => {
          if (name.value === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return name.value.code;
        }, usedValues, getCode);
      }
      _reduceValues(values, valueCode, usedValues = {}, getCode) {
        let code = code_1.nil;
        for (const prefix in values) {
          const vs = values[prefix];
          if (!vs)
            continue;
          const nameSet = usedValues[prefix] = usedValues[prefix] || /* @__PURE__ */ new Map();
          vs.forEach((name) => {
            if (nameSet.has(name))
              return;
            nameSet.set(name, UsedValueState.Started);
            let c = valueCode(name);
            if (c) {
              const def = this.opts.es5 ? exports2.varKinds.var : exports2.varKinds.const;
              code = (0, code_1._)`${code}${def} ${name} = ${c};${this.opts._n}`;
            } else if (c = getCode === null || getCode === void 0 ? void 0 : getCode(name)) {
              code = (0, code_1._)`${code}${c}${this.opts._n}`;
            } else {
              throw new ValueError(name);
            }
            nameSet.set(name, UsedValueState.Completed);
          });
        }
        return code;
      }
    };
    exports2.ValueScope = ValueScope;
  }
});

// node_modules/ajv/dist/compile/codegen/index.js
var require_codegen = __commonJS({
  "node_modules/ajv/dist/compile/codegen/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.or = exports2.and = exports2.not = exports2.CodeGen = exports2.operators = exports2.varKinds = exports2.ValueScopeName = exports2.ValueScope = exports2.Scope = exports2.Name = exports2.regexpCode = exports2.stringify = exports2.getProperty = exports2.nil = exports2.strConcat = exports2.str = exports2._ = void 0;
    var code_1 = require_code();
    var scope_1 = require_scope();
    var code_2 = require_code();
    Object.defineProperty(exports2, "_", { enumerable: true, get: function() {
      return code_2._;
    } });
    Object.defineProperty(exports2, "str", { enumerable: true, get: function() {
      return code_2.str;
    } });
    Object.defineProperty(exports2, "strConcat", { enumerable: true, get: function() {
      return code_2.strConcat;
    } });
    Object.defineProperty(exports2, "nil", { enumerable: true, get: function() {
      return code_2.nil;
    } });
    Object.defineProperty(exports2, "getProperty", { enumerable: true, get: function() {
      return code_2.getProperty;
    } });
    Object.defineProperty(exports2, "stringify", { enumerable: true, get: function() {
      return code_2.stringify;
    } });
    Object.defineProperty(exports2, "regexpCode", { enumerable: true, get: function() {
      return code_2.regexpCode;
    } });
    Object.defineProperty(exports2, "Name", { enumerable: true, get: function() {
      return code_2.Name;
    } });
    var scope_2 = require_scope();
    Object.defineProperty(exports2, "Scope", { enumerable: true, get: function() {
      return scope_2.Scope;
    } });
    Object.defineProperty(exports2, "ValueScope", { enumerable: true, get: function() {
      return scope_2.ValueScope;
    } });
    Object.defineProperty(exports2, "ValueScopeName", { enumerable: true, get: function() {
      return scope_2.ValueScopeName;
    } });
    Object.defineProperty(exports2, "varKinds", { enumerable: true, get: function() {
      return scope_2.varKinds;
    } });
    exports2.operators = {
      GT: new code_1._Code(">"),
      GTE: new code_1._Code(">="),
      LT: new code_1._Code("<"),
      LTE: new code_1._Code("<="),
      EQ: new code_1._Code("==="),
      NEQ: new code_1._Code("!=="),
      NOT: new code_1._Code("!"),
      OR: new code_1._Code("||"),
      AND: new code_1._Code("&&"),
      ADD: new code_1._Code("+")
    };
    var Node = class {
      optimizeNodes() {
        return this;
      }
      optimizeNames(_names, _constants) {
        return this;
      }
    };
    var Def = class extends Node {
      constructor(varKind, name, rhs) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.rhs = rhs;
      }
      render({ es5, _n }) {
        const varKind = es5 ? scope_1.varKinds.var : this.varKind;
        const rhs = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
        return `${varKind} ${this.name}${rhs};` + _n;
      }
      optimizeNames(names, constants) {
        if (!names[this.name.str])
          return;
        if (this.rhs)
          this.rhs = optimizeExpr(this.rhs, names, constants);
        return this;
      }
      get names() {
        return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
      }
    };
    var Assign = class extends Node {
      constructor(lhs, rhs, sideEffects) {
        super();
        this.lhs = lhs;
        this.rhs = rhs;
        this.sideEffects = sideEffects;
      }
      render({ _n }) {
        return `${this.lhs} = ${this.rhs};` + _n;
      }
      optimizeNames(names, constants) {
        if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects)
          return;
        this.rhs = optimizeExpr(this.rhs, names, constants);
        return this;
      }
      get names() {
        const names = this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names };
        return addExprNames(names, this.rhs);
      }
    };
    var AssignOp = class extends Assign {
      constructor(lhs, op, rhs, sideEffects) {
        super(lhs, rhs, sideEffects);
        this.op = op;
      }
      render({ _n }) {
        return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
      }
    };
    var Label = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        return `${this.label}:` + _n;
      }
    };
    var Break = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        const label = this.label ? ` ${this.label}` : "";
        return `break${label};` + _n;
      }
    };
    var Throw = class extends Node {
      constructor(error) {
        super();
        this.error = error;
      }
      render({ _n }) {
        return `throw ${this.error};` + _n;
      }
      get names() {
        return this.error.names;
      }
    };
    var AnyCode = class extends Node {
      constructor(code) {
        super();
        this.code = code;
      }
      render({ _n }) {
        return `${this.code};` + _n;
      }
      optimizeNodes() {
        return `${this.code}` ? this : void 0;
      }
      optimizeNames(names, constants) {
        this.code = optimizeExpr(this.code, names, constants);
        return this;
      }
      get names() {
        return this.code instanceof code_1._CodeOrName ? this.code.names : {};
      }
    };
    var ParentNode = class extends Node {
      constructor(nodes = []) {
        super();
        this.nodes = nodes;
      }
      render(opts) {
        return this.nodes.reduce((code, n) => code + n.render(opts), "");
      }
      optimizeNodes() {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i].optimizeNodes();
          if (Array.isArray(n))
            nodes.splice(i, 1, ...n);
          else if (n)
            nodes[i] = n;
          else
            nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      optimizeNames(names, constants) {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i];
          if (n.optimizeNames(names, constants))
            continue;
          subtractNames(names, n.names);
          nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      get names() {
        return this.nodes.reduce((names, n) => addNames(names, n.names), {});
      }
    };
    var BlockNode = class extends ParentNode {
      render(opts) {
        return "{" + opts._n + super.render(opts) + "}" + opts._n;
      }
    };
    var Root = class extends ParentNode {
    };
    var Else = class extends BlockNode {
    };
    Else.kind = "else";
    var If = class _If extends BlockNode {
      constructor(condition, nodes) {
        super(nodes);
        this.condition = condition;
      }
      render(opts) {
        let code = `if(${this.condition})` + super.render(opts);
        if (this.else)
          code += "else " + this.else.render(opts);
        return code;
      }
      optimizeNodes() {
        super.optimizeNodes();
        const cond = this.condition;
        if (cond === true)
          return this.nodes;
        let e = this.else;
        if (e) {
          const ns = e.optimizeNodes();
          e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
        }
        if (e) {
          if (cond === false)
            return e instanceof _If ? e : e.nodes;
          if (this.nodes.length)
            return this;
          return new _If(not(cond), e instanceof _If ? [e] : e.nodes);
        }
        if (cond === false || !this.nodes.length)
          return void 0;
        return this;
      }
      optimizeNames(names, constants) {
        var _a;
        this.else = (_a = this.else) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants);
        if (!(super.optimizeNames(names, constants) || this.else))
          return;
        this.condition = optimizeExpr(this.condition, names, constants);
        return this;
      }
      get names() {
        const names = super.names;
        addExprNames(names, this.condition);
        if (this.else)
          addNames(names, this.else.names);
        return names;
      }
    };
    If.kind = "if";
    var For = class extends BlockNode {
    };
    For.kind = "for";
    var ForLoop = class extends For {
      constructor(iteration) {
        super();
        this.iteration = iteration;
      }
      render(opts) {
        return `for(${this.iteration})` + super.render(opts);
      }
      optimizeNames(names, constants) {
        if (!super.optimizeNames(names, constants))
          return;
        this.iteration = optimizeExpr(this.iteration, names, constants);
        return this;
      }
      get names() {
        return addNames(super.names, this.iteration.names);
      }
    };
    var ForRange = class extends For {
      constructor(varKind, name, from, to) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.from = from;
        this.to = to;
      }
      render(opts) {
        const varKind = opts.es5 ? scope_1.varKinds.var : this.varKind;
        const { name, from, to } = this;
        return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
      }
      get names() {
        const names = addExprNames(super.names, this.from);
        return addExprNames(names, this.to);
      }
    };
    var ForIter = class extends For {
      constructor(loop, varKind, name, iterable) {
        super();
        this.loop = loop;
        this.varKind = varKind;
        this.name = name;
        this.iterable = iterable;
      }
      render(opts) {
        return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
      }
      optimizeNames(names, constants) {
        if (!super.optimizeNames(names, constants))
          return;
        this.iterable = optimizeExpr(this.iterable, names, constants);
        return this;
      }
      get names() {
        return addNames(super.names, this.iterable.names);
      }
    };
    var Func = class extends BlockNode {
      constructor(name, args, async) {
        super();
        this.name = name;
        this.args = args;
        this.async = async;
      }
      render(opts) {
        const _async = this.async ? "async " : "";
        return `${_async}function ${this.name}(${this.args})` + super.render(opts);
      }
    };
    Func.kind = "func";
    var Return = class extends ParentNode {
      render(opts) {
        return "return " + super.render(opts);
      }
    };
    Return.kind = "return";
    var Try = class extends BlockNode {
      render(opts) {
        let code = "try" + super.render(opts);
        if (this.catch)
          code += this.catch.render(opts);
        if (this.finally)
          code += this.finally.render(opts);
        return code;
      }
      optimizeNodes() {
        var _a, _b;
        super.optimizeNodes();
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNodes();
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNodes();
        return this;
      }
      optimizeNames(names, constants) {
        var _a, _b;
        super.optimizeNames(names, constants);
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants);
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNames(names, constants);
        return this;
      }
      get names() {
        const names = super.names;
        if (this.catch)
          addNames(names, this.catch.names);
        if (this.finally)
          addNames(names, this.finally.names);
        return names;
      }
    };
    var Catch = class extends BlockNode {
      constructor(error) {
        super();
        this.error = error;
      }
      render(opts) {
        return `catch(${this.error})` + super.render(opts);
      }
    };
    Catch.kind = "catch";
    var Finally = class extends BlockNode {
      render(opts) {
        return "finally" + super.render(opts);
      }
    };
    Finally.kind = "finally";
    var CodeGen = class {
      constructor(extScope, opts = {}) {
        this._values = {};
        this._blockStarts = [];
        this._constants = {};
        this.opts = { ...opts, _n: opts.lines ? "\n" : "" };
        this._extScope = extScope;
        this._scope = new scope_1.Scope({ parent: extScope });
        this._nodes = [new Root()];
      }
      toString() {
        return this._root.render(this.opts);
      }
      // returns unique name in the internal scope
      name(prefix) {
        return this._scope.name(prefix);
      }
      // reserves unique name in the external scope
      scopeName(prefix) {
        return this._extScope.name(prefix);
      }
      // reserves unique name in the external scope and assigns value to it
      scopeValue(prefixOrName, value2) {
        const name = this._extScope.value(prefixOrName, value2);
        const vs = this._values[name.prefix] || (this._values[name.prefix] = /* @__PURE__ */ new Set());
        vs.add(name);
        return name;
      }
      getScopeValue(prefix, keyOrRef) {
        return this._extScope.getValue(prefix, keyOrRef);
      }
      // return code that assigns values in the external scope to the names that are used internally
      // (same names that were returned by gen.scopeName or gen.scopeValue)
      scopeRefs(scopeName) {
        return this._extScope.scopeRefs(scopeName, this._values);
      }
      scopeCode() {
        return this._extScope.scopeCode(this._values);
      }
      _def(varKind, nameOrPrefix, rhs, constant) {
        const name = this._scope.toName(nameOrPrefix);
        if (rhs !== void 0 && constant)
          this._constants[name.str] = rhs;
        this._leafNode(new Def(varKind, name, rhs));
        return name;
      }
      // `const` declaration (`var` in es5 mode)
      const(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
      }
      // `let` declaration with optional assignment (`var` in es5 mode)
      let(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
      }
      // `var` declaration with optional assignment
      var(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
      }
      // assignment code
      assign(lhs, rhs, sideEffects) {
        return this._leafNode(new Assign(lhs, rhs, sideEffects));
      }
      // `+=` code
      add(lhs, rhs) {
        return this._leafNode(new AssignOp(lhs, exports2.operators.ADD, rhs));
      }
      // appends passed SafeExpr to code or executes Block
      code(c) {
        if (typeof c == "function")
          c();
        else if (c !== code_1.nil)
          this._leafNode(new AnyCode(c));
        return this;
      }
      // returns code for object literal for the passed argument list of key-value pairs
      object(...keyValues) {
        const code = ["{"];
        for (const [key, value2] of keyValues) {
          if (code.length > 1)
            code.push(",");
          code.push(key);
          if (key !== value2 || this.opts.es5) {
            code.push(":");
            (0, code_1.addCodeArg)(code, value2);
          }
        }
        code.push("}");
        return new code_1._Code(code);
      }
      // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
      if(condition, thenBody, elseBody) {
        this._blockNode(new If(condition));
        if (thenBody && elseBody) {
          this.code(thenBody).else().code(elseBody).endIf();
        } else if (thenBody) {
          this.code(thenBody).endIf();
        } else if (elseBody) {
          throw new Error('CodeGen: "else" body without "then" body');
        }
        return this;
      }
      // `else if` clause - invalid without `if` or after `else` clauses
      elseIf(condition) {
        return this._elseNode(new If(condition));
      }
      // `else` clause - only valid after `if` or `else if` clauses
      else() {
        return this._elseNode(new Else());
      }
      // end `if` statement (needed if gen.if was used only with condition)
      endIf() {
        return this._endBlockNode(If, Else);
      }
      _for(node, forBody) {
        this._blockNode(node);
        if (forBody)
          this.code(forBody).endFor();
        return this;
      }
      // a generic `for` clause (or statement if `forBody` is passed)
      for(iteration, forBody) {
        return this._for(new ForLoop(iteration), forBody);
      }
      // `for` statement for a range of values
      forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
      }
      // `for-of` statement (in es5 mode replace with a normal for loop)
      forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
        const name = this._scope.toName(nameOrPrefix);
        if (this.opts.es5) {
          const arr = iterable instanceof code_1.Name ? iterable : this.var("_arr", iterable);
          return this.forRange("_i", 0, (0, code_1._)`${arr}.length`, (i) => {
            this.var(name, (0, code_1._)`${arr}[${i}]`);
            forBody(name);
          });
        }
        return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
      }
      // `for-in` statement.
      // With option `ownProperties` replaced with a `for-of` loop for object keys
      forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
        if (this.opts.ownProperties) {
          return this.forOf(nameOrPrefix, (0, code_1._)`Object.keys(${obj})`, forBody);
        }
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
      }
      // end `for` loop
      endFor() {
        return this._endBlockNode(For);
      }
      // `label` statement
      label(label) {
        return this._leafNode(new Label(label));
      }
      // `break` statement
      break(label) {
        return this._leafNode(new Break(label));
      }
      // `return` statement
      return(value2) {
        const node = new Return();
        this._blockNode(node);
        this.code(value2);
        if (node.nodes.length !== 1)
          throw new Error('CodeGen: "return" should have one node');
        return this._endBlockNode(Return);
      }
      // `try` statement
      try(tryBody, catchCode, finallyCode) {
        if (!catchCode && !finallyCode)
          throw new Error('CodeGen: "try" without "catch" and "finally"');
        const node = new Try();
        this._blockNode(node);
        this.code(tryBody);
        if (catchCode) {
          const error = this.name("e");
          this._currNode = node.catch = new Catch(error);
          catchCode(error);
        }
        if (finallyCode) {
          this._currNode = node.finally = new Finally();
          this.code(finallyCode);
        }
        return this._endBlockNode(Catch, Finally);
      }
      // `throw` statement
      throw(error) {
        return this._leafNode(new Throw(error));
      }
      // start self-balancing block
      block(body, nodeCount) {
        this._blockStarts.push(this._nodes.length);
        if (body)
          this.code(body).endBlock(nodeCount);
        return this;
      }
      // end the current self-balancing block
      endBlock(nodeCount) {
        const len = this._blockStarts.pop();
        if (len === void 0)
          throw new Error("CodeGen: not in self-balancing block");
        const toClose = this._nodes.length - len;
        if (toClose < 0 || nodeCount !== void 0 && toClose !== nodeCount) {
          throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
        }
        this._nodes.length = len;
        return this;
      }
      // `function` heading (or definition if funcBody is passed)
      func(name, args = code_1.nil, async, funcBody) {
        this._blockNode(new Func(name, args, async));
        if (funcBody)
          this.code(funcBody).endFunc();
        return this;
      }
      // end function definition
      endFunc() {
        return this._endBlockNode(Func);
      }
      optimize(n = 1) {
        while (n-- > 0) {
          this._root.optimizeNodes();
          this._root.optimizeNames(this._root.names, this._constants);
        }
      }
      _leafNode(node) {
        this._currNode.nodes.push(node);
        return this;
      }
      _blockNode(node) {
        this._currNode.nodes.push(node);
        this._nodes.push(node);
      }
      _endBlockNode(N1, N2) {
        const n = this._currNode;
        if (n instanceof N1 || N2 && n instanceof N2) {
          this._nodes.pop();
          return this;
        }
        throw new Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
      }
      _elseNode(node) {
        const n = this._currNode;
        if (!(n instanceof If)) {
          throw new Error('CodeGen: "else" without "if"');
        }
        this._currNode = n.else = node;
        return this;
      }
      get _root() {
        return this._nodes[0];
      }
      get _currNode() {
        const ns = this._nodes;
        return ns[ns.length - 1];
      }
      set _currNode(node) {
        const ns = this._nodes;
        ns[ns.length - 1] = node;
      }
    };
    exports2.CodeGen = CodeGen;
    function addNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) + (from[n] || 0);
      return names;
    }
    function addExprNames(names, from) {
      return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
    }
    function optimizeExpr(expr, names, constants) {
      if (expr instanceof code_1.Name)
        return replaceName(expr);
      if (!canOptimize(expr))
        return expr;
      return new code_1._Code(expr._items.reduce((items, c) => {
        if (c instanceof code_1.Name)
          c = replaceName(c);
        if (c instanceof code_1._Code)
          items.push(...c._items);
        else
          items.push(c);
        return items;
      }, []));
      function replaceName(n) {
        const c = constants[n.str];
        if (c === void 0 || names[n.str] !== 1)
          return n;
        delete names[n.str];
        return c;
      }
      function canOptimize(e) {
        return e instanceof code_1._Code && e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants[c.str] !== void 0);
      }
    }
    function subtractNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) - (from[n] || 0);
    }
    function not(x) {
      return typeof x == "boolean" || typeof x == "number" || x === null ? !x : (0, code_1._)`!${par(x)}`;
    }
    exports2.not = not;
    var andCode = mappend(exports2.operators.AND);
    function and(...args) {
      return args.reduce(andCode);
    }
    exports2.and = and;
    var orCode = mappend(exports2.operators.OR);
    function or(...args) {
      return args.reduce(orCode);
    }
    exports2.or = or;
    function mappend(op) {
      return (x, y) => x === code_1.nil ? y : y === code_1.nil ? x : (0, code_1._)`${par(x)} ${op} ${par(y)}`;
    }
    function par(x) {
      return x instanceof code_1.Name ? x : (0, code_1._)`(${x})`;
    }
  }
});

// node_modules/ajv/dist/compile/util.js
var require_util = __commonJS({
  "node_modules/ajv/dist/compile/util.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.checkStrictMode = exports2.getErrorPath = exports2.Type = exports2.useFunc = exports2.setEvaluated = exports2.evaluatedPropsToName = exports2.mergeEvaluated = exports2.eachItem = exports2.unescapeJsonPointer = exports2.escapeJsonPointer = exports2.escapeFragment = exports2.unescapeFragment = exports2.schemaRefOrVal = exports2.schemaHasRulesButRef = exports2.schemaHasRules = exports2.checkUnknownRules = exports2.alwaysValidSchema = exports2.toHash = void 0;
    var codegen_1 = require_codegen();
    var code_1 = require_code();
    function toHash(arr) {
      const hash = {};
      for (const item of arr)
        hash[item] = true;
      return hash;
    }
    exports2.toHash = toHash;
    function alwaysValidSchema(it, schema) {
      if (typeof schema == "boolean")
        return schema;
      if (Object.keys(schema).length === 0)
        return true;
      checkUnknownRules(it, schema);
      return !schemaHasRules(schema, it.self.RULES.all);
    }
    exports2.alwaysValidSchema = alwaysValidSchema;
    function checkUnknownRules(it, schema = it.schema) {
      const { opts, self } = it;
      if (!opts.strictSchema)
        return;
      if (typeof schema === "boolean")
        return;
      const rules = self.RULES.keywords;
      for (const key in schema) {
        if (!rules[key])
          checkStrictMode(it, `unknown keyword: "${key}"`);
      }
    }
    exports2.checkUnknownRules = checkUnknownRules;
    function schemaHasRules(schema, rules) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (rules[key])
          return true;
      return false;
    }
    exports2.schemaHasRules = schemaHasRules;
    function schemaHasRulesButRef(schema, RULES) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (key !== "$ref" && RULES.all[key])
          return true;
      return false;
    }
    exports2.schemaHasRulesButRef = schemaHasRulesButRef;
    function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
      if (!$data) {
        if (typeof schema == "number" || typeof schema == "boolean")
          return schema;
        if (typeof schema == "string")
          return (0, codegen_1._)`${schema}`;
      }
      return (0, codegen_1._)`${topSchemaRef}${schemaPath}${(0, codegen_1.getProperty)(keyword)}`;
    }
    exports2.schemaRefOrVal = schemaRefOrVal;
    function unescapeFragment(str) {
      return unescapeJsonPointer(decodeURIComponent(str));
    }
    exports2.unescapeFragment = unescapeFragment;
    function escapeFragment(str) {
      return encodeURIComponent(escapeJsonPointer(str));
    }
    exports2.escapeFragment = escapeFragment;
    function escapeJsonPointer(str) {
      if (typeof str == "number")
        return `${str}`;
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
    exports2.escapeJsonPointer = escapeJsonPointer;
    function unescapeJsonPointer(str) {
      return str.replace(/~1/g, "/").replace(/~0/g, "~");
    }
    exports2.unescapeJsonPointer = unescapeJsonPointer;
    function eachItem(xs, f) {
      if (Array.isArray(xs)) {
        for (const x of xs)
          f(x);
      } else {
        f(xs);
      }
    }
    exports2.eachItem = eachItem;
    function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues, resultToName }) {
      return (gen, from, to, toName) => {
        const res = to === void 0 ? from : to instanceof codegen_1.Name ? (from instanceof codegen_1.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1.Name ? (mergeToName(gen, to, from), from) : mergeValues(from, to);
        return toName === codegen_1.Name && !(res instanceof codegen_1.Name) ? resultToName(gen, res) : res;
      };
    }
    exports2.mergeEvaluated = {
      props: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => {
          gen.if((0, codegen_1._)`${from} === true`, () => gen.assign(to, true), () => gen.assign(to, (0, codegen_1._)`${to} || {}`).code((0, codegen_1._)`Object.assign(${to}, ${from})`));
        }),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => {
          if (from === true) {
            gen.assign(to, true);
          } else {
            gen.assign(to, (0, codegen_1._)`${to} || {}`);
            setEvaluated(gen, to, from);
          }
        }),
        mergeValues: (from, to) => from === true ? true : { ...from, ...to },
        resultToName: evaluatedPropsToName
      }),
      items: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => gen.assign(to, (0, codegen_1._)`${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => gen.assign(to, from === true ? true : (0, codegen_1._)`${to} > ${from} ? ${to} : ${from}`)),
        mergeValues: (from, to) => from === true ? true : Math.max(from, to),
        resultToName: (gen, items) => gen.var("items", items)
      })
    };
    function evaluatedPropsToName(gen, ps) {
      if (ps === true)
        return gen.var("props", true);
      const props = gen.var("props", (0, codegen_1._)`{}`);
      if (ps !== void 0)
        setEvaluated(gen, props, ps);
      return props;
    }
    exports2.evaluatedPropsToName = evaluatedPropsToName;
    function setEvaluated(gen, props, ps) {
      Object.keys(ps).forEach((p) => gen.assign((0, codegen_1._)`${props}${(0, codegen_1.getProperty)(p)}`, true));
    }
    exports2.setEvaluated = setEvaluated;
    var snippets = {};
    function useFunc(gen, f) {
      return gen.scopeValue("func", {
        ref: f,
        code: snippets[f.code] || (snippets[f.code] = new code_1._Code(f.code))
      });
    }
    exports2.useFunc = useFunc;
    var Type;
    (function(Type2) {
      Type2[Type2["Num"] = 0] = "Num";
      Type2[Type2["Str"] = 1] = "Str";
    })(Type || (exports2.Type = Type = {}));
    function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
      if (dataProp instanceof codegen_1.Name) {
        const isNumber = dataPropType === Type.Num;
        return jsPropertySyntax ? isNumber ? (0, codegen_1._)`"[" + ${dataProp} + "]"` : (0, codegen_1._)`"['" + ${dataProp} + "']"` : isNumber ? (0, codegen_1._)`"/" + ${dataProp}` : (0, codegen_1._)`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
      }
      return jsPropertySyntax ? (0, codegen_1.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
    }
    exports2.getErrorPath = getErrorPath;
    function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
      if (!mode)
        return;
      msg = `strict mode: ${msg}`;
      if (mode === true)
        throw new Error(msg);
      it.self.logger.warn(msg);
    }
    exports2.checkStrictMode = checkStrictMode;
  }
});

// node_modules/ajv/dist/compile/names.js
var require_names = __commonJS({
  "node_modules/ajv/dist/compile/names.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var names = {
      // validation function arguments
      data: new codegen_1.Name("data"),
      // data passed to validation function
      // args passed from referencing schema
      valCxt: new codegen_1.Name("valCxt"),
      // validation/data context - should not be used directly, it is destructured to the names below
      instancePath: new codegen_1.Name("instancePath"),
      parentData: new codegen_1.Name("parentData"),
      parentDataProperty: new codegen_1.Name("parentDataProperty"),
      rootData: new codegen_1.Name("rootData"),
      // root data - same as the data passed to the first/top validation function
      dynamicAnchors: new codegen_1.Name("dynamicAnchors"),
      // used to support recursiveRef and dynamicRef
      // function scoped variables
      vErrors: new codegen_1.Name("vErrors"),
      // null or array of validation errors
      errors: new codegen_1.Name("errors"),
      // counter of validation errors
      this: new codegen_1.Name("this"),
      // "globals"
      self: new codegen_1.Name("self"),
      scope: new codegen_1.Name("scope"),
      // JTD serialize/parse name for JSON string and position
      json: new codegen_1.Name("json"),
      jsonPos: new codegen_1.Name("jsonPos"),
      jsonLen: new codegen_1.Name("jsonLen"),
      jsonPart: new codegen_1.Name("jsonPart")
    };
    exports2.default = names;
  }
});

// node_modules/ajv/dist/compile/errors.js
var require_errors = __commonJS({
  "node_modules/ajv/dist/compile/errors.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.extendErrors = exports2.resetErrorsCount = exports2.reportExtraError = exports2.reportError = exports2.keyword$DataError = exports2.keywordError = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    exports2.keywordError = {
      message: ({ keyword }) => (0, codegen_1.str)`must pass "${keyword}" keyword validation`
    };
    exports2.keyword$DataError = {
      message: ({ keyword, schemaType }) => schemaType ? (0, codegen_1.str)`"${keyword}" keyword must be ${schemaType} ($data)` : (0, codegen_1.str)`"${keyword}" keyword is invalid ($data)`
    };
    function reportError2(cxt, error = exports2.keywordError, errorPaths, overrideAllErrors) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error, errorPaths);
      if (overrideAllErrors !== null && overrideAllErrors !== void 0 ? overrideAllErrors : compositeRule || allErrors) {
        addError(gen, errObj);
      } else {
        returnErrors(it, (0, codegen_1._)`[${errObj}]`);
      }
    }
    exports2.reportError = reportError2;
    function reportExtraError(cxt, error = exports2.keywordError, errorPaths) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error, errorPaths);
      addError(gen, errObj);
      if (!(compositeRule || allErrors)) {
        returnErrors(it, names_1.default.vErrors);
      }
    }
    exports2.reportExtraError = reportExtraError;
    function resetErrorsCount(gen, errsCount) {
      gen.assign(names_1.default.errors, errsCount);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_1._)`${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
    }
    exports2.resetErrorsCount = resetErrorsCount;
    function extendErrors({ gen, keyword, schemaValue, data, errsCount, it }) {
      if (errsCount === void 0)
        throw new Error("ajv implementation error");
      const err = gen.name("err");
      gen.forRange("i", errsCount, names_1.default.errors, (i) => {
        gen.const(err, (0, codegen_1._)`${names_1.default.vErrors}[${i}]`);
        gen.if((0, codegen_1._)`${err}.instancePath === undefined`, () => gen.assign((0, codegen_1._)`${err}.instancePath`, (0, codegen_1.strConcat)(names_1.default.instancePath, it.errorPath)));
        gen.assign((0, codegen_1._)`${err}.schemaPath`, (0, codegen_1.str)`${it.errSchemaPath}/${keyword}`);
        if (it.opts.verbose) {
          gen.assign((0, codegen_1._)`${err}.schema`, schemaValue);
          gen.assign((0, codegen_1._)`${err}.data`, data);
        }
      });
    }
    exports2.extendErrors = extendErrors;
    function addError(gen, errObj) {
      const err = gen.const("err", errObj);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} === null`, () => gen.assign(names_1.default.vErrors, (0, codegen_1._)`[${err}]`), (0, codegen_1._)`${names_1.default.vErrors}.push(${err})`);
      gen.code((0, codegen_1._)`${names_1.default.errors}++`);
    }
    function returnErrors(it, errs) {
      const { gen, validateName, schemaEnv } = it;
      if (schemaEnv.$async) {
        gen.throw((0, codegen_1._)`new ${it.ValidationError}(${errs})`);
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, errs);
        gen.return(false);
      }
    }
    var E = {
      keyword: new codegen_1.Name("keyword"),
      schemaPath: new codegen_1.Name("schemaPath"),
      // also used in JTD errors
      params: new codegen_1.Name("params"),
      propertyName: new codegen_1.Name("propertyName"),
      message: new codegen_1.Name("message"),
      schema: new codegen_1.Name("schema"),
      parentSchema: new codegen_1.Name("parentSchema")
    };
    function errorObjectCode(cxt, error, errorPaths) {
      const { createErrors } = cxt.it;
      if (createErrors === false)
        return (0, codegen_1._)`{}`;
      return errorObject(cxt, error, errorPaths);
    }
    function errorObject(cxt, error, errorPaths = {}) {
      const { gen, it } = cxt;
      const keyValues = [
        errorInstancePath(it, errorPaths),
        errorSchemaPath(cxt, errorPaths)
      ];
      extraErrorProps(cxt, error, keyValues);
      return gen.object(...keyValues);
    }
    function errorInstancePath({ errorPath }, { instancePath }) {
      const instPath = instancePath ? (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(instancePath, util_1.Type.Str)}` : errorPath;
      return [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, instPath)];
    }
    function errorSchemaPath({ keyword, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
      let schPath = parentSchema ? errSchemaPath : (0, codegen_1.str)`${errSchemaPath}/${keyword}`;
      if (schemaPath) {
        schPath = (0, codegen_1.str)`${schPath}${(0, util_1.getErrorPath)(schemaPath, util_1.Type.Str)}`;
      }
      return [E.schemaPath, schPath];
    }
    function extraErrorProps(cxt, { params, message }, keyValues) {
      const { keyword, data, schemaValue, it } = cxt;
      const { opts, propertyName, topSchemaRef, schemaPath } = it;
      keyValues.push([E.keyword, keyword], [E.params, typeof params == "function" ? params(cxt) : params || (0, codegen_1._)`{}`]);
      if (opts.messages) {
        keyValues.push([E.message, typeof message == "function" ? message(cxt) : message]);
      }
      if (opts.verbose) {
        keyValues.push([E.schema, schemaValue], [E.parentSchema, (0, codegen_1._)`${topSchemaRef}${schemaPath}`], [names_1.default.data, data]);
      }
      if (propertyName)
        keyValues.push([E.propertyName, propertyName]);
    }
  }
});

// node_modules/ajv/dist/compile/validate/boolSchema.js
var require_boolSchema = __commonJS({
  "node_modules/ajv/dist/compile/validate/boolSchema.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.boolOrEmptySchema = exports2.topBoolOrEmptySchema = void 0;
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var boolError = {
      message: "boolean schema is false"
    };
    function topBoolOrEmptySchema(it) {
      const { gen, schema, validateName } = it;
      if (schema === false) {
        falseSchemaError(it, false);
      } else if (typeof schema == "object" && schema.$async === true) {
        gen.return(names_1.default.data);
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, null);
        gen.return(true);
      }
    }
    exports2.topBoolOrEmptySchema = topBoolOrEmptySchema;
    function boolOrEmptySchema(it, valid) {
      const { gen, schema } = it;
      if (schema === false) {
        gen.var(valid, false);
        falseSchemaError(it);
      } else {
        gen.var(valid, true);
      }
    }
    exports2.boolOrEmptySchema = boolOrEmptySchema;
    function falseSchemaError(it, overrideAllErrors) {
      const { gen, data } = it;
      const cxt = {
        gen,
        keyword: "false schema",
        data,
        schema: false,
        schemaCode: false,
        schemaValue: false,
        params: {},
        it
      };
      (0, errors_1.reportError)(cxt, boolError, void 0, overrideAllErrors);
    }
  }
});

// node_modules/ajv/dist/compile/rules.js
var require_rules = __commonJS({
  "node_modules/ajv/dist/compile/rules.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.getRules = exports2.isJSONType = void 0;
    var _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"];
    var jsonTypes = new Set(_jsonTypes);
    function isJSONType(x) {
      return typeof x == "string" && jsonTypes.has(x);
    }
    exports2.isJSONType = isJSONType;
    function getRules() {
      const groups = {
        number: { type: "number", rules: [] },
        string: { type: "string", rules: [] },
        array: { type: "array", rules: [] },
        object: { type: "object", rules: [] }
      };
      return {
        types: { ...groups, integer: true, boolean: true, null: true },
        rules: [{ rules: [] }, groups.number, groups.string, groups.array, groups.object],
        post: { rules: [] },
        all: {},
        keywords: {}
      };
    }
    exports2.getRules = getRules;
  }
});

// node_modules/ajv/dist/compile/validate/applicability.js
var require_applicability = __commonJS({
  "node_modules/ajv/dist/compile/validate/applicability.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.shouldUseRule = exports2.shouldUseGroup = exports2.schemaHasRulesForType = void 0;
    function schemaHasRulesForType({ schema, self }, type) {
      const group = self.RULES.types[type];
      return group && group !== true && shouldUseGroup(schema, group);
    }
    exports2.schemaHasRulesForType = schemaHasRulesForType;
    function shouldUseGroup(schema, group) {
      return group.rules.some((rule) => shouldUseRule(schema, rule));
    }
    exports2.shouldUseGroup = shouldUseGroup;
    function shouldUseRule(schema, rule) {
      var _a;
      return schema[rule.keyword] !== void 0 || ((_a = rule.definition.implements) === null || _a === void 0 ? void 0 : _a.some((kwd) => schema[kwd] !== void 0));
    }
    exports2.shouldUseRule = shouldUseRule;
  }
});

// node_modules/ajv/dist/compile/validate/dataType.js
var require_dataType = __commonJS({
  "node_modules/ajv/dist/compile/validate/dataType.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.reportTypeError = exports2.checkDataTypes = exports2.checkDataType = exports2.coerceAndCheckDataType = exports2.getJSONTypes = exports2.getSchemaTypes = exports2.DataType = void 0;
    var rules_1 = require_rules();
    var applicability_1 = require_applicability();
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var DataType;
    (function(DataType2) {
      DataType2[DataType2["Correct"] = 0] = "Correct";
      DataType2[DataType2["Wrong"] = 1] = "Wrong";
    })(DataType || (exports2.DataType = DataType = {}));
    function getSchemaTypes(schema) {
      const types = getJSONTypes(schema.type);
      const hasNull = types.includes("null");
      if (hasNull) {
        if (schema.nullable === false)
          throw new Error("type: null contradicts nullable: false");
      } else {
        if (!types.length && schema.nullable !== void 0) {
          throw new Error('"nullable" cannot be used without "type"');
        }
        if (schema.nullable === true)
          types.push("null");
      }
      return types;
    }
    exports2.getSchemaTypes = getSchemaTypes;
    function getJSONTypes(ts) {
      const types = Array.isArray(ts) ? ts : ts ? [ts] : [];
      if (types.every(rules_1.isJSONType))
        return types;
      throw new Error("type must be JSONType or JSONType[]: " + types.join(","));
    }
    exports2.getJSONTypes = getJSONTypes;
    function coerceAndCheckDataType(it, types) {
      const { gen, data, opts } = it;
      const coerceTo = coerceToTypes(types, opts.coerceTypes);
      const checkTypes = types.length > 0 && !(coerceTo.length === 0 && types.length === 1 && (0, applicability_1.schemaHasRulesForType)(it, types[0]));
      if (checkTypes) {
        const wrongType = checkDataTypes(types, data, opts.strictNumbers, DataType.Wrong);
        gen.if(wrongType, () => {
          if (coerceTo.length)
            coerceData(it, types, coerceTo);
          else
            reportTypeError(it);
        });
      }
      return checkTypes;
    }
    exports2.coerceAndCheckDataType = coerceAndCheckDataType;
    var COERCIBLE = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
    function coerceToTypes(types, coerceTypes) {
      return coerceTypes ? types.filter((t) => COERCIBLE.has(t) || coerceTypes === "array" && t === "array") : [];
    }
    function coerceData(it, types, coerceTo) {
      const { gen, data, opts } = it;
      const dataType = gen.let("dataType", (0, codegen_1._)`typeof ${data}`);
      const coerced = gen.let("coerced", (0, codegen_1._)`undefined`);
      if (opts.coerceTypes === "array") {
        gen.if((0, codegen_1._)`${dataType} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen.assign(data, (0, codegen_1._)`${data}[0]`).assign(dataType, (0, codegen_1._)`typeof ${data}`).if(checkDataTypes(types, data, opts.strictNumbers), () => gen.assign(coerced, data)));
      }
      gen.if((0, codegen_1._)`${coerced} !== undefined`);
      for (const t of coerceTo) {
        if (COERCIBLE.has(t) || t === "array" && opts.coerceTypes === "array") {
          coerceSpecificType(t);
        }
      }
      gen.else();
      reportTypeError(it);
      gen.endIf();
      gen.if((0, codegen_1._)`${coerced} !== undefined`, () => {
        gen.assign(data, coerced);
        assignParentData(it, coerced);
      });
      function coerceSpecificType(t) {
        switch (t) {
          case "string":
            gen.elseIf((0, codegen_1._)`${dataType} == "number" || ${dataType} == "boolean"`).assign(coerced, (0, codegen_1._)`"" + ${data}`).elseIf((0, codegen_1._)`${data} === null`).assign(coerced, (0, codegen_1._)`""`);
            return;
          case "number":
            gen.elseIf((0, codegen_1._)`${dataType} == "boolean" || ${data} === null
              || (${dataType} == "string" && ${data} && ${data} == +${data})`).assign(coerced, (0, codegen_1._)`+${data}`);
            return;
          case "integer":
            gen.elseIf((0, codegen_1._)`${dataType} === "boolean" || ${data} === null
              || (${dataType} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`).assign(coerced, (0, codegen_1._)`+${data}`);
            return;
          case "boolean":
            gen.elseIf((0, codegen_1._)`${data} === "false" || ${data} === 0 || ${data} === null`).assign(coerced, false).elseIf((0, codegen_1._)`${data} === "true" || ${data} === 1`).assign(coerced, true);
            return;
          case "null":
            gen.elseIf((0, codegen_1._)`${data} === "" || ${data} === 0 || ${data} === false`);
            gen.assign(coerced, null);
            return;
          case "array":
            gen.elseIf((0, codegen_1._)`${dataType} === "string" || ${dataType} === "number"
              || ${dataType} === "boolean" || ${data} === null`).assign(coerced, (0, codegen_1._)`[${data}]`);
        }
      }
    }
    function assignParentData({ gen, parentData, parentDataProperty }, expr) {
      gen.if((0, codegen_1._)`${parentData} !== undefined`, () => gen.assign((0, codegen_1._)`${parentData}[${parentDataProperty}]`, expr));
    }
    function checkDataType(dataType, data, strictNums, correct = DataType.Correct) {
      const EQ = correct === DataType.Correct ? codegen_1.operators.EQ : codegen_1.operators.NEQ;
      let cond;
      switch (dataType) {
        case "null":
          return (0, codegen_1._)`${data} ${EQ} null`;
        case "array":
          cond = (0, codegen_1._)`Array.isArray(${data})`;
          break;
        case "object":
          cond = (0, codegen_1._)`${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
          break;
        case "integer":
          cond = numCond((0, codegen_1._)`!(${data} % 1) && !isNaN(${data})`);
          break;
        case "number":
          cond = numCond();
          break;
        default:
          return (0, codegen_1._)`typeof ${data} ${EQ} ${dataType}`;
      }
      return correct === DataType.Correct ? cond : (0, codegen_1.not)(cond);
      function numCond(_cond = codegen_1.nil) {
        return (0, codegen_1.and)((0, codegen_1._)`typeof ${data} == "number"`, _cond, strictNums ? (0, codegen_1._)`isFinite(${data})` : codegen_1.nil);
      }
    }
    exports2.checkDataType = checkDataType;
    function checkDataTypes(dataTypes, data, strictNums, correct) {
      if (dataTypes.length === 1) {
        return checkDataType(dataTypes[0], data, strictNums, correct);
      }
      let cond;
      const types = (0, util_1.toHash)(dataTypes);
      if (types.array && types.object) {
        const notObj = (0, codegen_1._)`typeof ${data} != "object"`;
        cond = types.null ? notObj : (0, codegen_1._)`!${data} || ${notObj}`;
        delete types.null;
        delete types.array;
        delete types.object;
      } else {
        cond = codegen_1.nil;
      }
      if (types.number)
        delete types.integer;
      for (const t in types)
        cond = (0, codegen_1.and)(cond, checkDataType(t, data, strictNums, correct));
      return cond;
    }
    exports2.checkDataTypes = checkDataTypes;
    var typeError = {
      message: ({ schema }) => `must be ${schema}`,
      params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1._)`{type: ${schema}}` : (0, codegen_1._)`{type: ${schemaValue}}`
    };
    function reportTypeError(it) {
      const cxt = getTypeErrorContext(it);
      (0, errors_1.reportError)(cxt, typeError);
    }
    exports2.reportTypeError = reportTypeError;
    function getTypeErrorContext(it) {
      const { gen, data, schema } = it;
      const schemaCode = (0, util_1.schemaRefOrVal)(it, schema, "type");
      return {
        gen,
        keyword: "type",
        data,
        schema: schema.type,
        schemaCode,
        schemaValue: schemaCode,
        parentSchema: schema,
        params: {},
        it
      };
    }
  }
});

// node_modules/ajv/dist/compile/validate/defaults.js
var require_defaults = __commonJS({
  "node_modules/ajv/dist/compile/validate/defaults.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.assignDefaults = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function assignDefaults(it, ty) {
      const { properties, items } = it.schema;
      if (ty === "object" && properties) {
        for (const key in properties) {
          assignDefault(it, key, properties[key].default);
        }
      } else if (ty === "array" && Array.isArray(items)) {
        items.forEach((sch, i) => assignDefault(it, i, sch.default));
      }
    }
    exports2.assignDefaults = assignDefaults;
    function assignDefault(it, prop, defaultValue) {
      const { gen, compositeRule, data, opts } = it;
      if (defaultValue === void 0)
        return;
      const childData = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(prop)}`;
      if (compositeRule) {
        (0, util_1.checkStrictMode)(it, `default is ignored for: ${childData}`);
        return;
      }
      let condition = (0, codegen_1._)`${childData} === undefined`;
      if (opts.useDefaults === "empty") {
        condition = (0, codegen_1._)`${condition} || ${childData} === null || ${childData} === ""`;
      }
      gen.if(condition, (0, codegen_1._)`${childData} = ${(0, codegen_1.stringify)(defaultValue)}`);
    }
  }
});

// node_modules/ajv/dist/vocabularies/code.js
var require_code2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/code.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateUnion = exports2.validateArray = exports2.usePattern = exports2.callValidateCode = exports2.schemaProperties = exports2.allSchemaProperties = exports2.noPropertyInData = exports2.propertyInData = exports2.isOwnProperty = exports2.hasPropFunc = exports2.reportMissingProp = exports2.checkMissingProp = exports2.checkReportMissingProp = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    var util_2 = require_util();
    function checkReportMissingProp(cxt, prop) {
      const { gen, data, it } = cxt;
      gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
        cxt.setParams({ missingProperty: (0, codegen_1._)`${prop}` }, true);
        cxt.error();
      });
    }
    exports2.checkReportMissingProp = checkReportMissingProp;
    function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
      return (0, codegen_1.or)(...properties.map((prop) => (0, codegen_1.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1._)`${missing} = ${prop}`)));
    }
    exports2.checkMissingProp = checkMissingProp;
    function reportMissingProp(cxt, missing) {
      cxt.setParams({ missingProperty: missing }, true);
      cxt.error();
    }
    exports2.reportMissingProp = reportMissingProp;
    function hasPropFunc(gen) {
      return gen.scopeValue("func", {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        ref: Object.prototype.hasOwnProperty,
        code: (0, codegen_1._)`Object.prototype.hasOwnProperty`
      });
    }
    exports2.hasPropFunc = hasPropFunc;
    function isOwnProperty(gen, data, property) {
      return (0, codegen_1._)`${hasPropFunc(gen)}.call(${data}, ${property})`;
    }
    exports2.isOwnProperty = isOwnProperty;
    function propertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} !== undefined`;
      return ownProperties ? (0, codegen_1._)`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
    }
    exports2.propertyInData = propertyInData;
    function noPropertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} === undefined`;
      return ownProperties ? (0, codegen_1.or)(cond, (0, codegen_1.not)(isOwnProperty(gen, data, property))) : cond;
    }
    exports2.noPropertyInData = noPropertyInData;
    function allSchemaProperties(schemaMap) {
      return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
    }
    exports2.allSchemaProperties = allSchemaProperties;
    function schemaProperties(it, schemaMap) {
      return allSchemaProperties(schemaMap).filter((p) => !(0, util_1.alwaysValidSchema)(it, schemaMap[p]));
    }
    exports2.schemaProperties = schemaProperties;
    function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
      const dataAndSchema = passSchema ? (0, codegen_1._)`${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data;
      const valCxt = [
        [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, errorPath)],
        [names_1.default.parentData, it.parentData],
        [names_1.default.parentDataProperty, it.parentDataProperty],
        [names_1.default.rootData, names_1.default.rootData]
      ];
      if (it.opts.dynamicRef)
        valCxt.push([names_1.default.dynamicAnchors, names_1.default.dynamicAnchors]);
      const args = (0, codegen_1._)`${dataAndSchema}, ${gen.object(...valCxt)}`;
      return context !== codegen_1.nil ? (0, codegen_1._)`${func}.call(${context}, ${args})` : (0, codegen_1._)`${func}(${args})`;
    }
    exports2.callValidateCode = callValidateCode;
    var newRegExp = (0, codegen_1._)`new RegExp`;
    function usePattern({ gen, it: { opts } }, pattern) {
      const u = opts.unicodeRegExp ? "u" : "";
      const { regExp } = opts.code;
      const rx = regExp(pattern, u);
      return gen.scopeValue("pattern", {
        key: rx.toString(),
        ref: rx,
        code: (0, codegen_1._)`${regExp.code === "new RegExp" ? newRegExp : (0, util_2.useFunc)(gen, regExp)}(${pattern}, ${u})`
      });
    }
    exports2.usePattern = usePattern;
    function validateArray(cxt) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      if (it.allErrors) {
        const validArr = gen.let("valid", true);
        validateItems(() => gen.assign(validArr, false));
        return validArr;
      }
      gen.var(valid, true);
      validateItems(() => gen.break());
      return valid;
      function validateItems(notValid) {
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        gen.forRange("i", 0, len, (i) => {
          cxt.subschema({
            keyword,
            dataProp: i,
            dataPropType: util_1.Type.Num
          }, valid);
          gen.if((0, codegen_1.not)(valid), notValid);
        });
      }
    }
    exports2.validateArray = validateArray;
    function validateUnion(cxt) {
      const { gen, schema, keyword, it } = cxt;
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      const alwaysValid = schema.some((sch) => (0, util_1.alwaysValidSchema)(it, sch));
      if (alwaysValid && !it.opts.unevaluated)
        return;
      const valid = gen.let("valid", false);
      const schValid = gen.name("_valid");
      gen.block(() => schema.forEach((_sch, i) => {
        const schCxt = cxt.subschema({
          keyword,
          schemaProp: i,
          compositeRule: true
        }, schValid);
        gen.assign(valid, (0, codegen_1._)`${valid} || ${schValid}`);
        const merged = cxt.mergeValidEvaluated(schCxt, schValid);
        if (!merged)
          gen.if((0, codegen_1.not)(valid));
      }));
      cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
    }
    exports2.validateUnion = validateUnion;
  }
});

// node_modules/ajv/dist/compile/validate/keyword.js
var require_keyword = __commonJS({
  "node_modules/ajv/dist/compile/validate/keyword.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateKeywordUsage = exports2.validSchemaType = exports2.funcKeywordCode = exports2.macroKeywordCode = void 0;
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var code_1 = require_code2();
    var errors_1 = require_errors();
    function macroKeywordCode(cxt, def) {
      const { gen, keyword, schema, parentSchema, it } = cxt;
      const macroSchema = def.macro.call(it.self, schema, parentSchema, it);
      const schemaRef = useKeyword(gen, keyword, macroSchema);
      if (it.opts.validateSchema !== false)
        it.self.validateSchema(macroSchema, true);
      const valid = gen.name("valid");
      cxt.subschema({
        schema: macroSchema,
        schemaPath: codegen_1.nil,
        errSchemaPath: `${it.errSchemaPath}/${keyword}`,
        topSchemaRef: schemaRef,
        compositeRule: true
      }, valid);
      cxt.pass(valid, () => cxt.error(true));
    }
    exports2.macroKeywordCode = macroKeywordCode;
    function funcKeywordCode(cxt, def) {
      var _a;
      const { gen, keyword, schema, parentSchema, $data, it } = cxt;
      checkAsyncKeyword(it, def);
      const validate = !$data && def.compile ? def.compile.call(it.self, schema, parentSchema, it) : def.validate;
      const validateRef = useKeyword(gen, keyword, validate);
      const valid = gen.let("valid");
      cxt.block$data(valid, validateKeyword);
      cxt.ok((_a = def.valid) !== null && _a !== void 0 ? _a : valid);
      function validateKeyword() {
        if (def.errors === false) {
          assignValid();
          if (def.modifying)
            modifyData(cxt);
          reportErrs(() => cxt.error());
        } else {
          const ruleErrs = def.async ? validateAsync() : validateSync();
          if (def.modifying)
            modifyData(cxt);
          reportErrs(() => addErrs(cxt, ruleErrs));
        }
      }
      function validateAsync() {
        const ruleErrs = gen.let("ruleErrs", null);
        gen.try(() => assignValid((0, codegen_1._)`await `), (e) => gen.assign(valid, false).if((0, codegen_1._)`${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, (0, codegen_1._)`${e}.errors`), () => gen.throw(e)));
        return ruleErrs;
      }
      function validateSync() {
        const validateErrs = (0, codegen_1._)`${validateRef}.errors`;
        gen.assign(validateErrs, null);
        assignValid(codegen_1.nil);
        return validateErrs;
      }
      function assignValid(_await = def.async ? (0, codegen_1._)`await ` : codegen_1.nil) {
        const passCxt = it.opts.passContext ? names_1.default.this : names_1.default.self;
        const passSchema = !("compile" in def && !$data || def.schema === false);
        gen.assign(valid, (0, codegen_1._)`${_await}${(0, code_1.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def.modifying);
      }
      function reportErrs(errors) {
        var _a2;
        gen.if((0, codegen_1.not)((_a2 = def.valid) !== null && _a2 !== void 0 ? _a2 : valid), errors);
      }
    }
    exports2.funcKeywordCode = funcKeywordCode;
    function modifyData(cxt) {
      const { gen, data, it } = cxt;
      gen.if(it.parentData, () => gen.assign(data, (0, codegen_1._)`${it.parentData}[${it.parentDataProperty}]`));
    }
    function addErrs(cxt, errs) {
      const { gen } = cxt;
      gen.if((0, codegen_1._)`Array.isArray(${errs})`, () => {
        gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`).assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
        (0, errors_1.extendErrors)(cxt);
      }, () => cxt.error());
    }
    function checkAsyncKeyword({ schemaEnv }, def) {
      if (def.async && !schemaEnv.$async)
        throw new Error("async keyword in sync schema");
    }
    function useKeyword(gen, keyword, result) {
      if (result === void 0)
        throw new Error(`keyword "${keyword}" failed to compile`);
      return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : { ref: result, code: (0, codegen_1.stringify)(result) });
    }
    function validSchemaType(schema, schemaType, allowUndefined = false) {
      return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema == "undefined");
    }
    exports2.validSchemaType = validSchemaType;
    function validateKeywordUsage({ schema, opts, self, errSchemaPath }, def, keyword) {
      if (Array.isArray(def.keyword) ? !def.keyword.includes(keyword) : def.keyword !== keyword) {
        throw new Error("ajv implementation error");
      }
      const deps = def.dependencies;
      if (deps === null || deps === void 0 ? void 0 : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) {
        throw new Error(`parent schema must have dependencies of ${keyword}: ${deps.join(",")}`);
      }
      if (def.validateSchema) {
        const valid = def.validateSchema(schema[keyword]);
        if (!valid) {
          const msg = `keyword "${keyword}" value is invalid at path "${errSchemaPath}": ` + self.errorsText(def.validateSchema.errors);
          if (opts.validateSchema === "log")
            self.logger.error(msg);
          else
            throw new Error(msg);
        }
      }
    }
    exports2.validateKeywordUsage = validateKeywordUsage;
  }
});

// node_modules/ajv/dist/compile/validate/subschema.js
var require_subschema = __commonJS({
  "node_modules/ajv/dist/compile/validate/subschema.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.extendSubschemaMode = exports2.extendSubschemaData = exports2.getSubschema = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
      if (keyword !== void 0 && schema !== void 0) {
        throw new Error('both "keyword" and "schema" passed, only one allowed');
      }
      if (keyword !== void 0) {
        const sch = it.schema[keyword];
        return schemaProp === void 0 ? {
          schema: sch,
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}`
        } : {
          schema: sch[schemaProp],
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}${(0, codegen_1.getProperty)(schemaProp)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}/${(0, util_1.escapeFragment)(schemaProp)}`
        };
      }
      if (schema !== void 0) {
        if (schemaPath === void 0 || errSchemaPath === void 0 || topSchemaRef === void 0) {
          throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
        }
        return {
          schema,
          schemaPath,
          topSchemaRef,
          errSchemaPath
        };
      }
      throw new Error('either "keyword" or "schema" must be passed');
    }
    exports2.getSubschema = getSubschema;
    function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
      if (data !== void 0 && dataProp !== void 0) {
        throw new Error('both "data" and "dataProp" passed, only one allowed');
      }
      const { gen } = it;
      if (dataProp !== void 0) {
        const { errorPath, dataPathArr, opts } = it;
        const nextData = gen.let("data", (0, codegen_1._)`${it.data}${(0, codegen_1.getProperty)(dataProp)}`, true);
        dataContextProps(nextData);
        subschema.errorPath = (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
        subschema.parentDataProperty = (0, codegen_1._)`${dataProp}`;
        subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
      }
      if (data !== void 0) {
        const nextData = data instanceof codegen_1.Name ? data : gen.let("data", data, true);
        dataContextProps(nextData);
        if (propertyName !== void 0)
          subschema.propertyName = propertyName;
      }
      if (dataTypes)
        subschema.dataTypes = dataTypes;
      function dataContextProps(_nextData) {
        subschema.data = _nextData;
        subschema.dataLevel = it.dataLevel + 1;
        subschema.dataTypes = [];
        it.definedProperties = /* @__PURE__ */ new Set();
        subschema.parentData = it.data;
        subschema.dataNames = [...it.dataNames, _nextData];
      }
    }
    exports2.extendSubschemaData = extendSubschemaData;
    function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
      if (compositeRule !== void 0)
        subschema.compositeRule = compositeRule;
      if (createErrors !== void 0)
        subschema.createErrors = createErrors;
      if (allErrors !== void 0)
        subschema.allErrors = allErrors;
      subschema.jtdDiscriminator = jtdDiscriminator;
      subschema.jtdMetadata = jtdMetadata;
    }
    exports2.extendSubschemaMode = extendSubschemaMode;
  }
});

// node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "node_modules/fast-deep-equal/index.js"(exports2, module2) {
    "use strict";
    module2.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0; )
            if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0; ) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  }
});

// node_modules/json-schema-traverse/index.js
var require_json_schema_traverse = __commonJS({
  "node_modules/json-schema-traverse/index.js"(exports2, module2) {
    "use strict";
    var traverse = module2.exports = function(schema, opts, cb) {
      if (typeof opts == "function") {
        cb = opts;
        opts = {};
      }
      cb = opts.cb || cb;
      var pre = typeof cb == "function" ? cb : cb.pre || function() {
      };
      var post = cb.post || function() {
      };
      _traverse(opts, pre, post, schema, "", schema);
    };
    traverse.keywords = {
      additionalItems: true,
      items: true,
      contains: true,
      additionalProperties: true,
      propertyNames: true,
      not: true,
      if: true,
      then: true,
      else: true
    };
    traverse.arrayKeywords = {
      items: true,
      allOf: true,
      anyOf: true,
      oneOf: true
    };
    traverse.propsKeywords = {
      $defs: true,
      definitions: true,
      properties: true,
      patternProperties: true,
      dependencies: true
    };
    traverse.skipKeywords = {
      default: true,
      enum: true,
      const: true,
      required: true,
      maximum: true,
      minimum: true,
      exclusiveMaximum: true,
      exclusiveMinimum: true,
      multipleOf: true,
      maxLength: true,
      minLength: true,
      pattern: true,
      format: true,
      maxItems: true,
      minItems: true,
      uniqueItems: true,
      maxProperties: true,
      minProperties: true
    };
    function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
      if (schema && typeof schema == "object" && !Array.isArray(schema)) {
        pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
        for (var key in schema) {
          var sch = schema[key];
          if (Array.isArray(sch)) {
            if (key in traverse.arrayKeywords) {
              for (var i = 0; i < sch.length; i++)
                _traverse(opts, pre, post, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i);
            }
          } else if (key in traverse.propsKeywords) {
            if (sch && typeof sch == "object") {
              for (var prop in sch)
                _traverse(opts, pre, post, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
            }
          } else if (key in traverse.keywords || opts.allKeys && !(key in traverse.skipKeywords)) {
            _traverse(opts, pre, post, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema);
          }
        }
        post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
      }
    }
    function escapeJsonPtr(str) {
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
  }
});

// node_modules/ajv/dist/compile/resolve.js
var require_resolve = __commonJS({
  "node_modules/ajv/dist/compile/resolve.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.getSchemaRefs = exports2.resolveUrl = exports2.normalizeId = exports2._getFullPath = exports2.getFullPath = exports2.inlineRef = void 0;
    var util_1 = require_util();
    var equal = require_fast_deep_equal();
    var traverse = require_json_schema_traverse();
    var SIMPLE_INLINED = /* @__PURE__ */ new Set([
      "type",
      "format",
      "pattern",
      "maxLength",
      "minLength",
      "maxProperties",
      "minProperties",
      "maxItems",
      "minItems",
      "maximum",
      "minimum",
      "uniqueItems",
      "multipleOf",
      "required",
      "enum",
      "const"
    ]);
    function inlineRef(schema, limit = true) {
      if (typeof schema == "boolean")
        return true;
      if (limit === true)
        return !hasRef(schema);
      if (!limit)
        return false;
      return countKeys(schema) <= limit;
    }
    exports2.inlineRef = inlineRef;
    var REF_KEYWORDS = /* @__PURE__ */ new Set([
      "$ref",
      "$recursiveRef",
      "$recursiveAnchor",
      "$dynamicRef",
      "$dynamicAnchor"
    ]);
    function hasRef(schema) {
      for (const key in schema) {
        if (REF_KEYWORDS.has(key))
          return true;
        const sch = schema[key];
        if (Array.isArray(sch) && sch.some(hasRef))
          return true;
        if (typeof sch == "object" && hasRef(sch))
          return true;
      }
      return false;
    }
    function countKeys(schema) {
      let count = 0;
      for (const key in schema) {
        if (key === "$ref")
          return Infinity;
        count++;
        if (SIMPLE_INLINED.has(key))
          continue;
        if (typeof schema[key] == "object") {
          (0, util_1.eachItem)(schema[key], (sch) => count += countKeys(sch));
        }
        if (count === Infinity)
          return Infinity;
      }
      return count;
    }
    function getFullPath(resolver, id = "", normalize) {
      if (normalize !== false)
        id = normalizeId(id);
      const p = resolver.parse(id);
      return _getFullPath(resolver, p);
    }
    exports2.getFullPath = getFullPath;
    function _getFullPath(resolver, p) {
      const serialized = resolver.serialize(p);
      return serialized.split("#")[0] + "#";
    }
    exports2._getFullPath = _getFullPath;
    var TRAILING_SLASH_HASH = /#\/?$/;
    function normalizeId(id) {
      return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
    }
    exports2.normalizeId = normalizeId;
    function resolveUrl(resolver, baseId, id) {
      id = normalizeId(id);
      return resolver.resolve(baseId, id);
    }
    exports2.resolveUrl = resolveUrl;
    var ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
    function getSchemaRefs(schema, baseId) {
      if (typeof schema == "boolean")
        return {};
      const { schemaId, uriResolver } = this.opts;
      const schId = normalizeId(schema[schemaId] || baseId);
      const baseIds = { "": schId };
      const pathPrefix = getFullPath(uriResolver, schId, false);
      const localRefs = {};
      const schemaRefs = /* @__PURE__ */ new Set();
      traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
        if (parentJsonPtr === void 0)
          return;
        const fullPath = pathPrefix + jsonPtr;
        let innerBaseId = baseIds[parentJsonPtr];
        if (typeof sch[schemaId] == "string")
          innerBaseId = addRef.call(this, sch[schemaId]);
        addAnchor.call(this, sch.$anchor);
        addAnchor.call(this, sch.$dynamicAnchor);
        baseIds[jsonPtr] = innerBaseId;
        function addRef(ref) {
          const _resolve = this.opts.uriResolver.resolve;
          ref = normalizeId(innerBaseId ? _resolve(innerBaseId, ref) : ref);
          if (schemaRefs.has(ref))
            throw ambiguos(ref);
          schemaRefs.add(ref);
          let schOrRef = this.refs[ref];
          if (typeof schOrRef == "string")
            schOrRef = this.refs[schOrRef];
          if (typeof schOrRef == "object") {
            checkAmbiguosRef(sch, schOrRef.schema, ref);
          } else if (ref !== normalizeId(fullPath)) {
            if (ref[0] === "#") {
              checkAmbiguosRef(sch, localRefs[ref], ref);
              localRefs[ref] = sch;
            } else {
              this.refs[ref] = fullPath;
            }
          }
          return ref;
        }
        function addAnchor(anchor) {
          if (typeof anchor == "string") {
            if (!ANCHOR.test(anchor))
              throw new Error(`invalid anchor "${anchor}"`);
            addRef.call(this, `#${anchor}`);
          }
        }
      });
      return localRefs;
      function checkAmbiguosRef(sch1, sch2, ref) {
        if (sch2 !== void 0 && !equal(sch1, sch2))
          throw ambiguos(ref);
      }
      function ambiguos(ref) {
        return new Error(`reference "${ref}" resolves to more than one schema`);
      }
    }
    exports2.getSchemaRefs = getSchemaRefs;
  }
});

// node_modules/ajv/dist/compile/validate/index.js
var require_validate = __commonJS({
  "node_modules/ajv/dist/compile/validate/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.getData = exports2.KeywordCxt = exports2.validateFunctionCode = void 0;
    var boolSchema_1 = require_boolSchema();
    var dataType_1 = require_dataType();
    var applicability_1 = require_applicability();
    var dataType_2 = require_dataType();
    var defaults_1 = require_defaults();
    var keyword_1 = require_keyword();
    var subschema_1 = require_subschema();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var errors_1 = require_errors();
    function validateFunctionCode(it) {
      if (isSchemaObj(it)) {
        checkKeywords(it);
        if (schemaCxtHasRules(it)) {
          topSchemaObjCode(it);
          return;
        }
      }
      validateFunction(it, () => (0, boolSchema_1.topBoolOrEmptySchema)(it));
    }
    exports2.validateFunctionCode = validateFunctionCode;
    function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
      if (opts.code.es5) {
        gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${names_1.default.valCxt}`, schemaEnv.$async, () => {
          gen.code((0, codegen_1._)`"use strict"; ${funcSourceUrl(schema, opts)}`);
          destructureValCxtES5(gen, opts);
          gen.code(body);
        });
      } else {
        gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
      }
    }
    function destructureValCxt(opts) {
      return (0, codegen_1._)`{${names_1.default.instancePath}="", ${names_1.default.parentData}, ${names_1.default.parentDataProperty}, ${names_1.default.rootData}=${names_1.default.data}${opts.dynamicRef ? (0, codegen_1._)`, ${names_1.default.dynamicAnchors}={}` : codegen_1.nil}}={}`;
    }
    function destructureValCxtES5(gen, opts) {
      gen.if(names_1.default.valCxt, () => {
        gen.var(names_1.default.instancePath, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.instancePath}`);
        gen.var(names_1.default.parentData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentData}`);
        gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentDataProperty}`);
        gen.var(names_1.default.rootData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.rootData}`);
        if (opts.dynamicRef)
          gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.dynamicAnchors}`);
      }, () => {
        gen.var(names_1.default.instancePath, (0, codegen_1._)`""`);
        gen.var(names_1.default.parentData, (0, codegen_1._)`undefined`);
        gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`undefined`);
        gen.var(names_1.default.rootData, names_1.default.data);
        if (opts.dynamicRef)
          gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`{}`);
      });
    }
    function topSchemaObjCode(it) {
      const { schema, opts, gen } = it;
      validateFunction(it, () => {
        if (opts.$comment && schema.$comment)
          commentKeyword(it);
        checkNoDefault(it);
        gen.let(names_1.default.vErrors, null);
        gen.let(names_1.default.errors, 0);
        if (opts.unevaluated)
          resetEvaluated(it);
        typeAndKeywords(it);
        returnResults(it);
      });
      return;
    }
    function resetEvaluated(it) {
      const { gen, validateName } = it;
      it.evaluated = gen.const("evaluated", (0, codegen_1._)`${validateName}.evaluated`);
      gen.if((0, codegen_1._)`${it.evaluated}.dynamicProps`, () => gen.assign((0, codegen_1._)`${it.evaluated}.props`, (0, codegen_1._)`undefined`));
      gen.if((0, codegen_1._)`${it.evaluated}.dynamicItems`, () => gen.assign((0, codegen_1._)`${it.evaluated}.items`, (0, codegen_1._)`undefined`));
    }
    function funcSourceUrl(schema, opts) {
      const schId = typeof schema == "object" && schema[opts.schemaId];
      return schId && (opts.code.source || opts.code.process) ? (0, codegen_1._)`/*# sourceURL=${schId} */` : codegen_1.nil;
    }
    function subschemaCode(it, valid) {
      if (isSchemaObj(it)) {
        checkKeywords(it);
        if (schemaCxtHasRules(it)) {
          subSchemaObjCode(it, valid);
          return;
        }
      }
      (0, boolSchema_1.boolOrEmptySchema)(it, valid);
    }
    function schemaCxtHasRules({ schema, self }) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (self.RULES.all[key])
          return true;
      return false;
    }
    function isSchemaObj(it) {
      return typeof it.schema != "boolean";
    }
    function subSchemaObjCode(it, valid) {
      const { schema, gen, opts } = it;
      if (opts.$comment && schema.$comment)
        commentKeyword(it);
      updateContext(it);
      checkAsyncSchema(it);
      const errsCount = gen.const("_errs", names_1.default.errors);
      typeAndKeywords(it, errsCount);
      gen.var(valid, (0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
    }
    function checkKeywords(it) {
      (0, util_1.checkUnknownRules)(it);
      checkRefsAndKeywords(it);
    }
    function typeAndKeywords(it, errsCount) {
      if (it.opts.jtd)
        return schemaKeywords(it, [], false, errsCount);
      const types = (0, dataType_1.getSchemaTypes)(it.schema);
      const checkedTypes = (0, dataType_1.coerceAndCheckDataType)(it, types);
      schemaKeywords(it, types, !checkedTypes, errsCount);
    }
    function checkRefsAndKeywords(it) {
      const { schema, errSchemaPath, opts, self } = it;
      if (schema.$ref && opts.ignoreKeywordsWithRef && (0, util_1.schemaHasRulesButRef)(schema, self.RULES)) {
        self.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
      }
    }
    function checkNoDefault(it) {
      const { schema, opts } = it;
      if (schema.default !== void 0 && opts.useDefaults && opts.strictSchema) {
        (0, util_1.checkStrictMode)(it, "default is ignored in the schema root");
      }
    }
    function updateContext(it) {
      const schId = it.schema[it.opts.schemaId];
      if (schId)
        it.baseId = (0, resolve_1.resolveUrl)(it.opts.uriResolver, it.baseId, schId);
    }
    function checkAsyncSchema(it) {
      if (it.schema.$async && !it.schemaEnv.$async)
        throw new Error("async schema in sync schema");
    }
    function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
      const msg = schema.$comment;
      if (opts.$comment === true) {
        gen.code((0, codegen_1._)`${names_1.default.self}.logger.log(${msg})`);
      } else if (typeof opts.$comment == "function") {
        const schemaPath = (0, codegen_1.str)`${errSchemaPath}/$comment`;
        const rootName = gen.scopeValue("root", { ref: schemaEnv.root });
        gen.code((0, codegen_1._)`${names_1.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
      }
    }
    function returnResults(it) {
      const { gen, schemaEnv, validateName, ValidationError, opts } = it;
      if (schemaEnv.$async) {
        gen.if((0, codegen_1._)`${names_1.default.errors} === 0`, () => gen.return(names_1.default.data), () => gen.throw((0, codegen_1._)`new ${ValidationError}(${names_1.default.vErrors})`));
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, names_1.default.vErrors);
        if (opts.unevaluated)
          assignEvaluated(it);
        gen.return((0, codegen_1._)`${names_1.default.errors} === 0`);
      }
    }
    function assignEvaluated({ gen, evaluated, props, items }) {
      if (props instanceof codegen_1.Name)
        gen.assign((0, codegen_1._)`${evaluated}.props`, props);
      if (items instanceof codegen_1.Name)
        gen.assign((0, codegen_1._)`${evaluated}.items`, items);
    }
    function schemaKeywords(it, types, typeErrors, errsCount) {
      const { gen, schema, data, allErrors, opts, self } = it;
      const { RULES } = self;
      if (schema.$ref && (opts.ignoreKeywordsWithRef || !(0, util_1.schemaHasRulesButRef)(schema, RULES))) {
        gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition));
        return;
      }
      if (!opts.jtd)
        checkStrictTypes(it, types);
      gen.block(() => {
        for (const group of RULES.rules)
          groupKeywords(group);
        groupKeywords(RULES.post);
      });
      function groupKeywords(group) {
        if (!(0, applicability_1.shouldUseGroup)(schema, group))
          return;
        if (group.type) {
          gen.if((0, dataType_2.checkDataType)(group.type, data, opts.strictNumbers));
          iterateKeywords(it, group);
          if (types.length === 1 && types[0] === group.type && typeErrors) {
            gen.else();
            (0, dataType_2.reportTypeError)(it);
          }
          gen.endIf();
        } else {
          iterateKeywords(it, group);
        }
        if (!allErrors)
          gen.if((0, codegen_1._)`${names_1.default.errors} === ${errsCount || 0}`);
      }
    }
    function iterateKeywords(it, group) {
      const { gen, schema, opts: { useDefaults } } = it;
      if (useDefaults)
        (0, defaults_1.assignDefaults)(it, group.type);
      gen.block(() => {
        for (const rule of group.rules) {
          if ((0, applicability_1.shouldUseRule)(schema, rule)) {
            keywordCode(it, rule.keyword, rule.definition, group.type);
          }
        }
      });
    }
    function checkStrictTypes(it, types) {
      if (it.schemaEnv.meta || !it.opts.strictTypes)
        return;
      checkContextTypes(it, types);
      if (!it.opts.allowUnionTypes)
        checkMultipleTypes(it, types);
      checkKeywordTypes(it, it.dataTypes);
    }
    function checkContextTypes(it, types) {
      if (!types.length)
        return;
      if (!it.dataTypes.length) {
        it.dataTypes = types;
        return;
      }
      types.forEach((t) => {
        if (!includesType(it.dataTypes, t)) {
          strictTypesError(it, `type "${t}" not allowed by context "${it.dataTypes.join(",")}"`);
        }
      });
      narrowSchemaTypes(it, types);
    }
    function checkMultipleTypes(it, ts) {
      if (ts.length > 1 && !(ts.length === 2 && ts.includes("null"))) {
        strictTypesError(it, "use allowUnionTypes to allow union type keyword");
      }
    }
    function checkKeywordTypes(it, ts) {
      const rules = it.self.RULES.all;
      for (const keyword in rules) {
        const rule = rules[keyword];
        if (typeof rule == "object" && (0, applicability_1.shouldUseRule)(it.schema, rule)) {
          const { type } = rule.definition;
          if (type.length && !type.some((t) => hasApplicableType(ts, t))) {
            strictTypesError(it, `missing type "${type.join(",")}" for keyword "${keyword}"`);
          }
        }
      }
    }
    function hasApplicableType(schTs, kwdT) {
      return schTs.includes(kwdT) || kwdT === "number" && schTs.includes("integer");
    }
    function includesType(ts, t) {
      return ts.includes(t) || t === "integer" && ts.includes("number");
    }
    function narrowSchemaTypes(it, withTypes) {
      const ts = [];
      for (const t of it.dataTypes) {
        if (includesType(withTypes, t))
          ts.push(t);
        else if (withTypes.includes("integer") && t === "number")
          ts.push("integer");
      }
      it.dataTypes = ts;
    }
    function strictTypesError(it, msg) {
      const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
      msg += ` at "${schemaPath}" (strictTypes)`;
      (0, util_1.checkStrictMode)(it, msg, it.opts.strictTypes);
    }
    var KeywordCxt = class {
      constructor(it, def, keyword) {
        (0, keyword_1.validateKeywordUsage)(it, def, keyword);
        this.gen = it.gen;
        this.allErrors = it.allErrors;
        this.keyword = keyword;
        this.data = it.data;
        this.schema = it.schema[keyword];
        this.$data = def.$data && it.opts.$data && this.schema && this.schema.$data;
        this.schemaValue = (0, util_1.schemaRefOrVal)(it, this.schema, keyword, this.$data);
        this.schemaType = def.schemaType;
        this.parentSchema = it.schema;
        this.params = {};
        this.it = it;
        this.def = def;
        if (this.$data) {
          this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
        } else {
          this.schemaCode = this.schemaValue;
          if (!(0, keyword_1.validSchemaType)(this.schema, def.schemaType, def.allowUndefined)) {
            throw new Error(`${keyword} value must be ${JSON.stringify(def.schemaType)}`);
          }
        }
        if ("code" in def ? def.trackErrors : def.errors !== false) {
          this.errsCount = it.gen.const("_errs", names_1.default.errors);
        }
      }
      result(condition, successAction, failAction) {
        this.failResult((0, codegen_1.not)(condition), successAction, failAction);
      }
      failResult(condition, successAction, failAction) {
        this.gen.if(condition);
        if (failAction)
          failAction();
        else
          this.error();
        if (successAction) {
          this.gen.else();
          successAction();
          if (this.allErrors)
            this.gen.endIf();
        } else {
          if (this.allErrors)
            this.gen.endIf();
          else
            this.gen.else();
        }
      }
      pass(condition, failAction) {
        this.failResult((0, codegen_1.not)(condition), void 0, failAction);
      }
      fail(condition) {
        if (condition === void 0) {
          this.error();
          if (!this.allErrors)
            this.gen.if(false);
          return;
        }
        this.gen.if(condition);
        this.error();
        if (this.allErrors)
          this.gen.endIf();
        else
          this.gen.else();
      }
      fail$data(condition) {
        if (!this.$data)
          return this.fail(condition);
        const { schemaCode } = this;
        this.fail((0, codegen_1._)`${schemaCode} !== undefined && (${(0, codegen_1.or)(this.invalid$data(), condition)})`);
      }
      error(append, errorParams, errorPaths) {
        if (errorParams) {
          this.setParams(errorParams);
          this._error(append, errorPaths);
          this.setParams({});
          return;
        }
        this._error(append, errorPaths);
      }
      _error(append, errorPaths) {
        ;
        (append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
      }
      $dataError() {
        (0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
      }
      reset() {
        if (this.errsCount === void 0)
          throw new Error('add "trackErrors" to keyword definition');
        (0, errors_1.resetErrorsCount)(this.gen, this.errsCount);
      }
      ok(cond) {
        if (!this.allErrors)
          this.gen.if(cond);
      }
      setParams(obj, assign) {
        if (assign)
          Object.assign(this.params, obj);
        else
          this.params = obj;
      }
      block$data(valid, codeBlock, $dataValid = codegen_1.nil) {
        this.gen.block(() => {
          this.check$data(valid, $dataValid);
          codeBlock();
        });
      }
      check$data(valid = codegen_1.nil, $dataValid = codegen_1.nil) {
        if (!this.$data)
          return;
        const { gen, schemaCode, schemaType, def } = this;
        gen.if((0, codegen_1.or)((0, codegen_1._)`${schemaCode} === undefined`, $dataValid));
        if (valid !== codegen_1.nil)
          gen.assign(valid, true);
        if (schemaType.length || def.validateSchema) {
          gen.elseIf(this.invalid$data());
          this.$dataError();
          if (valid !== codegen_1.nil)
            gen.assign(valid, false);
        }
        gen.else();
      }
      invalid$data() {
        const { gen, schemaCode, schemaType, def, it } = this;
        return (0, codegen_1.or)(wrong$DataType(), invalid$DataSchema());
        function wrong$DataType() {
          if (schemaType.length) {
            if (!(schemaCode instanceof codegen_1.Name))
              throw new Error("ajv implementation error");
            const st = Array.isArray(schemaType) ? schemaType : [schemaType];
            return (0, codegen_1._)`${(0, dataType_2.checkDataTypes)(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
          }
          return codegen_1.nil;
        }
        function invalid$DataSchema() {
          if (def.validateSchema) {
            const validateSchemaRef = gen.scopeValue("validate$data", { ref: def.validateSchema });
            return (0, codegen_1._)`!${validateSchemaRef}(${schemaCode})`;
          }
          return codegen_1.nil;
        }
      }
      subschema(appl, valid) {
        const subschema = (0, subschema_1.getSubschema)(this.it, appl);
        (0, subschema_1.extendSubschemaData)(subschema, this.it, appl);
        (0, subschema_1.extendSubschemaMode)(subschema, appl);
        const nextContext = { ...this.it, ...subschema, items: void 0, props: void 0 };
        subschemaCode(nextContext, valid);
        return nextContext;
      }
      mergeEvaluated(schemaCxt, toName) {
        const { it, gen } = this;
        if (!it.opts.unevaluated)
          return;
        if (it.props !== true && schemaCxt.props !== void 0) {
          it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
        }
        if (it.items !== true && schemaCxt.items !== void 0) {
          it.items = util_1.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
        }
      }
      mergeValidEvaluated(schemaCxt, valid) {
        const { it, gen } = this;
        if (it.opts.unevaluated && (it.props !== true || it.items !== true)) {
          gen.if(valid, () => this.mergeEvaluated(schemaCxt, codegen_1.Name));
          return true;
        }
      }
    };
    exports2.KeywordCxt = KeywordCxt;
    function keywordCode(it, keyword, def, ruleType) {
      const cxt = new KeywordCxt(it, def, keyword);
      if ("code" in def) {
        def.code(cxt, ruleType);
      } else if (cxt.$data && def.validate) {
        (0, keyword_1.funcKeywordCode)(cxt, def);
      } else if ("macro" in def) {
        (0, keyword_1.macroKeywordCode)(cxt, def);
      } else if (def.compile || def.validate) {
        (0, keyword_1.funcKeywordCode)(cxt, def);
      }
    }
    var JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
    var RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
    function getData($data, { dataLevel, dataNames, dataPathArr }) {
      let jsonPointer;
      let data;
      if ($data === "")
        return names_1.default.rootData;
      if ($data[0] === "/") {
        if (!JSON_POINTER.test($data))
          throw new Error(`Invalid JSON-pointer: ${$data}`);
        jsonPointer = $data;
        data = names_1.default.rootData;
      } else {
        const matches = RELATIVE_JSON_POINTER.exec($data);
        if (!matches)
          throw new Error(`Invalid JSON-pointer: ${$data}`);
        const up = +matches[1];
        jsonPointer = matches[2];
        if (jsonPointer === "#") {
          if (up >= dataLevel)
            throw new Error(errorMsg("property/index", up));
          return dataPathArr[dataLevel - up];
        }
        if (up > dataLevel)
          throw new Error(errorMsg("data", up));
        data = dataNames[dataLevel - up];
        if (!jsonPointer)
          return data;
      }
      let expr = data;
      const segments = jsonPointer.split("/");
      for (const segment of segments) {
        if (segment) {
          data = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)((0, util_1.unescapeJsonPointer)(segment))}`;
          expr = (0, codegen_1._)`${expr} && ${data}`;
        }
      }
      return expr;
      function errorMsg(pointerType, up) {
        return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
      }
    }
    exports2.getData = getData;
  }
});

// node_modules/ajv/dist/runtime/validation_error.js
var require_validation_error = __commonJS({
  "node_modules/ajv/dist/runtime/validation_error.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var ValidationError = class extends Error {
      constructor(errors) {
        super("validation failed");
        this.errors = errors;
        this.ajv = this.validation = true;
      }
    };
    exports2.default = ValidationError;
  }
});

// node_modules/ajv/dist/compile/ref_error.js
var require_ref_error = __commonJS({
  "node_modules/ajv/dist/compile/ref_error.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var resolve_1 = require_resolve();
    var MissingRefError = class extends Error {
      constructor(resolver, baseId, ref, msg) {
        super(msg || `can't resolve reference ${ref} from id ${baseId}`);
        this.missingRef = (0, resolve_1.resolveUrl)(resolver, baseId, ref);
        this.missingSchema = (0, resolve_1.normalizeId)((0, resolve_1.getFullPath)(resolver, this.missingRef));
      }
    };
    exports2.default = MissingRefError;
  }
});

// node_modules/ajv/dist/compile/index.js
var require_compile = __commonJS({
  "node_modules/ajv/dist/compile/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.resolveSchema = exports2.getCompilingSchema = exports2.resolveRef = exports2.compileSchema = exports2.SchemaEnv = void 0;
    var codegen_1 = require_codegen();
    var validation_error_1 = require_validation_error();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var validate_1 = require_validate();
    var SchemaEnv = class {
      constructor(env) {
        var _a;
        this.refs = {};
        this.dynamicAnchors = {};
        let schema;
        if (typeof env.schema == "object")
          schema = env.schema;
        this.schema = env.schema;
        this.schemaId = env.schemaId;
        this.root = env.root || this;
        this.baseId = (_a = env.baseId) !== null && _a !== void 0 ? _a : (0, resolve_1.normalizeId)(schema === null || schema === void 0 ? void 0 : schema[env.schemaId || "$id"]);
        this.schemaPath = env.schemaPath;
        this.localRefs = env.localRefs;
        this.meta = env.meta;
        this.$async = schema === null || schema === void 0 ? void 0 : schema.$async;
        this.refs = {};
      }
    };
    exports2.SchemaEnv = SchemaEnv;
    function compileSchema(sch) {
      const _sch = getCompilingSchema.call(this, sch);
      if (_sch)
        return _sch;
      const rootId = (0, resolve_1.getFullPath)(this.opts.uriResolver, sch.root.baseId);
      const { es5, lines } = this.opts.code;
      const { ownProperties } = this.opts;
      const gen = new codegen_1.CodeGen(this.scope, { es5, lines, ownProperties });
      let _ValidationError;
      if (sch.$async) {
        _ValidationError = gen.scopeValue("Error", {
          ref: validation_error_1.default,
          code: (0, codegen_1._)`require("ajv/dist/runtime/validation_error").default`
        });
      }
      const validateName = gen.scopeName("validate");
      sch.validateName = validateName;
      const schemaCxt = {
        gen,
        allErrors: this.opts.allErrors,
        data: names_1.default.data,
        parentData: names_1.default.parentData,
        parentDataProperty: names_1.default.parentDataProperty,
        dataNames: [names_1.default.data],
        dataPathArr: [codegen_1.nil],
        // TODO can its length be used as dataLevel if nil is removed?
        dataLevel: 0,
        dataTypes: [],
        definedProperties: /* @__PURE__ */ new Set(),
        topSchemaRef: gen.scopeValue("schema", this.opts.code.source === true ? { ref: sch.schema, code: (0, codegen_1.stringify)(sch.schema) } : { ref: sch.schema }),
        validateName,
        ValidationError: _ValidationError,
        schema: sch.schema,
        schemaEnv: sch,
        rootId,
        baseId: sch.baseId || rootId,
        schemaPath: codegen_1.nil,
        errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
        errorPath: (0, codegen_1._)`""`,
        opts: this.opts,
        self: this
      };
      let sourceCode;
      try {
        this._compilations.add(sch);
        (0, validate_1.validateFunctionCode)(schemaCxt);
        gen.optimize(this.opts.code.optimize);
        const validateCode = gen.toString();
        sourceCode = `${gen.scopeRefs(names_1.default.scope)}return ${validateCode}`;
        if (this.opts.code.process)
          sourceCode = this.opts.code.process(sourceCode, sch);
        const makeValidate = new Function(`${names_1.default.self}`, `${names_1.default.scope}`, sourceCode);
        const validate = makeValidate(this, this.scope.get());
        this.scope.value(validateName, { ref: validate });
        validate.errors = null;
        validate.schema = sch.schema;
        validate.schemaEnv = sch;
        if (sch.$async)
          validate.$async = true;
        if (this.opts.code.source === true) {
          validate.source = { validateName, validateCode, scopeValues: gen._values };
        }
        if (this.opts.unevaluated) {
          const { props, items } = schemaCxt;
          validate.evaluated = {
            props: props instanceof codegen_1.Name ? void 0 : props,
            items: items instanceof codegen_1.Name ? void 0 : items,
            dynamicProps: props instanceof codegen_1.Name,
            dynamicItems: items instanceof codegen_1.Name
          };
          if (validate.source)
            validate.source.evaluated = (0, codegen_1.stringify)(validate.evaluated);
        }
        sch.validate = validate;
        return sch;
      } catch (e) {
        delete sch.validate;
        delete sch.validateName;
        if (sourceCode)
          this.logger.error("Error compiling schema, function code:", sourceCode);
        throw e;
      } finally {
        this._compilations.delete(sch);
      }
    }
    exports2.compileSchema = compileSchema;
    function resolveRef(root, baseId, ref) {
      var _a;
      ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref);
      const schOrFunc = root.refs[ref];
      if (schOrFunc)
        return schOrFunc;
      let _sch = resolve8.call(this, root, ref);
      if (_sch === void 0) {
        const schema = (_a = root.localRefs) === null || _a === void 0 ? void 0 : _a[ref];
        const { schemaId } = this.opts;
        if (schema)
          _sch = new SchemaEnv({ schema, schemaId, root, baseId });
      }
      if (_sch === void 0)
        return;
      return root.refs[ref] = inlineOrCompile.call(this, _sch);
    }
    exports2.resolveRef = resolveRef;
    function inlineOrCompile(sch) {
      if ((0, resolve_1.inlineRef)(sch.schema, this.opts.inlineRefs))
        return sch.schema;
      return sch.validate ? sch : compileSchema.call(this, sch);
    }
    function getCompilingSchema(schEnv) {
      for (const sch of this._compilations) {
        if (sameSchemaEnv(sch, schEnv))
          return sch;
      }
    }
    exports2.getCompilingSchema = getCompilingSchema;
    function sameSchemaEnv(s1, s2) {
      return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
    }
    function resolve8(root, ref) {
      let sch;
      while (typeof (sch = this.refs[ref]) == "string")
        ref = sch;
      return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
    }
    function resolveSchema(root, ref) {
      const p = this.opts.uriResolver.parse(ref);
      const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
      let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, void 0);
      if (Object.keys(root.schema).length > 0 && refPath === baseId) {
        return getJsonPointer.call(this, p, root);
      }
      const id = (0, resolve_1.normalizeId)(refPath);
      const schOrRef = this.refs[id] || this.schemas[id];
      if (typeof schOrRef == "string") {
        const sch = resolveSchema.call(this, root, schOrRef);
        if (typeof (sch === null || sch === void 0 ? void 0 : sch.schema) !== "object")
          return;
        return getJsonPointer.call(this, p, sch);
      }
      if (typeof (schOrRef === null || schOrRef === void 0 ? void 0 : schOrRef.schema) !== "object")
        return;
      if (!schOrRef.validate)
        compileSchema.call(this, schOrRef);
      if (id === (0, resolve_1.normalizeId)(ref)) {
        const { schema } = schOrRef;
        const { schemaId } = this.opts;
        const schId = schema[schemaId];
        if (schId)
          baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        return new SchemaEnv({ schema, schemaId, root, baseId });
      }
      return getJsonPointer.call(this, p, schOrRef);
    }
    exports2.resolveSchema = resolveSchema;
    var PREVENT_SCOPE_CHANGE = /* @__PURE__ */ new Set([
      "properties",
      "patternProperties",
      "enum",
      "dependencies",
      "definitions"
    ]);
    function getJsonPointer(parsedRef, { baseId, schema, root }) {
      var _a;
      if (((_a = parsedRef.fragment) === null || _a === void 0 ? void 0 : _a[0]) !== "/")
        return;
      for (const part of parsedRef.fragment.slice(1).split("/")) {
        if (typeof schema === "boolean")
          return;
        const partSchema = schema[(0, util_1.unescapeFragment)(part)];
        if (partSchema === void 0)
          return;
        schema = partSchema;
        const schId = typeof schema === "object" && schema[this.opts.schemaId];
        if (!PREVENT_SCOPE_CHANGE.has(part) && schId) {
          baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        }
      }
      let env;
      if (typeof schema != "boolean" && schema.$ref && !(0, util_1.schemaHasRulesButRef)(schema, this.RULES)) {
        const $ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schema.$ref);
        env = resolveSchema.call(this, root, $ref);
      }
      const { schemaId } = this.opts;
      env = env || new SchemaEnv({ schema, schemaId, root, baseId });
      if (env.schema !== env.root.schema)
        return env;
      return void 0;
    }
  }
});

// node_modules/ajv/dist/refs/data.json
var require_data = __commonJS({
  "node_modules/ajv/dist/refs/data.json"(exports2, module2) {
    module2.exports = {
      $id: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#",
      description: "Meta-schema for $data reference (JSON AnySchema extension proposal)",
      type: "object",
      required: ["$data"],
      properties: {
        $data: {
          type: "string",
          anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }]
        }
      },
      additionalProperties: false
    };
  }
});

// node_modules/fast-uri/lib/utils.js
var require_utils = __commonJS({
  "node_modules/fast-uri/lib/utils.js"(exports2, module2) {
    "use strict";
    var isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
    var isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
    var isHexPair = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu);
    var isUnreserved = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu);
    var isPathCharacter = RegExp.prototype.test.bind(/^[\da-z\-._~!$&'()*+,;=:@/]$/iu);
    function stringArrayToHexStripped(input) {
      let acc = "";
      let code = 0;
      let i = 0;
      for (i = 0; i < input.length; i++) {
        code = input[i].charCodeAt(0);
        if (code === 48) {
          continue;
        }
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input[i];
        break;
      }
      for (i += 1; i < input.length; i++) {
        code = input[i].charCodeAt(0);
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input[i];
      }
      return acc;
    }
    var nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
    function consumeIsZone(buffer) {
      buffer.length = 0;
      return true;
    }
    function consumeHextets(buffer, address, output) {
      if (buffer.length) {
        const hex = stringArrayToHexStripped(buffer);
        if (hex !== "") {
          address.push(hex);
        } else {
          output.error = true;
          return false;
        }
        buffer.length = 0;
      }
      return true;
    }
    function getIPV6(input) {
      let tokenCount = 0;
      const output = { error: false, address: "", zone: "" };
      const address = [];
      const buffer = [];
      let endipv6Encountered = false;
      let endIpv6 = false;
      let consume = consumeHextets;
      for (let i = 0; i < input.length; i++) {
        const cursor = input[i];
        if (cursor === "[" || cursor === "]") {
          continue;
        }
        if (cursor === ":") {
          if (endipv6Encountered === true) {
            endIpv6 = true;
          }
          if (!consume(buffer, address, output)) {
            break;
          }
          if (++tokenCount > 7) {
            output.error = true;
            break;
          }
          if (i > 0 && input[i - 1] === ":") {
            endipv6Encountered = true;
          }
          address.push(":");
          continue;
        } else if (cursor === "%") {
          if (!consume(buffer, address, output)) {
            break;
          }
          consume = consumeIsZone;
        } else {
          buffer.push(cursor);
          continue;
        }
      }
      if (buffer.length) {
        if (consume === consumeIsZone) {
          output.zone = buffer.join("");
        } else if (endIpv6) {
          address.push(buffer.join(""));
        } else {
          address.push(stringArrayToHexStripped(buffer));
        }
      }
      output.address = address.join("");
      return output;
    }
    function normalizeIPv6(host) {
      if (findToken(host, ":") < 2) {
        return { host, isIPV6: false };
      }
      const ipv6 = getIPV6(host);
      if (!ipv6.error) {
        let newHost = ipv6.address;
        let escapedHost = ipv6.address;
        if (ipv6.zone) {
          newHost += "%" + ipv6.zone;
          escapedHost += "%25" + ipv6.zone;
        }
        return { host: newHost, isIPV6: true, escapedHost };
      } else {
        return { host, isIPV6: false };
      }
    }
    function findToken(str, token) {
      let ind = 0;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === token) ind++;
      }
      return ind;
    }
    function removeDotSegments(path2) {
      let input = path2;
      const output = [];
      let nextSlash = -1;
      let len = 0;
      while (len = input.length) {
        if (len === 1) {
          if (input === ".") {
            break;
          } else if (input === "/") {
            output.push("/");
            break;
          } else {
            output.push(input);
            break;
          }
        } else if (len === 2) {
          if (input[0] === ".") {
            if (input[1] === ".") {
              break;
            } else if (input[1] === "/") {
              input = input.slice(2);
              continue;
            }
          } else if (input[0] === "/") {
            if (input[1] === "." || input[1] === "/") {
              output.push("/");
              break;
            }
          }
        } else if (len === 3) {
          if (input === "/..") {
            if (output.length !== 0) {
              output.pop();
            }
            output.push("/");
            break;
          }
        }
        if (input[0] === ".") {
          if (input[1] === ".") {
            if (input[2] === "/") {
              input = input.slice(3);
              continue;
            }
          } else if (input[1] === "/") {
            input = input.slice(2);
            continue;
          }
        } else if (input[0] === "/") {
          if (input[1] === ".") {
            if (input[2] === "/") {
              input = input.slice(2);
              continue;
            } else if (input[2] === ".") {
              if (input[3] === "/") {
                input = input.slice(3);
                if (output.length !== 0) {
                  output.pop();
                }
                continue;
              }
            }
          }
        }
        if ((nextSlash = input.indexOf("/", 1)) === -1) {
          output.push(input);
          break;
        } else {
          output.push(input.slice(0, nextSlash));
          input = input.slice(nextSlash);
        }
      }
      return output.join("");
    }
    var HOST_DELIMS = { "@": "%40", "/": "%2F", "?": "%3F", "#": "%23", ":": "%3A" };
    var HOST_DELIM_RE = /[@/?#:]/g;
    var HOST_DELIM_NO_COLON_RE = /[@/?#]/g;
    function reescapeHostDelimiters(host, isIP) {
      const re = isIP ? HOST_DELIM_NO_COLON_RE : HOST_DELIM_RE;
      re.lastIndex = 0;
      return host.replace(re, (ch) => HOST_DELIMS[ch]);
    }
    function normalizePercentEncoding(input, decodeUnreserved = false) {
      if (input.indexOf("%") === -1) {
        return input;
      }
      let output = "";
      for (let i = 0; i < input.length; i++) {
        if (input[i] === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (decodeUnreserved && isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        output += input[i];
      }
      return output;
    }
    function normalizePathEncoding(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        if (input[i] === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (decoded !== "." && isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        if (isPathCharacter(input[i])) {
          output += input[i];
        } else {
          output += escape(input[i]);
        }
      }
      return output;
    }
    function escapePreservingEscapes(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        if (input[i] === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            output += "%" + hex.toUpperCase();
            i += 2;
            continue;
          }
        }
        output += escape(input[i]);
      }
      return output;
    }
    function recomposeAuthority(component) {
      const uriTokens = [];
      if (component.userinfo !== void 0) {
        uriTokens.push(component.userinfo);
        uriTokens.push("@");
      }
      if (component.host !== void 0) {
        let host = unescape(component.host);
        if (!isIPv4(host)) {
          const ipV6res = normalizeIPv6(host);
          if (ipV6res.isIPV6 === true) {
            host = `[${ipV6res.escapedHost}]`;
          } else {
            host = reescapeHostDelimiters(host, false);
          }
        }
        uriTokens.push(host);
      }
      if (typeof component.port === "number" || typeof component.port === "string") {
        uriTokens.push(":");
        uriTokens.push(String(component.port));
      }
      return uriTokens.length ? uriTokens.join("") : void 0;
    }
    module2.exports = {
      nonSimpleDomain,
      recomposeAuthority,
      reescapeHostDelimiters,
      normalizePercentEncoding,
      normalizePathEncoding,
      escapePreservingEscapes,
      removeDotSegments,
      isIPv4,
      isUUID,
      normalizeIPv6,
      stringArrayToHexStripped
    };
  }
});

// node_modules/fast-uri/lib/schemes.js
var require_schemes = __commonJS({
  "node_modules/fast-uri/lib/schemes.js"(exports2, module2) {
    "use strict";
    var { isUUID } = require_utils();
    var URN_REG = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;
    var supportedSchemeNames = (
      /** @type {const} */
      [
        "http",
        "https",
        "ws",
        "wss",
        "urn",
        "urn:uuid"
      ]
    );
    function isValidSchemeName(name) {
      return supportedSchemeNames.indexOf(
        /** @type {*} */
        name
      ) !== -1;
    }
    function wsIsSecure(wsComponent) {
      if (wsComponent.secure === true) {
        return true;
      } else if (wsComponent.secure === false) {
        return false;
      } else if (wsComponent.scheme) {
        return wsComponent.scheme.length === 3 && (wsComponent.scheme[0] === "w" || wsComponent.scheme[0] === "W") && (wsComponent.scheme[1] === "s" || wsComponent.scheme[1] === "S") && (wsComponent.scheme[2] === "s" || wsComponent.scheme[2] === "S");
      } else {
        return false;
      }
    }
    function httpParse(component) {
      if (!component.host) {
        component.error = component.error || "HTTP URIs must have a host.";
      }
      return component;
    }
    function httpSerialize(component) {
      const secure = String(component.scheme).toLowerCase() === "https";
      if (component.port === (secure ? 443 : 80) || component.port === "") {
        component.port = void 0;
      }
      if (!component.path) {
        component.path = "/";
      }
      return component;
    }
    function wsParse(wsComponent) {
      wsComponent.secure = wsIsSecure(wsComponent);
      wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : "");
      wsComponent.path = void 0;
      wsComponent.query = void 0;
      return wsComponent;
    }
    function wsSerialize(wsComponent) {
      if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "") {
        wsComponent.port = void 0;
      }
      if (typeof wsComponent.secure === "boolean") {
        wsComponent.scheme = wsComponent.secure ? "wss" : "ws";
        wsComponent.secure = void 0;
      }
      if (wsComponent.resourceName) {
        const [path2, query] = wsComponent.resourceName.split("?");
        wsComponent.path = path2 && path2 !== "/" ? path2 : void 0;
        wsComponent.query = query;
        wsComponent.resourceName = void 0;
      }
      wsComponent.fragment = void 0;
      return wsComponent;
    }
    function urnParse(urnComponent, options) {
      if (!urnComponent.path) {
        urnComponent.error = "URN can not be parsed";
        return urnComponent;
      }
      const matches = urnComponent.path.match(URN_REG);
      if (matches) {
        const scheme = options.scheme || urnComponent.scheme || "urn";
        urnComponent.nid = matches[1].toLowerCase();
        urnComponent.nss = matches[2];
        const urnScheme = `${scheme}:${options.nid || urnComponent.nid}`;
        const schemeHandler = getSchemeHandler(urnScheme);
        urnComponent.path = void 0;
        if (schemeHandler) {
          urnComponent = schemeHandler.parse(urnComponent, options);
        }
      } else {
        urnComponent.error = urnComponent.error || "URN can not be parsed.";
      }
      return urnComponent;
    }
    function urnSerialize(urnComponent, options) {
      if (urnComponent.nid === void 0) {
        throw new Error("URN without nid cannot be serialized");
      }
      const scheme = options.scheme || urnComponent.scheme || "urn";
      const nid = urnComponent.nid.toLowerCase();
      const urnScheme = `${scheme}:${options.nid || nid}`;
      const schemeHandler = getSchemeHandler(urnScheme);
      if (schemeHandler) {
        urnComponent = schemeHandler.serialize(urnComponent, options);
      }
      const uriComponent = urnComponent;
      const nss = urnComponent.nss;
      uriComponent.path = `${nid || options.nid}:${nss}`;
      options.skipEscape = true;
      return uriComponent;
    }
    function urnuuidParse(urnComponent, options) {
      const uuidComponent = urnComponent;
      uuidComponent.uuid = uuidComponent.nss;
      uuidComponent.nss = void 0;
      if (!options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid))) {
        uuidComponent.error = uuidComponent.error || "UUID is not valid.";
      }
      return uuidComponent;
    }
    function urnuuidSerialize(uuidComponent) {
      const urnComponent = uuidComponent;
      urnComponent.nss = (uuidComponent.uuid || "").toLowerCase();
      return urnComponent;
    }
    var http = (
      /** @type {SchemeHandler} */
      {
        scheme: "http",
        domainHost: true,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var https = (
      /** @type {SchemeHandler} */
      {
        scheme: "https",
        domainHost: http.domainHost,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var ws = (
      /** @type {SchemeHandler} */
      {
        scheme: "ws",
        domainHost: true,
        parse: wsParse,
        serialize: wsSerialize
      }
    );
    var wss = (
      /** @type {SchemeHandler} */
      {
        scheme: "wss",
        domainHost: ws.domainHost,
        parse: ws.parse,
        serialize: ws.serialize
      }
    );
    var urn = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn",
        parse: urnParse,
        serialize: urnSerialize,
        skipNormalize: true
      }
    );
    var urnuuid = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn:uuid",
        parse: urnuuidParse,
        serialize: urnuuidSerialize,
        skipNormalize: true
      }
    );
    var SCHEMES = (
      /** @type {Record<SchemeName, SchemeHandler>} */
      {
        http,
        https,
        ws,
        wss,
        urn,
        "urn:uuid": urnuuid
      }
    );
    Object.setPrototypeOf(SCHEMES, null);
    function getSchemeHandler(scheme) {
      return scheme && (SCHEMES[
        /** @type {SchemeName} */
        scheme
      ] || SCHEMES[
        /** @type {SchemeName} */
        scheme.toLowerCase()
      ]) || void 0;
    }
    module2.exports = {
      wsIsSecure,
      SCHEMES,
      isValidSchemeName,
      getSchemeHandler
    };
  }
});

// node_modules/fast-uri/index.js
var require_fast_uri = __commonJS({
  "node_modules/fast-uri/index.js"(exports2, module2) {
    "use strict";
    var { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizePercentEncoding, normalizePathEncoding, escapePreservingEscapes, reescapeHostDelimiters, isIPv4, nonSimpleDomain } = require_utils();
    var { SCHEMES, getSchemeHandler } = require_schemes();
    function normalize(uri, options) {
      if (typeof uri === "string") {
        uri = /** @type {T} */
        normalizeString(uri, options);
      } else if (typeof uri === "object") {
        uri = /** @type {T} */
        parse2(serialize(uri, options), options);
      }
      return uri;
    }
    function resolve8(baseURI, relativeURI, options) {
      const schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" };
      const resolved = resolveComponent(parse2(baseURI, schemelessOptions), parse2(relativeURI, schemelessOptions), schemelessOptions, true);
      schemelessOptions.skipEscape = true;
      return serialize(resolved, schemelessOptions);
    }
    function resolveComponent(base, relative3, options, skipNormalization) {
      const target = {};
      if (!skipNormalization) {
        base = parse2(serialize(base, options), options);
        relative3 = parse2(serialize(relative3, options), options);
      }
      options = options || {};
      if (!options.tolerant && relative3.scheme) {
        target.scheme = relative3.scheme;
        target.userinfo = relative3.userinfo;
        target.host = relative3.host;
        target.port = relative3.port;
        target.path = removeDotSegments(relative3.path || "");
        target.query = relative3.query;
      } else {
        if (relative3.userinfo !== void 0 || relative3.host !== void 0 || relative3.port !== void 0) {
          target.userinfo = relative3.userinfo;
          target.host = relative3.host;
          target.port = relative3.port;
          target.path = removeDotSegments(relative3.path || "");
          target.query = relative3.query;
        } else {
          if (!relative3.path) {
            target.path = base.path;
            if (relative3.query !== void 0) {
              target.query = relative3.query;
            } else {
              target.query = base.query;
            }
          } else {
            if (relative3.path[0] === "/") {
              target.path = removeDotSegments(relative3.path);
            } else {
              if ((base.userinfo !== void 0 || base.host !== void 0 || base.port !== void 0) && !base.path) {
                target.path = "/" + relative3.path;
              } else if (!base.path) {
                target.path = relative3.path;
              } else {
                target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative3.path;
              }
              target.path = removeDotSegments(target.path);
            }
            target.query = relative3.query;
          }
          target.userinfo = base.userinfo;
          target.host = base.host;
          target.port = base.port;
        }
        target.scheme = base.scheme;
      }
      target.fragment = relative3.fragment;
      return target;
    }
    function equal(uriA, uriB, options) {
      const normalizedA = normalizeComparableURI(uriA, options);
      const normalizedB = normalizeComparableURI(uriB, options);
      return normalizedA !== void 0 && normalizedB !== void 0 && normalizedA.toLowerCase() === normalizedB.toLowerCase();
    }
    function serialize(cmpts, opts) {
      const component = {
        host: cmpts.host,
        scheme: cmpts.scheme,
        userinfo: cmpts.userinfo,
        port: cmpts.port,
        path: cmpts.path,
        query: cmpts.query,
        nid: cmpts.nid,
        nss: cmpts.nss,
        uuid: cmpts.uuid,
        fragment: cmpts.fragment,
        reference: cmpts.reference,
        resourceName: cmpts.resourceName,
        secure: cmpts.secure,
        error: ""
      };
      const options = Object.assign({}, opts);
      const uriTokens = [];
      const schemeHandler = getSchemeHandler(options.scheme || component.scheme);
      if (schemeHandler && schemeHandler.serialize) schemeHandler.serialize(component, options);
      if (component.path !== void 0) {
        if (!options.skipEscape) {
          component.path = escapePreservingEscapes(component.path);
          if (component.scheme !== void 0) {
            component.path = component.path.split("%3A").join(":");
          }
        } else {
          component.path = normalizePercentEncoding(component.path);
        }
      }
      if (options.reference !== "suffix" && component.scheme) {
        uriTokens.push(component.scheme, ":");
      }
      const authority = recomposeAuthority(component);
      if (authority !== void 0) {
        if (options.reference !== "suffix") {
          uriTokens.push("//");
        }
        uriTokens.push(authority);
        if (component.path && component.path[0] !== "/") {
          uriTokens.push("/");
        }
      }
      if (component.path !== void 0) {
        let s = component.path;
        if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
          s = removeDotSegments(s);
        }
        if (authority === void 0 && s[0] === "/" && s[1] === "/") {
          s = "/%2F" + s.slice(2);
        }
        uriTokens.push(s);
      }
      if (component.query !== void 0) {
        uriTokens.push("?", component.query);
      }
      if (component.fragment !== void 0) {
        uriTokens.push("#", component.fragment);
      }
      return uriTokens.join("");
    }
    var URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
    function getParseError(parsed, matches) {
      if (matches[2] !== void 0 && parsed.path && parsed.path[0] !== "/") {
        return 'URI path must start with "/" when authority is present.';
      }
      if (typeof parsed.port === "number" && (parsed.port < 0 || parsed.port > 65535)) {
        return "URI port is malformed.";
      }
      return void 0;
    }
    function parseWithStatus(uri, opts) {
      const options = Object.assign({}, opts);
      const parsed = {
        scheme: void 0,
        userinfo: void 0,
        host: "",
        port: void 0,
        path: "",
        query: void 0,
        fragment: void 0
      };
      let malformedAuthorityOrPort = false;
      let isIP = false;
      if (options.reference === "suffix") {
        if (options.scheme) {
          uri = options.scheme + ":" + uri;
        } else {
          uri = "//" + uri;
        }
      }
      const matches = uri.match(URI_PARSE);
      if (matches) {
        parsed.scheme = matches[1];
        parsed.userinfo = matches[3];
        parsed.host = matches[4];
        parsed.port = parseInt(matches[5], 10);
        parsed.path = matches[6] || "";
        parsed.query = matches[7];
        parsed.fragment = matches[8];
        if (isNaN(parsed.port)) {
          parsed.port = matches[5];
        }
        const parseError = getParseError(parsed, matches);
        if (parseError !== void 0) {
          parsed.error = parsed.error || parseError;
          malformedAuthorityOrPort = true;
        }
        if (parsed.host) {
          const ipv4result = isIPv4(parsed.host);
          if (ipv4result === false) {
            const ipv6result = normalizeIPv6(parsed.host);
            parsed.host = ipv6result.host.toLowerCase();
            isIP = ipv6result.isIPV6;
          } else {
            isIP = true;
          }
        }
        if (parsed.scheme === void 0 && parsed.userinfo === void 0 && parsed.host === void 0 && parsed.port === void 0 && parsed.query === void 0 && !parsed.path) {
          parsed.reference = "same-document";
        } else if (parsed.scheme === void 0) {
          parsed.reference = "relative";
        } else if (parsed.fragment === void 0) {
          parsed.reference = "absolute";
        } else {
          parsed.reference = "uri";
        }
        if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference) {
          parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
        }
        const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
        if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport)) {
          if (parsed.host && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === false && nonSimpleDomain(parsed.host)) {
            try {
              parsed.host = URL.domainToASCII(parsed.host.toLowerCase());
            } catch (e) {
              parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
            }
          }
        }
        if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
          if (uri.indexOf("%") !== -1) {
            if (parsed.scheme !== void 0) {
              parsed.scheme = unescape(parsed.scheme);
            }
            if (parsed.host !== void 0) {
              parsed.host = reescapeHostDelimiters(unescape(parsed.host), isIP);
            }
          }
          if (parsed.path) {
            parsed.path = normalizePathEncoding(parsed.path);
          }
          if (parsed.fragment) {
            try {
              parsed.fragment = encodeURI(decodeURIComponent(parsed.fragment));
            } catch {
              parsed.error = parsed.error || "URI malformed";
            }
          }
        }
        if (schemeHandler && schemeHandler.parse) {
          schemeHandler.parse(parsed, options);
        }
      } else {
        parsed.error = parsed.error || "URI can not be parsed.";
      }
      return { parsed, malformedAuthorityOrPort };
    }
    function parse2(uri, opts) {
      return parseWithStatus(uri, opts).parsed;
    }
    function normalizeString(uri, opts) {
      return normalizeStringWithStatus(uri, opts).normalized;
    }
    function normalizeStringWithStatus(uri, opts) {
      const { parsed, malformedAuthorityOrPort } = parseWithStatus(uri, opts);
      return {
        normalized: malformedAuthorityOrPort ? uri : serialize(parsed, opts),
        malformedAuthorityOrPort
      };
    }
    function normalizeComparableURI(uri, opts) {
      if (typeof uri === "string") {
        const { normalized, malformedAuthorityOrPort } = normalizeStringWithStatus(uri, opts);
        return malformedAuthorityOrPort ? void 0 : normalized;
      }
      if (typeof uri === "object") {
        return serialize(uri, opts);
      }
    }
    var fastUri = {
      SCHEMES,
      normalize,
      resolve: resolve8,
      resolveComponent,
      equal,
      serialize,
      parse: parse2
    };
    module2.exports = fastUri;
    module2.exports.default = fastUri;
    module2.exports.fastUri = fastUri;
  }
});

// node_modules/ajv/dist/runtime/uri.js
var require_uri = __commonJS({
  "node_modules/ajv/dist/runtime/uri.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var uri = require_fast_uri();
    uri.code = 'require("ajv/dist/runtime/uri").default';
    exports2.default = uri;
  }
});

// node_modules/ajv/dist/core.js
var require_core = __commonJS({
  "node_modules/ajv/dist/core.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.CodeGen = exports2.Name = exports2.nil = exports2.stringify = exports2.str = exports2._ = exports2.KeywordCxt = void 0;
    var validate_1 = require_validate();
    Object.defineProperty(exports2, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports2, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports2, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports2, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports2, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports2, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports2, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    var ref_error_1 = require_ref_error();
    var rules_1 = require_rules();
    var compile_1 = require_compile();
    var codegen_2 = require_codegen();
    var resolve_1 = require_resolve();
    var dataType_1 = require_dataType();
    var util_1 = require_util();
    var $dataRefSchema = require_data();
    var uri_1 = require_uri();
    var defaultRegExp = (str, flags) => new RegExp(str, flags);
    defaultRegExp.code = "new RegExp";
    var META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"];
    var EXT_SCOPE_NAMES = /* @__PURE__ */ new Set([
      "validate",
      "serialize",
      "parse",
      "wrapper",
      "root",
      "schema",
      "keyword",
      "pattern",
      "formats",
      "validate$data",
      "func",
      "obj",
      "Error"
    ]);
    var removedOptions = {
      errorDataPath: "",
      format: "`validateFormats: false` can be used instead.",
      nullable: '"nullable" keyword is supported by default.',
      jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
      extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
      missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
      processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
      sourceCode: "Use option `code: {source: true}`",
      strictDefaults: "It is default now, see option `strict`.",
      strictKeywords: "It is default now, see option `strict`.",
      uniqueItems: '"uniqueItems" keyword is always validated.',
      unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
      cache: "Map is used as cache, schema object as key.",
      serialize: "Map is used as cache, schema object as key.",
      ajvErrors: "It is default now."
    };
    var deprecatedOptions = {
      ignoreKeywordsWithRef: "",
      jsPropertySyntax: "",
      unicode: '"minLength"/"maxLength" account for unicode characters by default.'
    };
    var MAX_EXPRESSION = 200;
    function requiredOptions(o) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
      const s = o.strict;
      const _optz = (_a = o.code) === null || _a === void 0 ? void 0 : _a.optimize;
      const optimize = _optz === true || _optz === void 0 ? 1 : _optz || 0;
      const regExp = (_c = (_b = o.code) === null || _b === void 0 ? void 0 : _b.regExp) !== null && _c !== void 0 ? _c : defaultRegExp;
      const uriResolver = (_d = o.uriResolver) !== null && _d !== void 0 ? _d : uri_1.default;
      return {
        strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== void 0 ? _e : s) !== null && _f !== void 0 ? _f : true,
        strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== void 0 ? _g : s) !== null && _h !== void 0 ? _h : true,
        strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== void 0 ? _j : s) !== null && _k !== void 0 ? _k : "log",
        strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== void 0 ? _l : s) !== null && _m !== void 0 ? _m : "log",
        strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== void 0 ? _o : s) !== null && _p !== void 0 ? _p : false,
        code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
        loopRequired: (_q = o.loopRequired) !== null && _q !== void 0 ? _q : MAX_EXPRESSION,
        loopEnum: (_r = o.loopEnum) !== null && _r !== void 0 ? _r : MAX_EXPRESSION,
        meta: (_s = o.meta) !== null && _s !== void 0 ? _s : true,
        messages: (_t = o.messages) !== null && _t !== void 0 ? _t : true,
        inlineRefs: (_u = o.inlineRefs) !== null && _u !== void 0 ? _u : true,
        schemaId: (_v = o.schemaId) !== null && _v !== void 0 ? _v : "$id",
        addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== void 0 ? _w : true,
        validateSchema: (_x = o.validateSchema) !== null && _x !== void 0 ? _x : true,
        validateFormats: (_y = o.validateFormats) !== null && _y !== void 0 ? _y : true,
        unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== void 0 ? _z : true,
        int32range: (_0 = o.int32range) !== null && _0 !== void 0 ? _0 : true,
        uriResolver
      };
    }
    var Ajv2 = class {
      constructor(opts = {}) {
        this.schemas = {};
        this.refs = {};
        this.formats = {};
        this._compilations = /* @__PURE__ */ new Set();
        this._loading = {};
        this._cache = /* @__PURE__ */ new Map();
        opts = this.opts = { ...opts, ...requiredOptions(opts) };
        const { es5, lines } = this.opts.code;
        this.scope = new codegen_2.ValueScope({ scope: {}, prefixes: EXT_SCOPE_NAMES, es5, lines });
        this.logger = getLogger(opts.logger);
        const formatOpt = opts.validateFormats;
        opts.validateFormats = false;
        this.RULES = (0, rules_1.getRules)();
        checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED");
        checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn");
        this._metaOpts = getMetaSchemaOptions.call(this);
        if (opts.formats)
          addInitialFormats.call(this);
        this._addVocabularies();
        this._addDefaultMetaSchema();
        if (opts.keywords)
          addInitialKeywords.call(this, opts.keywords);
        if (typeof opts.meta == "object")
          this.addMetaSchema(opts.meta);
        addInitialSchemas.call(this);
        opts.validateFormats = formatOpt;
      }
      _addVocabularies() {
        this.addKeyword("$async");
      }
      _addDefaultMetaSchema() {
        const { $data, meta, schemaId } = this.opts;
        let _dataRefSchema = $dataRefSchema;
        if (schemaId === "id") {
          _dataRefSchema = { ...$dataRefSchema };
          _dataRefSchema.id = _dataRefSchema.$id;
          delete _dataRefSchema.$id;
        }
        if (meta && $data)
          this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], false);
      }
      defaultMeta() {
        const { meta, schemaId } = this.opts;
        return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : void 0;
      }
      validate(schemaKeyRef, data) {
        let v;
        if (typeof schemaKeyRef == "string") {
          v = this.getSchema(schemaKeyRef);
          if (!v)
            throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
        } else {
          v = this.compile(schemaKeyRef);
        }
        const valid = v(data);
        if (!("$async" in v))
          this.errors = v.errors;
        return valid;
      }
      compile(schema, _meta) {
        const sch = this._addSchema(schema, _meta);
        return sch.validate || this._compileSchemaEnv(sch);
      }
      compileAsync(schema, meta) {
        if (typeof this.opts.loadSchema != "function") {
          throw new Error("options.loadSchema should be a function");
        }
        const { loadSchema } = this.opts;
        return runCompileAsync.call(this, schema, meta);
        async function runCompileAsync(_schema, _meta) {
          await loadMetaSchema.call(this, _schema.$schema);
          const sch = this._addSchema(_schema, _meta);
          return sch.validate || _compileAsync.call(this, sch);
        }
        async function loadMetaSchema($ref) {
          if ($ref && !this.getSchema($ref)) {
            await runCompileAsync.call(this, { $ref }, true);
          }
        }
        async function _compileAsync(sch) {
          try {
            return this._compileSchemaEnv(sch);
          } catch (e) {
            if (!(e instanceof ref_error_1.default))
              throw e;
            checkLoaded.call(this, e);
            await loadMissingSchema.call(this, e.missingSchema);
            return _compileAsync.call(this, sch);
          }
        }
        function checkLoaded({ missingSchema: ref, missingRef }) {
          if (this.refs[ref]) {
            throw new Error(`AnySchema ${ref} is loaded but ${missingRef} cannot be resolved`);
          }
        }
        async function loadMissingSchema(ref) {
          const _schema = await _loadSchema.call(this, ref);
          if (!this.refs[ref])
            await loadMetaSchema.call(this, _schema.$schema);
          if (!this.refs[ref])
            this.addSchema(_schema, ref, meta);
        }
        async function _loadSchema(ref) {
          const p = this._loading[ref];
          if (p)
            return p;
          try {
            return await (this._loading[ref] = loadSchema(ref));
          } finally {
            delete this._loading[ref];
          }
        }
      }
      // Adds schema to the instance
      addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
        if (Array.isArray(schema)) {
          for (const sch of schema)
            this.addSchema(sch, void 0, _meta, _validateSchema);
          return this;
        }
        let id;
        if (typeof schema === "object") {
          const { schemaId } = this.opts;
          id = schema[schemaId];
          if (id !== void 0 && typeof id != "string") {
            throw new Error(`schema ${schemaId} must be string`);
          }
        }
        key = (0, resolve_1.normalizeId)(key || id);
        this._checkUnique(key);
        this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
        return this;
      }
      // Add schema that will be used to validate other schemas
      // options in META_IGNORE_OPTIONS are alway set to false
      addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
        this.addSchema(schema, key, true, _validateSchema);
        return this;
      }
      //  Validate schema against its meta-schema
      validateSchema(schema, throwOrLogError) {
        if (typeof schema == "boolean")
          return true;
        let $schema;
        $schema = schema.$schema;
        if ($schema !== void 0 && typeof $schema != "string") {
          throw new Error("$schema must be a string");
        }
        $schema = $schema || this.opts.defaultMeta || this.defaultMeta();
        if (!$schema) {
          this.logger.warn("meta-schema not available");
          this.errors = null;
          return true;
        }
        const valid = this.validate($schema, schema);
        if (!valid && throwOrLogError) {
          const message = "schema is invalid: " + this.errorsText();
          if (this.opts.validateSchema === "log")
            this.logger.error(message);
          else
            throw new Error(message);
        }
        return valid;
      }
      // Get compiled schema by `key` or `ref`.
      // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
      getSchema(keyRef) {
        let sch;
        while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
          keyRef = sch;
        if (sch === void 0) {
          const { schemaId } = this.opts;
          const root = new compile_1.SchemaEnv({ schema: {}, schemaId });
          sch = compile_1.resolveSchema.call(this, root, keyRef);
          if (!sch)
            return;
          this.refs[keyRef] = sch;
        }
        return sch.validate || this._compileSchemaEnv(sch);
      }
      // Remove cached schema(s).
      // If no parameter is passed all schemas but meta-schemas are removed.
      // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
      // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
      removeSchema(schemaKeyRef) {
        if (schemaKeyRef instanceof RegExp) {
          this._removeAllSchemas(this.schemas, schemaKeyRef);
          this._removeAllSchemas(this.refs, schemaKeyRef);
          return this;
        }
        switch (typeof schemaKeyRef) {
          case "undefined":
            this._removeAllSchemas(this.schemas);
            this._removeAllSchemas(this.refs);
            this._cache.clear();
            return this;
          case "string": {
            const sch = getSchEnv.call(this, schemaKeyRef);
            if (typeof sch == "object")
              this._cache.delete(sch.schema);
            delete this.schemas[schemaKeyRef];
            delete this.refs[schemaKeyRef];
            return this;
          }
          case "object": {
            const cacheKey = schemaKeyRef;
            this._cache.delete(cacheKey);
            let id = schemaKeyRef[this.opts.schemaId];
            if (id) {
              id = (0, resolve_1.normalizeId)(id);
              delete this.schemas[id];
              delete this.refs[id];
            }
            return this;
          }
          default:
            throw new Error("ajv.removeSchema: invalid parameter");
        }
      }
      // add "vocabulary" - a collection of keywords
      addVocabulary(definitions) {
        for (const def of definitions)
          this.addKeyword(def);
        return this;
      }
      addKeyword(kwdOrDef, def) {
        let keyword;
        if (typeof kwdOrDef == "string") {
          keyword = kwdOrDef;
          if (typeof def == "object") {
            this.logger.warn("these parameters are deprecated, see docs for addKeyword");
            def.keyword = keyword;
          }
        } else if (typeof kwdOrDef == "object" && def === void 0) {
          def = kwdOrDef;
          keyword = def.keyword;
          if (Array.isArray(keyword) && !keyword.length) {
            throw new Error("addKeywords: keyword must be string or non-empty array");
          }
        } else {
          throw new Error("invalid addKeywords parameters");
        }
        checkKeyword.call(this, keyword, def);
        if (!def) {
          (0, util_1.eachItem)(keyword, (kwd) => addRule.call(this, kwd));
          return this;
        }
        keywordMetaschema.call(this, def);
        const definition = {
          ...def,
          type: (0, dataType_1.getJSONTypes)(def.type),
          schemaType: (0, dataType_1.getJSONTypes)(def.schemaType)
        };
        (0, util_1.eachItem)(keyword, definition.type.length === 0 ? (k) => addRule.call(this, k, definition) : (k) => definition.type.forEach((t) => addRule.call(this, k, definition, t)));
        return this;
      }
      getKeyword(keyword) {
        const rule = this.RULES.all[keyword];
        return typeof rule == "object" ? rule.definition : !!rule;
      }
      // Remove keyword
      removeKeyword(keyword) {
        const { RULES } = this;
        delete RULES.keywords[keyword];
        delete RULES.all[keyword];
        for (const group of RULES.rules) {
          const i = group.rules.findIndex((rule) => rule.keyword === keyword);
          if (i >= 0)
            group.rules.splice(i, 1);
        }
        return this;
      }
      // Add format
      addFormat(name, format) {
        if (typeof format == "string")
          format = new RegExp(format);
        this.formats[name] = format;
        return this;
      }
      errorsText(errors = this.errors, { separator = ", ", dataVar = "data" } = {}) {
        if (!errors || errors.length === 0)
          return "No errors";
        return errors.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text, msg) => text + separator + msg);
      }
      $dataMetaSchema(metaSchema, keywordsJsonPointers) {
        const rules = this.RULES.all;
        metaSchema = JSON.parse(JSON.stringify(metaSchema));
        for (const jsonPointer of keywordsJsonPointers) {
          const segments = jsonPointer.split("/").slice(1);
          let keywords = metaSchema;
          for (const seg of segments)
            keywords = keywords[seg];
          for (const key in rules) {
            const rule = rules[key];
            if (typeof rule != "object")
              continue;
            const { $data } = rule.definition;
            const schema = keywords[key];
            if ($data && schema)
              keywords[key] = schemaOrData(schema);
          }
        }
        return metaSchema;
      }
      _removeAllSchemas(schemas, regex) {
        for (const keyRef in schemas) {
          const sch = schemas[keyRef];
          if (!regex || regex.test(keyRef)) {
            if (typeof sch == "string") {
              delete schemas[keyRef];
            } else if (sch && !sch.meta) {
              this._cache.delete(sch.schema);
              delete schemas[keyRef];
            }
          }
        }
      }
      _addSchema(schema, meta, baseId, validateSchema = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
        let id;
        const { schemaId } = this.opts;
        if (typeof schema == "object") {
          id = schema[schemaId];
        } else {
          if (this.opts.jtd)
            throw new Error("schema must be object");
          else if (typeof schema != "boolean")
            throw new Error("schema must be object or boolean");
        }
        let sch = this._cache.get(schema);
        if (sch !== void 0)
          return sch;
        baseId = (0, resolve_1.normalizeId)(id || baseId);
        const localRefs = resolve_1.getSchemaRefs.call(this, schema, baseId);
        sch = new compile_1.SchemaEnv({ schema, schemaId, meta, baseId, localRefs });
        this._cache.set(sch.schema, sch);
        if (addSchema && !baseId.startsWith("#")) {
          if (baseId)
            this._checkUnique(baseId);
          this.refs[baseId] = sch;
        }
        if (validateSchema)
          this.validateSchema(schema, true);
        return sch;
      }
      _checkUnique(id) {
        if (this.schemas[id] || this.refs[id]) {
          throw new Error(`schema with key or id "${id}" already exists`);
        }
      }
      _compileSchemaEnv(sch) {
        if (sch.meta)
          this._compileMetaSchema(sch);
        else
          compile_1.compileSchema.call(this, sch);
        if (!sch.validate)
          throw new Error("ajv implementation error");
        return sch.validate;
      }
      _compileMetaSchema(sch) {
        const currentOpts = this.opts;
        this.opts = this._metaOpts;
        try {
          compile_1.compileSchema.call(this, sch);
        } finally {
          this.opts = currentOpts;
        }
      }
    };
    Ajv2.ValidationError = validation_error_1.default;
    Ajv2.MissingRefError = ref_error_1.default;
    exports2.default = Ajv2;
    function checkOptions(checkOpts, options, msg, log = "error") {
      for (const key in checkOpts) {
        const opt = key;
        if (opt in options)
          this.logger[log](`${msg}: option ${key}. ${checkOpts[opt]}`);
      }
    }
    function getSchEnv(keyRef) {
      keyRef = (0, resolve_1.normalizeId)(keyRef);
      return this.schemas[keyRef] || this.refs[keyRef];
    }
    function addInitialSchemas() {
      const optsSchemas = this.opts.schemas;
      if (!optsSchemas)
        return;
      if (Array.isArray(optsSchemas))
        this.addSchema(optsSchemas);
      else
        for (const key in optsSchemas)
          this.addSchema(optsSchemas[key], key);
    }
    function addInitialFormats() {
      for (const name in this.opts.formats) {
        const format = this.opts.formats[name];
        if (format)
          this.addFormat(name, format);
      }
    }
    function addInitialKeywords(defs) {
      if (Array.isArray(defs)) {
        this.addVocabulary(defs);
        return;
      }
      this.logger.warn("keywords option as map is deprecated, pass array");
      for (const keyword in defs) {
        const def = defs[keyword];
        if (!def.keyword)
          def.keyword = keyword;
        this.addKeyword(def);
      }
    }
    function getMetaSchemaOptions() {
      const metaOpts = { ...this.opts };
      for (const opt of META_IGNORE_OPTIONS)
        delete metaOpts[opt];
      return metaOpts;
    }
    var noLogs = { log() {
    }, warn() {
    }, error() {
    } };
    function getLogger(logger) {
      if (logger === false)
        return noLogs;
      if (logger === void 0)
        return console;
      if (logger.log && logger.warn && logger.error)
        return logger;
      throw new Error("logger must implement log, warn and error methods");
    }
    var KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
    function checkKeyword(keyword, def) {
      const { RULES } = this;
      (0, util_1.eachItem)(keyword, (kwd) => {
        if (RULES.keywords[kwd])
          throw new Error(`Keyword ${kwd} is already defined`);
        if (!KEYWORD_NAME.test(kwd))
          throw new Error(`Keyword ${kwd} has invalid name`);
      });
      if (!def)
        return;
      if (def.$data && !("code" in def || "validate" in def)) {
        throw new Error('$data keyword must have "code" or "validate" function');
      }
    }
    function addRule(keyword, definition, dataType) {
      var _a;
      const post = definition === null || definition === void 0 ? void 0 : definition.post;
      if (dataType && post)
        throw new Error('keyword with "post" flag cannot have "type"');
      const { RULES } = this;
      let ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t }) => t === dataType);
      if (!ruleGroup) {
        ruleGroup = { type: dataType, rules: [] };
        RULES.rules.push(ruleGroup);
      }
      RULES.keywords[keyword] = true;
      if (!definition)
        return;
      const rule = {
        keyword,
        definition: {
          ...definition,
          type: (0, dataType_1.getJSONTypes)(definition.type),
          schemaType: (0, dataType_1.getJSONTypes)(definition.schemaType)
        }
      };
      if (definition.before)
        addBeforeRule.call(this, ruleGroup, rule, definition.before);
      else
        ruleGroup.rules.push(rule);
      RULES.all[keyword] = rule;
      (_a = definition.implements) === null || _a === void 0 ? void 0 : _a.forEach((kwd) => this.addKeyword(kwd));
    }
    function addBeforeRule(ruleGroup, rule, before) {
      const i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
      if (i >= 0) {
        ruleGroup.rules.splice(i, 0, rule);
      } else {
        ruleGroup.rules.push(rule);
        this.logger.warn(`rule ${before} is not defined`);
      }
    }
    function keywordMetaschema(def) {
      let { metaSchema } = def;
      if (metaSchema === void 0)
        return;
      if (def.$data && this.opts.$data)
        metaSchema = schemaOrData(metaSchema);
      def.validateSchema = this.compile(metaSchema, true);
    }
    var $dataRef = {
      $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
    };
    function schemaOrData(schema) {
      return { anyOf: [schema, $dataRef] };
    }
  }
});

// node_modules/ajv/dist/vocabularies/core/id.js
var require_id = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/id.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var def = {
      keyword: "id",
      code() {
        throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/core/ref.js
var require_ref = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/ref.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.callRef = exports2.getValidate = void 0;
    var ref_error_1 = require_ref_error();
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var compile_1 = require_compile();
    var util_1 = require_util();
    var def = {
      keyword: "$ref",
      schemaType: "string",
      code(cxt) {
        const { gen, schema: $ref, it } = cxt;
        const { baseId, schemaEnv: env, validateName, opts, self } = it;
        const { root } = env;
        if (($ref === "#" || $ref === "#/") && baseId === root.baseId)
          return callRootRef();
        const schOrEnv = compile_1.resolveRef.call(self, root, baseId, $ref);
        if (schOrEnv === void 0)
          throw new ref_error_1.default(it.opts.uriResolver, baseId, $ref);
        if (schOrEnv instanceof compile_1.SchemaEnv)
          return callValidate(schOrEnv);
        return inlineRefSchema(schOrEnv);
        function callRootRef() {
          if (env === root)
            return callRef(cxt, validateName, env, env.$async);
          const rootName = gen.scopeValue("root", { ref: root });
          return callRef(cxt, (0, codegen_1._)`${rootName}.validate`, root, root.$async);
        }
        function callValidate(sch) {
          const v = getValidate(cxt, sch);
          callRef(cxt, v, sch, sch.$async);
        }
        function inlineRefSchema(sch) {
          const schName = gen.scopeValue("schema", opts.code.source === true ? { ref: sch, code: (0, codegen_1.stringify)(sch) } : { ref: sch });
          const valid = gen.name("valid");
          const schCxt = cxt.subschema({
            schema: sch,
            dataTypes: [],
            schemaPath: codegen_1.nil,
            topSchemaRef: schName,
            errSchemaPath: $ref
          }, valid);
          cxt.mergeEvaluated(schCxt);
          cxt.ok(valid);
        }
      }
    };
    function getValidate(cxt, sch) {
      const { gen } = cxt;
      return sch.validate ? gen.scopeValue("validate", { ref: sch.validate }) : (0, codegen_1._)`${gen.scopeValue("wrapper", { ref: sch })}.validate`;
    }
    exports2.getValidate = getValidate;
    function callRef(cxt, v, sch, $async) {
      const { gen, it } = cxt;
      const { allErrors, schemaEnv: env, opts } = it;
      const passCxt = opts.passContext ? names_1.default.this : codegen_1.nil;
      if ($async)
        callAsyncRef();
      else
        callSyncRef();
      function callAsyncRef() {
        if (!env.$async)
          throw new Error("async schema referenced by sync schema");
        const valid = gen.let("valid");
        gen.try(() => {
          gen.code((0, codegen_1._)`await ${(0, code_1.callValidateCode)(cxt, v, passCxt)}`);
          addEvaluatedFrom(v);
          if (!allErrors)
            gen.assign(valid, true);
        }, (e) => {
          gen.if((0, codegen_1._)`!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e));
          addErrorsFrom(e);
          if (!allErrors)
            gen.assign(valid, false);
        });
        cxt.ok(valid);
      }
      function callSyncRef() {
        cxt.result((0, code_1.callValidateCode)(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
      }
      function addErrorsFrom(source) {
        const errs = (0, codegen_1._)`${source}.errors`;
        gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`);
        gen.assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
      }
      function addEvaluatedFrom(source) {
        var _a;
        if (!it.opts.unevaluated)
          return;
        const schEvaluated = (_a = sch === null || sch === void 0 ? void 0 : sch.validate) === null || _a === void 0 ? void 0 : _a.evaluated;
        if (it.props !== true) {
          if (schEvaluated && !schEvaluated.dynamicProps) {
            if (schEvaluated.props !== void 0) {
              it.props = util_1.mergeEvaluated.props(gen, schEvaluated.props, it.props);
            }
          } else {
            const props = gen.var("props", (0, codegen_1._)`${source}.evaluated.props`);
            it.props = util_1.mergeEvaluated.props(gen, props, it.props, codegen_1.Name);
          }
        }
        if (it.items !== true) {
          if (schEvaluated && !schEvaluated.dynamicItems) {
            if (schEvaluated.items !== void 0) {
              it.items = util_1.mergeEvaluated.items(gen, schEvaluated.items, it.items);
            }
          } else {
            const items = gen.var("items", (0, codegen_1._)`${source}.evaluated.items`);
            it.items = util_1.mergeEvaluated.items(gen, items, it.items, codegen_1.Name);
          }
        }
      }
    }
    exports2.callRef = callRef;
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/core/index.js
var require_core2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var id_1 = require_id();
    var ref_1 = require_ref();
    var core = [
      "$schema",
      "$id",
      "$defs",
      "$vocabulary",
      { keyword: "$comment" },
      "definitions",
      id_1.default,
      ref_1.default
    ];
    exports2.default = core;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitNumber.js
var require_limitNumber = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitNumber.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var ops = codegen_1.operators;
    var KWDs = {
      maximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
      minimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
      exclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
      exclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
    };
    var error = {
      message: ({ keyword, schemaCode }) => (0, codegen_1.str)`must be ${KWDs[keyword].okStr} ${schemaCode}`,
      params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
    };
    var def = {
      keyword: Object.keys(KWDs),
      type: "number",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        cxt.fail$data((0, codegen_1._)`${data} ${KWDs[keyword].fail} ${schemaCode} || isNaN(${data})`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/multipleOf.js
var require_multipleOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/multipleOf.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must be multiple of ${schemaCode}`,
      params: ({ schemaCode }) => (0, codegen_1._)`{multipleOf: ${schemaCode}}`
    };
    var def = {
      keyword: "multipleOf",
      type: "number",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, schemaCode, it } = cxt;
        const prec = it.opts.multipleOfPrecision;
        const res = gen.let("res");
        const invalid = prec ? (0, codegen_1._)`Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}` : (0, codegen_1._)`${res} !== parseInt(${res})`;
        cxt.fail$data((0, codegen_1._)`(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/ajv/dist/runtime/ucs2length.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value2;
      while (pos < len) {
        length++;
        value2 = str.charCodeAt(pos++);
        if (value2 >= 55296 && value2 <= 56319 && pos < len) {
          value2 = str.charCodeAt(pos);
          if ((value2 & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports2.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitLength.js
var require_limitLength = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitLength.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var ucs2length_1 = require_ucs2length();
    var error = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxLength" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} characters`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxLength", "minLength"],
      type: "string",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode, it } = cxt;
        const op = keyword === "maxLength" ? codegen_1.operators.GT : codegen_1.operators.LT;
        const len = it.opts.unicode === false ? (0, codegen_1._)`${data}.length` : (0, codegen_1._)`${(0, util_1.useFunc)(cxt.gen, ucs2length_1.default)}(${data})`;
        cxt.fail$data((0, codegen_1._)`${len} ${op} ${schemaCode}`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/pattern.js
var require_pattern = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/pattern.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var code_1 = require_code2();
    var util_1 = require_util();
    var codegen_1 = require_codegen();
    var error = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must match pattern "${schemaCode}"`,
      params: ({ schemaCode }) => (0, codegen_1._)`{pattern: ${schemaCode}}`
    };
    var def = {
      keyword: "pattern",
      type: "string",
      schemaType: "string",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const u = it.opts.unicodeRegExp ? "u" : "";
        if ($data) {
          const { regExp } = it.opts.code;
          const regExpCode = regExp.code === "new RegExp" ? (0, codegen_1._)`new RegExp` : (0, util_1.useFunc)(gen, regExp);
          const valid = gen.let("valid");
          gen.try(() => gen.assign(valid, (0, codegen_1._)`${regExpCode}(${schemaCode}, ${u}).test(${data})`), () => gen.assign(valid, false));
          cxt.fail$data((0, codegen_1._)`!${valid}`);
        } else {
          const regExp = (0, code_1.usePattern)(cxt, schema);
          cxt.fail$data((0, codegen_1._)`!${regExp}.test(${data})`);
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitProperties.js
var require_limitProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitProperties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxProperties" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} properties`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxProperties", "minProperties"],
      type: "object",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxProperties" ? codegen_1.operators.GT : codegen_1.operators.LT;
        cxt.fail$data((0, codegen_1._)`Object.keys(${data}).length ${op} ${schemaCode}`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/required.js
var require_required = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/required.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { missingProperty } }) => (0, codegen_1.str)`must have required property '${missingProperty}'`,
      params: ({ params: { missingProperty } }) => (0, codegen_1._)`{missingProperty: ${missingProperty}}`
    };
    var def = {
      keyword: "required",
      type: "object",
      schemaType: "array",
      $data: true,
      error,
      code(cxt) {
        const { gen, schema, schemaCode, data, $data, it } = cxt;
        const { opts } = it;
        if (!$data && schema.length === 0)
          return;
        const useLoop = schema.length >= opts.loopRequired;
        if (it.allErrors)
          allErrorsMode();
        else
          exitOnErrorMode();
        if (opts.strictRequired) {
          const props = cxt.parentSchema.properties;
          const { definedProperties } = cxt.it;
          for (const requiredKey of schema) {
            if ((props === null || props === void 0 ? void 0 : props[requiredKey]) === void 0 && !definedProperties.has(requiredKey)) {
              const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
              const msg = `required property "${requiredKey}" is not defined at "${schemaPath}" (strictRequired)`;
              (0, util_1.checkStrictMode)(it, msg, it.opts.strictRequired);
            }
          }
        }
        function allErrorsMode() {
          if (useLoop || $data) {
            cxt.block$data(codegen_1.nil, loopAllRequired);
          } else {
            for (const prop of schema) {
              (0, code_1.checkReportMissingProp)(cxt, prop);
            }
          }
        }
        function exitOnErrorMode() {
          const missing = gen.let("missing");
          if (useLoop || $data) {
            const valid = gen.let("valid", true);
            cxt.block$data(valid, () => loopUntilMissing(missing, valid));
            cxt.ok(valid);
          } else {
            gen.if((0, code_1.checkMissingProp)(cxt, schema, missing));
            (0, code_1.reportMissingProp)(cxt, missing);
            gen.else();
          }
        }
        function loopAllRequired() {
          gen.forOf("prop", schemaCode, (prop) => {
            cxt.setParams({ missingProperty: prop });
            gen.if((0, code_1.noPropertyInData)(gen, data, prop, opts.ownProperties), () => cxt.error());
          });
        }
        function loopUntilMissing(missing, valid) {
          cxt.setParams({ missingProperty: missing });
          gen.forOf(missing, schemaCode, () => {
            gen.assign(valid, (0, code_1.propertyInData)(gen, data, missing, opts.ownProperties));
            gen.if((0, codegen_1.not)(valid), () => {
              cxt.error();
              gen.break();
            });
          }, codegen_1.nil);
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitItems.js
var require_limitItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxItems" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} items`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxItems", "minItems"],
      type: "array",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxItems" ? codegen_1.operators.GT : codegen_1.operators.LT;
        cxt.fail$data((0, codegen_1._)`${data}.length ${op} ${schemaCode}`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS({
  "node_modules/ajv/dist/runtime/equal.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var equal = require_fast_deep_equal();
    equal.code = 'require("ajv/dist/runtime/equal").default';
    exports2.default = equal;
  }
});

// node_modules/ajv/dist/vocabularies/validation/uniqueItems.js
var require_uniqueItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/uniqueItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var dataType_1 = require_dataType();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error = {
      message: ({ params: { i, j } }) => (0, codegen_1.str)`must NOT have duplicate items (items ## ${j} and ${i} are identical)`,
      params: ({ params: { i, j } }) => (0, codegen_1._)`{i: ${i}, j: ${j}}`
    };
    var def = {
      keyword: "uniqueItems",
      type: "array",
      schemaType: "boolean",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
        if (!$data && !schema)
          return;
        const valid = gen.let("valid");
        const itemTypes = parentSchema.items ? (0, dataType_1.getSchemaTypes)(parentSchema.items) : [];
        cxt.block$data(valid, validateUniqueItems, (0, codegen_1._)`${schemaCode} === false`);
        cxt.ok(valid);
        function validateUniqueItems() {
          const i = gen.let("i", (0, codegen_1._)`${data}.length`);
          const j = gen.let("j");
          cxt.setParams({ i, j });
          gen.assign(valid, true);
          gen.if((0, codegen_1._)`${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j));
        }
        function canOptimize() {
          return itemTypes.length > 0 && !itemTypes.some((t) => t === "object" || t === "array");
        }
        function loopN(i, j) {
          const item = gen.name("item");
          const wrongType = (0, dataType_1.checkDataTypes)(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong);
          const indices = gen.const("indices", (0, codegen_1._)`{}`);
          gen.for((0, codegen_1._)`;${i}--;`, () => {
            gen.let(item, (0, codegen_1._)`${data}[${i}]`);
            gen.if(wrongType, (0, codegen_1._)`continue`);
            if (itemTypes.length > 1)
              gen.if((0, codegen_1._)`typeof ${item} == "string"`, (0, codegen_1._)`${item} += "_"`);
            gen.if((0, codegen_1._)`typeof ${indices}[${item}] == "number"`, () => {
              gen.assign(j, (0, codegen_1._)`${indices}[${item}]`);
              cxt.error();
              gen.assign(valid, false).break();
            }).code((0, codegen_1._)`${indices}[${item}] = ${i}`);
          });
        }
        function loopN2(i, j) {
          const eql = (0, util_1.useFunc)(gen, equal_1.default);
          const outer = gen.name("outer");
          gen.label(outer).for((0, codegen_1._)`;${i}--;`, () => gen.for((0, codegen_1._)`${j} = ${i}; ${j}--;`, () => gen.if((0, codegen_1._)`${eql}(${data}[${i}], ${data}[${j}])`, () => {
            cxt.error();
            gen.assign(valid, false).break(outer);
          })));
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/const.js
var require_const = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/const.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error = {
      message: "must be equal to constant",
      params: ({ schemaCode }) => (0, codegen_1._)`{allowedValue: ${schemaCode}}`
    };
    var def = {
      keyword: "const",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schemaCode, schema } = cxt;
        if ($data || schema && typeof schema == "object") {
          cxt.fail$data((0, codegen_1._)`!${(0, util_1.useFunc)(gen, equal_1.default)}(${data}, ${schemaCode})`);
        } else {
          cxt.fail((0, codegen_1._)`${schema} !== ${data}`);
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/enum.js
var require_enum = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/enum.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error = {
      message: "must be equal to one of the allowed values",
      params: ({ schemaCode }) => (0, codegen_1._)`{allowedValues: ${schemaCode}}`
    };
    var def = {
      keyword: "enum",
      schemaType: "array",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        if (!$data && schema.length === 0)
          throw new Error("enum must have non-empty array");
        const useLoop = schema.length >= it.opts.loopEnum;
        let eql;
        const getEql = () => eql !== null && eql !== void 0 ? eql : eql = (0, util_1.useFunc)(gen, equal_1.default);
        let valid;
        if (useLoop || $data) {
          valid = gen.let("valid");
          cxt.block$data(valid, loopEnum);
        } else {
          if (!Array.isArray(schema))
            throw new Error("ajv implementation error");
          const vSchema = gen.const("vSchema", schemaCode);
          valid = (0, codegen_1.or)(...schema.map((_x, i) => equalCode(vSchema, i)));
        }
        cxt.pass(valid);
        function loopEnum() {
          gen.assign(valid, false);
          gen.forOf("v", schemaCode, (v) => gen.if((0, codegen_1._)`${getEql()}(${data}, ${v})`, () => gen.assign(valid, true).break()));
        }
        function equalCode(vSchema, i) {
          const sch = schema[i];
          return typeof sch === "object" && sch !== null ? (0, codegen_1._)`${getEql()}(${data}, ${vSchema}[${i}])` : (0, codegen_1._)`${data} === ${sch}`;
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/index.js
var require_validation = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var limitNumber_1 = require_limitNumber();
    var multipleOf_1 = require_multipleOf();
    var limitLength_1 = require_limitLength();
    var pattern_1 = require_pattern();
    var limitProperties_1 = require_limitProperties();
    var required_1 = require_required();
    var limitItems_1 = require_limitItems();
    var uniqueItems_1 = require_uniqueItems();
    var const_1 = require_const();
    var enum_1 = require_enum();
    var validation = [
      // number
      limitNumber_1.default,
      multipleOf_1.default,
      // string
      limitLength_1.default,
      pattern_1.default,
      // object
      limitProperties_1.default,
      required_1.default,
      // array
      limitItems_1.default,
      uniqueItems_1.default,
      // any
      { keyword: "type", schemaType: ["string", "array"] },
      { keyword: "nullable", schemaType: "boolean" },
      const_1.default,
      enum_1.default
    ];
    exports2.default = validation;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/additionalItems.js
var require_additionalItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/additionalItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateAdditionalItems = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
      params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
    };
    var def = {
      keyword: "additionalItems",
      type: "array",
      schemaType: ["boolean", "object"],
      before: "uniqueItems",
      error,
      code(cxt) {
        const { parentSchema, it } = cxt;
        const { items } = parentSchema;
        if (!Array.isArray(items)) {
          (0, util_1.checkStrictMode)(it, '"additionalItems" is ignored when "items" is not an array of schemas');
          return;
        }
        validateAdditionalItems(cxt, items);
      }
    };
    function validateAdditionalItems(cxt, items) {
      const { gen, schema, data, keyword, it } = cxt;
      it.items = true;
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      if (schema === false) {
        cxt.setParams({ len: items.length });
        cxt.pass((0, codegen_1._)`${len} <= ${items.length}`);
      } else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
        const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items.length}`);
        gen.if((0, codegen_1.not)(valid), () => validateItems(valid));
        cxt.ok(valid);
      }
      function validateItems(valid) {
        gen.forRange("i", items.length, len, (i) => {
          cxt.subschema({ keyword, dataProp: i, dataPropType: util_1.Type.Num }, valid);
          if (!it.allErrors)
            gen.if((0, codegen_1.not)(valid), () => gen.break());
        });
      }
    }
    exports2.validateAdditionalItems = validateAdditionalItems;
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/items.js
var require_items = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/items.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateTuple = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    var def = {
      keyword: "items",
      type: "array",
      schemaType: ["object", "array", "boolean"],
      before: "uniqueItems",
      code(cxt) {
        const { schema, it } = cxt;
        if (Array.isArray(schema))
          return validateTuple(cxt, "additionalItems", schema);
        it.items = true;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        cxt.ok((0, code_1.validateArray)(cxt));
      }
    };
    function validateTuple(cxt, extraItems, schArr = cxt.schema) {
      const { gen, parentSchema, data, keyword, it } = cxt;
      checkStrictTuple(parentSchema);
      if (it.opts.unevaluated && schArr.length && it.items !== true) {
        it.items = util_1.mergeEvaluated.items(gen, schArr.length, it.items);
      }
      const valid = gen.name("valid");
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      schArr.forEach((sch, i) => {
        if ((0, util_1.alwaysValidSchema)(it, sch))
          return;
        gen.if((0, codegen_1._)`${len} > ${i}`, () => cxt.subschema({
          keyword,
          schemaProp: i,
          dataProp: i
        }, valid));
        cxt.ok(valid);
      });
      function checkStrictTuple(sch) {
        const { opts, errSchemaPath } = it;
        const l = schArr.length;
        const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
        if (opts.strictTuples && !fullTuple) {
          const msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
          (0, util_1.checkStrictMode)(it, msg, opts.strictTuples);
        }
      }
    }
    exports2.validateTuple = validateTuple;
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/prefixItems.js
var require_prefixItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/prefixItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var items_1 = require_items();
    var def = {
      keyword: "prefixItems",
      type: "array",
      schemaType: ["array"],
      before: "uniqueItems",
      code: (cxt) => (0, items_1.validateTuple)(cxt, "items")
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/items2020.js
var require_items2020 = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/items2020.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    var additionalItems_1 = require_additionalItems();
    var error = {
      message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
      params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
    };
    var def = {
      keyword: "items",
      type: "array",
      schemaType: ["object", "boolean"],
      before: "uniqueItems",
      error,
      code(cxt) {
        const { schema, parentSchema, it } = cxt;
        const { prefixItems } = parentSchema;
        it.items = true;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        if (prefixItems)
          (0, additionalItems_1.validateAdditionalItems)(cxt, prefixItems);
        else
          cxt.ok((0, code_1.validateArray)(cxt));
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/contains.js
var require_contains = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/contains.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1.str)`must contain at least ${min} valid item(s)` : (0, codegen_1.str)`must contain at least ${min} and no more than ${max} valid item(s)`,
      params: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1._)`{minContains: ${min}}` : (0, codegen_1._)`{minContains: ${min}, maxContains: ${max}}`
    };
    var def = {
      keyword: "contains",
      type: "array",
      schemaType: ["object", "boolean"],
      before: "uniqueItems",
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        let min;
        let max;
        const { minContains, maxContains } = parentSchema;
        if (it.opts.next) {
          min = minContains === void 0 ? 1 : minContains;
          max = maxContains;
        } else {
          min = 1;
        }
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        cxt.setParams({ min, max });
        if (max === void 0 && min === 0) {
          (0, util_1.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
          return;
        }
        if (max !== void 0 && min > max) {
          (0, util_1.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
          cxt.fail();
          return;
        }
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          let cond = (0, codegen_1._)`${len} >= ${min}`;
          if (max !== void 0)
            cond = (0, codegen_1._)`${cond} && ${len} <= ${max}`;
          cxt.pass(cond);
          return;
        }
        it.items = true;
        const valid = gen.name("valid");
        if (max === void 0 && min === 1) {
          validateItems(valid, () => gen.if(valid, () => gen.break()));
        } else if (min === 0) {
          gen.let(valid, true);
          if (max !== void 0)
            gen.if((0, codegen_1._)`${data}.length > 0`, validateItemsWithCount);
        } else {
          gen.let(valid, false);
          validateItemsWithCount();
        }
        cxt.result(valid, () => cxt.reset());
        function validateItemsWithCount() {
          const schValid = gen.name("_valid");
          const count = gen.let("count", 0);
          validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
        }
        function validateItems(_valid, block) {
          gen.forRange("i", 0, len, (i) => {
            cxt.subschema({
              keyword: "contains",
              dataProp: i,
              dataPropType: util_1.Type.Num,
              compositeRule: true
            }, _valid);
            block();
          });
        }
        function checkLimits(count) {
          gen.code((0, codegen_1._)`${count}++`);
          if (max === void 0) {
            gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true).break());
          } else {
            gen.if((0, codegen_1._)`${count} > ${max}`, () => gen.assign(valid, false).break());
            if (min === 1)
              gen.assign(valid, true);
            else
              gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true));
          }
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/dependencies.js
var require_dependencies = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/dependencies.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateSchemaDeps = exports2.validatePropertyDeps = exports2.error = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    exports2.error = {
      message: ({ params: { property, depsCount, deps } }) => {
        const property_ies = depsCount === 1 ? "property" : "properties";
        return (0, codegen_1.str)`must have ${property_ies} ${deps} when property ${property} is present`;
      },
      params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_1._)`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
      // TODO change to reference
    };
    var def = {
      keyword: "dependencies",
      type: "object",
      schemaType: "object",
      error: exports2.error,
      code(cxt) {
        const [propDeps, schDeps] = splitDependencies(cxt);
        validatePropertyDeps(cxt, propDeps);
        validateSchemaDeps(cxt, schDeps);
      }
    };
    function splitDependencies({ schema }) {
      const propertyDeps = {};
      const schemaDeps = {};
      for (const key in schema) {
        if (key === "__proto__")
          continue;
        const deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
        deps[key] = schema[key];
      }
      return [propertyDeps, schemaDeps];
    }
    function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
      const { gen, data, it } = cxt;
      if (Object.keys(propertyDeps).length === 0)
        return;
      const missing = gen.let("missing");
      for (const prop in propertyDeps) {
        const deps = propertyDeps[prop];
        if (deps.length === 0)
          continue;
        const hasProperty = (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties);
        cxt.setParams({
          property: prop,
          depsCount: deps.length,
          deps: deps.join(", ")
        });
        if (it.allErrors) {
          gen.if(hasProperty, () => {
            for (const depProp of deps) {
              (0, code_1.checkReportMissingProp)(cxt, depProp);
            }
          });
        } else {
          gen.if((0, codegen_1._)`${hasProperty} && (${(0, code_1.checkMissingProp)(cxt, deps, missing)})`);
          (0, code_1.reportMissingProp)(cxt, missing);
          gen.else();
        }
      }
    }
    exports2.validatePropertyDeps = validatePropertyDeps;
    function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      for (const prop in schemaDeps) {
        if ((0, util_1.alwaysValidSchema)(it, schemaDeps[prop]))
          continue;
        gen.if(
          (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties),
          () => {
            const schCxt = cxt.subschema({ keyword, schemaProp: prop }, valid);
            cxt.mergeValidEvaluated(schCxt, valid);
          },
          () => gen.var(valid, true)
          // TODO var
        );
        cxt.ok(valid);
      }
    }
    exports2.validateSchemaDeps = validateSchemaDeps;
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/propertyNames.js
var require_propertyNames = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/propertyNames.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: "property name must be valid",
      params: ({ params }) => (0, codegen_1._)`{propertyName: ${params.propertyName}}`
    };
    var def = {
      keyword: "propertyNames",
      type: "object",
      schemaType: ["object", "boolean"],
      error,
      code(cxt) {
        const { gen, schema, data, it } = cxt;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        const valid = gen.name("valid");
        gen.forIn("key", data, (key) => {
          cxt.setParams({ propertyName: key });
          cxt.subschema({
            keyword: "propertyNames",
            data: key,
            dataTypes: ["string"],
            propertyName: key,
            compositeRule: true
          }, valid);
          gen.if((0, codegen_1.not)(valid), () => {
            cxt.error(true);
            if (!it.allErrors)
              gen.break();
          });
        });
        cxt.ok(valid);
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js
var require_additionalProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var util_1 = require_util();
    var error = {
      message: "must NOT have additional properties",
      params: ({ params }) => (0, codegen_1._)`{additionalProperty: ${params.additionalProperty}}`
    };
    var def = {
      keyword: "additionalProperties",
      type: ["object"],
      schemaType: ["boolean", "object"],
      allowUndefined: true,
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, schema, parentSchema, data, errsCount, it } = cxt;
        if (!errsCount)
          throw new Error("ajv implementation error");
        const { allErrors, opts } = it;
        it.props = true;
        if (opts.removeAdditional !== "all" && (0, util_1.alwaysValidSchema)(it, schema))
          return;
        const props = (0, code_1.allSchemaProperties)(parentSchema.properties);
        const patProps = (0, code_1.allSchemaProperties)(parentSchema.patternProperties);
        checkAdditionalProperties();
        cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
        function checkAdditionalProperties() {
          gen.forIn("key", data, (key) => {
            if (!props.length && !patProps.length)
              additionalPropertyCode(key);
            else
              gen.if(isAdditional(key), () => additionalPropertyCode(key));
          });
        }
        function isAdditional(key) {
          let definedProp;
          if (props.length > 8) {
            const propsSchema = (0, util_1.schemaRefOrVal)(it, parentSchema.properties, "properties");
            definedProp = (0, code_1.isOwnProperty)(gen, propsSchema, key);
          } else if (props.length) {
            definedProp = (0, codegen_1.or)(...props.map((p) => (0, codegen_1._)`${key} === ${p}`));
          } else {
            definedProp = codegen_1.nil;
          }
          if (patProps.length) {
            definedProp = (0, codegen_1.or)(definedProp, ...patProps.map((p) => (0, codegen_1._)`${(0, code_1.usePattern)(cxt, p)}.test(${key})`));
          }
          return (0, codegen_1.not)(definedProp);
        }
        function deleteAdditional(key) {
          gen.code((0, codegen_1._)`delete ${data}[${key}]`);
        }
        function additionalPropertyCode(key) {
          if (opts.removeAdditional === "all" || opts.removeAdditional && schema === false) {
            deleteAdditional(key);
            return;
          }
          if (schema === false) {
            cxt.setParams({ additionalProperty: key });
            cxt.error();
            if (!allErrors)
              gen.break();
            return;
          }
          if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
            const valid = gen.name("valid");
            if (opts.removeAdditional === "failing") {
              applyAdditionalSchema(key, valid, false);
              gen.if((0, codegen_1.not)(valid), () => {
                cxt.reset();
                deleteAdditional(key);
              });
            } else {
              applyAdditionalSchema(key, valid);
              if (!allErrors)
                gen.if((0, codegen_1.not)(valid), () => gen.break());
            }
          }
        }
        function applyAdditionalSchema(key, valid, errors) {
          const subschema = {
            keyword: "additionalProperties",
            dataProp: key,
            dataPropType: util_1.Type.Str
          };
          if (errors === false) {
            Object.assign(subschema, {
              compositeRule: true,
              createErrors: false,
              allErrors: false
            });
          }
          cxt.subschema(subschema, valid);
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/properties.js
var require_properties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/properties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var validate_1 = require_validate();
    var code_1 = require_code2();
    var util_1 = require_util();
    var additionalProperties_1 = require_additionalProperties();
    var def = {
      keyword: "properties",
      type: "object",
      schemaType: "object",
      code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === void 0) {
          additionalProperties_1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1.default, "additionalProperties"));
        }
        const allProps = (0, code_1.allSchemaProperties)(schema);
        for (const prop of allProps) {
          it.definedProperties.add(prop);
        }
        if (it.opts.unevaluated && allProps.length && it.props !== true) {
          it.props = util_1.mergeEvaluated.props(gen, (0, util_1.toHash)(allProps), it.props);
        }
        const properties = allProps.filter((p) => !(0, util_1.alwaysValidSchema)(it, schema[p]));
        if (properties.length === 0)
          return;
        const valid = gen.name("valid");
        for (const prop of properties) {
          if (hasDefault(prop)) {
            applyPropertySchema(prop);
          } else {
            gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties));
            applyPropertySchema(prop);
            if (!it.allErrors)
              gen.else().var(valid, true);
            gen.endIf();
          }
          cxt.it.definedProperties.add(prop);
          cxt.ok(valid);
        }
        function hasDefault(prop) {
          return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== void 0;
        }
        function applyPropertySchema(prop) {
          cxt.subschema({
            keyword: "properties",
            schemaProp: prop,
            dataProp: prop
          }, valid);
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/patternProperties.js
var require_patternProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/patternProperties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var util_2 = require_util();
    var def = {
      keyword: "patternProperties",
      type: "object",
      schemaType: "object",
      code(cxt) {
        const { gen, schema, data, parentSchema, it } = cxt;
        const { opts } = it;
        const patterns = (0, code_1.allSchemaProperties)(schema);
        const alwaysValidPatterns = patterns.filter((p) => (0, util_1.alwaysValidSchema)(it, schema[p]));
        if (patterns.length === 0 || alwaysValidPatterns.length === patterns.length && (!it.opts.unevaluated || it.props === true)) {
          return;
        }
        const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
        const valid = gen.name("valid");
        if (it.props !== true && !(it.props instanceof codegen_1.Name)) {
          it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
        }
        const { props } = it;
        validatePatternProperties();
        function validatePatternProperties() {
          for (const pat of patterns) {
            if (checkProperties)
              checkMatchingProperties(pat);
            if (it.allErrors) {
              validateProperties(pat);
            } else {
              gen.var(valid, true);
              validateProperties(pat);
              gen.if(valid);
            }
          }
        }
        function checkMatchingProperties(pat) {
          for (const prop in checkProperties) {
            if (new RegExp(pat).test(prop)) {
              (0, util_1.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
            }
          }
        }
        function validateProperties(pat) {
          gen.forIn("key", data, (key) => {
            gen.if((0, codegen_1._)`${(0, code_1.usePattern)(cxt, pat)}.test(${key})`, () => {
              const alwaysValid = alwaysValidPatterns.includes(pat);
              if (!alwaysValid) {
                cxt.subschema({
                  keyword: "patternProperties",
                  schemaProp: pat,
                  dataProp: key,
                  dataPropType: util_2.Type.Str
                }, valid);
              }
              if (it.opts.unevaluated && props !== true) {
                gen.assign((0, codegen_1._)`${props}[${key}]`, true);
              } else if (!alwaysValid && !it.allErrors) {
                gen.if((0, codegen_1.not)(valid), () => gen.break());
              }
            });
          });
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/not.js
var require_not = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/not.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: "not",
      schemaType: ["object", "boolean"],
      trackErrors: true,
      code(cxt) {
        const { gen, schema, it } = cxt;
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          cxt.fail();
          return;
        }
        const valid = gen.name("valid");
        cxt.subschema({
          keyword: "not",
          compositeRule: true,
          createErrors: false,
          allErrors: false
        }, valid);
        cxt.failResult(valid, () => cxt.reset(), () => cxt.error());
      },
      error: { message: "must NOT be valid" }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/anyOf.js
var require_anyOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/anyOf.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var code_1 = require_code2();
    var def = {
      keyword: "anyOf",
      schemaType: "array",
      trackErrors: true,
      code: code_1.validateUnion,
      error: { message: "must match a schema in anyOf" }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/oneOf.js
var require_oneOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/oneOf.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: "must match exactly one schema in oneOf",
      params: ({ params }) => (0, codegen_1._)`{passingSchemas: ${params.passing}}`
    };
    var def = {
      keyword: "oneOf",
      schemaType: "array",
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, schema, parentSchema, it } = cxt;
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        if (it.opts.discriminator && parentSchema.discriminator)
          return;
        const schArr = schema;
        const valid = gen.let("valid", false);
        const passing = gen.let("passing", null);
        const schValid = gen.name("_valid");
        cxt.setParams({ passing });
        gen.block(validateOneOf);
        cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
        function validateOneOf() {
          schArr.forEach((sch, i) => {
            let schCxt;
            if ((0, util_1.alwaysValidSchema)(it, sch)) {
              gen.var(schValid, true);
            } else {
              schCxt = cxt.subschema({
                keyword: "oneOf",
                schemaProp: i,
                compositeRule: true
              }, schValid);
            }
            if (i > 0) {
              gen.if((0, codegen_1._)`${schValid} && ${valid}`).assign(valid, false).assign(passing, (0, codegen_1._)`[${passing}, ${i}]`).else();
            }
            gen.if(schValid, () => {
              gen.assign(valid, true);
              gen.assign(passing, i);
              if (schCxt)
                cxt.mergeEvaluated(schCxt, codegen_1.Name);
            });
          });
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/allOf.js
var require_allOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/allOf.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: "allOf",
      schemaType: "array",
      code(cxt) {
        const { gen, schema, it } = cxt;
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        const valid = gen.name("valid");
        schema.forEach((sch, i) => {
          if ((0, util_1.alwaysValidSchema)(it, sch))
            return;
          const schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid);
          cxt.ok(valid);
          cxt.mergeEvaluated(schCxt);
        });
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/if.js
var require_if = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/if.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params }) => (0, codegen_1.str)`must match "${params.ifClause}" schema`,
      params: ({ params }) => (0, codegen_1._)`{failingKeyword: ${params.ifClause}}`
    };
    var def = {
      keyword: "if",
      schemaType: ["object", "boolean"],
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, parentSchema, it } = cxt;
        if (parentSchema.then === void 0 && parentSchema.else === void 0) {
          (0, util_1.checkStrictMode)(it, '"if" without "then" and "else" is ignored');
        }
        const hasThen = hasSchema(it, "then");
        const hasElse = hasSchema(it, "else");
        if (!hasThen && !hasElse)
          return;
        const valid = gen.let("valid", true);
        const schValid = gen.name("_valid");
        validateIf();
        cxt.reset();
        if (hasThen && hasElse) {
          const ifClause = gen.let("ifClause");
          cxt.setParams({ ifClause });
          gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
        } else if (hasThen) {
          gen.if(schValid, validateClause("then"));
        } else {
          gen.if((0, codegen_1.not)(schValid), validateClause("else"));
        }
        cxt.pass(valid, () => cxt.error(true));
        function validateIf() {
          const schCxt = cxt.subschema({
            keyword: "if",
            compositeRule: true,
            createErrors: false,
            allErrors: false
          }, schValid);
          cxt.mergeEvaluated(schCxt);
        }
        function validateClause(keyword, ifClause) {
          return () => {
            const schCxt = cxt.subschema({ keyword }, schValid);
            gen.assign(valid, schValid);
            cxt.mergeValidEvaluated(schCxt, valid);
            if (ifClause)
              gen.assign(ifClause, (0, codegen_1._)`${keyword}`);
            else
              cxt.setParams({ ifClause: keyword });
          };
        }
      }
    };
    function hasSchema(it, keyword) {
      const schema = it.schema[keyword];
      return schema !== void 0 && !(0, util_1.alwaysValidSchema)(it, schema);
    }
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/thenElse.js
var require_thenElse = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/thenElse.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: ["then", "else"],
      schemaType: ["object", "boolean"],
      code({ keyword, parentSchema, it }) {
        if (parentSchema.if === void 0)
          (0, util_1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/index.js
var require_applicator = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var additionalItems_1 = require_additionalItems();
    var prefixItems_1 = require_prefixItems();
    var items_1 = require_items();
    var items2020_1 = require_items2020();
    var contains_1 = require_contains();
    var dependencies_1 = require_dependencies();
    var propertyNames_1 = require_propertyNames();
    var additionalProperties_1 = require_additionalProperties();
    var properties_1 = require_properties();
    var patternProperties_1 = require_patternProperties();
    var not_1 = require_not();
    var anyOf_1 = require_anyOf();
    var oneOf_1 = require_oneOf();
    var allOf_1 = require_allOf();
    var if_1 = require_if();
    var thenElse_1 = require_thenElse();
    function getApplicator(draft2020 = false) {
      const applicator = [
        // any
        not_1.default,
        anyOf_1.default,
        oneOf_1.default,
        allOf_1.default,
        if_1.default,
        thenElse_1.default,
        // object
        propertyNames_1.default,
        additionalProperties_1.default,
        dependencies_1.default,
        properties_1.default,
        patternProperties_1.default
      ];
      if (draft2020)
        applicator.push(prefixItems_1.default, items2020_1.default);
      else
        applicator.push(additionalItems_1.default, items_1.default);
      applicator.push(contains_1.default);
      return applicator;
    }
    exports2.default = getApplicator;
  }
});

// node_modules/ajv/dist/vocabularies/format/format.js
var require_format = __commonJS({
  "node_modules/ajv/dist/vocabularies/format/format.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must match format "${schemaCode}"`,
      params: ({ schemaCode }) => (0, codegen_1._)`{format: ${schemaCode}}`
    };
    var def = {
      keyword: "format",
      type: ["number", "string"],
      schemaType: "string",
      $data: true,
      error,
      code(cxt, ruleType) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const { opts, errSchemaPath, schemaEnv, self } = it;
        if (!opts.validateFormats)
          return;
        if ($data)
          validate$DataFormat();
        else
          validateFormat();
        function validate$DataFormat() {
          const fmts = gen.scopeValue("formats", {
            ref: self.formats,
            code: opts.code.formats
          });
          const fDef = gen.const("fDef", (0, codegen_1._)`${fmts}[${schemaCode}]`);
          const fType = gen.let("fType");
          const format = gen.let("format");
          gen.if((0, codegen_1._)`typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, (0, codegen_1._)`${fDef}.type || "string"`).assign(format, (0, codegen_1._)`${fDef}.validate`), () => gen.assign(fType, (0, codegen_1._)`"string"`).assign(format, fDef));
          cxt.fail$data((0, codegen_1.or)(unknownFmt(), invalidFmt()));
          function unknownFmt() {
            if (opts.strictSchema === false)
              return codegen_1.nil;
            return (0, codegen_1._)`${schemaCode} && !${format}`;
          }
          function invalidFmt() {
            const callFormat = schemaEnv.$async ? (0, codegen_1._)`(${fDef}.async ? await ${format}(${data}) : ${format}(${data}))` : (0, codegen_1._)`${format}(${data})`;
            const validData = (0, codegen_1._)`(typeof ${format} == "function" ? ${callFormat} : ${format}.test(${data}))`;
            return (0, codegen_1._)`${format} && ${format} !== true && ${fType} === ${ruleType} && !${validData}`;
          }
        }
        function validateFormat() {
          const formatDef = self.formats[schema];
          if (!formatDef) {
            unknownFormat();
            return;
          }
          if (formatDef === true)
            return;
          const [fmtType, format, fmtRef] = getFormat(formatDef);
          if (fmtType === ruleType)
            cxt.pass(validCondition());
          function unknownFormat() {
            if (opts.strictSchema === false) {
              self.logger.warn(unknownMsg());
              return;
            }
            throw new Error(unknownMsg());
            function unknownMsg() {
              return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
            }
          }
          function getFormat(fmtDef) {
            const code = fmtDef instanceof RegExp ? (0, codegen_1.regexpCode)(fmtDef) : opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(schema)}` : void 0;
            const fmt = gen.scopeValue("formats", { key: schema, ref: fmtDef, code });
            if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp)) {
              return [fmtDef.type || "string", fmtDef.validate, (0, codegen_1._)`${fmt}.validate`];
            }
            return ["string", fmtDef, fmt];
          }
          function validCondition() {
            if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
              if (!schemaEnv.$async)
                throw new Error("async format in sync schema");
              return (0, codegen_1._)`await ${fmtRef}(${data})`;
            }
            return typeof format == "function" ? (0, codegen_1._)`${fmtRef}(${data})` : (0, codegen_1._)`${fmtRef}.test(${data})`;
          }
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/format/index.js
var require_format2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/format/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var format_1 = require_format();
    var format = [format_1.default];
    exports2.default = format;
  }
});

// node_modules/ajv/dist/vocabularies/metadata.js
var require_metadata = __commonJS({
  "node_modules/ajv/dist/vocabularies/metadata.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.contentVocabulary = exports2.metadataVocabulary = void 0;
    exports2.metadataVocabulary = [
      "title",
      "description",
      "default",
      "deprecated",
      "readOnly",
      "writeOnly",
      "examples"
    ];
    exports2.contentVocabulary = [
      "contentMediaType",
      "contentEncoding",
      "contentSchema"
    ];
  }
});

// node_modules/ajv/dist/vocabularies/draft7.js
var require_draft7 = __commonJS({
  "node_modules/ajv/dist/vocabularies/draft7.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var core_1 = require_core2();
    var validation_1 = require_validation();
    var applicator_1 = require_applicator();
    var format_1 = require_format2();
    var metadata_1 = require_metadata();
    var draft7Vocabularies = [
      core_1.default,
      validation_1.default,
      (0, applicator_1.default)(),
      format_1.default,
      metadata_1.metadataVocabulary,
      metadata_1.contentVocabulary
    ];
    exports2.default = draft7Vocabularies;
  }
});

// node_modules/ajv/dist/vocabularies/discriminator/types.js
var require_types = __commonJS({
  "node_modules/ajv/dist/vocabularies/discriminator/types.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.DiscrError = void 0;
    var DiscrError;
    (function(DiscrError2) {
      DiscrError2["Tag"] = "tag";
      DiscrError2["Mapping"] = "mapping";
    })(DiscrError || (exports2.DiscrError = DiscrError = {}));
  }
});

// node_modules/ajv/dist/vocabularies/discriminator/index.js
var require_discriminator = __commonJS({
  "node_modules/ajv/dist/vocabularies/discriminator/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var types_1 = require_types();
    var compile_1 = require_compile();
    var ref_error_1 = require_ref_error();
    var util_1 = require_util();
    var error = {
      message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag ? `tag "${tagName}" must be string` : `value of tag "${tagName}" must be in oneOf`,
      params: ({ params: { discrError, tag, tagName } }) => (0, codegen_1._)`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`
    };
    var def = {
      keyword: "discriminator",
      type: "object",
      schemaType: "object",
      error,
      code(cxt) {
        const { gen, data, schema, parentSchema, it } = cxt;
        const { oneOf } = parentSchema;
        if (!it.opts.discriminator) {
          throw new Error("discriminator: requires discriminator option");
        }
        const tagName = schema.propertyName;
        if (typeof tagName != "string")
          throw new Error("discriminator: requires propertyName");
        if (schema.mapping)
          throw new Error("discriminator: mapping is not supported");
        if (!oneOf)
          throw new Error("discriminator: requires oneOf keyword");
        const valid = gen.let("valid", false);
        const tag = gen.const("tag", (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(tagName)}`);
        gen.if((0, codegen_1._)`typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(false, { discrError: types_1.DiscrError.Tag, tag, tagName }));
        cxt.ok(valid);
        function validateMapping() {
          const mapping = getMapping();
          gen.if(false);
          for (const tagValue in mapping) {
            gen.elseIf((0, codegen_1._)`${tag} === ${tagValue}`);
            gen.assign(valid, applyTagSchema(mapping[tagValue]));
          }
          gen.else();
          cxt.error(false, { discrError: types_1.DiscrError.Mapping, tag, tagName });
          gen.endIf();
        }
        function applyTagSchema(schemaProp) {
          const _valid = gen.name("valid");
          const schCxt = cxt.subschema({ keyword: "oneOf", schemaProp }, _valid);
          cxt.mergeEvaluated(schCxt, codegen_1.Name);
          return _valid;
        }
        function getMapping() {
          var _a;
          const oneOfMapping = {};
          const topRequired = hasRequired(parentSchema);
          let tagRequired = true;
          for (let i = 0; i < oneOf.length; i++) {
            let sch = oneOf[i];
            if ((sch === null || sch === void 0 ? void 0 : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
              const ref = sch.$ref;
              sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref);
              if (sch instanceof compile_1.SchemaEnv)
                sch = sch.schema;
              if (sch === void 0)
                throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
            }
            const propSch = (_a = sch === null || sch === void 0 ? void 0 : sch.properties) === null || _a === void 0 ? void 0 : _a[tagName];
            if (typeof propSch != "object") {
              throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
            }
            tagRequired = tagRequired && (topRequired || hasRequired(sch));
            addMappings(propSch, i);
          }
          if (!tagRequired)
            throw new Error(`discriminator: "${tagName}" must be required`);
          return oneOfMapping;
          function hasRequired({ required: required2 }) {
            return Array.isArray(required2) && required2.includes(tagName);
          }
          function addMappings(sch, i) {
            if (sch.const) {
              addMapping(sch.const, i);
            } else if (sch.enum) {
              for (const tagValue of sch.enum) {
                addMapping(tagValue, i);
              }
            } else {
              throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
            }
          }
          function addMapping(tagValue, i) {
            if (typeof tagValue != "string" || tagValue in oneOfMapping) {
              throw new Error(`discriminator: "${tagName}" values must be unique strings`);
            }
            oneOfMapping[tagValue] = i;
          }
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/refs/json-schema-draft-07.json
var require_json_schema_draft_07 = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-draft-07.json"(exports2, module2) {
    module2.exports = {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "http://json-schema.org/draft-07/schema#",
      title: "Core schema meta-schema",
      definitions: {
        schemaArray: {
          type: "array",
          minItems: 1,
          items: { $ref: "#" }
        },
        nonNegativeInteger: {
          type: "integer",
          minimum: 0
        },
        nonNegativeIntegerDefault0: {
          allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }]
        },
        simpleTypes: {
          enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
        },
        stringArray: {
          type: "array",
          items: { type: "string" },
          uniqueItems: true,
          default: []
        }
      },
      type: ["object", "boolean"],
      properties: {
        $id: {
          type: "string",
          format: "uri-reference"
        },
        $schema: {
          type: "string",
          format: "uri"
        },
        $ref: {
          type: "string",
          format: "uri-reference"
        },
        $comment: {
          type: "string"
        },
        title: {
          type: "string"
        },
        description: {
          type: "string"
        },
        default: true,
        readOnly: {
          type: "boolean",
          default: false
        },
        examples: {
          type: "array",
          items: true
        },
        multipleOf: {
          type: "number",
          exclusiveMinimum: 0
        },
        maximum: {
          type: "number"
        },
        exclusiveMaximum: {
          type: "number"
        },
        minimum: {
          type: "number"
        },
        exclusiveMinimum: {
          type: "number"
        },
        maxLength: { $ref: "#/definitions/nonNegativeInteger" },
        minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        pattern: {
          type: "string",
          format: "regex"
        },
        additionalItems: { $ref: "#" },
        items: {
          anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }],
          default: true
        },
        maxItems: { $ref: "#/definitions/nonNegativeInteger" },
        minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        uniqueItems: {
          type: "boolean",
          default: false
        },
        contains: { $ref: "#" },
        maxProperties: { $ref: "#/definitions/nonNegativeInteger" },
        minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        required: { $ref: "#/definitions/stringArray" },
        additionalProperties: { $ref: "#" },
        definitions: {
          type: "object",
          additionalProperties: { $ref: "#" },
          default: {}
        },
        properties: {
          type: "object",
          additionalProperties: { $ref: "#" },
          default: {}
        },
        patternProperties: {
          type: "object",
          additionalProperties: { $ref: "#" },
          propertyNames: { format: "regex" },
          default: {}
        },
        dependencies: {
          type: "object",
          additionalProperties: {
            anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }]
          }
        },
        propertyNames: { $ref: "#" },
        const: true,
        enum: {
          type: "array",
          items: true,
          minItems: 1,
          uniqueItems: true
        },
        type: {
          anyOf: [
            { $ref: "#/definitions/simpleTypes" },
            {
              type: "array",
              items: { $ref: "#/definitions/simpleTypes" },
              minItems: 1,
              uniqueItems: true
            }
          ]
        },
        format: { type: "string" },
        contentMediaType: { type: "string" },
        contentEncoding: { type: "string" },
        if: { $ref: "#" },
        then: { $ref: "#" },
        else: { $ref: "#" },
        allOf: { $ref: "#/definitions/schemaArray" },
        anyOf: { $ref: "#/definitions/schemaArray" },
        oneOf: { $ref: "#/definitions/schemaArray" },
        not: { $ref: "#" }
      },
      default: true
    };
  }
});

// node_modules/ajv/dist/ajv.js
var require_ajv = __commonJS({
  "node_modules/ajv/dist/ajv.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.MissingRefError = exports2.ValidationError = exports2.CodeGen = exports2.Name = exports2.nil = exports2.stringify = exports2.str = exports2._ = exports2.KeywordCxt = exports2.Ajv = void 0;
    var core_1 = require_core();
    var draft7_1 = require_draft7();
    var discriminator_1 = require_discriminator();
    var draft7MetaSchema = require_json_schema_draft_07();
    var META_SUPPORT_DATA = ["/properties"];
    var META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";
    var Ajv2 = class extends core_1.default {
      _addVocabularies() {
        super._addVocabularies();
        draft7_1.default.forEach((v) => this.addVocabulary(v));
        if (this.opts.discriminator)
          this.addKeyword(discriminator_1.default);
      }
      _addDefaultMetaSchema() {
        super._addDefaultMetaSchema();
        if (!this.opts.meta)
          return;
        const metaSchema = this.opts.$data ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA) : draft7MetaSchema;
        this.addMetaSchema(metaSchema, META_SCHEMA_ID, false);
        this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
      }
      defaultMeta() {
        return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
      }
    };
    exports2.Ajv = Ajv2;
    module2.exports = exports2 = Ajv2;
    module2.exports.Ajv = Ajv2;
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = Ajv2;
    var validate_1 = require_validate();
    Object.defineProperty(exports2, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports2, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports2, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports2, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports2, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports2, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports2, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    Object.defineProperty(exports2, "ValidationError", { enumerable: true, get: function() {
      return validation_error_1.default;
    } });
    var ref_error_1 = require_ref_error();
    Object.defineProperty(exports2, "MissingRefError", { enumerable: true, get: function() {
      return ref_error_1.default;
    } });
  }
});

// node_modules/ajv-formats/dist/formats.js
var require_formats = __commonJS({
  "node_modules/ajv-formats/dist/formats.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.formatNames = exports2.fastFormats = exports2.fullFormats = void 0;
    function fmtDef(validate, compare) {
      return { validate, compare };
    }
    exports2.fullFormats = {
      // date: http://tools.ietf.org/html/rfc3339#section-5.6
      date: fmtDef(date, compareDate),
      // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
      time: fmtDef(getTime(true), compareTime),
      "date-time": fmtDef(getDateTime(true), compareDateTime),
      "iso-time": fmtDef(getTime(), compareIsoTime),
      "iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
      // duration: https://tools.ietf.org/html/rfc3339#appendix-A
      duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
      uri,
      "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
      // uri-template: https://tools.ietf.org/html/rfc6570
      "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
      // For the source: https://gist.github.com/dperini/729294
      // For test cases: https://mathiasbynens.be/demo/url-regex
      url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
      email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
      hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
      // optimized https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9780596802837/ch07s16.html
      ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
      ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
      regex,
      // uuid: http://tools.ietf.org/html/rfc4122
      uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
      // JSON-pointer: https://tools.ietf.org/html/rfc6901
      // uri fragment: https://tools.ietf.org/html/rfc3986#appendix-A
      "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
      "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
      // relative JSON-pointer: http://tools.ietf.org/html/draft-luff-relative-json-pointer-00
      "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
      // the following formats are used by the openapi specification: https://spec.openapis.org/oas/v3.0.0#data-types
      // byte: https://github.com/miguelmota/is-base64
      byte,
      // signed 32 bit integer
      int32: { type: "number", validate: validateInt32 },
      // signed 64 bit integer
      int64: { type: "number", validate: validateInt64 },
      // C-type float
      float: { type: "number", validate: validateNumber },
      // C-type double
      double: { type: "number", validate: validateNumber },
      // hint to the UI to hide input strings
      password: true,
      // unchecked string payload
      binary: true
    };
    exports2.fastFormats = {
      ...exports2.fullFormats,
      date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
      time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
      "date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
      "iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
      "iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
      // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
      uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
      "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
      // email (sources from jsen validator):
      // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
      // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
      email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
    };
    exports2.formatNames = Object.keys(exports2.fullFormats);
    function isLeapYear(year) {
      return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    }
    var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
    var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    function date(str) {
      const matches = DATE.exec(str);
      if (!matches)
        return false;
      const year = +matches[1];
      const month = +matches[2];
      const day = +matches[3];
      return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]);
    }
    function compareDate(d1, d2) {
      if (!(d1 && d2))
        return void 0;
      if (d1 > d2)
        return 1;
      if (d1 < d2)
        return -1;
      return 0;
    }
    var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
    function getTime(strictTimeZone) {
      return function time(str) {
        const matches = TIME.exec(str);
        if (!matches)
          return false;
        const hr = +matches[1];
        const min = +matches[2];
        const sec = +matches[3];
        const tz = matches[4];
        const tzSign = matches[5] === "-" ? -1 : 1;
        const tzH = +(matches[6] || 0);
        const tzM = +(matches[7] || 0);
        if (tzH > 23 || tzM > 59 || strictTimeZone && !tz)
          return false;
        if (hr <= 23 && min <= 59 && sec < 60)
          return true;
        const utcMin = min - tzM * tzSign;
        const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
        return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
      };
    }
    function compareTime(s1, s2) {
      if (!(s1 && s2))
        return void 0;
      const t1 = (/* @__PURE__ */ new Date("2020-01-01T" + s1)).valueOf();
      const t2 = (/* @__PURE__ */ new Date("2020-01-01T" + s2)).valueOf();
      if (!(t1 && t2))
        return void 0;
      return t1 - t2;
    }
    function compareIsoTime(t1, t2) {
      if (!(t1 && t2))
        return void 0;
      const a1 = TIME.exec(t1);
      const a2 = TIME.exec(t2);
      if (!(a1 && a2))
        return void 0;
      t1 = a1[1] + a1[2] + a1[3];
      t2 = a2[1] + a2[2] + a2[3];
      if (t1 > t2)
        return 1;
      if (t1 < t2)
        return -1;
      return 0;
    }
    var DATE_TIME_SEPARATOR = /t|\s/i;
    function getDateTime(strictTimeZone) {
      const time = getTime(strictTimeZone);
      return function date_time(str) {
        const dateTime = str.split(DATE_TIME_SEPARATOR);
        return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
      };
    }
    function compareDateTime(dt1, dt2) {
      if (!(dt1 && dt2))
        return void 0;
      const d1 = new Date(dt1).valueOf();
      const d2 = new Date(dt2).valueOf();
      if (!(d1 && d2))
        return void 0;
      return d1 - d2;
    }
    function compareIsoDateTime(dt1, dt2) {
      if (!(dt1 && dt2))
        return void 0;
      const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
      const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
      const res = compareDate(d1, d2);
      if (res === void 0)
        return void 0;
      return res || compareTime(t1, t2);
    }
    var NOT_URI_FRAGMENT = /\/|:/;
    var URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
    function uri(str) {
      return NOT_URI_FRAGMENT.test(str) && URI.test(str);
    }
    var BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
    function byte(str) {
      BYTE.lastIndex = 0;
      return BYTE.test(str);
    }
    var MIN_INT32 = -(2 ** 31);
    var MAX_INT32 = 2 ** 31 - 1;
    function validateInt32(value2) {
      return Number.isInteger(value2) && value2 <= MAX_INT32 && value2 >= MIN_INT32;
    }
    function validateInt64(value2) {
      return Number.isInteger(value2);
    }
    function validateNumber() {
      return true;
    }
    var Z_ANCHOR = /[^\\]\\Z/;
    function regex(str) {
      if (Z_ANCHOR.test(str))
        return false;
      try {
        new RegExp(str);
        return true;
      } catch (e) {
        return false;
      }
    }
  }
});

// node_modules/ajv-formats/dist/limit.js
var require_limit = __commonJS({
  "node_modules/ajv-formats/dist/limit.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.formatLimitDefinition = void 0;
    var ajv_1 = require_ajv();
    var codegen_1 = require_codegen();
    var ops = codegen_1.operators;
    var KWDs = {
      formatMaximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
      formatMinimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
      formatExclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
      formatExclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
    };
    var error = {
      message: ({ keyword, schemaCode }) => (0, codegen_1.str)`should be ${KWDs[keyword].okStr} ${schemaCode}`,
      params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
    };
    exports2.formatLimitDefinition = {
      keyword: Object.keys(KWDs),
      type: "string",
      schemaType: "string",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, schemaCode, keyword, it } = cxt;
        const { opts, self } = it;
        if (!opts.validateFormats)
          return;
        const fCxt = new ajv_1.KeywordCxt(it, self.RULES.all.format.definition, "format");
        if (fCxt.$data)
          validate$DataFormat();
        else
          validateFormat();
        function validate$DataFormat() {
          const fmts = gen.scopeValue("formats", {
            ref: self.formats,
            code: opts.code.formats
          });
          const fmt = gen.const("fmt", (0, codegen_1._)`${fmts}[${fCxt.schemaCode}]`);
          cxt.fail$data((0, codegen_1.or)((0, codegen_1._)`typeof ${fmt} != "object"`, (0, codegen_1._)`${fmt} instanceof RegExp`, (0, codegen_1._)`typeof ${fmt}.compare != "function"`, compareCode(fmt)));
        }
        function validateFormat() {
          const format = fCxt.schema;
          const fmtDef = self.formats[format];
          if (!fmtDef || fmtDef === true)
            return;
          if (typeof fmtDef != "object" || fmtDef instanceof RegExp || typeof fmtDef.compare != "function") {
            throw new Error(`"${keyword}": format "${format}" does not define "compare" function`);
          }
          const fmt = gen.scopeValue("formats", {
            key: format,
            ref: fmtDef,
            code: opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(format)}` : void 0
          });
          cxt.fail$data(compareCode(fmt));
        }
        function compareCode(fmt) {
          return (0, codegen_1._)`${fmt}.compare(${data}, ${schemaCode}) ${KWDs[keyword].fail} 0`;
        }
      },
      dependencies: ["format"]
    };
    var formatLimitPlugin = (ajv) => {
      ajv.addKeyword(exports2.formatLimitDefinition);
      return ajv;
    };
    exports2.default = formatLimitPlugin;
  }
});

// node_modules/ajv-formats/dist/index.js
var require_dist = __commonJS({
  "node_modules/ajv-formats/dist/index.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var formats_1 = require_formats();
    var limit_1 = require_limit();
    var codegen_1 = require_codegen();
    var fullName = new codegen_1.Name("fullFormats");
    var fastName = new codegen_1.Name("fastFormats");
    var formatsPlugin = (ajv, opts = { keywords: true }) => {
      if (Array.isArray(opts)) {
        addFormats2(ajv, opts, formats_1.fullFormats, fullName);
        return ajv;
      }
      const [formats, exportName] = opts.mode === "fast" ? [formats_1.fastFormats, fastName] : [formats_1.fullFormats, fullName];
      const list = opts.formats || formats_1.formatNames;
      addFormats2(ajv, list, formats, exportName);
      if (opts.keywords)
        (0, limit_1.default)(ajv);
      return ajv;
    };
    formatsPlugin.get = (name, mode = "full") => {
      const formats = mode === "fast" ? formats_1.fastFormats : formats_1.fullFormats;
      const f = formats[name];
      if (!f)
        throw new Error(`Unknown format "${name}"`);
      return f;
    };
    function addFormats2(ajv, list, fs, exportName) {
      var _a;
      var _b;
      (_a = (_b = ajv.opts.code).formats) !== null && _a !== void 0 ? _a : _b.formats = (0, codegen_1._)`require("ajv-formats/dist/formats").${exportName}`;
      for (const f of list)
        ajv.addFormat(f, fs[f]);
    }
    module2.exports = exports2 = formatsPlugin;
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = formatsPlugin;
  }
});

// node_modules/next/dist/shared/lib/i18n/detect-domain-locale.js
var require_detect_domain_locale = __commonJS({
  "node_modules/next/dist/shared/lib/i18n/detect-domain-locale.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "detectDomainLocale", {
      enumerable: true,
      get: function() {
        return detectDomainLocale;
      }
    });
    function detectDomainLocale(domainItems, hostname, detectedLocale) {
      if (!domainItems) return;
      if (detectedLocale) {
        detectedLocale = detectedLocale.toLowerCase();
      }
      for (const item of domainItems) {
        const domainHostname = item.domain?.split(":", 1)[0].toLowerCase();
        if (hostname === domainHostname || detectedLocale === item.defaultLocale.toLowerCase() || item.locales?.some((locale) => locale.toLowerCase() === detectedLocale)) {
          return item;
        }
      }
    }
  }
});

// node_modules/next/dist/shared/lib/router/utils/remove-trailing-slash.js
var require_remove_trailing_slash = __commonJS({
  "node_modules/next/dist/shared/lib/router/utils/remove-trailing-slash.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "removeTrailingSlash", {
      enumerable: true,
      get: function() {
        return removeTrailingSlash;
      }
    });
    function removeTrailingSlash(route) {
      return route.replace(/\/$/, "") || "/";
    }
  }
});

// node_modules/next/dist/shared/lib/router/utils/parse-path.js
var require_parse_path = __commonJS({
  "node_modules/next/dist/shared/lib/router/utils/parse-path.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "parsePath", {
      enumerable: true,
      get: function() {
        return parsePath2;
      }
    });
    function parsePath2(path2) {
      const hashIndex = path2.indexOf("#");
      const queryIndex = path2.indexOf("?");
      const hasQuery = queryIndex > -1 && (hashIndex < 0 || queryIndex < hashIndex);
      if (hasQuery || hashIndex > -1) {
        return {
          pathname: path2.substring(0, hasQuery ? queryIndex : hashIndex),
          query: hasQuery ? path2.substring(queryIndex, hashIndex > -1 ? hashIndex : void 0) : "",
          hash: hashIndex > -1 ? path2.slice(hashIndex) : ""
        };
      }
      return {
        pathname: path2,
        query: "",
        hash: ""
      };
    }
  }
});

// node_modules/next/dist/shared/lib/router/utils/add-path-prefix.js
var require_add_path_prefix = __commonJS({
  "node_modules/next/dist/shared/lib/router/utils/add-path-prefix.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "addPathPrefix", {
      enumerable: true,
      get: function() {
        return addPathPrefix;
      }
    });
    var _parsepath = require_parse_path();
    function addPathPrefix(path2, prefix) {
      if (!path2.startsWith("/") || !prefix) {
        return path2;
      }
      const { pathname, query, hash } = (0, _parsepath.parsePath)(path2);
      return `${prefix}${pathname}${query}${hash}`;
    }
  }
});

// node_modules/next/dist/shared/lib/router/utils/add-path-suffix.js
var require_add_path_suffix = __commonJS({
  "node_modules/next/dist/shared/lib/router/utils/add-path-suffix.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "addPathSuffix", {
      enumerable: true,
      get: function() {
        return addPathSuffix;
      }
    });
    var _parsepath = require_parse_path();
    function addPathSuffix(path2, suffix) {
      if (!path2.startsWith("/") || !suffix) {
        return path2;
      }
      const { pathname, query, hash } = (0, _parsepath.parsePath)(path2);
      return `${pathname}${suffix}${query}${hash}`;
    }
  }
});

// node_modules/next/dist/shared/lib/router/utils/path-has-prefix.js
var require_path_has_prefix = __commonJS({
  "node_modules/next/dist/shared/lib/router/utils/path-has-prefix.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "pathHasPrefix", {
      enumerable: true,
      get: function() {
        return pathHasPrefix;
      }
    });
    var _parsepath = require_parse_path();
    function pathHasPrefix(path2, prefix) {
      if (typeof path2 !== "string") {
        return false;
      }
      const { pathname } = (0, _parsepath.parsePath)(path2);
      return pathname === prefix || pathname.startsWith(prefix + "/");
    }
  }
});

// node_modules/next/dist/shared/lib/router/utils/add-locale.js
var require_add_locale = __commonJS({
  "node_modules/next/dist/shared/lib/router/utils/add-locale.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "addLocale", {
      enumerable: true,
      get: function() {
        return addLocale;
      }
    });
    var _addpathprefix = require_add_path_prefix();
    var _pathhasprefix = require_path_has_prefix();
    function addLocale(path2, locale, defaultLocale, ignorePrefix) {
      if (!locale || locale === defaultLocale) return path2;
      const lower = path2.toLowerCase();
      if (!ignorePrefix) {
        if ((0, _pathhasprefix.pathHasPrefix)(lower, "/api")) return path2;
        if ((0, _pathhasprefix.pathHasPrefix)(lower, `/${locale.toLowerCase()}`)) return path2;
      }
      return (0, _addpathprefix.addPathPrefix)(path2, `/${locale}`);
    }
  }
});

// node_modules/next/dist/shared/lib/router/utils/format-next-pathname-info.js
var require_format_next_pathname_info = __commonJS({
  "node_modules/next/dist/shared/lib/router/utils/format-next-pathname-info.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "formatNextPathnameInfo", {
      enumerable: true,
      get: function() {
        return formatNextPathnameInfo;
      }
    });
    var _removetrailingslash = require_remove_trailing_slash();
    var _addpathprefix = require_add_path_prefix();
    var _addpathsuffix = require_add_path_suffix();
    var _addlocale = require_add_locale();
    function formatNextPathnameInfo(info) {
      let pathname = (0, _addlocale.addLocale)(info.pathname, info.locale, info.buildId ? void 0 : info.defaultLocale, info.ignorePrefix);
      if (info.buildId || !info.trailingSlash) {
        pathname = (0, _removetrailingslash.removeTrailingSlash)(pathname);
      }
      if (info.buildId) {
        pathname = (0, _addpathsuffix.addPathSuffix)((0, _addpathprefix.addPathPrefix)(pathname, `/_next/data/${info.buildId}`), info.pathname === "/" ? "index.json" : ".json");
      }
      pathname = (0, _addpathprefix.addPathPrefix)(pathname, info.basePath);
      return !info.buildId && info.trailingSlash ? !pathname.endsWith("/") ? (0, _addpathsuffix.addPathSuffix)(pathname, "/") : pathname : (0, _removetrailingslash.removeTrailingSlash)(pathname);
    }
  }
});

// node_modules/next/dist/shared/lib/get-hostname.js
var require_get_hostname = __commonJS({
  "node_modules/next/dist/shared/lib/get-hostname.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "getHostname", {
      enumerable: true,
      get: function() {
        return getHostname;
      }
    });
    function getHostname(parsed, headers) {
      let hostname;
      if (headers?.host && !Array.isArray(headers.host)) {
        hostname = headers.host.toString().split(":", 1)[0];
      } else if (parsed.hostname) {
        hostname = parsed.hostname;
      } else return;
      return hostname.toLowerCase();
    }
  }
});

// node_modules/next/dist/shared/lib/i18n/normalize-locale-path.js
var require_normalize_locale_path = __commonJS({
  "node_modules/next/dist/shared/lib/i18n/normalize-locale-path.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "normalizeLocalePath", {
      enumerable: true,
      get: function() {
        return normalizeLocalePath;
      }
    });
    var cache = /* @__PURE__ */ new WeakMap();
    function normalizeLocalePath(pathname, locales) {
      if (!locales) return {
        pathname
      };
      let lowercasedLocales = cache.get(locales);
      if (!lowercasedLocales) {
        lowercasedLocales = locales.map((locale) => locale.toLowerCase());
        cache.set(locales, lowercasedLocales);
      }
      let detectedLocale;
      const segments = pathname.split("/", 2);
      if (!segments[1]) return {
        pathname
      };
      const segment = segments[1].toLowerCase();
      const index = lowercasedLocales.indexOf(segment);
      if (index < 0) return {
        pathname
      };
      detectedLocale = locales[index];
      pathname = pathname.slice(detectedLocale.length + 1) || "/";
      return {
        pathname,
        detectedLocale
      };
    }
  }
});

// node_modules/next/dist/shared/lib/router/utils/remove-path-prefix.js
var require_remove_path_prefix = __commonJS({
  "node_modules/next/dist/shared/lib/router/utils/remove-path-prefix.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "removePathPrefix", {
      enumerable: true,
      get: function() {
        return removePathPrefix;
      }
    });
    var _pathhasprefix = require_path_has_prefix();
    function removePathPrefix(path2, prefix) {
      if (!(0, _pathhasprefix.pathHasPrefix)(path2, prefix)) {
        return path2;
      }
      const withoutPrefix = path2.slice(prefix.length);
      if (withoutPrefix.startsWith("/")) {
        return withoutPrefix;
      }
      return `/${withoutPrefix}`;
    }
  }
});

// node_modules/next/dist/shared/lib/router/utils/get-next-pathname-info.js
var require_get_next_pathname_info = __commonJS({
  "node_modules/next/dist/shared/lib/router/utils/get-next-pathname-info.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "getNextPathnameInfo", {
      enumerable: true,
      get: function() {
        return getNextPathnameInfo;
      }
    });
    var _normalizelocalepath = require_normalize_locale_path();
    var _removepathprefix = require_remove_path_prefix();
    var _pathhasprefix = require_path_has_prefix();
    function getNextPathnameInfo(pathname, options) {
      const { basePath, i18n, trailingSlash } = options.nextConfig ?? {};
      const info = {
        pathname,
        trailingSlash: pathname !== "/" ? pathname.endsWith("/") : trailingSlash
      };
      if (basePath && (0, _pathhasprefix.pathHasPrefix)(info.pathname, basePath)) {
        info.pathname = (0, _removepathprefix.removePathPrefix)(info.pathname, basePath);
        info.basePath = basePath;
      }
      let pathnameNoDataPrefix = info.pathname;
      if (info.pathname.startsWith("/_next/data/") && info.pathname.endsWith(".json")) {
        const paths = info.pathname.replace(/^\/_next\/data\//, "").replace(/\.json$/, "").split("/");
        const buildId = paths[0];
        info.buildId = buildId;
        pathnameNoDataPrefix = paths[1] !== "index" ? `/${paths.slice(1).join("/")}` : "/";
        if (options.parseData === true) {
          info.pathname = pathnameNoDataPrefix;
        }
      }
      if (i18n) {
        let result = options.i18nProvider ? options.i18nProvider.analyze(info.pathname) : (0, _normalizelocalepath.normalizeLocalePath)(info.pathname, i18n.locales);
        info.locale = result.detectedLocale;
        info.pathname = result.pathname ?? info.pathname;
        if (!result.detectedLocale && info.buildId) {
          result = options.i18nProvider ? options.i18nProvider.analyze(pathnameNoDataPrefix) : (0, _normalizelocalepath.normalizeLocalePath)(pathnameNoDataPrefix, i18n.locales);
          if (result.detectedLocale) {
            info.locale = result.detectedLocale;
          }
        }
      }
      return info;
    }
  }
});

// node_modules/next/dist/server/web/next-url.js
var require_next_url = __commonJS({
  "node_modules/next/dist/server/web/next-url.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "NextURL", {
      enumerable: true,
      get: function() {
        return NextURL;
      }
    });
    var _detectdomainlocale = require_detect_domain_locale();
    var _formatnextpathnameinfo = require_format_next_pathname_info();
    var _gethostname = require_get_hostname();
    var _getnextpathnameinfo = require_get_next_pathname_info();
    var REGEX_LOCALHOST_HOSTNAME = /^(?:127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}|\[::1\]|localhost)$/;
    function parseURL(url, base) {
      const parsed = new URL(String(url), base && String(base));
      if (REGEX_LOCALHOST_HOSTNAME.test(parsed.hostname)) {
        parsed.hostname = "localhost";
      }
      return parsed;
    }
    var Internal = /* @__PURE__ */ Symbol("NextURLInternal");
    var NextURL = class _NextURL {
      constructor(input, baseOrOpts, opts) {
        let base;
        let options;
        if (typeof baseOrOpts === "object" && "pathname" in baseOrOpts || typeof baseOrOpts === "string") {
          base = baseOrOpts;
          options = opts || {};
        } else {
          options = opts || baseOrOpts || {};
        }
        this[Internal] = {
          url: parseURL(input, base ?? options.base),
          options,
          basePath: ""
        };
        this.analyze();
      }
      analyze() {
        var _this_Internal_options_nextConfig_i18n, _this_Internal_options_nextConfig, _this_Internal_domainLocale, _this_Internal_options_nextConfig_i18n1, _this_Internal_options_nextConfig1;
        const info = (0, _getnextpathnameinfo.getNextPathnameInfo)(this[Internal].url.pathname, {
          nextConfig: this[Internal].options.nextConfig,
          parseData: !process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE,
          i18nProvider: this[Internal].options.i18nProvider
        });
        const hostname = (0, _gethostname.getHostname)(this[Internal].url, this[Internal].options.headers);
        this[Internal].domainLocale = this[Internal].options.i18nProvider ? this[Internal].options.i18nProvider.detectDomainLocale(hostname) : (0, _detectdomainlocale.detectDomainLocale)((_this_Internal_options_nextConfig = this[Internal].options.nextConfig) == null ? void 0 : (_this_Internal_options_nextConfig_i18n = _this_Internal_options_nextConfig.i18n) == null ? void 0 : _this_Internal_options_nextConfig_i18n.domains, hostname);
        const defaultLocale = ((_this_Internal_domainLocale = this[Internal].domainLocale) == null ? void 0 : _this_Internal_domainLocale.defaultLocale) || ((_this_Internal_options_nextConfig1 = this[Internal].options.nextConfig) == null ? void 0 : (_this_Internal_options_nextConfig_i18n1 = _this_Internal_options_nextConfig1.i18n) == null ? void 0 : _this_Internal_options_nextConfig_i18n1.defaultLocale);
        this[Internal].url.pathname = info.pathname;
        this[Internal].defaultLocale = defaultLocale;
        this[Internal].basePath = info.basePath ?? "";
        this[Internal].buildId = info.buildId;
        this[Internal].locale = info.locale ?? defaultLocale;
        this[Internal].trailingSlash = info.trailingSlash;
      }
      formatPathname() {
        return (0, _formatnextpathnameinfo.formatNextPathnameInfo)({
          basePath: this[Internal].basePath,
          buildId: this[Internal].buildId,
          defaultLocale: !this[Internal].options.forceLocale ? this[Internal].defaultLocale : void 0,
          locale: this[Internal].locale,
          pathname: this[Internal].url.pathname,
          trailingSlash: this[Internal].trailingSlash
        });
      }
      formatSearch() {
        return this[Internal].url.search;
      }
      get buildId() {
        return this[Internal].buildId;
      }
      set buildId(buildId) {
        this[Internal].buildId = buildId;
      }
      get locale() {
        return this[Internal].locale ?? "";
      }
      set locale(locale) {
        var _this_Internal_options_nextConfig_i18n, _this_Internal_options_nextConfig;
        if (!this[Internal].locale || !((_this_Internal_options_nextConfig = this[Internal].options.nextConfig) == null ? void 0 : (_this_Internal_options_nextConfig_i18n = _this_Internal_options_nextConfig.i18n) == null ? void 0 : _this_Internal_options_nextConfig_i18n.locales.includes(locale))) {
          throw Object.defineProperty(new TypeError(`The NextURL configuration includes no locale "${locale}"`), "__NEXT_ERROR_CODE", {
            value: "E597",
            enumerable: false,
            configurable: true
          });
        }
        this[Internal].locale = locale;
      }
      get defaultLocale() {
        return this[Internal].defaultLocale;
      }
      get domainLocale() {
        return this[Internal].domainLocale;
      }
      get searchParams() {
        return this[Internal].url.searchParams;
      }
      get host() {
        return this[Internal].url.host;
      }
      set host(value2) {
        this[Internal].url.host = value2;
      }
      get hostname() {
        return this[Internal].url.hostname;
      }
      set hostname(value2) {
        this[Internal].url.hostname = value2;
      }
      get port() {
        return this[Internal].url.port;
      }
      set port(value2) {
        this[Internal].url.port = value2;
      }
      get protocol() {
        return this[Internal].url.protocol;
      }
      set protocol(value2) {
        this[Internal].url.protocol = value2;
      }
      get href() {
        const pathname = this.formatPathname();
        const search = this.formatSearch();
        return `${this.protocol}//${this.host}${pathname}${search}${this.hash}`;
      }
      set href(url) {
        this[Internal].url = parseURL(url);
        this.analyze();
      }
      get origin() {
        return this[Internal].url.origin;
      }
      get pathname() {
        return this[Internal].url.pathname;
      }
      set pathname(value2) {
        this[Internal].url.pathname = value2;
      }
      get hash() {
        return this[Internal].url.hash;
      }
      set hash(value2) {
        this[Internal].url.hash = value2;
      }
      get search() {
        return this[Internal].url.search;
      }
      set search(value2) {
        this[Internal].url.search = value2;
      }
      get password() {
        return this[Internal].url.password;
      }
      set password(value2) {
        this[Internal].url.password = value2;
      }
      get username() {
        return this[Internal].url.username;
      }
      set username(value2) {
        this[Internal].url.username = value2;
      }
      get basePath() {
        return this[Internal].basePath;
      }
      set basePath(value2) {
        this[Internal].basePath = value2.startsWith("/") ? value2 : `/${value2}`;
      }
      toString() {
        return this.href;
      }
      toJSON() {
        return this.href;
      }
      [/* @__PURE__ */ Symbol.for("edge-runtime.inspect.custom")]() {
        return {
          href: this.href,
          origin: this.origin,
          protocol: this.protocol,
          username: this.username,
          password: this.password,
          host: this.host,
          hostname: this.hostname,
          port: this.port,
          pathname: this.pathname,
          search: this.search,
          searchParams: this.searchParams,
          hash: this.hash
        };
      }
      clone() {
        return new _NextURL(String(this), this[Internal].options);
      }
    };
  }
});

// node_modules/next/dist/lib/constants.js
var require_constants = __commonJS({
  "node_modules/next/dist/lib/constants.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      ACTION_SUFFIX: function() {
        return ACTION_SUFFIX;
      },
      APP_DIR_ALIAS: function() {
        return APP_DIR_ALIAS;
      },
      CACHE_ONE_YEAR_SECONDS: function() {
        return CACHE_ONE_YEAR_SECONDS;
      },
      DOT_NEXT_ALIAS: function() {
        return DOT_NEXT_ALIAS;
      },
      ESLINT_DEFAULT_DIRS: function() {
        return ESLINT_DEFAULT_DIRS;
      },
      GSP_NO_RETURNED_VALUE: function() {
        return GSP_NO_RETURNED_VALUE;
      },
      GSSP_COMPONENT_MEMBER_ERROR: function() {
        return GSSP_COMPONENT_MEMBER_ERROR;
      },
      GSSP_NO_RETURNED_VALUE: function() {
        return GSSP_NO_RETURNED_VALUE;
      },
      HTML_CONTENT_TYPE_HEADER: function() {
        return HTML_CONTENT_TYPE_HEADER;
      },
      INFINITE_CACHE: function() {
        return INFINITE_CACHE;
      },
      INSTRUMENTATION_HOOK_FILENAME: function() {
        return INSTRUMENTATION_HOOK_FILENAME;
      },
      JSON_CONTENT_TYPE_HEADER: function() {
        return JSON_CONTENT_TYPE_HEADER;
      },
      MATCHED_PATH_HEADER: function() {
        return MATCHED_PATH_HEADER;
      },
      MIDDLEWARE_FILENAME: function() {
        return MIDDLEWARE_FILENAME;
      },
      MIDDLEWARE_LOCATION_REGEXP: function() {
        return MIDDLEWARE_LOCATION_REGEXP;
      },
      NEXT_BODY_SUFFIX: function() {
        return NEXT_BODY_SUFFIX;
      },
      NEXT_CACHE_IMPLICIT_TAG_ID: function() {
        return NEXT_CACHE_IMPLICIT_TAG_ID;
      },
      NEXT_CACHE_REVALIDATED_TAGS_HEADER: function() {
        return NEXT_CACHE_REVALIDATED_TAGS_HEADER;
      },
      NEXT_CACHE_REVALIDATE_TAG_TOKEN_HEADER: function() {
        return NEXT_CACHE_REVALIDATE_TAG_TOKEN_HEADER;
      },
      NEXT_CACHE_ROOT_PARAM_TAG_ID: function() {
        return NEXT_CACHE_ROOT_PARAM_TAG_ID;
      },
      NEXT_CACHE_SOFT_TAG_MAX_LENGTH: function() {
        return NEXT_CACHE_SOFT_TAG_MAX_LENGTH;
      },
      NEXT_CACHE_TAGS_HEADER: function() {
        return NEXT_CACHE_TAGS_HEADER;
      },
      NEXT_CACHE_TAG_MAX_ITEMS: function() {
        return NEXT_CACHE_TAG_MAX_ITEMS;
      },
      NEXT_CACHE_TAG_MAX_LENGTH: function() {
        return NEXT_CACHE_TAG_MAX_LENGTH;
      },
      NEXT_DATA_SUFFIX: function() {
        return NEXT_DATA_SUFFIX;
      },
      NEXT_INTERCEPTION_MARKER_PREFIX: function() {
        return NEXT_INTERCEPTION_MARKER_PREFIX;
      },
      NEXT_META_SUFFIX: function() {
        return NEXT_META_SUFFIX;
      },
      NEXT_NAV_DEPLOYMENT_ID_HEADER: function() {
        return NEXT_NAV_DEPLOYMENT_ID_HEADER;
      },
      NEXT_QUERY_PARAM_PREFIX: function() {
        return NEXT_QUERY_PARAM_PREFIX;
      },
      NEXT_RESUME_HEADER: function() {
        return NEXT_RESUME_HEADER;
      },
      NEXT_RESUME_STATE_LENGTH_HEADER: function() {
        return NEXT_RESUME_STATE_LENGTH_HEADER;
      },
      NON_STANDARD_NODE_ENV: function() {
        return NON_STANDARD_NODE_ENV;
      },
      PAGES_DIR_ALIAS: function() {
        return PAGES_DIR_ALIAS;
      },
      PRERENDER_REVALIDATE_HEADER: function() {
        return PRERENDER_REVALIDATE_HEADER;
      },
      PRERENDER_REVALIDATE_ONLY_GENERATED_HEADER: function() {
        return PRERENDER_REVALIDATE_ONLY_GENERATED_HEADER;
      },
      PROXY_FILENAME: function() {
        return PROXY_FILENAME;
      },
      PROXY_LOCATION_REGEXP: function() {
        return PROXY_LOCATION_REGEXP;
      },
      PUBLIC_DIR_MIDDLEWARE_CONFLICT: function() {
        return PUBLIC_DIR_MIDDLEWARE_CONFLICT;
      },
      ROOT_DIR_ALIAS: function() {
        return ROOT_DIR_ALIAS;
      },
      RSC_ACTION_CLIENT_WRAPPER_ALIAS: function() {
        return RSC_ACTION_CLIENT_WRAPPER_ALIAS;
      },
      RSC_ACTION_ENCRYPTION_ALIAS: function() {
        return RSC_ACTION_ENCRYPTION_ALIAS;
      },
      RSC_ACTION_PROXY_ALIAS: function() {
        return RSC_ACTION_PROXY_ALIAS;
      },
      RSC_ACTION_VALIDATE_ALIAS: function() {
        return RSC_ACTION_VALIDATE_ALIAS;
      },
      RSC_CACHE_WRAPPER_ALIAS: function() {
        return RSC_CACHE_WRAPPER_ALIAS;
      },
      RSC_DYNAMIC_IMPORT_WRAPPER_ALIAS: function() {
        return RSC_DYNAMIC_IMPORT_WRAPPER_ALIAS;
      },
      RSC_MOD_REF_PROXY_ALIAS: function() {
        return RSC_MOD_REF_PROXY_ALIAS;
      },
      RSC_SEGMENTS_DIR_SUFFIX: function() {
        return RSC_SEGMENTS_DIR_SUFFIX;
      },
      RSC_SEGMENT_SUFFIX: function() {
        return RSC_SEGMENT_SUFFIX;
      },
      RSC_SUFFIX: function() {
        return RSC_SUFFIX;
      },
      SERVER_PROPS_EXPORT_ERROR: function() {
        return SERVER_PROPS_EXPORT_ERROR;
      },
      SERVER_PROPS_GET_INIT_PROPS_CONFLICT: function() {
        return SERVER_PROPS_GET_INIT_PROPS_CONFLICT;
      },
      SERVER_PROPS_SSG_CONFLICT: function() {
        return SERVER_PROPS_SSG_CONFLICT;
      },
      SERVER_RUNTIME: function() {
        return SERVER_RUNTIME;
      },
      SSG_FALLBACK_EXPORT_ERROR: function() {
        return SSG_FALLBACK_EXPORT_ERROR;
      },
      SSG_GET_INITIAL_PROPS_CONFLICT: function() {
        return SSG_GET_INITIAL_PROPS_CONFLICT;
      },
      STATIC_STATUS_PAGE_GET_INITIAL_PROPS_ERROR: function() {
        return STATIC_STATUS_PAGE_GET_INITIAL_PROPS_ERROR;
      },
      TEXT_PLAIN_CONTENT_TYPE_HEADER: function() {
        return TEXT_PLAIN_CONTENT_TYPE_HEADER;
      },
      UNSTABLE_REVALIDATE_RENAME_ERROR: function() {
        return UNSTABLE_REVALIDATE_RENAME_ERROR;
      },
      WEBPACK_LAYERS: function() {
        return WEBPACK_LAYERS;
      },
      WEBPACK_RESOURCE_QUERIES: function() {
        return WEBPACK_RESOURCE_QUERIES;
      },
      WEB_SOCKET_MAX_RECONNECTIONS: function() {
        return WEB_SOCKET_MAX_RECONNECTIONS;
      }
    });
    var TEXT_PLAIN_CONTENT_TYPE_HEADER = "text/plain";
    var HTML_CONTENT_TYPE_HEADER = "text/html; charset=utf-8";
    var JSON_CONTENT_TYPE_HEADER = "application/json; charset=utf-8";
    var NEXT_QUERY_PARAM_PREFIX = "nxtP";
    var NEXT_INTERCEPTION_MARKER_PREFIX = "nxtI";
    var MATCHED_PATH_HEADER = "x-matched-path";
    var PRERENDER_REVALIDATE_HEADER = "x-prerender-revalidate";
    var PRERENDER_REVALIDATE_ONLY_GENERATED_HEADER = "x-prerender-revalidate-if-generated";
    var RSC_SEGMENTS_DIR_SUFFIX = ".segments";
    var RSC_SEGMENT_SUFFIX = ".segment.rsc";
    var RSC_SUFFIX = ".rsc";
    var ACTION_SUFFIX = ".action";
    var NEXT_DATA_SUFFIX = ".json";
    var NEXT_META_SUFFIX = ".meta";
    var NEXT_BODY_SUFFIX = ".body";
    var NEXT_NAV_DEPLOYMENT_ID_HEADER = "x-nextjs-deployment-id";
    var NEXT_CACHE_TAGS_HEADER = "x-next-cache-tags";
    var NEXT_CACHE_REVALIDATED_TAGS_HEADER = "x-next-revalidated-tags";
    var NEXT_CACHE_REVALIDATE_TAG_TOKEN_HEADER = "x-next-revalidate-tag-token";
    var NEXT_RESUME_HEADER = "next-resume";
    var NEXT_RESUME_STATE_LENGTH_HEADER = "x-next-resume-state-length";
    var NEXT_CACHE_TAG_MAX_ITEMS = 128;
    var NEXT_CACHE_TAG_MAX_LENGTH = 256;
    var NEXT_CACHE_SOFT_TAG_MAX_LENGTH = 1024;
    var NEXT_CACHE_IMPLICIT_TAG_ID = "_N_T_";
    var NEXT_CACHE_ROOT_PARAM_TAG_ID = "_N_RP_";
    var CACHE_ONE_YEAR_SECONDS = 31536e3;
    var INFINITE_CACHE = 4294967294;
    var MIDDLEWARE_FILENAME = "middleware";
    var MIDDLEWARE_LOCATION_REGEXP = `(?:src/)?${MIDDLEWARE_FILENAME}`;
    var PROXY_FILENAME = "proxy";
    var PROXY_LOCATION_REGEXP = `(?:src/)?${PROXY_FILENAME}`;
    var INSTRUMENTATION_HOOK_FILENAME = "instrumentation";
    var PAGES_DIR_ALIAS = "private-next-pages";
    var DOT_NEXT_ALIAS = "private-dot-next";
    var ROOT_DIR_ALIAS = "private-next-root-dir";
    var APP_DIR_ALIAS = "private-next-app-dir";
    var RSC_MOD_REF_PROXY_ALIAS = "private-next-rsc-mod-ref-proxy";
    var RSC_ACTION_VALIDATE_ALIAS = "private-next-rsc-action-validate";
    var RSC_ACTION_PROXY_ALIAS = "private-next-rsc-server-reference";
    var RSC_CACHE_WRAPPER_ALIAS = "private-next-rsc-cache-wrapper";
    var RSC_DYNAMIC_IMPORT_WRAPPER_ALIAS = "private-next-rsc-track-dynamic-import";
    var RSC_ACTION_ENCRYPTION_ALIAS = "private-next-rsc-action-encryption";
    var RSC_ACTION_CLIENT_WRAPPER_ALIAS = "private-next-rsc-action-client-wrapper";
    var PUBLIC_DIR_MIDDLEWARE_CONFLICT = `You can not have a '_next' folder inside of your public folder. This conflicts with the internal '/_next' route. https://nextjs.org/docs/messages/public-next-folder-conflict`;
    var SSG_GET_INITIAL_PROPS_CONFLICT = `You can not use getInitialProps with getStaticProps. To use SSG, please remove your getInitialProps`;
    var SERVER_PROPS_GET_INIT_PROPS_CONFLICT = `You can not use getInitialProps with getServerSideProps. Please remove getInitialProps.`;
    var SERVER_PROPS_SSG_CONFLICT = `You can not use getStaticProps or getStaticPaths with getServerSideProps. To use SSG, please remove getServerSideProps`;
    var STATIC_STATUS_PAGE_GET_INITIAL_PROPS_ERROR = `can not have getInitialProps/getServerSideProps, https://nextjs.org/docs/messages/404-get-initial-props`;
    var SERVER_PROPS_EXPORT_ERROR = `pages with \`getServerSideProps\` can not be exported. See more info here: https://nextjs.org/docs/messages/gssp-export`;
    var GSP_NO_RETURNED_VALUE = "Your `getStaticProps` function did not return an object. Did you forget to add a `return`?";
    var GSSP_NO_RETURNED_VALUE = "Your `getServerSideProps` function did not return an object. Did you forget to add a `return`?";
    var UNSTABLE_REVALIDATE_RENAME_ERROR = "The `unstable_revalidate` property is available for general use.\nPlease use `revalidate` instead.";
    var GSSP_COMPONENT_MEMBER_ERROR = `can not be attached to a page's component and must be exported from the page. See more info here: https://nextjs.org/docs/messages/gssp-component-member`;
    var NON_STANDARD_NODE_ENV = `You are using a non-standard "NODE_ENV" value in your environment. This creates inconsistencies in the project and is strongly advised against. Read more: https://nextjs.org/docs/messages/non-standard-node-env`;
    var SSG_FALLBACK_EXPORT_ERROR = `Pages with \`fallback\` enabled in \`getStaticPaths\` can not be exported. See more info here: https://nextjs.org/docs/messages/ssg-fallback-true-export`;
    var ESLINT_DEFAULT_DIRS = [
      "app",
      "pages",
      "components",
      "lib",
      "src"
    ];
    var SERVER_RUNTIME = {
      edge: "edge",
      experimentalEdge: "experimental-edge",
      nodejs: "nodejs"
    };
    var WEB_SOCKET_MAX_RECONNECTIONS = 12;
    var WEBPACK_LAYERS_NAMES = {
      /**
      * The layer for the shared code between the client and server bundles.
      */
      shared: "shared",
      /**
      * The layer for server-only runtime and picking up `react-server` export conditions.
      * Including app router RSC pages and app router custom routes and metadata routes.
      */
      reactServerComponents: "rsc",
      /**
      * Server Side Rendering layer for app (ssr).
      */
      serverSideRendering: "ssr",
      /**
      * The browser client bundle layer for actions.
      */
      actionBrowser: "action-browser",
      /**
      * The Node.js bundle layer for the API routes.
      */
      apiNode: "api-node",
      /**
      * The Edge Lite bundle layer for the API routes.
      */
      apiEdge: "api-edge",
      /**
      * The layer for the middleware code.
      */
      middleware: "middleware",
      /**
      * The layer for the instrumentation hooks.
      */
      instrument: "instrument",
      /**
      * The layer for assets on the edge.
      */
      edgeAsset: "edge-asset",
      /**
      * The browser client bundle layer for App directory.
      */
      appPagesBrowser: "app-pages-browser",
      /**
      * The browser client bundle layer for Pages directory.
      */
      pagesDirBrowser: "pages-dir-browser",
      /**
      * The Edge Lite bundle layer for Pages directory.
      */
      pagesDirEdge: "pages-dir-edge",
      /**
      * The Node.js bundle layer for Pages directory.
      */
      pagesDirNode: "pages-dir-node"
    };
    var WEBPACK_LAYERS = {
      ...WEBPACK_LAYERS_NAMES,
      GROUP: {
        builtinReact: [
          WEBPACK_LAYERS_NAMES.reactServerComponents,
          WEBPACK_LAYERS_NAMES.actionBrowser
        ],
        serverOnly: [
          WEBPACK_LAYERS_NAMES.reactServerComponents,
          WEBPACK_LAYERS_NAMES.actionBrowser,
          WEBPACK_LAYERS_NAMES.instrument,
          WEBPACK_LAYERS_NAMES.middleware
        ],
        neutralTarget: [
          // pages api
          WEBPACK_LAYERS_NAMES.apiNode,
          WEBPACK_LAYERS_NAMES.apiEdge
        ],
        clientOnly: [
          WEBPACK_LAYERS_NAMES.serverSideRendering,
          WEBPACK_LAYERS_NAMES.appPagesBrowser
        ],
        bundled: [
          WEBPACK_LAYERS_NAMES.reactServerComponents,
          WEBPACK_LAYERS_NAMES.actionBrowser,
          WEBPACK_LAYERS_NAMES.serverSideRendering,
          WEBPACK_LAYERS_NAMES.appPagesBrowser,
          WEBPACK_LAYERS_NAMES.shared,
          WEBPACK_LAYERS_NAMES.instrument,
          WEBPACK_LAYERS_NAMES.middleware
        ],
        appPages: [
          // app router pages and layouts
          WEBPACK_LAYERS_NAMES.reactServerComponents,
          WEBPACK_LAYERS_NAMES.serverSideRendering,
          WEBPACK_LAYERS_NAMES.appPagesBrowser,
          WEBPACK_LAYERS_NAMES.actionBrowser
        ]
      }
    };
    var WEBPACK_RESOURCE_QUERIES = {
      edgeSSREntry: "__next_edge_ssr_entry__",
      metadata: "__next_metadata__",
      metadataRoute: "__next_metadata_route__",
      metadataImageMeta: "__next_metadata_image_meta__"
    };
  }
});

// node_modules/next/dist/server/web/utils.js
var require_utils2 = __commonJS({
  "node_modules/next/dist/server/web/utils.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      fromNodeOutgoingHttpHeaders: function() {
        return fromNodeOutgoingHttpHeaders;
      },
      normalizeNextQueryParam: function() {
        return normalizeNextQueryParam;
      },
      splitCookiesString: function() {
        return splitCookiesString;
      },
      toNodeOutgoingHttpHeaders: function() {
        return toNodeOutgoingHttpHeaders;
      },
      validateURL: function() {
        return validateURL;
      }
    });
    var _constants = require_constants();
    function fromNodeOutgoingHttpHeaders(nodeHeaders) {
      const headers = new Headers();
      for (let [key, value2] of Object.entries(nodeHeaders)) {
        const values = Array.isArray(value2) ? value2 : [
          value2
        ];
        for (let v of values) {
          if (typeof v === "undefined") continue;
          if (typeof v === "number") {
            v = v.toString();
          }
          headers.append(key, v);
        }
      }
      return headers;
    }
    function splitCookiesString(cookiesString) {
      var cookiesStrings = [];
      var pos = 0;
      var start;
      var ch;
      var lastComma;
      var nextStart;
      var cookiesSeparatorFound;
      function skipWhitespace() {
        while (pos < cookiesString.length && /\s/.test(cookiesString.charAt(pos))) {
          pos += 1;
        }
        return pos < cookiesString.length;
      }
      function notSpecialChar() {
        ch = cookiesString.charAt(pos);
        return ch !== "=" && ch !== ";" && ch !== ",";
      }
      while (pos < cookiesString.length) {
        start = pos;
        cookiesSeparatorFound = false;
        while (skipWhitespace()) {
          ch = cookiesString.charAt(pos);
          if (ch === ",") {
            lastComma = pos;
            pos += 1;
            skipWhitespace();
            nextStart = pos;
            while (pos < cookiesString.length && notSpecialChar()) {
              pos += 1;
            }
            if (pos < cookiesString.length && cookiesString.charAt(pos) === "=") {
              cookiesSeparatorFound = true;
              pos = nextStart;
              cookiesStrings.push(cookiesString.substring(start, lastComma));
              start = pos;
            } else {
              pos = lastComma + 1;
            }
          } else {
            pos += 1;
          }
        }
        if (!cookiesSeparatorFound || pos >= cookiesString.length) {
          cookiesStrings.push(cookiesString.substring(start, cookiesString.length));
        }
      }
      return cookiesStrings;
    }
    function toNodeOutgoingHttpHeaders(headers) {
      const nodeHeaders = {};
      const cookies = [];
      if (headers) {
        for (const [key, value2] of headers.entries()) {
          if (key.toLowerCase() === "set-cookie") {
            cookies.push(...splitCookiesString(value2));
            nodeHeaders[key] = cookies.length === 1 ? cookies[0] : cookies;
          } else {
            nodeHeaders[key] = value2;
          }
        }
      }
      return nodeHeaders;
    }
    function validateURL(url) {
      try {
        return String(new URL(String(url)));
      } catch (error) {
        throw Object.defineProperty(new Error(`URL is malformed "${String(url)}". Please use only absolute URLs - https://nextjs.org/docs/messages/middleware-relative-urls`, {
          cause: error
        }), "__NEXT_ERROR_CODE", {
          value: "E61",
          enumerable: false,
          configurable: true
        });
      }
    }
    function normalizeNextQueryParam(key) {
      const prefixes = [
        _constants.NEXT_QUERY_PARAM_PREFIX,
        _constants.NEXT_INTERCEPTION_MARKER_PREFIX
      ];
      for (const prefix of prefixes) {
        if (key !== prefix && key.startsWith(prefix)) {
          return key.substring(prefix.length);
        }
      }
      return null;
    }
  }
});

// node_modules/next/dist/server/web/error.js
var require_error = __commonJS({
  "node_modules/next/dist/server/web/error.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      PageSignatureError: function() {
        return PageSignatureError;
      },
      RemovedPageError: function() {
        return RemovedPageError;
      },
      RemovedUAError: function() {
        return RemovedUAError;
      }
    });
    var PageSignatureError = class extends Error {
      constructor({ page }) {
        super(`The middleware "${page}" accepts an async API directly with the form:
  
  export function middleware(request, event) {
    return NextResponse.redirect('/new-location')
  }
  
  Read more: https://nextjs.org/docs/messages/middleware-new-signature
  `);
      }
    };
    var RemovedPageError = class extends Error {
      constructor() {
        super(`The request.page has been deprecated in favour of \`URLPattern\`.
  Read more: https://nextjs.org/docs/messages/middleware-request-page
  `);
      }
    };
    var RemovedUAError = class extends Error {
      constructor() {
        super(`The request.ua has been removed in favour of \`userAgent\` function.
  Read more: https://nextjs.org/docs/messages/middleware-parse-user-agent
  `);
      }
    };
  }
});

// node_modules/next/dist/compiled/@edge-runtime/cookies/index.js
var require_cookies = __commonJS({
  "node_modules/next/dist/compiled/@edge-runtime/cookies/index.js"(exports2, module2) {
    "use strict";
    var __defProp2 = Object.defineProperty;
    var __getOwnPropDesc2 = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames2 = Object.getOwnPropertyNames;
    var __hasOwnProp2 = Object.prototype.hasOwnProperty;
    var __export2 = (target, all) => {
      for (var name in all)
        __defProp2(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps2 = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames2(from))
          if (!__hasOwnProp2.call(to, key) && key !== except)
            __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc2(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps2(__defProp2({}, "__esModule", { value: true }), mod);
    var src_exports = {};
    __export2(src_exports, {
      RequestCookies: () => RequestCookies,
      ResponseCookies: () => ResponseCookies,
      parseCookie: () => parseCookie,
      parseSetCookie: () => parseSetCookie,
      stringifyCookie: () => stringifyCookie
    });
    module2.exports = __toCommonJS(src_exports);
    function stringifyCookie(c) {
      var _a;
      const attrs = [
        "path" in c && c.path && `Path=${c.path}`,
        "expires" in c && (c.expires || c.expires === 0) && `Expires=${(typeof c.expires === "number" ? new Date(c.expires) : c.expires).toUTCString()}`,
        "maxAge" in c && typeof c.maxAge === "number" && `Max-Age=${c.maxAge}`,
        "domain" in c && c.domain && `Domain=${c.domain}`,
        "secure" in c && c.secure && "Secure",
        "httpOnly" in c && c.httpOnly && "HttpOnly",
        "sameSite" in c && c.sameSite && `SameSite=${c.sameSite}`,
        "partitioned" in c && c.partitioned && "Partitioned",
        "priority" in c && c.priority && `Priority=${c.priority}`
      ].filter(Boolean);
      const stringified = `${c.name}=${encodeURIComponent((_a = c.value) != null ? _a : "")}`;
      return attrs.length === 0 ? stringified : `${stringified}; ${attrs.join("; ")}`;
    }
    function parseCookie(cookie) {
      const map = /* @__PURE__ */ new Map();
      for (const pair of cookie.split(/; */)) {
        if (!pair)
          continue;
        const splitAt = pair.indexOf("=");
        if (splitAt === -1) {
          map.set(pair, "true");
          continue;
        }
        const [key, value2] = [pair.slice(0, splitAt), pair.slice(splitAt + 1)];
        try {
          map.set(key, decodeURIComponent(value2 != null ? value2 : "true"));
        } catch {
        }
      }
      return map;
    }
    function parseSetCookie(setCookie) {
      if (!setCookie) {
        return void 0;
      }
      const [[name, value2], ...attributes] = parseCookie(setCookie);
      const {
        domain,
        expires,
        httponly,
        maxage,
        path: path2,
        samesite,
        secure,
        partitioned,
        priority
      } = Object.fromEntries(
        attributes.map(([key, value22]) => [
          key.toLowerCase().replace(/-/g, ""),
          value22
        ])
      );
      const cookie = {
        name,
        value: decodeURIComponent(value2),
        domain,
        ...expires && { expires: new Date(expires) },
        ...httponly && { httpOnly: true },
        ...typeof maxage === "string" && { maxAge: Number(maxage) },
        path: path2,
        ...samesite && { sameSite: parseSameSite(samesite) },
        ...secure && { secure: true },
        ...priority && { priority: parsePriority(priority) },
        ...partitioned && { partitioned: true }
      };
      return compact(cookie);
    }
    function compact(t) {
      const newT = {};
      for (const key in t) {
        if (t[key]) {
          newT[key] = t[key];
        }
      }
      return newT;
    }
    var SAME_SITE = ["strict", "lax", "none"];
    function parseSameSite(string) {
      string = string.toLowerCase();
      return SAME_SITE.includes(string) ? string : void 0;
    }
    var PRIORITY = ["low", "medium", "high"];
    function parsePriority(string) {
      string = string.toLowerCase();
      return PRIORITY.includes(string) ? string : void 0;
    }
    function splitCookiesString(cookiesString) {
      if (!cookiesString)
        return [];
      var cookiesStrings = [];
      var pos = 0;
      var start;
      var ch;
      var lastComma;
      var nextStart;
      var cookiesSeparatorFound;
      function skipWhitespace() {
        while (pos < cookiesString.length && /\s/.test(cookiesString.charAt(pos))) {
          pos += 1;
        }
        return pos < cookiesString.length;
      }
      function notSpecialChar() {
        ch = cookiesString.charAt(pos);
        return ch !== "=" && ch !== ";" && ch !== ",";
      }
      while (pos < cookiesString.length) {
        start = pos;
        cookiesSeparatorFound = false;
        while (skipWhitespace()) {
          ch = cookiesString.charAt(pos);
          if (ch === ",") {
            lastComma = pos;
            pos += 1;
            skipWhitespace();
            nextStart = pos;
            while (pos < cookiesString.length && notSpecialChar()) {
              pos += 1;
            }
            if (pos < cookiesString.length && cookiesString.charAt(pos) === "=") {
              cookiesSeparatorFound = true;
              pos = nextStart;
              cookiesStrings.push(cookiesString.substring(start, lastComma));
              start = pos;
            } else {
              pos = lastComma + 1;
            }
          } else {
            pos += 1;
          }
        }
        if (!cookiesSeparatorFound || pos >= cookiesString.length) {
          cookiesStrings.push(cookiesString.substring(start, cookiesString.length));
        }
      }
      return cookiesStrings;
    }
    var RequestCookies = class {
      constructor(requestHeaders) {
        this._parsed = /* @__PURE__ */ new Map();
        this._headers = requestHeaders;
        const header = requestHeaders.get("cookie");
        if (header) {
          const parsed = parseCookie(header);
          for (const [name, value2] of parsed) {
            this._parsed.set(name, { name, value: value2 });
          }
        }
      }
      [Symbol.iterator]() {
        return this._parsed[Symbol.iterator]();
      }
      /**
       * The amount of cookies received from the client
       */
      get size() {
        return this._parsed.size;
      }
      get(...args) {
        const name = typeof args[0] === "string" ? args[0] : args[0].name;
        return this._parsed.get(name);
      }
      getAll(...args) {
        var _a;
        const all = Array.from(this._parsed);
        if (!args.length) {
          return all.map(([_, value2]) => value2);
        }
        const name = typeof args[0] === "string" ? args[0] : (_a = args[0]) == null ? void 0 : _a.name;
        return all.filter(([n]) => n === name).map(([_, value2]) => value2);
      }
      has(name) {
        return this._parsed.has(name);
      }
      set(...args) {
        const [name, value2] = args.length === 1 ? [args[0].name, args[0].value] : args;
        const map = this._parsed;
        map.set(name, { name, value: value2 });
        this._headers.set(
          "cookie",
          Array.from(map).map(([_, value22]) => stringifyCookie(value22)).join("; ")
        );
        return this;
      }
      /**
       * Delete the cookies matching the passed name or names in the request.
       */
      delete(names) {
        const map = this._parsed;
        const result = !Array.isArray(names) ? map.delete(names) : names.map((name) => map.delete(name));
        this._headers.set(
          "cookie",
          Array.from(map).map(([_, value2]) => stringifyCookie(value2)).join("; ")
        );
        return result;
      }
      /**
       * Delete all the cookies in the cookies in the request.
       */
      clear() {
        this.delete(Array.from(this._parsed.keys()));
        return this;
      }
      /**
       * Format the cookies in the request as a string for logging
       */
      [/* @__PURE__ */ Symbol.for("edge-runtime.inspect.custom")]() {
        return `RequestCookies ${JSON.stringify(Object.fromEntries(this._parsed))}`;
      }
      toString() {
        return [...this._parsed.values()].map((v) => `${v.name}=${encodeURIComponent(v.value)}`).join("; ");
      }
    };
    var ResponseCookies = class {
      constructor(responseHeaders) {
        this._parsed = /* @__PURE__ */ new Map();
        var _a, _b, _c;
        this._headers = responseHeaders;
        const setCookie = (_c = (_b = (_a = responseHeaders.getSetCookie) == null ? void 0 : _a.call(responseHeaders)) != null ? _b : responseHeaders.get("set-cookie")) != null ? _c : [];
        const cookieStrings = Array.isArray(setCookie) ? setCookie : splitCookiesString(setCookie);
        for (const cookieString of cookieStrings) {
          const parsed = parseSetCookie(cookieString);
          if (parsed)
            this._parsed.set(parsed.name, parsed);
        }
      }
      /**
       * {@link https://wicg.github.io/cookie-store/#CookieStore-get CookieStore#get} without the Promise.
       */
      get(...args) {
        const key = typeof args[0] === "string" ? args[0] : args[0].name;
        return this._parsed.get(key);
      }
      /**
       * {@link https://wicg.github.io/cookie-store/#CookieStore-getAll CookieStore#getAll} without the Promise.
       */
      getAll(...args) {
        var _a;
        const all = Array.from(this._parsed.values());
        if (!args.length) {
          return all;
        }
        const key = typeof args[0] === "string" ? args[0] : (_a = args[0]) == null ? void 0 : _a.name;
        return all.filter((c) => c.name === key);
      }
      has(name) {
        return this._parsed.has(name);
      }
      /**
       * {@link https://wicg.github.io/cookie-store/#CookieStore-set CookieStore#set} without the Promise.
       */
      set(...args) {
        const [name, value2, cookie] = args.length === 1 ? [args[0].name, args[0].value, args[0]] : args;
        const map = this._parsed;
        map.set(name, normalizeCookie({ name, value: value2, ...cookie }));
        replace(map, this._headers);
        return this;
      }
      /**
       * {@link https://wicg.github.io/cookie-store/#CookieStore-delete CookieStore#delete} without the Promise.
       */
      delete(...args) {
        const [name, options] = typeof args[0] === "string" ? [args[0]] : [args[0].name, args[0]];
        return this.set({ ...options, name, value: "", expires: /* @__PURE__ */ new Date(0) });
      }
      [/* @__PURE__ */ Symbol.for("edge-runtime.inspect.custom")]() {
        return `ResponseCookies ${JSON.stringify(Object.fromEntries(this._parsed))}`;
      }
      toString() {
        return [...this._parsed.values()].map(stringifyCookie).join("; ");
      }
    };
    function replace(bag, headers) {
      headers.delete("set-cookie");
      for (const [, value2] of bag) {
        const serialized = stringifyCookie(value2);
        headers.append("set-cookie", serialized);
      }
    }
    function normalizeCookie(cookie = { name: "", value: "" }) {
      if (typeof cookie.expires === "number") {
        cookie.expires = new Date(cookie.expires);
      }
      if (cookie.maxAge) {
        cookie.expires = new Date(Date.now() + cookie.maxAge * 1e3);
      }
      if (cookie.path === null || cookie.path === void 0) {
        cookie.path = "/";
      }
      return cookie;
    }
  }
});

// node_modules/next/dist/server/web/spec-extension/cookies.js
var require_cookies2 = __commonJS({
  "node_modules/next/dist/server/web/spec-extension/cookies.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      RequestCookies: function() {
        return _cookies.RequestCookies;
      },
      ResponseCookies: function() {
        return _cookies.ResponseCookies;
      },
      stringifyCookie: function() {
        return _cookies.stringifyCookie;
      }
    });
    var _cookies = require_cookies();
  }
});

// node_modules/next/dist/server/web/spec-extension/request.js
var require_request = __commonJS({
  "node_modules/next/dist/server/web/spec-extension/request.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      INTERNALS: function() {
        return INTERNALS;
      },
      NextRequest: function() {
        return NextRequest2;
      }
    });
    var _nexturl = require_next_url();
    var _utils = require_utils2();
    var _error = require_error();
    var _cookies = require_cookies2();
    var INTERNALS = /* @__PURE__ */ Symbol("internal request");
    var NextRequest2 = class extends Request {
      constructor(input, init = {}) {
        const url = typeof input !== "string" && "url" in input ? input.url : String(input);
        (0, _utils.validateURL)(url);
        if (process.env.NEXT_RUNTIME !== "edge") {
          if (init.body && init.duplex !== "half") {
            init.duplex = "half";
          }
        }
        if (input instanceof Request) super(input, init);
        else super(url, init);
        const nextUrl = new _nexturl.NextURL(url, {
          headers: (0, _utils.toNodeOutgoingHttpHeaders)(this.headers),
          nextConfig: init.nextConfig
        });
        this[INTERNALS] = {
          cookies: new _cookies.RequestCookies(this.headers),
          nextUrl,
          url: process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE ? url : nextUrl.toString()
        };
      }
      [/* @__PURE__ */ Symbol.for("edge-runtime.inspect.custom")]() {
        return {
          cookies: this.cookies,
          nextUrl: this.nextUrl,
          url: this.url,
          // rest of props come from Request
          bodyUsed: this.bodyUsed,
          cache: this.cache,
          credentials: this.credentials,
          destination: this.destination,
          headers: Object.fromEntries(this.headers),
          integrity: this.integrity,
          keepalive: this.keepalive,
          method: this.method,
          mode: this.mode,
          redirect: this.redirect,
          referrer: this.referrer,
          referrerPolicy: this.referrerPolicy,
          signal: this.signal
        };
      }
      get cookies() {
        return this[INTERNALS].cookies;
      }
      get nextUrl() {
        return this[INTERNALS].nextUrl;
      }
      /**
      * @deprecated
      * `page` has been deprecated in favour of `URLPattern`.
      * Read more: https://nextjs.org/docs/messages/middleware-request-page
      */
      get page() {
        throw new _error.RemovedPageError();
      }
      /**
      * @deprecated
      * `ua` has been removed in favour of \`userAgent\` function.
      * Read more: https://nextjs.org/docs/messages/middleware-parse-user-agent
      */
      get ua() {
        throw new _error.RemovedUAError();
      }
      get url() {
        return this[INTERNALS].url;
      }
    };
  }
});

// node_modules/next/dist/server/web/spec-extension/adapters/reflect.js
var require_reflect = __commonJS({
  "node_modules/next/dist/server/web/spec-extension/adapters/reflect.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "ReflectAdapter", {
      enumerable: true,
      get: function() {
        return ReflectAdapter;
      }
    });
    var ReflectAdapter = class {
      static get(target, prop, receiver) {
        const value2 = Reflect.get(target, prop, receiver);
        if (typeof value2 === "function") {
          return value2.bind(target);
        }
        return value2;
      }
      static set(target, prop, value2, receiver) {
        return Reflect.set(target, prop, value2, receiver);
      }
      static has(target, prop) {
        return Reflect.has(target, prop);
      }
      static deleteProperty(target, prop) {
        return Reflect.deleteProperty(target, prop);
      }
    };
  }
});

// node_modules/next/dist/server/web/spec-extension/response.js
var require_response = __commonJS({
  "node_modules/next/dist/server/web/spec-extension/response.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "NextResponse", {
      enumerable: true,
      get: function() {
        return NextResponse2;
      }
    });
    var _cookies = require_cookies2();
    var _nexturl = require_next_url();
    var _utils = require_utils2();
    var _reflect = require_reflect();
    var _cookies1 = require_cookies2();
    var INTERNALS = /* @__PURE__ */ Symbol("internal response");
    var REDIRECTS = /* @__PURE__ */ new Set([
      301,
      302,
      303,
      307,
      308
    ]);
    function handleMiddlewareField(init, headers) {
      var _init_request;
      if (init == null ? void 0 : (_init_request = init.request) == null ? void 0 : _init_request.headers) {
        if (!(init.request.headers instanceof Headers)) {
          throw Object.defineProperty(new Error("request.headers must be an instance of Headers"), "__NEXT_ERROR_CODE", {
            value: "E119",
            enumerable: false,
            configurable: true
          });
        }
        const keys = [];
        for (const [key, value2] of init.request.headers) {
          headers.set("x-middleware-request-" + key, value2);
          keys.push(key);
        }
        headers.set("x-middleware-override-headers", keys.join(","));
      }
    }
    var NextResponse2 = class _NextResponse extends Response {
      constructor(body, init = {}) {
        super(body, init);
        const headers = this.headers;
        const cookies = new _cookies1.ResponseCookies(headers);
        const cookiesProxy = new Proxy(cookies, {
          get(target, prop, receiver) {
            switch (prop) {
              case "delete":
              case "set": {
                return (...args) => {
                  const result = Reflect.apply(target[prop], target, args);
                  const newHeaders = new Headers(headers);
                  if (result instanceof _cookies1.ResponseCookies) {
                    headers.set("x-middleware-set-cookie", result.getAll().map((cookie) => (0, _cookies.stringifyCookie)(cookie)).join(","));
                  }
                  handleMiddlewareField(init, newHeaders);
                  return result;
                };
              }
              default:
                return _reflect.ReflectAdapter.get(target, prop, receiver);
            }
          }
        });
        this[INTERNALS] = {
          cookies: cookiesProxy,
          url: init.url ? new _nexturl.NextURL(init.url, {
            headers: (0, _utils.toNodeOutgoingHttpHeaders)(headers),
            nextConfig: init.nextConfig
          }) : void 0
        };
      }
      [/* @__PURE__ */ Symbol.for("edge-runtime.inspect.custom")]() {
        return {
          cookies: this.cookies,
          url: this.url,
          // rest of props come from Response
          body: this.body,
          bodyUsed: this.bodyUsed,
          headers: Object.fromEntries(this.headers),
          ok: this.ok,
          redirected: this.redirected,
          status: this.status,
          statusText: this.statusText,
          type: this.type
        };
      }
      get cookies() {
        return this[INTERNALS].cookies;
      }
      static json(body, init) {
        const response = Response.json(body, init);
        return new _NextResponse(response.body, response);
      }
      static redirect(url, init) {
        const status = typeof init === "number" ? init : (init == null ? void 0 : init.status) ?? 307;
        if (!REDIRECTS.has(status)) {
          throw Object.defineProperty(new RangeError('Failed to execute "redirect" on "response": Invalid status code'), "__NEXT_ERROR_CODE", {
            value: "E529",
            enumerable: false,
            configurable: true
          });
        }
        const initObj = typeof init === "object" ? init : {};
        const headers = new Headers(initObj == null ? void 0 : initObj.headers);
        headers.set("Location", (0, _utils.validateURL)(url));
        return new _NextResponse(null, {
          ...initObj,
          headers,
          status
        });
      }
      static rewrite(destination, init) {
        const headers = new Headers(init == null ? void 0 : init.headers);
        headers.set("x-middleware-rewrite", (0, _utils.validateURL)(destination));
        handleMiddlewareField(init, headers);
        return new _NextResponse(null, {
          ...init,
          headers
        });
      }
      static next(init) {
        const headers = new Headers(init == null ? void 0 : init.headers);
        headers.set("x-middleware-next", "1");
        handleMiddlewareField(init, headers);
        return new _NextResponse(null, {
          ...init,
          headers
        });
      }
    };
  }
});

// node_modules/next/dist/server/web/spec-extension/image-response.js
var require_image_response = __commonJS({
  "node_modules/next/dist/server/web/spec-extension/image-response.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "ImageResponse", {
      enumerable: true,
      get: function() {
        return ImageResponse;
      }
    });
    function ImageResponse() {
      throw Object.defineProperty(new Error('ImageResponse moved from "next/server" to "next/og" since Next.js 14, please import from "next/og" instead'), "__NEXT_ERROR_CODE", {
        value: "E183",
        enumerable: false,
        configurable: true
      });
    }
  }
});

// node_modules/next/dist/compiled/ua-parser-js/ua-parser.js
var require_ua_parser = __commonJS({
  "node_modules/next/dist/compiled/ua-parser-js/ua-parser.js"(exports2, module2) {
    (() => {
      var i = { 226: function(i2, e2) {
        (function(o2, a) {
          "use strict";
          var r = "1.0.35", t = "", n = "?", s = "function", b = "undefined", w = "object", l = "string", d = "major", c = "model", u = "name", p = "type", m = "vendor", f = "version", h = "architecture", v = "console", g = "mobile", k = "tablet", x = "smarttv", _ = "wearable", y = "embedded", q = 350;
          var T = "Amazon", S = "Apple", z = "ASUS", N = "BlackBerry", A = "Browser", C = "Chrome", E = "Edge", O = "Firefox", U = "Google", j = "Huawei", P = "LG", R = "Microsoft", M = "Motorola", B = "Opera", V = "Samsung", D = "Sharp", I = "Sony", W = "Viera", F = "Xiaomi", G = "Zebra", H = "Facebook", L = "Chromium OS", Z = "Mac OS";
          var extend = function(i3, e3) {
            var o3 = {};
            for (var a2 in i3) {
              if (e3[a2] && e3[a2].length % 2 === 0) {
                o3[a2] = e3[a2].concat(i3[a2]);
              } else {
                o3[a2] = i3[a2];
              }
            }
            return o3;
          }, enumerize = function(i3) {
            var e3 = {};
            for (var o3 = 0; o3 < i3.length; o3++) {
              e3[i3[o3].toUpperCase()] = i3[o3];
            }
            return e3;
          }, has = function(i3, e3) {
            return typeof i3 === l ? lowerize(e3).indexOf(lowerize(i3)) !== -1 : false;
          }, lowerize = function(i3) {
            return i3.toLowerCase();
          }, majorize = function(i3) {
            return typeof i3 === l ? i3.replace(/[^\d\.]/g, t).split(".")[0] : a;
          }, trim = function(i3, e3) {
            if (typeof i3 === l) {
              i3 = i3.replace(/^\s\s*/, t);
              return typeof e3 === b ? i3 : i3.substring(0, q);
            }
          };
          var rgxMapper = function(i3, e3) {
            var o3 = 0, r2, t2, n2, b2, l2, d2;
            while (o3 < e3.length && !l2) {
              var c2 = e3[o3], u2 = e3[o3 + 1];
              r2 = t2 = 0;
              while (r2 < c2.length && !l2) {
                if (!c2[r2]) {
                  break;
                }
                l2 = c2[r2++].exec(i3);
                if (!!l2) {
                  for (n2 = 0; n2 < u2.length; n2++) {
                    d2 = l2[++t2];
                    b2 = u2[n2];
                    if (typeof b2 === w && b2.length > 0) {
                      if (b2.length === 2) {
                        if (typeof b2[1] == s) {
                          this[b2[0]] = b2[1].call(this, d2);
                        } else {
                          this[b2[0]] = b2[1];
                        }
                      } else if (b2.length === 3) {
                        if (typeof b2[1] === s && !(b2[1].exec && b2[1].test)) {
                          this[b2[0]] = d2 ? b2[1].call(this, d2, b2[2]) : a;
                        } else {
                          this[b2[0]] = d2 ? d2.replace(b2[1], b2[2]) : a;
                        }
                      } else if (b2.length === 4) {
                        this[b2[0]] = d2 ? b2[3].call(this, d2.replace(b2[1], b2[2])) : a;
                      }
                    } else {
                      this[b2] = d2 ? d2 : a;
                    }
                  }
                }
              }
              o3 += 2;
            }
          }, strMapper = function(i3, e3) {
            for (var o3 in e3) {
              if (typeof e3[o3] === w && e3[o3].length > 0) {
                for (var r2 = 0; r2 < e3[o3].length; r2++) {
                  if (has(e3[o3][r2], i3)) {
                    return o3 === n ? a : o3;
                  }
                }
              } else if (has(e3[o3], i3)) {
                return o3 === n ? a : o3;
              }
            }
            return i3;
          };
          var $ = { "1.0": "/8", 1.2: "/1", 1.3: "/3", "2.0": "/412", "2.0.2": "/416", "2.0.3": "/417", "2.0.4": "/419", "?": "/" }, X = { ME: "4.90", "NT 3.11": "NT3.51", "NT 4.0": "NT4.0", 2e3: "NT 5.0", XP: ["NT 5.1", "NT 5.2"], Vista: "NT 6.0", 7: "NT 6.1", 8: "NT 6.2", 8.1: "NT 6.3", 10: ["NT 6.4", "NT 10.0"], RT: "ARM" };
          var K = { browser: [[/\b(?:crmo|crios)\/([\w\.]+)/i], [f, [u, "Chrome"]], [/edg(?:e|ios|a)?\/([\w\.]+)/i], [f, [u, "Edge"]], [/(opera mini)\/([-\w\.]+)/i, /(opera [mobiletab]{3,6})\b.+version\/([-\w\.]+)/i, /(opera)(?:.+version\/|[\/ ]+)([\w\.]+)/i], [u, f], [/opios[\/ ]+([\w\.]+)/i], [f, [u, B + " Mini"]], [/\bopr\/([\w\.]+)/i], [f, [u, B]], [/(kindle)\/([\w\.]+)/i, /(lunascape|maxthon|netfront|jasmine|blazer)[\/ ]?([\w\.]*)/i, /(avant |iemobile|slim)(?:browser)?[\/ ]?([\w\.]*)/i, /(ba?idubrowser)[\/ ]?([\w\.]+)/i, /(?:ms|\()(ie) ([\w\.]+)/i, /(flock|rockmelt|midori|epiphany|silk|skyfire|bolt|iron|vivaldi|iridium|phantomjs|bowser|quark|qupzilla|falkon|rekonq|puffin|brave|whale(?!.+naver)|qqbrowserlite|qq|duckduckgo)\/([-\w\.]+)/i, /(heytap|ovi)browser\/([\d\.]+)/i, /(weibo)__([\d\.]+)/i], [u, f], [/(?:\buc? ?browser|(?:juc.+)ucweb)[\/ ]?([\w\.]+)/i], [f, [u, "UC" + A]], [/microm.+\bqbcore\/([\w\.]+)/i, /\bqbcore\/([\w\.]+).+microm/i], [f, [u, "WeChat(Win) Desktop"]], [/micromessenger\/([\w\.]+)/i], [f, [u, "WeChat"]], [/konqueror\/([\w\.]+)/i], [f, [u, "Konqueror"]], [/trident.+rv[: ]([\w\.]{1,9})\b.+like gecko/i], [f, [u, "IE"]], [/ya(?:search)?browser\/([\w\.]+)/i], [f, [u, "Yandex"]], [/(avast|avg)\/([\w\.]+)/i], [[u, /(.+)/, "$1 Secure " + A], f], [/\bfocus\/([\w\.]+)/i], [f, [u, O + " Focus"]], [/\bopt\/([\w\.]+)/i], [f, [u, B + " Touch"]], [/coc_coc\w+\/([\w\.]+)/i], [f, [u, "Coc Coc"]], [/dolfin\/([\w\.]+)/i], [f, [u, "Dolphin"]], [/coast\/([\w\.]+)/i], [f, [u, B + " Coast"]], [/miuibrowser\/([\w\.]+)/i], [f, [u, "MIUI " + A]], [/fxios\/([-\w\.]+)/i], [f, [u, O]], [/\bqihu|(qi?ho?o?|360)browser/i], [[u, "360 " + A]], [/(oculus|samsung|sailfish|huawei)browser\/([\w\.]+)/i], [[u, /(.+)/, "$1 " + A], f], [/(comodo_dragon)\/([\w\.]+)/i], [[u, /_/g, " "], f], [/(electron)\/([\w\.]+) safari/i, /(tesla)(?: qtcarbrowser|\/(20\d\d\.[-\w\.]+))/i, /m?(qqbrowser|baiduboxapp|2345Explorer)[\/ ]?([\w\.]+)/i], [u, f], [/(metasr)[\/ ]?([\w\.]+)/i, /(lbbrowser)/i, /\[(linkedin)app\]/i], [u], [/((?:fban\/fbios|fb_iab\/fb4a)(?!.+fbav)|;fbav\/([\w\.]+);)/i], [[u, H], f], [/(kakao(?:talk|story))[\/ ]([\w\.]+)/i, /(naver)\(.*?(\d+\.[\w\.]+).*\)/i, /safari (line)\/([\w\.]+)/i, /\b(line)\/([\w\.]+)\/iab/i, /(chromium|instagram)[\/ ]([-\w\.]+)/i], [u, f], [/\bgsa\/([\w\.]+) .*safari\//i], [f, [u, "GSA"]], [/musical_ly(?:.+app_?version\/|_)([\w\.]+)/i], [f, [u, "TikTok"]], [/headlesschrome(?:\/([\w\.]+)| )/i], [f, [u, C + " Headless"]], [/ wv\).+(chrome)\/([\w\.]+)/i], [[u, C + " WebView"], f], [/droid.+ version\/([\w\.]+)\b.+(?:mobile safari|safari)/i], [f, [u, "Android " + A]], [/(chrome|omniweb|arora|[tizenoka]{5} ?browser)\/v?([\w\.]+)/i], [u, f], [/version\/([\w\.\,]+) .*mobile\/\w+ (safari)/i], [f, [u, "Mobile Safari"]], [/version\/([\w(\.|\,)]+) .*(mobile ?safari|safari)/i], [f, u], [/webkit.+?(mobile ?safari|safari)(\/[\w\.]+)/i], [u, [f, strMapper, $]], [/(webkit|khtml)\/([\w\.]+)/i], [u, f], [/(navigator|netscape\d?)\/([-\w\.]+)/i], [[u, "Netscape"], f], [/mobile vr; rv:([\w\.]+)\).+firefox/i], [f, [u, O + " Reality"]], [/ekiohf.+(flow)\/([\w\.]+)/i, /(swiftfox)/i, /(icedragon|iceweasel|camino|chimera|fennec|maemo browser|minimo|conkeror|klar)[\/ ]?([\w\.\+]+)/i, /(seamonkey|k-meleon|icecat|iceape|firebird|phoenix|palemoon|basilisk|waterfox)\/([-\w\.]+)$/i, /(firefox)\/([\w\.]+)/i, /(mozilla)\/([\w\.]+) .+rv\:.+gecko\/\d+/i, /(polaris|lynx|dillo|icab|doris|amaya|w3m|netsurf|sleipnir|obigo|mosaic|(?:go|ice|up)[\. ]?browser)[-\/ ]?v?([\w\.]+)/i, /(links) \(([\w\.]+)/i, /panasonic;(viera)/i], [u, f], [/(cobalt)\/([\w\.]+)/i], [u, [f, /master.|lts./, ""]]], cpu: [[/(?:(amd|x(?:(?:86|64)[-_])?|wow|win)64)[;\)]/i], [[h, "amd64"]], [/(ia32(?=;))/i], [[h, lowerize]], [/((?:i[346]|x)86)[;\)]/i], [[h, "ia32"]], [/\b(aarch64|arm(v?8e?l?|_?64))\b/i], [[h, "arm64"]], [/\b(arm(?:v[67])?ht?n?[fl]p?)\b/i], [[h, "armhf"]], [/windows (ce|mobile); ppc;/i], [[h, "arm"]], [/((?:ppc|powerpc)(?:64)?)(?: mac|;|\))/i], [[h, /ower/, t, lowerize]], [/(sun4\w)[;\)]/i], [[h, "sparc"]], [/((?:avr32|ia64(?=;))|68k(?=\))|\barm(?=v(?:[1-7]|[5-7]1)l?|;|eabi)|(?=atmel )avr|(?:irix|mips|sparc)(?:64)?\b|pa-risc)/i], [[h, lowerize]]], device: [[/\b(sch-i[89]0\d|shw-m380s|sm-[ptx]\w{2,4}|gt-[pn]\d{2,4}|sgh-t8[56]9|nexus 10)/i], [c, [m, V], [p, k]], [/\b((?:s[cgp]h|gt|sm)-\w+|sc[g-]?[\d]+a?|galaxy nexus)/i, /samsung[- ]([-\w]+)/i, /sec-(sgh\w+)/i], [c, [m, V], [p, g]], [/(?:\/|\()(ip(?:hone|od)[\w, ]*)(?:\/|;)/i], [c, [m, S], [p, g]], [/\((ipad);[-\w\),; ]+apple/i, /applecoremedia\/[\w\.]+ \((ipad)/i, /\b(ipad)\d\d?,\d\d?[;\]].+ios/i], [c, [m, S], [p, k]], [/(macintosh);/i], [c, [m, S]], [/\b(sh-?[altvz]?\d\d[a-ekm]?)/i], [c, [m, D], [p, g]], [/\b((?:ag[rs][23]?|bah2?|sht?|btv)-a?[lw]\d{2})\b(?!.+d\/s)/i], [c, [m, j], [p, k]], [/(?:huawei|honor)([-\w ]+)[;\)]/i, /\b(nexus 6p|\w{2,4}e?-[atu]?[ln][\dx][012359c][adn]?)\b(?!.+d\/s)/i], [c, [m, j], [p, g]], [/\b(poco[\w ]+)(?: bui|\))/i, /\b; (\w+) build\/hm\1/i, /\b(hm[-_ ]?note?[_ ]?(?:\d\w)?) bui/i, /\b(redmi[\-_ ]?(?:note|k)?[\w_ ]+)(?: bui|\))/i, /\b(mi[-_ ]?(?:a\d|one|one[_ ]plus|note lte|max|cc)?[_ ]?(?:\d?\w?)[_ ]?(?:plus|se|lite)?)(?: bui|\))/i], [[c, /_/g, " "], [m, F], [p, g]], [/\b(mi[-_ ]?(?:pad)(?:[\w_ ]+))(?: bui|\))/i], [[c, /_/g, " "], [m, F], [p, k]], [/; (\w+) bui.+ oppo/i, /\b(cph[12]\d{3}|p(?:af|c[al]|d\w|e[ar])[mt]\d0|x9007|a101op)\b/i], [c, [m, "OPPO"], [p, g]], [/vivo (\w+)(?: bui|\))/i, /\b(v[12]\d{3}\w?[at])(?: bui|;)/i], [c, [m, "Vivo"], [p, g]], [/\b(rmx[12]\d{3})(?: bui|;|\))/i], [c, [m, "Realme"], [p, g]], [/\b(milestone|droid(?:[2-4x]| (?:bionic|x2|pro|razr))?:?( 4g)?)\b[\w ]+build\//i, /\bmot(?:orola)?[- ](\w*)/i, /((?:moto[\w\(\) ]+|xt\d{3,4}|nexus 6)(?= bui|\)))/i], [c, [m, M], [p, g]], [/\b(mz60\d|xoom[2 ]{0,2}) build\//i], [c, [m, M], [p, k]], [/((?=lg)?[vl]k\-?\d{3}) bui| 3\.[-\w; ]{10}lg?-([06cv9]{3,4})/i], [c, [m, P], [p, k]], [/(lm(?:-?f100[nv]?|-[\w\.]+)(?= bui|\))|nexus [45])/i, /\blg[-e;\/ ]+((?!browser|netcast|android tv)\w+)/i, /\blg-?([\d\w]+) bui/i], [c, [m, P], [p, g]], [/(ideatab[-\w ]+)/i, /lenovo ?(s[56]000[-\w]+|tab(?:[\w ]+)|yt[-\d\w]{6}|tb[-\d\w]{6})/i], [c, [m, "Lenovo"], [p, k]], [/(?:maemo|nokia).*(n900|lumia \d+)/i, /nokia[-_ ]?([-\w\.]*)/i], [[c, /_/g, " "], [m, "Nokia"], [p, g]], [/(pixel c)\b/i], [c, [m, U], [p, k]], [/droid.+; (pixel[\daxl ]{0,6})(?: bui|\))/i], [c, [m, U], [p, g]], [/droid.+ (a?\d[0-2]{2}so|[c-g]\d{4}|so[-gl]\w+|xq-a\w[4-7][12])(?= bui|\).+chrome\/(?![1-6]{0,1}\d\.))/i], [c, [m, I], [p, g]], [/sony tablet [ps]/i, /\b(?:sony)?sgp\w+(?: bui|\))/i], [[c, "Xperia Tablet"], [m, I], [p, k]], [/ (kb2005|in20[12]5|be20[12][59])\b/i, /(?:one)?(?:plus)? (a\d0\d\d)(?: b|\))/i], [c, [m, "OnePlus"], [p, g]], [/(alexa)webm/i, /(kf[a-z]{2}wi|aeo[c-r]{2})( bui|\))/i, /(kf[a-z]+)( bui|\)).+silk\//i], [c, [m, T], [p, k]], [/((?:sd|kf)[0349hijorstuw]+)( bui|\)).+silk\//i], [[c, /(.+)/g, "Fire Phone $1"], [m, T], [p, g]], [/(playbook);[-\w\),; ]+(rim)/i], [c, m, [p, k]], [/\b((?:bb[a-f]|st[hv])100-\d)/i, /\(bb10; (\w+)/i], [c, [m, N], [p, g]], [/(?:\b|asus_)(transfo[prime ]{4,10} \w+|eeepc|slider \w+|nexus 7|padfone|p00[cj])/i], [c, [m, z], [p, k]], [/ (z[bes]6[027][012][km][ls]|zenfone \d\w?)\b/i], [c, [m, z], [p, g]], [/(nexus 9)/i], [c, [m, "HTC"], [p, k]], [/(htc)[-;_ ]{1,2}([\w ]+(?=\)| bui)|\w+)/i, /(zte)[- ]([\w ]+?)(?: bui|\/|\))/i, /(alcatel|geeksphone|nexian|panasonic(?!(?:;|\.))|sony(?!-bra))[-_ ]?([-\w]*)/i], [m, [c, /_/g, " "], [p, g]], [/droid.+; ([ab][1-7]-?[0178a]\d\d?)/i], [c, [m, "Acer"], [p, k]], [/droid.+; (m[1-5] note) bui/i, /\bmz-([-\w]{2,})/i], [c, [m, "Meizu"], [p, g]], [/(blackberry|benq|palm(?=\-)|sonyericsson|acer|asus|dell|meizu|motorola|polytron)[-_ ]?([-\w]*)/i, /(hp) ([\w ]+\w)/i, /(asus)-?(\w+)/i, /(microsoft); (lumia[\w ]+)/i, /(lenovo)[-_ ]?([-\w]+)/i, /(jolla)/i, /(oppo) ?([\w ]+) bui/i], [m, c, [p, g]], [/(kobo)\s(ereader|touch)/i, /(archos) (gamepad2?)/i, /(hp).+(touchpad(?!.+tablet)|tablet)/i, /(kindle)\/([\w\.]+)/i, /(nook)[\w ]+build\/(\w+)/i, /(dell) (strea[kpr\d ]*[\dko])/i, /(le[- ]+pan)[- ]+(\w{1,9}) bui/i, /(trinity)[- ]*(t\d{3}) bui/i, /(gigaset)[- ]+(q\w{1,9}) bui/i, /(vodafone) ([\w ]+)(?:\)| bui)/i], [m, c, [p, k]], [/(surface duo)/i], [c, [m, R], [p, k]], [/droid [\d\.]+; (fp\du?)(?: b|\))/i], [c, [m, "Fairphone"], [p, g]], [/(u304aa)/i], [c, [m, "AT&T"], [p, g]], [/\bsie-(\w*)/i], [c, [m, "Siemens"], [p, g]], [/\b(rct\w+) b/i], [c, [m, "RCA"], [p, k]], [/\b(venue[\d ]{2,7}) b/i], [c, [m, "Dell"], [p, k]], [/\b(q(?:mv|ta)\w+) b/i], [c, [m, "Verizon"], [p, k]], [/\b(?:barnes[& ]+noble |bn[rt])([\w\+ ]*) b/i], [c, [m, "Barnes & Noble"], [p, k]], [/\b(tm\d{3}\w+) b/i], [c, [m, "NuVision"], [p, k]], [/\b(k88) b/i], [c, [m, "ZTE"], [p, k]], [/\b(nx\d{3}j) b/i], [c, [m, "ZTE"], [p, g]], [/\b(gen\d{3}) b.+49h/i], [c, [m, "Swiss"], [p, g]], [/\b(zur\d{3}) b/i], [c, [m, "Swiss"], [p, k]], [/\b((zeki)?tb.*\b) b/i], [c, [m, "Zeki"], [p, k]], [/\b([yr]\d{2}) b/i, /\b(dragon[- ]+touch |dt)(\w{5}) b/i], [[m, "Dragon Touch"], c, [p, k]], [/\b(ns-?\w{0,9}) b/i], [c, [m, "Insignia"], [p, k]], [/\b((nxa|next)-?\w{0,9}) b/i], [c, [m, "NextBook"], [p, k]], [/\b(xtreme\_)?(v(1[045]|2[015]|[3469]0|7[05])) b/i], [[m, "Voice"], c, [p, g]], [/\b(lvtel\-)?(v1[12]) b/i], [[m, "LvTel"], c, [p, g]], [/\b(ph-1) /i], [c, [m, "Essential"], [p, g]], [/\b(v(100md|700na|7011|917g).*\b) b/i], [c, [m, "Envizen"], [p, k]], [/\b(trio[-\w\. ]+) b/i], [c, [m, "MachSpeed"], [p, k]], [/\btu_(1491) b/i], [c, [m, "Rotor"], [p, k]], [/(shield[\w ]+) b/i], [c, [m, "Nvidia"], [p, k]], [/(sprint) (\w+)/i], [m, c, [p, g]], [/(kin\.[onetw]{3})/i], [[c, /\./g, " "], [m, R], [p, g]], [/droid.+; (cc6666?|et5[16]|mc[239][23]x?|vc8[03]x?)\)/i], [c, [m, G], [p, k]], [/droid.+; (ec30|ps20|tc[2-8]\d[kx])\)/i], [c, [m, G], [p, g]], [/smart-tv.+(samsung)/i], [m, [p, x]], [/hbbtv.+maple;(\d+)/i], [[c, /^/, "SmartTV"], [m, V], [p, x]], [/(nux; netcast.+smarttv|lg (netcast\.tv-201\d|android tv))/i], [[m, P], [p, x]], [/(apple) ?tv/i], [m, [c, S + " TV"], [p, x]], [/crkey/i], [[c, C + "cast"], [m, U], [p, x]], [/droid.+aft(\w)( bui|\))/i], [c, [m, T], [p, x]], [/\(dtv[\);].+(aquos)/i, /(aquos-tv[\w ]+)\)/i], [c, [m, D], [p, x]], [/(bravia[\w ]+)( bui|\))/i], [c, [m, I], [p, x]], [/(mitv-\w{5}) bui/i], [c, [m, F], [p, x]], [/Hbbtv.*(technisat) (.*);/i], [m, c, [p, x]], [/\b(roku)[\dx]*[\)\/]((?:dvp-)?[\d\.]*)/i, /hbbtv\/\d+\.\d+\.\d+ +\([\w\+ ]*; *([\w\d][^;]*);([^;]*)/i], [[m, trim], [c, trim], [p, x]], [/\b(android tv|smart[- ]?tv|opera tv|tv; rv:)\b/i], [[p, x]], [/(ouya)/i, /(nintendo) ([wids3utch]+)/i], [m, c, [p, v]], [/droid.+; (shield) bui/i], [c, [m, "Nvidia"], [p, v]], [/(playstation [345portablevi]+)/i], [c, [m, I], [p, v]], [/\b(xbox(?: one)?(?!; xbox))[\); ]/i], [c, [m, R], [p, v]], [/((pebble))app/i], [m, c, [p, _]], [/(watch)(?: ?os[,\/]|\d,\d\/)[\d\.]+/i], [c, [m, S], [p, _]], [/droid.+; (glass) \d/i], [c, [m, U], [p, _]], [/droid.+; (wt63?0{2,3})\)/i], [c, [m, G], [p, _]], [/(quest( 2| pro)?)/i], [c, [m, H], [p, _]], [/(tesla)(?: qtcarbrowser|\/[-\w\.]+)/i], [m, [p, y]], [/(aeobc)\b/i], [c, [m, T], [p, y]], [/droid .+?; ([^;]+?)(?: bui|\) applew).+? mobile safari/i], [c, [p, g]], [/droid .+?; ([^;]+?)(?: bui|\) applew).+?(?! mobile) safari/i], [c, [p, k]], [/\b((tablet|tab)[;\/]|focus\/\d(?!.+mobile))/i], [[p, k]], [/(phone|mobile(?:[;\/]| [ \w\/\.]*safari)|pda(?=.+windows ce))/i], [[p, g]], [/(android[-\w\. ]{0,9});.+buil/i], [c, [m, "Generic"]]], engine: [[/windows.+ edge\/([\w\.]+)/i], [f, [u, E + "HTML"]], [/webkit\/537\.36.+chrome\/(?!27)([\w\.]+)/i], [f, [u, "Blink"]], [/(presto)\/([\w\.]+)/i, /(webkit|trident|netfront|netsurf|amaya|lynx|w3m|goanna)\/([\w\.]+)/i, /ekioh(flow)\/([\w\.]+)/i, /(khtml|tasman|links)[\/ ]\(?([\w\.]+)/i, /(icab)[\/ ]([23]\.[\d\.]+)/i, /\b(libweb)/i], [u, f], [/rv\:([\w\.]{1,9})\b.+(gecko)/i], [f, u]], os: [[/microsoft (windows) (vista|xp)/i], [u, f], [/(windows) nt 6\.2; (arm)/i, /(windows (?:phone(?: os)?|mobile))[\/ ]?([\d\.\w ]*)/i, /(windows)[\/ ]?([ntce\d\. ]+\w)(?!.+xbox)/i], [u, [f, strMapper, X]], [/(win(?=3|9|n)|win 9x )([nt\d\.]+)/i], [[u, "Windows"], [f, strMapper, X]], [/ip[honead]{2,4}\b(?:.*os ([\w]+) like mac|; opera)/i, /ios;fbsv\/([\d\.]+)/i, /cfnetwork\/.+darwin/i], [[f, /_/g, "."], [u, "iOS"]], [/(mac os x) ?([\w\. ]*)/i, /(macintosh|mac_powerpc\b)(?!.+haiku)/i], [[u, Z], [f, /_/g, "."]], [/droid ([\w\.]+)\b.+(android[- ]x86|harmonyos)/i], [f, u], [/(android|webos|qnx|bada|rim tablet os|maemo|meego|sailfish)[-\/ ]?([\w\.]*)/i, /(blackberry)\w*\/([\w\.]*)/i, /(tizen|kaios)[\/ ]([\w\.]+)/i, /\((series40);/i], [u, f], [/\(bb(10);/i], [f, [u, N]], [/(?:symbian ?os|symbos|s60(?=;)|series60)[-\/ ]?([\w\.]*)/i], [f, [u, "Symbian"]], [/mozilla\/[\d\.]+ \((?:mobile|tablet|tv|mobile; [\w ]+); rv:.+ gecko\/([\w\.]+)/i], [f, [u, O + " OS"]], [/web0s;.+rt(tv)/i, /\b(?:hp)?wos(?:browser)?\/([\w\.]+)/i], [f, [u, "webOS"]], [/watch(?: ?os[,\/]|\d,\d\/)([\d\.]+)/i], [f, [u, "watchOS"]], [/crkey\/([\d\.]+)/i], [f, [u, C + "cast"]], [/(cros) [\w]+(?:\)| ([\w\.]+)\b)/i], [[u, L], f], [/panasonic;(viera)/i, /(netrange)mmh/i, /(nettv)\/(\d+\.[\w\.]+)/i, /(nintendo|playstation) ([wids345portablevuch]+)/i, /(xbox); +xbox ([^\);]+)/i, /\b(joli|palm)\b ?(?:os)?\/?([\w\.]*)/i, /(mint)[\/\(\) ]?(\w*)/i, /(mageia|vectorlinux)[; ]/i, /([kxln]?ubuntu|debian|suse|opensuse|gentoo|arch(?= linux)|slackware|fedora|mandriva|centos|pclinuxos|red ?hat|zenwalk|linpus|raspbian|plan 9|minix|risc os|contiki|deepin|manjaro|elementary os|sabayon|linspire)(?: gnu\/linux)?(?: enterprise)?(?:[- ]linux)?(?:-gnu)?[-\/ ]?(?!chrom|package)([-\w\.]*)/i, /(hurd|linux) ?([\w\.]*)/i, /(gnu) ?([\w\.]*)/i, /\b([-frentopcghs]{0,5}bsd|dragonfly)[\/ ]?(?!amd|[ix346]{1,2}86)([\w\.]*)/i, /(haiku) (\w+)/i], [u, f], [/(sunos) ?([\w\.\d]*)/i], [[u, "Solaris"], f], [/((?:open)?solaris)[-\/ ]?([\w\.]*)/i, /(aix) ((\d)(?=\.|\)| )[\w\.])*/i, /\b(beos|os\/2|amigaos|morphos|openvms|fuchsia|hp-ux|serenityos)/i, /(unix) ?([\w\.]*)/i], [u, f]] };
          var UAParser = function(i3, e3) {
            if (typeof i3 === w) {
              e3 = i3;
              i3 = a;
            }
            if (!(this instanceof UAParser)) {
              return new UAParser(i3, e3).getResult();
            }
            var r2 = typeof o2 !== b && o2.navigator ? o2.navigator : a;
            var n2 = i3 || (r2 && r2.userAgent ? r2.userAgent : t);
            var v2 = r2 && r2.userAgentData ? r2.userAgentData : a;
            var x2 = e3 ? extend(K, e3) : K;
            var _2 = r2 && r2.userAgent == n2;
            this.getBrowser = function() {
              var i4 = {};
              i4[u] = a;
              i4[f] = a;
              rgxMapper.call(i4, n2, x2.browser);
              i4[d] = majorize(i4[f]);
              if (_2 && r2 && r2.brave && typeof r2.brave.isBrave == s) {
                i4[u] = "Brave";
              }
              return i4;
            };
            this.getCPU = function() {
              var i4 = {};
              i4[h] = a;
              rgxMapper.call(i4, n2, x2.cpu);
              return i4;
            };
            this.getDevice = function() {
              var i4 = {};
              i4[m] = a;
              i4[c] = a;
              i4[p] = a;
              rgxMapper.call(i4, n2, x2.device);
              if (_2 && !i4[p] && v2 && v2.mobile) {
                i4[p] = g;
              }
              if (_2 && i4[c] == "Macintosh" && r2 && typeof r2.standalone !== b && r2.maxTouchPoints && r2.maxTouchPoints > 2) {
                i4[c] = "iPad";
                i4[p] = k;
              }
              return i4;
            };
            this.getEngine = function() {
              var i4 = {};
              i4[u] = a;
              i4[f] = a;
              rgxMapper.call(i4, n2, x2.engine);
              return i4;
            };
            this.getOS = function() {
              var i4 = {};
              i4[u] = a;
              i4[f] = a;
              rgxMapper.call(i4, n2, x2.os);
              if (_2 && !i4[u] && v2 && v2.platform != "Unknown") {
                i4[u] = v2.platform.replace(/chrome os/i, L).replace(/macos/i, Z);
              }
              return i4;
            };
            this.getResult = function() {
              return { ua: this.getUA(), browser: this.getBrowser(), engine: this.getEngine(), os: this.getOS(), device: this.getDevice(), cpu: this.getCPU() };
            };
            this.getUA = function() {
              return n2;
            };
            this.setUA = function(i4) {
              n2 = typeof i4 === l && i4.length > q ? trim(i4, q) : i4;
              return this;
            };
            this.setUA(n2);
            return this;
          };
          UAParser.VERSION = r;
          UAParser.BROWSER = enumerize([u, f, d]);
          UAParser.CPU = enumerize([h]);
          UAParser.DEVICE = enumerize([c, m, p, v, g, x, k, _, y]);
          UAParser.ENGINE = UAParser.OS = enumerize([u, f]);
          if (typeof e2 !== b) {
            if ("object" !== b && i2.exports) {
              e2 = i2.exports = UAParser;
            }
            e2.UAParser = UAParser;
          } else {
            if (typeof define === s && define.amd) {
              define((function() {
                return UAParser;
              }));
            } else if (typeof o2 !== b) {
              o2.UAParser = UAParser;
            }
          }
          var Q = typeof o2 !== b && (o2.jQuery || o2.Zepto);
          if (Q && !Q.ua) {
            var Y = new UAParser();
            Q.ua = Y.getResult();
            Q.ua.get = function() {
              return Y.getUA();
            };
            Q.ua.set = function(i3) {
              Y.setUA(i3);
              var e3 = Y.getResult();
              for (var o3 in e3) {
                Q.ua[o3] = e3[o3];
              }
            };
          }
        })(typeof window === "object" ? window : this);
      } };
      var e = {};
      function __nccwpck_require__(o2) {
        var a = e[o2];
        if (a !== void 0) {
          return a.exports;
        }
        var r = e[o2] = { exports: {} };
        var t = true;
        try {
          i[o2].call(r.exports, r, r.exports, __nccwpck_require__);
          t = false;
        } finally {
          if (t) delete e[o2];
        }
        return r.exports;
      }
      if (typeof __nccwpck_require__ !== "undefined") __nccwpck_require__.ab = __dirname + "/";
      var o = __nccwpck_require__(226);
      module2.exports = o;
    })();
  }
});

// node_modules/next/dist/server/web/spec-extension/user-agent.js
var require_user_agent = __commonJS({
  "node_modules/next/dist/server/web/spec-extension/user-agent.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      isBot: function() {
        return isBot;
      },
      userAgent: function() {
        return userAgent;
      },
      userAgentFromString: function() {
        return userAgentFromString;
      }
    });
    var _uaparserjs = /* @__PURE__ */ _interop_require_default(require_ua_parser());
    function _interop_require_default(obj) {
      return obj && obj.__esModule ? obj : {
        default: obj
      };
    }
    function isBot(input) {
      return /Googlebot|Mediapartners-Google|AdsBot-Google|googleweblight|Storebot-Google|Google-PageRenderer|Google-InspectionTool|Bingbot|BingPreview|Slurp|DuckDuckBot|baiduspider|yandex|sogou|LinkedInBot|bitlybot|tumblr|vkShare|quora link preview|facebookexternalhit|facebookcatalog|Twitterbot|applebot|redditbot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|ia_archiver|GPTBot/i.test(input);
    }
    function userAgentFromString(input) {
      return {
        ...(0, _uaparserjs.default)(input),
        isBot: input === void 0 ? false : isBot(input)
      };
    }
    function userAgent({ headers }) {
      return userAgentFromString(headers.get("user-agent") || void 0);
    }
  }
});

// node_modules/next/dist/server/web/spec-extension/url-pattern.js
var require_url_pattern = __commonJS({
  "node_modules/next/dist/server/web/spec-extension/url-pattern.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "URLPattern", {
      enumerable: true,
      get: function() {
        return GlobalURLPattern;
      }
    });
    var GlobalURLPattern = (
      // @ts-expect-error: URLPattern is not available in Node.js
      typeof URLPattern === "undefined" ? void 0 : URLPattern
    );
  }
});

// node_modules/next/dist/server/app-render/async-local-storage.js
var require_async_local_storage = __commonJS({
  "node_modules/next/dist/server/app-render/async-local-storage.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      bindSnapshot: function() {
        return bindSnapshot;
      },
      createAsyncLocalStorage: function() {
        return createAsyncLocalStorage;
      },
      createSnapshot: function() {
        return createSnapshot;
      }
    });
    var sharedAsyncLocalStorageNotAvailableError = Object.defineProperty(new Error("Invariant: AsyncLocalStorage accessed in runtime where it is not available"), "__NEXT_ERROR_CODE", {
      value: "E504",
      enumerable: false,
      configurable: true
    });
    var FakeAsyncLocalStorage = class {
      disable() {
        throw sharedAsyncLocalStorageNotAvailableError;
      }
      getStore() {
        return void 0;
      }
      run() {
        throw sharedAsyncLocalStorageNotAvailableError;
      }
      exit() {
        throw sharedAsyncLocalStorageNotAvailableError;
      }
      enterWith() {
        throw sharedAsyncLocalStorageNotAvailableError;
      }
      static bind(fn) {
        return fn;
      }
    };
    var maybeGlobalAsyncLocalStorage = typeof globalThis !== "undefined" && globalThis.AsyncLocalStorage;
    function createAsyncLocalStorage() {
      if (maybeGlobalAsyncLocalStorage) {
        return new maybeGlobalAsyncLocalStorage();
      }
      return new FakeAsyncLocalStorage();
    }
    function bindSnapshot(fn) {
      if (maybeGlobalAsyncLocalStorage) {
        return maybeGlobalAsyncLocalStorage.bind(fn);
      }
      return FakeAsyncLocalStorage.bind(fn);
    }
    function createSnapshot() {
      if (maybeGlobalAsyncLocalStorage) {
        return maybeGlobalAsyncLocalStorage.snapshot();
      }
      return function(fn, ...args) {
        return fn(...args);
      };
    }
  }
});

// node_modules/next/dist/server/app-render/work-async-storage-instance.js
var require_work_async_storage_instance = __commonJS({
  "node_modules/next/dist/server/app-render/work-async-storage-instance.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "workAsyncStorageInstance", {
      enumerable: true,
      get: function() {
        return workAsyncStorageInstance;
      }
    });
    var _asynclocalstorage = require_async_local_storage();
    var workAsyncStorageInstance = (0, _asynclocalstorage.createAsyncLocalStorage)();
  }
});

// node_modules/next/dist/server/app-render/work-async-storage.external.js
var require_work_async_storage_external = __commonJS({
  "node_modules/next/dist/server/app-render/work-async-storage.external.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "workAsyncStorage", {
      enumerable: true,
      get: function() {
        return _workasyncstorageinstance.workAsyncStorageInstance;
      }
    });
    var _workasyncstorageinstance = require_work_async_storage_instance();
  }
});

// node_modules/next/dist/server/after/after.js
var require_after = __commonJS({
  "node_modules/next/dist/server/after/after.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "after", {
      enumerable: true,
      get: function() {
        return after;
      }
    });
    var _workasyncstorageexternal = require_work_async_storage_external();
    function after(task) {
      const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
      if (!workStore) {
        throw Object.defineProperty(new Error("`after` was called outside a request scope. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context"), "__NEXT_ERROR_CODE", {
          value: "E468",
          enumerable: false,
          configurable: true
        });
      }
      const { afterContext } = workStore;
      return afterContext.after(task);
    }
  }
});

// node_modules/next/dist/server/after/index.js
var require_after2 = __commonJS({
  "node_modules/next/dist/server/after/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    _export_star(require_after(), exports2);
    function _export_star(from, to) {
      Object.keys(from).forEach(function(k) {
        if (k !== "default" && !Object.prototype.hasOwnProperty.call(to, k)) {
          Object.defineProperty(to, k, {
            enumerable: true,
            get: function() {
              return from[k];
            }
          });
        }
      });
      return from;
    }
  }
});

// node_modules/next/dist/server/app-render/work-unit-async-storage-instance.js
var require_work_unit_async_storage_instance = __commonJS({
  "node_modules/next/dist/server/app-render/work-unit-async-storage-instance.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "workUnitAsyncStorageInstance", {
      enumerable: true,
      get: function() {
        return workUnitAsyncStorageInstance;
      }
    });
    var _asynclocalstorage = require_async_local_storage();
    var workUnitAsyncStorageInstance = (0, _asynclocalstorage.createAsyncLocalStorage)();
  }
});

// node_modules/next/dist/client/components/app-router-headers.js
var require_app_router_headers = __commonJS({
  "node_modules/next/dist/client/components/app-router-headers.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      ACTION_HEADER: function() {
        return ACTION_HEADER;
      },
      FLIGHT_HEADERS: function() {
        return FLIGHT_HEADERS;
      },
      NEXT_ACTION_NOT_FOUND_HEADER: function() {
        return NEXT_ACTION_NOT_FOUND_HEADER;
      },
      NEXT_ACTION_REVALIDATED_HEADER: function() {
        return NEXT_ACTION_REVALIDATED_HEADER;
      },
      NEXT_DID_POSTPONE_HEADER: function() {
        return NEXT_DID_POSTPONE_HEADER;
      },
      NEXT_HMR_REFRESH_HASH_COOKIE: function() {
        return NEXT_HMR_REFRESH_HASH_COOKIE;
      },
      NEXT_HMR_REFRESH_HEADER: function() {
        return NEXT_HMR_REFRESH_HEADER;
      },
      NEXT_HTML_REQUEST_ID_HEADER: function() {
        return NEXT_HTML_REQUEST_ID_HEADER;
      },
      NEXT_INSTANT_PREFETCH_HEADER: function() {
        return NEXT_INSTANT_PREFETCH_HEADER;
      },
      NEXT_INSTANT_TEST_COOKIE: function() {
        return NEXT_INSTANT_TEST_COOKIE;
      },
      NEXT_IS_PRERENDER_HEADER: function() {
        return NEXT_IS_PRERENDER_HEADER;
      },
      NEXT_REQUEST_ID_HEADER: function() {
        return NEXT_REQUEST_ID_HEADER;
      },
      NEXT_REWRITTEN_PATH_HEADER: function() {
        return NEXT_REWRITTEN_PATH_HEADER;
      },
      NEXT_REWRITTEN_QUERY_HEADER: function() {
        return NEXT_REWRITTEN_QUERY_HEADER;
      },
      NEXT_ROUTER_PREFETCH_HEADER: function() {
        return NEXT_ROUTER_PREFETCH_HEADER;
      },
      NEXT_ROUTER_SEGMENT_PREFETCH_HEADER: function() {
        return NEXT_ROUTER_SEGMENT_PREFETCH_HEADER;
      },
      NEXT_ROUTER_STALE_TIME_HEADER: function() {
        return NEXT_ROUTER_STALE_TIME_HEADER;
      },
      NEXT_ROUTER_STATE_TREE_HEADER: function() {
        return NEXT_ROUTER_STATE_TREE_HEADER;
      },
      NEXT_RSC_UNION_QUERY: function() {
        return NEXT_RSC_UNION_QUERY;
      },
      NEXT_URL: function() {
        return NEXT_URL;
      },
      RSC_CONTENT_TYPE_HEADER: function() {
        return RSC_CONTENT_TYPE_HEADER;
      },
      RSC_HEADER: function() {
        return RSC_HEADER;
      }
    });
    var RSC_HEADER = "rsc";
    var ACTION_HEADER = "next-action";
    var NEXT_ROUTER_STATE_TREE_HEADER = "next-router-state-tree";
    var NEXT_ROUTER_PREFETCH_HEADER = "next-router-prefetch";
    var NEXT_ROUTER_SEGMENT_PREFETCH_HEADER = "next-router-segment-prefetch";
    var NEXT_HMR_REFRESH_HEADER = "next-hmr-refresh";
    var NEXT_HMR_REFRESH_HASH_COOKIE = "__next_hmr_refresh_hash__";
    var NEXT_URL = "next-url";
    var RSC_CONTENT_TYPE_HEADER = "text/x-component";
    var NEXT_INSTANT_PREFETCH_HEADER = "next-instant-navigation-testing-prefetch";
    var NEXT_INSTANT_TEST_COOKIE = "next-instant-navigation-testing";
    var FLIGHT_HEADERS = [
      RSC_HEADER,
      NEXT_ROUTER_STATE_TREE_HEADER,
      NEXT_ROUTER_PREFETCH_HEADER,
      NEXT_HMR_REFRESH_HEADER,
      NEXT_ROUTER_SEGMENT_PREFETCH_HEADER
    ];
    var NEXT_RSC_UNION_QUERY = "_rsc";
    var NEXT_ROUTER_STALE_TIME_HEADER = "x-nextjs-stale-time";
    var NEXT_DID_POSTPONE_HEADER = "x-nextjs-postponed";
    var NEXT_REWRITTEN_PATH_HEADER = "x-nextjs-rewritten-path";
    var NEXT_REWRITTEN_QUERY_HEADER = "x-nextjs-rewritten-query";
    var NEXT_IS_PRERENDER_HEADER = "x-nextjs-prerender";
    var NEXT_ACTION_NOT_FOUND_HEADER = "x-nextjs-action-not-found";
    var NEXT_REQUEST_ID_HEADER = "x-nextjs-request-id";
    var NEXT_HTML_REQUEST_ID_HEADER = "x-nextjs-html-request-id";
    var NEXT_ACTION_REVALIDATED_HEADER = "x-action-revalidated";
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// node_modules/next/dist/shared/lib/invariant-error.js
var require_invariant_error = __commonJS({
  "node_modules/next/dist/shared/lib/invariant-error.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "InvariantError", {
      enumerable: true,
      get: function() {
        return InvariantError;
      }
    });
    var InvariantError = class extends Error {
      constructor(message, options) {
        super(`Invariant: ${message.endsWith(".") ? message : message + "."} This is a bug in Next.js.`, options);
        this.name = "InvariantError";
      }
    };
  }
});

// node_modules/next/dist/shared/lib/promise-with-resolvers.js
var require_promise_with_resolvers = __commonJS({
  "node_modules/next/dist/shared/lib/promise-with-resolvers.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "createPromiseWithResolvers", {
      enumerable: true,
      get: function() {
        return createPromiseWithResolvers;
      }
    });
    function createPromiseWithResolvers() {
      let resolve8;
      let reject2;
      const promise = new Promise((res, rej) => {
        resolve8 = res;
        reject2 = rej;
      });
      return {
        resolve: resolve8,
        reject: reject2,
        promise
      };
    }
  }
});

// node_modules/next/dist/server/app-render/staged-rendering.js
var require_staged_rendering = __commonJS({
  "node_modules/next/dist/server/app-render/staged-rendering.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      RenderStage: function() {
        return RenderStage;
      },
      StagedRenderingController: function() {
        return StagedRenderingController;
      }
    });
    var _invarianterror = require_invariant_error();
    var _promisewithresolvers = require_promise_with_resolvers();
    var RenderStage = /* @__PURE__ */ (function(RenderStage2) {
      RenderStage2[RenderStage2["Before"] = 1] = "Before";
      RenderStage2[RenderStage2["EarlyStatic"] = 2] = "EarlyStatic";
      RenderStage2[RenderStage2["Static"] = 3] = "Static";
      RenderStage2[RenderStage2["EarlyRuntime"] = 4] = "EarlyRuntime";
      RenderStage2[RenderStage2["Runtime"] = 5] = "Runtime";
      RenderStage2[RenderStage2["Dynamic"] = 6] = "Dynamic";
      RenderStage2[RenderStage2["Abandoned"] = 7] = "Abandoned";
      return RenderStage2;
    })({});
    var StagedRenderingController = class {
      constructor(abortSignal, abandonController, shouldTrackSyncIO) {
        this.abortSignal = abortSignal;
        this.abandonController = abandonController;
        this.shouldTrackSyncIO = shouldTrackSyncIO;
        this.currentStage = 1;
        this.syncInterruptReason = null;
        this.staticStageEndTime = Infinity;
        this.runtimeStageEndTime = Infinity;
        this.staticStageListeners = [];
        this.earlyRuntimeStageListeners = [];
        this.runtimeStageListeners = [];
        this.dynamicStageListeners = [];
        this.staticStagePromise = (0, _promisewithresolvers.createPromiseWithResolvers)();
        this.earlyRuntimeStagePromise = (0, _promisewithresolvers.createPromiseWithResolvers)();
        this.runtimeStagePromise = (0, _promisewithresolvers.createPromiseWithResolvers)();
        this.dynamicStagePromise = (0, _promisewithresolvers.createPromiseWithResolvers)();
        if (abortSignal) {
          abortSignal.addEventListener("abort", () => {
            const { reason } = abortSignal;
            this.staticStagePromise.promise.catch(ignoreReject);
            this.staticStagePromise.reject(reason);
            this.earlyRuntimeStagePromise.promise.catch(ignoreReject);
            this.earlyRuntimeStagePromise.reject(reason);
            this.runtimeStagePromise.promise.catch(ignoreReject);
            this.runtimeStagePromise.reject(reason);
            this.dynamicStagePromise.promise.catch(ignoreReject);
            this.dynamicStagePromise.reject(reason);
          }, {
            once: true
          });
        }
        if (abandonController) {
          abandonController.signal.addEventListener("abort", () => {
            this.abandonRender();
          }, {
            once: true
          });
        }
      }
      onStage(stage, callback) {
        if (this.currentStage >= stage) {
          callback();
        } else if (stage === 3) {
          this.staticStageListeners.push(callback);
        } else if (stage === 4) {
          this.earlyRuntimeStageListeners.push(callback);
        } else if (stage === 5) {
          this.runtimeStageListeners.push(callback);
        } else if (stage === 6) {
          this.dynamicStageListeners.push(callback);
        } else {
          throw Object.defineProperty(new _invarianterror.InvariantError(`Invalid render stage: ${stage}`), "__NEXT_ERROR_CODE", {
            value: "E881",
            enumerable: false,
            configurable: true
          });
        }
      }
      shouldTrackSyncInterrupt() {
        if (!this.shouldTrackSyncIO) {
          return false;
        }
        switch (this.currentStage) {
          case 1:
            return false;
          case 2:
          case 3:
            return true;
          case 4:
            return true;
          case 5:
            return false;
          case 6:
          case 7:
            return false;
          default:
            return false;
        }
      }
      syncInterruptCurrentStageWithReason(reason) {
        if (this.currentStage === 1) {
          return;
        }
        if (this.currentStage === 7) {
          return;
        }
        if (this.abandonController) {
          this.abandonController.abort();
          return;
        }
        if (this.abortSignal) {
          this.syncInterruptReason = reason;
          this.currentStage = 7;
          return;
        }
        switch (this.currentStage) {
          case 2:
          case 3:
          case 4: {
            this.syncInterruptReason = reason;
            this.advanceStage(6);
            return;
          }
          case 5: {
            return;
          }
          case 6:
          default:
        }
      }
      getSyncInterruptReason() {
        return this.syncInterruptReason;
      }
      getStaticStageEndTime() {
        return this.staticStageEndTime;
      }
      getRuntimeStageEndTime() {
        return this.runtimeStageEndTime;
      }
      abandonRender() {
        const { currentStage } = this;
        switch (currentStage) {
          case 2: {
            this.resolveStaticStage();
          }
          // intentional fallthrough
          case 3: {
            this.resolveEarlyRuntimeStage();
          }
          // intentional fallthrough
          case 4: {
            this.resolveRuntimeStage();
          }
          // intentional fallthrough
          case 5: {
            this.currentStage = 7;
            return;
          }
          case 6:
          case 1:
          case 7:
            break;
          default: {
            currentStage;
          }
        }
      }
      advanceStage(stage) {
        if (stage <= this.currentStage) {
          return;
        }
        let currentStage = this.currentStage;
        this.currentStage = stage;
        if (currentStage < 3 && stage >= 3) {
          this.resolveStaticStage();
        }
        if (currentStage < 4 && stage >= 4) {
          this.resolveEarlyRuntimeStage();
        }
        if (currentStage < 5 && stage >= 5) {
          this.staticStageEndTime = performance.now() + performance.timeOrigin;
          this.resolveRuntimeStage();
        }
        if (currentStage < 6 && stage >= 6) {
          this.runtimeStageEndTime = performance.now() + performance.timeOrigin;
          this.resolveDynamicStage();
          return;
        }
      }
      /** Fire the `onStage` listeners for the static stage and unblock any promises waiting for it. */
      resolveStaticStage() {
        const staticListeners = this.staticStageListeners;
        for (let i = 0; i < staticListeners.length; i++) {
          staticListeners[i]();
        }
        staticListeners.length = 0;
        this.staticStagePromise.resolve();
      }
      /** Fire the `onStage` listeners for the early runtime stage and unblock any promises waiting for it. */
      resolveEarlyRuntimeStage() {
        const earlyRuntimeListeners = this.earlyRuntimeStageListeners;
        for (let i = 0; i < earlyRuntimeListeners.length; i++) {
          earlyRuntimeListeners[i]();
        }
        earlyRuntimeListeners.length = 0;
        this.earlyRuntimeStagePromise.resolve();
      }
      /** Fire the `onStage` listeners for the runtime stage and unblock any promises waiting for it. */
      resolveRuntimeStage() {
        const runtimeListeners = this.runtimeStageListeners;
        for (let i = 0; i < runtimeListeners.length; i++) {
          runtimeListeners[i]();
        }
        runtimeListeners.length = 0;
        this.runtimeStagePromise.resolve();
      }
      /** Fire the `onStage` listeners for the dynamic stage and unblock any promises waiting for it. */
      resolveDynamicStage() {
        const dynamicListeners = this.dynamicStageListeners;
        for (let i = 0; i < dynamicListeners.length; i++) {
          dynamicListeners[i]();
        }
        dynamicListeners.length = 0;
        this.dynamicStagePromise.resolve();
      }
      getStagePromise(stage) {
        switch (stage) {
          case 3: {
            return this.staticStagePromise.promise;
          }
          case 4: {
            return this.earlyRuntimeStagePromise.promise;
          }
          case 5: {
            return this.runtimeStagePromise.promise;
          }
          case 6: {
            return this.dynamicStagePromise.promise;
          }
          default: {
            stage;
            throw Object.defineProperty(new _invarianterror.InvariantError(`Invalid render stage: ${stage}`), "__NEXT_ERROR_CODE", {
              value: "E881",
              enumerable: false,
              configurable: true
            });
          }
        }
      }
      waitForStage(stage) {
        return this.getStagePromise(stage);
      }
      delayUntilStage(stage, displayName, resolvedValue) {
        const ioTriggerPromise = this.getStagePromise(stage);
        const promise = makeDevtoolsIOPromiseFromIOTrigger(ioTriggerPromise, displayName, resolvedValue);
        if (this.abortSignal) {
          promise.catch(ignoreReject);
        }
        return promise;
      }
    };
    function ignoreReject() {
    }
    function makeDevtoolsIOPromiseFromIOTrigger(ioTrigger, displayName, resolvedValue) {
      const promise = new Promise((resolve8, reject2) => {
        ioTrigger.then(resolve8.bind(null, resolvedValue), reject2);
      });
      if (displayName !== void 0) {
        promise.displayName = displayName;
      }
      return promise;
    }
  }
});

// node_modules/next/dist/server/app-render/work-unit-async-storage.external.js
var require_work_unit_async_storage_external = __commonJS({
  "node_modules/next/dist/server/app-render/work-unit-async-storage.external.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      getCacheSignal: function() {
        return getCacheSignal;
      },
      getDraftModeProviderForCacheScope: function() {
        return getDraftModeProviderForCacheScope;
      },
      getHmrRefreshHash: function() {
        return getHmrRefreshHash;
      },
      getPrerenderResumeDataCache: function() {
        return getPrerenderResumeDataCache;
      },
      getRenderResumeDataCache: function() {
        return getRenderResumeDataCache;
      },
      getServerComponentsHmrCache: function() {
        return getServerComponentsHmrCache;
      },
      getStagedRenderingController: function() {
        return getStagedRenderingController;
      },
      isHmrRefresh: function() {
        return isHmrRefresh;
      },
      isInEarlyRenderStage: function() {
        return isInEarlyRenderStage;
      },
      throwForMissingRequestStore: function() {
        return throwForMissingRequestStore;
      },
      throwInvariantForMissingStore: function() {
        return throwInvariantForMissingStore;
      },
      workUnitAsyncStorage: function() {
        return _workunitasyncstorageinstance.workUnitAsyncStorageInstance;
      }
    });
    var _workunitasyncstorageinstance = require_work_unit_async_storage_instance();
    var _approuterheaders = require_app_router_headers();
    var _invarianterror = require_invariant_error();
    var _stagedrendering = require_staged_rendering();
    function isInEarlyRenderStage(requestStore) {
      const stagedRendering = requestStore.stagedRendering;
      if (stagedRendering) {
        return stagedRendering.currentStage === _stagedrendering.RenderStage.EarlyStatic || stagedRendering.currentStage === _stagedrendering.RenderStage.EarlyRuntime;
      }
      return false;
    }
    function throwForMissingRequestStore(callingExpression) {
      throw Object.defineProperty(new Error(`\`${callingExpression}\` was called outside a request scope. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context`), "__NEXT_ERROR_CODE", {
        value: "E251",
        enumerable: false,
        configurable: true
      });
    }
    function throwInvariantForMissingStore() {
      throw Object.defineProperty(new _invarianterror.InvariantError("Expected workUnitAsyncStorage to have a store."), "__NEXT_ERROR_CODE", {
        value: "E696",
        enumerable: false,
        configurable: true
      });
    }
    function getPrerenderResumeDataCache(workUnitStore) {
      switch (workUnitStore.type) {
        case "prerender":
        case "prerender-runtime":
        case "prerender-ppr":
          return workUnitStore.prerenderResumeDataCache;
        case "prerender-client":
        case "validation-client":
          return workUnitStore.prerenderResumeDataCache;
        case "request": {
          if (workUnitStore.prerenderResumeDataCache) {
            return workUnitStore.prerenderResumeDataCache;
          }
        }
        case "prerender-legacy":
        case "cache":
        case "private-cache":
        case "unstable-cache":
        case "generate-static-params":
          return null;
        default:
          return workUnitStore;
      }
    }
    function getRenderResumeDataCache(workUnitStore) {
      switch (workUnitStore.type) {
        case "request":
        case "prerender":
        case "prerender-runtime":
        case "prerender-client":
        case "validation-client":
          if (workUnitStore.renderResumeDataCache) {
            return workUnitStore.renderResumeDataCache;
          }
        // fallthrough
        case "prerender-ppr":
          return workUnitStore.prerenderResumeDataCache ?? null;
        case "cache":
        case "private-cache":
        case "unstable-cache":
        case "prerender-legacy":
        case "generate-static-params":
          return null;
        default:
          return workUnitStore;
      }
    }
    function getHmrRefreshHash(workUnitStore) {
      if (process.env.__NEXT_DEV_SERVER) {
        switch (workUnitStore.type) {
          case "cache":
          case "private-cache":
          case "prerender":
          case "prerender-runtime":
            return workUnitStore.hmrRefreshHash;
          case "request":
            var _workUnitStore_cookies_get;
            return (_workUnitStore_cookies_get = workUnitStore.cookies.get(_approuterheaders.NEXT_HMR_REFRESH_HASH_COOKIE)) == null ? void 0 : _workUnitStore_cookies_get.value;
          case "prerender-client":
          case "validation-client":
          case "prerender-ppr":
          case "prerender-legacy":
          case "unstable-cache":
          case "generate-static-params":
            break;
          default:
            workUnitStore;
        }
      }
      return void 0;
    }
    function isHmrRefresh(workUnitStore) {
      if (process.env.__NEXT_DEV_SERVER) {
        switch (workUnitStore.type) {
          case "cache":
          case "private-cache":
          case "request":
            return workUnitStore.isHmrRefresh ?? false;
          case "prerender":
          case "prerender-client":
          case "validation-client":
          case "prerender-runtime":
          case "prerender-ppr":
          case "prerender-legacy":
          case "unstable-cache":
          case "generate-static-params":
            break;
          default:
            workUnitStore;
        }
      }
      return false;
    }
    function getServerComponentsHmrCache(workUnitStore) {
      if (process.env.__NEXT_DEV_SERVER) {
        switch (workUnitStore.type) {
          case "cache":
          case "private-cache":
          case "request":
            return workUnitStore.serverComponentsHmrCache;
          case "prerender":
          case "prerender-client":
          case "validation-client":
          case "prerender-runtime":
          case "prerender-ppr":
          case "prerender-legacy":
          case "unstable-cache":
          case "generate-static-params":
            break;
          default:
            workUnitStore;
        }
      }
      return void 0;
    }
    function getDraftModeProviderForCacheScope(workStore, workUnitStore) {
      if (workStore.isDraftMode) {
        switch (workUnitStore.type) {
          case "cache":
          case "private-cache":
          case "unstable-cache":
          case "prerender-runtime":
          case "request":
            return workUnitStore.draftMode;
          case "prerender":
          case "prerender-client":
          case "validation-client":
          case "prerender-ppr":
          case "prerender-legacy":
          case "generate-static-params":
            break;
          default:
            workUnitStore;
        }
      }
      return void 0;
    }
    function getStagedRenderingController(workUnitStore) {
      switch (workUnitStore.type) {
        case "request":
        case "prerender-runtime":
          return workUnitStore.stagedRendering ?? null;
        case "prerender":
        case "prerender-client":
        case "validation-client":
        case "prerender-ppr":
        case "prerender-legacy":
        case "cache":
        case "private-cache":
        case "unstable-cache":
        case "generate-static-params":
          return null;
        default:
          return workUnitStore;
      }
    }
    function getCacheSignal(workUnitStore) {
      switch (workUnitStore.type) {
        case "prerender":
        case "prerender-client":
        case "validation-client":
        case "prerender-runtime":
          return workUnitStore.cacheSignal;
        case "request": {
          if (workUnitStore.cacheSignal) {
            return workUnitStore.cacheSignal;
          }
        }
        case "prerender-ppr":
        case "prerender-legacy":
        case "cache":
        case "private-cache":
        case "unstable-cache":
        case "generate-static-params":
          return null;
        default:
          return workUnitStore;
      }
    }
  }
});

// node_modules/react/cjs/react.production.js
var require_react_production = __commonJS({
  "node_modules/react/cjs/react.production.js"(exports2) {
    "use strict";
    var REACT_ELEMENT_TYPE = /* @__PURE__ */ Symbol.for("react.transitional.element");
    var REACT_PORTAL_TYPE = /* @__PURE__ */ Symbol.for("react.portal");
    var REACT_FRAGMENT_TYPE = /* @__PURE__ */ Symbol.for("react.fragment");
    var REACT_STRICT_MODE_TYPE = /* @__PURE__ */ Symbol.for("react.strict_mode");
    var REACT_PROFILER_TYPE = /* @__PURE__ */ Symbol.for("react.profiler");
    var REACT_CONSUMER_TYPE = /* @__PURE__ */ Symbol.for("react.consumer");
    var REACT_CONTEXT_TYPE = /* @__PURE__ */ Symbol.for("react.context");
    var REACT_FORWARD_REF_TYPE = /* @__PURE__ */ Symbol.for("react.forward_ref");
    var REACT_SUSPENSE_TYPE = /* @__PURE__ */ Symbol.for("react.suspense");
    var REACT_MEMO_TYPE = /* @__PURE__ */ Symbol.for("react.memo");
    var REACT_LAZY_TYPE = /* @__PURE__ */ Symbol.for("react.lazy");
    var MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
    function getIteratorFn(maybeIterable) {
      if (null === maybeIterable || "object" !== typeof maybeIterable) return null;
      maybeIterable = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable["@@iterator"];
      return "function" === typeof maybeIterable ? maybeIterable : null;
    }
    var ReactNoopUpdateQueue = {
      isMounted: function() {
        return false;
      },
      enqueueForceUpdate: function() {
      },
      enqueueReplaceState: function() {
      },
      enqueueSetState: function() {
      }
    };
    var assign = Object.assign;
    var emptyObject = {};
    function Component(props, context, updater) {
      this.props = props;
      this.context = context;
      this.refs = emptyObject;
      this.updater = updater || ReactNoopUpdateQueue;
    }
    Component.prototype.isReactComponent = {};
    Component.prototype.setState = function(partialState, callback) {
      if ("object" !== typeof partialState && "function" !== typeof partialState && null != partialState)
        throw Error(
          "takes an object of state variables to update or a function which returns an object of state variables."
        );
      this.updater.enqueueSetState(this, partialState, callback, "setState");
    };
    Component.prototype.forceUpdate = function(callback) {
      this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
    };
    function ComponentDummy() {
    }
    ComponentDummy.prototype = Component.prototype;
    function PureComponent(props, context, updater) {
      this.props = props;
      this.context = context;
      this.refs = emptyObject;
      this.updater = updater || ReactNoopUpdateQueue;
    }
    var pureComponentPrototype = PureComponent.prototype = new ComponentDummy();
    pureComponentPrototype.constructor = PureComponent;
    assign(pureComponentPrototype, Component.prototype);
    pureComponentPrototype.isPureReactComponent = true;
    var isArrayImpl = Array.isArray;
    var ReactSharedInternals = { H: null, A: null, T: null, S: null };
    var hasOwnProperty = Object.prototype.hasOwnProperty;
    function ReactElement(type, key, self, source, owner, props) {
      self = props.ref;
      return {
        $$typeof: REACT_ELEMENT_TYPE,
        type,
        key,
        ref: void 0 !== self ? self : null,
        props
      };
    }
    function cloneAndReplaceKey(oldElement, newKey) {
      return ReactElement(
        oldElement.type,
        newKey,
        void 0,
        void 0,
        void 0,
        oldElement.props
      );
    }
    function isValidElement(object) {
      return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
    }
    function escape2(key) {
      var escaperLookup = { "=": "=0", ":": "=2" };
      return "$" + key.replace(/[=:]/g, function(match) {
        return escaperLookup[match];
      });
    }
    var userProvidedKeyEscapeRegex = /\/+/g;
    function getElementKey(element, index) {
      return "object" === typeof element && null !== element && null != element.key ? escape2("" + element.key) : index.toString(36);
    }
    function noop$1() {
    }
    function resolveThenable(thenable) {
      switch (thenable.status) {
        case "fulfilled":
          return thenable.value;
        case "rejected":
          throw thenable.reason;
        default:
          switch ("string" === typeof thenable.status ? thenable.then(noop$1, noop$1) : (thenable.status = "pending", thenable.then(
            function(fulfilledValue) {
              "pending" === thenable.status && (thenable.status = "fulfilled", thenable.value = fulfilledValue);
            },
            function(error) {
              "pending" === thenable.status && (thenable.status = "rejected", thenable.reason = error);
            }
          )), thenable.status) {
            case "fulfilled":
              return thenable.value;
            case "rejected":
              throw thenable.reason;
          }
      }
      throw thenable;
    }
    function mapIntoArray(children, array, escapedPrefix, nameSoFar, callback) {
      var type = typeof children;
      if ("undefined" === type || "boolean" === type) children = null;
      var invokeCallback = false;
      if (null === children) invokeCallback = true;
      else
        switch (type) {
          case "bigint":
          case "string":
          case "number":
            invokeCallback = true;
            break;
          case "object":
            switch (children.$$typeof) {
              case REACT_ELEMENT_TYPE:
              case REACT_PORTAL_TYPE:
                invokeCallback = true;
                break;
              case REACT_LAZY_TYPE:
                return invokeCallback = children._init, mapIntoArray(
                  invokeCallback(children._payload),
                  array,
                  escapedPrefix,
                  nameSoFar,
                  callback
                );
            }
        }
      if (invokeCallback)
        return callback = callback(children), invokeCallback = "" === nameSoFar ? "." + getElementKey(children, 0) : nameSoFar, isArrayImpl(callback) ? (escapedPrefix = "", null != invokeCallback && (escapedPrefix = invokeCallback.replace(userProvidedKeyEscapeRegex, "$&/") + "/"), mapIntoArray(callback, array, escapedPrefix, "", function(c) {
          return c;
        })) : null != callback && (isValidElement(callback) && (callback = cloneAndReplaceKey(
          callback,
          escapedPrefix + (null == callback.key || children && children.key === callback.key ? "" : ("" + callback.key).replace(
            userProvidedKeyEscapeRegex,
            "$&/"
          ) + "/") + invokeCallback
        )), array.push(callback)), 1;
      invokeCallback = 0;
      var nextNamePrefix = "" === nameSoFar ? "." : nameSoFar + ":";
      if (isArrayImpl(children))
        for (var i = 0; i < children.length; i++)
          nameSoFar = children[i], type = nextNamePrefix + getElementKey(nameSoFar, i), invokeCallback += mapIntoArray(
            nameSoFar,
            array,
            escapedPrefix,
            type,
            callback
          );
      else if (i = getIteratorFn(children), "function" === typeof i)
        for (children = i.call(children), i = 0; !(nameSoFar = children.next()).done; )
          nameSoFar = nameSoFar.value, type = nextNamePrefix + getElementKey(nameSoFar, i++), invokeCallback += mapIntoArray(
            nameSoFar,
            array,
            escapedPrefix,
            type,
            callback
          );
      else if ("object" === type) {
        if ("function" === typeof children.then)
          return mapIntoArray(
            resolveThenable(children),
            array,
            escapedPrefix,
            nameSoFar,
            callback
          );
        array = String(children);
        throw Error(
          "Objects are not valid as a React child (found: " + ("[object Object]" === array ? "object with keys {" + Object.keys(children).join(", ") + "}" : array) + "). If you meant to render a collection of children, use an array instead."
        );
      }
      return invokeCallback;
    }
    function mapChildren(children, func, context) {
      if (null == children) return children;
      var result = [], count = 0;
      mapIntoArray(children, result, "", "", function(child) {
        return func.call(context, child, count++);
      });
      return result;
    }
    function lazyInitializer(payload) {
      if (-1 === payload._status) {
        var ctor = payload._result;
        ctor = ctor();
        ctor.then(
          function(moduleObject) {
            if (0 === payload._status || -1 === payload._status)
              payload._status = 1, payload._result = moduleObject;
          },
          function(error) {
            if (0 === payload._status || -1 === payload._status)
              payload._status = 2, payload._result = error;
          }
        );
        -1 === payload._status && (payload._status = 0, payload._result = ctor);
      }
      if (1 === payload._status) return payload._result.default;
      throw payload._result;
    }
    var reportGlobalError = "function" === typeof reportError ? reportError : function(error) {
      if ("object" === typeof window && "function" === typeof window.ErrorEvent) {
        var event = new window.ErrorEvent("error", {
          bubbles: true,
          cancelable: true,
          message: "object" === typeof error && null !== error && "string" === typeof error.message ? String(error.message) : String(error),
          error
        });
        if (!window.dispatchEvent(event)) return;
      } else if ("object" === typeof process && "function" === typeof process.emit) {
        process.emit("uncaughtException", error);
        return;
      }
      console.error(error);
    };
    function noop() {
    }
    exports2.Children = {
      map: mapChildren,
      forEach: function(children, forEachFunc, forEachContext) {
        mapChildren(
          children,
          function() {
            forEachFunc.apply(this, arguments);
          },
          forEachContext
        );
      },
      count: function(children) {
        var n = 0;
        mapChildren(children, function() {
          n++;
        });
        return n;
      },
      toArray: function(children) {
        return mapChildren(children, function(child) {
          return child;
        }) || [];
      },
      only: function(children) {
        if (!isValidElement(children))
          throw Error(
            "React.Children.only expected to receive a single React element child."
          );
        return children;
      }
    };
    exports2.Component = Component;
    exports2.Fragment = REACT_FRAGMENT_TYPE;
    exports2.Profiler = REACT_PROFILER_TYPE;
    exports2.PureComponent = PureComponent;
    exports2.StrictMode = REACT_STRICT_MODE_TYPE;
    exports2.Suspense = REACT_SUSPENSE_TYPE;
    exports2.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = ReactSharedInternals;
    exports2.act = function() {
      throw Error("act(...) is not supported in production builds of React.");
    };
    exports2.cache = function(fn) {
      return function() {
        return fn.apply(null, arguments);
      };
    };
    exports2.cloneElement = function(element, config2, children) {
      if (null === element || void 0 === element)
        throw Error(
          "The argument must be a React element, but you passed " + element + "."
        );
      var props = assign({}, element.props), key = element.key, owner = void 0;
      if (null != config2)
        for (propName in void 0 !== config2.ref && (owner = void 0), void 0 !== config2.key && (key = "" + config2.key), config2)
          !hasOwnProperty.call(config2, propName) || "key" === propName || "__self" === propName || "__source" === propName || "ref" === propName && void 0 === config2.ref || (props[propName] = config2[propName]);
      var propName = arguments.length - 2;
      if (1 === propName) props.children = children;
      else if (1 < propName) {
        for (var childArray = Array(propName), i = 0; i < propName; i++)
          childArray[i] = arguments[i + 2];
        props.children = childArray;
      }
      return ReactElement(element.type, key, void 0, void 0, owner, props);
    };
    exports2.createContext = function(defaultValue) {
      defaultValue = {
        $$typeof: REACT_CONTEXT_TYPE,
        _currentValue: defaultValue,
        _currentValue2: defaultValue,
        _threadCount: 0,
        Provider: null,
        Consumer: null
      };
      defaultValue.Provider = defaultValue;
      defaultValue.Consumer = {
        $$typeof: REACT_CONSUMER_TYPE,
        _context: defaultValue
      };
      return defaultValue;
    };
    exports2.createElement = function(type, config2, children) {
      var propName, props = {}, key = null;
      if (null != config2)
        for (propName in void 0 !== config2.key && (key = "" + config2.key), config2)
          hasOwnProperty.call(config2, propName) && "key" !== propName && "__self" !== propName && "__source" !== propName && (props[propName] = config2[propName]);
      var childrenLength = arguments.length - 2;
      if (1 === childrenLength) props.children = children;
      else if (1 < childrenLength) {
        for (var childArray = Array(childrenLength), i = 0; i < childrenLength; i++)
          childArray[i] = arguments[i + 2];
        props.children = childArray;
      }
      if (type && type.defaultProps)
        for (propName in childrenLength = type.defaultProps, childrenLength)
          void 0 === props[propName] && (props[propName] = childrenLength[propName]);
      return ReactElement(type, key, void 0, void 0, null, props);
    };
    exports2.createRef = function() {
      return { current: null };
    };
    exports2.forwardRef = function(render) {
      return { $$typeof: REACT_FORWARD_REF_TYPE, render };
    };
    exports2.isValidElement = isValidElement;
    exports2.lazy = function(ctor) {
      return {
        $$typeof: REACT_LAZY_TYPE,
        _payload: { _status: -1, _result: ctor },
        _init: lazyInitializer
      };
    };
    exports2.memo = function(type, compare) {
      return {
        $$typeof: REACT_MEMO_TYPE,
        type,
        compare: void 0 === compare ? null : compare
      };
    };
    exports2.startTransition = function(scope) {
      var prevTransition = ReactSharedInternals.T, currentTransition = {};
      ReactSharedInternals.T = currentTransition;
      try {
        var returnValue = scope(), onStartTransitionFinish = ReactSharedInternals.S;
        null !== onStartTransitionFinish && onStartTransitionFinish(currentTransition, returnValue);
        "object" === typeof returnValue && null !== returnValue && "function" === typeof returnValue.then && returnValue.then(noop, reportGlobalError);
      } catch (error) {
        reportGlobalError(error);
      } finally {
        ReactSharedInternals.T = prevTransition;
      }
    };
    exports2.unstable_useCacheRefresh = function() {
      return ReactSharedInternals.H.useCacheRefresh();
    };
    exports2.use = function(usable) {
      return ReactSharedInternals.H.use(usable);
    };
    exports2.useActionState = function(action, initialState, permalink) {
      return ReactSharedInternals.H.useActionState(action, initialState, permalink);
    };
    exports2.useCallback = function(callback, deps) {
      return ReactSharedInternals.H.useCallback(callback, deps);
    };
    exports2.useContext = function(Context) {
      return ReactSharedInternals.H.useContext(Context);
    };
    exports2.useDebugValue = function() {
    };
    exports2.useDeferredValue = function(value2, initialValue) {
      return ReactSharedInternals.H.useDeferredValue(value2, initialValue);
    };
    exports2.useEffect = function(create, deps) {
      return ReactSharedInternals.H.useEffect(create, deps);
    };
    exports2.useId = function() {
      return ReactSharedInternals.H.useId();
    };
    exports2.useImperativeHandle = function(ref, create, deps) {
      return ReactSharedInternals.H.useImperativeHandle(ref, create, deps);
    };
    exports2.useInsertionEffect = function(create, deps) {
      return ReactSharedInternals.H.useInsertionEffect(create, deps);
    };
    exports2.useLayoutEffect = function(create, deps) {
      return ReactSharedInternals.H.useLayoutEffect(create, deps);
    };
    exports2.useMemo = function(create, deps) {
      return ReactSharedInternals.H.useMemo(create, deps);
    };
    exports2.useOptimistic = function(passthrough, reducer) {
      return ReactSharedInternals.H.useOptimistic(passthrough, reducer);
    };
    exports2.useReducer = function(reducer, initialArg, init) {
      return ReactSharedInternals.H.useReducer(reducer, initialArg, init);
    };
    exports2.useRef = function(initialValue) {
      return ReactSharedInternals.H.useRef(initialValue);
    };
    exports2.useState = function(initialState) {
      return ReactSharedInternals.H.useState(initialState);
    };
    exports2.useSyncExternalStore = function(subscribe, getSnapshot, getServerSnapshot) {
      return ReactSharedInternals.H.useSyncExternalStore(
        subscribe,
        getSnapshot,
        getServerSnapshot
      );
    };
    exports2.useTransition = function() {
      return ReactSharedInternals.H.useTransition();
    };
    exports2.version = "19.0.0";
  }
});

// node_modules/react/cjs/react.development.js
var require_react_development = __commonJS({
  "node_modules/react/cjs/react.development.js"(exports2, module2) {
    "use strict";
    "production" !== process.env.NODE_ENV && (function() {
      function defineDeprecationWarning(methodName, info) {
        Object.defineProperty(Component.prototype, methodName, {
          get: function() {
            console.warn(
              "%s(...) is deprecated in plain JavaScript React classes. %s",
              info[0],
              info[1]
            );
          }
        });
      }
      function getIteratorFn(maybeIterable) {
        if (null === maybeIterable || "object" !== typeof maybeIterable)
          return null;
        maybeIterable = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable["@@iterator"];
        return "function" === typeof maybeIterable ? maybeIterable : null;
      }
      function warnNoop(publicInstance, callerName) {
        publicInstance = (publicInstance = publicInstance.constructor) && (publicInstance.displayName || publicInstance.name) || "ReactClass";
        var warningKey = publicInstance + "." + callerName;
        didWarnStateUpdateForUnmountedComponent[warningKey] || (console.error(
          "Can't call %s on a component that is not yet mounted. This is a no-op, but it might indicate a bug in your application. Instead, assign to `this.state` directly or define a `state = {};` class property with the desired state in the %s component.",
          callerName,
          publicInstance
        ), didWarnStateUpdateForUnmountedComponent[warningKey] = true);
      }
      function Component(props, context, updater) {
        this.props = props;
        this.context = context;
        this.refs = emptyObject;
        this.updater = updater || ReactNoopUpdateQueue;
      }
      function ComponentDummy() {
      }
      function PureComponent(props, context, updater) {
        this.props = props;
        this.context = context;
        this.refs = emptyObject;
        this.updater = updater || ReactNoopUpdateQueue;
      }
      function testStringCoercion(value2) {
        return "" + value2;
      }
      function checkKeyStringCoercion(value2) {
        try {
          testStringCoercion(value2);
          var JSCompiler_inline_result = false;
        } catch (e) {
          JSCompiler_inline_result = true;
        }
        if (JSCompiler_inline_result) {
          JSCompiler_inline_result = console;
          var JSCompiler_temp_const = JSCompiler_inline_result.error;
          var JSCompiler_inline_result$jscomp$0 = "function" === typeof Symbol && Symbol.toStringTag && value2[Symbol.toStringTag] || value2.constructor.name || "Object";
          JSCompiler_temp_const.call(
            JSCompiler_inline_result,
            "The provided key is an unsupported type %s. This value must be coerced to a string before using it here.",
            JSCompiler_inline_result$jscomp$0
          );
          return testStringCoercion(value2);
        }
      }
      function getComponentNameFromType(type) {
        if (null == type) return null;
        if ("function" === typeof type)
          return type.$$typeof === REACT_CLIENT_REFERENCE$2 ? null : type.displayName || type.name || null;
        if ("string" === typeof type) return type;
        switch (type) {
          case REACT_FRAGMENT_TYPE:
            return "Fragment";
          case REACT_PORTAL_TYPE:
            return "Portal";
          case REACT_PROFILER_TYPE:
            return "Profiler";
          case REACT_STRICT_MODE_TYPE:
            return "StrictMode";
          case REACT_SUSPENSE_TYPE:
            return "Suspense";
          case REACT_SUSPENSE_LIST_TYPE:
            return "SuspenseList";
        }
        if ("object" === typeof type)
          switch ("number" === typeof type.tag && console.error(
            "Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."
          ), type.$$typeof) {
            case REACT_CONTEXT_TYPE:
              return (type.displayName || "Context") + ".Provider";
            case REACT_CONSUMER_TYPE:
              return (type._context.displayName || "Context") + ".Consumer";
            case REACT_FORWARD_REF_TYPE:
              var innerType = type.render;
              type = type.displayName;
              type || (type = innerType.displayName || innerType.name || "", type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef");
              return type;
            case REACT_MEMO_TYPE:
              return innerType = type.displayName || null, null !== innerType ? innerType : getComponentNameFromType(type.type) || "Memo";
            case REACT_LAZY_TYPE:
              innerType = type._payload;
              type = type._init;
              try {
                return getComponentNameFromType(type(innerType));
              } catch (x) {
              }
          }
        return null;
      }
      function isValidElementType(type) {
        return "string" === typeof type || "function" === typeof type || type === REACT_FRAGMENT_TYPE || type === REACT_PROFILER_TYPE || type === REACT_STRICT_MODE_TYPE || type === REACT_SUSPENSE_TYPE || type === REACT_SUSPENSE_LIST_TYPE || type === REACT_OFFSCREEN_TYPE || "object" === typeof type && null !== type && (type.$$typeof === REACT_LAZY_TYPE || type.$$typeof === REACT_MEMO_TYPE || type.$$typeof === REACT_CONTEXT_TYPE || type.$$typeof === REACT_CONSUMER_TYPE || type.$$typeof === REACT_FORWARD_REF_TYPE || type.$$typeof === REACT_CLIENT_REFERENCE$1 || void 0 !== type.getModuleId) ? true : false;
      }
      function disabledLog() {
      }
      function disableLogs() {
        if (0 === disabledDepth) {
          prevLog = console.log;
          prevInfo = console.info;
          prevWarn = console.warn;
          prevError = console.error;
          prevGroup = console.group;
          prevGroupCollapsed = console.groupCollapsed;
          prevGroupEnd = console.groupEnd;
          var props = {
            configurable: true,
            enumerable: true,
            value: disabledLog,
            writable: true
          };
          Object.defineProperties(console, {
            info: props,
            log: props,
            warn: props,
            error: props,
            group: props,
            groupCollapsed: props,
            groupEnd: props
          });
        }
        disabledDepth++;
      }
      function reenableLogs() {
        disabledDepth--;
        if (0 === disabledDepth) {
          var props = { configurable: true, enumerable: true, writable: true };
          Object.defineProperties(console, {
            log: assign({}, props, { value: prevLog }),
            info: assign({}, props, { value: prevInfo }),
            warn: assign({}, props, { value: prevWarn }),
            error: assign({}, props, { value: prevError }),
            group: assign({}, props, { value: prevGroup }),
            groupCollapsed: assign({}, props, { value: prevGroupCollapsed }),
            groupEnd: assign({}, props, { value: prevGroupEnd })
          });
        }
        0 > disabledDepth && console.error(
          "disabledDepth fell below zero. This is a bug in React. Please file an issue."
        );
      }
      function describeBuiltInComponentFrame(name) {
        if (void 0 === prefix)
          try {
            throw Error();
          } catch (x) {
            var match = x.stack.trim().match(/\n( *(at )?)/);
            prefix = match && match[1] || "";
            suffix = -1 < x.stack.indexOf("\n    at") ? " (<anonymous>)" : -1 < x.stack.indexOf("@") ? "@unknown:0:0" : "";
          }
        return "\n" + prefix + name + suffix;
      }
      function describeNativeComponentFrame(fn, construct) {
        if (!fn || reentry) return "";
        var frame = componentFrameCache.get(fn);
        if (void 0 !== frame) return frame;
        reentry = true;
        frame = Error.prepareStackTrace;
        Error.prepareStackTrace = void 0;
        var previousDispatcher = null;
        previousDispatcher = ReactSharedInternals.H;
        ReactSharedInternals.H = null;
        disableLogs();
        try {
          var RunInRootFrame = {
            DetermineComponentFrameRoot: function() {
              try {
                if (construct) {
                  var Fake = function() {
                    throw Error();
                  };
                  Object.defineProperty(Fake.prototype, "props", {
                    set: function() {
                      throw Error();
                    }
                  });
                  if ("object" === typeof Reflect && Reflect.construct) {
                    try {
                      Reflect.construct(Fake, []);
                    } catch (x) {
                      var control = x;
                    }
                    Reflect.construct(fn, [], Fake);
                  } else {
                    try {
                      Fake.call();
                    } catch (x$0) {
                      control = x$0;
                    }
                    fn.call(Fake.prototype);
                  }
                } else {
                  try {
                    throw Error();
                  } catch (x$1) {
                    control = x$1;
                  }
                  (Fake = fn()) && "function" === typeof Fake.catch && Fake.catch(function() {
                  });
                }
              } catch (sample) {
                if (sample && control && "string" === typeof sample.stack)
                  return [sample.stack, control.stack];
              }
              return [null, null];
            }
          };
          RunInRootFrame.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
          var namePropDescriptor = Object.getOwnPropertyDescriptor(
            RunInRootFrame.DetermineComponentFrameRoot,
            "name"
          );
          namePropDescriptor && namePropDescriptor.configurable && Object.defineProperty(
            RunInRootFrame.DetermineComponentFrameRoot,
            "name",
            { value: "DetermineComponentFrameRoot" }
          );
          var _RunInRootFrame$Deter = RunInRootFrame.DetermineComponentFrameRoot(), sampleStack = _RunInRootFrame$Deter[0], controlStack = _RunInRootFrame$Deter[1];
          if (sampleStack && controlStack) {
            var sampleLines = sampleStack.split("\n"), controlLines = controlStack.split("\n");
            for (_RunInRootFrame$Deter = namePropDescriptor = 0; namePropDescriptor < sampleLines.length && !sampleLines[namePropDescriptor].includes(
              "DetermineComponentFrameRoot"
            ); )
              namePropDescriptor++;
            for (; _RunInRootFrame$Deter < controlLines.length && !controlLines[_RunInRootFrame$Deter].includes(
              "DetermineComponentFrameRoot"
            ); )
              _RunInRootFrame$Deter++;
            if (namePropDescriptor === sampleLines.length || _RunInRootFrame$Deter === controlLines.length)
              for (namePropDescriptor = sampleLines.length - 1, _RunInRootFrame$Deter = controlLines.length - 1; 1 <= namePropDescriptor && 0 <= _RunInRootFrame$Deter && sampleLines[namePropDescriptor] !== controlLines[_RunInRootFrame$Deter]; )
                _RunInRootFrame$Deter--;
            for (; 1 <= namePropDescriptor && 0 <= _RunInRootFrame$Deter; namePropDescriptor--, _RunInRootFrame$Deter--)
              if (sampleLines[namePropDescriptor] !== controlLines[_RunInRootFrame$Deter]) {
                if (1 !== namePropDescriptor || 1 !== _RunInRootFrame$Deter) {
                  do
                    if (namePropDescriptor--, _RunInRootFrame$Deter--, 0 > _RunInRootFrame$Deter || sampleLines[namePropDescriptor] !== controlLines[_RunInRootFrame$Deter]) {
                      var _frame = "\n" + sampleLines[namePropDescriptor].replace(
                        " at new ",
                        " at "
                      );
                      fn.displayName && _frame.includes("<anonymous>") && (_frame = _frame.replace("<anonymous>", fn.displayName));
                      "function" === typeof fn && componentFrameCache.set(fn, _frame);
                      return _frame;
                    }
                  while (1 <= namePropDescriptor && 0 <= _RunInRootFrame$Deter);
                }
                break;
              }
          }
        } finally {
          reentry = false, ReactSharedInternals.H = previousDispatcher, reenableLogs(), Error.prepareStackTrace = frame;
        }
        sampleLines = (sampleLines = fn ? fn.displayName || fn.name : "") ? describeBuiltInComponentFrame(sampleLines) : "";
        "function" === typeof fn && componentFrameCache.set(fn, sampleLines);
        return sampleLines;
      }
      function describeUnknownElementTypeFrameInDEV(type) {
        if (null == type) return "";
        if ("function" === typeof type) {
          var prototype = type.prototype;
          return describeNativeComponentFrame(
            type,
            !(!prototype || !prototype.isReactComponent)
          );
        }
        if ("string" === typeof type) return describeBuiltInComponentFrame(type);
        switch (type) {
          case REACT_SUSPENSE_TYPE:
            return describeBuiltInComponentFrame("Suspense");
          case REACT_SUSPENSE_LIST_TYPE:
            return describeBuiltInComponentFrame("SuspenseList");
        }
        if ("object" === typeof type)
          switch (type.$$typeof) {
            case REACT_FORWARD_REF_TYPE:
              return type = describeNativeComponentFrame(type.render, false), type;
            case REACT_MEMO_TYPE:
              return describeUnknownElementTypeFrameInDEV(type.type);
            case REACT_LAZY_TYPE:
              prototype = type._payload;
              type = type._init;
              try {
                return describeUnknownElementTypeFrameInDEV(type(prototype));
              } catch (x) {
              }
          }
        return "";
      }
      function getOwner() {
        var dispatcher = ReactSharedInternals.A;
        return null === dispatcher ? null : dispatcher.getOwner();
      }
      function hasValidKey(config2) {
        if (hasOwnProperty.call(config2, "key")) {
          var getter = Object.getOwnPropertyDescriptor(config2, "key").get;
          if (getter && getter.isReactWarning) return false;
        }
        return void 0 !== config2.key;
      }
      function defineKeyPropWarningGetter(props, displayName) {
        function warnAboutAccessingKey() {
          specialPropKeyWarningShown || (specialPropKeyWarningShown = true, console.error(
            "%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://react.dev/link/special-props)",
            displayName
          ));
        }
        warnAboutAccessingKey.isReactWarning = true;
        Object.defineProperty(props, "key", {
          get: warnAboutAccessingKey,
          configurable: true
        });
      }
      function elementRefGetterWithDeprecationWarning() {
        var componentName = getComponentNameFromType(this.type);
        didWarnAboutElementRef[componentName] || (didWarnAboutElementRef[componentName] = true, console.error(
          "Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release."
        ));
        componentName = this.props.ref;
        return void 0 !== componentName ? componentName : null;
      }
      function ReactElement(type, key, self, source, owner, props) {
        self = props.ref;
        type = {
          $$typeof: REACT_ELEMENT_TYPE,
          type,
          key,
          props,
          _owner: owner
        };
        null !== (void 0 !== self ? self : null) ? Object.defineProperty(type, "ref", {
          enumerable: false,
          get: elementRefGetterWithDeprecationWarning
        }) : Object.defineProperty(type, "ref", { enumerable: false, value: null });
        type._store = {};
        Object.defineProperty(type._store, "validated", {
          configurable: false,
          enumerable: false,
          writable: true,
          value: 0
        });
        Object.defineProperty(type, "_debugInfo", {
          configurable: false,
          enumerable: false,
          writable: true,
          value: null
        });
        Object.freeze && (Object.freeze(type.props), Object.freeze(type));
        return type;
      }
      function cloneAndReplaceKey(oldElement, newKey) {
        newKey = ReactElement(
          oldElement.type,
          newKey,
          void 0,
          void 0,
          oldElement._owner,
          oldElement.props
        );
        newKey._store.validated = oldElement._store.validated;
        return newKey;
      }
      function validateChildKeys(node, parentType) {
        if ("object" === typeof node && node && node.$$typeof !== REACT_CLIENT_REFERENCE) {
          if (isArrayImpl(node))
            for (var i = 0; i < node.length; i++) {
              var child = node[i];
              isValidElement(child) && validateExplicitKey(child, parentType);
            }
          else if (isValidElement(node))
            node._store && (node._store.validated = 1);
          else if (i = getIteratorFn(node), "function" === typeof i && i !== node.entries && (i = i.call(node), i !== node))
            for (; !(node = i.next()).done; )
              isValidElement(node.value) && validateExplicitKey(node.value, parentType);
        }
      }
      function isValidElement(object) {
        return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
      }
      function validateExplicitKey(element, parentType) {
        if (element._store && !element._store.validated && null == element.key && (element._store.validated = 1, parentType = getCurrentComponentErrorInfo(parentType), !ownerHasKeyUseWarning[parentType])) {
          ownerHasKeyUseWarning[parentType] = true;
          var childOwner = "";
          element && null != element._owner && element._owner !== getOwner() && (childOwner = null, "number" === typeof element._owner.tag ? childOwner = getComponentNameFromType(element._owner.type) : "string" === typeof element._owner.name && (childOwner = element._owner.name), childOwner = " It was passed a child from " + childOwner + ".");
          var prevGetCurrentStack = ReactSharedInternals.getCurrentStack;
          ReactSharedInternals.getCurrentStack = function() {
            var stack = describeUnknownElementTypeFrameInDEV(element.type);
            prevGetCurrentStack && (stack += prevGetCurrentStack() || "");
            return stack;
          };
          console.error(
            'Each child in a list should have a unique "key" prop.%s%s See https://react.dev/link/warning-keys for more information.',
            parentType,
            childOwner
          );
          ReactSharedInternals.getCurrentStack = prevGetCurrentStack;
        }
      }
      function getCurrentComponentErrorInfo(parentType) {
        var info = "", owner = getOwner();
        owner && (owner = getComponentNameFromType(owner.type)) && (info = "\n\nCheck the render method of `" + owner + "`.");
        info || (parentType = getComponentNameFromType(parentType)) && (info = "\n\nCheck the top-level render call using <" + parentType + ">.");
        return info;
      }
      function escape2(key) {
        var escaperLookup = { "=": "=0", ":": "=2" };
        return "$" + key.replace(/[=:]/g, function(match) {
          return escaperLookup[match];
        });
      }
      function getElementKey(element, index) {
        return "object" === typeof element && null !== element && null != element.key ? (checkKeyStringCoercion(element.key), escape2("" + element.key)) : index.toString(36);
      }
      function noop$1() {
      }
      function resolveThenable(thenable) {
        switch (thenable.status) {
          case "fulfilled":
            return thenable.value;
          case "rejected":
            throw thenable.reason;
          default:
            switch ("string" === typeof thenable.status ? thenable.then(noop$1, noop$1) : (thenable.status = "pending", thenable.then(
              function(fulfilledValue) {
                "pending" === thenable.status && (thenable.status = "fulfilled", thenable.value = fulfilledValue);
              },
              function(error) {
                "pending" === thenable.status && (thenable.status = "rejected", thenable.reason = error);
              }
            )), thenable.status) {
              case "fulfilled":
                return thenable.value;
              case "rejected":
                throw thenable.reason;
            }
        }
        throw thenable;
      }
      function mapIntoArray(children, array, escapedPrefix, nameSoFar, callback) {
        var type = typeof children;
        if ("undefined" === type || "boolean" === type) children = null;
        var invokeCallback = false;
        if (null === children) invokeCallback = true;
        else
          switch (type) {
            case "bigint":
            case "string":
            case "number":
              invokeCallback = true;
              break;
            case "object":
              switch (children.$$typeof) {
                case REACT_ELEMENT_TYPE:
                case REACT_PORTAL_TYPE:
                  invokeCallback = true;
                  break;
                case REACT_LAZY_TYPE:
                  return invokeCallback = children._init, mapIntoArray(
                    invokeCallback(children._payload),
                    array,
                    escapedPrefix,
                    nameSoFar,
                    callback
                  );
              }
          }
        if (invokeCallback) {
          invokeCallback = children;
          callback = callback(invokeCallback);
          var childKey = "" === nameSoFar ? "." + getElementKey(invokeCallback, 0) : nameSoFar;
          isArrayImpl(callback) ? (escapedPrefix = "", null != childKey && (escapedPrefix = childKey.replace(userProvidedKeyEscapeRegex, "$&/") + "/"), mapIntoArray(callback, array, escapedPrefix, "", function(c) {
            return c;
          })) : null != callback && (isValidElement(callback) && (null != callback.key && (invokeCallback && invokeCallback.key === callback.key || checkKeyStringCoercion(callback.key)), escapedPrefix = cloneAndReplaceKey(
            callback,
            escapedPrefix + (null == callback.key || invokeCallback && invokeCallback.key === callback.key ? "" : ("" + callback.key).replace(
              userProvidedKeyEscapeRegex,
              "$&/"
            ) + "/") + childKey
          ), "" !== nameSoFar && null != invokeCallback && isValidElement(invokeCallback) && null == invokeCallback.key && invokeCallback._store && !invokeCallback._store.validated && (escapedPrefix._store.validated = 2), callback = escapedPrefix), array.push(callback));
          return 1;
        }
        invokeCallback = 0;
        childKey = "" === nameSoFar ? "." : nameSoFar + ":";
        if (isArrayImpl(children))
          for (var i = 0; i < children.length; i++)
            nameSoFar = children[i], type = childKey + getElementKey(nameSoFar, i), invokeCallback += mapIntoArray(
              nameSoFar,
              array,
              escapedPrefix,
              type,
              callback
            );
        else if (i = getIteratorFn(children), "function" === typeof i)
          for (i === children.entries && (didWarnAboutMaps || console.warn(
            "Using Maps as children is not supported. Use an array of keyed ReactElements instead."
          ), didWarnAboutMaps = true), children = i.call(children), i = 0; !(nameSoFar = children.next()).done; )
            nameSoFar = nameSoFar.value, type = childKey + getElementKey(nameSoFar, i++), invokeCallback += mapIntoArray(
              nameSoFar,
              array,
              escapedPrefix,
              type,
              callback
            );
        else if ("object" === type) {
          if ("function" === typeof children.then)
            return mapIntoArray(
              resolveThenable(children),
              array,
              escapedPrefix,
              nameSoFar,
              callback
            );
          array = String(children);
          throw Error(
            "Objects are not valid as a React child (found: " + ("[object Object]" === array ? "object with keys {" + Object.keys(children).join(", ") + "}" : array) + "). If you meant to render a collection of children, use an array instead."
          );
        }
        return invokeCallback;
      }
      function mapChildren(children, func, context) {
        if (null == children) return children;
        var result = [], count = 0;
        mapIntoArray(children, result, "", "", function(child) {
          return func.call(context, child, count++);
        });
        return result;
      }
      function lazyInitializer(payload) {
        if (-1 === payload._status) {
          var ctor = payload._result;
          ctor = ctor();
          ctor.then(
            function(moduleObject) {
              if (0 === payload._status || -1 === payload._status)
                payload._status = 1, payload._result = moduleObject;
            },
            function(error) {
              if (0 === payload._status || -1 === payload._status)
                payload._status = 2, payload._result = error;
            }
          );
          -1 === payload._status && (payload._status = 0, payload._result = ctor);
        }
        if (1 === payload._status)
          return ctor = payload._result, void 0 === ctor && console.error(
            "lazy: Expected the result of a dynamic import() call. Instead received: %s\n\nYour code should look like: \n  const MyComponent = lazy(() => import('./MyComponent'))\n\nDid you accidentally put curly braces around the import?",
            ctor
          ), "default" in ctor || console.error(
            "lazy: Expected the result of a dynamic import() call. Instead received: %s\n\nYour code should look like: \n  const MyComponent = lazy(() => import('./MyComponent'))",
            ctor
          ), ctor.default;
        throw payload._result;
      }
      function resolveDispatcher() {
        var dispatcher = ReactSharedInternals.H;
        null === dispatcher && console.error(
          "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem."
        );
        return dispatcher;
      }
      function noop() {
      }
      function enqueueTask(task) {
        if (null === enqueueTaskImpl)
          try {
            var requireString = ("require" + Math.random()).slice(0, 7);
            enqueueTaskImpl = (module2 && module2[requireString]).call(
              module2,
              "timers"
            ).setImmediate;
          } catch (_err) {
            enqueueTaskImpl = function(callback) {
              false === didWarnAboutMessageChannel && (didWarnAboutMessageChannel = true, "undefined" === typeof MessageChannel && console.error(
                "This browser does not have a MessageChannel implementation, so enqueuing tasks via await act(async () => ...) will fail. Please file an issue at https://github.com/facebook/react/issues if you encounter this warning."
              ));
              var channel = new MessageChannel();
              channel.port1.onmessage = callback;
              channel.port2.postMessage(void 0);
            };
          }
        return enqueueTaskImpl(task);
      }
      function aggregateErrors(errors) {
        return 1 < errors.length && "function" === typeof AggregateError ? new AggregateError(errors) : errors[0];
      }
      function popActScope(prevActQueue, prevActScopeDepth) {
        prevActScopeDepth !== actScopeDepth - 1 && console.error(
          "You seem to have overlapping act() calls, this is not supported. Be sure to await previous act() calls before making a new one. "
        );
        actScopeDepth = prevActScopeDepth;
      }
      function recursivelyFlushAsyncActWork(returnValue, resolve8, reject2) {
        var queue = ReactSharedInternals.actQueue;
        if (null !== queue)
          if (0 !== queue.length)
            try {
              flushActQueue(queue);
              enqueueTask(function() {
                return recursivelyFlushAsyncActWork(returnValue, resolve8, reject2);
              });
              return;
            } catch (error) {
              ReactSharedInternals.thrownErrors.push(error);
            }
          else ReactSharedInternals.actQueue = null;
        0 < ReactSharedInternals.thrownErrors.length ? (queue = aggregateErrors(ReactSharedInternals.thrownErrors), ReactSharedInternals.thrownErrors.length = 0, reject2(queue)) : resolve8(returnValue);
      }
      function flushActQueue(queue) {
        if (!isFlushing) {
          isFlushing = true;
          var i = 0;
          try {
            for (; i < queue.length; i++) {
              var callback = queue[i];
              do {
                ReactSharedInternals.didUsePromise = false;
                var continuation = callback(false);
                if (null !== continuation) {
                  if (ReactSharedInternals.didUsePromise) {
                    queue[i] = callback;
                    queue.splice(0, i);
                    return;
                  }
                  callback = continuation;
                } else break;
              } while (1);
            }
            queue.length = 0;
          } catch (error) {
            queue.splice(0, i + 1), ReactSharedInternals.thrownErrors.push(error);
          } finally {
            isFlushing = false;
          }
        }
      }
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
      var REACT_ELEMENT_TYPE = /* @__PURE__ */ Symbol.for("react.transitional.element"), REACT_PORTAL_TYPE = /* @__PURE__ */ Symbol.for("react.portal"), REACT_FRAGMENT_TYPE = /* @__PURE__ */ Symbol.for("react.fragment"), REACT_STRICT_MODE_TYPE = /* @__PURE__ */ Symbol.for("react.strict_mode"), REACT_PROFILER_TYPE = /* @__PURE__ */ Symbol.for("react.profiler");
      /* @__PURE__ */ Symbol.for("react.provider");
      var REACT_CONSUMER_TYPE = /* @__PURE__ */ Symbol.for("react.consumer"), REACT_CONTEXT_TYPE = /* @__PURE__ */ Symbol.for("react.context"), REACT_FORWARD_REF_TYPE = /* @__PURE__ */ Symbol.for("react.forward_ref"), REACT_SUSPENSE_TYPE = /* @__PURE__ */ Symbol.for("react.suspense"), REACT_SUSPENSE_LIST_TYPE = /* @__PURE__ */ Symbol.for("react.suspense_list"), REACT_MEMO_TYPE = /* @__PURE__ */ Symbol.for("react.memo"), REACT_LAZY_TYPE = /* @__PURE__ */ Symbol.for("react.lazy"), REACT_OFFSCREEN_TYPE = /* @__PURE__ */ Symbol.for("react.offscreen"), MAYBE_ITERATOR_SYMBOL = Symbol.iterator, didWarnStateUpdateForUnmountedComponent = {}, ReactNoopUpdateQueue = {
        isMounted: function() {
          return false;
        },
        enqueueForceUpdate: function(publicInstance) {
          warnNoop(publicInstance, "forceUpdate");
        },
        enqueueReplaceState: function(publicInstance) {
          warnNoop(publicInstance, "replaceState");
        },
        enqueueSetState: function(publicInstance) {
          warnNoop(publicInstance, "setState");
        }
      }, assign = Object.assign, emptyObject = {};
      Object.freeze(emptyObject);
      Component.prototype.isReactComponent = {};
      Component.prototype.setState = function(partialState, callback) {
        if ("object" !== typeof partialState && "function" !== typeof partialState && null != partialState)
          throw Error(
            "takes an object of state variables to update or a function which returns an object of state variables."
          );
        this.updater.enqueueSetState(this, partialState, callback, "setState");
      };
      Component.prototype.forceUpdate = function(callback) {
        this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
      };
      var deprecatedAPIs = {
        isMounted: [
          "isMounted",
          "Instead, make sure to clean up subscriptions and pending requests in componentWillUnmount to prevent memory leaks."
        ],
        replaceState: [
          "replaceState",
          "Refactor your code to use setState instead (see https://github.com/facebook/react/issues/3236)."
        ]
      }, fnName;
      for (fnName in deprecatedAPIs)
        deprecatedAPIs.hasOwnProperty(fnName) && defineDeprecationWarning(fnName, deprecatedAPIs[fnName]);
      ComponentDummy.prototype = Component.prototype;
      deprecatedAPIs = PureComponent.prototype = new ComponentDummy();
      deprecatedAPIs.constructor = PureComponent;
      assign(deprecatedAPIs, Component.prototype);
      deprecatedAPIs.isPureReactComponent = true;
      var isArrayImpl = Array.isArray, REACT_CLIENT_REFERENCE$2 = /* @__PURE__ */ Symbol.for("react.client.reference"), ReactSharedInternals = {
        H: null,
        A: null,
        T: null,
        S: null,
        actQueue: null,
        isBatchingLegacy: false,
        didScheduleLegacyUpdate: false,
        didUsePromise: false,
        thrownErrors: [],
        getCurrentStack: null
      }, hasOwnProperty = Object.prototype.hasOwnProperty, REACT_CLIENT_REFERENCE$1 = /* @__PURE__ */ Symbol.for("react.client.reference"), disabledDepth = 0, prevLog, prevInfo, prevWarn, prevError, prevGroup, prevGroupCollapsed, prevGroupEnd;
      disabledLog.__reactDisabledLog = true;
      var prefix, suffix, reentry = false;
      var componentFrameCache = new ("function" === typeof WeakMap ? WeakMap : Map)();
      var REACT_CLIENT_REFERENCE = /* @__PURE__ */ Symbol.for("react.client.reference"), specialPropKeyWarningShown, didWarnAboutOldJSXRuntime;
      var didWarnAboutElementRef = {};
      var ownerHasKeyUseWarning = {}, didWarnAboutMaps = false, userProvidedKeyEscapeRegex = /\/+/g, reportGlobalError = "function" === typeof reportError ? reportError : function(error) {
        if ("object" === typeof window && "function" === typeof window.ErrorEvent) {
          var event = new window.ErrorEvent("error", {
            bubbles: true,
            cancelable: true,
            message: "object" === typeof error && null !== error && "string" === typeof error.message ? String(error.message) : String(error),
            error
          });
          if (!window.dispatchEvent(event)) return;
        } else if ("object" === typeof process && "function" === typeof process.emit) {
          process.emit("uncaughtException", error);
          return;
        }
        console.error(error);
      }, didWarnAboutMessageChannel = false, enqueueTaskImpl = null, actScopeDepth = 0, didWarnNoAwaitAct = false, isFlushing = false, queueSeveralMicrotasks = "function" === typeof queueMicrotask ? function(callback) {
        queueMicrotask(function() {
          return queueMicrotask(callback);
        });
      } : enqueueTask;
      exports2.Children = {
        map: mapChildren,
        forEach: function(children, forEachFunc, forEachContext) {
          mapChildren(
            children,
            function() {
              forEachFunc.apply(this, arguments);
            },
            forEachContext
          );
        },
        count: function(children) {
          var n = 0;
          mapChildren(children, function() {
            n++;
          });
          return n;
        },
        toArray: function(children) {
          return mapChildren(children, function(child) {
            return child;
          }) || [];
        },
        only: function(children) {
          if (!isValidElement(children))
            throw Error(
              "React.Children.only expected to receive a single React element child."
            );
          return children;
        }
      };
      exports2.Component = Component;
      exports2.Fragment = REACT_FRAGMENT_TYPE;
      exports2.Profiler = REACT_PROFILER_TYPE;
      exports2.PureComponent = PureComponent;
      exports2.StrictMode = REACT_STRICT_MODE_TYPE;
      exports2.Suspense = REACT_SUSPENSE_TYPE;
      exports2.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = ReactSharedInternals;
      exports2.act = function(callback) {
        var prevActQueue = ReactSharedInternals.actQueue, prevActScopeDepth = actScopeDepth;
        actScopeDepth++;
        var queue = ReactSharedInternals.actQueue = null !== prevActQueue ? prevActQueue : [], didAwaitActCall = false;
        try {
          var result = callback();
        } catch (error) {
          ReactSharedInternals.thrownErrors.push(error);
        }
        if (0 < ReactSharedInternals.thrownErrors.length)
          throw popActScope(prevActQueue, prevActScopeDepth), callback = aggregateErrors(ReactSharedInternals.thrownErrors), ReactSharedInternals.thrownErrors.length = 0, callback;
        if (null !== result && "object" === typeof result && "function" === typeof result.then) {
          var thenable = result;
          queueSeveralMicrotasks(function() {
            didAwaitActCall || didWarnNoAwaitAct || (didWarnNoAwaitAct = true, console.error(
              "You called act(async () => ...) without await. This could lead to unexpected testing behaviour, interleaving multiple act calls and mixing their scopes. You should - await act(async () => ...);"
            ));
          });
          return {
            then: function(resolve8, reject2) {
              didAwaitActCall = true;
              thenable.then(
                function(returnValue) {
                  popActScope(prevActQueue, prevActScopeDepth);
                  if (0 === prevActScopeDepth) {
                    try {
                      flushActQueue(queue), enqueueTask(function() {
                        return recursivelyFlushAsyncActWork(
                          returnValue,
                          resolve8,
                          reject2
                        );
                      });
                    } catch (error$2) {
                      ReactSharedInternals.thrownErrors.push(error$2);
                    }
                    if (0 < ReactSharedInternals.thrownErrors.length) {
                      var _thrownError = aggregateErrors(
                        ReactSharedInternals.thrownErrors
                      );
                      ReactSharedInternals.thrownErrors.length = 0;
                      reject2(_thrownError);
                    }
                  } else resolve8(returnValue);
                },
                function(error) {
                  popActScope(prevActQueue, prevActScopeDepth);
                  0 < ReactSharedInternals.thrownErrors.length ? (error = aggregateErrors(
                    ReactSharedInternals.thrownErrors
                  ), ReactSharedInternals.thrownErrors.length = 0, reject2(error)) : reject2(error);
                }
              );
            }
          };
        }
        var returnValue$jscomp$0 = result;
        popActScope(prevActQueue, prevActScopeDepth);
        0 === prevActScopeDepth && (flushActQueue(queue), 0 !== queue.length && queueSeveralMicrotasks(function() {
          didAwaitActCall || didWarnNoAwaitAct || (didWarnNoAwaitAct = true, console.error(
            "A component suspended inside an `act` scope, but the `act` call was not awaited. When testing React components that depend on asynchronous data, you must await the result:\n\nawait act(() => ...)"
          ));
        }), ReactSharedInternals.actQueue = null);
        if (0 < ReactSharedInternals.thrownErrors.length)
          throw callback = aggregateErrors(ReactSharedInternals.thrownErrors), ReactSharedInternals.thrownErrors.length = 0, callback;
        return {
          then: function(resolve8, reject2) {
            didAwaitActCall = true;
            0 === prevActScopeDepth ? (ReactSharedInternals.actQueue = queue, enqueueTask(function() {
              return recursivelyFlushAsyncActWork(
                returnValue$jscomp$0,
                resolve8,
                reject2
              );
            })) : resolve8(returnValue$jscomp$0);
          }
        };
      };
      exports2.cache = function(fn) {
        return function() {
          return fn.apply(null, arguments);
        };
      };
      exports2.cloneElement = function(element, config2, children) {
        if (null === element || void 0 === element)
          throw Error(
            "The argument must be a React element, but you passed " + element + "."
          );
        var props = assign({}, element.props), key = element.key, owner = element._owner;
        if (null != config2) {
          var JSCompiler_inline_result;
          a: {
            if (hasOwnProperty.call(config2, "ref") && (JSCompiler_inline_result = Object.getOwnPropertyDescriptor(
              config2,
              "ref"
            ).get) && JSCompiler_inline_result.isReactWarning) {
              JSCompiler_inline_result = false;
              break a;
            }
            JSCompiler_inline_result = void 0 !== config2.ref;
          }
          JSCompiler_inline_result && (owner = getOwner());
          hasValidKey(config2) && (checkKeyStringCoercion(config2.key), key = "" + config2.key);
          for (propName in config2)
            !hasOwnProperty.call(config2, propName) || "key" === propName || "__self" === propName || "__source" === propName || "ref" === propName && void 0 === config2.ref || (props[propName] = config2[propName]);
        }
        var propName = arguments.length - 2;
        if (1 === propName) props.children = children;
        else if (1 < propName) {
          JSCompiler_inline_result = Array(propName);
          for (var i = 0; i < propName; i++)
            JSCompiler_inline_result[i] = arguments[i + 2];
          props.children = JSCompiler_inline_result;
        }
        props = ReactElement(element.type, key, void 0, void 0, owner, props);
        for (key = 2; key < arguments.length; key++)
          validateChildKeys(arguments[key], props.type);
        return props;
      };
      exports2.createContext = function(defaultValue) {
        defaultValue = {
          $$typeof: REACT_CONTEXT_TYPE,
          _currentValue: defaultValue,
          _currentValue2: defaultValue,
          _threadCount: 0,
          Provider: null,
          Consumer: null
        };
        defaultValue.Provider = defaultValue;
        defaultValue.Consumer = {
          $$typeof: REACT_CONSUMER_TYPE,
          _context: defaultValue
        };
        defaultValue._currentRenderer = null;
        defaultValue._currentRenderer2 = null;
        return defaultValue;
      };
      exports2.createElement = function(type, config2, children) {
        if (isValidElementType(type))
          for (var i = 2; i < arguments.length; i++)
            validateChildKeys(arguments[i], type);
        else {
          i = "";
          if (void 0 === type || "object" === typeof type && null !== type && 0 === Object.keys(type).length)
            i += " You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports.";
          if (null === type) var typeString = "null";
          else
            isArrayImpl(type) ? typeString = "array" : void 0 !== type && type.$$typeof === REACT_ELEMENT_TYPE ? (typeString = "<" + (getComponentNameFromType(type.type) || "Unknown") + " />", i = " Did you accidentally export a JSX literal instead of a component?") : typeString = typeof type;
          console.error(
            "React.createElement: type is invalid -- expected a string (for built-in components) or a class/function (for composite components) but got: %s.%s",
            typeString,
            i
          );
        }
        var propName;
        i = {};
        typeString = null;
        if (null != config2)
          for (propName in didWarnAboutOldJSXRuntime || !("__self" in config2) || "key" in config2 || (didWarnAboutOldJSXRuntime = true, console.warn(
            "Your app (or one of its dependencies) is using an outdated JSX transform. Update to the modern JSX transform for faster performance: https://react.dev/link/new-jsx-transform"
          )), hasValidKey(config2) && (checkKeyStringCoercion(config2.key), typeString = "" + config2.key), config2)
            hasOwnProperty.call(config2, propName) && "key" !== propName && "__self" !== propName && "__source" !== propName && (i[propName] = config2[propName]);
        var childrenLength = arguments.length - 2;
        if (1 === childrenLength) i.children = children;
        else if (1 < childrenLength) {
          for (var childArray = Array(childrenLength), _i = 0; _i < childrenLength; _i++)
            childArray[_i] = arguments[_i + 2];
          Object.freeze && Object.freeze(childArray);
          i.children = childArray;
        }
        if (type && type.defaultProps)
          for (propName in childrenLength = type.defaultProps, childrenLength)
            void 0 === i[propName] && (i[propName] = childrenLength[propName]);
        typeString && defineKeyPropWarningGetter(
          i,
          "function" === typeof type ? type.displayName || type.name || "Unknown" : type
        );
        return ReactElement(type, typeString, void 0, void 0, getOwner(), i);
      };
      exports2.createRef = function() {
        var refObject = { current: null };
        Object.seal(refObject);
        return refObject;
      };
      exports2.forwardRef = function(render) {
        null != render && render.$$typeof === REACT_MEMO_TYPE ? console.error(
          "forwardRef requires a render function but received a `memo` component. Instead of forwardRef(memo(...)), use memo(forwardRef(...))."
        ) : "function" !== typeof render ? console.error(
          "forwardRef requires a render function but was given %s.",
          null === render ? "null" : typeof render
        ) : 0 !== render.length && 2 !== render.length && console.error(
          "forwardRef render functions accept exactly two parameters: props and ref. %s",
          1 === render.length ? "Did you forget to use the ref parameter?" : "Any additional parameter will be undefined."
        );
        null != render && null != render.defaultProps && console.error(
          "forwardRef render functions do not support defaultProps. Did you accidentally pass a React component?"
        );
        var elementType = { $$typeof: REACT_FORWARD_REF_TYPE, render }, ownName;
        Object.defineProperty(elementType, "displayName", {
          enumerable: false,
          configurable: true,
          get: function() {
            return ownName;
          },
          set: function(name) {
            ownName = name;
            render.name || render.displayName || (Object.defineProperty(render, "name", { value: name }), render.displayName = name);
          }
        });
        return elementType;
      };
      exports2.isValidElement = isValidElement;
      exports2.lazy = function(ctor) {
        return {
          $$typeof: REACT_LAZY_TYPE,
          _payload: { _status: -1, _result: ctor },
          _init: lazyInitializer
        };
      };
      exports2.memo = function(type, compare) {
        isValidElementType(type) || console.error(
          "memo: The first argument must be a component. Instead received: %s",
          null === type ? "null" : typeof type
        );
        compare = {
          $$typeof: REACT_MEMO_TYPE,
          type,
          compare: void 0 === compare ? null : compare
        };
        var ownName;
        Object.defineProperty(compare, "displayName", {
          enumerable: false,
          configurable: true,
          get: function() {
            return ownName;
          },
          set: function(name) {
            ownName = name;
            type.name || type.displayName || (Object.defineProperty(type, "name", { value: name }), type.displayName = name);
          }
        });
        return compare;
      };
      exports2.startTransition = function(scope) {
        var prevTransition = ReactSharedInternals.T, currentTransition = {};
        ReactSharedInternals.T = currentTransition;
        currentTransition._updatedFibers = /* @__PURE__ */ new Set();
        try {
          var returnValue = scope(), onStartTransitionFinish = ReactSharedInternals.S;
          null !== onStartTransitionFinish && onStartTransitionFinish(currentTransition, returnValue);
          "object" === typeof returnValue && null !== returnValue && "function" === typeof returnValue.then && returnValue.then(noop, reportGlobalError);
        } catch (error) {
          reportGlobalError(error);
        } finally {
          null === prevTransition && currentTransition._updatedFibers && (scope = currentTransition._updatedFibers.size, currentTransition._updatedFibers.clear(), 10 < scope && console.warn(
            "Detected a large number of updates inside startTransition. If this is due to a subscription please re-write it to use React provided hooks. Otherwise concurrent mode guarantees are off the table."
          )), ReactSharedInternals.T = prevTransition;
        }
      };
      exports2.unstable_useCacheRefresh = function() {
        return resolveDispatcher().useCacheRefresh();
      };
      exports2.use = function(usable) {
        return resolveDispatcher().use(usable);
      };
      exports2.useActionState = function(action, initialState, permalink) {
        return resolveDispatcher().useActionState(
          action,
          initialState,
          permalink
        );
      };
      exports2.useCallback = function(callback, deps) {
        return resolveDispatcher().useCallback(callback, deps);
      };
      exports2.useContext = function(Context) {
        var dispatcher = resolveDispatcher();
        Context.$$typeof === REACT_CONSUMER_TYPE && console.error(
          "Calling useContext(Context.Consumer) is not supported and will cause bugs. Did you mean to call useContext(Context) instead?"
        );
        return dispatcher.useContext(Context);
      };
      exports2.useDebugValue = function(value2, formatterFn) {
        return resolveDispatcher().useDebugValue(value2, formatterFn);
      };
      exports2.useDeferredValue = function(value2, initialValue) {
        return resolveDispatcher().useDeferredValue(value2, initialValue);
      };
      exports2.useEffect = function(create, deps) {
        return resolveDispatcher().useEffect(create, deps);
      };
      exports2.useId = function() {
        return resolveDispatcher().useId();
      };
      exports2.useImperativeHandle = function(ref, create, deps) {
        return resolveDispatcher().useImperativeHandle(ref, create, deps);
      };
      exports2.useInsertionEffect = function(create, deps) {
        return resolveDispatcher().useInsertionEffect(create, deps);
      };
      exports2.useLayoutEffect = function(create, deps) {
        return resolveDispatcher().useLayoutEffect(create, deps);
      };
      exports2.useMemo = function(create, deps) {
        return resolveDispatcher().useMemo(create, deps);
      };
      exports2.useOptimistic = function(passthrough, reducer) {
        return resolveDispatcher().useOptimistic(passthrough, reducer);
      };
      exports2.useReducer = function(reducer, initialArg, init) {
        return resolveDispatcher().useReducer(reducer, initialArg, init);
      };
      exports2.useRef = function(initialValue) {
        return resolveDispatcher().useRef(initialValue);
      };
      exports2.useState = function(initialState) {
        return resolveDispatcher().useState(initialState);
      };
      exports2.useSyncExternalStore = function(subscribe, getSnapshot, getServerSnapshot) {
        return resolveDispatcher().useSyncExternalStore(
          subscribe,
          getSnapshot,
          getServerSnapshot
        );
      };
      exports2.useTransition = function() {
        return resolveDispatcher().useTransition();
      };
      exports2.version = "19.0.0";
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
    })();
  }
});

// node_modules/react/index.js
var require_react = __commonJS({
  "node_modules/react/index.js"(exports2, module2) {
    "use strict";
    if (process.env.NODE_ENV === "production") {
      module2.exports = require_react_production();
    } else {
      module2.exports = require_react_development();
    }
  }
});

// node_modules/next/dist/client/components/hooks-server-context.js
var require_hooks_server_context = __commonJS({
  "node_modules/next/dist/client/components/hooks-server-context.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      DynamicServerError: function() {
        return DynamicServerError;
      },
      isDynamicServerError: function() {
        return isDynamicServerError;
      }
    });
    var DYNAMIC_ERROR_CODE = "DYNAMIC_SERVER_USAGE";
    var DynamicServerError = class extends Error {
      constructor(description) {
        super(`Dynamic server usage: ${description}`), this.description = description, this.digest = DYNAMIC_ERROR_CODE;
      }
    };
    function isDynamicServerError(err) {
      if (typeof err !== "object" || err === null || !("digest" in err) || typeof err.digest !== "string") {
        return false;
      }
      return err.digest === DYNAMIC_ERROR_CODE;
    }
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// node_modules/next/dist/client/components/static-generation-bailout.js
var require_static_generation_bailout = __commonJS({
  "node_modules/next/dist/client/components/static-generation-bailout.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      StaticGenBailoutError: function() {
        return StaticGenBailoutError;
      },
      isStaticGenBailoutError: function() {
        return isStaticGenBailoutError;
      }
    });
    var NEXT_STATIC_GEN_BAILOUT = "NEXT_STATIC_GEN_BAILOUT";
    var StaticGenBailoutError = class extends Error {
      constructor(...args) {
        super(...args), this.code = NEXT_STATIC_GEN_BAILOUT;
      }
    };
    function isStaticGenBailoutError(error) {
      if (typeof error !== "object" || error === null || !("code" in error)) {
        return false;
      }
      return error.code === NEXT_STATIC_GEN_BAILOUT;
    }
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// node_modules/next/dist/server/dynamic-rendering-utils.js
var require_dynamic_rendering_utils = __commonJS({
  "node_modules/next/dist/server/dynamic-rendering-utils.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      delayUntilRuntimeStage: function() {
        return delayUntilRuntimeStage;
      },
      getRuntimeStage: function() {
        return getRuntimeStage;
      },
      isHangingPromiseRejectionError: function() {
        return isHangingPromiseRejectionError;
      },
      makeDevtoolsIOAwarePromise: function() {
        return makeDevtoolsIOAwarePromise;
      },
      makeHangingPromise: function() {
        return makeHangingPromise;
      }
    });
    var _stagedrendering = require_staged_rendering();
    function isHangingPromiseRejectionError(err) {
      if (typeof err !== "object" || err === null || !("digest" in err)) {
        return false;
      }
      return err.digest === HANGING_PROMISE_REJECTION;
    }
    var HANGING_PROMISE_REJECTION = "HANGING_PROMISE_REJECTION";
    var HangingPromiseRejectionError = class extends Error {
      constructor(route, expression) {
        super(`During prerendering, ${expression} rejects when the prerender is complete. Typically these errors are handled by React but if you move ${expression} to a different context by using \`setTimeout\`, \`after\`, or similar functions you may observe this error and you should handle it in that context. This occurred at route "${route}".`), this.route = route, this.expression = expression, this.digest = HANGING_PROMISE_REJECTION;
      }
    };
    var abortListenersBySignal = /* @__PURE__ */ new WeakMap();
    function makeHangingPromise(signal, route, expression) {
      if (signal.aborted) {
        return Promise.reject(new HangingPromiseRejectionError(route, expression));
      } else {
        const hangingPromise = new Promise((_, reject2) => {
          const boundRejection = reject2.bind(null, new HangingPromiseRejectionError(route, expression));
          let currentListeners = abortListenersBySignal.get(signal);
          if (currentListeners) {
            currentListeners.push(boundRejection);
          } else {
            const listeners = [
              boundRejection
            ];
            abortListenersBySignal.set(signal, listeners);
            signal.addEventListener("abort", () => {
              for (let i = 0; i < listeners.length; i++) {
                listeners[i]();
              }
            }, {
              once: true
            });
          }
        });
        hangingPromise.catch(ignoreReject);
        return hangingPromise;
      }
    }
    function ignoreReject() {
    }
    function makeDevtoolsIOAwarePromise(underlying, requestStore, stage) {
      if (requestStore.stagedRendering) {
        return requestStore.stagedRendering.delayUntilStage(stage, void 0, underlying);
      }
      return new Promise((resolve8) => {
        setTimeout(() => {
          resolve8(underlying);
        }, 0);
      });
    }
    function getRuntimeStage(stagedRendering) {
      if (stagedRendering.currentStage === _stagedrendering.RenderStage.EarlyStatic || stagedRendering.currentStage === _stagedrendering.RenderStage.EarlyRuntime) {
        return _stagedrendering.RenderStage.EarlyRuntime;
      }
      return _stagedrendering.RenderStage.Runtime;
    }
    function delayUntilRuntimeStage(prerenderStore, result) {
      const { stagedRendering } = prerenderStore;
      if (!stagedRendering) {
        return result;
      }
      return stagedRendering.waitForStage(getRuntimeStage(stagedRendering)).then(() => result);
    }
  }
});

// node_modules/next/dist/lib/framework/boundary-constants.js
var require_boundary_constants = __commonJS({
  "node_modules/next/dist/lib/framework/boundary-constants.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      METADATA_BOUNDARY_NAME: function() {
        return METADATA_BOUNDARY_NAME;
      },
      OUTLET_BOUNDARY_NAME: function() {
        return OUTLET_BOUNDARY_NAME;
      },
      ROOT_LAYOUT_BOUNDARY_NAME: function() {
        return ROOT_LAYOUT_BOUNDARY_NAME;
      },
      VIEWPORT_BOUNDARY_NAME: function() {
        return VIEWPORT_BOUNDARY_NAME;
      }
    });
    var METADATA_BOUNDARY_NAME = "__next_metadata_boundary__";
    var VIEWPORT_BOUNDARY_NAME = "__next_viewport_boundary__";
    var OUTLET_BOUNDARY_NAME = "__next_outlet_boundary__";
    var ROOT_LAYOUT_BOUNDARY_NAME = "__next_root_layout_boundary__";
  }
});

// node_modules/next/dist/lib/scheduler.js
var require_scheduler = __commonJS({
  "node_modules/next/dist/lib/scheduler.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      atLeastOneTask: function() {
        return atLeastOneTask;
      },
      scheduleImmediate: function() {
        return scheduleImmediate;
      },
      scheduleOnNextTick: function() {
        return scheduleOnNextTick;
      },
      waitAtLeastOneReactRenderTask: function() {
        return waitAtLeastOneReactRenderTask;
      }
    });
    var scheduleOnNextTick = (cb) => {
      Promise.resolve().then(() => {
        if (process.env.NEXT_RUNTIME === "edge") {
          setTimeout(cb, 0);
        } else {
          process.nextTick(cb);
        }
      });
    };
    var scheduleImmediate = (cb) => {
      if (process.env.NEXT_RUNTIME === "edge") {
        setTimeout(cb, 0);
      } else {
        setImmediate(cb);
      }
    };
    function atLeastOneTask() {
      return new Promise((resolve8) => scheduleImmediate(resolve8));
    }
    function waitAtLeastOneReactRenderTask() {
      if (process.env.NEXT_RUNTIME === "edge") {
        return new Promise((r) => setTimeout(r, 0));
      } else {
        return new Promise((r) => setImmediate(r));
      }
    }
  }
});

// node_modules/next/dist/shared/lib/lazy-dynamic/bailout-to-csr.js
var require_bailout_to_csr = __commonJS({
  "node_modules/next/dist/shared/lib/lazy-dynamic/bailout-to-csr.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      BailoutToCSRError: function() {
        return BailoutToCSRError;
      },
      isBailoutToCSRError: function() {
        return isBailoutToCSRError;
      }
    });
    var BAILOUT_TO_CSR = "BAILOUT_TO_CLIENT_SIDE_RENDERING";
    var BailoutToCSRError = class extends Error {
      constructor(reason) {
        super(`Bail out to client-side rendering: ${reason}`), this.reason = reason, this.digest = BAILOUT_TO_CSR;
      }
    };
    function isBailoutToCSRError(err) {
      if (typeof err !== "object" || err === null || !("digest" in err)) {
        return false;
      }
      return err.digest === BAILOUT_TO_CSR;
    }
  }
});

// node_modules/next/dist/server/app-render/instant-validation/boundary-constants.js
var require_boundary_constants2 = __commonJS({
  "node_modules/next/dist/server/app-render/instant-validation/boundary-constants.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "INSTANT_VALIDATION_BOUNDARY_NAME", {
      enumerable: true,
      get: function() {
        return INSTANT_VALIDATION_BOUNDARY_NAME;
      }
    });
    var INSTANT_VALIDATION_BOUNDARY_NAME = "__next_instant_validation_boundary__";
  }
});

// node_modules/next/dist/server/app-render/dynamic-rendering.js
var require_dynamic_rendering = __commonJS({
  "node_modules/next/dist/server/app-render/dynamic-rendering.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      DynamicHoleKind: function() {
        return DynamicHoleKind;
      },
      Postpone: function() {
        return Postpone;
      },
      PreludeState: function() {
        return PreludeState;
      },
      abortAndThrowOnSynchronousRequestDataAccess: function() {
        return abortAndThrowOnSynchronousRequestDataAccess;
      },
      abortOnSynchronousPlatformIOAccess: function() {
        return abortOnSynchronousPlatformIOAccess;
      },
      accessedDynamicData: function() {
        return accessedDynamicData;
      },
      annotateDynamicAccess: function() {
        return annotateDynamicAccess;
      },
      consumeDynamicAccess: function() {
        return consumeDynamicAccess;
      },
      createDynamicTrackingState: function() {
        return createDynamicTrackingState;
      },
      createDynamicValidationState: function() {
        return createDynamicValidationState;
      },
      createHangingInputAbortSignal: function() {
        return createHangingInputAbortSignal;
      },
      createInstantValidationState: function() {
        return createInstantValidationState;
      },
      createRenderInBrowserAbortSignal: function() {
        return createRenderInBrowserAbortSignal;
      },
      formatDynamicAPIAccesses: function() {
        return formatDynamicAPIAccesses;
      },
      getFirstDynamicReason: function() {
        return getFirstDynamicReason;
      },
      getNavigationDisallowedDynamicReasons: function() {
        return getNavigationDisallowedDynamicReasons;
      },
      getStaticShellDisallowedDynamicReasons: function() {
        return getStaticShellDisallowedDynamicReasons;
      },
      isDynamicPostpone: function() {
        return isDynamicPostpone;
      },
      isPrerenderInterruptedError: function() {
        return isPrerenderInterruptedError;
      },
      logDisallowedDynamicError: function() {
        return logDisallowedDynamicError;
      },
      markCurrentScopeAsDynamic: function() {
        return markCurrentScopeAsDynamic;
      },
      postponeWithTracking: function() {
        return postponeWithTracking;
      },
      throwIfDisallowedDynamic: function() {
        return throwIfDisallowedDynamic;
      },
      throwToInterruptStaticGeneration: function() {
        return throwToInterruptStaticGeneration;
      },
      trackAllowedDynamicAccess: function() {
        return trackAllowedDynamicAccess;
      },
      trackDynamicDataInDynamicRender: function() {
        return trackDynamicDataInDynamicRender;
      },
      trackDynamicHoleInNavigation: function() {
        return trackDynamicHoleInNavigation;
      },
      trackDynamicHoleInRuntimeShell: function() {
        return trackDynamicHoleInRuntimeShell;
      },
      trackDynamicHoleInStaticShell: function() {
        return trackDynamicHoleInStaticShell;
      },
      trackThrownErrorInNavigation: function() {
        return trackThrownErrorInNavigation;
      },
      useDynamicRouteParams: function() {
        return useDynamicRouteParams;
      },
      useDynamicSearchParams: function() {
        return useDynamicSearchParams;
      }
    });
    var _react = /* @__PURE__ */ _interop_require_default(require_react());
    var _hooksservercontext = require_hooks_server_context();
    var _staticgenerationbailout = require_static_generation_bailout();
    var _workunitasyncstorageexternal = require_work_unit_async_storage_external();
    var _workasyncstorageexternal = require_work_async_storage_external();
    var _dynamicrenderingutils = require_dynamic_rendering_utils();
    var _boundaryconstants = require_boundary_constants();
    var _scheduler = require_scheduler();
    var _bailouttocsr = require_bailout_to_csr();
    var _invarianterror = require_invariant_error();
    var _boundaryconstants1 = require_boundary_constants2();
    function _interop_require_default(obj) {
      return obj && obj.__esModule ? obj : {
        default: obj
      };
    }
    var hasPostpone = typeof _react.default.unstable_postpone === "function";
    function createDynamicTrackingState(isDebugDynamicAccesses) {
      return {
        isDebugDynamicAccesses,
        dynamicAccesses: [],
        syncDynamicErrorWithStack: null
      };
    }
    function createDynamicValidationState() {
      return {
        hasSuspenseAboveBody: false,
        hasDynamicMetadata: false,
        dynamicMetadata: null,
        hasDynamicViewport: false,
        hasAllowedDynamic: false,
        dynamicErrors: []
      };
    }
    function getFirstDynamicReason(trackingState) {
      var _trackingState_dynamicAccesses_;
      return (_trackingState_dynamicAccesses_ = trackingState.dynamicAccesses[0]) == null ? void 0 : _trackingState_dynamicAccesses_.expression;
    }
    function markCurrentScopeAsDynamic(store, workUnitStore, expression) {
      if (workUnitStore) {
        switch (workUnitStore.type) {
          case "cache":
          case "unstable-cache":
            return;
          case "private-cache":
            return;
          case "prerender-legacy":
          case "prerender-ppr":
          case "request":
          case "generate-static-params":
            break;
          default:
            workUnitStore;
        }
      }
      if (store.forceDynamic || store.forceStatic) return;
      if (store.dynamicShouldError) {
        throw Object.defineProperty(new _staticgenerationbailout.StaticGenBailoutError(`Route ${store.route} with \`dynamic = "error"\` couldn't be rendered statically because it used \`${expression}\`. See more info here: https://nextjs.org/docs/app/building-your-application/rendering/static-and-dynamic#dynamic-rendering`), "__NEXT_ERROR_CODE", {
          value: "E553",
          enumerable: false,
          configurable: true
        });
      }
      if (workUnitStore) {
        switch (workUnitStore.type) {
          case "prerender-ppr":
            return postponeWithTracking(store.route, expression, workUnitStore.dynamicTracking);
          case "prerender-legacy":
            workUnitStore.revalidate = 0;
            const err = Object.defineProperty(new _hooksservercontext.DynamicServerError(`Route ${store.route} couldn't be rendered statically because it used ${expression}. See more info here: https://nextjs.org/docs/messages/dynamic-server-error`), "__NEXT_ERROR_CODE", {
              value: "E550",
              enumerable: false,
              configurable: true
            });
            store.dynamicUsageDescription = expression;
            store.dynamicUsageStack = err.stack;
            throw err;
          case "request":
            if (process.env.NODE_ENV !== "production") {
              workUnitStore.usedDynamic = true;
            }
            break;
          case "generate-static-params":
            break;
          default:
            workUnitStore;
        }
      }
    }
    function throwToInterruptStaticGeneration(expression, store, prerenderStore) {
      const err = Object.defineProperty(new _hooksservercontext.DynamicServerError(`Route ${store.route} couldn't be rendered statically because it used \`${expression}\`. See more info here: https://nextjs.org/docs/messages/dynamic-server-error`), "__NEXT_ERROR_CODE", {
        value: "E558",
        enumerable: false,
        configurable: true
      });
      prerenderStore.revalidate = 0;
      store.dynamicUsageDescription = expression;
      store.dynamicUsageStack = err.stack;
      throw err;
    }
    function trackDynamicDataInDynamicRender(workUnitStore) {
      switch (workUnitStore.type) {
        case "cache":
        case "unstable-cache":
          return;
        case "private-cache":
          return;
        case "prerender":
        case "prerender-runtime":
        case "prerender-legacy":
        case "prerender-ppr":
        case "prerender-client":
        case "validation-client":
        case "generate-static-params":
          break;
        case "request":
          if (process.env.NODE_ENV !== "production") {
            workUnitStore.usedDynamic = true;
          }
          break;
        default:
          workUnitStore;
      }
    }
    function abortOnSynchronousDynamicDataAccess(route, expression, prerenderStore) {
      const reason = `Route ${route} needs to bail out of prerendering at this point because it used ${expression}.`;
      const error = createPrerenderInterruptedError(reason);
      prerenderStore.controller.abort(error);
      const dynamicTracking = prerenderStore.dynamicTracking;
      if (dynamicTracking) {
        dynamicTracking.dynamicAccesses.push({
          // When we aren't debugging, we don't need to create another error for the
          // stack trace.
          stack: dynamicTracking.isDebugDynamicAccesses ? new Error().stack : void 0,
          expression
        });
      }
    }
    function abortOnSynchronousPlatformIOAccess(route, expression, errorWithStack, prerenderStore) {
      const dynamicTracking = prerenderStore.dynamicTracking;
      abortOnSynchronousDynamicDataAccess(route, expression, prerenderStore);
      if (dynamicTracking) {
        if (dynamicTracking.syncDynamicErrorWithStack === null) {
          dynamicTracking.syncDynamicErrorWithStack = errorWithStack;
        }
      }
    }
    function abortAndThrowOnSynchronousRequestDataAccess(route, expression, errorWithStack, prerenderStore) {
      const prerenderSignal = prerenderStore.controller.signal;
      if (prerenderSignal.aborted === false) {
        abortOnSynchronousDynamicDataAccess(route, expression, prerenderStore);
        const dynamicTracking = prerenderStore.dynamicTracking;
        if (dynamicTracking) {
          if (dynamicTracking.syncDynamicErrorWithStack === null) {
            dynamicTracking.syncDynamicErrorWithStack = errorWithStack;
          }
        }
      }
      throw createPrerenderInterruptedError(`Route ${route} needs to bail out of prerendering at this point because it used ${expression}.`);
    }
    function Postpone({ reason, route }) {
      const prerenderStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
      const dynamicTracking = prerenderStore && prerenderStore.type === "prerender-ppr" ? prerenderStore.dynamicTracking : null;
      postponeWithTracking(route, reason, dynamicTracking);
    }
    function postponeWithTracking(route, expression, dynamicTracking) {
      assertPostpone();
      if (dynamicTracking) {
        dynamicTracking.dynamicAccesses.push({
          // When we aren't debugging, we don't need to create another error for the
          // stack trace.
          stack: dynamicTracking.isDebugDynamicAccesses ? new Error().stack : void 0,
          expression
        });
      }
      _react.default.unstable_postpone(createPostponeReason(route, expression));
    }
    function createPostponeReason(route, expression) {
      return `Route ${route} needs to bail out of prerendering at this point because it used ${expression}. React throws this special object to indicate where. It should not be caught by your own try/catch. Learn more: https://nextjs.org/docs/messages/ppr-caught-error`;
    }
    function isDynamicPostpone(err) {
      if (typeof err === "object" && err !== null && typeof err.message === "string") {
        return isDynamicPostponeReason(err.message);
      }
      return false;
    }
    function isDynamicPostponeReason(reason) {
      return reason.includes("needs to bail out of prerendering at this point because it used") && reason.includes("Learn more: https://nextjs.org/docs/messages/ppr-caught-error");
    }
    if (isDynamicPostponeReason(createPostponeReason("%%%", "^^^")) === false) {
      throw Object.defineProperty(new Error("Invariant: isDynamicPostpone misidentified a postpone reason. This is a bug in Next.js"), "__NEXT_ERROR_CODE", {
        value: "E296",
        enumerable: false,
        configurable: true
      });
    }
    var NEXT_PRERENDER_INTERRUPTED = "NEXT_PRERENDER_INTERRUPTED";
    function createPrerenderInterruptedError(message) {
      const error = Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
        value: "E394",
        enumerable: false,
        configurable: true
      });
      error.digest = NEXT_PRERENDER_INTERRUPTED;
      return error;
    }
    function isPrerenderInterruptedError(error) {
      return typeof error === "object" && error !== null && error.digest === NEXT_PRERENDER_INTERRUPTED && "name" in error && "message" in error && error instanceof Error;
    }
    function accessedDynamicData(dynamicAccesses) {
      return dynamicAccesses.length > 0;
    }
    function consumeDynamicAccess(serverDynamic, clientDynamic) {
      serverDynamic.dynamicAccesses.push(...clientDynamic.dynamicAccesses);
      return serverDynamic.dynamicAccesses;
    }
    function formatDynamicAPIAccesses(dynamicAccesses) {
      return dynamicAccesses.filter((access) => typeof access.stack === "string" && access.stack.length > 0).map(({ expression, stack }) => {
        stack = stack.split("\n").slice(4).filter((line) => {
          if (line.includes("node_modules/next/")) {
            return false;
          }
          if (line.includes(" (<anonymous>)")) {
            return false;
          }
          if (line.includes(" (node:")) {
            return false;
          }
          return true;
        }).join("\n");
        return `Dynamic API Usage Debug - ${expression}:
${stack}`;
      });
    }
    function assertPostpone() {
      if (!hasPostpone) {
        throw Object.defineProperty(new Error(`Invariant: React.unstable_postpone is not defined. This suggests the wrong version of React was loaded. This is a bug in Next.js`), "__NEXT_ERROR_CODE", {
          value: "E224",
          enumerable: false,
          configurable: true
        });
      }
    }
    function createRenderInBrowserAbortSignal() {
      const controller = new AbortController();
      controller.abort(Object.defineProperty(new _bailouttocsr.BailoutToCSRError("Render in Browser"), "__NEXT_ERROR_CODE", {
        value: "E721",
        enumerable: false,
        configurable: true
      }));
      return controller.signal;
    }
    function createHangingInputAbortSignal(workUnitStore) {
      switch (workUnitStore.type) {
        case "prerender":
        case "prerender-runtime":
          const controller = new AbortController();
          if (workUnitStore.cacheSignal) {
            workUnitStore.cacheSignal.inputReady().then(() => {
              controller.abort();
            });
          } else {
            if (
              // eslint-disable-next-line no-restricted-syntax -- We are discriminating between two different refined types and don't need an addition exhaustive switch here
              workUnitStore.type === "prerender-runtime" && workUnitStore.stagedRendering
            ) {
              const { stagedRendering } = workUnitStore;
              stagedRendering.waitForStage((0, _dynamicrenderingutils.getRuntimeStage)(stagedRendering)).then(() => (0, _scheduler.scheduleOnNextTick)(() => controller.abort()));
            } else {
              (0, _scheduler.scheduleOnNextTick)(() => controller.abort());
            }
          }
          return controller.signal;
        case "prerender-client":
        case "validation-client":
        case "prerender-ppr":
        case "prerender-legacy":
        case "request":
        case "cache":
        case "private-cache":
        case "unstable-cache":
        case "generate-static-params":
          return void 0;
        default:
          workUnitStore;
      }
    }
    function annotateDynamicAccess(expression, prerenderStore) {
      const dynamicTracking = prerenderStore.dynamicTracking;
      if (dynamicTracking) {
        dynamicTracking.dynamicAccesses.push({
          stack: dynamicTracking.isDebugDynamicAccesses ? new Error().stack : void 0,
          expression
        });
      }
    }
    function useDynamicRouteParams(expression) {
      const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
      const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
      if (workStore && workUnitStore) {
        switch (workUnitStore.type) {
          case "prerender-client":
          case "prerender": {
            const fallbackParams = workUnitStore.fallbackRouteParams;
            if (fallbackParams && fallbackParams.size > 0) {
              _react.default.use((0, _dynamicrenderingutils.makeHangingPromise)(workUnitStore.renderSignal, workStore.route, expression));
            }
            break;
          }
          case "prerender-ppr": {
            const fallbackParams = workUnitStore.fallbackRouteParams;
            if (fallbackParams && fallbackParams.size > 0) {
              return postponeWithTracking(workStore.route, expression, workUnitStore.dynamicTracking);
            }
            break;
          }
          case "validation-client": {
            break;
          }
          case "prerender-runtime":
            throw Object.defineProperty(new _invarianterror.InvariantError(`\`${expression}\` was called during a runtime prerender. Next.js should be preventing ${expression} from being included in server components statically, but did not in this case.`), "__NEXT_ERROR_CODE", {
              value: "E771",
              enumerable: false,
              configurable: true
            });
          case "cache":
          case "private-cache":
            throw Object.defineProperty(new _invarianterror.InvariantError(`\`${expression}\` was called inside a cache scope. Next.js should be preventing ${expression} from being included in server components statically, but did not in this case.`), "__NEXT_ERROR_CODE", {
              value: "E745",
              enumerable: false,
              configurable: true
            });
          case "generate-static-params":
            throw Object.defineProperty(new _invarianterror.InvariantError(`\`${expression}\` was called in \`generateStaticParams\`. Next.js should be preventing ${expression} from being included in server component files statically, but did not in this case.`), "__NEXT_ERROR_CODE", {
              value: "E1130",
              enumerable: false,
              configurable: true
            });
          case "prerender-legacy":
          case "request":
          case "unstable-cache":
            break;
          default:
            workUnitStore;
        }
      }
    }
    function useDynamicSearchParams(expression) {
      const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
      const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
      if (!workStore) {
        return;
      }
      if (!workUnitStore) {
        (0, _workunitasyncstorageexternal.throwForMissingRequestStore)(expression);
      }
      switch (workUnitStore.type) {
        case "validation-client":
          return;
        case "prerender-client": {
          _react.default.use((0, _dynamicrenderingutils.makeHangingPromise)(workUnitStore.renderSignal, workStore.route, expression));
          break;
        }
        case "prerender-legacy":
        case "prerender-ppr": {
          if (workStore.forceStatic) {
            return;
          }
          throw Object.defineProperty(new _bailouttocsr.BailoutToCSRError(expression), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
          });
        }
        case "prerender":
        case "prerender-runtime":
          throw Object.defineProperty(new _invarianterror.InvariantError(`\`${expression}\` was called from a Server Component. Next.js should be preventing ${expression} from being included in server components statically, but did not in this case.`), "__NEXT_ERROR_CODE", {
            value: "E795",
            enumerable: false,
            configurable: true
          });
        case "cache":
        case "unstable-cache":
        case "private-cache":
          throw Object.defineProperty(new _invarianterror.InvariantError(`\`${expression}\` was called inside a cache scope. Next.js should be preventing ${expression} from being included in server components statically, but did not in this case.`), "__NEXT_ERROR_CODE", {
            value: "E745",
            enumerable: false,
            configurable: true
          });
        case "generate-static-params":
          throw Object.defineProperty(new _invarianterror.InvariantError(`\`${expression}\` was called in \`generateStaticParams\`. Next.js should be preventing ${expression} from being included in server component files statically, but did not in this case.`), "__NEXT_ERROR_CODE", {
            value: "E1130",
            enumerable: false,
            configurable: true
          });
        case "request":
          return;
        default:
          workUnitStore;
      }
    }
    var hasSuspenseRegex = /\n\s+at Suspense \(<anonymous>\)/;
    var bodyAndImplicitTags = "body|div|main|section|article|aside|header|footer|nav|form|p|span|h1|h2|h3|h4|h5|h6";
    var hasSuspenseBeforeRootLayoutWithoutBodyOrImplicitBodyRegex = new RegExp(`\\n\\s+at Suspense \\(<anonymous>\\)(?:(?!\\n\\s+at (?:${bodyAndImplicitTags}) \\(<anonymous>\\))[\\s\\S])*?\\n\\s+at ${_boundaryconstants.ROOT_LAYOUT_BOUNDARY_NAME} \\([^\\n]*\\)`);
    var hasMetadataRegex = new RegExp(`\\n\\s+at ${_boundaryconstants.METADATA_BOUNDARY_NAME}[\\n\\s]`);
    var hasViewportRegex = new RegExp(`\\n\\s+at ${_boundaryconstants.VIEWPORT_BOUNDARY_NAME}[\\n\\s]`);
    var hasOutletRegex = new RegExp(`\\n\\s+at ${_boundaryconstants.OUTLET_BOUNDARY_NAME}[\\n\\s]`);
    var hasInstantValidationBoundaryRegex = new RegExp(`\\n\\s+at ${_boundaryconstants1.INSTANT_VALIDATION_BOUNDARY_NAME}[\\n\\s]`);
    function trackAllowedDynamicAccess(workStore, componentStack, dynamicValidation, clientDynamic) {
      if (hasOutletRegex.test(componentStack)) {
        return;
      } else if (hasMetadataRegex.test(componentStack)) {
        dynamicValidation.hasDynamicMetadata = true;
        return;
      } else if (hasViewportRegex.test(componentStack)) {
        dynamicValidation.hasDynamicViewport = true;
        return;
      } else if (hasSuspenseBeforeRootLayoutWithoutBodyOrImplicitBodyRegex.test(componentStack)) {
        dynamicValidation.hasAllowedDynamic = true;
        dynamicValidation.hasSuspenseAboveBody = true;
        return;
      } else if (hasSuspenseRegex.test(componentStack)) {
        dynamicValidation.hasAllowedDynamic = true;
        return;
      } else if (clientDynamic.syncDynamicErrorWithStack) {
        dynamicValidation.dynamicErrors.push(clientDynamic.syncDynamicErrorWithStack);
        return;
      } else {
        const message = `Route "${workStore.route}": Uncached data was accessed outside of <Suspense>. This delays the entire page from rendering, resulting in a slow user experience. Learn more: https://nextjs.org/docs/messages/blocking-route`;
        const error = addErrorContext(Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
          value: "E1079",
          enumerable: false,
          configurable: true
        }), componentStack, null);
        dynamicValidation.dynamicErrors.push(error);
        return;
      }
    }
    var DynamicHoleKind = /* @__PURE__ */ (function(DynamicHoleKind2) {
      DynamicHoleKind2[DynamicHoleKind2["Runtime"] = 1] = "Runtime";
      DynamicHoleKind2[DynamicHoleKind2["Dynamic"] = 2] = "Dynamic";
      return DynamicHoleKind2;
    })({});
    function createInstantValidationState(createInstantStack) {
      return {
        hasDynamicMetadata: false,
        hasAllowedClientDynamicAboveBoundary: false,
        dynamicMetadata: null,
        hasDynamicViewport: false,
        hasAllowedDynamic: false,
        dynamicErrors: [],
        validationPreventingErrors: [],
        thrownErrorsOutsideBoundary: [],
        createInstantStack
      };
    }
    function trackDynamicHoleInNavigation(workStore, componentStack, dynamicValidation, clientDynamic, kind, boundaryState) {
      if (hasOutletRegex.test(componentStack)) {
        return;
      }
      if (hasMetadataRegex.test(componentStack)) {
        const usageDescription2 = kind === 1 ? `Runtime data such as \`cookies()\`, \`headers()\`, \`params\`, or \`searchParams\` was accessed inside \`generateMetadata\` or you have file-based metadata such as icons that depend on dynamic params segments.` : `Uncached data or \`connection()\` was accessed inside \`generateMetadata\`.`;
        const message2 = `Route "${workStore.route}": ${usageDescription2} Except for this instance, the page would have been entirely prerenderable which may have been the intended behavior. See more info here: https://nextjs.org/docs/messages/next-prerender-dynamic-metadata`;
        const error2 = addErrorContext(Object.defineProperty(new Error(message2), "__NEXT_ERROR_CODE", {
          value: "E1076",
          enumerable: false,
          configurable: true
        }), componentStack, dynamicValidation.createInstantStack);
        dynamicValidation.dynamicMetadata = error2;
        return;
      }
      if (hasViewportRegex.test(componentStack)) {
        const usageDescription2 = kind === 1 ? `Runtime data such as \`cookies()\`, \`headers()\`, \`params\`, or \`searchParams\` was accessed inside \`generateViewport\`.` : `Uncached data or \`connection()\` was accessed inside \`generateViewport\`.`;
        const message2 = `Route "${workStore.route}": ${usageDescription2} This delays the entire page from rendering, resulting in a slow user experience. Learn more: https://nextjs.org/docs/messages/next-prerender-dynamic-viewport`;
        const error2 = addErrorContext(Object.defineProperty(new Error(message2), "__NEXT_ERROR_CODE", {
          value: "E1086",
          enumerable: false,
          configurable: true
        }), componentStack, dynamicValidation.createInstantStack);
        dynamicValidation.dynamicErrors.push(error2);
        return;
      }
      const boundaryLocation = hasInstantValidationBoundaryRegex.exec(componentStack);
      if (!boundaryLocation) {
        if (boundaryState.expectedIds.size === boundaryState.renderedIds.size) {
          dynamicValidation.hasAllowedClientDynamicAboveBoundary = true;
          dynamicValidation.hasAllowedDynamic = true;
          return;
        } else {
          const message2 = `Route "${workStore.route}": Could not validate \`unstable_instant\` because a Client Component in a parent segment prevented the page from rendering.`;
          const error2 = addErrorContext(Object.defineProperty(new Error(message2), "__NEXT_ERROR_CODE", {
            value: "E1082",
            enumerable: false,
            configurable: true
          }), componentStack, dynamicValidation.createInstantStack);
          dynamicValidation.validationPreventingErrors.push(error2);
          return;
        }
      } else {
        const suspenseLocation = hasSuspenseRegex.exec(componentStack);
        if (suspenseLocation) {
          if (suspenseLocation.index < boundaryLocation.index) {
            dynamicValidation.hasAllowedDynamic = true;
            return;
          } else {
          }
        }
      }
      if (clientDynamic.syncDynamicErrorWithStack) {
        const syncError = clientDynamic.syncDynamicErrorWithStack;
        if (dynamicValidation.createInstantStack !== null && syncError.cause === void 0) {
          syncError.cause = dynamicValidation.createInstantStack();
        }
        dynamicValidation.dynamicErrors.push(syncError);
        return;
      }
      const usageDescription = kind === 1 ? `Runtime data such as \`cookies()\`, \`headers()\`, \`params\`, or \`searchParams\` was accessed outside of \`<Suspense>\`.` : `Uncached data or \`connection()\` was accessed outside of \`<Suspense>\`.`;
      const message = `Route "${workStore.route}": ${usageDescription} This delays the entire page from rendering, resulting in a slow user experience. Learn more: https://nextjs.org/docs/messages/blocking-route`;
      const error = addErrorContext(Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
        value: "E1078",
        enumerable: false,
        configurable: true
      }), componentStack, dynamicValidation.createInstantStack);
      dynamicValidation.dynamicErrors.push(error);
      return;
    }
    function trackThrownErrorInNavigation(workStore, dynamicValidation, thrownValue, componentStack) {
      const boundaryLocation = hasInstantValidationBoundaryRegex.exec(componentStack);
      if (!boundaryLocation) {
        const error = addErrorContext(Object.defineProperty(new Error("An error occurred while attempting to validate instant UI. This error may be preventing the validation from completing.", {
          cause: thrownValue
        }), "__NEXT_ERROR_CODE", {
          value: "E1118",
          enumerable: false,
          configurable: true
        }), componentStack, null);
        dynamicValidation.thrownErrorsOutsideBoundary.push(error);
      } else {
        const suspenseLocation = hasSuspenseRegex.exec(componentStack);
        if (suspenseLocation) {
          if (suspenseLocation.index < boundaryLocation.index) {
            return;
          } else {
          }
        }
        const message = `Route "${workStore.route}": Could not validate \`unstable_instant\` because an error prevented the target segment from rendering.`;
        const error = addErrorContext(
          Object.defineProperty(new Error(message, {
            cause: thrownValue
          }), "__NEXT_ERROR_CODE", {
            value: "E1112",
            enumerable: false,
            configurable: true
          }),
          componentStack,
          null
          // TODO(instant-validation-build): conflicting use of cause
        );
        dynamicValidation.validationPreventingErrors.push(error);
      }
    }
    function trackDynamicHoleInRuntimeShell(workStore, componentStack, dynamicValidation, clientDynamic) {
      if (hasOutletRegex.test(componentStack)) {
        return;
      } else if (hasMetadataRegex.test(componentStack)) {
        const message2 = `Route "${workStore.route}": Uncached data or \`connection()\` was accessed inside \`generateMetadata\`. Except for this instance, the page would have been entirely prerenderable which may have been the intended behavior. See more info here: https://nextjs.org/docs/messages/next-prerender-dynamic-metadata`;
        const error2 = addErrorContext(Object.defineProperty(new Error(message2), "__NEXT_ERROR_CODE", {
          value: "E1080",
          enumerable: false,
          configurable: true
        }), componentStack, null);
        dynamicValidation.dynamicMetadata = error2;
        return;
      } else if (hasViewportRegex.test(componentStack)) {
        const message2 = `Route "${workStore.route}": Uncached data or \`connection()\` was accessed inside \`generateViewport\`. This delays the entire page from rendering, resulting in a slow user experience. Learn more: https://nextjs.org/docs/messages/next-prerender-dynamic-viewport`;
        const error2 = addErrorContext(Object.defineProperty(new Error(message2), "__NEXT_ERROR_CODE", {
          value: "E1077",
          enumerable: false,
          configurable: true
        }), componentStack, null);
        dynamicValidation.dynamicErrors.push(error2);
        return;
      } else if (hasSuspenseBeforeRootLayoutWithoutBodyOrImplicitBodyRegex.test(componentStack)) {
        dynamicValidation.hasAllowedDynamic = true;
        dynamicValidation.hasSuspenseAboveBody = true;
        return;
      } else if (hasSuspenseRegex.test(componentStack)) {
        dynamicValidation.hasAllowedDynamic = true;
        return;
      } else if (clientDynamic.syncDynamicErrorWithStack) {
        dynamicValidation.dynamicErrors.push(clientDynamic.syncDynamicErrorWithStack);
        return;
      }
      const message = `Route "${workStore.route}": Uncached data or \`connection()\` was accessed outside of \`<Suspense>\`. This delays the entire page from rendering, resulting in a slow user experience. Learn more: https://nextjs.org/docs/messages/blocking-route`;
      const error = addErrorContext(Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
        value: "E1084",
        enumerable: false,
        configurable: true
      }), componentStack, null);
      dynamicValidation.dynamicErrors.push(error);
      return;
    }
    function trackDynamicHoleInStaticShell(workStore, componentStack, dynamicValidation, clientDynamic) {
      if (hasOutletRegex.test(componentStack)) {
        return;
      } else if (hasMetadataRegex.test(componentStack)) {
        const message = `Route "${workStore.route}": Runtime data such as \`cookies()\`, \`headers()\`, \`params\`, or \`searchParams\` was accessed inside \`generateMetadata\` or you have file-based metadata such as icons that depend on dynamic params segments. Except for this instance, the page would have been entirely prerenderable which may have been the intended behavior. See more info here: https://nextjs.org/docs/messages/next-prerender-dynamic-metadata`;
        const error = addErrorContext(Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
          value: "E1085",
          enumerable: false,
          configurable: true
        }), componentStack, null);
        dynamicValidation.dynamicMetadata = error;
        return;
      } else if (hasViewportRegex.test(componentStack)) {
        const message = `Route "${workStore.route}": Runtime data such as \`cookies()\`, \`headers()\`, \`params\`, or \`searchParams\` was accessed inside \`generateViewport\`. This delays the entire page from rendering, resulting in a slow user experience. Learn more: https://nextjs.org/docs/messages/next-prerender-dynamic-viewport`;
        const error = addErrorContext(Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
          value: "E1081",
          enumerable: false,
          configurable: true
        }), componentStack, null);
        dynamicValidation.dynamicErrors.push(error);
        return;
      } else if (hasSuspenseBeforeRootLayoutWithoutBodyOrImplicitBodyRegex.test(componentStack)) {
        dynamicValidation.hasAllowedDynamic = true;
        dynamicValidation.hasSuspenseAboveBody = true;
        return;
      } else if (hasSuspenseRegex.test(componentStack)) {
        dynamicValidation.hasAllowedDynamic = true;
        return;
      } else if (clientDynamic.syncDynamicErrorWithStack) {
        dynamicValidation.dynamicErrors.push(clientDynamic.syncDynamicErrorWithStack);
        return;
      } else {
        const message = `Route "${workStore.route}": Runtime data such as \`cookies()\`, \`headers()\`, \`params\`, or \`searchParams\` was accessed outside of \`<Suspense>\`. This delays the entire page from rendering, resulting in a slow user experience. Learn more: https://nextjs.org/docs/messages/blocking-route`;
        const error = addErrorContext(Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
          value: "E1083",
          enumerable: false,
          configurable: true
        }), componentStack, null);
        dynamicValidation.dynamicErrors.push(error);
        return;
      }
    }
    function addErrorContext(error, componentStack, createInstantStack) {
      const ownerStack = process.env.NODE_ENV !== "production" && _react.default.captureOwnerStack ? _react.default.captureOwnerStack() : null;
      if (createInstantStack !== null) {
        error.cause = createInstantStack();
      }
      error.stack = error.name + ": " + error.message + (ownerStack || componentStack);
      return error;
    }
    var PreludeState = /* @__PURE__ */ (function(PreludeState2) {
      PreludeState2[PreludeState2["Full"] = 0] = "Full";
      PreludeState2[PreludeState2["Empty"] = 1] = "Empty";
      PreludeState2[PreludeState2["Errored"] = 2] = "Errored";
      return PreludeState2;
    })({});
    function logDisallowedDynamicError(workStore, error) {
      console.error(error);
      if (process.env.NODE_ENV !== "development") {
        console.error(`To get a more detailed stack trace and pinpoint the issue, try one of the following:
  - Start the app in development mode by running \`next dev\`, then open "${workStore.route}" in your browser to investigate the error.
  - Rerun the production build with \`next build --debug-prerender\` to generate better stack traces.`);
      } else if (!process.env.__NEXT_DEV_SERVER) {
        console.error(`To debug the issue, start the app in development mode by running \`next dev\`, then open "${workStore.route}" in your browser to investigate the error.`);
      }
    }
    function throwIfDisallowedDynamic(workStore, prelude, dynamicValidation, serverDynamic) {
      if (serverDynamic.syncDynamicErrorWithStack) {
        logDisallowedDynamicError(workStore, serverDynamic.syncDynamicErrorWithStack);
        throw new _staticgenerationbailout.StaticGenBailoutError();
      }
      if (prelude !== 0) {
        if (dynamicValidation.hasSuspenseAboveBody) {
          return;
        }
        const dynamicErrors = dynamicValidation.dynamicErrors;
        if (dynamicErrors.length > 0) {
          for (let i = 0; i < dynamicErrors.length; i++) {
            logDisallowedDynamicError(workStore, dynamicErrors[i]);
          }
          throw new _staticgenerationbailout.StaticGenBailoutError();
        }
        if (dynamicValidation.hasDynamicViewport) {
          console.error(`Route "${workStore.route}" has a \`generateViewport\` that depends on Request data (\`cookies()\`, etc...) or uncached external data (\`fetch(...)\`, etc...) without explicitly allowing fully dynamic rendering. See more info here: https://nextjs.org/docs/messages/next-prerender-dynamic-viewport`);
          throw new _staticgenerationbailout.StaticGenBailoutError();
        }
        if (prelude === 1) {
          console.error(`Route "${workStore.route}" did not produce a static shell and Next.js was unable to determine a reason. This is a bug in Next.js.`);
          throw new _staticgenerationbailout.StaticGenBailoutError();
        }
      } else {
        if (dynamicValidation.hasAllowedDynamic === false && dynamicValidation.hasDynamicMetadata) {
          console.error(`Route "${workStore.route}" has a \`generateMetadata\` that depends on Request data (\`cookies()\`, etc...) or uncached external data (\`fetch(...)\`, etc...) when the rest of the route does not. See more info here: https://nextjs.org/docs/messages/next-prerender-dynamic-metadata`);
          throw new _staticgenerationbailout.StaticGenBailoutError();
        }
      }
    }
    function getStaticShellDisallowedDynamicReasons(workStore, prelude, dynamicValidation, configAllowsBlocking) {
      if (configAllowsBlocking || dynamicValidation.hasSuspenseAboveBody) {
        return [];
      }
      if (prelude !== 0) {
        const dynamicErrors = dynamicValidation.dynamicErrors;
        if (dynamicErrors.length > 0) {
          return dynamicErrors;
        }
        if (prelude === 1) {
          return [
            Object.defineProperty(new _invarianterror.InvariantError(`Route "${workStore.route}" did not produce a static shell and Next.js was unable to determine a reason.`), "__NEXT_ERROR_CODE", {
              value: "E936",
              enumerable: false,
              configurable: true
            })
          ];
        }
      } else {
        if (dynamicValidation.hasAllowedDynamic === false && dynamicValidation.dynamicErrors.length === 0 && dynamicValidation.dynamicMetadata) {
          return [
            dynamicValidation.dynamicMetadata
          ];
        }
      }
      return [];
    }
    function getNavigationDisallowedDynamicReasons(workStore, prelude, dynamicValidation, validationSampleTracking, boundaryState) {
      if (validationSampleTracking) {
        const { missingSampleErrors } = validationSampleTracking;
        if (missingSampleErrors.length > 0) {
          return missingSampleErrors;
        }
      }
      const { validationPreventingErrors } = dynamicValidation;
      if (validationPreventingErrors.length > 0) {
        return validationPreventingErrors;
      }
      if (boundaryState.renderedIds.size < boundaryState.expectedIds.size) {
        const { thrownErrorsOutsideBoundary, createInstantStack } = dynamicValidation;
        if (thrownErrorsOutsideBoundary.length === 0) {
          const message = `Route "${workStore.route}": Could not validate \`unstable_instant\` because the target segment was prevented from rendering for an unknown reason.`;
          const error = createInstantStack !== null ? createInstantStack() : new Error();
          error.name = "Error";
          error.message = message;
          return [
            error
          ];
        } else if (thrownErrorsOutsideBoundary.length === 1) {
          const message = `Route "${workStore.route}": Could not validate \`unstable_instant\` because the target segment was prevented from rendering, likely due to the following error.`;
          const error = createInstantStack !== null ? createInstantStack() : new Error();
          error.name = "Error";
          error.message = message;
          return [
            error,
            thrownErrorsOutsideBoundary[0]
          ];
        } else {
          const message = `Route "${workStore.route}": Could not validate \`unstable_instant\` because the target segment was prevented from rendering, likely due to one of the following errors.`;
          const error = createInstantStack !== null ? createInstantStack() : new Error();
          error.name = "Error";
          error.message = message;
          return [
            error,
            ...thrownErrorsOutsideBoundary
          ];
        }
      }
      if (prelude !== 0) {
        const dynamicErrors = dynamicValidation.dynamicErrors;
        if (dynamicErrors.length > 0) {
          return dynamicErrors;
        }
        if (prelude === 1) {
          if (dynamicValidation.hasAllowedClientDynamicAboveBoundary) {
            return [];
          }
          return [
            Object.defineProperty(new _invarianterror.InvariantError(`Route "${workStore.route}" failed to render during instant validation and Next.js was unable to determine a reason.`), "__NEXT_ERROR_CODE", {
              value: "E1055",
              enumerable: false,
              configurable: true
            })
          ];
        }
      } else {
        const dynamicErrors = dynamicValidation.dynamicErrors;
        if (dynamicErrors.length > 0) {
          return dynamicErrors;
        }
        if (dynamicValidation.hasAllowedDynamic === false && dynamicValidation.dynamicMetadata) {
          return [
            dynamicValidation.dynamicMetadata
          ];
        }
      }
      return [];
    }
  }
});

// node_modules/next/dist/server/app-render/after-task-async-storage-instance.js
var require_after_task_async_storage_instance = __commonJS({
  "node_modules/next/dist/server/app-render/after-task-async-storage-instance.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "afterTaskAsyncStorageInstance", {
      enumerable: true,
      get: function() {
        return afterTaskAsyncStorageInstance;
      }
    });
    var _asynclocalstorage = require_async_local_storage();
    var afterTaskAsyncStorageInstance = (0, _asynclocalstorage.createAsyncLocalStorage)();
  }
});

// node_modules/next/dist/server/app-render/after-task-async-storage.external.js
var require_after_task_async_storage_external = __commonJS({
  "node_modules/next/dist/server/app-render/after-task-async-storage.external.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "afterTaskAsyncStorage", {
      enumerable: true,
      get: function() {
        return _aftertaskasyncstorageinstance.afterTaskAsyncStorageInstance;
      }
    });
    var _aftertaskasyncstorageinstance = require_after_task_async_storage_instance();
  }
});

// node_modules/next/dist/server/request/utils.js
var require_utils3 = __commonJS({
  "node_modules/next/dist/server/request/utils.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      isRequestAPICallableInsideAfter: function() {
        return isRequestAPICallableInsideAfter;
      },
      throwForSearchParamsAccessInUseCache: function() {
        return throwForSearchParamsAccessInUseCache;
      },
      throwWithStaticGenerationBailoutErrorWithDynamicError: function() {
        return throwWithStaticGenerationBailoutErrorWithDynamicError;
      }
    });
    var _staticgenerationbailout = require_static_generation_bailout();
    var _aftertaskasyncstorageexternal = require_after_task_async_storage_external();
    function throwWithStaticGenerationBailoutErrorWithDynamicError(route, expression) {
      throw Object.defineProperty(new _staticgenerationbailout.StaticGenBailoutError(`Route ${route} with \`dynamic = "error"\` couldn't be rendered statically because it used ${expression}. See more info here: https://nextjs.org/docs/app/building-your-application/rendering/static-and-dynamic#dynamic-rendering`), "__NEXT_ERROR_CODE", {
        value: "E543",
        enumerable: false,
        configurable: true
      });
    }
    function throwForSearchParamsAccessInUseCache(workStore, constructorOpt) {
      const error = Object.defineProperty(new Error(`Route ${workStore.route} used \`searchParams\` inside "use cache". Accessing dynamic request data inside a cache scope is not supported. If you need some search params inside a cached function await \`searchParams\` outside of the cached function and pass only the required search params as arguments to the cached function. See more info here: https://nextjs.org/docs/messages/next-request-in-use-cache`), "__NEXT_ERROR_CODE", {
        value: "E842",
        enumerable: false,
        configurable: true
      });
      Error.captureStackTrace(error, constructorOpt);
      workStore.invalidDynamicUsageError ??= error;
      throw error;
    }
    function isRequestAPICallableInsideAfter() {
      const afterTaskStore = _aftertaskasyncstorageexternal.afterTaskAsyncStorage.getStore();
      return (afterTaskStore == null ? void 0 : afterTaskStore.rootTaskSpawnPhase) === "action";
    }
  }
});

// node_modules/next/dist/server/request/connection.js
var require_connection = __commonJS({
  "node_modules/next/dist/server/request/connection.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "connection", {
      enumerable: true,
      get: function() {
        return connection;
      }
    });
    var _workasyncstorageexternal = require_work_async_storage_external();
    var _workunitasyncstorageexternal = require_work_unit_async_storage_external();
    var _dynamicrendering = require_dynamic_rendering();
    var _staticgenerationbailout = require_static_generation_bailout();
    var _dynamicrenderingutils = require_dynamic_rendering_utils();
    var _utils = require_utils3();
    var _stagedrendering = require_staged_rendering();
    var _invarianterror = require_invariant_error();
    function connection() {
      const callingExpression = "connection";
      const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
      const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
      if (workStore) {
        if (workUnitStore && workUnitStore.phase === "after" && !(0, _utils.isRequestAPICallableInsideAfter)()) {
          throw Object.defineProperty(new Error(`Route ${workStore.route} used \`connection()\` inside \`after()\`. The \`connection()\` function is used to indicate the subsequent code must only run when there is an actual Request, but \`after()\` executes after the request, so this function is not allowed in this scope. See more info here: https://nextjs.org/docs/canary/app/api-reference/functions/after`), "__NEXT_ERROR_CODE", {
            value: "E827",
            enumerable: false,
            configurable: true
          });
        }
        if (workStore.forceStatic) {
          return Promise.resolve(void 0);
        }
        if (workStore.dynamicShouldError) {
          throw Object.defineProperty(new _staticgenerationbailout.StaticGenBailoutError(`Route ${workStore.route} with \`dynamic = "error"\` couldn't be rendered statically because it used \`connection()\`. See more info here: https://nextjs.org/docs/app/building-your-application/rendering/static-and-dynamic#dynamic-rendering`), "__NEXT_ERROR_CODE", {
            value: "E847",
            enumerable: false,
            configurable: true
          });
        }
        if (workUnitStore) {
          switch (workUnitStore.type) {
            case "cache": {
              const error = Object.defineProperty(new Error(`Route ${workStore.route} used \`connection()\` inside "use cache". The \`connection()\` function is used to indicate the subsequent code must only run when there is an actual request, but caches must be able to be produced before a request, so this function is not allowed in this scope. See more info here: https://nextjs.org/docs/messages/next-request-in-use-cache`), "__NEXT_ERROR_CODE", {
                value: "E841",
                enumerable: false,
                configurable: true
              });
              Error.captureStackTrace(error, connection);
              workStore.invalidDynamicUsageError ??= error;
              throw error;
            }
            case "private-cache": {
              const error = Object.defineProperty(new Error(`Route ${workStore.route} used \`connection()\` inside "use cache: private". The \`connection()\` function is used to indicate the subsequent code must only run when there is an actual navigation request, but caches must be able to be produced before a navigation request, so this function is not allowed in this scope. See more info here: https://nextjs.org/docs/messages/next-request-in-use-cache`), "__NEXT_ERROR_CODE", {
                value: "E837",
                enumerable: false,
                configurable: true
              });
              Error.captureStackTrace(error, connection);
              workStore.invalidDynamicUsageError ??= error;
              throw error;
            }
            case "unstable-cache":
              throw Object.defineProperty(new Error(`Route ${workStore.route} used \`connection()\` inside a function cached with \`unstable_cache()\`. The \`connection()\` function is used to indicate the subsequent code must only run when there is an actual Request, but caches must be able to be produced before a Request so this function is not allowed in this scope. See more info here: https://nextjs.org/docs/app/api-reference/functions/unstable_cache`), "__NEXT_ERROR_CODE", {
                value: "E840",
                enumerable: false,
                configurable: true
              });
            case "generate-static-params":
              throw Object.defineProperty(new Error(`Route ${workStore.route} used \`connection()\` inside \`generateStaticParams\`. This is not supported because \`generateStaticParams\` runs at build time without an HTTP request. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context`), "__NEXT_ERROR_CODE", {
                value: "E1125",
                enumerable: false,
                configurable: true
              });
            case "prerender":
            case "prerender-client":
            case "prerender-runtime":
              return (0, _dynamicrenderingutils.makeHangingPromise)(workUnitStore.renderSignal, workStore.route, "`connection()`");
            case "validation-client": {
              const exportName = "`connection`";
              throw Object.defineProperty(new _invarianterror.InvariantError(`${exportName} must not be used within a Client Component. Next.js should be preventing ${exportName} from being included in Client Components statically, but did not in this case.`), "__NEXT_ERROR_CODE", {
                value: "E1063",
                enumerable: false,
                configurable: true
              });
            }
            case "prerender-ppr":
              return (0, _dynamicrendering.postponeWithTracking)(workStore.route, "connection", workUnitStore.dynamicTracking);
            case "prerender-legacy":
              return (0, _dynamicrendering.throwToInterruptStaticGeneration)("connection", workStore, workUnitStore);
            case "request":
              (0, _dynamicrendering.trackDynamicDataInDynamicRender)(workUnitStore);
              if (process.env.NODE_ENV === "development") {
                if (workUnitStore.asyncApiPromises) {
                  return workUnitStore.asyncApiPromises.connection;
                }
                return (0, _dynamicrenderingutils.makeDevtoolsIOAwarePromise)(void 0, workUnitStore, _stagedrendering.RenderStage.Dynamic);
              } else if (workUnitStore.asyncApiPromises) {
                return workUnitStore.asyncApiPromises.connection;
              } else {
                return Promise.resolve(void 0);
              }
            default:
              workUnitStore;
          }
        }
      }
      (0, _workunitasyncstorageexternal.throwForMissingRequestStore)(callingExpression);
    }
  }
});

// node_modules/next/server.js
var require_server = __commonJS({
  "node_modules/next/server.js"(exports2, module2) {
    var serverExports = {
      NextRequest: require_request().NextRequest,
      NextResponse: require_response().NextResponse,
      ImageResponse: require_image_response().ImageResponse,
      userAgentFromString: require_user_agent().userAgentFromString,
      userAgent: require_user_agent().userAgent,
      URLPattern: require_url_pattern().URLPattern,
      after: require_after2().after,
      connection: require_connection().connection
    };
    module2.exports = serverExports;
    exports2.NextRequest = serverExports.NextRequest;
    exports2.NextResponse = serverExports.NextResponse;
    exports2.ImageResponse = serverExports.ImageResponse;
    exports2.userAgentFromString = serverExports.userAgentFromString;
    exports2.userAgent = serverExports.userAgent;
    exports2.URLPattern = serverExports.URLPattern;
    exports2.after = serverExports.after;
    exports2.connection = serverExports.connection;
  }
});

// lib/runner-v2/entry-code-root.ts
var import_fs = require("fs");
var import_path = require("path");
function findCodeRootFrom(startDir, maxHops = 8) {
  let dir = (0, import_path.resolve)(startDir);
  for (let hop = 0; hop <= maxHops; hop++) {
    if ((0, import_fs.existsSync)((0, import_path.join)(dir, "lib", "chain-runner.sh"))) return dir;
    const parent = (0, import_path.dirname)(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
function anchorCodeRootEnv(startDir) {
  const existing = process.env.MENTIKO_CODE_ROOT?.trim();
  if (existing) return existing;
  const found = findCodeRootFrom(startDir);
  if (found) process.env.MENTIKO_CODE_ROOT = found;
  return found;
}

// lib/runner-v2/entry-code-root-anchor.ts
anchorCodeRootEnv(__dirname);

// lib/runner-v2/launch-agent-cli.ts
var import_node_crypto7 = require("node:crypto");
var import_node_path14 = require("node:path");
var import_node_child_process4 = require("node:child_process");

// lib/runner-v2/launch-job.ts
var import_node_crypto = require("node:crypto");

// lib/runner-v2/run-state.ts
var import_fs3 = require("fs");

// lib/runs/run-json-lock.ts
var import_crypto = require("crypto");
var import_fs2 = require("fs");
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
var RUN_LOCK_WAIT_TICKS = envInt("RUN_LOCK_WAIT_SECS", 30);
var TICK_MS = 50;
var TAKEOVER_CLAIM_INIT_GRACE_MS = 1e3;
function sleepSyncMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
    }
  }
}
function readLockSnapshot(lockDir) {
  let pidText = "";
  try {
    pidText = (0, import_fs2.readFileSync)(`${lockDir}/pid`, "utf-8").trim();
  } catch {
    return void 0;
  }
  let ownerToken;
  try {
    ownerToken = (0, import_fs2.readFileSync)(`${lockDir}/owner`, "utf-8").trim() || void 0;
  } catch {
  }
  return { pidText, ownerToken };
}
function snapshotHolderIsDead(snapshot) {
  const pid = Number(snapshot.pidText);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return err.code === "ESRCH";
  }
}
function snapshotsEqual(left, right) {
  return right !== void 0 && left.pidText === right.pidText && left.ownerToken === right.ownerToken;
}
function acquireLock(lockDir) {
  let waited = 0;
  for (; ; ) {
    const ownerToken = (0, import_crypto.randomUUID)();
    let created = false;
    try {
      (0, import_fs2.mkdirSync)(lockDir);
      created = true;
      try {
        (0, import_fs2.writeFileSync)(`${lockDir}/owner`, ownerToken, { flag: "wx" });
        (0, import_fs2.writeFileSync)(`${lockDir}/pid`, String(process.pid), { flag: "wx" });
      } catch (error) {
        cleanupIncompleteAcquisition(lockDir, ownerToken);
        throw error;
      }
      return ownerToken;
    } catch (error) {
      if (created) throw error;
      if (error.code !== "EEXIST") throw error;
      const snapshot = readLockSnapshot(lockDir);
      if (snapshot && snapshotHolderIsDead(snapshot)) {
        if (breakDeadLock(lockDir, snapshot)) continue;
      }
      if (waited >= RUN_LOCK_WAIT_TICKS) return void 0;
      sleepSyncMs(TICK_MS);
      waited += 1;
    }
  }
}
function breakDeadLock(lockDir, observed) {
  const takeoverClaim = `${lockDir}.takeover`;
  const claimOwner = (0, import_crypto.randomUUID)();
  try {
    (0, import_fs2.mkdirSync)(takeoverClaim);
    try {
      (0, import_fs2.writeFileSync)(`${takeoverClaim}/owner`, claimOwner, { flag: "wx" });
      (0, import_fs2.writeFileSync)(`${takeoverClaim}/pid`, String(process.pid), { flag: "wx" });
    } catch (error) {
      cleanupIncompleteAcquisition(takeoverClaim, claimOwner);
      throw error;
    }
  } catch (error) {
    if (error.code === "EEXIST") {
      return recoverAbandonedTakeoverClaim(takeoverClaim) ? breakDeadLock(lockDir, observed) : false;
    }
    throw error;
  }
  const quarantined = `${lockDir}.stale-${(0, import_crypto.randomUUID)()}`;
  try {
    const current = readLockSnapshot(lockDir);
    if (!snapshotsEqual(observed, current) || !current || !snapshotHolderIsDead(current)) {
      return false;
    }
    try {
      (0, import_fs2.renameSync)(lockDir, quarantined);
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
    const moved = readLockSnapshot(quarantined);
    if (snapshotsEqual(current, moved) && moved && snapshotHolderIsDead(moved)) {
      try {
        (0, import_fs2.unlinkSync)(`${quarantined}/pid`);
      } catch {
      }
      try {
        (0, import_fs2.unlinkSync)(`${quarantined}/owner`);
      } catch {
      }
      (0, import_fs2.rmdirSync)(quarantined);
      return true;
    }
    try {
      (0, import_fs2.renameSync)(quarantined, lockDir);
    } catch {
    }
    throw new Error(`Run.json lock ownership changed during stale takeover: ${lockDir}`);
  } finally {
    releaseLock(takeoverClaim, claimOwner);
  }
}
function readTakeoverClaimSnapshot(claimDir) {
  try {
    const entries = (0, import_fs2.readdirSync)(claimDir).sort();
    let pidText;
    let ownerToken;
    try {
      pidText = (0, import_fs2.readFileSync)(`${claimDir}/pid`, "utf8").trim() || void 0;
    } catch {
    }
    try {
      ownerToken = (0, import_fs2.readFileSync)(`${claimDir}/owner`, "utf8").trim() || void 0;
    } catch {
    }
    return { pidText, ownerToken, entries, mtimeMs: (0, import_fs2.statSync)(claimDir).mtimeMs };
  } catch {
    return void 0;
  }
}
function takeoverClaimSnapshotsEqual(left, right) {
  return right !== void 0 && left.pidText === right.pidText && left.ownerToken === right.ownerToken && left.mtimeMs === right.mtimeMs && isDeepStringArrayEqual(left.entries, right.entries);
}
function isDeepStringArrayEqual(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
function takeoverClaimIsRecoverable(snapshot) {
  if (snapshot.entries.some((entry) => entry !== "owner" && entry !== "pid")) return false;
  if (snapshot.pidText) {
    return snapshotHolderIsDead({ pidText: snapshot.pidText, ownerToken: snapshot.ownerToken });
  }
  return Date.now() - snapshot.mtimeMs >= TAKEOVER_CLAIM_INIT_GRACE_MS;
}
function recoverAbandonedTakeoverClaim(claimDir) {
  const observed = readTakeoverClaimSnapshot(claimDir);
  if (!observed || !takeoverClaimIsRecoverable(observed)) return false;
  const quarantined = `${claimDir}.abandoned-${(0, import_crypto.randomUUID)()}`;
  try {
    const current = readTakeoverClaimSnapshot(claimDir);
    if (!takeoverClaimSnapshotsEqual(observed, current) || !current || !takeoverClaimIsRecoverable(current)) {
      return false;
    }
    try {
      (0, import_fs2.renameSync)(claimDir, quarantined);
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
    const moved = readTakeoverClaimSnapshot(quarantined);
    if (takeoverClaimSnapshotsEqual(current, moved) && moved && takeoverClaimIsRecoverable(moved)) {
      try {
        (0, import_fs2.unlinkSync)(`${quarantined}/pid`);
      } catch {
      }
      try {
        (0, import_fs2.unlinkSync)(`${quarantined}/owner`);
      } catch {
      }
      (0, import_fs2.rmdirSync)(quarantined);
      return true;
    }
    try {
      (0, import_fs2.renameSync)(quarantined, claimDir);
    } catch {
    }
    return false;
  } catch {
    return false;
  }
}
function readOwnerToken(lockDir) {
  try {
    return (0, import_fs2.readFileSync)(`${lockDir}/owner`, "utf-8").trim() || void 0;
  } catch {
    return void 0;
  }
}
function cleanupIncompleteAcquisition(lockDir, ownerToken) {
  if (readOwnerToken(lockDir) === ownerToken) {
    try {
      (0, import_fs2.unlinkSync)(`${lockDir}/pid`);
    } catch {
    }
    try {
      (0, import_fs2.unlinkSync)(`${lockDir}/owner`);
    } catch {
    }
  }
  try {
    (0, import_fs2.rmdirSync)(lockDir);
  } catch {
  }
}
function releaseLock(lockDir, ownerToken) {
  if (readOwnerToken(lockDir) !== ownerToken) return;
  const retired = `${lockDir}.release-${ownerToken}`;
  try {
    (0, import_fs2.renameSync)(lockDir, retired);
  } catch {
    return;
  }
  if (readOwnerToken(retired) !== ownerToken) {
    try {
      (0, import_fs2.renameSync)(retired, lockDir);
    } catch {
    }
    return;
  }
  try {
    (0, import_fs2.unlinkSync)(`${retired}/pid`);
  } catch {
  }
  try {
    (0, import_fs2.unlinkSync)(`${retired}/owner`);
  } catch {
  }
  try {
    (0, import_fs2.rmdirSync)(retired);
  } catch {
  }
}
function withRunJsonLock(runJsonPath, fn, onTimeout) {
  const lockDir = `${runJsonPath}.lock`;
  const ownerToken = acquireLock(lockDir);
  if (!ownerToken) {
    onTimeout?.(lockDir);
    throw new RunJsonLockTimeoutError(lockDir, RUN_LOCK_WAIT_TICKS, TICK_MS);
  }
  try {
    return fn();
  } finally {
    releaseLock(lockDir, ownerToken);
  }
}
function writeRunJsonAtomic(runJsonPath, data) {
  const tmp = `${runJsonPath}.tmp.${process.pid}.${(0, import_crypto.randomUUID)()}`;
  try {
    (0, import_fs2.writeFileSync)(tmp, JSON.stringify(data, null, 2), { flag: "wx" });
    (0, import_fs2.renameSync)(tmp, runJsonPath);
  } catch (error) {
    try {
      (0, import_fs2.unlinkSync)(tmp);
    } catch {
    }
    throw error;
  }
}
function writeRunJsonExclusive(runJsonPath, data) {
  const tmp = `${runJsonPath}.create.${process.pid}.${(0, import_crypto.randomUUID)()}`;
  try {
    (0, import_fs2.writeFileSync)(tmp, JSON.stringify(data, null, 2), { flag: "wx" });
    (0, import_fs2.linkSync)(tmp, runJsonPath);
  } finally {
    try {
      (0, import_fs2.unlinkSync)(tmp);
    } catch {
    }
  }
}
var RunJsonLockTimeoutError = class extends Error {
  constructor(lockDir, waitTicks, tickMs) {
    super(`Could not acquire run.json lock ${lockDir} within ${waitTicks} ticks (~${waitTicks * tickMs}ms).`);
    this.lockDir = lockDir;
    this.waitTicks = waitTicks;
    this.tickMs = tickMs;
    this.name = "RunJsonLockTimeoutError";
  }
};

// lib/runs/run-record.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_ajv = __toESM(require_ajv());
var import_ajv_formats = __toESM(require_dist());
var RunRecordValidationError = class extends Error {
  constructor(stage, issues) {
    super(`Invalid ${stage} run record: ${issues.map((issue) => `${issue.code} (${issue.message})`).join(", ")}`);
    this.stage = stage;
    this.issues = issues;
    this.name = "RunRecordValidationError";
  }
};
var compiledRunRecordValidator;
function runRecordSchemaPath() {
  const codeRoot2 = process.env.MENTIKO_CODE_ROOT || (0, import_node_path.resolve)(process.cwd(), "..");
  const libDir = process.env.LIB_DIR || (0, import_node_path.join)(codeRoot2, "lib");
  return (0, import_node_path.join)(libDir, "schemas", "run.schema.json");
}
function loadRunRecordSchema() {
  const schemaPath = runRecordSchemaPath();
  try {
    return JSON.parse((0, import_node_fs.readFileSync)(schemaPath, "utf-8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load run record schema from ${schemaPath}: ${reason}`);
  }
}
function runRecordValidator() {
  if (!compiledRunRecordValidator) {
    const ajv = new import_ajv.default({ allErrors: true, strict: false });
    (0, import_ajv_formats.default)(ajv);
    const fullDateTime = import_ajv_formats.default.get("date-time", "full");
    ajv.addFormat("date-time", {
      validate: (value2) => /^\d{4}-\d{2}-\d{2}[Tt]/.test(value2) && fullDateTime.validate(value2)
    });
    compiledRunRecordValidator = ajv.compile(loadRunRecordSchema());
  }
  return compiledRunRecordValidator;
}
function validateRawRunRecord(content) {
  if (content.trim() === "") {
    return {
      valid: false,
      issues: [{ code: "empty-file", message: "Run record file must not be empty." }]
    };
  }
  let value2;
  try {
    value2 = JSON.parse(content);
  } catch (error) {
    return {
      valid: false,
      issues: [{
        code: "invalid-json",
        message: error instanceof Error ? error.message : "Run record is not valid JSON."
      }]
    };
  }
  if (!isPlainRecord(value2)) {
    return {
      valid: false,
      issues: [{ code: "invalid-root", message: "Run record JSON root must be an object." }]
    };
  }
  return { valid: true, value: value2, issues: [] };
}
function validateRunRecord(value2) {
  if (!isPlainRecord(value2)) {
    return {
      valid: false,
      issues: [{ code: "invalid-record", message: "Run record must be an object." }]
    };
  }
  const validator = runRecordValidator();
  const issues = validator(value2) ? [] : (validator.errors ?? []).map(runRecordIssueFromSchemaError);
  if (Array.isArray(value2.agents)) {
    const agentIds = value2.agents.filter(isPlainRecord).map((agent) => agent.id).filter((id) => typeof id === "string");
    if (new Set(agentIds).size !== agentIds.length) {
      issues.push({
        code: "duplicate-agent",
        field: "agents",
        message: "Run agents must not contain duplicate ids."
      });
    }
  }
  return { valid: issues.length === 0, issues };
}
function parseRunRecord(content) {
  const raw = validateRawRunRecord(content);
  if (!raw.valid || !raw.value) throw new RunRecordValidationError("raw", raw.issues);
  const normalized = validateRunRecord(raw.value);
  if (!normalized.valid) throw new RunRecordValidationError("normalized", normalized.issues);
  return raw.value;
}
function assertRunRecord(value2) {
  const validation = validateRunRecord(value2);
  if (!validation.valid) throw new RunRecordValidationError("normalized", validation.issues);
}
function runRecordIssueFromSchemaError(error) {
  let field = fieldFromInstancePath(error.instancePath);
  if (error.keyword === "required") {
    field = appendField(field, String(error.params.missingProperty || ""));
  } else if (error.keyword === "additionalProperties") {
    field = appendField(field, String(error.params.additionalProperty || ""));
  }
  let code;
  if (error.keyword === "required") code = "missing-field";
  else if (error.keyword === "type") code = "invalid-field-type";
  else if (error.keyword === "minLength") code = "empty-field";
  else if (error.keyword === "pattern" && field === "id") code = "invalid-run-id";
  else if (error.keyword === "enum" && (field === "status" || field?.endsWith(".status"))) code = "invalid-status";
  else if (error.keyword === "format" && error.params.format === "date-time") {
    code = "invalid-timestamp";
  } else if (error.keyword === "uniqueItems" && field === "sessions") code = "duplicate-session";
  else if (error.keyword === "additionalProperties") code = "unknown-field";
  else code = "invalid-value";
  return {
    code,
    ...field ? { field } : {},
    message: `${field || "Run record"} ${error.message || `failed ${error.keyword} validation`}.`
  };
}
function fieldFromInstancePath(instancePath) {
  const segments = instancePath.split("/").slice(1).map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (segments.length === 0) return void 0;
  let result = "";
  for (const segment of segments) {
    result = /^\d+$/.test(segment) ? `${result}[${segment}]` : appendField(result || void 0, segment) || "";
  }
  return result || void 0;
}
function appendField(prefix, field) {
  if (!field) return prefix;
  return prefix ? `${prefix}.${field}` : field;
}
function isPlainRecord(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2);
}

// lib/runner-v2/handoff-liveness.ts
var MAX_PENDING_HANDOFF_HEARTBEAT_AGE_MS = 2 * 60 * 1e3;
function objectValue(value2) {
  return value2 && typeof value2 === "object" && !Array.isArray(value2) ? value2 : void 0;
}
function pendingHandoffs(run) {
  const runnerV2 = objectValue(run.runnerV2);
  if (!Array.isArray(runnerV2?.pendingHandoffs)) return [];
  return runnerV2.pendingHandoffs.flatMap((value2) => {
    const item = objectValue(value2);
    const targetAgentIds = Array.isArray(item?.targetAgentIds) ? item.targetAgentIds.filter((id) => typeof id === "string" && id.length > 0) : [];
    return Number.isInteger(item?.pid) && Number(item?.pid) > 0 && targetAgentIds.length > 0 ? [{
      ...typeof item?.id === "string" && item.id ? { id: item.id } : {},
      pid: Number(item?.pid),
      targetAgentIds,
      startedAt: typeof item?.startedAt === "string" ? item.startedAt : "",
      ...typeof item?.heartbeatAt === "string" ? { heartbeatAt: item.heartbeatAt } : {}
    }] : [];
  });
}
function clearPendingHandoffAgent(runnerV2Value, agentId) {
  const runnerV2 = objectValue(runnerV2Value);
  if (!runnerV2) return void 0;
  const remaining = pendingHandoffs({ runnerV2 }).flatMap((handoff) => {
    const targetAgentIds = handoff.targetAgentIds.filter((id) => id !== agentId);
    return targetAgentIds.length > 0 ? [{ ...handoff, targetAgentIds }] : [];
  });
  return { ...runnerV2, pendingHandoffs: remaining };
}

// lib/runner-v2/run-state.ts
var TERMINAL_RUN_STATUSES = /* @__PURE__ */ new Set(["blocked", "failed", "stopped", "completed", "cancelled"]);
var TerminalRunRevivalError = class extends Error {
};
function nowIso(now = /* @__PURE__ */ new Date()) {
  return now.toISOString();
}
function readRunJson(runJsonPath) {
  return parseRunRecord((0, import_fs3.readFileSync)(runJsonPath, "utf-8"));
}
function updateRunJson(runJsonPath, update, onLockTimeout, onMutation) {
  return withRunJsonLock(runJsonPath, () => {
    const current = (0, import_fs3.existsSync)(runJsonPath) ? readRunJson(runJsonPath) : void 0;
    const next = update(current);
    assertRunRecord(next);
    if (current && next.id !== current.id) {
      throw new Error(`run.json mutation cannot change id from ${current.id} to ${next.id}`);
    }
    if (current) writeRunJsonAtomic(runJsonPath, next);
    else writeRunJsonExclusive(runJsonPath, next);
    onMutation?.({ before: current, after: readRunJson(runJsonPath) });
    return next;
  }, onLockTimeout);
}
function updateRunStatus(runJsonPath, status, statusMessage, now = /* @__PURE__ */ new Date(), onMutation) {
  return updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const successfulTerminal = status === "completed";
    const active = status === "running";
    return {
      ...current,
      status,
      ...statusMessage ? { status_message: statusMessage } : successfulTerminal || active ? { status_message: void 0 } : {},
      ...TERMINAL_RUN_STATUSES.has(status) && (!current.completed || successfulTerminal && current.status !== "completed") ? { completed: nowIso(now) } : active ? { completed: void 0 } : {}
    };
  }, void 0, onMutation);
}
function addRunSession(runJsonPath, sessionName, agentId, agentName = agentId, now = /* @__PURE__ */ new Date()) {
  return updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const revivableWatchdogStop = isRevivableWatchdogStop(current);
    if (TERMINAL_RUN_STATUSES.has(current.status) && !revivableWatchdogStop) {
      throw new TerminalRunRevivalError(
        `cannot add session ${sessionName}: run ${current.id} is terminal (${current.status})`
      );
    }
    const agents = [...current.agents || []];
    const existing = agents.findIndex((agent) => agent.id === agentId);
    const nextAgent = {
      ...existing >= 0 ? agents[existing] : {},
      id: agentId,
      name: agentName,
      session: sessionName,
      status: "running",
      completed: void 0,
      started: (existing >= 0 ? agents[existing].started : void 0) || nowIso(now)
    };
    if (existing >= 0) agents[existing] = nextAgent;
    else agents.push(nextAgent);
    const runnerV2 = clearPendingHandoffAgent(current.runnerV2, agentId);
    if (revivableWatchdogStop && runnerV2) {
      delete runnerV2.watchdog;
    }
    return {
      ...current,
      status: "running",
      completed: void 0,
      status_message: void 0,
      ...runnerV2 ? { runnerV2 } : {},
      sessions: Array.from(/* @__PURE__ */ new Set([...current.sessions || [], sessionName])),
      agents
    };
  });
}
function isRevivableWatchdogStop(run) {
  if (run.status !== "stopped" || !run.runnerV2 || typeof run.runnerV2 !== "object") return false;
  const watchdog = run.runnerV2.watchdog;
  if (!watchdog || typeof watchdog !== "object" || Array.isArray(watchdog)) return false;
  const marker = watchdog;
  return marker.status === "stalled" && !marker.eventEmittedAt && !marker.externalEffectsQueuedAt && !marker.hooksDispatchedAt;
}

// lib/runner-v2/launch-job.ts
var PERSISTED_ENV_KEYS = /* @__PURE__ */ new Set([
  "AGENT_FAN_GROUP_ID",
  "AGENTS_DIR",
  "AGENT_PROFILES_DIR",
  "CHAIN_DIR",
  "CONFIG_PROFILES_DIR",
  "EVENTS_DIR",
  "MAX_CONCURRENT_AGENTS",
  "MENTIKO_AGENT_CAP_MAX_WAIT_SECS",
  "MENTIKO_AGENT_CAP_POLL_MAX_SECS",
  "MENTIKO_AGENT_CAP_POLL_SECS",
  "MENTIKO_CAP_DISABLED",
  "MENTIKO_CAP_MAX_WAIT_SECS",
  "MENTIKO_CAP_POLL_MAX_SECS",
  "MENTIKO_CAP_POLL_SECS",
  "MENTIKO_CODE_ROOT",
  "MENTIKO_DEBUG",
  "MENTIKO_GLOBAL_ROOT",
  "MENTIKO_MAX_ACTIVE_AGENTS",
  "MENTIKO_MAX_CONCURRENT_CHAINS",
  "MENTIKO_NAMESPACE_ROOT",
  "MENTIKO_ORG_ROOT",
  "MENTIKO_PROJECT_DIR",
  "MENTIKO_PROJECT_ID",
  "MENTIKO_PROJECT_ROOT",
  "MENTIKO_TASK_ID",
  "MENTIKO_WEB_URL",
  "MENTIKO_WORKSPACE_BASE_COMMIT",
  "MENTIKO_WORKSPACE_PATH",
  "NAMESPACE_ID",
  "ORG_ID",
  "PTY_DAEMON",
  "PTY_MANAGER_DIR",
  "RUNS_DIR",
  "STATE_DIR"
]);
function routedLaunchJobId(input) {
  const targetAgentIds = normalizeTargetIds(input.targetAgentIds);
  if (!input.occurrenceId) throw new Error("routed launch job requires a completion occurrence id");
  if (!input.runId) throw new Error("routed launch job requires a run id");
  if (targetAgentIds.length === 0) throw new Error("routed launch job requires at least one target");
  const digest2 = (0, import_node_crypto.createHash)("sha256").update(stableSerialize({ occurrenceId: input.occurrenceId, runId: input.runId, targetAgentIds })).digest("hex").slice(0, 24);
  return `routed-launch:${digest2}:v1`;
}
function persistRoutedLaunchJob(input) {
  const targetAgentIds = normalizeTargetIds(input.targetAgentIds);
  const expectedId = routedLaunchJobId({
    occurrenceId: input.occurrenceId,
    runId: input.runId,
    targetAgentIds
  });
  if (input.jobId && input.jobId !== expectedId) {
    throw new Error(`routed launch job id mismatch: expected ${expectedId}`);
  }
  const at = (input.now || /* @__PURE__ */ new Date()).toISOString();
  const candidate = {
    version: 1,
    id: expectedId,
    occurrenceId: input.occurrenceId,
    runId: input.runId,
    runDir: input.runDir,
    chainPath: input.chainPath,
    targets: targetAgentIds.map((agentId) => ({ agentId })),
    environment: persistedEnvironment(input.environment || {}),
    status: "queued",
    attemptCount: 0,
    createdAt: at,
    updatedAt: at
  };
  let persisted;
  updateRunJson(input.runJsonPath, (run) => {
    if (!run) throw new Error(`run.json not found: ${input.runJsonPath}`);
    if (run.id !== input.runId) throw new Error(`routed launch job run id mismatch: ${input.runId}`);
    const jobs = launchJobMap(run);
    const existing = jobs[expectedId];
    if (existing) {
      assertSameLaunchIdentity(existing, candidate);
      persisted = existing;
      return run;
    }
    persisted = candidate;
    return withLaunchJobs(run, { ...jobs, [expectedId]: candidate });
  });
  if (!persisted) throw new Error(`routed launch job was not persisted: ${expectedId}`);
  return persisted;
}
function readRoutedLaunchJob(runJsonPath, jobId) {
  return launchJobMap(readRunJson(runJsonPath))[jobId];
}
function claimRoutedLaunchJob(input) {
  if (!input.ownerId) throw new Error("routed launch job claim requires an owner id");
  if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0) {
    throw new Error("routed launch job lease must be a positive safe integer");
  }
  const now = input.now || /* @__PURE__ */ new Date();
  return mutateLaunchJob(input.runJsonPath, input.jobId, (job) => {
    if (job.status === "completed" || job.status === "blocked") return void 0;
    if (job.status === "leased" && job.lease?.ownerId !== input.ownerId && Date.parse(job.lease?.expiresAt || "") > now.getTime()) return void 0;
    const at = now.toISOString();
    return {
      ...job,
      status: "leased",
      lease: {
        ownerId: input.ownerId,
        pid: input.pid,
        acquiredAt: job.lease?.ownerId === input.ownerId ? job.lease.acquiredAt : at,
        heartbeatAt: at,
        expiresAt: new Date(now.getTime() + input.leaseMs).toISOString()
      },
      attemptCount: job.lease?.ownerId === input.ownerId ? job.attemptCount : job.attemptCount + 1,
      updatedAt: at,
      lastError: void 0
    };
  });
}
function heartbeatRoutedLaunchJob(input) {
  const now = input.now || /* @__PURE__ */ new Date();
  return Boolean(mutateLaunchJob(input.runJsonPath, input.jobId, (job) => {
    if (job.status !== "leased" || job.lease?.ownerId !== input.ownerId) return void 0;
    const at = now.toISOString();
    return {
      ...job,
      lease: {
        ...job.lease,
        heartbeatAt: at,
        expiresAt: new Date(now.getTime() + input.leaseMs).toISOString()
      },
      updatedAt: at
    };
  }));
}
function routedLaunchJobLeaseOwned(input) {
  const job = readRoutedLaunchJob(input.runJsonPath, input.jobId);
  const now = (input.now || /* @__PURE__ */ new Date()).getTime();
  return job?.status === "leased" && job.lease?.ownerId === input.ownerId && Date.parse(job.lease.expiresAt) > now;
}
function bindRoutedLaunchJobAttempt(input) {
  const at = (input.now || /* @__PURE__ */ new Date()).toISOString();
  const updated = mutateLaunchJob(input.runJsonPath, input.jobId, (job) => {
    if (job.status !== "leased" || job.lease?.ownerId !== input.ownerId) {
      throw new Error(`routed launch job lease is not owned: ${input.jobId}`);
    }
    const targetIndex = job.targets.findIndex((target2) => target2.agentId === input.agentId);
    if (targetIndex < 0) throw new Error(`agent ${input.agentId} is not a target of ${input.jobId}`);
    const targets = [...job.targets];
    const target = targets[targetIndex];
    if (target.attemptId && target.attemptId !== input.attemptId) {
      targets[targetIndex] = { ...target, attemptId: input.attemptId };
    } else {
      targets[targetIndex] = { ...target, attemptId: target.attemptId || input.attemptId };
    }
    return { ...job, targets, updatedAt: at };
  });
  if (!updated) throw new Error(`routed launch job was not updated: ${input.jobId}`);
  return updated;
}
function releaseRoutedLaunchJob(input) {
  const at = (input.now || /* @__PURE__ */ new Date()).toISOString();
  return Boolean(mutateLaunchJob(input.runJsonPath, input.jobId, (job) => {
    if (job.status !== "leased" || job.lease?.ownerId !== input.ownerId) return void 0;
    return {
      ...job,
      status: "queued",
      lease: void 0,
      updatedAt: at,
      lastError: input.error
    };
  }));
}
function completeRoutedLaunchJob(input) {
  const at = (input.now || /* @__PURE__ */ new Date()).toISOString();
  return Boolean(mutateLaunchJob(input.runJsonPath, input.jobId, (job) => {
    if (job.status === "completed") return job;
    if (job.status !== "leased" || job.lease?.ownerId !== input.ownerId) return void 0;
    return { ...job, status: "completed", lease: void 0, completedAt: at, updatedAt: at };
  }));
}
function blockRoutedLaunchJob(input) {
  const at = (input.now || /* @__PURE__ */ new Date()).toISOString();
  return Boolean(mutateLaunchJob(input.runJsonPath, input.jobId, (job) => {
    if (job.status === "blocked") return job;
    if (job.status !== "leased" || job.lease?.ownerId !== input.ownerId) return void 0;
    return {
      ...job,
      status: "blocked",
      lease: void 0,
      blockedAt: at,
      updatedAt: at,
      lastError: input.reason
    };
  }));
}
function startRoutedLaunchJobHeartbeat(input) {
  const interval = setInterval(() => {
    try {
      heartbeatRoutedLaunchJob(input);
    } catch (error) {
      console.error(`[runner-v2] routed launch job heartbeat failed: ${errorMessage(error)}`);
    }
  }, input.intervalMs || Math.max(1e3, Math.floor(input.leaseMs / 4)));
  interval.unref();
  return () => clearInterval(interval);
}
function persistedEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key, value2]) => PERSISTED_ENV_KEYS.has(key) && typeof value2 === "string").sort(([left], [right]) => left.localeCompare(right)));
}
function normalizeTargetIds(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}
function launchJobMap(run) {
  const runnerV2 = objectValue2(run.runnerV2);
  const raw = objectValue2(runnerV2?.launchJobs);
  if (!raw) return {};
  const jobs = {};
  for (const [key, value2] of Object.entries(raw)) {
    const job = parseLaunchJob(value2);
    if (job.id !== key) throw new Error(`corrupt routed launch job key: ${key}`);
    jobs[key] = job;
  }
  return jobs;
}
function parseLaunchJob(value2) {
  const job = objectValue2(value2);
  if (!job || job.version !== 1 || typeof job.id !== "string" || typeof job.occurrenceId !== "string" || typeof job.runId !== "string" || typeof job.runDir !== "string" || typeof job.chainPath !== "string" || !Array.isArray(job.targets) || !job.targets.every((target) => {
    const parsed = objectValue2(target);
    return typeof parsed?.agentId === "string" && (parsed.attemptId === void 0 || typeof parsed.attemptId === "string");
  }) || !objectValue2(job.environment) || !["queued", "leased", "completed", "blocked"].includes(String(job.status)) || !Number.isSafeInteger(job.attemptCount) || typeof job.createdAt !== "string" || typeof job.updatedAt !== "string") {
    throw new Error("corrupt routed launch job record");
  }
  if (job.status === "leased") {
    const lease = objectValue2(job.lease);
    if (!lease || typeof lease.ownerId !== "string" || typeof lease.acquiredAt !== "string" || typeof lease.heartbeatAt !== "string" || typeof lease.expiresAt !== "string") {
      throw new Error(`corrupt routed launch job lease: ${job.id}`);
    }
  }
  return job;
}
function mutateLaunchJob(runJsonPath, jobId, update) {
  let result;
  updateRunJson(runJsonPath, (run) => {
    if (!run) throw new Error(`run.json not found: ${runJsonPath}`);
    const jobs = launchJobMap(run);
    const current = jobs[jobId];
    if (!current) return run;
    result = update(current);
    if (!result) return run;
    return withLaunchJobs(run, { ...jobs, [jobId]: result });
  });
  return result;
}
function withLaunchJobs(run, jobs) {
  return {
    ...run,
    runnerV2: {
      ...objectValue2(run.runnerV2),
      launchJobs: jobs
    }
  };
}
function assertSameLaunchIdentity(existing, expected) {
  const existingIdentity = {
    id: existing.id,
    occurrenceId: existing.occurrenceId,
    runId: existing.runId,
    runDir: existing.runDir,
    chainPath: existing.chainPath,
    targets: existing.targets.map((target) => target.agentId).sort(),
    environment: existing.environment
  };
  const expectedIdentity = {
    id: expected.id,
    occurrenceId: expected.occurrenceId,
    runId: expected.runId,
    runDir: expected.runDir,
    chainPath: expected.chainPath,
    targets: expected.targets.map((target) => target.agentId).sort(),
    environment: expected.environment
  };
  if (stableSerialize(existingIdentity) !== stableSerialize(expectedIdentity)) {
    throw new Error(`conflicting routed launch job: ${expected.id}`);
  }
}
function objectValue2(value2) {
  return value2 && typeof value2 === "object" && !Array.isArray(value2) ? value2 : void 0;
}
function stableSerialize(value2) {
  if (Array.isArray(value2)) return `[${value2.map(stableSerialize).join(",")}]`;
  const record = objectValue2(value2);
  if (!record) return JSON.stringify(value2);
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// lib/runner-v2/launch-job-runner.ts
var import_node_fs11 = require("node:fs");
var import_node_path13 = require("node:path");

// lib/config.ts
var import_path2 = __toESM(require("path"));
var import_os = require("os");

// config/agent-provider-catalog.json
var agent_provider_catalog_default = {
  cliTools: [
    {
      id: "claude",
      name: "Claude Code",
      cli: "claude",
      description: "Anthropic Claude CLI - most capable",
      iconKey: "claude",
      color: "text-amber-400",
      badgeColor: "text-amber-300",
      badgeBg: "bg-amber-500/20",
      credentialKey: "claude",
      bundleProvider: "claude-code",
      terminalAuthCommand: "claude auth login",
      interactiveAuthCommand: "claude auth login",
      detectable: true
    },
    {
      id: "codex",
      name: "Codex",
      cli: "codex",
      description: "OpenAI Codex - code generation",
      iconKey: "openai",
      color: "text-emerald-400",
      badgeColor: "text-emerald-300",
      badgeBg: "bg-emerald-500/20",
      credentialKey: "codex",
      bundleProvider: "codex",
      terminalAuthCommand: "codex login --device-auth",
      interactiveAuthCommand: "codex login --device-auth",
      detectable: true
    },
    {
      id: "aider",
      name: "Aider",
      cli: "aider",
      description: "Aider - AI pair programming",
      iconKey: "aider",
      color: "text-indigo-400",
      badgeColor: "text-indigo-300",
      badgeBg: "bg-indigo-500/20",
      terminalAuthCommand: "aider --help",
      detectable: true
    },
    {
      id: "antigravity",
      name: "Antigravity CLI",
      cli: "agy",
      description: "Google Antigravity CLI - terminal agent harness",
      iconKey: "antigravity",
      color: "text-blue-400",
      badgeColor: "text-blue-300",
      badgeBg: "bg-blue-500/20",
      credentialKey: "gemini",
      bundleProvider: "antigravity",
      terminalAuthCommand: "agy",
      interactiveAuthCommand: "agy",
      detectable: true
    },
    {
      id: "kollab",
      name: "Kollab",
      cli: "kollab",
      description: "Kollab - collaborative AI",
      iconKey: "kollab",
      color: "text-purple-400",
      badgeColor: "text-purple-300",
      badgeBg: "bg-purple-500/20",
      credentialKey: "kollab",
      bundleProvider: "kollab",
      terminalAuthCommand: "kollab --login openai",
      detectable: true
    },
    {
      id: "opencode",
      name: "OpenCode",
      cli: "opencode",
      description: "OpenCode - multi-provider coding runner",
      iconKey: "openai",
      color: "text-indigo-400",
      badgeColor: "text-indigo-300",
      badgeBg: "bg-indigo-500/20",
      credentialKey: "opencode",
      bundleProvider: "opencode",
      terminalAuthCommand: "opencode auth login",
      detectable: false
    }
  ],
  providerCredentials: {
    claude: {
      envKey: "ANTHROPIC_AUTH_TOKEN",
      label: "Anthropic API Key",
      placeholder: "sk-ant-...",
      docsUrl: "https://console.anthropic.com/settings/keys",
      docsLabel: "Get API key"
    },
    gemini: {
      envKey: "GEMINI_API_KEY",
      label: "Google Gemini API Key",
      placeholder: "AIza...",
      docsUrl: "https://aistudio.google.com/app/apikey",
      docsLabel: "Get API key"
    },
    codex: {
      envKey: "OPENAI_API_KEY",
      label: "OpenAI API Key",
      placeholder: "sk-...",
      docsUrl: "https://platform.openai.com/api-keys",
      docsLabel: "Get API key"
    },
    opencode: {
      envKey: "OPENAI_API_KEY",
      label: "OpenAI API Key",
      placeholder: "sk-...",
      docsUrl: "https://platform.openai.com/api-keys",
      docsLabel: "Get API key"
    },
    kollab: {
      envKey: "KOLLAB_API_KEY",
      label: "Kollab API Key",
      placeholder: "sk-...",
      docsUrl: "https://github.com/kollaborai/kollab#readme",
      docsLabel: "Kollab auth docs"
    }
  },
  secretPresets: [
    { label: "Anthropic API Key", envVar: "ANTHROPIC_AUTH_TOKEN" },
    { label: "OpenAI API Key", envVar: "OPENAI_API_KEY" },
    { label: "Google Gemini API Key", envVar: "GEMINI_API_KEY" },
    { label: "Kollab API Key", envVar: "KOLLAB_API_KEY" },
    { label: "GitHub Token", envVar: "GITHUB_TOKEN" },
    { label: "Custom", envVar: "" }
  ],
  profileBundles: [
    {
      provider: "claude-code",
      name: "Claude Code",
      logoKey: "claude-code",
      log_path: "~/.claude/projects/",
      log_format: "jsonl",
      profiles: [
        {
          id: "claude-sonnet",
          name: "Claude / Sonnet",
          cli: "claude",
          model: "sonnet",
          pipe_flag: "-p",
          permission_flag: "--dangerously-skip-permissions",
          pre_exec: "unset CLAUDECODE",
          readiness: { enabled: true, ready_patterns: [{ name: "claude input-ready hint", type: "text", value: "for agents", action: "ready", risk: "low", enabled: true }] },
          description: "Balanced performance - always latest Sonnet"
        },
        {
          id: "claude-opus",
          name: "Claude / Opus",
          cli: "claude",
          model: "opus",
          pipe_flag: "-p",
          permission_flag: "--dangerously-skip-permissions",
          pre_exec: "unset CLAUDECODE",
          readiness: { enabled: true, ready_patterns: [{ name: "claude input-ready hint", type: "text", value: "for agents", action: "ready", risk: "low", enabled: true }] },
          description: "Highest capability - always latest Opus"
        },
        {
          id: "claude-haiku",
          name: "Claude / Haiku",
          cli: "claude",
          model: "haiku",
          pipe_flag: "-p",
          permission_flag: "--dangerously-skip-permissions",
          pre_exec: "unset CLAUDECODE",
          readiness: { enabled: true, ready_patterns: [{ name: "claude input-ready hint", type: "text", value: "for agents", action: "ready", risk: "low", enabled: true }] },
          description: "Fastest for simple tasks - always latest Haiku"
        }
      ]
    },
    {
      provider: "codex",
      name: "Codex",
      logoKey: "codex",
      log_path: "~/.codex/sessions/",
      log_format: "jsonl",
      profiles: [
        {
          id: "codex-default",
          name: "Codex / GPT-5.5",
          cli: "codex",
          model: "gpt-5.5",
          pipe_flag: "exec",
          permission_flag: "--dangerously-bypass-approvals-and-sandbox",
          readiness: {
            enabled: true,
            ready_patterns: [{ name: "codex tui banner", type: "text", value: "OpenAI Codex (v", action: "ready", risk: "low", enabled: true }, { name: "codex input placeholder", type: "text", value: "Find and fix a bug", action: "ready", risk: "low", enabled: true }],
            blocked_patterns: [
              {
                name: "unsupported skip git repo check arg",
                type: "text",
                value: "unexpected argument '--skip-git-repo-check'",
                action: "block",
                risk: "low",
                enabled: true
              }
            ],
            retry_patterns: [
              {
                name: "cli install or update in progress",
                type: "regex",
                value: "(installing|updating|downloading)",
                action: "retry",
                risk: "medium",
                enabled: true
              }
            ],
            recoverable_patterns: [
              {
                name: "press enter to continue",
                type: "regex",
                value: "Press Enter to continue",
                action: "recover",
                risk: "low",
                enabled: true
              }
            ]
          },
          description: "Flagship model for complex coding and agentic work"
        },
        {
          id: "codex-fast",
          name: "Codex / GPT-5.4 mini",
          cli: "codex",
          model: "gpt-5.4-mini",
          pipe_flag: "exec",
          permission_flag: "--dangerously-bypass-approvals-and-sandbox",
          readiness: {
            enabled: true,
            ready_patterns: [{ name: "codex tui banner", type: "text", value: "OpenAI Codex (v", action: "ready", risk: "low", enabled: true }, { name: "codex input placeholder", type: "text", value: "Find and fix a bug", action: "ready", risk: "low", enabled: true }],
            blocked_patterns: [
              {
                name: "unsupported skip git repo check arg",
                type: "text",
                value: "unexpected argument '--skip-git-repo-check'",
                action: "block",
                risk: "low",
                enabled: true
              }
            ],
            retry_patterns: [
              {
                name: "cli install or update in progress",
                type: "regex",
                value: "(installing|updating|downloading)",
                action: "retry",
                risk: "medium",
                enabled: true
              }
            ],
            recoverable_patterns: [
              {
                name: "press enter to continue",
                type: "regex",
                value: "Press Enter to continue",
                action: "recover",
                risk: "low",
                enabled: true
              }
            ]
          },
          description: "Faster, lower-cost Codex profile for focused tasks"
        }
      ]
    },
    {
      provider: "opencode",
      name: "OpenCode",
      logoKey: "opencode",
      log_path: "~/.config/opencode/",
      log_format: "sqlite",
      profiles: [
        {
          id: "opencode-sonnet",
          name: "OpenCode / Sonnet 4.6",
          cli: "opencode",
          model: "anthropic/claude-sonnet-4-6",
          pipe_flag: "-p",
          readiness: { enabled: true, ready_patterns: [{ name: "opencode input ready", type: "text", value: "Ask anything", action: "ready", risk: "low", enabled: true }, { name: "opencode command hint", type: "text", value: "ctrl+p commands", action: "ready", risk: "low", enabled: true }] },
          description: "Claude Sonnet 4.6 via OpenCode runner"
        },
        {
          id: "opencode-gpt",
          name: "OpenCode / GPT-5.5",
          cli: "opencode",
          model: "openai/gpt-5.5",
          pipe_flag: "-p",
          readiness: { enabled: true, ready_patterns: [{ name: "opencode input ready", type: "text", value: "Ask anything", action: "ready", risk: "low", enabled: true }, { name: "opencode command hint", type: "text", value: "ctrl+p commands", action: "ready", risk: "low", enabled: true }] },
          description: "OpenAI GPT-5.5 via OpenCode runner"
        }
      ]
    },
    {
      provider: "kollab",
      name: "Kollab",
      logoKey: "kollab",
      log_path: "~/.kollab/projects/",
      log_format: "jsonl",
      profiles: [
        {
          id: "kollab",
          name: "Kollab / Mentiko",
          cli: "kollab",
          pipe_flag: "-p",
          permission_flag: "--permissions trust",
          preferredAdvisorDefault: true,
          readiness: { enabled: true, ready_patterns: [{ name: "kollab ready line", type: "text", value: "ready \xB7", action: "ready", risk: "low", enabled: true }, { name: "kollab hooks active", type: "text", value: "hooks active", action: "ready", risk: "low", enabled: true }] },
          description: "Kollab / Mentiko"
        }
      ]
    },
    {
      provider: "antigravity",
      name: "Antigravity CLI",
      logoKey: "antigravity",
      log_path: "~/.gemini/antigravity-cli/",
      log_format: "json",
      profiles: [
        {
          id: "antigravity-default",
          name: "Antigravity / CLI Default",
          cli: "agy",
          permission_flag: "--dangerously-skip-permissions",
          description: "Uses the Antigravity CLI default model and settings"
        }
      ]
    },
    {
      provider: "custom",
      name: "Custom",
      logoKey: "custom",
      profiles: []
    }
  ],
  legacyProfileReplacements: [
    {
      provider: "codex",
      profile: {
        id: "codex-spark",
        name: "Codex / Spark",
        cli: "codex",
        model: "gpt-5.4-mini",
        pipe_flag: "exec",
        permission_flag: "--dangerously-bypass-approvals-and-sandbox",
        readiness: {
          enabled: true,
          blocked_patterns: [
            {
              name: "unsupported skip git repo check arg",
              type: "text",
              value: "unexpected argument '--skip-git-repo-check'",
              action: "block",
              risk: "low",
              enabled: true
            }
          ],
          retry_patterns: [
            {
              name: "cli install or update in progress",
              type: "regex",
              value: "(installing|updating|downloading)",
              action: "retry",
              risk: "medium",
              enabled: true
            }
          ],
          recoverable_patterns: [
            {
              name: "press enter to continue",
              type: "regex",
              value: "Press Enter to continue",
              action: "recover",
              risk: "low",
              enabled: true
            }
          ]
        },
        description: "Legacy Spark profile id synced to the current fast Codex model"
      }
    },
    {
      provider: "antigravity",
      profile: {
        id: "gemini-flash",
        name: "Antigravity / Gemini Flash Legacy",
        cli: "agy",
        permission_flag: "--dangerously-skip-permissions",
        description: "Legacy Gemini Flash profile id synced to Antigravity CLI defaults"
      }
    },
    {
      provider: "antigravity",
      profile: {
        id: "gemini-pro-preview",
        name: "Antigravity / Gemini Pro Preview Legacy",
        cli: "agy",
        permission_flag: "--dangerously-skip-permissions",
        description: "Legacy Gemini Pro preview profile id synced to Antigravity CLI defaults"
      }
    },
    {
      provider: "antigravity",
      profile: {
        id: "gemini-flash-lite",
        name: "Antigravity / Gemini Flash-Lite Legacy",
        cli: "agy",
        permission_flag: "--dangerously-skip-permissions",
        description: "Legacy Gemini Flash-Lite profile id synced to Antigravity CLI defaults"
      }
    },
    {
      provider: "antigravity",
      profile: {
        id: "gemini-pro",
        name: "Antigravity / Gemini Pro Legacy",
        cli: "agy",
        permission_flag: "--dangerously-skip-permissions",
        description: "Legacy Gemini Pro profile id synced to Antigravity CLI defaults"
      }
    }
  ],
  engineProviders: [
    {
      value: "anthropic",
      label: "Anthropic",
      model: "claude-sonnet-4-6",
      baseUrl: "",
      iconKey: "claude"
    },
    {
      value: "openai",
      label: "OpenAI",
      model: "gpt-5.5",
      baseUrl: "",
      iconKey: "openai"
    },
    {
      value: "openrouter",
      label: "OpenRouter",
      model: "deepseek/deepseek-v4-flash",
      baseUrl: "https://openrouter.ai/api/v1",
      iconKey: "openrouter"
    },
    {
      value: "gemini",
      label: "Google Gemini",
      model: "gemini-3.5-flash",
      baseUrl: "",
      iconKey: "gemini"
    },
    {
      value: "custom",
      label: "Custom / Local",
      model: "",
      baseUrl: "",
      iconKey: "custom"
    },
    {
      value: "auto",
      label: "Auto (env vars)",
      model: "",
      baseUrl: "",
      iconKey: "custom"
    }
  ],
  mentikoGatewayProfile: {
    name: "mentiko",
    provider: "openai",
    model: "glm-5.1",
    description: "Mentiko AI gateway (included AI)"
  },
  runtimeDefaults: {
    marketplaceAgentModel: "claude-sonnet-4-6",
    costModel: "claude-sonnet-4-6",
    linkEscalationModel: "haiku",
    codexInlineAuthModel: "gpt-5.5"
  }
};

// lib/agents/agent-provider-catalog.ts
var catalog = agent_provider_catalog_default;
var CLI_TOOLS = catalog.cliTools;
var PROVIDER_CREDENTIALS = catalog.providerCredentials;
var COMMON_PRESETS = catalog.secretPresets;
var PROFILE_BUNDLES = catalog.profileBundles;
var LEGACY_PROFILE_REPLACEMENTS = catalog.legacyProfileReplacements;
var ENGINE_PROVIDER_DEFAULTS = catalog.engineProviders;
var MENTIKO_GATEWAY_PROFILE = catalog.mentikoGatewayProfile;
var DEFAULT_MARKETPLACE_AGENT_MODEL = catalog.runtimeDefaults.marketplaceAgentModel;
var DEFAULT_COST_MODEL = catalog.runtimeDefaults.costModel;
var LINK_ESCALATION_FALLBACK_MODEL = catalog.runtimeDefaults.linkEscalationModel;
var CODEX_INLINE_AUTH_MODEL = catalog.runtimeDefaults.codexInlineAuthModel;

// lib/agents/provider-bundles.ts
var CLAUDE_CODE_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cc-grad" x1="0" y1="0" x2="32" y2="32">
      <stop offset="0%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#dc2626" />
    </linearGradient>
  </defs>
  <path d="M16 2L28 9v14l-12 7-12-7V9z" fill="url(#cc-grad)" />
  <text x="16" y="21" font-family="monospace" font-size="12" font-weight="bold" fill="white" text-anchor="middle">CC</text>
</svg>`;
var CODEX_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="4" width="24" height="24" rx="4" fill="#10b981" />
  <text x="16" y="22" font-family="monospace" font-size="14" font-weight="bold" fill="white" text-anchor="middle">C</text>
</svg>`;
var OPENCODE_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="12" fill="#3b82f6" />
  <text x="16" y="21" font-family="monospace" font-size="12" font-weight="bold" fill="white" text-anchor="middle">O</text>
</svg>`;
var KOLLAB_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 2L28 9v14l-12 7-12-7V9z" fill="#8b5cf6" />
  <text x="16" y="21" font-family="monospace" font-size="12" font-weight="bold" fill="white" text-anchor="middle">K</text>
</svg>`;
var ANTIGRAVITY_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="antigravity-grad" x1="0" y1="0" x2="32" y2="32">
      <stop offset="0%" stop-color="#4285f4" />
      <stop offset="100%" stop-color="#9c5cf6" />
    </linearGradient>
  </defs>
  <path d="M16 2 C17 10 22 11 30 16 C22 21 17 22 16 30 C15 22 10 21 2 16 C10 11 15 10 16 2 Z" fill="url(#antigravity-grad)"/>
  <text x="16" y="20" font-family="monospace" font-size="7" font-weight="bold" fill="white" text-anchor="middle">AG</text>
</svg>`;
var CUSTOM_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="10" stroke="#6b7280" stroke-width="3" fill="none" />
  <circle cx="16" cy="16" r="4" fill="#6b7280" />
</svg>`;
var LOGOS = {
  "claude-code": CLAUDE_CODE_LOGO,
  codex: CODEX_LOGO,
  opencode: OPENCODE_LOGO,
  kollab: KOLLAB_LOGO,
  antigravity: ANTIGRAVITY_LOGO,
  custom: CUSTOM_LOGO
};
var PROVIDER_BUNDLES = PROFILE_BUNDLES.map((bundle) => ({
  ...bundle,
  logo: LOGOS[bundle.logoKey] ?? CUSTOM_LOGO
}));

// lib/config.ts
function expandTilde(p) {
  if (p.startsWith("~/") || p === "~") {
    return import_path2.default.join((0, import_os.homedir)(), p.slice(2));
  }
  return p;
}
function slugPart(value2) {
  const slug = value2.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug || "root";
}
function derivePtyDaemonName(root, namespace, org) {
  return [
    "mentiko",
    slugPart(root),
    slugPart(namespace || "default"),
    slugPart(org || "default")
  ].join("-");
}
function encodeProjectPath(dir) {
  return dir.replace(/\//g, "-");
}
var globalRoot = expandTilde(
  process.env.MENTIKO_GLOBAL_ROOT || process.env.MENTIKO_ROOT || import_path2.default.join((0, import_os.homedir)(), ".mentiko")
);
var codeRoot = process.env.MENTIKO_CODE_ROOT || import_path2.default.resolve(process.cwd(), "..");
var namespaceId = process.env.NAMESPACE_ID || "default";
var orgId = process.env.ORG_ID || "default";
var ptyDaemonName = process.env.PTY_DAEMON || derivePtyDaemonName(globalRoot, namespaceId, orgId);
process.env.PTY_DAEMON = ptyDaemonName;
var projectDir = process.env.MENTIKO_PROJECT_DIR || codeRoot;
var projectId = encodeProjectPath(projectDir);
var namespaceRoot = process.env.MENTIKO_NAMESPACE_ROOT || import_path2.default.join(globalRoot, "namespaces", namespaceId);
var orgRoot = process.env.MENTIKO_ORG_ROOT || (orgId === "default" ? namespaceRoot : import_path2.default.join(namespaceRoot, "orgs", orgId));
var projectRoot = process.env.MENTIKO_PROJECT_ROOT || (projectDir === codeRoot ? orgRoot : import_path2.default.join(orgRoot, "projects", projectId));
var claudeProjectsBase = process.env.CLAUDE_PROJECTS_DIR || import_path2.default.join((0, import_os.homedir)(), ".claude", "projects");
var ptyManagerDir = process.env.PTY_MANAGER_DIR || import_path2.default.join((0, import_os.homedir)(), ".pty-manager");
var demoWorkspaceDir = process.env.DEMO_WORKSPACE_DIR || import_path2.default.join(globalRoot, "demo-workspace");
function ptyDaemonEnv() {
  const env = {
    PTY_DAEMON: ptyDaemonName,
    PTY_MANAGER_DIR: ptyManagerDir
  };
  if (process.env.PTY_SOCKET_PATH) env.PTY_SOCKET_PATH = process.env.PTY_SOCKET_PATH;
  return env;
}
function orgPath(nsId, oId, ...segments) {
  if (oId === "default") {
    return import_path2.default.join(globalRoot, "namespaces", nsId, ...segments);
  }
  return import_path2.default.join(globalRoot, "namespaces", nsId, "orgs", oId, ...segments);
}
var config = {
  // --- roots ---
  globalRoot,
  codeRoot,
  namespaceRoot,
  orgRoot,
  projectRoot,
  // --- IDs ---
  namespaceId,
  orgId,
  projectId,
  projectDir,
  // backward compat: root was used for code paths (bin, lib, scripts)
  root: codeRoot,
  // backward compat: namespacesBase used by some API routes
  namespacesBase: import_path2.default.join(globalRoot, "namespaces"),
  // --- tier 1: global ---
  authDbPath: import_path2.default.join(globalRoot, "data", "auth.db"),
  // --- tier 2: namespace ---
  billingDir: import_path2.default.join(namespaceRoot, "billing"),
  namespaceSettingsDir: import_path2.default.join(namespaceRoot, "settings"),
  marketplaceDir: import_path2.default.join(namespaceRoot, "marketplace"),
  // --- tier 3: org ---
  chainsDir: process.env.CHAIN_DIR || import_path2.default.join(orgRoot, "chains"),
  linksDir: process.env.LINKS_DIR || import_path2.default.join(orgRoot, "links"),
  agentsDir: process.env.AGENTS_DIR || import_path2.default.join(orgRoot, "agents"),
  agentProfilesDir: process.env.AGENT_PROFILES_DIR || import_path2.default.join(orgRoot, "agent-profiles"),
  configProfilesDir: process.env.CONFIG_PROFILES_DIR || import_path2.default.join(orgRoot, "config-profiles"),
  templatesDir: process.env.TEMPLATES_DIR || import_path2.default.join(orgRoot, "templates"),
  webhooksDir: process.env.WEBHOOKS_DIR || import_path2.default.join(orgRoot, "webhooks"),
  emailsDir: process.env.EMAILS_DIR || import_path2.default.join(orgRoot, "emails"),
  // --- tier 4: project ---
  runsDir: process.env.RUNS_DIR || import_path2.default.join(projectRoot, "runs"),
  jobsDir: process.env.JOBS_DIR || import_path2.default.join(projectRoot, "jobs"),
  eventsDir: process.env.EVENTS_DIR || import_path2.default.join(projectRoot, "events"),
  stateDir: process.env.STATE_DIR || import_path2.default.join(projectRoot, "state"),
  decisionsDir: process.env.DECISIONS_DIR || import_path2.default.join(projectRoot, "decisions"),
  schedulesDir: process.env.SCHEDULES_DIR || import_path2.default.join(projectRoot, "schedules"),
  metricsDir: process.env.METRICS_DIR || import_path2.default.join(projectRoot, "metrics"),
  notificationsDir: process.env.NOTIFICATIONS_DIR || import_path2.default.join(projectRoot, "notifications"),
  reportsDir: process.env.REPORTS_DIR || import_path2.default.join(projectRoot, "reports"),
  debugDir: process.env.DEBUG_DIR || import_path2.default.join(projectRoot, "debug"),
  workspaceDir: process.env.WORKSPACE_DIR || import_path2.default.join(projectRoot, "workspace"),
  profilesDir: process.env.PROFILES_DIR || import_path2.default.join(projectRoot, "profiles"),
  watchdogHooksDir: process.env.WATCHDOG_HOOKS_DIR || import_path2.default.join(projectRoot, "watchdog-hooks"),
  // --- code root (not data, these are executables/scripts) ---
  binDir: process.env.BIN_DIR || import_path2.default.join(codeRoot, "bin"),
  libDir: process.env.LIB_DIR || import_path2.default.join(codeRoot, "lib"),
  // --- external tool paths (system-level, not data) ---
  ptyManagerDir,
  ptySocketPath: process.env.PTY_SOCKET_PATH || null,
  ptyTokenPath: process.env.PTY_TOKEN_PATH || null,
  ptyDaemonName,
  demoWorkspaceDir,
  claudeProjectsDir: claudeProjectsBase,
  infraSshPublicKey: process.env.MENTIKO_SSH_PUBLIC_KEY || null,
  infraSshPrivateKey: process.env.MENTIKO_SSH_PRIVATE_KEY || null,
  // --- operational ---
  cliBin: process.env.CLI_BIN || "claude",
  sessionPrefix: process.env.SESSION_PREFIX || "mentiko",
  defaultMaxRounds: parseInt(process.env.DEFAULT_MAX_ROUNDS || "50", 10),
  polling: {
    sessions: parseInt(process.env.POLLING_SESSIONS || "3000", 10),
    output: parseInt(process.env.POLLING_OUTPUT || "2000", 10),
    conversations: parseInt(process.env.POLLING_CONVERSATIONS || "5000", 10),
    messages: parseInt(process.env.POLLING_MESSAGES || "3000", 10)
  }
};
var config_default = config;

// lib/runner-v2/bootstrap-executor.ts
var import_fs10 = require("fs");
var import_path8 = require("path");

// lib/pty/pty-client.ts
var import_net = require("net");
var import_path3 = require("path");
var import_fs4 = require("fs");
var import_child_process = require("child_process");
var DAEMON_NAME = config.ptyDaemonName;
var getSocketPath = () => {
  if (config.ptySocketPath) return config.ptySocketPath;
  return (0, import_path3.join)(config.ptyManagerDir, `${DAEMON_NAME}.sock`);
};
var SOCKET_PATH = getSocketPath();
function resolvePtyMgrPath({
  codeRoot: codeRoot2,
  cwd = process.cwd(),
  env = process.env,
  exists = import_fs4.existsSync
}) {
  const libPath = (0, import_path3.join)(codeRoot2, "lib", "pty-manager.mjs");
  const candidates = [
    env.PTY_MGR_BIN,
    env.MENTIKO_PTY_MGR_BIN,
    (0, import_path3.join)(codeRoot2, "node_modules", ".bin", "pty-mgr"),
    (0, import_path3.join)(codeRoot2, "web", "node_modules", ".bin", "pty-mgr"),
    "/usr/local/bin/pty-mgr",
    (0, import_path3.join)(codeRoot2, "bin", "pty-mgr"),
    libPath
  ].filter((path2) => Boolean(path2));
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (exists(candidate)) return candidate;
  }
  let dir = cwd;
  for (let i = 0; i < 5; i++) {
    const binCandidate = (0, import_path3.join)(dir, "bin", "pty-mgr");
    const libCandidate = (0, import_path3.join)(dir, "lib", "pty-manager.mjs");
    if (!seen.has(binCandidate) && exists(binCandidate)) return binCandidate;
    if (!seen.has(libCandidate) && exists(libCandidate)) return libCandidate;
    const parent = (0, import_path3.dirname)(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return libPath;
}
function findPtyMgr() {
  return resolvePtyMgrPath({ codeRoot: config.codeRoot });
}
var PTY_MGR_PATH = findPtyMgr();
function sendCommand(req) {
  return new Promise((resolve8, reject2) => {
    const conn = (0, import_net.createConnection)(SOCKET_PATH);
    let buf = "";
    conn.on("error", (err) => {
      if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
        reject2(new Error("daemon not running"));
      } else {
        reject2(err);
      }
    });
    conn.on("connect", () => {
      conn.write(JSON.stringify(req) + "\n");
    });
    conn.on("data", (data) => {
      buf += data.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        const res = JSON.parse(buf.slice(0, nl));
        conn.end();
        resolve8(res);
      }
    });
    const timeout = setTimeout(() => {
      conn.destroy();
      reject2(new Error("daemon command timed out"));
    }, 1e4);
    conn.on("close", () => clearTimeout(timeout));
  });
}
async function ensurePtyDaemon() {
  try {
    await sendCommand({ cmd: "status" });
    return;
  } catch {
  }
  return new Promise((resolve8, reject2) => {
    let child;
    try {
      const isMjs = PTY_MGR_PATH.endsWith(".mjs");
      const cmd = isMjs ? "node" : PTY_MGR_PATH;
      const args = isMjs ? [PTY_MGR_PATH, "daemon"] : ["daemon"];
      child = (0, import_child_process.spawn)(cmd, args, {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        env: {
          ...process.env,
          MENTIKO_GLOBAL_ROOT: config.globalRoot,
          MENTIKO_CODE_ROOT: config.codeRoot,
          MENTIKO_PROJECT_ROOT: config.projectRoot,
          MENTIKO_ORG_ROOT: config.orgRoot,
          MENTIKO_NAMESPACE_ROOT: config.namespaceRoot,
          NAMESPACE_ID: config.namespaceId,
          ORG_ID: config.orgId,
          ...ptyDaemonEnv()
        }
      });
    } catch {
      return reject2(new Error(`pty-manager binary not found at ${PTY_MGR_PATH}`));
    }
    child.on("error", () => {
    });
    child.unref();
    let retries = 0;
    const check = setInterval(async () => {
      retries++;
      try {
        await sendCommand({ cmd: "status" });
        clearInterval(check);
        resolve8();
      } catch {
        if (retries >= 20) {
          clearInterval(check);
          reject2(new Error("failed to start pty-manager daemon"));
        }
      }
    }, 250);
  });
}
var PtyClient = class {
  // spawn a new session
  async spawn(name, cmd, args, opts) {
    await ensurePtyDaemon();
    const res = await sendCommand({
      cmd: "spawn",
      name,
      args: { cmd: cmd || "zsh", args: args || [], ...opts }
    });
    if (!res.ok) throw new Error(res.error || "spawn failed");
    return { name: res.name, pid: res.pid };
  }
  // send text + enter to a session
  // `enter: true` is REQUIRED for the daemon to submit. Its send handler is
  // `if (enter && !raw) { sleep(config.sendDelay); sendKeys("\r") }` — with
  // `enter` absent it defaults to false and the daemon delivers the text and
  // stops, making this identical to sendRaw. We omitted the flag, so every
  // sendKeys caller here has been typing into the composer without ever
  // pressing return: agent instructions, steer messages, terminal commands,
  // peer-link prompts, monitor nudges. The pty-mgr CLI always sent
  // `enter: !raw`; only this client didn't. The daemon owns the settle delay
  // (config.sendDelay, default 1000ms) — never hand-roll it caller-side.
  async sendKeys(name, text) {
    const res = await sendCommand({
      cmd: "send",
      name,
      args: { text, enter: true }
    });
    if (!res.ok) throw new Error(res.error || "send failed");
  }
  // send raw text (no enter)
  async sendRaw(name, text) {
    const res = await sendCommand({
      cmd: "send",
      name,
      args: { text, raw: true }
    });
    if (!res.ok) throw new Error(res.error || "send failed");
  }
  // capture session output
  async capture(name, lines) {
    const res = await sendCommand({
      cmd: "capture",
      name,
      args: lines ? { lines } : void 0
    });
    if (!res.ok) throw new Error(res.error || "capture failed");
    return res.output || "";
  }
  // check if session exists and is alive
  async alive(name) {
    try {
      const res = await sendCommand({ cmd: "alive", name });
      return res.ok && res.alive === true;
    } catch {
      return false;
    }
  }
  // check if session exists (alive or dead)
  async has(name) {
    try {
      const res = await sendCommand({ cmd: "has", name });
      return res.ok && res.exists === true;
    } catch {
      return false;
    }
  }
  // kill a session (keeps it in manager as "dead")
  async kill(name) {
    try {
      await sendCommand({ cmd: "kill", name });
    } catch {
    }
  }
  // remove a session (kill + delete from manager)
  async remove(name) {
    try {
      await sendCommand({ cmd: "remove", name });
    } catch {
    }
  }
  // list all sessions
  async list() {
    await ensurePtyDaemon();
    const res = await sendCommand({ cmd: "list" });
    if (!res.ok) return [];
    return res.sessions || [];
  }
  // get session info
  async info(name) {
    try {
      const res = await sendCommand({ cmd: "info", name });
      if (!res.ok) return null;
      return res.info;
    } catch {
      return null;
    }
  }
  // get child process pid
  async pid(name) {
    try {
      const res = await sendCommand({ cmd: "pid", name });
      if (!res.ok) return null;
      return res.pid;
    } catch {
      return null;
    }
  }
  // get daemon status
  async status() {
    try {
      const res = await sendCommand({ cmd: "status" });
      if (!res.ok) return null;
      return res.status;
    } catch {
      return null;
    }
  }
};
var pty = new PtyClient();

// lib/api/audit-exec.ts
function shellEscape(value2) {
  return "'" + String(value2).replace(/'/g, "'\\''") + "'";
}

// lib/runner-v2/agent-bootstrap-plan.ts
var import_fs8 = require("fs");
var import_path7 = require("path");

// lib/ai-gateway/client.ts
function cleanEnvValue(value2) {
  return value2?.trim() ?? "";
}
function allowedGatewayOrigins(env) {
  const origins = /* @__PURE__ */ new Set();
  for (const raw of [
    env.MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN,
    env.BETTER_AUTH_URL,
    env.NEXT_PUBLIC_BETTER_AUTH_URL
  ]) {
    if (!raw) continue;
    for (const value2 of raw.split(",")) {
      const trimmed = value2.trim();
      if (!trimmed) continue;
      try {
        origins.add(new URL(trimmed).origin);
      } catch {
      }
    }
  }
  return origins;
}
function isValidGatewayUrl(value2, env) {
  let parsed;
  try {
    parsed = new URL(value2);
  } catch {
    return false;
  }
  if (env.NODE_ENV === "production" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;
  if (parsed.pathname.replace(/\/$/, "") !== "/v1") return false;
  const allowed = allowedGatewayOrigins(env);
  return allowed.size === 0 || allowed.has(parsed.origin);
}
function getTenantAiGatewayConfig(env = process.env) {
  if (env.MENTIKO_AI_GATEWAY_ENABLED !== "true") return null;
  const gatewayUrl = cleanEnvValue(env.MENTIKO_AI_GATEWAY_URL);
  const token = cleanEnvValue(env.MENTIKO_AI_GATEWAY_TOKEN);
  const tokenId = cleanEnvValue(env.MENTIKO_AI_GATEWAY_TOKEN_ID);
  const tenantId = cleanEnvValue(env.TENANT_ID);
  if (!gatewayUrl || !token || !tokenId || !tenantId) return null;
  if (!isValidGatewayUrl(gatewayUrl, env)) return null;
  if (!token.startsWith("mtk_ai_")) return null;
  if (!tokenId.startsWith("tok_")) return null;
  return {
    gatewayUrl,
    token,
    tokenId,
    tenantId
  };
}

// lib/auth/internal-api-auth.ts
var import_node_crypto2 = require("node:crypto");

// lib/secrets/dev-secret.ts
var import_crypto2 = require("crypto");
var import_fs5 = require("fs");
var import_os2 = require("os");
var import_path4 = require("path");
var _devSecretWarned = false;
var _devSecret = null;
var HKDF_LABELS = {
  session: "mentiko-session-signing-v1",
  vault: "mentiko-vault-encryption-v1",
  "user-crypto": "mentiko-user-crypto-v1"
};
function hkdfSha256(ikm, info, length = 32) {
  const prk = (0, import_crypto2.createHmac)("sha256", "\0".repeat(32)).update(ikm).digest();
  const okm = (0, import_crypto2.createHmac)("sha256", prk).update(info + "").digest();
  return okm.slice(0, length).toString("hex");
}
function getLocalDevSecret() {
  if (_devSecret) return _devSecret;
  const configured = process.env.MENTIKO_DEV_SECRET;
  if (configured) {
    _devSecret = configured;
    return _devSecret;
  }
  const root = process.env.MENTIKO_GLOBAL_ROOT || process.env.MENTIKO_ROOT || (0, import_path4.join)((0, import_os2.homedir)(), ".mentiko");
  const dir = (0, import_path4.join)(root, "data");
  const file = (0, import_path4.join)(dir, "dev-secret");
  try {
    if ((0, import_fs5.existsSync)(file)) {
      const existing = (0, import_fs5.readFileSync)(file, "utf8").trim();
      if (existing) {
        _devSecret = existing;
        return _devSecret;
      }
    }
    (0, import_fs5.mkdirSync)(dir, { recursive: true });
    _devSecret = `dev-${(0, import_crypto2.randomBytes)(32).toString("hex")}`;
    (0, import_fs5.writeFileSync)(file, `${_devSecret}
`, { mode: 384 });
    try {
      (0, import_fs5.chmodSync)(file, 384);
    } catch {
    }
    return _devSecret;
  } catch {
    _devSecret = `ephemeral-dev-${(0, import_crypto2.randomBytes)(32).toString("hex")}`;
    return _devSecret;
  }
}
function getRootSecret(context) {
  const value2 = process.env.BETTER_AUTH_SECRET || process.env.SECRET_KEY;
  if (value2) return value2;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `BETTER_AUTH_SECRET is required in production (${context})`
    );
  }
  if (!_devSecretWarned) {
    _devSecretWarned = true;
    console.warn(
      "[security] BETTER_AUTH_SECRET not set - using local development secret. Set BETTER_AUTH_SECRET in web/.env.local before sharing data."
    );
  }
  return getLocalDevSecret();
}
function resolveAppSecret(purposeOrContext, slot = "current") {
  if (purposeOrContext !== "session" && purposeOrContext !== "vault" && purposeOrContext !== "user-crypto") {
    return getRootSecret(purposeOrContext);
  }
  const purpose = purposeOrContext;
  const isPrevious = slot === "previous";
  const envMap = {
    session: {
      current: "SESSION_SIGNING_KEY",
      previous: "SESSION_SIGNING_KEY_OLD"
    },
    vault: {
      current: "VAULT_ENCRYPTION_KEY",
      previous: "VAULT_ENCRYPTION_KEY_OLD"
    },
    "user-crypto": {
      current: "USER_CRYPTO_KEY",
      previous: "USER_CRYPTO_KEY_OLD"
    }
  };
  const envVar = envMap[purpose][isPrevious ? "previous" : "current"];
  const directValue = process.env[envVar];
  if (directValue) return directValue;
  const root = getRootSecret(`${purpose}-${slot}`);
  return hkdfSha256(root, HKDF_LABELS[purpose]);
}

// lib/auth/security.ts
var import_server = __toESM(require_server());
var RateLimiter = class {
  constructor(windowMs, maxRequests) {
    this.store = /* @__PURE__ */ new Map();
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    const cleanupTimer = setInterval(() => this.cleanup(), 6e4);
    cleanupTimer.unref?.();
  }
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetTime < now) {
        this.store.delete(key);
      }
    }
  }
  getIdentifier(request) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
    return ip;
  }
  check(request) {
    const key = this.getIdentifier(request);
    const now = Date.now();
    let entry = this.store.get(key);
    if (!entry || entry.resetTime < now) {
      entry = { count: 0, resetTime: now + this.windowMs };
      this.store.set(key, entry);
    }
    entry.count++;
    return {
      allowed: entry.count <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - entry.count),
      resetTime: entry.resetTime
    };
  }
  reset(request) {
    const key = this.getIdentifier(request);
    this.store.delete(key);
  }
};
var rateLimiters = {
  // auth endpoints (100 req per 15 min) - increased for polling/realtime features
  auth: new RateLimiter(15 * 60 * 1e3, 100),
  // api: general api routes (600 req per minute)
  api: new RateLimiter(60 * 1e3, 600),
  // strict: webhooks (20 req per minute)
  webhook: new RateLimiter(60 * 1e3, 20),
  // loose: public endpoints (1000 req per minute)
  public: new RateLimiter(60 * 1e3, 1e3)
};

// lib/auth/internal-api-auth.ts
var DERIVED_INTERNAL_AUTH_CONTEXTS = /* @__PURE__ */ new Set([
  "ai-gateway-local-proxy",
  "decision-import"
]);
function resolveInternalAuthSecret(context) {
  const root = resolveAppSecret(context);
  if (!DERIVED_INTERNAL_AUTH_CONTEXTS.has(context)) {
    return root;
  }
  return (0, import_node_crypto2.createHmac)("sha256", root).update(`mentiko-internal-api:${context}`, "utf8").digest("hex");
}

// lib/ai-gateway/local-proxy-env.ts
function localOrigin(origin) {
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") {
        return parsed.origin;
      }
    } catch {
    }
  }
  return `http://127.0.0.1:${process.env.WEB_PORT || process.env.PORT || "3000"}`;
}
function buildLocalAiGatewayProxyEnv(origin) {
  if (!getTenantAiGatewayConfig()) return {};
  return {
    MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED: "true",
    MENTIKO_AI_GATEWAY_LOCAL_BASE_URL: `${localOrigin(origin)}/api/ai-gateway/local/v1`,
    MENTIKO_AI_GATEWAY_LOCAL_TOKEN: resolveInternalAuthSecret("ai-gateway-local-proxy")
  };
}

// lib/runner-v2/agent-state.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");

// lib/runner-v2/file-claim.ts
var import_fs6 = require("fs");
var import_path5 = require("path");
var import_crypto3 = require("crypto");
var import_child_process2 = require("child_process");
var DEFAULT_FRESH_MS = 3e4;
var DEFAULT_WAIT_TIMEOUT_MS = 250;
var DEFAULT_RETRY_DELAY_MS = 10;
var ExclusiveFileClaimBusyError = class extends Error {
  constructor(claimDir) {
    super(`file claim already held: ${claimDir}`);
    this.claimDir = claimDir;
    this.name = "ExclusiveFileClaimBusyError";
  }
};
function withExclusiveFileClaim(claimDir, fn, options = {}) {
  const release = acquireExclusiveFileClaim(claimDir, options);
  try {
    const value2 = fn();
    if (isPromiseLike(value2)) {
      return Promise.resolve(value2).finally(release);
    }
    release();
    return value2;
  } catch (error) {
    release();
    throw error;
  }
}
function acquireExclusiveFileClaim(claimDir, options) {
  const deadline = Date.now() + (options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
  while (true) {
    try {
      return tryAcquireExclusiveFileClaim(claimDir, options);
    } catch (error) {
      if (!(error instanceof ExclusiveFileClaimBusyError) || Date.now() >= deadline) throw error;
      waitSynchronously(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    }
  }
}
function tryAcquireExclusiveFileClaim(claimDir, options) {
  const pid = options.pid ?? process.pid;
  const isAlive = options.isProcessAlive ?? processIsAlive;
  const identity = options.processIdentity ?? claimProcessIdentity;
  const freshMs = options.freshMs ?? DEFAULT_FRESH_MS;
  const reaperDir = `${claimDir}.reaper`;
  (0, import_fs6.mkdirSync)((0, import_path5.dirname)(claimDir), { recursive: true });
  cleanupOrphanedReleaseQuarantines(claimDir, isAlive, identity, freshMs);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((0, import_fs6.existsSync)(reaperDir)) {
      const reaper2 = acquireReaperClaim(reaperDir, {
        pid,
        isAlive,
        identity,
        freshMs,
        removeDirectoryAttempt: options.removeDirectoryAttempt
      });
      reaper2.release();
      continue;
    }
    const owner = newOwner(pid, identity);
    try {
      const held = createOwnedDirectoryClaim(claimDir, owner, options.removeDirectoryAttempt);
      if ((0, import_fs6.existsSync)(reaperDir)) {
        held.release();
        continue;
      }
      return held.release;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const observed = readOwner(claimDir);
    if (observed && ownerIsAlive(observed, isAlive, identity) || !observed && claimAgeMs(claimDir) < freshMs) {
      throw new ExclusiveFileClaimBusyError(claimDir);
    }
    const reaper = acquireReaperClaim(reaperDir, {
      pid,
      isAlive,
      identity,
      freshMs,
      removeDirectoryAttempt: options.removeDirectoryAttempt
    });
    try {
      const current = readOwner(claimDir);
      const ownerChanged = !sameOwner(observed, current);
      if (ownerChanged || current && ownerIsAlive(current, isAlive, identity) || !current && claimAgeMs(claimDir) < freshMs) {
        throw new ExclusiveFileClaimBusyError(claimDir);
      }
      if (!reaper.owns()) throw new ExclusiveFileClaimBusyError(claimDir);
      options.beforeStaleRetirement?.();
      if (!reaper.owns()) throw new ExclusiveFileClaimBusyError(claimDir);
      const quarantine = `${claimDir}.stale-${process.pid}-${(0, import_crypto3.randomUUID)()}`;
      try {
        (0, import_fs6.renameSync)(claimDir, quarantine);
      } catch (error) {
        if (isNotFound(error)) continue;
        throw error;
      }
      const moved = readOwner(quarantine);
      if (!sameOwner(observed, moved) || !reaper.owns()) {
        restoreQuarantine(quarantine, claimDir);
        throw new ExclusiveFileClaimBusyError(claimDir);
      }
      (0, import_fs6.rmSync)(quarantine, { recursive: true, force: true });
    } finally {
      reaper.release();
    }
  }
  throw new ExclusiveFileClaimBusyError(claimDir);
}
function acquireReaperClaim(reaperDir, input) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const owner = newOwner(input.pid, input.identity);
    try {
      return createOwnedDirectoryClaim(reaperDir, owner, input.removeDirectoryAttempt);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const observed = readOwner(reaperDir);
    if (observed && ownerIsAlive(observed, input.isAlive, input.identity) || !observed && claimAgeMs(reaperDir) < input.freshMs) {
      throw new ExclusiveFileClaimBusyError(reaperDir);
    }
    const quarantine = `${reaperDir}.stale-${process.pid}-${(0, import_crypto3.randomUUID)()}`;
    try {
      (0, import_fs6.renameSync)(reaperDir, quarantine);
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    const moved = readOwner(quarantine);
    if (!sameOwner(observed, moved)) {
      restoreQuarantine(quarantine, reaperDir);
      throw new ExclusiveFileClaimBusyError(reaperDir);
    }
    removeDirectoryWithRetries(quarantine, input.removeDirectoryAttempt);
  }
  throw new ExclusiveFileClaimBusyError(reaperDir);
}
function createOwnedDirectoryClaim(claimDir, owner, removeDirectoryAttempt) {
  const candidate = `${claimDir}.candidate-${owner.pid}-${owner.token}`;
  (0, import_fs6.mkdirSync)(candidate);
  try {
    (0, import_fs6.writeFileSync)(ownerPath(candidate), `${JSON.stringify(owner)}
`, {
      flag: "wx",
      mode: 384
    });
    (0, import_fs6.renameSync)(candidate, claimDir);
  } catch (error) {
    (0, import_fs6.rmSync)(candidate, { recursive: true, force: true });
    throw error;
  }
  return {
    owner,
    owns: () => sameOwner(readOwner(claimDir), owner),
    release: claimRelease(claimDir, owner, removeDirectoryAttempt)
  };
}
function claimRelease(claimDir, owner, removeDirectoryAttempt) {
  let released = false;
  return () => {
    if (released) return;
    const current = readOwner(claimDir);
    if (!sameOwner(current, owner)) return;
    const quarantine = `${claimDir}.release-${owner.pid}-${owner.token}`;
    try {
      (0, import_fs6.renameSync)(claimDir, quarantine);
    } catch (error) {
      if (isNotFound(error)) released = true;
      else throw error;
      return;
    }
    const moved = readOwner(quarantine);
    if (!sameOwner(moved, owner)) {
      restoreQuarantine(quarantine, claimDir);
      return;
    }
    try {
      removeDirectoryWithRetries(quarantine, removeDirectoryAttempt);
      released = true;
    } catch {
      released = true;
    }
  };
}
function restoreQuarantine(quarantine, canonical) {
  if ((0, import_fs6.existsSync)(canonical)) return;
  try {
    (0, import_fs6.renameSync)(quarantine, canonical);
  } catch {
  }
}
function sameOwner(left, right) {
  if (!left || !right) return !left && !right;
  return left.pid === right.pid && left.token === right.token && left.processIdentity === right.processIdentity;
}
function ownerPath(claimDir) {
  return `${claimDir}/owner.json`;
}
function readOwner(claimDir) {
  try {
    const value2 = JSON.parse((0, import_fs6.readFileSync)(ownerPath(claimDir), "utf8"));
    return Number.isInteger(value2.pid) && Number(value2.pid) > 0 && typeof value2.token === "string" ? {
      pid: Number(value2.pid),
      token: value2.token,
      ...typeof value2.processIdentity === "string" ? { processIdentity: value2.processIdentity } : {}
    } : void 0;
  } catch {
    return void 0;
  }
}
function claimAgeMs(claimDir) {
  try {
    return Math.max(0, Date.now() - (0, import_fs6.statSync)(claimDir).mtimeMs);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasCode(error, "EPERM");
  }
}
function claimProcessIsAlive(pid) {
  return processIsAlive(pid);
}
function claimProcessIdentity(pid) {
  try {
    const stat = (0, import_fs6.readFileSync)(`/proc/${pid}/stat`, "utf8");
    const closingParen = stat.lastIndexOf(")");
    const fields = stat.slice(closingParen + 2).split(" ");
    if (fields[19]) return `proc:${fields[19]}`;
  } catch {
  }
  try {
    const value2 = (0, import_child_process2.execFileSync)("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 1e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return value2 ? `ps:${value2}` : void 0;
  } catch {
    return void 0;
  }
}
function claimProcessMatchesIdentity(pid, recordedIdentity, isAlive = claimProcessIsAlive, identity = claimProcessIdentity) {
  if (!isAlive(pid)) return false;
  if (!recordedIdentity) return true;
  const currentIdentity = identity(pid);
  return currentIdentity === void 0 || currentIdentity === recordedIdentity;
}
function newOwner(pid, identity) {
  const value2 = identity(pid);
  return {
    pid,
    token: (0, import_crypto3.randomUUID)(),
    ...value2 ? { processIdentity: value2 } : {}
  };
}
function ownerIsAlive(owner, isAlive, identity) {
  return claimProcessMatchesIdentity(owner.pid, owner.processIdentity, isAlive, identity);
}
function waitSynchronously(timeoutMs) {
  if (timeoutMs <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, timeoutMs);
}
function removeDirectoryWithRetries(path2, attemptRemoval = (target) => {
  (0, import_fs6.rmSync)(target, { recursive: true, force: true });
}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      attemptRemoval(path2);
      return;
    } catch (error) {
      if (attempt >= 3 || !isTransientRemoveError(error)) throw error;
      waitSynchronously(10);
    }
  }
}
function cleanupOrphanedReleaseQuarantines(claimDir, isAlive, identity, freshMs) {
  const parent = (0, import_path5.dirname)(claimDir);
  const prefix = `${(0, import_path5.basename)(claimDir)}.release-`;
  let entries;
  try {
    entries = (0, import_fs6.readdirSync)(parent);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const path2 = (0, import_path5.join)(parent, entry);
    const owner = readOwner(path2);
    if (owner && ownerIsAlive(owner, isAlive, identity) || !owner && claimAgeMs(path2) < freshMs) continue;
    try {
      removeDirectoryWithRetries(path2);
    } catch {
    }
  }
}
function isTransientRemoveError(error) {
  return ["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"].some((code) => hasCode(error, code));
}
function isPromiseLike(value2) {
  return !!value2 && (typeof value2 === "object" || typeof value2 === "function") && "then" in value2 && typeof value2.then === "function";
}
function isAlreadyExists(error) {
  return hasCode(error, "EEXIST") || hasCode(error, "ENOTEMPTY");
}
function isNotFound(error) {
  return hasCode(error, "ENOENT");
}
function hasCode(error, code) {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}

// lib/runner-v2/agent-state.ts
var REQUIRED_KEYS = ["status", "session", "agent_id"];
var KNOWN_KEYS = /* @__PURE__ */ new Set([
  ...REQUIRED_KEYS,
  "round",
  "started",
  "completed",
  "emits",
  "chain",
  "workspace",
  "timeout",
  "retry_max",
  "retry_attempt",
  "on_error",
  "on_timeout",
  "start_sha",
  "pid",
  "blocked_reason",
  "blocked_at",
  "error",
  "failed_reason",
  "failed_at"
]);
var STATE_STATUSES = /* @__PURE__ */ new Set(["running", "blocked", "failed", "completed", "unknown"]);
function runnerAgentStateKey(sessionPrefix, runId) {
  return [sessionPrefix, runId || "no_run"].map(normalizeKeyPart).join("_");
}
function runnerAgentStatePath(stateDir, sessionPrefix, runId) {
  return (0, import_node_path2.join)(requireAbsoluteStateDir(stateDir), `${runnerAgentStateKey(sessionPrefix, runId)}.state`);
}
function parseRunnerAgentState(content, filename = "") {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    if (!rawLine) continue;
    const separator = rawLine.indexOf(":");
    if (separator <= 0) throw new Error(`Invalid runner agent state line in ${filename || "state file"}`);
    const key = rawLine.slice(0, separator).trim();
    const value2 = rawLine.slice(separator + 1).trim();
    if (!KNOWN_KEYS.has(key)) throw new Error(`Unknown runner agent state key '${key}'`);
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate runner agent state key '${key}'`);
    values[key] = value2;
  }
  for (const key of REQUIRED_KEYS) {
    if (!values[key]) throw new Error(`Runner agent state requires '${key}'`);
  }
  if (!STATE_STATUSES.has(values.status)) {
    throw new Error(`Invalid runner agent state status '${values.status}'`);
  }
  if (values.retry_attempt !== void 0 && !isNonNegativeInteger(values.retry_attempt)) {
    throw new Error("runner agent state retry_attempt must be a non-negative integer");
  }
  return values;
}
function serializeRunnerAgentState(state) {
  validateRunnerAgentState(state);
  const lines = [
    `status: ${state.status}`,
    `session: ${state.session}`,
    `agent_id: ${state.agent_id}`
  ];
  for (const key of [
    "round",
    "started",
    "completed",
    "emits",
    "chain",
    "workspace",
    "timeout",
    "retry_max",
    "retry_attempt",
    "on_error",
    "on_timeout",
    "start_sha",
    "pid",
    "blocked_reason",
    "blocked_at",
    "error",
    "failed_reason",
    "failed_at"
  ]) {
    const value2 = state[key];
    if (value2 !== void 0) lines.push(`${key}: ${value2}`);
  }
  return `${lines.join("\n")}
`;
}
function createRunnerAgentState(path2, input) {
  const state = {
    ...input,
    status: "running",
    retry_attempt: input.retry_attempt ?? "0"
  };
  writeRunnerAgentState(path2, state);
  return state;
}
function readRunnerAgentState(path2) {
  if (!(0, import_node_fs2.existsSync)(path2)) return null;
  if ((0, import_node_fs2.lstatSync)(path2).isSymbolicLink()) throw new Error(`Runner agent state must not be a symbolic link: ${path2}`);
  return parseRunnerAgentState((0, import_node_fs2.readFileSync)(path2, "utf8"), (0, import_node_path2.basename)(path2));
}
function updateRunnerAgentState(path2, update) {
  return withExclusiveFileClaim(`${path2}.lock`, () => {
    const current = readRunnerAgentState(path2);
    if (!current) throw new Error(`Runner agent state does not exist: ${path2}`);
    const next = update(current);
    writeRunnerAgentStateUnlocked(path2, next);
    return next;
  }, { waitTimeoutMs: 5e3 });
}
function transitionRunnerAgentState(path2, status, reason, at = (/* @__PURE__ */ new Date()).toISOString()) {
  return updateRunnerAgentState(path2, (current) => {
    const next = { ...current, status };
    if (status === "blocked") {
      next.blocked_reason = requireReason(reason, status);
      next.blocked_at = at;
    } else if (status === "failed") {
      next.error = requireReason(reason, status);
      next.failed_reason = reason;
      next.failed_at = at;
    } else {
      next.completed = at;
    }
    return next;
  });
}
function writeRunnerAgentState(path2, state) {
  withExclusiveFileClaim(`${path2}.lock`, () => writeRunnerAgentStateUnlocked(path2, state), { waitTimeoutMs: 5e3 });
}
function writeRunnerAgentStateUnlocked(path2, state) {
  validateRunnerAgentState(state);
  const directory = (0, import_node_path2.dirname)(path2);
  (0, import_node_fs2.mkdirSync)(directory, { recursive: true });
  if (!(0, import_node_fs2.lstatSync)(directory).isDirectory() || (0, import_node_fs2.lstatSync)(directory).isSymbolicLink()) {
    throw new Error(`Runner agent state directory must be a real directory: ${directory}`);
  }
  const temporaryPath = `${path2}.${process.pid}.${Date.now()}.tmp`;
  (0, import_node_fs2.writeFileSync)(temporaryPath, serializeRunnerAgentState(state), { mode: 384 });
  (0, import_node_fs2.renameSync)(temporaryPath, path2);
}
function validateRunnerAgentState(state) {
  for (const key of REQUIRED_KEYS) {
    if (!state[key] || state[key].includes("\n")) throw new Error(`Runner agent state requires one-line '${key}'`);
  }
  if (!STATE_STATUSES.has(state.status)) throw new Error(`Invalid runner agent state status '${state.status}'`);
  for (const [key, value2] of Object.entries(state)) {
    if (!KNOWN_KEYS.has(key)) throw new Error(`Unknown runner agent state key '${key}'`);
    if (value2 !== void 0 && value2.includes("\n")) throw new Error(`Runner agent state '${key}' must be one line`);
  }
  if (state.retry_attempt !== void 0 && !isNonNegativeInteger(state.retry_attempt)) {
    throw new Error("runner agent state retry_attempt must be a non-negative integer");
  }
}
function normalizeKeyPart(value2) {
  return value2.replaceAll("-", "_").replaceAll(/[^a-zA-Z0-9_]/g, "_");
}
function requireAbsoluteStateDir(path2) {
  if (!path2 || !path2.startsWith("/")) throw new Error("Runner agent state directory must be absolute");
  return path2.replace(/\/+$/, "") || "/";
}
function isNonNegativeInteger(value2) {
  return /^\d+$/.test(value2);
}
function requireReason(reason, status) {
  if (!reason || reason.includes("\n")) throw new Error(`Runner agent ${status} transition requires a one-line reason`);
  return reason;
}

// lib/runner-v2/agent-profile.ts
var import_node_fs4 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path4 = require("node:path");

// lib/runner-v2/agent-profile-args.ts
function normalizePermissionFlag(cli, permissionFlag) {
  if (cli === "claude" && (permissionFlag === "--dangerously-skip-permissions" || permissionFlag === "--allow-dangerously-skip-permissions --permission-mode bypassPermissions")) {
    return "--dangerously-skip-permissions";
  }
  return permissionFlag;
}
function resolveProfilePermissionArgs(cli, permissionFlag) {
  const normalized = normalizePermissionFlag(cli, permissionFlag);
  return normalized ? splitProfileArgumentString(normalized, "permission_flag") : [];
}
function splitProfileArgumentString(value2, field) {
  const tokens = [];
  let token = "";
  let quote;
  let escaped = false;
  let started = false;
  for (const character of value2) {
    if (escaped) {
      token += character;
      escaped = false;
      started = true;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = void 0;
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
      continue;
    }
    token += character;
    started = true;
  }
  if (escaped || quote) throw new Error(`Invalid ${field}: unterminated escape or quote`);
  if (started) tokens.push(token);
  return tokens;
}

// lib/runner-v2/claude-mentiko-mcp-config.ts
var import_node_fs3 = require("node:fs");
var import_node_os = require("node:os");
var import_node_path3 = require("node:path");
var CONTEXT_DIR_PREFIX = "mentiko-claude-mcp-";
var CONFIG_FILE_NAME = "mcp.json";
function createClaudeMentikoMcpConfig(env, options = {}) {
  const webUrl = value(env.MENTIKO_WEB_URL);
  const sessionId = value(env.MENTIKO_SESSION_ID);
  const sessionToken = value(env.MENTIKO_SESSION_TOKEN);
  const contextValues = [webUrl, sessionId, sessionToken];
  if (contextValues.every((entry) => !entry)) return void 0;
  if (contextValues.some((entry) => !entry)) {
    throw new Error("Claude Mentiko MCP context requires MENTIKO_WEB_URL, MENTIKO_SESSION_ID, and MENTIKO_SESSION_TOKEN");
  }
  const serverPath = options.serverPath || resolveMentikoMcpServer(env);
  if (!(0, import_node_fs3.existsSync)(serverPath)) {
    throw new Error(`Claude Mentiko MCP server is missing: ${serverPath}`);
  }
  const dir = (0, import_node_fs3.mkdtempSync)((0, import_node_path3.join)(options.tempRoot || (0, import_node_os.tmpdir)(), CONTEXT_DIR_PREFIX));
  (0, import_node_fs3.chmodSync)(dir, 448);
  const path2 = (0, import_node_path3.join)(dir, CONFIG_FILE_NAME);
  const config2 = {
    mcpServers: {
      mentiko: {
        command: "node",
        args: [serverPath],
        env: {
          MENTIKO_WEB_URL: webUrl,
          MENTIKO_SESSION_ID: sessionId,
          MENTIKO_SESSION_TOKEN: sessionToken,
          // A Claude runner may be launched by a process that also hosts the
          // interactive app/bar bridge. Explicitly neutralize that bridge's
          // approval credential so an unattended chain cannot inherit its
          // user-prompt mode.
          MENTIKO_INBOX_KEY: "",
          MENTIKO_MCP_TOOL_SCOPE: "runner"
        }
      }
    }
  };
  (0, import_node_fs3.writeFileSync)(path2, `${JSON.stringify(config2)}
`, { encoding: "utf8", flag: "wx", mode: 384 });
  (0, import_node_fs3.chmodSync)(path2, 384);
  return { dir, path: path2 };
}
function withClaudeMentikoMcpCleanup(command, receipt) {
  if (!receipt) return command;
  return `${command}; mentiko_mcp_status=$?; rm -f ${shellQuote(receipt.path)}; rmdir ${shellQuote(receipt.dir)} 2>/dev/null || true; (exit $mentiko_mcp_status)`;
}
function resolveMentikoMcpServer(env) {
  const codeRoot2 = value(env.MENTIKO_CODE_ROOT);
  if (!codeRoot2) throw new Error("Claude Mentiko MCP context requires MENTIKO_CODE_ROOT");
  return (0, import_node_path3.join)(codeRoot2, "lib", "mentiko-mcp", "dist", "server.js");
}
function value(input) {
  return typeof input === "string" ? input.trim() : "";
}
function shellQuote(value2) {
  return `'${value2.replace(/'/g, `"'"'`)}'`;
}

// lib/secrets/secrets-store.ts
var import_crypto4 = require("crypto");
var import_fs7 = require("fs");
var import_path6 = require("path");
var KEY_DERIVATION_SALT = "mentiko-vault-crypto-v1";
var KEY_DERIVATION_ITERATIONS = 1e5;
var KEY_LENGTH_BYTES = 32;
var KEY_DERIVATION_LABEL = "mentiko-vault-encryption-v1";
function deriveVaultAppSecret(rootSecret) {
  const prk = (0, import_crypto4.createHmac)("sha256", "\0".repeat(32)).update(rootSecret).digest();
  return (0, import_crypto4.createHmac)("sha256", prk).update(`${KEY_DERIVATION_LABEL}`).digest("hex");
}
function resolveVaultSecret(secret) {
  if (secret !== void 0) {
    return deriveVaultAppSecret(secret);
  }
  return resolveAppSecret("vault", "current");
}
function resolveLegacyVaultSecret(secret) {
  if (secret !== void 0) {
    return secret;
  }
  return resolveAppSecret("vault-secret");
}
function getDerivedKey(secret) {
  const appSecret = deriveVaultAppSecret(resolveVaultSecret(secret));
  return (0, import_crypto4.pbkdf2Sync)(
    appSecret,
    KEY_DERIVATION_SALT,
    KEY_DERIVATION_ITERATIONS,
    KEY_LENGTH_BYTES,
    "sha256"
  );
}
function getLegacyDerivedKey(secret) {
  const rawSecret = resolveLegacyVaultSecret(secret);
  return (0, import_crypto4.pbkdf2Sync)(
    rawSecret,
    KEY_DERIVATION_SALT,
    KEY_DERIVATION_ITERATIONS,
    KEY_LENGTH_BYTES,
    "sha256"
  );
}
function getKeyId(key) {
  const derivedKey = key ?? getDerivedKey();
  return (0, import_crypto4.createHash)("sha256").update(derivedKey).digest("hex").slice(0, 16);
}
function decrypt(ciphertext, keyOverride) {
  try {
    if (ciphertext.startsWith("v1:")) {
      const parts = ciphertext.split(":", 5);
      if (parts.length !== 5) throw new Error("invalid v1 ciphertext format");
      const [, keyIdStored, ivHex, tagHex, encHex] = parts;
      const key = keyOverride ? getDerivedKey(keyOverride) : getDerivedKey();
      const keyId = getKeyId(key);
      if (keyIdStored !== keyId) {
        return null;
      }
      const decipher = (0, import_crypto4.createDecipheriv)("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
    } else {
      const parts = ciphertext.split(":");
      if (parts.length !== 3) throw new Error("invalid v0 ciphertext format");
      const [ivHex, tagHex, encHex] = parts;
      const primaryKey = keyOverride ? getDerivedKey(keyOverride) : getDerivedKey();
      const fallbackKey = getLegacyDerivedKey(keyOverride);
      const keyCandidates = [primaryKey, ...!primaryKey.equals(fallbackKey) ? [fallbackKey] : []];
      for (const candidate of keyCandidates) {
        try {
          const decipher = (0, import_crypto4.createDecipheriv)("aes-256-gcm", candidate, Buffer.from(ivHex, "hex"));
          decipher.setAuthTag(Buffer.from(tagHex, "hex"));
          return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
        } catch {
        }
      }
      return null;
    }
  } catch {
    return null;
  }
}
function secretsDir(namespaceId2, orgId2) {
  return orgPath(namespaceId2, orgId2, "secrets");
}
function getSecretByName(namespaceId2, orgId2, name) {
  const dir = secretsDir(namespaceId2, orgId2);
  if (!(0, import_fs7.existsSync)(dir)) return null;
  for (const f of (0, import_fs7.readdirSync)(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const rec = JSON.parse((0, import_fs7.readFileSync)((0, import_path6.join)(dir, f), "utf-8"));
      if (rec.name === name && rec.encryptedValue) {
        const val = decrypt(rec.encryptedValue);
        if (!val) {
          console.warn(`[secrets] decryption failed: ${rec.id} \u2014 key mismatch or corrupt`);
        }
        return val;
      }
    } catch (err) {
      console.warn(`[secrets] error reading secret: ${f} \u2014 ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return null;
}

// lib/runner-v2/agent-profile.ts
var PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;
var SECRET_REFERENCE = /^\{secret:([^}]+)\}$/;
function resolveAgentProfile(input) {
  const chain = readJson(input.chainPath, "chain");
  const agents = Array.isArray(chain.agents) ? chain.agents : [];
  const agent = agents.find((candidate) => candidate.id === input.agentId);
  if (!agent) throw new Error(`Agent '${input.agentId}' is not defined in ${input.chainPath}`);
  const agentId = optionalProfileId(agent.agent_profile, "agent.agent_profile");
  if (agentId) return resolveExactProfile(input.profilesDir, agentId, "agent");
  const chainId = optionalProfileId(chain.default_agent_profile, "chain.default_agent_profile");
  if (chainId) return resolveExactProfile(input.profilesDir, chainId, "chain");
  const workspaceId = resolveWorkspaceProfileId(input.projectRoot, input.orgRoot);
  if (workspaceId) return resolveExactProfile(input.profilesDir, workspaceId, "workspace");
  return resolveDefaultProfile(input.profilesDir, "namespace");
}
function resolveDefaultProfile(profilesDir, source = "namespace") {
  const candidates = listProfileFiles(profilesDir).map((path2) => loadAgentProfile(path2));
  const matches = candidates.filter((candidate) => source === "advisor" ? candidate.profile.isAdvisorDefault === true : candidate.profile.isDefault === true);
  if (matches.length > 1) throw new Error(`Multiple ${source} default agent profiles exist in ${profilesDir}`);
  const selected = matches[0];
  return selected ? { ...selected, source } : void 0;
}
function resolveExactProfile(profilesDir, profileId, source = "explicit") {
  assertProfileId(profileId, "profile id");
  const path2 = (0, import_node_path4.join)(profilesDir, `${profileId}.json`);
  if (!(0, import_node_fs4.existsSync)(path2)) throw new Error(`Agent profile '${profileId}' does not exist at ${path2}`);
  return { ...loadAgentProfile(path2), source };
}
function loadAgentProfile(profilePath) {
  if (!(0, import_node_path4.isAbsolute)(profilePath)) throw new Error(`Agent profile path must be absolute: ${profilePath}`);
  const raw = readJson(profilePath, "agent profile");
  const profile = validateAgentProfile(raw, profilePath);
  const expectedId = (0, import_node_path4.basename)(profilePath, ".json");
  if (expectedId !== profile.id) throw new Error(`Agent profile id '${profile.id}' does not match file name '${expectedId}'`);
  return { id: profile.id, name: profile.name, path: profilePath, profile };
}
function buildAgentProfileCommand(input) {
  const { profile } = loadAgentProfile(input.profilePath);
  const model = input.modelOverride ?? (input.purpose === "relay" ? profile.relay_model ?? profile.model : profile.model);
  const pipeArgs = input.interactive || !profile.pipe_flag ? [] : splitProfileArgumentString(profile.pipe_flag, "pipe_flag");
  const permissionArgs = resolveProfilePermissionArgs(profile.cli, profile.permission_flag);
  const envFile = writeProfileEnvFile(profile, input.namespaceId, input.orgId);
  const mentikoMcp = profile.cli === "claude" ? createClaudeMentikoMcpConfig(process.env) : void 0;
  const args = [
    profile.cli,
    ...pipeArgs,
    ...permissionArgs,
    ...model ? ["--model", model] : [],
    ...profile.extra_args ?? [],
    // `--strict-mcp-config` prevents an old user-level `mentiko` entry from
    // overriding this run's URL/session capability.
    ...mentikoMcp ? ["--mcp-config", mentikoMcp.path, "--strict-mcp-config"] : []
  ];
  const command = withClaudeMentikoMcpCleanup(args.map(shellQuote2).join(" "), mentikoMcp);
  const setup = [
    envFile ? `source ${shellQuote2(envFile)}; rm -f ${shellQuote2(envFile)}; rmdir ${shellQuote2((0, import_node_path4.dirname)(envFile))} 2>/dev/null || true` : "",
    envFile && !Object.hasOwn(profile.env ?? {}, "ANTHROPIC_API_KEY") ? "unset ANTHROPIC_API_KEY" : "",
    profile.pre_exec ?? "",
    command
  ].filter(Boolean);
  return setup.join("; ");
}
function validateAgentProfile(value2, path2) {
  if (!isRecord(value2)) throw new Error(`Invalid agent profile JSON at ${path2}`);
  const id = requiredString(value2.id, "id", path2);
  assertProfileId(id, "profile id");
  const name = requiredString(value2.name, "name", path2);
  const cli = requiredString(value2.cli, "cli", path2);
  const profile = {
    id,
    name,
    cli,
    isDefault: value2.isDefault === true,
    ...value2.isAdvisorDefault === true ? { isAdvisorDefault: true } : {},
    ...optionalString(value2.description, "description", path2) ? { description: optionalString(value2.description, "description", path2) } : {},
    ...optionalString(value2.model, "model", path2) ? { model: optionalString(value2.model, "model", path2) } : {},
    ...optionalString(value2.relay_model, "relay_model", path2) ? { relay_model: optionalString(value2.relay_model, "relay_model", path2) } : {},
    ...optionalString(value2.pipe_flag, "pipe_flag", path2) ? { pipe_flag: optionalString(value2.pipe_flag, "pipe_flag", path2) } : {},
    ...optionalString(value2.permission_flag, "permission_flag", path2) ? { permission_flag: optionalString(value2.permission_flag, "permission_flag", path2) } : {},
    ...optionalString(value2.disallowed_tools, "disallowed_tools", path2) ? { disallowed_tools: optionalString(value2.disallowed_tools, "disallowed_tools", path2) } : {},
    ...optionalString(value2.pre_exec, "pre_exec", path2) ? { pre_exec: optionalString(value2.pre_exec, "pre_exec", path2) } : {},
    ...optionalString(value2.log_path, "log_path", path2) ? { log_path: optionalString(value2.log_path, "log_path", path2) } : {},
    ...optionalString(value2.log_format, "log_format", path2) ? { log_format: optionalString(value2.log_format, "log_format", path2) } : {},
    ...value2.extra_args === void 0 ? {} : { extra_args: stringArray(value2.extra_args, "extra_args", path2) },
    ...value2.env === void 0 ? {} : { env: profileEnv(value2.env, path2) },
    ...value2.readiness === void 0 ? {} : { readiness: readiness(value2.readiness, path2) },
    createdAt: typeof value2.createdAt === "string" ? value2.createdAt : "",
    updatedAt: typeof value2.updatedAt === "string" ? value2.updatedAt : ""
  };
  return profile;
}
function resolveWorkspaceProfileId(projectRoot2, orgRoot2) {
  if (!projectRoot2 || !orgRoot2) return void 0;
  const workspacePath = (0, import_node_path4.join)(orgRoot2, "workspaces.json");
  if (!(0, import_node_fs4.existsSync)(workspacePath)) return void 0;
  const workspaces = readJson(workspacePath, "workspace profile configuration");
  if (!Array.isArray(workspaces)) throw new Error(`Workspace profile configuration must be an array: ${workspacePath}`);
  const match = workspaces.find((workspace) => workspace.path === projectRoot2);
  return optionalProfileId(match?.default_agent_profile, "workspace.default_agent_profile");
}
function listProfileFiles(profilesDir) {
  if (!(0, import_node_path4.isAbsolute)(profilesDir)) throw new Error(`Agent profiles directory must be absolute: ${profilesDir}`);
  if (!(0, import_node_fs4.existsSync)(profilesDir)) return [];
  return (0, import_node_fs4.readdirSync)(profilesDir).filter((name) => name.endsWith(".json")).sort().map((name) => (0, import_node_path4.join)(profilesDir, name));
}
function writeProfileEnvFile(profile, namespaceId2, orgId2) {
  const values = Object.entries(profile.env ?? {}).flatMap(([key, value2]) => {
    const secret = value2.match(SECRET_REFERENCE);
    if (!secret) return [[key, value2]];
    const resolved = getSecretByName(namespaceId2, orgId2, secret[1]);
    return resolved === null ? [] : [[key, resolved]];
  });
  if (values.length === 0) return void 0;
  const dir = (0, import_node_fs4.mkdtempSync)((0, import_node_path4.join)((0, import_node_os2.tmpdir)(), "mentiko-agent-profile-"));
  (0, import_node_fs4.chmodSync)(dir, 448);
  const envPath = (0, import_node_path4.join)(dir, "env.sh");
  (0, import_node_fs4.writeFileSync)(envPath, `${values.map(([key, value2]) => `export ${key}=${shellQuote2(value2)}`).join("\n")}
`, { mode: 384 });
  return envPath;
}
function readiness(value2, path2) {
  if (!isRecord(value2) || typeof value2.enabled !== "boolean") throw new Error(`Invalid readiness configuration at ${path2}`);
  return value2;
}
function profileEnv(value2, path2) {
  if (!isRecord(value2)) throw new Error(`Profile env must be an object at ${path2}`);
  return Object.fromEntries(Object.entries(value2).map(([key, entry]) => {
    if (!ENV_KEY.test(key) || typeof entry !== "string") throw new Error(`Invalid profile env entry '${key}' at ${path2}`);
    return [key, entry];
  }));
}
function stringArray(value2, field, path2) {
  if (!Array.isArray(value2) || value2.some((entry) => typeof entry !== "string")) throw new Error(`Profile ${field} must be a string array at ${path2}`);
  return value2;
}
function optionalProfileId(value2, field) {
  if (value2 === void 0 || value2 === null || value2 === "") return void 0;
  if (typeof value2 !== "string") throw new Error(`${field} must be a profile id`);
  assertProfileId(value2, field);
  return value2;
}
function assertProfileId(value2, label) {
  if (!PROFILE_ID.test(value2)) throw new Error(`Invalid ${label}: ${value2}`);
}
function requiredString(value2, field, path2) {
  if (typeof value2 !== "string" || !value2.trim()) throw new Error(`Profile ${field} is required at ${path2}`);
  return value2;
}
function optionalString(value2, field, path2) {
  if (value2 === void 0) return void 0;
  if (typeof value2 !== "string") throw new Error(`Profile ${field} must be a string at ${path2}`);
  return value2 || void 0;
}
function readJson(path2, label) {
  try {
    return JSON.parse((0, import_node_fs4.readFileSync)(path2, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${path2}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function isRecord(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2);
}
function shellQuote2(value2) {
  return `'${value2.replace(/'/g, "'\\''")}'`;
}

// lib/runner-v2/agent-bootstrap-plan.ts
function buildAgentBootstrapPlan(input) {
  const chain = readChain(input.chainPath);
  const agent = resolveAgent(chain, input.agentId);
  const projectRoot2 = input.workspacePath || chain.config?.project_root || input.env?.MENTIKO_PROJECT_ROOT || input.runDir;
  const sourceWorkspacePath = input.sourceWorkspacePath || projectRoot2;
  const artifactsDir = (0, import_path7.join)(input.runDir, "artifacts");
  const eventsDir = input.env?.EVENTS_DIR || config_default.eventsDir;
  const stateDir = input.env?.STATE_DIR || config_default.stateDir;
  const sessionPrefix = resolveSessionPrefix(chain, agent);
  const projectName = (0, import_path7.basename)(sourceWorkspacePath) || "workspace";
  const sessionName = `${projectName}-${sessionPrefix}-${input.runId}`;
  const statePath = runnerAgentStatePath(stateDir, sessionPrefix, input.runId);
  const instructionPath = (0, import_path7.join)(artifactsDir, `${agent.id}-instructions.md`);
  const profile = resolveAgentProfile2(input.chainPath, agent.id || "", sourceWorkspacePath, input.env);
  const gatewayEnv = resolveLocalAiGatewayProxyEnv(input.env);
  const runContextExports = {
    PATH: `${(0, import_path7.join)(config_default.codeRoot, "bin")}:${input.env?.PATH || process.env.PATH || ""}`,
    MENTIKO_BIN: (0, import_path7.join)(config_default.codeRoot, "bin", "mentiko"),
    MENTIKO_RUN_ID: input.runId,
    RUN_ID: input.runId,
    NAMESPACE_ID: input.namespaceId || input.env?.NAMESPACE_ID || "default",
    ORG_ID: input.orgId || input.env?.ORG_ID || "default",
    MENTIKO_AGENT_ID: agent.id || "",
    MENTIKO_AGENT_EMITS: agent.emits || "",
    MENTIKO_AGENT_PROFILE_PATH: profile.path || "",
    MENTIKO_CODE_ROOT: config_default.codeRoot,
    // Every process-facing workspace value must point at the node worktree.
    // The registered source path remains plan metadata only and is never
    // exported to an agent process that could mutate it.
    MENTIKO_PROJECT_ROOT: projectRoot2,
    MENTIKO_ORG_ROOT: input.env?.MENTIKO_ORG_ROOT || "",
    MENTIKO_NAMESPACE_ROOT: input.env?.MENTIKO_NAMESPACE_ROOT || "",
    // Completion copies this typed launch context into routed launches. Keep a
    // caller-supplied profile root so direct CLI runs preserve profile identity
    // for every downstream agent instead of re-resolving against an unrelated
    // process environment.
    AGENT_PROFILES_DIR: input.env?.AGENT_PROFILES_DIR || config_default.agentProfilesDir,
    RUNS_DIR: input.env?.RUNS_DIR || (0, import_path7.dirname)(input.runDir),
    // Completion resolves the run dir from this explicit typed launch context.
    MENTIKO_RUN_DIR: input.runDir,
    STATE_DIR: stateDir,
    EVENTS_DIR: eventsDir,
    ARTIFACTS_DIR: artifactsDir,
    MENTIKO_SESSION_ID: input.env?.MENTIKO_SESSION_ID || "",
    MENTIKO_SESSION_TOKEN: input.env?.MENTIKO_SESSION_TOKEN || "",
    MENTIKO_WEB_URL: input.env?.MENTIKO_WEB_URL || "",
    KOLLABOR_ENGINE_URL: input.env?.KOLLABOR_ENGINE_URL || "",
    TASK_ID: input.env?.TASK_ID || "",
    TASK_TITLE: input.env?.TASK_TITLE || "",
    TASK_DESCRIPTION: input.env?.TASK_DESCRIPTION || "",
    TASK_TYPE: input.env?.TASK_TYPE || "",
    TASK_PRIORITY: input.env?.TASK_PRIORITY || "",
    TASK_ACCEPTANCE_CRITERIA: input.env?.TASK_ACCEPTANCE_CRITERIA || "",
    TASK_DESIGN: input.env?.TASK_DESIGN || "",
    TASK_NOTES: input.env?.TASK_NOTES || "",
    TASK_COMMENTS: input.env?.TASK_COMMENTS || "",
    TASK_CONTEXT: input.env?.TASK_CONTEXT || "",
    ...gatewayEnv,
    ...ptyDaemonEnv(),
    MENTIKO_READINESS_FAIL_CLOSED: input.env?.MENTIKO_READINESS_FAIL_CLOSED || "",
    MENTIKO_CLI_READY_TIMEOUT: input.env?.MENTIKO_CLI_READY_TIMEOUT || "",
    MENTIKO_CLI_READY_POLL: input.env?.MENTIKO_CLI_READY_POLL || "",
    MENTIKO_STARTUP_RECOVERY: input.env?.MENTIKO_STARTUP_RECOVERY || "",
    MENTIKO_STARTUP_RECOVERY_MAX: input.env?.MENTIKO_STARTUP_RECOVERY_MAX || "",
    MENTIKO_ADVISOR_STALE_COUNT: input.env?.MENTIKO_ADVISOR_STALE_COUNT || "",
    MENTIKO_MONITOR_MAX_NUDGES: input.env?.MENTIKO_MONITOR_MAX_NUDGES || "",
    MENTIKO_MONITOR_NEVER_ARMED_GRACE: input.env?.MENTIKO_MONITOR_NEVER_ARMED_GRACE || "",
    // The monitor inherits these exports and hands them to typed completion.
    MENTIKO_RUNNER_V2: input.env?.MENTIKO_RUNNER_V2 || "",
    MENTIKO_RUNNER_V2_COMPLETION: input.env?.MENTIKO_RUNNER_V2_COMPLETION || ""
  };
  const instructionPointer = buildInstructionPointer(agent.id || "", instructionPath);
  const monitorSpec = {
    chainPath: input.chainPath,
    emits: agent.emits || "",
    interval: input.env?.MENTIKO_MONITOR_INTERVAL || String(agent.monitor_interval || chain.config?.monitor_interval || 5),
    maxStale: input.env?.MENTIKO_MONITOR_MAX_STALE || String(agent.max_stale_count || 5),
    runId: input.runId
  };
  return {
    agentId: agent.id || "",
    agentName: agent.name || agent.id || "",
    sessionPrefix,
    sessionName,
    monitorSessionName: `monitor-${sessionName}`,
    statePath,
    artifactsDir,
    eventsDir,
    projectRoot: projectRoot2,
    sourceWorkspacePath,
    ...chain.metadata?.coreGenerationChain === true ? { coreGenerationChain: true } : {},
    ...profile.id ? { profileId: profile.id } : {},
    ...profile.path ? { profilePath: profile.path } : {},
    ...profile.readiness ? { profileReadiness: profile.readiness } : {},
    runContextExports,
    instructionPath,
    instructionPointer,
    localStartCommand: buildLocalStartCommand(projectRoot2, runContextExports, profile.path, input.env),
    monitorSpec,
    monitorCommand: buildMonitorCommand({
      sessionName,
      chainPath: monitorSpec.chainPath,
      agentId: agent.id || "",
      agentName: agent.name || agent.id || "",
      emits: monitorSpec.emits,
      interval: monitorSpec.interval,
      maxStale: monitorSpec.maxStale,
      runId: monitorSpec.runId,
      env: runContextExports
    })
  };
}
function retargetAgentBootstrapPlan(plan, projectRoot2, env) {
  const runContextExports = {
    ...plan.runContextExports,
    MENTIKO_PROJECT_ROOT: projectRoot2
  };
  return {
    ...plan,
    projectRoot: projectRoot2,
    runContextExports,
    localStartCommand: buildLocalStartCommand(
      projectRoot2,
      runContextExports,
      plan.profilePath,
      env
    ),
    monitorCommand: buildMonitorCommand({
      sessionName: plan.sessionName,
      chainPath: plan.monitorSpec.chainPath,
      agentId: plan.agentId,
      agentName: plan.agentName,
      emits: plan.monitorSpec.emits,
      interval: plan.monitorSpec.interval,
      maxStale: plan.monitorSpec.maxStale,
      runId: plan.monitorSpec.runId,
      env: runContextExports
    })
  };
}
function resolveLocalAiGatewayProxyEnv(env) {
  const inherited = [
    "MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED",
    "MENTIKO_AI_GATEWAY_LOCAL_BASE_URL",
    "MENTIKO_AI_GATEWAY_LOCAL_TOKEN"
  ].reduce((result, key) => {
    const value2 = env?.[key];
    if (typeof value2 === "string" && value2) result[key] = value2;
    return result;
  }, {});
  return { ...buildLocalAiGatewayProxyEnv(env?.MENTIKO_WEB_URL), ...inherited };
}
function readChain(path2) {
  return JSON.parse((0, import_fs8.readFileSync)(path2, "utf8"));
}
function resolveAgent(chain, agentId) {
  const agents = Array.isArray(chain.agents) ? chain.agents : [];
  const selected = agentId ? agents.find((agent) => agent.id === agentId) : agents.find((agent) => Array.isArray(agent.triggers) && agent.triggers.includes("manual-start")) || agents[0];
  if (!selected?.id) {
    throw new Error("runner-v2 bootstrap requires an agent id");
  }
  return selected;
}
function resolveSessionPrefix(chain, agent) {
  if (agent.session_prefix) return agent.session_prefix;
  return chain.config?.session_prefix ? `${chain.config.session_prefix}-${agent.id}` : agent.id || "agent";
}
function resolveAgentProfile2(chainPath, agentId, projectRoot2, env) {
  const explicitOrgRoot = env?.MENTIKO_ORG_ROOT || env?.NAMESPACE_ROOT || env?.MENTIKO_NAMESPACE_ROOT;
  const orgRoot2 = explicitOrgRoot || config_default.orgRoot;
  const profilesDir = env?.AGENT_PROFILES_DIR || (explicitOrgRoot ? (0, import_path7.join)(explicitOrgRoot, "agent-profiles") : config_default.agentProfilesDir);
  if (!profilesDir) return {};
  const profile = resolveAgentProfile({ chainPath, agentId, projectRoot: projectRoot2, profilesDir, orgRoot: orgRoot2 });
  return profile ? { id: profile.id, path: profile.path, readiness: profile.profile.readiness } : {};
}
function buildInstructionPointer(agentId, instructionPath) {
  return [
    `You are Mentiko agent: ${agentId}.`,
    "",
    "Your full instructions are in this file:",
    instructionPath,
    "",
    "Read that file first, then execute it exactly.",
    "When the instructions are complete, finish with AGENT_COMPLETE on its own final line."
  ].join("\n");
}
function buildLocalStartCommand(projectRoot2, runContextExports, profilePath, env) {
  const cli = env?.MENTIKO_CLI || "claude";
  const agentProfileCli = (0, import_path7.join)(config_default.codeRoot, "lib", "runner-agent-profile.js");
  const profileCommand = profilePath ? `eval "$(node ${shellEscape(agentProfileCli)} command --profile-path ${shellEscape(profilePath)} --interactive true --namespace-id ${shellEscape(runContextExports.NAMESPACE_ID)} --org-id ${shellEscape(runContextExports.ORG_ID)})"` : `exec ${shellEscape(cli)}`;
  return [
    `cd ${shellEscape(projectRoot2)}`,
    "unset CLAUDECODE",
    ...Object.entries(runContextExports).map(([key, value2]) => `export ${key}=${shellEscape(value2)}`),
    profileCommand
  ].join(" && ");
}
function buildMonitorCommand(input) {
  const compiledMonitor = (0, import_path7.join)(config_default.codeRoot, "lib", "monitor-v2.js");
  const context = `Agent: ${input.agentName} (${input.agentId}). Emits: ${input.emits}.`;
  return [
    ...Object.entries(input.env).filter(([, value2]) => value2 !== "").map(([key, value2]) => `export ${key}=${shellEscape(value2)}`),
    `export CHAIN_FILE=${shellEscape(input.chainPath)}`,
    `export MENTIKO_RUN_ID=${shellEscape(input.runId)}`,
    `export RUN_ID=${shellEscape(input.runId)}`,
    `export MENTIKO_AGENT_ID=${shellEscape(input.agentId)}`,
    `exec node ${shellEscape(compiledMonitor)} ${shellEscape(input.sessionName)} ${shellEscape(input.interval)} ${shellEscape(context)} ${shellEscape(input.chainPath)} ${shellEscape(input.maxStale)}`
  ].join("; ");
}

// lib/runner-v2/agent-attempt.ts
var import_fs9 = require("fs");
var ALLOWED_TRANSITIONS = {
  created: ["queued", "lease_acquired", "startup_failed", "human_action_required", "stuck", "released"],
  queued: ["lease_acquired", "startup_failed", "human_action_required", "released"],
  lease_acquired: ["pty_allocated", "startup_failed", "human_action_required", "released"],
  pty_allocated: ["process_spawned", "startup_failed", "human_action_required", "released"],
  process_spawned: ["ready_for_instructions", "startup_failed", "human_action_required", "stuck", "released"],
  ready_for_instructions: ["instructions_submitted", "startup_failed", "human_action_required", "stuck", "released"],
  instructions_submitted: ["completed", "completion_failed", "startup_failed", "human_action_required", "stuck", "released"],
  // Agent execution can be complete while the graph edge that integrates its
  // workspace result still needs human resolution.
  completed: ["human_action_required", "released"],
  completion_failed: ["released"],
  startup_failed: ["released"],
  human_action_required: ["released"],
  stuck: ["released"],
  released: []
};
var TERMINAL_PHASES = /* @__PURE__ */ new Set([
  "completed",
  "completion_failed",
  "startup_failed",
  "human_action_required",
  "stuck",
  "released"
]);
function isTerminalAgentAttemptPhase(phase) {
  return TERMINAL_PHASES.has(phase);
}
var NEXT_DESIRED_PHASE = {
  created: "queued",
  queued: "lease_acquired",
  lease_acquired: "pty_allocated",
  pty_allocated: "process_spawned",
  process_spawned: "ready_for_instructions",
  ready_for_instructions: "instructions_submitted",
  instructions_submitted: "completed"
};
var AgentAttemptTransitionError = class extends Error {
  constructor(from, to) {
    super(`invalid AgentAttempt transition: ${from} -> ${to}`);
    this.from = from;
    this.to = to;
    this.reason = "invalid_transition";
  }
};
function createAgentAttempt(input) {
  const at = iso(input.now);
  const state = readRunnerV2AttemptState(input.runJsonPath);
  const matching = state.attempts.filter(
    (attempt2) => attempt2.runId === input.runId && attempt2.agentId === input.agentId
  );
  const latest = matching[matching.length - 1];
  const attemptId = input.attemptId || (latest && isTerminalAgentAttemptPhase(latest.phase) ? `${input.runId}:${input.agentId}:${matching.length + 1}` : latest?.id || `${input.runId}:${input.agentId}:1`);
  const existing = state.attempts.find((item) => item.id === attemptId);
  if (existing) {
    if (input.launchJobId && existing.launchJobId !== input.launchJobId) {
      throw new Error(`AgentAttempt ${attemptId} belongs to another launch job`);
    }
    if (input.launchOccurrenceId && existing.launchOccurrenceId !== input.launchOccurrenceId) {
      throw new Error(`AgentAttempt ${attemptId} belongs to another launch occurrence`);
    }
    return existing;
  }
  const attempt = {
    id: attemptId,
    runId: input.runId,
    agentId: input.agentId,
    phase: "created",
    desiredPhase: "lease_acquired",
    observedPhase: "created",
    leaseId: input.leaseId,
    launchJobId: input.launchJobId,
    launchOccurrenceId: input.launchOccurrenceId,
    instructionLedger: [],
    recoveryDecisionCount: 0,
    createdAt: at,
    updatedAt: at,
    transitions: []
  };
  writeAttempt(input.runJsonPath, attempt);
  return attempt;
}
function transitionAgentAttempt(input) {
  const at = iso(input.now);
  return updateAttempt(input.runJsonPath, input.attemptId, (attempt) => {
    if (!canTransition(attempt.phase, input.to)) {
      throw new AgentAttemptTransitionError(attempt.phase, input.to);
    }
    const terminalReason = terminalReasonForTransition(attempt, input.to, input.reason);
    const terminalDetail = terminalDetailForTransition(attempt, input.to, input.detail);
    return {
      ...attempt,
      phase: input.to,
      desiredPhase: NEXT_DESIRED_PHASE[input.to] || input.to,
      observedPhase: input.to,
      terminalReason,
      terminalDetail,
      releaseReason: input.to === "released" ? input.reason : attempt.releaseReason,
      leaseAcquiredAt: input.to === "lease_acquired" ? at : attempt.leaseAcquiredAt,
      leaseReleasedAt: input.to === "released" ? at : attempt.leaseReleasedAt,
      capacitySlotAcquiredAt: input.to === "lease_acquired" && attempt.phase === "queued" ? at : attempt.capacitySlotAcquiredAt,
      capacitySlotReleasedAt: input.to === "released" && attempt.capacitySlotAcquiredAt ? at : attempt.capacitySlotReleasedAt,
      queueEnteredAt: input.to === "queued" ? at : attempt.queueEnteredAt,
      updatedAt: at,
      transitions: [
        ...attempt.transitions,
        { from: attempt.phase, to: input.to, at, reason: input.reason, detail: input.detail }
      ]
    };
  }, input.onMutation);
}
function recordAgentAttemptQueueOrder(input) {
  if (!Number.isSafeInteger(input.queueSequence) || input.queueSequence <= 0) {
    throw new Error("agent queue sequence must be a positive safe integer");
  }
  const at = iso(input.now);
  return updateAttempt(input.runJsonPath, input.attemptId, (attempt) => {
    if (attempt.phase !== "queued") {
      throw new Error(`AgentAttempt ${attempt.id} is not queued`);
    }
    if (attempt.queueSequence !== void 0 && attempt.queueSequence !== input.queueSequence) {
      throw new Error(`AgentAttempt ${attempt.id} already has queue sequence ${attempt.queueSequence}`);
    }
    return {
      ...attempt,
      queueSequence: attempt.queueSequence ?? input.queueSequence,
      queueEnteredAt: attempt.queueEnteredAt || at,
      updatedAt: at
    };
  });
}
function recordAgentAttemptRecoveryDecision(input) {
  const at = iso(input.now);
  return updateAttempt(input.runJsonPath, input.attemptId, (attempt) => ({
    ...attempt,
    recoveryDecisionCount: attempt.recoveryDecisionCount + 1,
    updatedAt: at
  }));
}
function recordAgentAttemptProcess(input) {
  const at = iso(input.now);
  return updateAttempt(input.runJsonPath, input.attemptId, (attempt) => ({
    ...attempt,
    processEvidence: {
      processPid: input.processPid,
      processSpawnedAt: at,
      ptySessionId: input.ptySessionId
    },
    updatedAt: at
  }));
}
function submitAgentAttemptInstructions(input) {
  let delivered = false;
  const at = iso(input.now);
  const attempt = updateAttempt(input.runJsonPath, input.attemptId, (current) => {
    const exists = current.instructionLedger.some((entry) => entry.idempotencyKey === input.idempotencyKey);
    if (exists) return current;
    delivered = true;
    return {
      ...current,
      instructionLedger: [
        ...current.instructionLedger,
        {
          idempotencyKey: input.idempotencyKey,
          submittedAt: at,
          instructionPath: input.instructionPath,
          pointer: input.pointer
        }
      ],
      updatedAt: at
    };
  });
  return { attempt, delivered };
}
function releaseAgentAttempt(input) {
  const attempt = readAttempt(input.runJsonPath, input.attemptId);
  if (attempt.phase === "released") return attempt;
  return transitionAgentAttempt({
    runJsonPath: input.runJsonPath,
    attemptId: input.attemptId,
    to: "released",
    reason: "released",
    now: input.now
  });
}
function readRunnerV2AttemptState(runJsonPath) {
  if (!(0, import_fs9.existsSync)(runJsonPath)) return { attempts: [] };
  const run = JSON.parse((0, import_fs9.readFileSync)(runJsonPath, "utf8"));
  return {
    attempts: Array.isArray(run.runnerV2?.attempts) ? run.runnerV2.attempts : [],
    stuckEvents: Array.isArray(run.runnerV2?.stuckEvents) ? run.runnerV2.stuckEvents : []
  };
}
function canTransition(from, to) {
  return ALLOWED_TRANSITIONS[from]?.includes(to) === true;
}
function classifyReadinessFailure(output) {
  const normalized = output.toLowerCase();
  if (/\b(log in|login|sign in|authenticate|authentication required|please authenticate)\b/.test(normalized) || /\b(api key|token)\b.*\b(required|missing|not found|invalid)\b/.test(normalized) || /\b(required|missing|invalid)\b.*\b(api key|token)\b/.test(normalized) || normalized.includes("oauth")) {
    return {
      phase: "human_action_required",
      reason: "auth_prompt_detected",
      detail: output.slice(-500)
    };
  }
  return {
    phase: "startup_failed",
    reason: "readiness_deadline_expired",
    detail: output.slice(-500)
  };
}
function readAttempt(runJsonPath, attemptId) {
  const attempt = readRunnerV2AttemptState(runJsonPath).attempts.find((item) => item.id === attemptId);
  if (!attempt) throw new Error(`AgentAttempt not found: ${attemptId}`);
  return attempt;
}
function writeAttempt(runJsonPath, attempt, onMutation) {
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const runnerV2 = current.runnerV2;
    const attempts = Array.isArray(runnerV2?.attempts) ? runnerV2.attempts : [];
    const existing = attempts.findIndex((item) => item.id === attempt.id);
    const nextAttempts = [...attempts];
    if (existing >= 0) nextAttempts[existing] = attempt;
    else nextAttempts.push(attempt);
    return {
      ...current,
      runnerV2: {
        ...runnerV2 || {},
        attempts: nextAttempts
      }
    };
  }, void 0, onMutation);
}
function updateAttempt(runJsonPath, attemptId, update, onMutation) {
  let updated;
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const runnerV2 = current.runnerV2;
    const attempts = Array.isArray(runnerV2?.attempts) ? runnerV2.attempts : [];
    const existing = attempts.findIndex((item) => item.id === attemptId);
    if (existing < 0) throw new Error(`AgentAttempt not found: ${attemptId}`);
    const nextAttempts = [...attempts];
    updated = update(nextAttempts[existing]);
    nextAttempts[existing] = updated;
    return {
      ...current,
      runnerV2: {
        ...runnerV2 || {},
        attempts: nextAttempts
      }
    };
  }, void 0, onMutation);
  if (!updated) throw new Error(`AgentAttempt not updated: ${attemptId}`);
  return updated;
}
function iso(now = /* @__PURE__ */ new Date()) {
  return now.toISOString();
}
function terminalReasonForTransition(attempt, to, reason) {
  if (!TERMINAL_PHASES.has(to)) return attempt.terminalReason;
  if (to === "released" && attempt.terminalReason) return attempt.terminalReason;
  return reason || attempt.terminalReason;
}
function terminalDetailForTransition(attempt, to, detail) {
  if (!TERMINAL_PHASES.has(to)) return attempt.terminalDetail;
  if (to === "released" && attempt.terminalDetail) return attempt.terminalDetail;
  return detail || attempt.terminalDetail;
}

// lib/runner-v2/concurrency-admission.ts
var CONCURRENCY_CAP_BLOCKED_REASON_PREFIX = "concurrency cap: waited ";

// lib/runner-v2/agent-capacity.ts
var import_node_path6 = require("node:path");

// lib/runner-v2/run-scope.ts
var import_node_fs5 = require("node:fs");
var import_node_path5 = require("node:path");
function projectRunsRootFor(runJsonPath) {
  const runDir = (0, import_node_path5.dirname)((0, import_node_path5.resolve)(runJsonPath));
  const parent = (0, import_node_path5.dirname)(runDir);
  return (0, import_node_path5.basename)(parent) === "runs" || (0, import_node_path5.basename)(runDir).startsWith("run-") ? parent : runDir;
}
function discoverScopedRunJsonPaths(scopeRoot, explicitRunJsonPath) {
  const paths = /* @__PURE__ */ new Set();
  if (explicitRunJsonPath && (0, import_node_fs5.existsSync)(explicitRunJsonPath)) {
    paths.add((0, import_node_path5.resolve)(explicitRunJsonPath));
  }
  const root = (0, import_node_path5.resolve)(scopeRoot);
  if ((0, import_node_path5.basename)(root) === "runs") addRunsDirectory(paths, root);
  addRunsDirectory(paths, root);
  addRunsDirectory(paths, (0, import_node_path5.join)(root, "runs"));
  const projectsRoot = (0, import_node_path5.join)(root, "projects");
  if ((0, import_node_fs5.existsSync)(projectsRoot)) {
    for (const entry of (0, import_node_fs5.readdirSync)(projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      addRunsDirectory(paths, (0, import_node_path5.join)(projectsRoot, entry.name, "runs"));
    }
  }
  return [...paths].sort();
}
function addRunsDirectory(paths, runsDir) {
  if (!(0, import_node_fs5.existsSync)(runsDir)) return;
  for (const entry of (0, import_node_fs5.readdirSync)(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
    const runJsonPath = (0, import_node_path5.join)(runsDir, entry.name, "run.json");
    if ((0, import_node_fs5.existsSync)(runJsonPath)) paths.add((0, import_node_path5.resolve)(runJsonPath));
  }
}

// lib/runner-v2/agent-capacity.ts
function capacityScopeRoot(runJsonPath, scopeRoot) {
  return scopeRoot || projectRunsRootFor(runJsonPath);
}
function capacityClaimPath(runJsonPath, scopeRoot) {
  const root = capacityScopeRoot(runJsonPath, scopeRoot);
  return scopeRoot ? (0, import_node_path6.join)(root, "state", ".agent-cap.lock") : (0, import_node_path6.join)(root, ".agent-cap.lock");
}
function capacitySlotHeld(attempt) {
  return Boolean(attempt.capacitySlotAcquiredAt) && !attempt.capacitySlotReleasedAt;
}
function scanCapacity(scopeRoot, explicitRunJsonPath) {
  let active = 0;
  const queued = [];
  let maxQueueSequence = 0;
  for (const runJsonPath of discoverScopedRunJsonPaths(scopeRoot, explicitRunJsonPath)) {
    const run = readRunJson(runJsonPath);
    const attempts = readRunnerV2AttemptState(runJsonPath).attempts;
    const capacityAgentIds = /* @__PURE__ */ new Set();
    for (const attempt of attempts) {
      if (capacitySlotHeld(attempt)) {
        active += 1;
        capacityAgentIds.add(attempt.agentId);
      }
      if (attempt.phase === "queued") {
        queued.push({ runJsonPath, runId: run.id, attempt });
      }
      if (Number.isSafeInteger(attempt.queueSequence)) {
        maxQueueSequence = Math.max(maxQueueSequence, attempt.queueSequence || 0);
      }
    }
    for (const agent of run.agents || []) {
      if (agent.status === "running" && !capacityAgentIds.has(agent.id)) active += 1;
    }
  }
  queued.sort((left, right) => (left.attempt.queueSequence ?? Number.MAX_SAFE_INTEGER) - (right.attempt.queueSequence ?? Number.MAX_SAFE_INTEGER) || (left.attempt.queueEnteredAt || left.attempt.createdAt).localeCompare(right.attempt.queueEnteredAt || right.attempt.createdAt) || left.runId.localeCompare(right.runId) || left.attempt.id.localeCompare(right.attempt.id));
  return { active, queued, maxQueueSequence };
}
function enqueueAgentAttempt(input) {
  return withExclusiveFileClaim(capacityClaimPath(input.runJsonPath, input.scopeRoot), () => {
    const current = readRunnerV2AttemptState(input.runJsonPath).attempts.find((attempt) => attempt.id === input.attemptId);
    if (!current) throw new Error(`AgentAttempt not found: ${input.attemptId}`);
    if (current.phase === "queued" && current.queueSequence) return current;
    if (current.phase !== "created") {
      throw new Error(`AgentAttempt ${input.attemptId} cannot enter the queue from ${current.phase}`);
    }
    const scan = scanCapacity(capacityScopeRoot(input.runJsonPath, input.scopeRoot), input.runJsonPath);
    const queued = transitionAgentAttempt({
      runJsonPath: input.runJsonPath,
      attemptId: input.attemptId,
      to: "queued",
      now: input.now
    });
    return recordAgentAttemptQueueOrder({
      runJsonPath: input.runJsonPath,
      attemptId: queued.id,
      queueSequence: scan.maxQueueSequence + 1,
      now: input.now
    });
  }, {
    freshMs: 6e4,
    waitTimeoutMs: 5e3,
    retryDelayMs: 50
  });
}
function admitQueuedAgentAttempt(input) {
  if (!Number.isSafeInteger(input.cap) || input.cap < 0) {
    return { status: "invalid", reason: "active agent cap must be a non-negative safe integer" };
  }
  const scopeRoot = capacityScopeRoot(input.runJsonPath, input.scopeRoot);
  return withExclusiveFileClaim(capacityClaimPath(input.runJsonPath, input.scopeRoot), () => {
    let scan;
    try {
      scan = scanCapacity(scopeRoot, input.runJsonPath);
    } catch (error) {
      return {
        status: "invalid",
        reason: error instanceof Error ? `agent capacity scan failed: ${error.message}` : "agent capacity scan failed"
      };
    }
    const currentRun = readRunJson(input.runJsonPath);
    if (currentRun.status !== "pending" && currentRun.status !== "running") {
      transitionAgentAttempt({
        runJsonPath: input.runJsonPath,
        attemptId: input.attemptId,
        to: "released",
        reason: "released",
        detail: `run ${currentRun.id} is no longer launchable (${currentRun.status})`,
        now: input.now
      });
      return {
        status: "cancelled",
        reason: `run ${currentRun.id} is no longer launchable (${currentRun.status})`
      };
    }
    if (input.launchJobId || input.launchOwnerId) {
      if (!input.launchJobId || !input.launchOwnerId || !routedLaunchJobLeaseOwned({
        runJsonPath: input.runJsonPath,
        jobId: input.launchJobId,
        ownerId: input.launchOwnerId,
        now: input.now
      })) {
        return {
          status: "ownership_lost",
          reason: `routed launch job lease is not owned for ${input.attemptId}`
        };
      }
    }
    const target = scan.queued.find((candidate) => candidate.runId === input.runId && candidate.attempt.id === input.attemptId);
    if (!target) {
      const current = readRunnerV2AttemptState(input.runJsonPath).attempts.find((attempt) => attempt.id === input.attemptId);
      if (current?.phase === "lease_acquired" && capacitySlotHeld(current)) {
        return { status: "admitted", active: scan.active, cap: input.cap };
      }
      return { status: "invalid", reason: `queued AgentAttempt not found: ${input.attemptId}` };
    }
    const position = scan.queued.indexOf(target) + 1;
    if (input.cap > 0 && (scan.active >= input.cap || position !== 1)) {
      return { status: "queued", active: scan.active, cap: input.cap, position };
    }
    transitionAgentAttempt({
      runJsonPath: input.runJsonPath,
      attemptId: input.attemptId,
      to: "lease_acquired",
      now: input.now
    });
    return { status: "admitted", active: scan.active + 1, cap: input.cap };
  }, {
    freshMs: 6e4,
    waitTimeoutMs: 5e3,
    retryDelayMs: 50
  });
}
async function waitForTypedAgentCapacity(input) {
  const now = input.now || (() => Date.now());
  const sleep2 = input.sleep || ((ms) => new Promise((resolve8) => setTimeout(resolve8, ms)));
  const started = now();
  let pollMs = Math.max(1, input.pollMs);
  while (true) {
    const decision = admitQueuedAgentAttempt({
      runJsonPath: input.runJsonPath,
      runId: input.runId,
      attemptId: input.attemptId,
      cap: input.cap,
      scopeRoot: input.scopeRoot,
      launchJobId: input.launchJobId,
      launchOwnerId: input.launchOwnerId,
      now: new Date(now())
    });
    if (decision.status !== "queued") return decision;
    const waitedMs = now() - started;
    if (waitedMs >= input.maxWaitMs) {
      return {
        status: "timeout",
        active: decision.active,
        cap: decision.cap,
        waitedMs
      };
    }
    await sleep2(pollMs);
    pollMs = Math.min(pollMs * 2, Math.max(1, input.pollMaxMs));
  }
}

// lib/runner-v2/readiness-policy.ts
var PATTERN_GROUPS = [
  { group: "blocked_patterns", status: "blocked" },
  { group: "recoverable_patterns", status: "recover" },
  { group: "retry_patterns", status: "retry" },
  { group: "ready_patterns", status: "ready" }
];
function isReadinessFailClosed(env = process.env) {
  return env.MENTIKO_READINESS_FAIL_CLOSED === "1";
}
function matchesPattern(output, pattern) {
  if (!pattern.value) return false;
  if (pattern.type === "regex") {
    try {
      return new RegExp(pattern.value, "i").test(output);
    } catch {
      return false;
    }
  }
  return output.includes(pattern.value);
}
function classifyCliReadiness(input) {
  if (input.profileMissing) {
    return { status: "unknown", reason: "profile file missing" };
  }
  const failClosed = input.failClosed ?? isReadinessFailClosed();
  const readiness2 = input.readiness;
  if (!readiness2 || readiness2.enabled !== true) {
    if (failClosed) {
      return { status: "no_ready_signal", reason: "readiness not enabled (fail-closed)" };
    }
    return { status: "ready", reason: "readiness disabled" };
  }
  for (const { group, status } of PATTERN_GROUPS) {
    for (const pattern of readiness2[group] ?? []) {
      if (pattern.enabled === false) continue;
      if (matchesPattern(input.output, pattern)) {
        const name = pattern.name || "unnamed pattern";
        return {
          status,
          reason: `matched ${name}`,
          pattern: name,
          ...pattern.action ? { action: pattern.action } : {},
          ...pattern.risk ? { risk: pattern.risk } : {}
        };
      }
    }
  }
  if ((readiness2.ready_patterns ?? []).length === 0) {
    if (failClosed) {
      return {
        status: "no_ready_signal",
        reason: "readiness enabled but no ready_patterns configured (fail-closed)"
      };
    }
    return { status: "ready", reason: "no ready patterns configured" };
  }
  return { status: "unknown", reason: "no readiness pattern matched" };
}

// lib/runner-v2/composer-submit.ts
function composerState(output) {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const idx = lines[i].indexOf("\u276F");
    if (idx === -1) continue;
    return lines[i].slice(idx + 1).trim().length > 0 ? "holding" : "empty";
  }
  return "absent";
}
function isComposerHoldingInput(output) {
  return composerState(output) === "holding";
}

// lib/runner-v2/workspace-evidence.ts
var import_node_crypto5 = require("node:crypto");
var import_node_fs8 = require("node:fs");
var import_node_path9 = require("node:path");

// lib/runner-v2/workspace-isolation.ts
var import_node_child_process2 = require("node:child_process");
var import_node_crypto4 = require("node:crypto");
var import_node_fs7 = require("node:fs");
var import_node_path8 = require("node:path");

// lib/runner-v2/workspace-snapshot.ts
var import_node_child_process = require("node:child_process");
var import_node_crypto3 = require("node:crypto");
var import_node_fs6 = require("node:fs");
var import_node_path7 = require("node:path");
var SNAPSHOT_VERSION = 1;
var GIT_TIMEOUT_MS = 12e4;
var GIT_MAX_BUFFER = 64 * 1024 * 1024;
var WorkspaceSnapshotError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "WorkspaceSnapshotError";
  }
};
function runGit(cwd, args, options = {}) {
  try {
    return (0, import_node_child_process.execFileSync)("git", args, {
      cwd,
      env: { ...process.env, ...options.env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? GIT_MAX_BUFFER
    }).trim();
  } catch (error) {
    const stderr = error.stderr;
    const detail = Buffer.isBuffer(stderr) ? stderr.toString("utf8").trim() : String(stderr || "").trim();
    throw new WorkspaceSnapshotError(
      `git ${args[0] || "command"} failed${detail ? `: ${detail}` : ""}`,
      error
    );
  }
}
function runGitOptional(cwd, args, options = {}) {
  try {
    const value2 = runGit(cwd, args, options);
    return value2 || void 0;
  } catch {
    return void 0;
  }
}
function runGitBytes(cwd, args) {
  try {
    const value2 = (0, import_node_child_process.execFileSync)("git", args, {
      cwd,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER
    });
    return Buffer.isBuffer(value2) ? value2 : Buffer.from(value2);
  } catch (error) {
    const stderr = error.stderr;
    const detail = Buffer.isBuffer(stderr) ? stderr.toString("utf8").trim() : String(stderr || "").trim();
    throw new WorkspaceSnapshotError(`git diff failed${detail ? `: ${detail}` : ""}`, error);
  }
}
function requireAbsoluteDirectory(path2, field) {
  if (!(0, import_node_path7.isAbsolute)(path2)) throw new WorkspaceSnapshotError(`${field} must be absolute: ${path2}`);
  const resolved = (0, import_node_fs6.realpathSync)((0, import_node_path7.resolve)(path2));
  if (!(0, import_node_fs6.lstatSync)(resolved).isDirectory()) {
    throw new WorkspaceSnapshotError(`${field} must be a directory: ${resolved}`);
  }
  return resolved;
}
function pathWithin(root, candidate) {
  const rel = (0, import_node_path7.relative)(root, candidate);
  return rel === "" || !rel.startsWith("..") && !(0, import_node_path7.isAbsolute)(rel);
}
function snapshotIdentity(label) {
  const safeLabel = label.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120) || "run";
  return {
    GIT_AUTHOR_NAME: "Mentiko Workspace Snapshot",
    GIT_AUTHOR_EMAIL: "workspace-snapshot@mentiko.local",
    GIT_COMMITTER_NAME: "Mentiko Workspace Snapshot",
    GIT_COMMITTER_EMAIL: "workspace-snapshot@mentiko.local",
    MENTIKO_WORKSPACE_SNAPSHOT_LABEL: safeLabel
  };
}
function captureGitWorkspaceSnapshot(input) {
  const sourceWorkspacePath = requireAbsoluteDirectory(input.workspacePath, "workspacePath");
  const scratchDir = requireAbsoluteDirectory(input.scratchDir, "scratchDir");
  const repositoryRootRaw = runGit(sourceWorkspacePath, ["rev-parse", "--show-toplevel"]);
  const repositoryRoot = requireAbsoluteDirectory(repositoryRootRaw, "repository root");
  if (!pathWithin(repositoryRoot, sourceWorkspacePath)) {
    throw new WorkspaceSnapshotError(`workspace is outside repository root: ${sourceWorkspacePath}`);
  }
  const gitCommonDirRaw = runGit(repositoryRoot, ["rev-parse", "--git-common-dir"]);
  const gitCommonDir = requireAbsoluteDirectory(
    (0, import_node_path7.isAbsolute)(gitCommonDirRaw) ? gitCommonDirRaw : (0, import_node_path7.resolve)(repositoryRoot, gitCommonDirRaw),
    "git common directory"
  );
  const relativeWorkspacePath = (0, import_node_path7.relative)(repositoryRoot, sourceWorkspacePath) || ".";
  const sourceHead = runGitOptional(repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
  const sourceBranch = runGitOptional(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const sourceIndexSha256 = (0, import_node_crypto3.createHash)("sha256").update(runGitBytes(repositoryRoot, ["ls-files", "--stage", "-z", "--", relativeWorkspacePath])).digest("hex");
  const baseCommit = input.baseCommit ? runGit(repositoryRoot, ["rev-parse", "--verify", `${input.baseCommit}^{commit}`]) : sourceHead;
  const capturedAt = input.capturedAt || (/* @__PURE__ */ new Date()).toISOString();
  const indexPath = (0, import_node_path7.join)(
    scratchDir,
    `.workspace-index-${process.pid}-${(0, import_node_crypto3.randomBytes)(8).toString("hex")}`
  );
  const identity = snapshotIdentity(input.label);
  const snapshotEnv = {
    ...identity,
    GIT_INDEX_FILE: indexPath,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_AUTHOR_DATE: capturedAt,
    GIT_COMMITTER_DATE: capturedAt
  };
  try {
    if (baseCommit) runGit(repositoryRoot, ["read-tree", baseCommit], { env: snapshotEnv });
    else runGit(repositoryRoot, ["read-tree", "--empty"], { env: snapshotEnv });
    runGit(repositoryRoot, ["add", "-A", "--", relativeWorkspacePath], { env: snapshotEnv });
    const snapshotTree = runGit(repositoryRoot, ["write-tree"], { env: snapshotEnv });
    const sourceTree = sourceHead ? runGit(repositoryRoot, ["rev-parse", `${sourceHead}^{tree}`]) : void 0;
    const baseTree = baseCommit ? runGit(repositoryRoot, ["rev-parse", `${baseCommit}^{tree}`]) : void 0;
    const dirtyFromHead = !sourceHead || snapshotTree !== sourceTree;
    const dirtyFromBase = !baseCommit || snapshotTree !== baseTree;
    const snapshotCommit = baseCommit && !dirtyFromBase ? baseCommit : runGit(
      repositoryRoot,
      [
        "commit-tree",
        snapshotTree,
        ...baseCommit ? ["-p", baseCommit] : [],
        "-m",
        `Mentiko workspace snapshot: ${identity.MENTIKO_WORKSPACE_SNAPSHOT_LABEL}`
      ],
      { env: snapshotEnv }
    );
    return {
      version: SNAPSHOT_VERSION,
      kind: "git",
      capturedAt,
      sourceWorkspacePath,
      repositoryRoot,
      gitCommonDir,
      relativeWorkspacePath,
      ...sourceHead ? { sourceHead } : {},
      ...sourceBranch ? { sourceBranch } : {},
      sourceIndexSha256,
      ...baseCommit ? { baseCommit } : {},
      snapshotCommit,
      snapshotTree,
      dirtyFromHead
    };
  } finally {
    try {
      (0, import_node_fs6.unlinkSync)(indexPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
function diffArgs(baseline, observed, ...args) {
  return [
    "diff",
    ...args,
    baseline.snapshotCommit,
    observed.snapshotCommit,
    "--",
    baseline.relativeWorkspacePath
  ];
}
function parseNameStatus(output) {
  const fields = output.toString("utf8").split("\0").filter((field) => field.length > 0);
  const statuses = /* @__PURE__ */ new Map();
  for (let index = 0; index < fields.length; ) {
    let statusField = fields[index++];
    let path2;
    const tab = statusField.indexOf("	");
    if (tab >= 0) {
      path2 = statusField.slice(tab + 1);
      statusField = statusField.slice(0, tab);
    } else {
      path2 = fields[index++];
    }
    if (!path2) throw new WorkspaceSnapshotError("invalid git name-status output");
    const status = statusField[0];
    statuses.set(path2, status === "A" ? "added" : status === "M" ? "modified" : status === "D" ? "deleted" : status === "T" ? "type_changed" : "unknown");
  }
  return statuses;
}
function parseNumstat(output) {
  const entries = /* @__PURE__ */ new Map();
  for (const record of output.toString("utf8").split("\0")) {
    if (!record) continue;
    const firstTab = record.indexOf("	");
    const secondTab = firstTab < 0 ? -1 : record.indexOf("	", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) throw new WorkspaceSnapshotError("invalid git numstat output");
    const additionsRaw = record.slice(0, firstTab);
    const deletionsRaw = record.slice(firstTab + 1, secondTab);
    const path2 = record.slice(secondTab + 1);
    if (!path2) throw new WorkspaceSnapshotError("invalid git numstat path");
    entries.set(path2, {
      additions: additionsRaw === "-" ? null : Number(additionsRaw),
      deletions: deletionsRaw === "-" ? null : Number(deletionsRaw)
    });
  }
  return entries;
}
function compareGitWorkspaceSnapshots(baseline, observed) {
  const baselineRepositoryIdentity = baseline.gitCommonDir || baseline.repositoryRoot;
  const observedRepositoryIdentity = observed.gitCommonDir || observed.repositoryRoot;
  if (baselineRepositoryIdentity !== observedRepositoryIdentity) {
    throw new WorkspaceSnapshotError("workspace snapshots belong to different repositories");
  }
  if (baseline.relativeWorkspacePath !== observed.relativeWorkspacePath) {
    throw new WorkspaceSnapshotError("workspace snapshots use different repository scopes");
  }
  const nameStatus = parseNameStatus(runGitBytes(
    baseline.repositoryRoot,
    diffArgs(baseline, observed, "--name-status", "--no-renames", "-z")
  ));
  const numstat = parseNumstat(runGitBytes(
    baseline.repositoryRoot,
    diffArgs(baseline, observed, "--numstat", "--no-renames", "-z")
  ));
  const files = [...nameStatus.entries()].map(([path2, status]) => ({
    path: path2,
    status,
    additions: numstat.get(path2)?.additions ?? null,
    deletions: numstat.get(path2)?.deletions ?? null
  })).sort((left, right) => left.path.localeCompare(right.path));
  const patch = runGitBytes(
    baseline.repositoryRoot,
    diffArgs(baseline, observed, "--binary", "--no-renames")
  );
  return {
    version: SNAPSHOT_VERSION,
    kind: "git",
    baselineCommit: baseline.snapshotCommit,
    observedCommit: observed.snapshotCommit,
    relativeWorkspacePath: baseline.relativeWorkspacePath,
    files,
    summary: {
      filesChanged: files.length,
      additions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
      deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0),
      binaryFiles: files.filter((file) => file.additions === null || file.deletions === null).length
    },
    patchSha256: (0, import_node_crypto3.createHash)("sha256").update(patch).digest("hex")
  };
}
function createWorkspaceSnapshotScratchDir(runDir) {
  if (!(0, import_node_path7.isAbsolute)(runDir)) throw new WorkspaceSnapshotError(`runDir must be absolute: ${runDir}`);
  const scratchDir = (0, import_node_path7.resolve)(runDir, ".internal", "workspace-snapshots");
  (0, import_node_fs6.mkdirSync)(scratchDir, { recursive: true, mode: 448 });
  return scratchDir;
}

// lib/runner-v2/workspace-isolation.ts
var WORKSPACE_ISOLATION_VERSION = 1;
var GIT_TIMEOUT_MS2 = 12e4;
var GIT_MAX_BUFFER2 = 64 * 1024 * 1024;
var REF_ROOT = "refs/mentiko/runs";
var WorkspaceIsolationError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "WorkspaceIsolationError";
  }
};
function runGitResult(cwd, args, env = {}) {
  const result = (0, import_node_child_process2.spawnSync)("git", args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS2,
    maxBuffer: GIT_MAX_BUFFER2
  });
  if (result.error) {
    throw new WorkspaceIsolationError(`git ${args[0] || "command"} could not start`, result.error);
  }
  if (result.status === null) {
    throw new WorkspaceIsolationError(`git ${args[0] || "command"} did not return an exit status`);
  }
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || ""),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || "")
  };
}
function runGit2(cwd, args, env = {}) {
  const result = runGitResult(cwd, args, env);
  if (result.status !== 0) {
    const detail = result.stderr.toString("utf8").trim();
    throw new WorkspaceIsolationError(
      `git ${args[0] || "command"} failed${detail ? `: ${detail}` : ""}`
    );
  }
  return result.stdout.toString("utf8").trim();
}
function runGitOptional2(cwd, args) {
  const result = runGitResult(cwd, args);
  if (result.status !== 0) return void 0;
  const value2 = result.stdout.toString("utf8").trim();
  return value2 || void 0;
}
function requireAbsoluteDirectory2(path2, field) {
  if (!(0, import_node_path8.isAbsolute)(path2)) throw new WorkspaceIsolationError(`${field} must be absolute: ${path2}`);
  const resolved = (0, import_node_fs7.realpathSync)((0, import_node_path8.resolve)(path2));
  if (!(0, import_node_fs7.lstatSync)(resolved).isDirectory()) {
    throw new WorkspaceIsolationError(`${field} must be a directory: ${resolved}`);
  }
  return resolved;
}
function canonicalGitCommonDir(repositoryRoot) {
  const raw = runGit2(repositoryRoot, ["rev-parse", "--git-common-dir"]);
  return requireAbsoluteDirectory2(
    (0, import_node_path8.isAbsolute)(raw) ? raw : (0, import_node_path8.resolve)(repositoryRoot, raw),
    "git common directory"
  );
}
function digest(value2, length = 16) {
  return (0, import_node_crypto4.createHash)("sha256").update(value2).digest("hex").slice(0, length);
}
function safeRefComponent(value2) {
  const readable = value2.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 64) || "run";
  return `${readable}-${digest(value2, 12)}`;
}
function runRefPrefix(runId) {
  return `${REF_ROOT}/${safeRefComponent(runId)}`;
}
function readRef(repositoryRoot, ref) {
  return runGitOptional2(repositoryRoot, ["show-ref", "--verify", "--hash", ref]);
}
function updateRef(repositoryRoot, ref, nextCommit, expectedCommit) {
  runGit2(repositoryRoot, ["update-ref", ref, nextCommit, expectedCommit || ""]);
}
function ensureRef(repositoryRoot, ref, commit) {
  const current = readRef(repositoryRoot, ref);
  if (current === commit) return;
  if (current) {
    throw new WorkspaceIsolationError(`Git ref ${ref} points to ${current}, expected ${commit}`);
  }
  try {
    updateRef(repositoryRoot, ref, commit, void 0);
  } catch (error) {
    const raced = readRef(repositoryRoot, ref);
    if (raced === commit) return;
    throw error;
  }
}
function requiredRef(repositoryRoot, ref) {
  const value2 = readRef(repositoryRoot, ref);
  if (!value2) throw new WorkspaceIsolationError(`required Git ref is missing: ${ref}`);
  return value2;
}
function readJson2(path2) {
  try {
    if ((0, import_node_fs7.lstatSync)(path2).isSymbolicLink()) {
      throw new WorkspaceIsolationError(`workspace isolation record cannot be a symbolic link: ${path2}`);
    }
    return JSON.parse((0, import_node_fs7.readFileSync)(path2, "utf8"));
  } catch (error) {
    if (error instanceof WorkspaceIsolationError) throw error;
    throw new WorkspaceIsolationError(`workspace isolation record is unreadable: ${path2}`, error);
  }
}
function writeJsonOnce(path2, value2) {
  (0, import_node_fs7.mkdirSync)((0, import_node_path8.dirname)(path2), { recursive: true, mode: 448 });
  if ((0, import_node_fs7.existsSync)(path2)) return readJson2(path2);
  const tempPath = (0, import_node_path8.join)(
    (0, import_node_path8.dirname)(path2),
    `.${(0, import_node_path8.basename)(path2)}.${process.pid}.${(0, import_node_crypto4.randomBytes)(8).toString("hex")}.tmp`
  );
  try {
    (0, import_node_fs7.writeFileSync)(tempPath, `${JSON.stringify(value2, null, 2)}
`, { flag: "wx", mode: 384 });
    try {
      (0, import_node_fs7.linkSync)(tempPath, path2);
      return value2;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return readJson2(path2);
    }
  } finally {
    try {
      (0, import_node_fs7.unlinkSync)(tempPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
function assertRunIsolation(value2, expected) {
  if (value2.version !== WORKSPACE_ISOLATION_VERSION || value2.kind !== "git-worktrees" || value2.runId !== expected.runId || value2.statePath !== expected.statePath) {
    throw new WorkspaceIsolationError(`run workspace isolation identity mismatch: ${expected.statePath}`);
  }
  if (canonicalGitCommonDir(value2.sourceRepositoryRoot) !== value2.gitCommonDir) {
    throw new WorkspaceIsolationError(`run workspace isolation repository changed: ${value2.statePath}`);
  }
  if (requiredRef(value2.sourceRepositoryRoot, value2.baselineRef) !== value2.baselineCommit) {
    throw new WorkspaceIsolationError(`run baseline ref changed: ${value2.baselineRef}`);
  }
  requiredRef(value2.sourceRepositoryRoot, value2.integrationRef);
  return value2;
}
function initializeGitRunWorkspaceIsolation(input) {
  const runDir = requireAbsoluteDirectory2(input.runDir, "runDir");
  const sourceRepositoryRoot = requireAbsoluteDirectory2(
    input.baseline.repositoryRoot,
    "source repository root"
  );
  const gitCommonDir = canonicalGitCommonDir(sourceRepositoryRoot);
  if (input.baseline.gitCommonDir && input.baseline.gitCommonDir !== gitCommonDir) {
    throw new WorkspaceIsolationError("workspace baseline belongs to a different Git common directory");
  }
  const baselineCommit = runGit2(sourceRepositoryRoot, [
    "rev-parse",
    "--verify",
    `${input.baseline.snapshotCommit}^{commit}`
  ]);
  const baselineTree = runGit2(sourceRepositoryRoot, ["rev-parse", `${baselineCommit}^{tree}`]);
  if (baselineTree !== input.baseline.snapshotTree) {
    throw new WorkspaceIsolationError("workspace baseline commit and tree do not match");
  }
  const isolationRoot = (0, import_node_path8.join)(runDir, ".internal", "workspace-isolation");
  const worktreesRoot = (0, import_node_path8.join)(isolationRoot, "worktrees");
  const statePath = (0, import_node_path8.join)(isolationRoot, "run-workspace.json");
  const refPrefix = runRefPrefix(input.runId);
  (0, import_node_fs7.mkdirSync)(worktreesRoot, { recursive: true, mode: 448 });
  return withExclusiveFileClaim((0, import_node_path8.join)(isolationRoot, "claims", "initialize.claim"), () => {
    if ((0, import_node_fs7.existsSync)(statePath)) {
      return assertRunIsolation(readJson2(statePath), {
        runId: input.runId,
        statePath
      });
    }
    const baselineRef = `${refPrefix}/baseline`;
    const integrationRef = `${refPrefix}/integration`;
    ensureRef(sourceRepositoryRoot, baselineRef, baselineCommit);
    ensureRef(sourceRepositoryRoot, integrationRef, baselineCommit);
    const candidate = {
      version: WORKSPACE_ISOLATION_VERSION,
      kind: "git-worktrees",
      runId: input.runId,
      runDir,
      sourceWorkspacePath: input.baseline.sourceWorkspacePath,
      sourceRepositoryRoot,
      gitCommonDir,
      relativeWorkspacePath: input.baseline.relativeWorkspacePath,
      baselineCommit,
      baselineTree,
      baselineRef,
      integrationRef,
      isolationRoot,
      worktreesRoot,
      statePath,
      createdAt: (input.now || /* @__PURE__ */ new Date()).toISOString()
    };
    const persisted = writeJsonOnce(statePath, candidate);
    return assertRunIsolation(persisted, { runId: input.runId, statePath });
  }, { waitTimeoutMs: 5e3 });
}
function nodeRecordPath(runWorkspace2, attemptId) {
  return (0, import_node_path8.join)(runWorkspace2.isolationRoot, "nodes", `${digest(attemptId, 32)}.json`);
}
function assertNodeWorkspaceRecord(runWorkspace2, node, expected) {
  const nodeKey = digest(expected.attemptId, 32);
  const expectedWorktreeRoot = (0, import_node_path8.join)(runWorkspace2.worktreesRoot, nodeKey);
  const expectedWorkspacePath = runWorkspace2.relativeWorkspacePath === "." ? expectedWorktreeRoot : (0, import_node_path8.join)(expectedWorktreeRoot, runWorkspace2.relativeWorkspacePath);
  const expectedAttemptRef = `${runRefPrefix(runWorkspace2.runId)}/attempts/${nodeKey}`;
  if (node.version !== WORKSPACE_ISOLATION_VERSION || node.kind !== "git-node-worktree" || node.runId !== runWorkspace2.runId || node.agentId !== expected.agentId || node.attemptId !== expected.attemptId || node.recordPath !== expected.recordPath || node.relativeWorkspacePath !== runWorkspace2.relativeWorkspacePath || node.worktreeRoot !== expectedWorktreeRoot || node.workspacePath !== expectedWorkspacePath || node.attemptRef !== expectedAttemptRef) {
    throw new WorkspaceIsolationError(`node workspace identity mismatch: ${expected.recordPath}`);
  }
  const baseCommit = runGit2(
    runWorkspace2.sourceRepositoryRoot,
    ["rev-parse", "--verify", `${node.baseCommit}^{commit}`]
  );
  if (baseCommit !== node.baseCommit || !isAncestor(runWorkspace2.sourceRepositoryRoot, runWorkspace2.baselineCommit, node.baseCommit)) {
    throw new WorkspaceIsolationError(`node workspace base is outside the run history: ${node.baseCommit}`);
  }
  return node;
}
function assertNodeWorkspace(runWorkspace2, value2, expected) {
  const node = assertNodeWorkspaceRecord(runWorkspace2, value2, expected);
  if (!(0, import_node_fs7.existsSync)(node.worktreeRoot)) {
    throw new WorkspaceIsolationError(`node worktree is missing: ${node.worktreeRoot}`);
  }
  const worktreeRoot = requireAbsoluteDirectory2(node.worktreeRoot, "node worktree root");
  if (worktreeRoot !== node.worktreeRoot) {
    throw new WorkspaceIsolationError(`node worktree path changed: ${node.worktreeRoot}`);
  }
  if (runGit2(worktreeRoot, ["rev-parse", "--show-toplevel"]) !== node.worktreeRoot) {
    throw new WorkspaceIsolationError(`node path is not its Git worktree root: ${node.worktreeRoot}`);
  }
  if (canonicalGitCommonDir(worktreeRoot) !== runWorkspace2.gitCommonDir) {
    throw new WorkspaceIsolationError(`node worktree belongs to a different repository: ${node.worktreeRoot}`);
  }
  const currentAttemptRef = requiredRef(runWorkspace2.sourceRepositoryRoot, node.attemptRef);
  if (currentAttemptRef !== node.baseCommit) {
    const resultArtifact = nodeResultArtifactPath(runWorkspace2, node);
    if (!(0, import_node_fs7.existsSync)(resultArtifact)) {
      throw new WorkspaceIsolationError(
        `node attempt ref changed before a durable result existed: ${currentAttemptRef}`
      );
    }
    const result = assertNodeResult(
      runWorkspace2,
      node,
      readJson2(resultArtifact),
      resultArtifact
    );
    if (currentAttemptRef !== result.resultCommit) {
      throw new WorkspaceIsolationError(`node attempt ref does not match its durable result: ${node.attemptRef}`);
    }
  }
  (0, import_node_fs7.mkdirSync)(node.workspacePath, { recursive: true, mode: 448 });
  return node;
}
function allocateGitNodeWorkspace(input) {
  const runWorkspace2 = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath
  });
  const recordPath = nodeRecordPath(runWorkspace2, input.attemptId);
  const nodeKey = digest(input.attemptId, 32);
  return withExclusiveFileClaim(
    (0, import_node_path8.join)(runWorkspace2.isolationRoot, "claims", "nodes", `${nodeKey}.claim`),
    () => {
      if ((0, import_node_fs7.existsSync)(recordPath)) {
        const existing = assertNodeWorkspace(runWorkspace2, readJson2(recordPath), {
          agentId: input.agentId,
          attemptId: input.attemptId,
          recordPath
        });
        if (input.baseCommit && existing.baseCommit !== input.baseCommit) {
          throw new WorkspaceIsolationError(
            `node workspace base differs from its routing-time commit: ${existing.baseCommit}`
          );
        }
        return existing;
      }
      const attemptRef = `${runRefPrefix(runWorkspace2.runId)}/attempts/${nodeKey}`;
      let baseCommit = readRef(runWorkspace2.sourceRepositoryRoot, attemptRef);
      if (!baseCommit) {
        baseCommit = withExclusiveFileClaim(
          (0, import_node_path8.join)(runWorkspace2.isolationRoot, "claims", "integration.claim"),
          () => {
            const current = requiredRef(
              runWorkspace2.sourceRepositoryRoot,
              runWorkspace2.integrationRef
            );
            const requested = input.baseCommit ? runGit2(runWorkspace2.sourceRepositoryRoot, [
              "rev-parse",
              "--verify",
              `${input.baseCommit}^{commit}`
            ]) : current;
            if (!isAncestor(runWorkspace2.sourceRepositoryRoot, requested, current)) {
              throw new WorkspaceIsolationError(
                `requested node base is not in the run integration history: ${requested}`
              );
            }
            ensureRef(runWorkspace2.sourceRepositoryRoot, attemptRef, requested);
            return requested;
          },
          { waitTimeoutMs: 3e4 }
        );
      }
      if (input.baseCommit && baseCommit !== input.baseCommit) {
        throw new WorkspaceIsolationError(
          `node workspace base differs from its routing-time commit: ${baseCommit}`
        );
      }
      const worktreeRoot = (0, import_node_path8.join)(runWorkspace2.worktreesRoot, nodeKey);
      if (!(0, import_node_fs7.existsSync)(worktreeRoot)) {
        runGit2(runWorkspace2.sourceRepositoryRoot, [
          "worktree",
          "add",
          "--detach",
          worktreeRoot,
          baseCommit
        ]);
      } else {
        const existingRoot = requireAbsoluteDirectory2(worktreeRoot, "existing node worktree");
        if (canonicalGitCommonDir(existingRoot) !== runWorkspace2.gitCommonDir || runGit2(existingRoot, ["rev-parse", "HEAD"]) !== baseCommit) {
          throw new WorkspaceIsolationError(`unowned path blocks node worktree allocation: ${worktreeRoot}`);
        }
      }
      const workspacePath = runWorkspace2.relativeWorkspacePath === "." ? worktreeRoot : (0, import_node_path8.join)(worktreeRoot, runWorkspace2.relativeWorkspacePath);
      (0, import_node_fs7.mkdirSync)(workspacePath, { recursive: true, mode: 448 });
      const candidate = {
        version: WORKSPACE_ISOLATION_VERSION,
        kind: "git-node-worktree",
        runId: runWorkspace2.runId,
        agentId: input.agentId,
        attemptId: input.attemptId,
        baseCommit,
        attemptRef,
        worktreeRoot,
        workspacePath,
        relativeWorkspacePath: runWorkspace2.relativeWorkspacePath,
        recordPath,
        createdAt: (input.now || /* @__PURE__ */ new Date()).toISOString()
      };
      const persisted = writeJsonOnce(recordPath, candidate);
      return assertNodeWorkspace(runWorkspace2, persisted, {
        agentId: input.agentId,
        attemptId: input.attemptId,
        recordPath
      });
    },
    { waitTimeoutMs: 3e4 }
  );
}
function readGitNodeWorkspace(input) {
  const runWorkspace2 = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath
  });
  const recordPath = nodeRecordPath(runWorkspace2, input.attemptId);
  if (!(0, import_node_fs7.existsSync)(recordPath)) {
    throw new WorkspaceIsolationError(`node workspace record is missing: ${recordPath}`);
  }
  return assertNodeWorkspace(runWorkspace2, readJson2(recordPath), {
    agentId: input.agentId,
    attemptId: input.attemptId,
    recordPath
  });
}
function nodeResultArtifactPath(runWorkspace2, node) {
  return (0, import_node_path8.join)(
    runWorkspace2.isolationRoot,
    "receipts",
    "results",
    `${digest(node.attemptId, 32)}.json`
  );
}
function baseSnapshotForNode(runWorkspace2, node, capturedAt) {
  return {
    version: 1,
    kind: "git",
    capturedAt,
    sourceWorkspacePath: node.workspacePath,
    // Compare immutable commit objects through the source repository so replay
    // remains valid after the disposable node worktree has been removed.
    repositoryRoot: runWorkspace2.sourceRepositoryRoot,
    gitCommonDir: runWorkspace2.gitCommonDir,
    relativeWorkspacePath: node.relativeWorkspacePath,
    sourceHead: node.baseCommit,
    baseCommit: node.baseCommit,
    snapshotCommit: node.baseCommit,
    snapshotTree: runGit2(runWorkspace2.sourceRepositoryRoot, ["rev-parse", `${node.baseCommit}^{tree}`]),
    dirtyFromHead: false
  };
}
function assertNodeResult(runWorkspace2, node, result, artifactPath) {
  const snapshot = result?.snapshot;
  if (!result || result.version !== WORKSPACE_ISOLATION_VERSION || result.kind !== "git-node-result" || result.runId !== node.runId || result.agentId !== node.agentId || result.attemptId !== node.attemptId || result.baseCommit !== node.baseCommit || result.artifactPath !== artifactPath || typeof result.capturedAt !== "string" || !Number.isFinite(Date.parse(result.capturedAt)) || !snapshot || snapshot.version !== 1 || snapshot.kind !== "git" || snapshot.capturedAt !== result.capturedAt || snapshot.sourceWorkspacePath !== node.workspacePath || snapshot.repositoryRoot !== node.worktreeRoot || snapshot.gitCommonDir !== runWorkspace2.gitCommonDir || snapshot.relativeWorkspacePath !== node.relativeWorkspacePath || snapshot.baseCommit !== node.baseCommit || snapshot.snapshotCommit !== result.resultCommit) {
    throw new WorkspaceIsolationError(`node result identity mismatch: ${artifactPath}`);
  }
  const verifiedCommit = runGit2(
    runWorkspace2.sourceRepositoryRoot,
    ["rev-parse", "--verify", `${result.resultCommit}^{commit}`]
  );
  const verifiedTree = runGit2(
    runWorkspace2.sourceRepositoryRoot,
    ["rev-parse", `${result.resultCommit}^{tree}`]
  );
  const parents = runGit2(
    runWorkspace2.sourceRepositoryRoot,
    ["show", "-s", "--format=%P", result.resultCommit]
  ).split(/\s+/).filter(Boolean);
  const validCommitShape = result.resultCommit === node.baseCommit || parents.length === 1 && parents[0] === node.baseCommit;
  const expectedChangeSet = compareGitWorkspaceSnapshots(
    baseSnapshotForNode(runWorkspace2, node, node.createdAt),
    snapshot
  );
  if (verifiedCommit !== result.resultCommit || verifiedTree !== snapshot.snapshotTree || !validCommitShape || JSON.stringify(result.changeSet) !== JSON.stringify(expectedChangeSet)) {
    throw new WorkspaceIsolationError(`node result Git evidence mismatch: ${artifactPath}`);
  }
  return result;
}
function isAncestor(repositoryRoot, ancestor, descendant) {
  const result = runGitResult(repositoryRoot, ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  const detail = result.stderr.toString("utf8").trim();
  throw new WorkspaceIsolationError(`git merge-base failed${detail ? `: ${detail}` : ""}`);
}
function mergeTree(repositoryRoot, left, right) {
  const result = runGitResult(repositoryRoot, [
    "merge-tree",
    "--write-tree",
    "--name-only",
    "--no-messages",
    "-z",
    left,
    right
  ]);
  const fields = result.stdout.toString("utf8").split("\0").filter(Boolean);
  if (result.status === 1) {
    return { status: "conflict", paths: fields.slice(1).sort() };
  }
  if (result.status !== 0 || !fields[0]) {
    const detail = result.stderr.toString("utf8").trim();
    throw new WorkspaceIsolationError(`git merge-tree failed${detail ? `: ${detail}` : ""}`);
  }
  return { status: "merged", tree: fields[0] };
}
function integrationArtifactPathForAttempt(runWorkspace2, agentId, attemptId) {
  return (0, import_node_path8.join)(
    runWorkspace2.isolationRoot,
    "receipts",
    "integrations",
    `${digest(`${agentId}\0${attemptId}`, 32)}.json`
  );
}
function assertIntegrationResult(result, integration, artifactPath) {
  assertPersistedIntegrationResult(integration, artifactPath, result.runId, result.agentId, result.attemptId);
  if (integration.baseCommit !== result.baseCommit || integration.resultCommit !== result.resultCommit) {
    throw new WorkspaceIsolationError(`node integration identity mismatch: ${artifactPath}`);
  }
  return integration;
}
function assertPersistedIntegrationResult(integration, artifactPath, runId, agentId, attemptId) {
  const statuses = /* @__PURE__ */ new Set([
    "integrated",
    "already-integrated",
    "no-changes",
    "conflict"
  ]);
  const commits = [
    integration.baseCommit,
    integration.resultCommit,
    integration.previousIntegrationCommit,
    integration.integrationCommit,
    ...integration.mergeCommit ? [integration.mergeCommit] : []
  ];
  const validTimestamp = typeof integration.integratedAt === "string" && Number.isFinite(Date.parse(integration.integratedAt));
  const validConflictPaths = Array.isArray(integration.conflictPaths) && integration.conflictPaths.every((path2) => typeof path2 === "string" && path2.length > 0);
  const conflictPaths = validConflictPaths ? integration.conflictPaths : [];
  const validStatusInvariant = validConflictPaths && (() => {
    switch (integration.status) {
      case "conflict":
        return conflictPaths.length > 0 && integration.integrationCommit === integration.previousIntegrationCommit && !integration.mergeCommit;
      case "no-changes":
        return conflictPaths.length === 0 && integration.resultCommit === integration.baseCommit && integration.integrationCommit === integration.previousIntegrationCommit && !integration.mergeCommit;
      case "already-integrated":
        return conflictPaths.length === 0 && integration.integrationCommit === integration.previousIntegrationCommit && !integration.mergeCommit;
      case "integrated":
        return conflictPaths.length === 0 && (integration.mergeCommit ? integration.mergeCommit === integration.integrationCommit : integration.integrationCommit === integration.resultCommit);
      default:
        return false;
    }
  })();
  if (integration.version !== WORKSPACE_ISOLATION_VERSION || integration.kind !== "git-node-integration" || integration.runId !== runId || integration.agentId !== agentId || integration.attemptId !== attemptId || integration.artifactPath !== artifactPath || !statuses.has(integration.status) || commits.some((commit) => typeof commit !== "string" || commit.length === 0) || !validTimestamp || !validConflictPaths || !validStatusInvariant) {
    throw new WorkspaceIsolationError(`node integration identity mismatch: ${artifactPath}`);
  }
}
function readNodeResultForIntegration(input) {
  const recordPath = nodeRecordPath(input.runWorkspace, input.attemptId);
  if (!(0, import_node_fs7.existsSync)(recordPath)) {
    throw new WorkspaceIsolationError(`node workspace record is missing: ${recordPath}`);
  }
  const node = assertNodeWorkspaceRecord(
    input.runWorkspace,
    readJson2(recordPath),
    {
      agentId: input.agentId,
      attemptId: input.attemptId,
      recordPath
    }
  );
  const resultPath = nodeResultArtifactPath(input.runWorkspace, node);
  if (!(0, import_node_fs7.existsSync)(resultPath)) {
    throw new WorkspaceIsolationError(`node result receipt is missing: ${resultPath}`);
  }
  const result = assertNodeResult(
    input.runWorkspace,
    node,
    readJson2(resultPath),
    resultPath
  );
  if ((0, import_node_fs7.existsSync)(node.worktreeRoot)) {
    const observed = captureGitWorkspaceSnapshot({
      workspacePath: node.workspacePath,
      scratchDir: createWorkspaceSnapshotScratchDir(input.runWorkspace.runDir),
      label: `${node.runId}-${node.agentId}-${node.attemptId}-result`,
      capturedAt: result.capturedAt,
      baseCommit: node.baseCommit
    });
    if (observed.gitCommonDir !== input.runWorkspace.gitCommonDir || observed.snapshotCommit !== result.resultCommit || observed.snapshotTree !== result.snapshot.snapshotTree || result.snapshot.sourceIndexSha256 !== void 0 && observed.sourceIndexSha256 !== result.snapshot.sourceIndexSha256) {
      throw new WorkspaceIsolationError(`node worktree differs from its result receipt: ${resultPath}`);
    }
  }
  return { node, result };
}
function assertIntegrationGitEvidence(input) {
  const { runWorkspace: runWorkspace2, result, integration, artifactPath, currentIntegrationCommit } = input;
  assertIntegrationResult(result, integration, artifactPath);
  for (const commit of [
    integration.baseCommit,
    integration.resultCommit,
    integration.previousIntegrationCommit,
    integration.integrationCommit,
    ...integration.mergeCommit ? [integration.mergeCommit] : []
  ]) {
    runGit2(runWorkspace2.sourceRepositoryRoot, ["rev-parse", "--verify", `${commit}^{commit}`]);
  }
  switch (integration.status) {
    case "no-changes":
      if (integration.resultCommit !== integration.baseCommit) {
        throw new WorkspaceIsolationError(`node no-change receipt has a changed result: ${artifactPath}`);
      }
      break;
    case "already-integrated":
      if (!isAncestor(
        runWorkspace2.sourceRepositoryRoot,
        integration.resultCommit,
        integration.previousIntegrationCommit
      )) {
        throw new WorkspaceIsolationError(`node result was not already integrated: ${artifactPath}`);
      }
      break;
    case "conflict": {
      const replay = mergeTree(
        runWorkspace2.sourceRepositoryRoot,
        integration.previousIntegrationCommit,
        integration.resultCommit
      );
      if (replay.status !== "conflict" || JSON.stringify(replay.paths) !== JSON.stringify(integration.conflictPaths)) {
        throw new WorkspaceIsolationError(`node conflict receipt is not reproducible: ${artifactPath}`);
      }
      break;
    }
    case "integrated":
      if (integration.mergeCommit) {
        const parents = runGit2(
          runWorkspace2.sourceRepositoryRoot,
          ["show", "-s", "--format=%P", integration.mergeCommit]
        ).split(/\s+/).filter(Boolean);
        const replay = mergeTree(
          runWorkspace2.sourceRepositoryRoot,
          integration.previousIntegrationCommit,
          integration.resultCommit
        );
        const mergeTreeValue = runGit2(
          runWorkspace2.sourceRepositoryRoot,
          ["rev-parse", `${integration.mergeCommit}^{tree}`]
        );
        if (parents.length !== 2 || parents[0] !== integration.previousIntegrationCommit || parents[1] !== integration.resultCommit || replay.status !== "merged" || replay.tree !== mergeTreeValue) {
          throw new WorkspaceIsolationError(`node merge receipt does not match Git history: ${artifactPath}`);
        }
      } else if (integration.previousIntegrationCommit !== integration.baseCommit || integration.integrationCommit !== integration.resultCommit) {
        throw new WorkspaceIsolationError(`node direct integration receipt is invalid: ${artifactPath}`);
      }
      break;
  }
  const pendingRefAdvance = integration.status === "integrated" && currentIntegrationCommit === integration.previousIntegrationCommit;
  if (!pendingRefAdvance && !isAncestor(
    runWorkspace2.sourceRepositoryRoot,
    integration.integrationCommit,
    currentIntegrationCommit
  )) {
    throw new WorkspaceIsolationError(`node integration is outside the current run history: ${artifactPath}`);
  }
  return integration;
}
function reconcileIntegrationRef(runWorkspace2, integration) {
  const current = requiredRef(runWorkspace2.sourceRepositoryRoot, runWorkspace2.integrationRef);
  if (integration.status === "integrated" && current === integration.previousIntegrationCommit) {
    updateRef(
      runWorkspace2.sourceRepositoryRoot,
      runWorkspace2.integrationRef,
      integration.integrationCommit,
      integration.previousIntegrationCommit
    );
    return;
  }
  if (!isAncestor(runWorkspace2.sourceRepositoryRoot, integration.integrationCommit, current)) {
    throw new WorkspaceIsolationError(
      `run integration ref does not contain node ${integration.attemptId}`
    );
  }
}
function reconcilePendingIntegrationReceipts(runWorkspace2) {
  const receiptsRoot = (0, import_node_path8.join)(runWorkspace2.isolationRoot, "receipts", "integrations");
  if (!(0, import_node_fs7.existsSync)(receiptsRoot)) return;
  const receiptPaths = (0, import_node_fs7.readdirSync)(receiptsRoot).filter((name) => name.endsWith(".json")).sort().map((name) => (0, import_node_path8.join)(receiptsRoot, name));
  for (const artifactPath of receiptPaths) {
    const integration = readJson2(artifactPath);
    if (typeof integration.agentId !== "string" || integration.agentId.length === 0 || typeof integration.attemptId !== "string" || integration.attemptId.length === 0) {
      throw new WorkspaceIsolationError(`node integration identity mismatch: ${artifactPath}`);
    }
    assertPersistedIntegrationResult(
      integration,
      artifactPath,
      runWorkspace2.runId,
      integration.agentId,
      integration.attemptId
    );
    const current = requiredRef(runWorkspace2.sourceRepositoryRoot, runWorkspace2.integrationRef);
    if (isAncestor(
      runWorkspace2.sourceRepositoryRoot,
      integration.integrationCommit,
      current
    )) {
      continue;
    }
    const { result } = readNodeResultForIntegration({
      runWorkspace: runWorkspace2,
      agentId: integration.agentId,
      attemptId: integration.attemptId
    });
    const verified = assertIntegrationGitEvidence({
      runWorkspace: runWorkspace2,
      result,
      integration,
      artifactPath,
      currentIntegrationCommit: current
    });
    reconcileIntegrationRef(runWorkspace2, verified);
  }
}
function readGitNodeIntegrationResult(input) {
  const runWorkspace2 = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath
  });
  const artifactPath = integrationArtifactPathForAttempt(
    runWorkspace2,
    input.agentId,
    input.attemptId
  );
  return withExclusiveFileClaim(
    (0, import_node_path8.join)(runWorkspace2.isolationRoot, "claims", "integration.claim"),
    () => {
      reconcilePendingIntegrationReceipts(runWorkspace2);
      if (!(0, import_node_fs7.existsSync)(artifactPath)) return void 0;
      const { result } = readNodeResultForIntegration(input);
      const current = requiredRef(runWorkspace2.sourceRepositoryRoot, runWorkspace2.integrationRef);
      const integration = assertIntegrationGitEvidence({
        runWorkspace: runWorkspace2,
        result,
        integration: readJson2(artifactPath),
        artifactPath,
        currentIntegrationCommit: current
      });
      reconcileIntegrationRef(runWorkspace2, integration);
      return integration;
    },
    { waitTimeoutMs: 3e4 }
  );
}
function removeIntegratedGitNodeWorkspace(input) {
  const runWorkspace2 = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath
  });
  const integration = readGitNodeIntegrationResult(input);
  if (!integration) {
    throw new WorkspaceIsolationError(
      `cannot remove node workspace before integration: ${input.attemptId}`
    );
  }
  if (integration.status === "conflict") return "preserved-conflict";
  const recordPath = nodeRecordPath(runWorkspace2, input.attemptId);
  if (!(0, import_node_fs7.existsSync)(recordPath)) {
    throw new WorkspaceIsolationError(`node workspace record is missing: ${recordPath}`);
  }
  const node = readJson2(recordPath);
  const nodeKey = digest(input.attemptId, 32);
  const expectedWorktreeRoot = (0, import_node_path8.join)(runWorkspace2.worktreesRoot, nodeKey);
  const expectedAttemptRef = `${runRefPrefix(runWorkspace2.runId)}/attempts/${nodeKey}`;
  if (node.runId !== runWorkspace2.runId || node.agentId !== input.agentId || node.attemptId !== input.attemptId || node.recordPath !== recordPath || node.worktreeRoot !== expectedWorktreeRoot || node.attemptRef !== expectedAttemptRef) {
    throw new WorkspaceIsolationError(`node workspace cleanup identity mismatch: ${recordPath}`);
  }
  const existed = (0, import_node_fs7.existsSync)(node.worktreeRoot);
  if (existed) {
    runGit2(runWorkspace2.sourceRepositoryRoot, [
      "worktree",
      "remove",
      "--force",
      node.worktreeRoot
    ]);
  }
  runGit2(runWorkspace2.sourceRepositoryRoot, ["update-ref", "-d", node.attemptRef]);
  return existed ? "removed" : "already-removed";
}
function removePristineGitNodeWorkspace(input) {
  const runWorkspace2 = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath
  });
  const recordPath = nodeRecordPath(runWorkspace2, input.attemptId);
  if (!(0, import_node_fs7.existsSync)(recordPath)) return "already-removed";
  const candidate = readJson2(recordPath);
  const nodeKey = digest(input.attemptId, 32);
  const expectedWorktreeRoot = (0, import_node_path8.join)(runWorkspace2.worktreesRoot, nodeKey);
  const expectedAttemptRef = `${runRefPrefix(runWorkspace2.runId)}/attempts/${nodeKey}`;
  if (candidate.runId !== runWorkspace2.runId || candidate.agentId !== input.agentId || candidate.attemptId !== input.attemptId || candidate.recordPath !== recordPath || candidate.worktreeRoot !== expectedWorktreeRoot || candidate.attemptRef !== expectedAttemptRef) {
    throw new WorkspaceIsolationError(`node workspace cleanup identity mismatch: ${recordPath}`);
  }
  if (!(0, import_node_fs7.existsSync)(candidate.worktreeRoot)) {
    runGit2(runWorkspace2.sourceRepositoryRoot, ["update-ref", "-d", candidate.attemptRef]);
    return "already-removed";
  }
  const node = assertNodeWorkspace(runWorkspace2, candidate, {
    agentId: input.agentId,
    attemptId: input.attemptId,
    recordPath
  });
  const head = runGit2(node.worktreeRoot, ["rev-parse", "HEAD"]);
  const status = runGit2(node.worktreeRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (head !== node.baseCommit || status.length > 0) return "preserved-changes";
  runGit2(runWorkspace2.sourceRepositoryRoot, [
    "worktree",
    "remove",
    "--force",
    node.worktreeRoot
  ]);
  runGit2(runWorkspace2.sourceRepositoryRoot, ["update-ref", "-d", node.attemptRef]);
  return "removed";
}

// lib/runner-v2/workspace-evidence-types.ts
var WORKSPACE_EVIDENCE_VERSION = 1;

// lib/runner-v2/workspace-evidence.ts
var WorkspaceEvidenceError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "WorkspaceEvidenceError";
  }
};
function executionRecord(run) {
  return run.workspaceExecution;
}
function priorExecutionEvidence(run) {
  const runnerV2 = run.runnerV2;
  if (Array.isArray(runnerV2?.attempts) && runnerV2.attempts.length > 0) return true;
  if ((run.sessions || []).some((session) => typeof session === "string" && session.length > 0)) return true;
  return run.agents.some((agent) => agent.status !== "pending" || Boolean(agent.session));
}
function unavailableRecord(input) {
  return {
    version: WORKSPACE_EVIDENCE_VERSION,
    tracking: "unavailable",
    ...input.sourceWorkspacePath ? { sourceWorkspacePath: input.sourceWorkspacePath } : {},
    baselineArtifactPath: input.baselineArtifactPath,
    isolation: "shared",
    concurrentWritesIsolated: false,
    reason: input.reason,
    recordedAt: input.recordedAt,
    handoffs: []
  };
}
function baselineArtifact(runId, record) {
  const common = {
    version: WORKSPACE_EVIDENCE_VERSION,
    kind: "workspace-baseline",
    runId,
    tracking: record.tracking,
    ...record.sourceWorkspacePath ? { sourceWorkspacePath: record.sourceWorkspacePath } : {},
    baselineArtifactPath: record.baselineArtifactPath,
    isolation: record.isolation,
    concurrentWritesIsolated: record.concurrentWritesIsolated
  };
  return record.tracking === "git" ? { ...common, baseline: record.baseline } : { ...common, reason: record.reason, recordedAt: record.recordedAt };
}
function writeJsonOnce2(path2, value2) {
  (0, import_node_fs8.mkdirSync)((0, import_node_path9.dirname)(path2), { recursive: true, mode: 448 });
  const tempPath = (0, import_node_path9.join)(
    (0, import_node_path9.dirname)(path2),
    `.${(0, import_node_path9.basename)(path2)}.${process.pid}.${(0, import_node_crypto5.randomBytes)(8).toString("hex")}.tmp`
  );
  try {
    (0, import_node_fs8.writeFileSync)(tempPath, `${JSON.stringify(value2, null, 2)}
`, { flag: "wx", mode: 384 });
    try {
      (0, import_node_fs8.linkSync)(tempPath, path2);
      return value2;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return JSON.parse((0, import_node_fs8.readFileSync)(path2, "utf8"));
    }
  } finally {
    try {
      (0, import_node_fs8.unlinkSync)(tempPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
function assertRunIdentity(run, runId) {
  if (!run) throw new WorkspaceEvidenceError(`run ${runId} is missing while recording workspace evidence`);
  if (run.id !== runId) {
    throw new WorkspaceEvidenceError(`workspace evidence run id ${runId} does not match ${run.id}`);
  }
  return run;
}
function ensureRunWorkspaceBaselineUnlocked(input) {
  const initial = assertRunIdentity(readRunJson(input.runJsonPath), input.runId);
  const existing = executionRecord(initial);
  if (existing) {
    writeJsonOnce2(existing.baselineArtifactPath, baselineArtifact(input.runId, existing));
    return existing;
  }
  const recordedAt = (input.now || /* @__PURE__ */ new Date()).toISOString();
  const sourceWorkspacePath = input.workspacePath ? (0, import_node_path9.resolve)(input.workspacePath) : void 0;
  const baselineArtifactPath = (0, import_node_path9.join)(input.runDir, "artifacts", "workspace-baseline.json");
  let candidate;
  if (priorExecutionEvidence(initial)) {
    candidate = unavailableRecord({
      sourceWorkspacePath,
      baselineArtifactPath,
      recordedAt,
      reason: "run already has durable launch or agent execution evidence; refusing a late workspace baseline"
    });
  } else if (!sourceWorkspacePath) {
    candidate = unavailableRecord({
      baselineArtifactPath,
      recordedAt,
      reason: "run has no registered local workspace path"
    });
  } else {
    let baseline;
    try {
      baseline = captureGitWorkspaceSnapshot({
        workspacePath: sourceWorkspacePath,
        scratchDir: createWorkspaceSnapshotScratchDir(input.runDir),
        label: `${input.runId}-baseline`,
        capturedAt: recordedAt
      });
    } catch (error) {
      candidate = unavailableRecord({
        sourceWorkspacePath,
        baselineArtifactPath,
        recordedAt,
        reason: error instanceof Error ? error.message : "workspace snapshot capture failed"
      });
    }
    if (baseline) {
      let isolation;
      try {
        isolation = initializeGitRunWorkspaceIsolation({
          runId: input.runId,
          runDir: input.runDir,
          baseline,
          now: input.now
        });
      } catch (error) {
        throw new WorkspaceEvidenceError(
          `Git workspace isolation initialization failed for run ${input.runId}`,
          error
        );
      }
      candidate = {
        version: WORKSPACE_EVIDENCE_VERSION,
        tracking: "git",
        sourceWorkspacePath: baseline.sourceWorkspacePath,
        baselineArtifactPath,
        isolation: "git-worktree",
        concurrentWritesIsolated: true,
        baseline,
        isolationStatePath: isolation.statePath,
        baselineRef: isolation.baselineRef,
        integrationRef: isolation.integrationRef,
        handoffs: []
      };
    }
  }
  const persistedRun = updateRunJson(input.runJsonPath, (current) => {
    const run = assertRunIdentity(current, input.runId);
    if (executionRecord(run)) return run;
    const selected = priorExecutionEvidence(run) && candidate.tracking === "git" ? unavailableRecord({
      sourceWorkspacePath,
      baselineArtifactPath,
      recordedAt,
      reason: "launch evidence appeared before the workspace baseline claim; refusing a late capture"
    }) : candidate;
    return { ...run, workspaceExecution: selected };
  });
  const persisted = executionRecord(persistedRun);
  if (!persisted) throw new WorkspaceEvidenceError(`run ${input.runId} did not persist workspace evidence`);
  writeJsonOnce2(persisted.baselineArtifactPath, baselineArtifact(input.runId, persisted));
  return persisted;
}
function ensureRunWorkspaceBaseline(input) {
  return withExclusiveFileClaim(
    (0, import_node_path9.join)(input.runDir, ".internal", "workspace-baseline.claim"),
    () => ensureRunWorkspaceBaselineUnlocked(input),
    { waitTimeoutMs: 3e4 }
  );
}
function safeArtifactSegment(value2) {
  return value2.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 180) || "attempt";
}
function readHandoffArtifact(path2, input) {
  let artifact;
  try {
    artifact = JSON.parse((0, import_node_fs8.readFileSync)(path2, "utf8"));
  } catch (error) {
    throw new WorkspaceEvidenceError(`workspace handoff artifact is unreadable: ${path2}`, error);
  }
  if (artifact.kind !== "workspace-handoff" || artifact.runId !== input.runId || artifact.agentId !== input.agentId || artifact.attemptId !== input.attemptId) {
    throw new WorkspaceEvidenceError(`workspace handoff artifact identity mismatch: ${path2}`);
  }
  return artifact;
}
function captureAgentWorkspaceHandoff(input) {
  const current = assertRunIdentity(readRunJson(input.runJsonPath), input.runId);
  const existingHandoff = executionRecord(current)?.handoffs.find(
    (handoff) => handoff.attemptId === input.attemptId
  );
  if (existingHandoff) {
    if (!(0, import_node_fs8.existsSync)(existingHandoff.artifactPath)) {
      throw new WorkspaceEvidenceError(`workspace handoff record has no artifact: ${existingHandoff.artifactPath}`);
    }
    return readHandoffArtifact(existingHandoff.artifactPath, input);
  }
  const artifactPath = (0, import_node_path9.join)(
    input.runDir,
    "artifacts",
    `${safeArtifactSegment(input.agentId)}-workspace-start-${safeArtifactSegment(input.attemptId)}.json`
  );
  const capturedAt = (input.now || /* @__PURE__ */ new Date()).toISOString();
  const common = {
    version: WORKSPACE_EVIDENCE_VERSION,
    kind: "workspace-handoff",
    runId: input.runId,
    agentId: input.agentId,
    attemptId: input.attemptId,
    capturedAt,
    artifactPath,
    baselineArtifactPath: input.workspaceExecution.baselineArtifactPath,
    isolation: input.workspaceExecution.isolation,
    concurrentWritesIsolated: input.workspaceExecution.concurrentWritesIsolated
  };
  let candidate;
  if (input.workspaceExecution.tracking === "unavailable") {
    candidate = {
      ...common,
      tracking: "unavailable",
      reason: input.workspaceExecution.reason
    };
  } else {
    try {
      const observed = captureGitWorkspaceSnapshot({
        workspacePath: input.workspacePath || input.workspaceExecution.sourceWorkspacePath,
        scratchDir: createWorkspaceSnapshotScratchDir(input.runDir),
        label: input.attemptId,
        capturedAt,
        ...input.nodeBaseCommit ? { baseCommit: input.nodeBaseCommit } : {}
      });
      candidate = {
        ...common,
        tracking: "git",
        workspacePath: observed.sourceWorkspacePath,
        ...input.nodeBaseCommit ? { nodeBaseCommit: input.nodeBaseCommit } : {},
        ...input.nodeWorkspaceRecordPath ? { nodeWorkspaceRecordPath: input.nodeWorkspaceRecordPath } : {},
        baseline: input.workspaceExecution.baseline,
        observed,
        changeSet: compareGitWorkspaceSnapshots(input.workspaceExecution.baseline, observed)
      };
    } catch (error) {
      candidate = {
        ...common,
        tracking: "unavailable",
        reason: error instanceof Error ? error.message : "workspace handoff capture failed"
      };
    }
  }
  const artifact = writeJsonOnce2(artifactPath, candidate);
  if (artifact.kind !== "workspace-handoff" || artifact.runId !== input.runId || artifact.agentId !== input.agentId || artifact.attemptId !== input.attemptId) {
    throw new WorkspaceEvidenceError(`workspace handoff artifact identity mismatch: ${artifactPath}`);
  }
  updateRunJson(input.runJsonPath, (runValue) => {
    const run = assertRunIdentity(runValue, input.runId);
    const workspaceExecution = executionRecord(run);
    if (!workspaceExecution) {
      throw new WorkspaceEvidenceError(`run ${input.runId} lost its workspace baseline before handoff`);
    }
    if (workspaceExecution.handoffs.some((handoff) => handoff.attemptId === input.attemptId)) return run;
    return {
      ...run,
      workspaceExecution: {
        ...workspaceExecution,
        handoffs: [
          ...workspaceExecution.handoffs,
          {
            attemptId: input.attemptId,
            agentId: input.agentId,
            capturedAt: artifact.capturedAt,
            artifactPath: artifact.artifactPath,
            tracking: artifact.tracking,
            ...artifact.tracking === "git" && artifact.nodeWorkspaceRecordPath ? { nodeWorkspaceRecordPath: artifact.nodeWorkspaceRecordPath } : {}
          }
        ]
      }
    };
  });
  return artifact;
}

// lib/runner-v2/workspace-cleanup.ts
var import_node_crypto6 = require("node:crypto");
var import_node_fs9 = require("node:fs");
var import_node_path10 = require("node:path");
var CLEANUP_VERSION = 1;
function cleanupId(mode, attemptId) {
  return (0, import_node_crypto6.createHash)("sha256").update(`${mode}\0${attemptId}`).digest("hex");
}
function cleanupRoot(runWorkspace2) {
  return (0, import_node_path10.join)(runWorkspace2.isolationRoot, "cleanup");
}
function pendingPath(runWorkspace2, mode, attemptId) {
  return (0, import_node_path10.join)(cleanupRoot(runWorkspace2), "pending", `${cleanupId(mode, attemptId)}.json`);
}
function completedPath(runWorkspace2, jobId) {
  return (0, import_node_path10.join)(cleanupRoot(runWorkspace2), "completed", `${jobId}.json`);
}
function readJson3(path2) {
  if ((0, import_node_fs9.lstatSync)(path2).isSymbolicLink()) {
    throw new Error(`workspace cleanup record cannot be a symbolic link: ${path2}`);
  }
  return JSON.parse((0, import_node_fs9.readFileSync)(path2, "utf8"));
}
function writeJsonOnce3(path2, value2) {
  (0, import_node_fs9.mkdirSync)((0, import_node_path10.dirname)(path2), { recursive: true, mode: 448 });
  if ((0, import_node_fs9.existsSync)(path2)) return readJson3(path2);
  const temporary = (0, import_node_path10.join)(
    (0, import_node_path10.dirname)(path2),
    `.${(0, import_node_path10.basename)(path2)}.${process.pid}.${(0, import_node_crypto6.randomBytes)(8).toString("hex")}.tmp`
  );
  try {
    (0, import_node_fs9.writeFileSync)(temporary, `${JSON.stringify(value2, null, 2)}
`, { flag: "wx", mode: 384 });
    try {
      (0, import_node_fs9.linkSync)(temporary, path2);
      return value2;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return readJson3(path2);
    }
  } finally {
    try {
      (0, import_node_fs9.unlinkSync)(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
function assertJob(value2, runWorkspace2, path2) {
  const job = value2;
  const mode = job.mode === "integrated" || job.mode === "pristine-startup" ? job.mode : void 0;
  const attemptId = typeof job.attemptId === "string" && job.attemptId.length > 0 ? job.attemptId : void 0;
  const expectedId = mode && attemptId ? cleanupId(mode, attemptId) : void 0;
  const expectedPendingPath = mode && attemptId ? pendingPath(runWorkspace2, mode, attemptId) : void 0;
  if (!value2 || typeof value2 !== "object" || job.version !== CLEANUP_VERSION || job.kind !== "git-node-workspace-cleanup" || typeof job.id !== "string" || job.id !== expectedId || job.runId !== runWorkspace2.runId || typeof job.agentId !== "string" || job.agentId.length === 0 || !attemptId || !mode || job.pendingPath !== path2 || path2 !== expectedPendingPath || typeof job.requestedAt !== "string" || !Number.isFinite(Date.parse(job.requestedAt))) {
    throw new Error(`invalid workspace cleanup job: ${path2}`);
  }
  return job;
}
function assertReceipt(value2, job, path2) {
  const receipt = value2;
  const outcomes = /* @__PURE__ */ new Set([
    "removed",
    "already-removed",
    "preserved-conflict",
    "preserved-changes"
  ]);
  if (!value2 || typeof value2 !== "object" || receipt.version !== job.version || receipt.kind !== "git-node-workspace-cleanup-receipt" || receipt.id !== job.id || receipt.runId !== job.runId || receipt.agentId !== job.agentId || receipt.attemptId !== job.attemptId || receipt.mode !== job.mode || receipt.pendingPath !== job.pendingPath || typeof receipt.requestedAt !== "string" || !Number.isFinite(Date.parse(receipt.requestedAt)) || receipt.completedPath !== path2 || !outcomes.has(receipt.outcome) || typeof receipt.completedAt !== "string" || !Number.isFinite(Date.parse(receipt.completedAt))) {
    throw new Error(`invalid workspace cleanup receipt: ${path2}`);
  }
  return receipt;
}
function clearPending(path2) {
  try {
    (0, import_node_fs9.unlinkSync)(path2);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
function executeCleanupJob(input) {
  const completed = completedPath(input.runWorkspace, input.job.id);
  const claim = (0, import_node_path10.join)(cleanupRoot(input.runWorkspace), "claims", `${input.job.id}.claim`);
  return withExclusiveFileClaim(claim, () => {
    if ((0, import_node_fs9.existsSync)(completed)) {
      const receipt2 = assertReceipt(readJson3(completed), input.job, completed);
      clearPending(input.job.pendingPath);
      return receipt2;
    }
    const target = {
      runWorkspace: input.runWorkspace,
      agentId: input.job.agentId,
      attemptId: input.job.attemptId
    };
    const outcome = input.job.mode === "integrated" ? removeIntegratedGitNodeWorkspace(target) : removePristineGitNodeWorkspace(target);
    input.afterCleanup?.(outcome);
    const candidate = {
      ...input.job,
      kind: "git-node-workspace-cleanup-receipt",
      outcome,
      completedPath: completed,
      completedAt: (input.now || /* @__PURE__ */ new Date()).toISOString()
    };
    const receipt = assertReceipt(writeJsonOnce3(completed, candidate), input.job, completed);
    clearPending(input.job.pendingPath);
    return receipt;
  }, { waitTimeoutMs: 3e4 });
}
function cleanupGitNodeWorkspaceDurably(input) {
  const path2 = pendingPath(input.runWorkspace, input.mode, input.attemptId);
  const candidate = {
    version: CLEANUP_VERSION,
    kind: "git-node-workspace-cleanup",
    id: cleanupId(input.mode, input.attemptId),
    runId: input.runWorkspace.runId,
    agentId: input.agentId,
    attemptId: input.attemptId,
    mode: input.mode,
    pendingPath: path2,
    requestedAt: (input.now || /* @__PURE__ */ new Date()).toISOString()
  };
  const job = assertJob(writeJsonOnce3(path2, candidate), input.runWorkspace, path2);
  if (job.agentId !== input.agentId) {
    throw new Error(`workspace cleanup job belongs to another agent: ${path2}`);
  }
  return executeCleanupJob({
    runWorkspace: input.runWorkspace,
    job,
    now: input.now,
    afterCleanup: input.afterCleanup
  });
}

// lib/runner-v2/readiness-cli.ts
var import_node_child_process3 = require("node:child_process");
var import_node_fs10 = require("node:fs");
var import_node_path11 = require("node:path");
function runReadinessCli(argv, write = (line) => console.log(line)) {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = parse(rest);
  if (command === "classify") {
    reject(values, ["--profile-path", "--capture-path", "--fail-closed"]);
    const profilePath = required(values, "--profile-path");
    const capturePath = required(values, "--capture-path");
    if (!(0, import_node_fs10.existsSync)(profilePath)) {
      write(JSON.stringify({ status: "unknown", reason: "profile file missing" }));
      return;
    }
    if (!(0, import_node_fs10.existsSync)(capturePath)) {
      write(JSON.stringify({ status: "unknown", reason: "capture file missing" }));
      return;
    }
    assertRegularInput(profilePath, "profile");
    assertRegularInput(capturePath, "capture");
    let result;
    try {
      result = classifyCliReadiness({
        readiness: loadAgentProfile(profilePath).profile.readiness,
        output: (0, import_node_fs10.readFileSync)(capturePath, "utf8"),
        failClosed: optional(values, "--fail-closed") === "true"
      });
    } catch {
      result = { status: "unknown", reason: "readiness profile unreadable" };
    }
    write(JSON.stringify(result));
    return;
  }
  if (command === "wait") {
    reject(values, [
      "--profile-path",
      "--pty-cmd",
      "--session",
      "--max-wait-secs",
      "--poll-secs",
      "--fail-closed",
      "--capture-path",
      "--recovery-enabled",
      "--recovery-max",
      "--profiles-dir",
      "--namespace-id",
      "--org-id",
      "--agent-id",
      "--profile-id",
      "--run-id",
      "--cli",
      "--cwd",
      "--command",
      "--state-file",
      "--artifact-dir"
    ]);
    const waited = waitForReadiness({
      profilePath: required(values, "--profile-path"),
      ptyCommand: required(values, "--pty-cmd"),
      session: required(values, "--session"),
      maxWaitSecs: nonNegativeInteger(required(values, "--max-wait-secs"), "--max-wait-secs"),
      pollSecs: positiveInteger(required(values, "--poll-secs"), "--poll-secs"),
      failClosed: optional(values, "--fail-closed") === "true",
      capturePath: optional(values, "--capture-path"),
      recovery: buildRecovery(values)
    });
    write(JSON.stringify(waited.result));
    if (waited.exitCode !== 0) process.exitCode = waited.exitCode;
    return;
  }
  if (command === "result") {
    reject(values, ["--status", "--reason"]);
    write(JSON.stringify({ status: required(values, "--status"), reason: required(values, "--reason") }));
    return;
  }
  reject(values, ["--result-json", "--field"]);
  const parsed = JSON.parse(required(values, "--result-json"));
  const field = required(values, "--field");
  if (field !== "status" && field !== "reason") throw new Error("--field must be status or reason");
  write(typeof parsed[field] === "string" ? parsed[field] : "");
}
function waitForReadiness(input) {
  if (!(0, import_node_fs10.existsSync)(input.profilePath)) return { result: { status: "unknown", reason: "profile file missing" }, exitCode: 4 };
  assertRegularInput(input.profilePath, "profile");
  const now = input.now || (() => Date.now());
  const sleep2 = input.sleep || ((milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds));
  const run = input.run || ((command, args) => (0, import_node_child_process3.spawnSync)(command, args, { encoding: "utf8" }));
  const started = now();
  let recoveryAttempts = 0;
  for (; ; ) {
    const alive = run(input.ptyCommand, ["alive", input.session]);
    const pid = run(input.ptyCommand, ["pid", input.session]);
    if (alive.status !== 0 || alive.stdout.trim() !== "alive" || pid.status !== 0 || !/^\d+$/.test(pid.stdout.trim())) {
      return { result: { status: "unknown", reason: "PTY session died during startup" }, exitCode: 1 };
    }
    const capture = run(input.ptyCommand, ["capture", input.session, "120"]);
    const output = capture.status === 0 ? capture.stdout : "";
    if (input.capturePath) writeCaptureAtomically(input.capturePath, output);
    const result = classifyCliReadiness({
      readiness: loadAgentProfile(input.profilePath).profile.readiness,
      output,
      failClosed: input.failClosed
    });
    if (result.status === "ready") return { result, exitCode: 0 };
    if (isRecoverable(result.status) && canAttemptRecovery(input.recovery, recoveryAttempts)) {
      recoveryAttempts += 1;
      if (attemptStartupRecovery(input, result, output, run)) continue;
    }
    if (isTerminal(result.status)) {
      writeStartupRecoveryArtifacts(input.recovery, result, output);
      return { result, exitCode: 2 };
    }
    if (!input.failClosed) return { result: { status: "ready", reason: "legacy readiness policy permits unresolved startup" }, exitCode: 0 };
    if (now() - started >= input.maxWaitSecs * 1e3) {
      const timeout = { status: "unknown", reason: `CLI readiness timeout after ${input.maxWaitSecs}s` };
      writeStartupRecoveryArtifacts(input.recovery, timeout, output);
      return { result: timeout, exitCode: 4 };
    }
    sleep2(input.pollSecs * 1e3);
  }
}
function isRecoverable(status) {
  return status === "blocked" || status === "recover" || status === "retry";
}
function isTerminal(status) {
  return status === "blocked" || status === "recover" || status === "retry" || status === "no_ready_signal";
}
function canAttemptRecovery(recovery, attempts) {
  return Boolean(recovery?.enabled && recovery.profilesDir && attempts < recovery.maxAttempts);
}
function attemptStartupRecovery(input, readiness2, output, run) {
  const recovery = input.recovery;
  if (!recovery) return false;
  const payload = decideStartupRecovery({
    recovery,
    readiness: readiness2,
    output,
    advisorRun: input.advisorRun
  });
  if (!payload) return false;
  if (payload.action === "send_keys") {
    if (!payload.keys?.length) return false;
    let applied = false;
    for (const key of payload.keys) {
      const sent = run(input.ptyCommand, ["send", input.session, "--raw", recoveryKeyBytes(key)]);
      if (sent.status !== 0) return false;
      applied = true;
    }
    return applied;
  }
  if (!recovery.command) return false;
  return run(input.ptyCommand, ["send", input.session, recovery.command]).status === 0;
}
function decideStartupRecovery(input) {
  const { recovery } = input;
  if (!recovery.profilesDir) return void 0;
  let advisor;
  try {
    advisor = resolveDefaultProfile(recovery.profilesDir, "advisor");
  } catch {
    return void 0;
  }
  if (!advisor) return void 0;
  let advisorCommand;
  try {
    advisorCommand = buildAgentProfileCommand({
      profilePath: advisor.path,
      interactive: false,
      namespaceId: recovery.namespaceId || "default",
      orgId: recovery.orgId || "default",
      purpose: "agent"
    });
  } catch {
    return void 0;
  }
  const prompt = startupRecoveryPrompt(recovery, input.readiness, input.output);
  const advisorRun = input.advisorRun || ((command, advisorInput) => (0, import_node_child_process3.spawnSync)("/bin/bash", ["-lc", command], {
    input: advisorInput,
    encoding: "utf8",
    timeout: 12e4
  }));
  const response = advisorRun(advisorCommand, prompt);
  if (response.status !== 0) return void 0;
  const payload = parseAdvisorPayload(typeof response.stdout === "string" ? response.stdout : "");
  if (!payload || !isSafeRecoveryDecision(payload)) return void 0;
  appendRecoveryDecision(recovery, payload);
  return payload;
}
function startupRecoveryPrompt(recovery, readiness2, output) {
  const state = recovery.stateFile ? safeRead(recovery.stateFile) : "";
  return [
    "Mentiko startup recovery request. No agent task has been delivered yet unless the capture proves otherwise.",
    `run_id: ${recovery.runId || process.env.MENTIKO_RUN_ID || "none"}`,
    `agent_id: ${recovery.agentId || "unknown"}`,
    `profile_id: ${recovery.profileId || "unknown"}`,
    `cli: ${recovery.cli || "unknown"}`,
    `cwd: ${recovery.cwd || "unknown"}`,
    `attempted_command: ${recovery.command || ""}`,
    `readiness: ${JSON.stringify(readiness2)}`,
    `state_file:
${state}`,
    `terminal_capture:
${output}`,
    "Return strict JSON only using action send_keys | retry_launch | suggest_profile_fix | ask_human | no_action, confidence, risk, reason, and optional keys."
  ].join("\n\n");
}
function parseAdvisorPayload(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return void 0;
  try {
    const value2 = JSON.parse(text.slice(start, end + 1));
    return value2 && typeof value2 === "object" && !Array.isArray(value2) ? value2 : void 0;
  } catch {
    return void 0;
  }
}
function isSafeRecoveryDecision(value2) {
  return typeof value2.action === "string" && ["send_keys", "retry_launch", "suggest_profile_fix", "ask_human", "no_action"].includes(value2.action) && typeof value2.confidence === "number" && ["low", "medium", "high"].includes(String(value2.risk)) && typeof value2.reason === "string" && value2.confidence >= 0.85 && value2.risk === "low" && (value2.action === "send_keys" || value2.action === "retry_launch") && (value2.action !== "send_keys" || Array.isArray(value2.keys) && value2.keys.length > 0 && value2.keys.every((key) => typeof key === "string"));
}
function recoveryKeyBytes(key) {
  switch (key) {
    case "ENTER":
    case "RETURN":
    case "CR":
    case "\\r":
    case "\\n":
      return "\r";
    case "ESC":
    case "ESCAPE":
      return "\x1B";
    case "CTRL_C":
    case "^C":
      return "";
    case "TAB":
      return "	";
    case "SPACE":
      return " ";
    default:
      return key;
  }
}
function writeStartupRecoveryArtifacts(recovery, readiness2, output) {
  if (!recovery?.artifactDir || !recovery.agentId) return;
  const directory = recovery.artifactDir;
  if (!directory.startsWith("/")) throw new Error("startup recovery artifact directory must be absolute");
  ensureDirectory(directory, "startup recovery artifact directory");
  writeAtomic((0, import_node_path11.join)(directory, `${recovery.agentId}-startup-capture.txt`), output);
  writeAtomic((0, import_node_path11.join)(directory, `${recovery.agentId}-startup-readiness.json`), `${JSON.stringify(readiness2, null, 2)}
`);
}
function appendRecoveryDecision(recovery, decision) {
  if (!recovery.artifactDir || !recovery.agentId) return;
  const directory = ensureDirectory(recovery.artifactDir, "startup recovery artifact directory");
  const path2 = (0, import_node_path11.join)(directory, `${recovery.agentId}-startup-recovery-decisions.jsonl`);
  if ((0, import_node_fs10.existsSync)(path2) && (0, import_node_fs10.lstatSync)(path2).isSymbolicLink()) throw new Error("startup recovery decision log must not be a symlink");
  (0, import_node_fs10.appendFileSync)(path2, `${JSON.stringify(decision)}
`, { mode: 384 });
}
function safeRead(path2) {
  try {
    return (0, import_node_fs10.readFileSync)(path2, "utf8");
  } catch {
    return "";
  }
}
function writeCaptureAtomically(path2, content) {
  if ((0, import_node_fs10.existsSync)(path2)) assertRegularInput(path2, "capture");
  writeAtomic(path2, content);
}
function writeAtomic(path2, content) {
  const directory = ensureDirectory((0, import_node_path11.dirname)(path2), "capture directory");
  const target = (0, import_node_path11.join)(directory, (0, import_node_path11.basename)(path2));
  if ((0, import_node_fs10.existsSync)(target)) assertRegularInput(target, "capture");
  const temporary = `${target}.${process.pid}.tmp`;
  (0, import_node_fs10.writeFileSync)(temporary, content, { mode: 384 });
  (0, import_node_fs10.renameSync)(temporary, target);
}
function ensureDirectory(path2, label) {
  const candidate = canonicalizeTrustedSystemAlias(path2);
  assertExistingDirectoryComponents(candidate, label, path2);
  if (!(0, import_node_fs10.existsSync)(candidate)) (0, import_node_fs10.mkdirSync)(candidate, { recursive: true, mode: 448 });
  assertExistingDirectoryComponents(candidate, label, path2);
  return candidate;
}
function canonicalizeTrustedSystemAlias(path2) {
  const normalized = (0, import_node_path11.resolve)(path2);
  for (const alias of ["/tmp", "/var", "/etc"]) {
    if (normalized !== alias && !normalized.startsWith(`${alias}/`)) continue;
    const canonical = (0, import_node_fs10.realpathSync)(alias);
    return normalized === alias ? canonical : (0, import_node_path11.join)(canonical, normalized.slice(alias.length + 1));
  }
  return normalized;
}
function assertExistingDirectoryComponents(path2, label, originalPath) {
  const absolute = (0, import_node_path11.resolve)(path2);
  const root = (0, import_node_path11.parse)(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(import_node_path11.sep).filter(Boolean)) {
    current = (0, import_node_path11.join)(current, part);
    if (!(0, import_node_fs10.existsSync)(current)) return;
    const entry = (0, import_node_fs10.lstatSync)(current);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`${label} must be a non-symlink directory: ${originalPath}`);
    }
  }
}
function buildRecovery(values) {
  const enabled = optional(values, "--recovery-enabled") === "true";
  const profilesDir = optional(values, "--profiles-dir");
  if (!enabled && !profilesDir) return void 0;
  return {
    enabled,
    maxAttempts: nonNegativeInteger(optional(values, "--recovery-max") || "0", "--recovery-max"),
    profilesDir,
    runId: optional(values, "--run-id"),
    namespaceId: optional(values, "--namespace-id"),
    orgId: optional(values, "--org-id"),
    agentId: optional(values, "--agent-id"),
    profileId: optional(values, "--profile-id"),
    cli: optional(values, "--cli"),
    cwd: optional(values, "--cwd"),
    command: optional(values, "--command"),
    stateFile: optional(values, "--state-file"),
    artifactDir: optional(values, "--artifact-dir")
  };
}
function assertRegularInput(path2, label) {
  const entry = (0, import_node_fs10.lstatSync)(path2);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} input must be a non-symlink regular file: ${path2}`);
}
function nonNegativeInteger(value2, label) {
  if (!/^\d+$/.test(value2)) throw new Error(`${label} must be a non-negative integer`);
  return Number(value2);
}
function positiveInteger(value2, label) {
  const result = nonNegativeInteger(value2, label);
  if (!result) throw new Error(`${label} must be positive`);
  return result;
}
function parse(argv) {
  const values = /* @__PURE__ */ new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value2 = argv[i + 1];
    if (!key?.startsWith("--") || value2 === void 0 || values.has(key)) throw new Error(usage());
    values.set(key, value2);
  }
  return values;
}
function required(values, key) {
  const value2 = values.get(key);
  if (!value2) throw new Error(`${key} is required`);
  return value2;
}
function optional(values, key) {
  return values.get(key);
}
function reject(values, allowed) {
  for (const key of values.keys()) if (!allowed.includes(key)) throw new Error(`${key} is not valid for runner-readiness`);
}
function isCommand(value2) {
  return value2 === "classify" || value2 === "wait" || value2 === "result" || value2 === "result-field";
}
function usage() {
  return "usage: runner-readiness <classify|wait|result|result-field> [options]";
}
function isStandaloneReadinessCli() {
  const entrypoint = process.argv[1] || "";
  return /(?:^|[\\/])(?:runner-readiness|readiness-cli)(?:\.(?:c|m)?[jt]s)?$/.test(entrypoint);
}
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module && isStandaloneReadinessCli()) {
  try {
    runReadinessCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// lib/runner-v2/bootstrap-executor.ts
var TERMINAL_RUN_STATUSES2 = /* @__PURE__ */ new Set(["blocked", "failed", "stopped", "completed", "cancelled"]);
var TerminalBootstrapStateError = class extends Error {
};
var TypedMonitorRuntimeMissingError = class extends Error {
};
var RoutedLaunchJobOwnershipLostError = class extends Error {
};
function buildTypedCompletionContract(plan) {
  const runId = plan.runContextExports.MENTIKO_RUN_ID || plan.runContextExports.RUN_ID || "unknown";
  const agentId = plan.agentId || plan.runContextExports.MENTIKO_AGENT_ID || "unknown";
  const emits = plan.runContextExports.MENTIKO_AGENT_EMITS || "";
  const summaryJson = (0, import_path8.join)(plan.artifactsDir, `${agentId}-summary.json`);
  const summaryMarkdown = (0, import_path8.join)(plan.artifactsDir, `${agentId}-summary.md`);
  const emitCommand = emits ? `mentiko emit ${emits}` : "";
  const eventHandoff = emits ? plan.coreGenerationChain ? [
    "Core generation handoff:",
    `- Write the authoritative generation payload to ${(0, import_path8.join)(plan.artifactsDir, "generation-result.json")}.`,
    "- Mentiko imports that file automatically when this run completes.",
    `- You may run "${emitCommand}" after writing the payload; the generation file remains authoritative.`
  ] : [
    "Canonical event handoff:",
    "When completely finished, signal completion by running this command exactly:",
    `    ${emitCommand}`
  ] : [
    "This agent has no declared completion event.",
    "Do not create or hand-write any .event file; the final completion marker is the only terminal signal."
  ];
  return [
    "COMPLETION CONTRACT:",
    `Run context: RUN_ID=${runId}, MENTIKO_AGENT_ID=${agentId}`,
    `Event root: EVENTS_DIR=${plan.eventsDir}`,
    `Artifact root: ARTIFACTS_DIR=${plan.artifactsDir}`,
    "",
    "Before you finish, create these user-facing handoff artifacts:",
    `- ${summaryJson}`,
    `- ${summaryMarkdown}`,
    "",
    "The JSON summary must use this shape:",
    "{",
    '  "status": "complete|partial|blocked",',
    '  "executiveSummary": "2-4 sentences suitable for the run UI",',
    '  "workCompleted": ["specific work performed"],',
    '  "artifactsProduced": ["artifact paths you created or updated"],',
    `  "codeChanges": ["files changed, or 'none'"],`,
    '  "findings": ["important discoveries"],',
    '  "risks": ["known risks or gaps"],',
    '  "nextAgentHints": ["what the next agent should read or do"]',
    "}",
    "Write a syntactically valid JSON object. Do not put literal line breaks inside JSON strings; use arrays or escaped \\n instead.",
    `Before emitting completion, validate the summary with: node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' ${shellEscape(summaryJson)}`,
    "",
    ...eventHandoff,
    "Do NOT hand-write any .event file. The typed emitter owns the canonical event bytes, filename, provenance, and validation.",
    "Do NOT create output files in the project working directory unless the task explicitly requires it; put reports and handoff artifacts under ARTIFACTS_DIR.",
    "",
    "Your final terminal response must be in this order:",
    "SUMMARY:",
    "- one to three concise bullets",
    "ARTIFACTS:",
    "- paths to the most important artifacts",
    "NEXT:",
    '- handoff notes or "none"',
    "<the completion marker line>",
    "",
    "The completion marker line must contain exactly the token AGENT_COMPLETE and nothing else.",
    "The final non-empty line must be exactly AGENT_COMPLETE. Do not write anything after it. Do not put AGENT_COMPLETE inside files or earlier in your response."
  ].join("\n");
}
function assertTypedMonitorRuntimeAvailable(codeRoot2 = config_default.codeRoot) {
  const monitorBundle = (0, import_path8.join)(codeRoot2, "lib", "monitor-v2.js");
  if (!(0, import_fs10.existsSync)(monitorBundle) || !(0, import_fs10.statSync)(monitorBundle).isFile()) {
    throw new TypedMonitorRuntimeMissingError(`typed monitor runtime bundle missing: ${monitorBundle}`);
  }
}
async function startRunnerV2Bootstrap(context) {
  if (context.env.WORKSPACE_TYPE && context.env.WORKSPACE_TYPE !== "local") {
    return {
      support: "unsupported",
      reason: `runner-v2 typed bootstrap only supports local workspaces, got ${context.env.WORKSPACE_TYPE}`,
      fallbackAllowed: true
    };
  }
  try {
    assertTypedMonitorRuntimeAvailable();
  } catch (error) {
    return {
      support: "unsupported",
      reason: error instanceof Error ? error.message : "typed monitor runtime bundle missing",
      fallbackAllowed: false
    };
  }
  let plan;
  try {
    plan = buildAgentBootstrapPlan({
      chainPath: context.chainPath,
      runDir: context.runDir,
      runId: context.runId,
      agentId: context.agentId,
      workspacePath: context.workspacePath,
      env: context.env
    });
  } catch (error) {
    return {
      support: "unsupported",
      reason: error instanceof Error ? error.message : "runner-v2 bootstrap planning failed",
      fallbackAllowed: true
    };
  }
  try {
    await executeLocalBootstrap(plan, context, pty);
    return {
      support: "supported",
      mode: "typed-plan",
      sessionName: plan.sessionName
    };
  } catch (error) {
    if (error instanceof BootstrapReadinessBlockedError) {
      return {
        support: "supported",
        mode: "typed-plan",
        sessionName: plan.sessionName
      };
    }
    return {
      support: "unsupported",
      reason: error instanceof Error ? error.message : "runner-v2 typed bootstrap failed",
      fallbackAllowed: false
    };
  }
}
async function executeLocalBootstrap(plan, context, executor) {
  const runJsonPath = (0, import_path8.join)(context.runDir, "run.json");
  const launchJobId = context.env.MENTIKO_LAUNCH_JOB_ID;
  const launchOwnerId = context.env.MENTIKO_LAUNCH_JOB_OWNER_ID;
  const launchOccurrenceId = context.env.MENTIKO_COMPLETION_OCCURRENCE_ID;
  assertBootstrapLaunchable(runJsonPath, context.runId, plan.agentId, launchJobId);
  (0, import_fs10.mkdirSync)(plan.artifactsDir, { recursive: true });
  const workspaceExecution = ensureRunWorkspaceBaseline({
    runJsonPath,
    runDir: context.runDir,
    runId: context.runId,
    workspacePath: context.workspacePath || plan.sourceWorkspacePath
  });
  const runWorkspace2 = workspaceExecution.tracking === "git" ? initializeGitRunWorkspaceIsolation({
    runId: context.runId,
    runDir: context.runDir,
    baseline: workspaceExecution.baseline
  }) : void 0;
  const attempt = createAgentAttempt({
    runJsonPath,
    runId: context.runId,
    agentId: plan.agentId,
    leaseId: plan.sessionName,
    launchJobId,
    launchOccurrenceId
  });
  if (launchJobId || launchOwnerId) {
    assertRoutedLaunchJobOwnership(runJsonPath, launchJobId, launchOwnerId);
    bindRoutedLaunchJobAttempt({
      runJsonPath,
      jobId: launchJobId,
      ownerId: launchOwnerId,
      agentId: plan.agentId,
      attemptId: attempt.id
    });
  }
  let executionPlan = plan;
  let nodeWorkspace;
  try {
    if (attempt.phase === "created") {
      const admission = await acquireChainAdmission({
        runJsonPath,
        runId: context.runId,
        agentId: plan.agentId,
        env: context.env
      });
      if (!admission.admitted) {
        transitionAgentAttempt({
          runJsonPath,
          attemptId: attempt.id,
          to: "human_action_required",
          reason: "concurrency_cap_blocked",
          detail: admission.reason
        });
        return;
      }
      enqueueAgentAttempt({
        runJsonPath,
        attemptId: attempt.id,
        scopeRoot: context.env.MENTIKO_ORG_ROOT || config_default.orgRoot
      });
      markRunAgentQueued(runJsonPath, plan);
    }
    const agentAdmission = await acquireAgentCapacityAdmission({
      runJsonPath,
      runId: context.runId,
      attemptId: attempt.id,
      env: context.env
    });
    if (!agentAdmission.admitted) {
      transitionAgentAttempt({
        runJsonPath,
        attemptId: attempt.id,
        to: "human_action_required",
        reason: "agent_capacity_timeout",
        detail: agentAdmission.reason
      });
      markRunAgentBlocked2(runJsonPath, plan.agentId, agentAdmission.reason);
      return;
    }
    assertRoutedLaunchJobOwnership(runJsonPath, launchJobId, launchOwnerId);
    nodeWorkspace = runWorkspace2 ? allocateGitNodeWorkspace({
      runWorkspace: runWorkspace2,
      agentId: plan.agentId,
      attemptId: attempt.id,
      baseCommit: context.env.MENTIKO_WORKSPACE_BASE_COMMIT
    }) : void 0;
    if (nodeWorkspace) {
      executionPlan = retargetAgentBootstrapPlan(plan, nodeWorkspace.workspacePath, context.env);
    }
    executionPlan = {
      ...executionPlan,
      runContextExports: {
        ...executionPlan.runContextExports,
        MENTIKO_AGENT_ATTEMPT_ID: attempt.id
      }
    };
    const workspaceHandoff = captureAgentWorkspaceHandoff({
      runJsonPath,
      runDir: context.runDir,
      runId: context.runId,
      agentId: plan.agentId,
      attemptId: attempt.id,
      workspaceExecution,
      ...nodeWorkspace ? {
        workspacePath: nodeWorkspace.workspacePath,
        nodeBaseCommit: nodeWorkspace.baseCommit,
        nodeWorkspaceRecordPath: nodeWorkspace.recordPath
      } : {}
    });
    (0, import_fs10.mkdirSync)(executionPlan.eventsDir, { recursive: true });
    (0, import_fs10.mkdirSync)((0, import_path8.dirname)(executionPlan.statePath), { recursive: true });
    (0, import_fs10.writeFileSync)(
      executionPlan.instructionPath,
      buildInitialInstructions(executionPlan, context, workspaceHandoff),
      { mode: 384 }
    );
    createRunnerAgentState(executionPlan.statePath, buildInitialState(executionPlan));
    const startScriptPath = (0, import_path8.join)(context.runDir, "artifacts", `${executionPlan.agentId}-start.sh`);
    (0, import_fs10.writeFileSync)(startScriptPath, buildStartScript(executionPlan), { mode: 448 });
    (0, import_fs10.chmodSync)(startScriptPath, 448);
    assertRoutedLaunchJobOwnership(runJsonPath, launchJobId, launchOwnerId);
    await executor.remove(executionPlan.sessionName);
    const spawned = await executor.spawn(executionPlan.sessionName, "zsh", [], {
      cwd: executionPlan.projectRoot,
      env: sanitizePtyEnv({
        PATH: context.env.PATH || process.env.PATH || "",
        HOME: context.env.HOME || process.env.HOME || "",
        SHELL: context.env.SHELL || process.env.SHELL || "",
        TERM: context.env.TERM || process.env.TERM || "xterm-256color",
        MENTIKO_RUNNER_V2_ACTIVE: "1",
        MENTIKO_RUNNER_V2_MODE: "typed-plan",
        ...executionPlan.runContextExports
      })
    });
    transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "pty_allocated" });
    recordAgentAttemptProcess({
      runJsonPath,
      attemptId: attempt.id,
      processPid: spawned.pid,
      ptySessionId: spawned.name
    });
    transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "process_spawned" });
    registerRunSession(context, executionPlan);
    const startCommand = `cd ${shellEscape(executionPlan.projectRoot)} && bash ${shellEscape(startScriptPath)} || exit $?`;
    await executor.sendKeys(executionPlan.sessionName, startCommand);
    await waitForBootstrapReadiness(executionPlan, executor, attempt.id, runJsonPath);
    transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "ready_for_instructions" });
    const submission = submitAgentAttemptInstructions({
      runJsonPath,
      attemptId: attempt.id,
      idempotencyKey: `${context.runId}:${executionPlan.agentId}:${executionPlan.instructionPath}`,
      instructionPath: executionPlan.instructionPath,
      pointer: executionPlan.instructionPointer
    });
    if (submission.delivered) {
      await executor.sendKeys(executionPlan.sessionName, executionPlan.instructionPointer);
      const confirmed = await confirmInstructionSubmission(executionPlan, executor);
      if (confirmed) {
        transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "instructions_submitted" });
      } else {
        transitionAgentAttempt({
          runJsonPath,
          attemptId: attempt.id,
          to: "stuck",
          reason: "instruction_submission_unconfirmed",
          detail: "composer still holds the pasted instructions after enter retries; session left alive for monitor rescue"
        });
      }
    }
    await startMonitorSession(executionPlan, executor);
  } catch (error) {
    if (error instanceof BootstrapReadinessBlockedError) {
      return;
    }
    if (error instanceof RoutedLaunchJobOwnershipLostError) {
      return;
    }
    try {
      await removeBootstrapSessionsAndProveAbsent(executor, [
        executionPlan.monitorSessionName,
        executionPlan.sessionName
      ]);
      if (runWorkspace2 && nodeWorkspace) {
        const cleanup = cleanupGitNodeWorkspaceDurably({
          runWorkspace: runWorkspace2,
          agentId: plan.agentId,
          attemptId: attempt.id,
          mode: "pristine-startup"
        });
        if (cleanup.outcome === "preserved-changes") {
          const detail = `failed startup attempt ${attempt.id} changed its isolated worktree; preserved for review`;
          transitionAgentAttempt({
            runJsonPath,
            attemptId: attempt.id,
            to: "human_action_required",
            reason: "interrupted_bootstrap_changes",
            detail
          });
          markRunAgentBlocked2(runJsonPath, plan.agentId, detail);
          releaseAgentAttempt({ runJsonPath, attemptId: attempt.id });
          return;
        }
      }
      releaseAgentAttempt({ runJsonPath, attemptId: attempt.id });
    } catch (cleanupError) {
      const startupMessage = error instanceof Error ? error.message : String(error);
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(
        `bootstrap failed (${startupMessage}); capacity retained because startup cleanup was not proven: ${cleanupMessage}`
      );
    }
    throw error;
  }
}
async function removeBootstrapSessionsAndProveAbsent(executor, sessionNames) {
  await Promise.allSettled(sessionNames.map((sessionName) => executor.remove(sessionName)));
  const remaining = await executor.list();
  const liveNames = new Set(remaining.map((session) => session.name));
  const unremoved = sessionNames.filter((sessionName) => liveNames.has(sessionName));
  if (unremoved.length > 0) {
    throw new Error(`PTY removal could not be proven for ${unremoved.join(", ")}`);
  }
}
function markRunAgentQueued(runJsonPath, plan) {
  const queuedAt = (/* @__PURE__ */ new Date()).toISOString();
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const agents = [...current.agents || []];
    const existing = agents.findIndex((agent) => agent.id === plan.agentId);
    const queued = {
      ...existing >= 0 ? agents[existing] : {},
      id: plan.agentId,
      name: plan.agentName,
      session: plan.sessionName,
      status: "pending",
      queuedAt,
      lastMessage: "queued: waiting for an active agent slot",
      completed: void 0
    };
    if (existing >= 0) agents[existing] = queued;
    else agents.push(queued);
    return { ...current, agents };
  });
}
function assertRoutedLaunchJobOwnership(runJsonPath, launchJobId, launchOwnerId) {
  if (!launchJobId && !launchOwnerId) return;
  if (!launchJobId || !launchOwnerId || !routedLaunchJobLeaseOwned({
    runJsonPath,
    jobId: launchJobId,
    ownerId: launchOwnerId
  })) {
    throw new RoutedLaunchJobOwnershipLostError(
      `routed launch job lease is not owned${launchJobId ? `: ${launchJobId}` : ""}`
    );
  }
}
function assertBootstrapLaunchable(runJsonPath, runId, agentId, launchJobId) {
  const run = readRunJson(runJsonPath);
  if (run.id !== runId) {
    throw new TerminalBootstrapStateError(`runner-v2 bootstrap run id ${runId} does not match durable run record ${run.id}`);
  }
  if (TERMINAL_RUN_STATUSES2.has(run.status)) {
    throw new TerminalBootstrapStateError(`runner-v2 bootstrap rejected: run ${run.id} is terminal (${run.status})`);
  }
  const latestAttempt2 = [...readRunnerV2AttemptState(runJsonPath).attempts].reverse().find((attempt) => attempt.runId === runId && attempt.agentId === agentId);
  if (!latestAttempt2 || !isTerminalAgentAttemptPhase(latestAttempt2.phase)) return;
  if (launchJobId && latestAttempt2.launchJobId === launchJobId && (latestAttempt2.phase === "released" || latestAttempt2.phase === "startup_failed")) return;
  const resumedAt = typeof run.resumedAt === "string" ? Date.parse(run.resumedAt) : Number.NaN;
  const attemptUpdatedAt = Date.parse(latestAttempt2.updatedAt);
  if (Number.isFinite(resumedAt) && Number.isFinite(attemptUpdatedAt) && resumedAt > attemptUpdatedAt) return;
  throw new TerminalBootstrapStateError(
    `runner-v2 bootstrap rejected: agent ${agentId} has terminal attempt ${latestAttempt2.id} (${latestAttempt2.phase})`
  );
}
function buildStartScript(plan) {
  return [
    "#!/usr/bin/env bash",
    "set -e",
    `trap 'rm -f "$0"' EXIT`,
    `cd ${shellEscape(plan.projectRoot)}`,
    "unset CLAUDECODE",
    ...Object.entries(plan.runContextExports).map(([key, value2]) => `export ${key}=${shellEscape(value2)}`),
    plan.localStartCommand,
    ""
  ].join("\n");
}
function buildWorkspaceEvidenceInstructions(evidence) {
  const isolationNotes = evidence.isolation === "git-worktree" ? [
    "Isolation: dedicated Git worktree (concurrent node writes are isolated).",
    ...evidence.tracking === "git" ? [`Node workspace: ${evidence.workspacePath}`, `Node base commit: ${evidence.nodeBaseCommit}`] : []
  ] : [
    "Isolation: shared workspace (concurrent writes are not isolated).",
    "This artifact is attribution evidence, not a write lock; another agent may mutate the workspace after capture."
  ];
  if (evidence.tracking === "unavailable") {
    return [
      "WORKSPACE EVIDENCE:",
      "Tracking: unavailable",
      `Run baseline artifact: ${evidence.baselineArtifactPath}`,
      `Agent handoff artifact: ${evidence.artifactPath}`,
      `Reason: ${evidence.reason}`,
      ...isolationNotes,
      "If your role verifies acceptance, report workspace attribution as blocked; do not infer the task delta from HEAD."
    ].join("\n");
  }
  return [
    "WORKSPACE EVIDENCE:",
    "Tracking: git snapshot",
    `Run baseline artifact: ${evidence.baselineArtifactPath}`,
    `Run baseline snapshot commit: ${evidence.baseline.snapshotCommit}`,
    `Agent handoff artifact: ${evidence.artifactPath}`,
    `Agent handoff snapshot commit: ${evidence.observed.snapshotCommit}`,
    `Files changed from run baseline before this agent: ${evidence.changeSet.summary.filesChanged}`,
    ...isolationNotes,
    "HEAD is not the run baseline.",
    "If your role verifies acceptance, the handoff artifact changeSet is the authoritative task delta observed before this agent started; do not substitute git diff against HEAD."
  ].join("\n");
}
function buildInitialInstructions(plan, context, workspaceEvidence) {
  const taskContext = plan.runContextExports.TASK_CONTEXT;
  return [
    `You are: ${plan.agentName}`,
    `Run-ID: ${context.runId}`,
    `Agent-ID: ${plan.agentId}`,
    "",
    `Your chain run is ${context.chainName}.`,
    `Artifacts directory: ${plan.artifactsDir}`,
    `Events directory: ${plan.eventsDir}`,
    "",
    "Read the chain JSON for your full task context:",
    context.chainPath,
    ...taskContext ? ["", "Typed task context:", taskContext] : [],
    "",
    buildWorkspaceEvidenceInstructions(workspaceEvidence),
    "",
    buildTypedCompletionContract(plan)
  ].join("\n");
}
function buildInitialState(plan) {
  return {
    session: plan.sessionName,
    agent_id: plan.agentId,
    round: "1",
    started: (/* @__PURE__ */ new Date()).toISOString(),
    emits: plan.runContextExports.MENTIKO_AGENT_EMITS || "",
    workspace: "local"
  };
}
function registerRunSession(context, plan) {
  const runJsonPath = (0, import_path8.join)(context.runDir, "run.json");
  if (!(0, import_fs10.existsSync)(runJsonPath)) return;
  addRunSession(runJsonPath, plan.sessionName, plan.agentId, plan.agentName);
}
async function waitForBootstrapReadiness(plan, executor, attemptId, runJsonPath) {
  const readinessPolicy = resolvePlanReadinessPolicy(plan);
  const failClosed = planReadinessFailClosed(plan);
  const deadline = Date.now() + readinessTimeoutMs(plan);
  const pollMs = readinessPollMs(plan);
  let lastOutput = "";
  while (Date.now() < deadline) {
    const output = await executor.capture(plan.sessionName, 80);
    lastOutput = output;
    if (output.includes(plan.localStartCommand) || output.includes(plan.instructionPointer)) {
      const failure = classifyReadinessFailure(output);
      transitionAgentAttempt({
        runJsonPath,
        attemptId,
        to: failure.phase,
        reason: failure.reason,
        detail: "bootstrap command echoed without starting agent CLI"
      });
      throw new Error("runner-v2 bootstrap command echoed without starting agent CLI");
    }
    const readiness3 = classifyCliReadiness({
      readiness: readinessPolicy.readiness,
      profileMissing: readinessPolicy.profileMissing,
      output,
      failClosed
    });
    if (readiness3.status === "ready") return;
    if (isRecoverableReadinessStatus(readiness3.status) && await attemptTypedStartupRecovery(plan, executor, attemptId, runJsonPath, readiness3, output)) {
      await sleep(pollMs);
      continue;
    }
    if (isTerminalReadinessStatus(readiness3.status)) {
      const failure = classifyPolicyReadinessFailure(readiness3, output);
      blockStartupForReadiness({
        plan,
        runJsonPath,
        output,
        readiness: readiness3,
        reason: `startup_recovery:${readiness3.status}: ${readiness3.reason}`
      });
      transitionAgentAttempt({
        runJsonPath,
        attemptId,
        to: failure.phase,
        reason: failure.reason,
        detail: failure.detail
      });
      throw new BootstrapReadinessBlockedError(`runner-v2 typed bootstrap readiness ${readiness3.status}: ${readiness3.reason}`);
    }
    if (!failClosed) return;
    await sleep(pollMs);
  }
  const timeoutSeconds = Math.floor(readinessTimeoutMs(plan) / 1e3);
  const readiness2 = {
    status: "unknown",
    reason: `CLI readiness unresolved after ${timeoutSeconds}s`
  };
  blockStartupForReadiness({
    plan,
    runJsonPath,
    output: lastOutput,
    readiness: readiness2,
    reason: `startup_recovery:unknown: ${readiness2.reason}`
  });
  transitionAgentAttempt({
    runJsonPath,
    attemptId,
    to: "startup_failed",
    reason: "readiness_deadline_expired",
    detail: lastOutput.slice(-500)
  });
  throw new BootstrapReadinessBlockedError(`runner-v2 typed bootstrap timed out waiting for profile readiness; last_output=${lastOutput.slice(-500)}`);
}
async function attemptTypedStartupRecovery(plan, executor, attemptId, runJsonPath, readiness2, output) {
  const enabled = envValue(plan, "MENTIKO_STARTUP_RECOVERY") === "1";
  const maxAttempts = Number(envValue(plan, "MENTIKO_STARTUP_RECOVERY_MAX"));
  const currentAttempt = readRunnerV2AttemptState(runJsonPath).attempts.find((attempt) => attempt.id === attemptId);
  if (!enabled || !Number.isInteger(maxAttempts) || maxAttempts <= 0 || (currentAttempt?.recoveryDecisionCount || 0) >= maxAttempts) {
    return false;
  }
  const recovery = {
    enabled: true,
    maxAttempts,
    runId: plan.runContextExports.MENTIKO_RUN_ID,
    profilesDir: plan.runContextExports.AGENT_PROFILES_DIR,
    namespaceId: plan.runContextExports.NAMESPACE_ID,
    orgId: plan.runContextExports.ORG_ID,
    agentId: plan.agentId,
    profileId: plan.profileId,
    cli: plan.localStartCommand,
    cwd: plan.projectRoot,
    command: plan.localStartCommand,
    stateFile: plan.statePath,
    artifactDir: plan.artifactsDir
  };
  const decision = decideStartupRecovery({ recovery, readiness: readiness2, output });
  if (!decision) return false;
  recordAgentAttemptRecoveryDecision({ runJsonPath, attemptId });
  if (decision.action === "send_keys") {
    if (!executor.sendRaw || !decision.keys?.length) return false;
    for (const key of decision.keys) {
      await executor.sendRaw(plan.sessionName, recoveryKeyBytes(key));
    }
    return true;
  }
  await executor.sendKeys(plan.sessionName, plan.localStartCommand);
  return true;
}
var BootstrapReadinessBlockedError = class extends Error {
};
function resolvePlanReadinessPolicy(plan) {
  if (plan.profileReadiness) {
    return { readiness: plan.profileReadiness };
  }
  if (!plan.profilePath || !(0, import_fs10.existsSync)(plan.profilePath)) {
    return { profileMissing: true };
  }
  try {
    const profile = JSON.parse((0, import_fs10.readFileSync)(plan.profilePath, "utf8"));
    return { readiness: profile.readiness ?? null };
  } catch {
    return { profileMissing: true };
  }
}
function isTerminalReadinessStatus(status) {
  return status === "blocked" || status === "recover" || status === "retry" || status === "no_ready_signal";
}
function isRecoverableReadinessStatus(status) {
  return status === "blocked" || status === "recover" || status === "retry";
}
function classifyPolicyReadinessFailure(readiness2, output) {
  const suffix = output.slice(-500);
  const detail = `${readiness2.reason}${readiness2.pattern ? ` (${readiness2.pattern})` : ""}${suffix ? `; last_output=${suffix}` : ""}`;
  if (readiness2.status === "blocked") {
    return { phase: "human_action_required", reason: "readiness_policy_blocked", detail };
  }
  if (readiness2.status === "recover") {
    return { phase: "startup_failed", reason: "readiness_policy_recoverable", detail };
  }
  if (readiness2.status === "retry") {
    return { phase: "startup_failed", reason: "readiness_policy_retry", detail };
  }
  return { phase: "startup_failed", reason: "readiness_no_ready_signal", detail };
}
function blockStartupForReadiness(input) {
  writeStartupReadinessArtifacts(input.plan, input.output, input.readiness);
  markStateBlocked(input.plan.statePath, input.reason);
  markRunAgentBlocked2(input.runJsonPath, input.plan.agentId, input.reason);
}
function writeStartupReadinessArtifacts(plan, output, readiness2) {
  (0, import_fs10.mkdirSync)(plan.artifactsDir, { recursive: true });
  (0, import_fs10.writeFileSync)((0, import_path8.join)(plan.artifactsDir, `${plan.agentId}-startup-capture.txt`), output);
  (0, import_fs10.writeFileSync)((0, import_path8.join)(plan.artifactsDir, `${plan.agentId}-startup-readiness.json`), `${JSON.stringify(readiness2, null, 2)}
`);
}
function markStateBlocked(statePath, reason) {
  transitionRunnerAgentState(statePath, "blocked", reason);
}
function markRunAgentBlocked2(runJsonPath, agentId, reason) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const agents = Array.isArray(current.agents) ? current.agents : [];
    const hasAgent = agents.some((agent) => agent.id === agentId);
    return {
      ...current,
      status: "blocked",
      // A blocked startup is terminal for the run even though the PTY remains
      // available for recovery. Do not claim the blocked agent completed.
      completed: current.completed || now,
      blockedAt: typeof current.blockedAt === "string" ? current.blockedAt : now,
      blockedReason: reason,
      agents: hasAgent ? agents.map((agent) => agent.id === agentId ? {
        ...agent,
        status: "blocked",
        lastHeartbeat: now,
        lastMessage: reason
      } : agent) : [
        ...agents,
        {
          id: agentId,
          name: agentId,
          session: "",
          status: "blocked",
          lastHeartbeat: now,
          lastMessage: reason
        }
      ]
    };
  });
}
async function acquireChainAdmission(input) {
  if (input.env.MENTIKO_CAP_DISABLED === "1") {
    updateRunStatus(input.runJsonPath, "running");
    return { admitted: true };
  }
  const cap = Number(input.env.MENTIKO_MAX_CONCURRENT_CHAINS ?? 4);
  if (!Number.isFinite(cap) || cap <= 0) {
    updateRunStatus(input.runJsonPath, "running");
    return { admitted: true };
  }
  updateRunStatus(input.runJsonPath, "pending");
  const maxWaitMs = secondsEnv(input.env.MENTIKO_CAP_MAX_WAIT_SECS, 300) * 1e3;
  const pollMaxMs = secondsEnv(input.env.MENTIKO_CAP_POLL_MAX_SECS, 15) * 1e3;
  const started = Date.now();
  let pollMs = secondsEnv(input.env.MENTIKO_CAP_POLL_SECS, 2) * 1e3;
  let queued = false;
  while (true) {
    const release = acquireCapLock(input.runJsonPath, input.env);
    if (release) {
      try {
        const active = countRunningChains(input.runJsonPath, input.runId);
        if (active < cap) {
          updateRunStatus(
            input.runJsonPath,
            "running",
            queued ? `admitted from queue (${active + 1}/${cap} chains active)` : void 0
          );
          return { admitted: true };
        }
      } finally {
        release();
      }
    }
    const elapsedMs = Date.now() - started;
    if (elapsedMs >= maxWaitMs) {
      const elapsedSeconds = Math.floor(elapsedMs / 1e3);
      const reason = `${CONCURRENCY_CAP_BLOCKED_REASON_PREFIX}${elapsedSeconds}s for a chain slot (limit ${cap}); blocked`;
      markRunAgentBlocked2(input.runJsonPath, input.agentId, reason);
      updateRunStatus(input.runJsonPath, "blocked", reason);
      return { admitted: false, reason };
    }
    if (!queued) {
      queued = true;
      updateRunStatus(input.runJsonPath, "pending", `queued: waiting for a chain slot (limit ${cap})`);
    }
    await sleep(pollMs);
    pollMs = Math.min(pollMs * 2, pollMaxMs);
  }
}
async function acquireAgentCapacityAdmission(input) {
  const configuredCap = input.env.MENTIKO_CAP_DISABLED === "1" ? 0 : Number(input.env.MENTIKO_MAX_ACTIVE_AGENTS ?? input.env.MAX_CONCURRENT_AGENTS ?? 3);
  if (!Number.isSafeInteger(configuredCap) || configuredCap < 0) {
    return { admitted: false, reason: "active agent cap must be a non-negative safe integer" };
  }
  const maxWaitMs = secondsEnv(input.env.MENTIKO_AGENT_CAP_MAX_WAIT_SECS, 86400) * 1e3;
  const pollMs = secondsEnv(input.env.MENTIKO_AGENT_CAP_POLL_SECS, 1) * 1e3;
  const pollMaxMs = secondsEnv(input.env.MENTIKO_AGENT_CAP_POLL_MAX_SECS, 5) * 1e3;
  const result = await waitForTypedAgentCapacity({
    runJsonPath: input.runJsonPath,
    runId: input.runId,
    attemptId: input.attemptId,
    cap: configuredCap,
    scopeRoot: input.env.MENTIKO_ORG_ROOT || config_default.orgRoot,
    launchJobId: input.env.MENTIKO_LAUNCH_JOB_ID,
    launchOwnerId: input.env.MENTIKO_LAUNCH_JOB_OWNER_ID,
    maxWaitMs,
    pollMs,
    pollMaxMs
  });
  if (result.status === "admitted") return { admitted: true };
  if (result.status === "ownership_lost") {
    throw new RoutedLaunchJobOwnershipLostError(result.reason);
  }
  if (result.status === "cancelled") return { admitted: false, reason: result.reason };
  if (result.status === "timeout") {
    const waitedSeconds = Math.floor(result.waitedMs / 1e3);
    return {
      admitted: false,
      reason: `agent capacity: waited ${waitedSeconds}s for a slot (${result.active} active, limit ${result.cap})`
    };
  }
  return { admitted: false, reason: result.reason };
}
function secondsEnv(value2, fallback) {
  const parsed = Number(value2);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function acquireCapLock(runJsonPath, env) {
  const lockDir = (0, import_path8.join)(runsRootFor(runJsonPath), ".cap.lock");
  try {
    (0, import_fs10.mkdirSync)(lockDir, { recursive: false });
    (0, import_fs10.writeFileSync)((0, import_path8.join)(lockDir, "pid"), String(process.pid));
    return () => {
      (0, import_fs10.rmSync)(lockDir, { recursive: true, force: true });
    };
  } catch {
    if (capLockIsBreakable(lockDir, env)) {
      (0, import_fs10.rmSync)(lockDir, { recursive: true, force: true });
    }
    return null;
  }
}
function capLockIsBreakable(lockDir, env) {
  try {
    const pid = Number((0, import_fs10.readFileSync)((0, import_path8.join)(lockDir, "pid"), "utf8").trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
    }
    const staleMs = secondsEnv(env.CAP_LOCK_STALE_SECS, 60) * 1e3;
    return Date.now() - (0, import_fs10.statSync)(lockDir).mtimeMs >= staleMs;
  } catch {
    return true;
  }
}
function countRunningChains(runJsonPath, currentRunId) {
  const root = runsRootFor(runJsonPath);
  if (!(0, import_fs10.existsSync)(root)) return 0;
  let count = 0;
  for (const entry of (0, import_fs10.readdirSync)(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-") || entry.name === currentRunId) continue;
    const siblingRunJson = (0, import_path8.join)(root, entry.name, "run.json");
    if (siblingRunJson === runJsonPath || !(0, import_fs10.existsSync)(siblingRunJson)) continue;
    try {
      const status = JSON.parse((0, import_fs10.readFileSync)(siblingRunJson, "utf8")).status;
      if (status === "running") count += 1;
    } catch {
    }
  }
  return count;
}
function runsRootFor(runJsonPath) {
  const runDir = (0, import_path8.dirname)(runJsonPath);
  return (0, import_path8.basename)(runDir).startsWith("run-") ? (0, import_path8.dirname)(runDir) : runDir;
}
function readinessTimeoutMs(plan) {
  const configured = Number(envValue(plan, "MENTIKO_CLI_READY_TIMEOUT"));
  return Number.isFinite(configured) && configured > 0 ? configured * 1e3 : 9e4;
}
function readinessPollMs(plan) {
  const configured = Number(envValue(plan, "MENTIKO_CLI_READY_POLL"));
  return Number.isFinite(configured) && configured > 0 ? configured * 1e3 : 2e3;
}
function planReadinessFailClosed(plan) {
  return envValue(plan, "MENTIKO_READINESS_FAIL_CLOSED") === "1";
}
function envValue(plan, key) {
  return plan.runContextExports[key] || process.env[key];
}
async function confirmInstructionSubmission(plan, executor) {
  const pollMs = Number(process.env.MENTIKO_RUNNER_V2_SUBMISSION_POLL_MS) || 1500;
  const deadlineMs = Number(process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS) || 2e4;
  const maxEnterRetries = 4;
  const deadline = Date.now() + deadlineMs;
  let enterRetries = 0;
  if (!await sleepBeforeSubmissionDeadline(pollMs, deadline)) return false;
  while (Date.now() < deadline) {
    const output = await awaitSubmissionOperation(
      () => executor.capture(plan.sessionName, 60),
      deadline
    );
    if (output === SUBMISSION_DEADLINE_EXCEEDED) return false;
    if (!isComposerHoldingInput(output)) return true;
    if (enterRetries < maxEnterRetries) {
      enterRetries += 1;
      const enterResult = await awaitSubmissionOperation(
        () => executor.sendRaw ? executor.sendRaw(plan.sessionName, "\r") : executor.sendKeys(plan.sessionName, ""),
        deadline
      );
      if (enterResult === SUBMISSION_DEADLINE_EXCEEDED) return false;
    }
    if (!await sleepBeforeSubmissionDeadline(pollMs, deadline)) return false;
  }
  return false;
}
var SUBMISSION_DEADLINE_EXCEEDED = /* @__PURE__ */ Symbol("submission deadline exceeded");
async function awaitSubmissionOperation(operation, deadline) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return SUBMISSION_DEADLINE_EXCEEDED;
  let timeout;
  try {
    return await new Promise((resolve8, reject2) => {
      timeout = setTimeout(() => resolve8(SUBMISSION_DEADLINE_EXCEEDED), remainingMs);
      try {
        void operation().then(resolve8, reject2);
      } catch (error) {
        reject2(error);
      }
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
async function sleepBeforeSubmissionDeadline(delayMs, deadline) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return false;
  await sleep(Math.min(delayMs, remainingMs));
  return Date.now() < deadline;
}
async function startMonitorSession(plan, executor) {
  await executor.remove(plan.monitorSessionName);
  await executor.spawn(plan.monitorSessionName, "bash", ["-lc", plan.monitorCommand], {
    cwd: plan.projectRoot,
    env: sanitizePtyEnv({
      PATH: plan.runContextExports.PATH || process.env.PATH || "",
      MENTIKO_RUNNER_V2_ACTIVE: "1",
      MENTIKO_RUNNER_V2_MODE: "typed-plan",
      ...plan.runContextExports
    })
  });
}
function sleep(ms) {
  return new Promise((resolve8) => setTimeout(resolve8, ms));
}
function sanitizePtyEnv(env) {
  const sanitized = {};
  for (const [key, value2] of Object.entries(env)) {
    if (typeof value2 === "string") sanitized[key] = value2;
  }
  return sanitized;
}

// lib/runner-v2/bootstrap-recovery.ts
var import_node_path12 = require("node:path");
var INTERRUPTED_PRE_INSTRUCTION_PHASES = /* @__PURE__ */ new Set([
  "pty_allocated",
  "process_spawned",
  "ready_for_instructions"
]);
function requireAgentId(context) {
  if (!context.agentId) throw new Error("routed bootstrap recovery requires an agent id");
  return context.agentId;
}
function basePlan(context) {
  return buildAgentBootstrapPlan({
    chainPath: context.chainPath,
    runDir: context.runDir,
    runId: context.runId,
    agentId: requireAgentId(context),
    workspacePath: context.workspacePath,
    env: context.env
  });
}
function runWorkspace(context, run) {
  const execution = run.workspaceExecution;
  if (!execution || execution.tracking !== "git" || execution.isolation !== "git-worktree") {
    return void 0;
  }
  return initializeGitRunWorkspaceIsolation({
    runId: context.runId,
    runDir: context.runDir,
    baseline: execution.baseline
  });
}
function assertAttemptIdentity(context, attempt, plan) {
  const launchJobId = context.env.MENTIKO_LAUNCH_JOB_ID;
  if (attempt.runId !== context.runId || attempt.agentId !== plan.agentId || !launchJobId || attempt.launchJobId !== launchJobId || attempt.leaseId !== plan.sessionName || attempt.processEvidence?.ptySessionId && attempt.processEvidence.ptySessionId !== plan.sessionName) {
    throw new Error(`interrupted bootstrap identity mismatch: ${attempt.id}`);
  }
}
async function removeSessionAndProveAbsent(executor, sessionName) {
  await executor.remove(sessionName);
  const remaining = await executor.list();
  if (remaining.some((session) => session.name === sessionName)) {
    throw new Error(`PTY removal could not be proven for ${sessionName}`);
  }
}
function definedEnv(env) {
  const result = {};
  for (const [key, value2] of Object.entries(env)) {
    if (typeof value2 === "string") result[key] = value2;
  }
  return result;
}
function latestAttempt(runJsonPath, attemptId) {
  const attempt = readRunnerV2AttemptState(runJsonPath).attempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) throw new Error(`AgentAttempt not found during bootstrap recovery: ${attemptId}`);
  return attempt;
}
function releaseInterruptedAttempt(input) {
  let attempt = latestAttempt(input.runJsonPath, input.attemptId);
  if (attempt.phase === "released") return;
  if (input.blocked) {
    attempt = transitionAgentAttempt({
      runJsonPath: input.runJsonPath,
      attemptId: input.attemptId,
      to: "human_action_required",
      reason: input.reason,
      detail: input.detail
    });
  }
  transitionAgentAttempt({
    runJsonPath: input.runJsonPath,
    attemptId: attempt.id,
    to: "released",
    reason: input.blocked ? "released" : input.reason,
    detail: input.detail
  });
}
async function ensureSubmittedAttemptMonitor(input) {
  const isolated = runWorkspace(input.context, input.run);
  const plan = isolated ? retargetAgentBootstrapPlan(
    input.sourcePlan,
    readGitNodeWorkspace({
      runWorkspace: isolated,
      agentId: input.attempt.agentId,
      attemptId: input.attempt.id
    }).workspacePath,
    input.context.env
  ) : input.sourcePlan;
  const sessions = await input.executor.list();
  const monitor = sessions.find((session) => session.name === plan.monitorSessionName);
  if (monitor?.alive) return { status: "started", monitor: "already-running" };
  if (monitor) {
    await removeSessionAndProveAbsent(input.executor, plan.monitorSessionName);
  }
  const spawned = await input.executor.spawn(
    plan.monitorSessionName,
    "bash",
    ["-lc", plan.monitorCommand],
    {
      cwd: plan.projectRoot,
      env: definedEnv({
        PATH: plan.runContextExports.PATH || process.env.PATH || "",
        MENTIKO_RUNNER_V2_ACTIVE: "1",
        MENTIKO_RUNNER_V2_MODE: "typed-plan",
        ...plan.runContextExports
      })
    }
  );
  if (spawned.name !== plan.monitorSessionName) {
    throw new Error(`monitor PTY identity mismatch for ${input.attempt.id}`);
  }
  const after = await input.executor.list();
  if (!after.some((session) => session.name === plan.monitorSessionName && session.alive)) {
    const current = latestAttempt(input.runJsonPath, input.attempt.id);
    if (current.phase !== "completed" && current.phase !== "completion_failed") {
      throw new Error(`monitor restart could not be proven for ${input.attempt.id}`);
    }
  }
  return { status: "started", monitor: "restarted" };
}
async function recoverInterruptedRoutedBootstrap(input) {
  const executor = input.executor || pty;
  const runJsonPath = (0, import_node_path12.join)(input.context.runDir, "run.json");
  const run = readRunJson(runJsonPath);
  const plan = basePlan(input.context);
  assertAttemptIdentity(input.context, input.attempt, plan);
  if (input.attempt.phase === "instructions_submitted") {
    return ensureSubmittedAttemptMonitor({
      context: input.context,
      attempt: input.attempt,
      executor,
      run,
      sourcePlan: plan,
      runJsonPath
    });
  }
  if (!INTERRUPTED_PRE_INSTRUCTION_PHASES.has(input.attempt.phase)) {
    throw new Error(
      `AgentAttempt ${input.attempt.id} is not recoverable from ${input.attempt.phase}`
    );
  }
  await removeSessionAndProveAbsent(executor, plan.monitorSessionName);
  await removeSessionAndProveAbsent(executor, plan.sessionName);
  const isolated = runWorkspace(input.context, run);
  const cleanup = isolated ? cleanupGitNodeWorkspaceDurably({
    runWorkspace: isolated,
    agentId: input.attempt.agentId,
    attemptId: input.attempt.id,
    mode: "pristine-startup"
  }) : void 0;
  if (cleanup?.outcome === "preserved-changes") {
    const detail = `interrupted attempt ${input.attempt.id} changed its isolated worktree; preserved for review`;
    releaseInterruptedAttempt({
      runJsonPath,
      attemptId: input.attempt.id,
      reason: "interrupted_bootstrap_changes",
      detail,
      blocked: true
    });
    return { status: "blocked", reason: detail };
  }
  const cleanupOutcome = cleanup?.outcome;
  if (input.attempt.instructionLedger.length > 0) {
    const detail = `instruction intent for ${input.attempt.id} was durable but physical PTY delivery was not provable`;
    releaseInterruptedAttempt({
      runJsonPath,
      attemptId: input.attempt.id,
      reason: "instruction_delivery_ambiguous",
      detail,
      blocked: true
    });
    return { status: "blocked", reason: detail };
  }
  releaseInterruptedAttempt({
    runJsonPath,
    attemptId: input.attempt.id,
    reason: "launch_coordinator_interrupted",
    detail: `coordinator stopped before instruction delivery for ${input.attempt.id}; PTYs and worktree were reclaimed`,
    blocked: false
  });
  return {
    status: "retry",
    ...cleanupOutcome ? { cleanupOutcome } : {}
  };
}

// lib/runner-v2/launch-coordinator-state.ts
var HEARTBEAT_INTERVAL_MS = 15e3;
function targetIds(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}
function updatePendingHandoffs(runJsonPath, update) {
  updateRunJson(runJsonPath, (run) => {
    if (!run) throw new Error(`run.json not found: ${runJsonPath}`);
    const runnerV2 = run.runnerV2 && typeof run.runnerV2 === "object" ? run.runnerV2 : {};
    return {
      ...run,
      runnerV2: {
        ...runnerV2,
        pendingHandoffs: update(pendingHandoffs(run))
      }
    };
  });
}
function registerLaunchCoordinator(input) {
  if (!Number.isSafeInteger(input.pid) || input.pid <= 0) {
    throw new Error("launch coordinator pid must be a positive safe integer");
  }
  const agentIds = targetIds(input.agentIds);
  if (agentIds.length === 0) throw new Error("launch coordinator requires at least one agent");
  const at = (input.now || /* @__PURE__ */ new Date()).toISOString();
  const matches = (handoff) => input.handoffId ? handoff.id === input.handoffId : !handoff.id && handoff.pid === input.pid;
  updatePendingHandoffs(input.runJsonPath, (current) => [
    ...current.filter((handoff) => !matches(handoff)),
    {
      ...input.handoffId ? { id: input.handoffId } : {},
      pid: input.pid,
      targetAgentIds: agentIds,
      startedAt: at,
      heartbeatAt: at
    }
  ]);
}
function heartbeatLaunchCoordinator(input) {
  const at = (input.now || /* @__PURE__ */ new Date()).toISOString();
  let found = false;
  updatePendingHandoffs(input.runJsonPath, (current) => current.map((handoff) => {
    const matches = input.handoffId ? handoff.id === input.handoffId && handoff.pid === input.pid : !handoff.id && handoff.pid === input.pid;
    if (!matches) return handoff;
    found = true;
    return { ...handoff, heartbeatAt: at };
  }));
  return found;
}
function clearLaunchCoordinator(input) {
  updatePendingHandoffs(
    input.runJsonPath,
    (current) => current.filter((handoff) => input.handoffId ? handoff.id !== input.handoffId || handoff.pid !== input.pid : handoff.id || handoff.pid !== input.pid)
  );
}
function startLaunchCoordinatorHeartbeat(input) {
  registerLaunchCoordinator(input);
  const heartbeat = setInterval(() => {
    try {
      heartbeatLaunchCoordinator(input);
    } catch (error) {
      console.error(
        `[runner-v2] launch coordinator heartbeat failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  return () => {
    clearInterval(heartbeat);
    try {
      clearLaunchCoordinator(input);
    } catch (error) {
      console.error(
        `[runner-v2] launch coordinator cleanup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}

// lib/runner-v2/launch-job-runner.ts
var DEFAULT_LEASE_MS = 12e4;
var DURABLY_STARTED_ATTEMPT_PHASES = /* @__PURE__ */ new Set([
  "instructions_submitted",
  "completed",
  "completion_failed",
  "stuck"
]);
var INTERRUPTED_PRE_INSTRUCTION_PHASES2 = /* @__PURE__ */ new Set([
  "pty_allocated",
  "process_spawned",
  "ready_for_instructions"
]);
var BLOCKED_ATTEMPT_PHASES = /* @__PURE__ */ new Set(["startup_failed", "human_action_required"]);
var BLOCKING_TERMINAL_REASONS = /* @__PURE__ */ new Set([
  "instruction_delivery_ambiguous",
  "interrupted_bootstrap_changes"
]);
var TERMINAL_RUN_STATUSES3 = /* @__PURE__ */ new Set(["blocked", "failed", "stopped", "completed", "cancelled"]);
async function runRoutedLaunchJob(input) {
  const dependencies = input.dependencies || {};
  const pid = dependencies.pid || process.pid;
  const leaseMs = dependencies.leaseMs || DEFAULT_LEASE_MS;
  const claimed = claimRoutedLaunchJob({
    runJsonPath: input.runJsonPath,
    jobId: input.jobId,
    ownerId: input.ownerId,
    pid,
    leaseMs
  });
  if (!claimed) return { status: "busy", jobId: input.jobId };
  const stopJobHeartbeat = startRoutedLaunchJobHeartbeat({
    runJsonPath: input.runJsonPath,
    jobId: input.jobId,
    ownerId: input.ownerId,
    leaseMs
  });
  const stopHandoffHeartbeat = startLaunchCoordinatorHeartbeat({
    runJsonPath: input.runJsonPath,
    handoffId: input.jobId,
    pid,
    agentIds: claimed.targets.map((target) => target.agentId)
  });
  try {
    const chain = JSON.parse((0, import_node_fs11.readFileSync)(claimed.chainPath, "utf8"));
    const targetResults = await Promise.allSettled(claimed.targets.map((target) => runLaunchTarget({
      runJsonPath: input.runJsonPath,
      job: claimed,
      ownerId: input.ownerId,
      agentId: target.agentId,
      chain,
      dependencies
    })));
    const rejectedTarget = targetResults.find(
      (result) => result.status === "rejected"
    );
    if (rejectedTarget) throw rejectedTarget.reason;
    if (!routedLaunchJobLeaseOwned({
      runJsonPath: input.runJsonPath,
      jobId: input.jobId,
      ownerId: input.ownerId
    })) {
      return { status: "busy", jobId: input.jobId };
    }
    const run = readRunJson(input.runJsonPath);
    const observed = claimed.targets.map((target) => ({
      target,
      attempt: latestJobAttempt(input.runJsonPath, input.jobId, target.agentId)
    }));
    const blocked = observed.filter(({ attempt }) => attempt && attemptBlocksLaunch(attempt));
    const missing = observed.filter(({ attempt }) => !attempt || !DURABLY_STARTED_ATTEMPT_PHASES.has(attempt.phase) && !attemptBlocksLaunch(attempt));
    if (TERMINAL_RUN_STATUSES3.has(run.status) || blocked.length > 0) {
      const blockedAttempt = blocked[0]?.attempt;
      const reason = typeof run.status_message === "string" ? run.status_message : typeof run.blockedReason === "string" ? run.blockedReason : blockedAttempt?.terminalDetail || blockedAttempt?.terminalReason || `routed launch job blocked for run ${run.id}`;
      blockRoutedLaunchJob({
        runJsonPath: input.runJsonPath,
        jobId: input.jobId,
        ownerId: input.ownerId,
        reason
      });
      return { status: "blocked", jobId: input.jobId, error: reason };
    }
    if (missing.length > 0) {
      throw new Error(
        `launch targets did not reach durable startup: ${missing.map(({ target }) => target.agentId).join(",")}`
      );
    }
    if (!completeRoutedLaunchJob({
      runJsonPath: input.runJsonPath,
      jobId: input.jobId,
      ownerId: input.ownerId
    })) {
      return { status: "busy", jobId: input.jobId };
    }
    return { status: "completed", jobId: input.jobId };
  } catch (error) {
    const message = errorMessage2(error);
    let terminal = false;
    try {
      terminal = TERMINAL_RUN_STATUSES3.has(readRunJson(input.runJsonPath).status);
    } catch {
      terminal = false;
    }
    if (terminal) {
      blockRoutedLaunchJob({
        runJsonPath: input.runJsonPath,
        jobId: input.jobId,
        ownerId: input.ownerId,
        reason: message
      });
      return { status: "blocked", jobId: input.jobId, error: message };
    }
    releaseRoutedLaunchJob({
      runJsonPath: input.runJsonPath,
      jobId: input.jobId,
      ownerId: input.ownerId,
      error: message
    });
    return { status: "requeued", jobId: input.jobId, error: message };
  } finally {
    stopJobHeartbeat();
    stopHandoffHeartbeat();
  }
}
async function runLaunchTarget(input) {
  if (!routedLaunchJobLeaseOwned({
    runJsonPath: input.runJsonPath,
    jobId: input.job.id,
    ownerId: input.ownerId
  })) throw new Error(`routed launch job ownership lost: ${input.job.id}`);
  const env = {
    ...input.dependencies.processEnv || process.env,
    ...input.job.environment,
    MENTIKO_RUN_ID: input.job.runId,
    RUN_ID: input.job.runId,
    MENTIKO_RUN_DIR: input.job.runDir,
    MENTIKO_COMPLETION_OCCURRENCE_ID: input.job.occurrenceId,
    MENTIKO_LAUNCH_JOB_ID: input.job.id,
    MENTIKO_LAUNCH_JOB_OWNER_ID: input.ownerId,
    MENTIKO_RUNNER_V2: "1",
    MENTIKO_RUNNER_V2_COMPLETION: "1"
  };
  const context = {
    chainPath: input.job.chainPath,
    runDir: input.job.runDir,
    runId: input.job.runId,
    agentId: input.agentId,
    chainId: input.chain.id || (0, import_node_path13.basename)(input.job.chainPath, ".json"),
    chainName: input.chain.name || input.chain.id || (0, import_node_path13.basename)(input.job.chainPath, ".json"),
    workspacePath: env.MENTIKO_WORKSPACE_PATH,
    taskId: env.MENTIKO_TASK_ID,
    debug: env.MENTIKO_DEBUG === "1",
    logFd: 2,
    cwd: env.MENTIKO_WORKSPACE_PATH || process.cwd(),
    env
  };
  const prior = latestJobAttempt(input.runJsonPath, input.job.id, input.agentId);
  if (prior && INTERRUPTED_PRE_INSTRUCTION_PHASES2.has(prior.phase)) {
    bindRoutedLaunchJobAttempt({
      runJsonPath: input.runJsonPath,
      jobId: input.job.id,
      ownerId: input.ownerId,
      agentId: input.agentId,
      attemptId: prior.id
    });
    const recover = input.dependencies.recoverInterruptedBootstrap || recoverInterruptedRoutedBootstrap;
    const recovery = await recover({ context, attempt: prior });
    if (recovery.status !== "retry") return;
  }
  if (prior?.phase === "instructions_submitted") {
    bindRoutedLaunchJobAttempt({
      runJsonPath: input.runJsonPath,
      jobId: input.job.id,
      ownerId: input.ownerId,
      agentId: input.agentId,
      attemptId: prior.id
    });
    const recover = input.dependencies.recoverInterruptedBootstrap || recoverInterruptedRoutedBootstrap;
    const recovery = await recover({ context, attempt: prior });
    if (recovery.status !== "started") {
      throw new Error(`submitted launch target ${input.agentId} did not recover its monitor`);
    }
    return;
  }
  if (prior && (DURABLY_STARTED_ATTEMPT_PHASES.has(prior.phase) || attemptBlocksLaunch(prior))) {
    bindRoutedLaunchJobAttempt({
      runJsonPath: input.runJsonPath,
      jobId: input.job.id,
      ownerId: input.ownerId,
      agentId: input.agentId,
      attemptId: prior.id
    });
    return;
  }
  const bootstrap = input.dependencies.bootstrap || startRunnerV2Bootstrap;
  const result = await bootstrap(context);
  if (result.support === "unsupported") throw new Error(result.reason);
  const current = latestJobAttempt(input.runJsonPath, input.job.id, input.agentId);
  if (!current) throw new Error(`launch target ${input.agentId} did not create an owned AgentAttempt`);
  bindRoutedLaunchJobAttempt({
    runJsonPath: input.runJsonPath,
    jobId: input.job.id,
    ownerId: input.ownerId,
    agentId: input.agentId,
    attemptId: current.id
  });
}
function attemptBlocksLaunch(attempt) {
  return BLOCKED_ATTEMPT_PHASES.has(attempt.phase) || Boolean(attempt.terminalReason && BLOCKING_TERMINAL_REASONS.has(attempt.terminalReason));
}
function latestJobAttempt(runJsonPath, jobId, agentId) {
  return [...readRunnerV2AttemptState(runJsonPath).attempts].reverse().find((attempt) => attempt.agentId === agentId && attempt.launchJobId === jobId);
}
function errorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}

// lib/runner-v2/launch-agent-cli.ts
async function main() {
  const [chainPath, ...requestedAgentIds] = process.argv.slice(2);
  const runId = process.env.MENTIKO_RUN_ID || process.env.RUN_ID;
  const runDir = process.env.MENTIKO_RUN_DIR;
  const occurrenceId = process.env.MENTIKO_COMPLETION_OCCURRENCE_ID;
  if (!chainPath || requestedAgentIds.length === 0 || !runId || !runDir || !occurrenceId) {
    throw new Error(
      "usage: runner-v2-launch-agent <chain.json> <agent-id>... (MENTIKO_RUN_ID, MENTIKO_RUN_DIR, and MENTIKO_COMPLETION_OCCURRENCE_ID required)"
    );
  }
  const allAgentIds = configuredAgentIds(requestedAgentIds);
  const jobId = process.env.MENTIKO_LAUNCH_JOB_ID || routedLaunchJobId({
    occurrenceId,
    runId,
    targetAgentIds: allAgentIds
  });
  const runJsonPath = (0, import_node_path14.join)(runDir, "run.json");
  if (process.env.MENTIKO_LAUNCH_COORDINATOR !== "1") {
    const job = persistRoutedLaunchJob({
      runJsonPath,
      jobId,
      occurrenceId,
      runId,
      runDir,
      chainPath,
      targetAgentIds: allAgentIds,
      environment: process.env
    });
    dispatchCoordinator({ chainPath, jobId: job.id, agentIds: allAgentIds });
    console.log(JSON.stringify({ status: "queued", runId, jobId: job.id, agentIds: allAgentIds }));
    return;
  }
  const ownerId = process.env.MENTIKO_LAUNCH_JOB_OWNER_ID || `coordinator:${process.pid}:${(0, import_node_crypto7.randomUUID)()}`;
  const result = await runRoutedLaunchJob({ runJsonPath, jobId, ownerId });
  if (result.status === "requeued") {
    throw new Error(result.error || `routed launch job ${jobId} was requeued`);
  }
  console.log(JSON.stringify({ status: result.status, runId, jobId, agentIds: allAgentIds }));
}
function dispatchCoordinator(input) {
  const coordinator = (0, import_node_child_process4.spawn)(process.execPath, [process.argv[1], input.chainPath, ...input.agentIds], {
    detached: true,
    stdio: "inherit",
    env: {
      ...process.env,
      MENTIKO_LAUNCH_COORDINATOR: "1",
      MENTIKO_LAUNCH_JOB_ID: input.jobId,
      MENTIKO_LAUNCH_JOB_TARGETS: JSON.stringify(input.agentIds)
    }
  });
  if (!coordinator.pid) {
    console.error(`[runner-v2] immediate launch coordinator did not start; job ${input.jobId} remains queued`);
    return;
  }
  coordinator.unref();
}
function configuredAgentIds(requestedAgentIds) {
  const configured = process.env.MENTIKO_LAUNCH_JOB_TARGETS;
  let values = requestedAgentIds;
  if (configured) {
    const parsed = JSON.parse(configured);
    if (!Array.isArray(parsed) || !parsed.every((value2) => typeof value2 === "string" && value2)) {
      throw new Error("MENTIKO_LAUNCH_JOB_TARGETS must be a non-empty JSON string array");
    }
    values = parsed;
  }
  const normalized = Array.from(new Set(values.filter(Boolean))).sort();
  if (normalized.length === 0) throw new Error("routed launch job requires at least one target");
  for (const requested of requestedAgentIds) {
    if (!normalized.includes(requested)) {
      throw new Error(`requested target ${requested} is absent from the routed launch job`);
    }
  }
  return normalized;
}
main().catch((error) => {
  console.error(`runner-v2 routed launch failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
/*! Bundled license information:

react/cjs/react.production.js:
  (**
   * @license React
   * react.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react/cjs/react.development.js:
  (**
   * @license React
   * react.development.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
