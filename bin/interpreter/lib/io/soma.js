const prompt = require('prompt-sync')();
const SWString = require('../../types/string');
const RTResult = require('../../runtimeResult');

/**
 * Gets input from STDIN
 * @param {SWBuiltInFunction} inst the instance of the built in function
 * @param {Context} executionContext the calling context
 */
function soma(inst, executionContext) {
  let res = new RTResult();
  let swali = executionContext.symbolTable.get('swali');
  swali = swali ? swali.toString(false) : '> ';
  let textInput = prompt(swali);
  return res.success(new SWString(textInput || ''));
}

module.exports = { method: soma, args: ['swali'] };
