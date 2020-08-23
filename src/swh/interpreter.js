const util = require('util');
const colors = require('colors');
const print = require('../utils/print');
const prompt = require('prompt-sync')();

const SWValue = require('./types/value');
const SWNull = require('./types/null');
const SWNumber = require('./types/number');
const SWString = require('./types/string');
const SWBoolean = require('./types/boolean');
const SWList = require('./types/list');
const TT = require('./tokenTypes');

const Context = require('./context');
const SymbolTable = require('./symbolTable');
const RTResult = require('./runtimeResult');
const { RTError } = require('./error');

/** Analyzes abstract syntax trees from the parser and executes programs */
class Interpreter {
  constructor() {
    /**
     * The maximum number of calls to a while loop that will run before
     * being forcefully terminated
     */
    this.maxCallStackSize = 10000;
  }

  /**
   * Evaluates an AST node
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   */
  visit(node, context) {
    let methodName = `visit${node.constructor.name}`;
    let method = this[methodName] || this.noVisitMethod;
    return method(node, context);
  }

  /**
   * Occurs when no visit method is defined for the current AST node
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   */
  noVisitMethod = (node, context) => {
    throw new Error(`No visit${node.constructor.name} method defined`);
  };

  /**
   * Evaluates a number node
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   * @returns {RTResult}
   */
  visitNumberNode = (node, context) => {
    let res = new RTResult();
    return res.success(
      new SWNumber(node.tok.value)
        .setContext(context)
        .setPosition(node.posStart, node.posEnd)
    );
  };

  /**
   * Evaluates a string node
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   * @returns {RTResult}
   */
  visitStringNode = (node, context) => {
    let res = new RTResult();
    return res.success(
      new SWString(node.tok.value)
        .setContext(context)
        .setPosition(node.posStart, node.posEnd)
    );
  };

  /**
   * Evaluates a list node
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   * @returns {RTResult}
   */
  visitListNode = (node, context) => {
    let res = new RTResult();
    let elements = [];

    for (let elementNode of node.elementNodes) {
      elements.push(res.register(this.visit(elementNode, context)));
      if (res.error) return res;
    }

    return res.success(
      new SWList(elements)
        .setContext(context)
        .setPosition(node.posStart, node.posEnd)
    );
  };

  /**
   * Returns a variable value from the associated context's symbol table
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   * @returns {RTResult}
   */
  visitVarAccessNode = (node, context) => {
    let res = new RTResult();
    let varName = node.varNameTok.value;
    let value = context.symbolTable.get(varName);

    if (!value)
      return res.failure(
        new RTError(
          node.posStart,
          node.posEnd,
          `'${varName}' is not defined`,
          context
        )
      );

    value = value
      .copy()
      .setPosition(node.posStart, node.posEnd)
      .setContext(context);
    return res.success(value);
  };

  /**
   * Sets a variable into the associated context's symbol table
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   * @returns {RTResult}
   */
  visitVarAssignNode = (node, context) => {
    let res = new RTResult();
    let varName = node.varNameTok.value;
    let value = res.register(this.visit(node.valueNode, context));
    if (res.error) return res;

    context.symbolTable.set(varName, value);
    return res.success(value);
  };

  /**
   * Evaluates a binary operation node
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   * @returns {RTResult}
   */
  visitBinOpNode = (node, context) => {
    let res = new RTResult();
    let left = res.register(this.visit(node.leftNode, context));
    if (res.error) return res;

    let right = res.register(this.visit(node.rightNode, context));
    if (res.error) return res;

    let result = new SWValue();
    let error = null;

    if (node.opTok.type === TT.PLUS) {
      [result, error] = left.addedTo(right);
    } else if (node.opTok.type === TT.MINUS) {
      [result, error] = left.subbedBy(right);
    } else if (node.opTok.type === TT.MUL) {
      [result, error] = left.multedBy(right);
    } else if (node.opTok.type === TT.DIV) {
      [result, error] = left.divvedBy(right);
    } else if (node.opTok.type === TT.POW) {
      [result, error] = left.powedBy(right);
    } else if (node.opTok.type === TT.EE) {
      [result, error] = left.getComparisonEQ(right);
    } else if (node.opTok.type == TT.NE) {
      [result, error] = left.getComparisonNE(right);
    } else if (node.opTok.type === TT.LT) {
      [result, error] = left.getComparisonLT(right);
    } else if (node.opTok.type === TT.GT) {
      [result, error] = left.getComparisonGT(right);
    } else if (node.opTok.type === TT.LTE) {
      [result, error] = left.getComparisonLTE(right);
    } else if (node.opTok.type === TT.GTE) {
      [result, error] = left.getComparisonGTE(right);
    } else if (node.opTok.type === TT.AND) {
      [result, error] = left.andedBy(right);
    } else if (node.opTok.type === TT.OR) {
      [result, error] = left.oredBy(right);
    }

    if (error) {
      return res.failure(error);
    } else {
      return res.success(result.setPosition(node.posStart, node.posEnd));
    }
  };

  /**
   * Evaluates a unary operation node
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   * @returns {RTResult}
   */
  visitUnaryOpNode = (node, context) => {
    let res = new RTResult();
    let number = res.register(this.visit(node.node, context));
    if (res.error) return res;

    let error = null;

    if (node.opTok.type === TT.MINUS) {
      [number, error] = number.multedBy(new SWNumber(-1));
    } else if (node.opTok.type === TT.NOT) {
      [number, error] = number.notted();
    }

    if (error) {
      return res.failure(error);
    } else {
      return res.success(number.setPosition(node.posStart, node.posEnd));
    }
  };

  /**
   * Evaluates an if node and returns the value from the case that evaluated to true
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   * @returns {RTResult}
   */
  visitIfNode = (node, context) => {
    let res = new RTResult();

    for (let [condition, expr] of node.cases) {
      let conditionValue = res.register(this.visit(condition, context));
      if (res.error) return res;

      if (conditionValue.isTrue()) {
        let exprValue = res.register(this.visit(expr, context));
        if (res.error) return res;
        return res.success(exprValue);
      }
    }

    if (node.elseCase) {
      let elseValue = res.register(this.visit(node.elseCase, context));
      if (res.error) return res;
      return res.success(elseValue);
    }

    return res.success(null);
  };

  /**
   * Evaluates a for node and returns the value of the expression while the iterator meets given conditions
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   * @returns {RTResult}
   */
  visitForNode = (node, context) => {
    let res = new RTResult();
    let elements = [];
    let stepValue = new SWNumber(1);
    let condition = null;

    let startValue = res.register(this.visit(node.startValueNode, context));
    if (res.error) return res;

    let endValue = res.register(this.visit(node.endValueNode, context));
    if (res.error) return res;

    if (node.stepValueNode) {
      stepValue = res.register(this.visit(node.stepValueNode, context));
    }

    let i = startValue.value;

    if (stepValue.value >= 0) {
      condition = () => i < endValue.value;
    } else {
      condition = () => i > endValue.value;
    }

    let calls = 0;

    while (condition()) {
      context.symbolTable.set(node.varNameTok.value, new SWNumber(i));
      i += stepValue.value;

      elements.push(res.register(this.visit(node.bodyNode, context)));
      if (res.error) return res;

      // prevent infinite loops
      calls++;
      if (calls === this.maxCallStackSize)
        return res.failure(
          new RTError(
            node.posStart,
            node.posEnd,
            `Max call stack size exceeded`,
            context
          )
        );
    }

    return res.success(
      new SWList(elements)
        .setContext(context)
        .setPosition(node.posStart, node.posEnd)
    );
  };

  /**
   * Evaluates a while node and returns the value of the expression while condition is true
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   * @returns {RTResult}
   */
  visitWhileNode = (node, context) => {
    let res = new RTResult();
    let elements = [];

    let calls = 0;

    while (true) {
      let condition = res.register(this.visit(node.conditionNode, context));
      if (res.error) return res;

      if (!condition.isTrue()) break;

      elements.push(res.register(this.visit(node.bodyNode, context)));
      if (res.error) return res;

      // prevent infinite loops
      calls++;
      if (calls === this.maxCallStackSize)
        return res.failure(
          new RTError(
            node.posStart,
            node.posEnd,
            `Max call stack size exceeded`,
            context
          )
        );
    }

    return res.success(
      new SWList(elements)
        .setContext(context)
        .setPosition(node.posStart, node.posEnd)
    );
  };

  /**
   * Evaluates a function definition node
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   * @returns {RTResult}
   */
  visitFuncDefNode = (node, context) => {
    let res = new RTResult();
    let funcName = node.varNameTok ? node.varNameTok.value : null;
    let bodyNode = node.bodyNode;
    let argNames = node.argNameToks.map((argName) => argName.value);
    let funcValue = new SWFunction(funcName, bodyNode, argNames)
      .setContext(context)
      .setPosition(node.posStart, node.posEnd);

    if (node.varNameTok) context.symbolTable.set(funcName, funcValue);

    return res.success(funcValue);
  };

  /**
   * Evaluates a function call node
   * @param {Node} node the AST node to visit
   * @param {Context} context the calling context
   * @returns {RTResult}
   */
  visitCallNode = (node, context) => {
    let res = new RTResult();
    let args = [];

    let valueToCall = res.register(this.visit(node.nodeToCall, context));
    if (res.error) return res;
    valueToCall = valueToCall.copy().setPosition(node.posStart, node.posEnd);

    for (let argNode of node.argNodes) {
      args.push(res.register(this.visit(argNode, context)));
      if (res.error) return res;
    }

    let returnValue = res.register(valueToCall.execute(args));
    if (res.error) return res;

    if (returnValue)
      returnValue = returnValue
        .copy()
        .setPosition(node.posStart, node.posEnd)
        .setContext(context);
    return res.success(returnValue || null);
  };
}

module.exports.Interpreter = Interpreter;

// ================================================================================================
// the code below exists here because of its co-dependent relation with the interpreter class
// ================================================================================================

/** Base function type */
class SWBaseFunction extends SWValue {
  /**
   * instantiates a function
   * @param {String} name name of the function
   * @param {Node} bodyNode node containing the expressions to be run
   * @param {String[]} argNames tokens containing the argument names
   */
  constructor(name) {
    super();
    this.name = name || '<isiyotambuliwa>';
  }

  /**
   * creates a new running context for the function
   */
  generateNewContext() {
    let newContext = new Context(this.name, this.context, this.posStart);
    newContext.symbolTable = new SymbolTable(newContext.parent.symbolTable);
    return newContext;
  }

  /**
   * Ensures required number of args are provided to run function
   * @param {String[]} argNames list of argument names from function definition
   * @param {Node[]} args list of argument nodes
   */
  checkArgs(argNames, args) {
    let res = new RTResult();

    if (args.length > argNames.length)
      return res.failure(
        new RTError(
          this.posStart,
          this.posEnd,
          `${args.length - argNames.length} too many args passed into ${
            this.name
          }`,
          this.context
        )
      );

    if (args.length < argNames.length)
      return res.failure(
        new RTError(
          this.posStart,
          this.posEnd,
          `${argNames.length - args.length} too few args passed into ${
            this.name
          }`,
          this.context
        )
      );

    return res.success(new SWNull());
  }

  /**
   * adds all the arguments into the symbol table
   * @param {String[]} argNames list of argument names from function definition
   * @param {Node[]} args list of argument nodes
   * @param {Context} executionContext executing context
   */
  populateArgs(argNames, args, executionContext) {
    for (let i = 0; i < args.length; i++) {
      let argName = argNames[i];
      let argValue = args[i];
      argValue.setContext(executionContext);
      executionContext.symbolTable.set(argName, argValue);
    }
  }

  /**
   * verifies correct number of arguments are provided and
   * adds the arguments into the symbol table
   * @param {String[]} argNames list of argument names from function definition
   * @param {Node[]} args list of argument nodes
   * @param {Context} executionContext executing context
   */
  checkAndPopulateArgs(argNames, args, executionContext) {
    let res = new RTResult();
    res.register(this.checkArgs(argNames, args));
    if (res.error) return res;

    this.populateArgs(argNames, args, executionContext);
    return res.success(null);
  }

  [util.inspect.custom](depth, options) {
    return this.toString();
  }

  /**
   * string representation of the function class
   * @returns {String}
   */
  toString() {
    return colors.cyan(`<shughuli ${this.name}>`);
  }
}

// ============================================

/** Function data type */
class SWFunction extends SWBaseFunction {
  /**
   * instantiates a function
   * @param {String} name name of the function
   * @param {Node} bodyNode node containing the expressions to be run
   * @param {String[]} argNames tokens containing the argument names
   */
  constructor(name, bodyNode, argNames) {
    super(name);
    this.bodyNode = bodyNode;
    this.argNames = argNames;
  }

  /**
   * Executes the function
   * @param {Token[]} args list of token value nodes to be used as function arguments
   */
  execute(args) {
    let res = new RTResult();
    const INT = new Interpreter();
    let executionContext = this.generateNewContext();

    res.register(
      this.checkAndPopulateArgs(this.argNames, args, executionContext)
    );
    if (res.error) return res;

    let value = res.register(INT.visit(this.bodyNode, executionContext));
    if (res.error) return res;

    return res.success(value);
  }

  /**
   * creates a new instance of the function
   * @returns {SWFunction}
   */
  copy() {
    let copy = new SWFunction(this.name, this.bodyNode, this.argNames);
    copy.setPosition(this.posStart, this.posEnd);
    copy.setContext(this.context);
    return copy;
  }
}

// ============================================

/** Built in function data type */
class SWBuiltInFunction extends SWBaseFunction {
  /**
   * instantiates a built in function
   * @param {String} name the name of the built in function
   */
  constructor(name) {
    super(name);
  }

  /**
   * Executes the function
   * @param {Token[]} args list of token value nodes to be used as function arguments
   */
  execute(args) {
    let res = new RTResult();
    let executionContext = this.generateNewContext();

    let methodName = `execute_${this.name}`;
    let method = this[methodName] || this.noExecuteMethod;
    let argNames = this[this.name];

    res.register(this.checkAndPopulateArgs(argNames, args, executionContext));
    if (res.error) return res;

    let returnValue = res.register(method(executionContext));
    if (res.error) return res;
    return res.success(returnValue);
  }

  /**
   * Occurs when no execution method is defined for the built in function
   * @param {Context} context the calling context
   */
  noExecuteMethod = (context) => {
    throw new Error(`No execute_${node.constructor.name} method defined`);
  };

  /**
   * creates a new instance of the function
   * @returns {SWBuiltInFunction}
   */
  copy() {
    let copy = new SWBuiltInFunction(this.name);
    copy.setPosition(this.posStart, this.posEnd);
    copy.setContext(this.context);
    return copy;
  }

  [util.inspect.custom](depth, options) {
    return this.toString();
  }

  /**
   * string representation of the function class
   * @returns {String}
   */
  toString() {
    return colors.brightCyan(`<shughuli asili ${this.name}>`);
  }

  // =========================================================
  // BUILT IN FUNCTION EXECUTION
  // =========================================================

  /**
   * Print a value to the screen
   * @param {Context} executionContext the calling context
   */
  execute_andika(executionContext) {
    print(executionContext.symbolTable.get('value').toString(false), true); // 2 -> the arguments are then accessed from the execution context's symbol table
    return new RTResult().success(new SWNull());
  }
  andika = ['value']; // 1 -> this contains all the args the built in function requires

  /**
   * Gets input from STDIN
   * @param {Context} executionContext the calling context
   */
  execute_soma(executionContext) {
    let message = executionContext.symbolTable.get('message').toString(false);
    let textInput = prompt(message);

    return new RTResult().success(new SWString(textInput || ''));
  }
  soma = ['message'];

  /**
   * Gets numeric input from STDIN
   * @param {Context} executionContext the calling context
   */
  execute_somaNambari(executionContext) {
    let message = executionContext.symbolTable.get('message').toString(false);
    let numInput = 0;
    while (true) {
      numInput = prompt(message);
      if (isNaN(numInput)) {
        print('Jibu yako si nambari. Jaribu tena.');
      } else {
        break;
      }
    }

    return new RTResult().success(new SWNumber(numInput || 0));
  }
  somaNambari = ['message'];

  /**
   * Clears the terminal
   * @param {Context} executionContext the calling context
   */
  execute_futa(executionContext) {
    console.clear();
    return new RTResult().success(new SWNull());
  }
  futa = []; // built in functions that don't need args still need this empty array

  /**
   * Checks if a value is a number
   * @param {Context} executionContext the calling context
   */
  execute_niNambari(executionContext) {
    let isNumber =
      executionContext.symbolTable.get('value') instanceof SWNumber;
    return new RTResult().success(isNumber ? SWBoolean.TRUE : SWBoolean.FALSE);
  }
  niNambari = ['value'];

  /**
   * Checks if a value is a string
   * @param {Context} executionContext the calling context
   */
  execute_niJina(executionContext) {
    let isString =
      executionContext.symbolTable.get('value') instanceof SWString;
    return new RTResult().success(isString ? SWBoolean.TRUE : SWBoolean.FALSE);
  }
  niJina = ['value'];

  /**
   * Checks if a value is a list
   * @param {Context} executionContext the calling context
   */
  execute_niOrodha(executionContext) {
    let isList = executionContext.symbolTable.get('value') instanceof SWList;
    return new RTResult().success(isList ? SWBoolean.TRUE : SWBoolean.FALSE);
  }
  niOrodha = ['value'];

  /**
   * Checks if a value is a function
   * @param {Context} executionContext the calling context
   */
  execute_niShughuli(executionContext) {
    let isFunction =
      executionContext.symbolTable.get('value') instanceof SWBaseFunction;
    return new RTResult().success(
      isFunction ? SWBoolean.TRUE : SWBoolean.FALSE
    );
  }
  niShughuli = ['value'];

  /**
   * Returns the length of a list/string
   * @param {Context} executionContext the calling context
   */
  execute_idadi(executionContext) {
    let res = new RTResult();

    let value = executionContext.symbolTable.get('value');
    if (value instanceof SWString || value instanceof SWList) {
      return res.success(
        new SWNumber(
          value.elements ? value.elements.length : value.value.length
        )
      );
    } else {
      return res.failure(
        new RTError(
          value.posStart,
          value.posEnd,
          `Cannot find length of non-iterable value`,
          executionContext
        )
      );
    }
  }
  idadi = ['value'];

  // I/O
  static print = new SWBuiltInFunction('andika');
  static input = new SWBuiltInFunction('soma');
  static inputNumber = new SWBuiltInFunction('somaNambari');
  static clear = new SWBuiltInFunction('futa');

  // Type checks
  static isNumber = new SWBuiltInFunction('niNambari');
  static isString = new SWBuiltInFunction('niJina');
  static isList = new SWBuiltInFunction('niOrodha');
  static isFunction = new SWBuiltInFunction('niShughuli');

  // Lists
  static sizeof = new SWBuiltInFunction('idadi');
}

module.exports.SWBuiltInFunction = SWBuiltInFunction;
